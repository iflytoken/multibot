// src/engine/executors/txExecutor.ts

import { ethers } from "ethers";
import type { ArbPlan } from "./executorBridge";
import ArbExecutorABI from "../../abi/ArbExecutor.json";
import { ROUTER_ABI } from "../../constants";
import { SETTINGS } from "../../config/settings";

/**
 * Convert a token amount (assumed 18 decimals) to approximate USD.
 * For now we assume the loan token and gas token are WBNB.
 * Later you can extend this to real per-token pricing/oracles.
 */
function amountWeiToUsd(amountWei: bigint): number {
  const wbnbPrice = SETTINGS.USD_PRICE_MAP.WBNB || 0;
  return Number(amountWei) / 1e18 * wbnbPrice;
}

/**
 * Pre-trade validation:
 *  - For each step, calls router.getAmountsOut
 *  - Sets slippage-protected minOut
 *  - Computes final profit in tokens + USD
 *  - Enforces MIN_PROFIT_USD
 *
 * Returns:
 *  - prepared ArbPlan with amountIn/minOut filled
 *  - expectedProfitUsd (before gas)
 */
export async function validateAndPreparePlan(
  plan: ArbPlan,
  provider: ethers.Provider
): Promise<{ plan: ArbPlan; expectedProfitTokens: bigint; expectedProfitUsd: number } | null> {
  const maxSlippage = SETTINGS.MAX_SLIPPAGE_BPS / 10_000; // e.g. 50 -> 0.005

  const routerCache = new Map<string, ethers.Contract>();
  const getRouter = (addr: string) => {
    const key = addr.toLowerCase();
    if (!routerCache.has(key)) {
      routerCache.set(key, new ethers.Contract(addr, ROUTER_ABI, provider));
    }
    return routerCache.get(key)!;
  };

  let currentAmount = BigInt(plan.loanAmount.toString());

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const router = getRouter(step.router);

    const amountIn =
      i === 0 && step.amountIn && BigInt(step.amountIn) > 0n
        ? BigInt(step.amountIn)
        : currentAmount;

    if (amountIn <= 0n) {
      console.warn("validateAndPreparePlan: zero amountIn at step", i);
      return null;
    }

    let expectedOut: bigint;
    try {
      const amounts: bigint[] = await router.getAmountsOut(amountIn, step.path);
      expectedOut = amounts[amounts.length - 1];
    } catch (err) {
      console.warn("validateAndPreparePlan: getAmountsOut failed at step", i, err);
      return null;
    }

    if (expectedOut <= 0n) {
      console.warn("validateAndPreparePlan: expectedOut <= 0 at step", i);
      return null;
    }

    // Slippage guard: minOut = expectedOut * (1 - maxSlippage)
    const minOut =
      expectedOut -
      BigInt(Math.floor(Number(expectedOut) * maxSlippage));

    plan.steps[i].amountIn = amountIn.toString();
    plan.steps[i].minOut = minOut.toString();

    currentAmount = expectedOut;
  }

  const finalAmount = currentAmount;
  const loanAmount = BigInt(plan.loanAmount.toString());
  if (finalAmount <= loanAmount) {
    console.warn("validateAndPreparePlan: no token profit after steps.");
    return null;
  }

  const profitTokens = finalAmount - loanAmount;
  const profitUsd = amountWeiToUsd(profitTokens);

  if (profitUsd < SETTINGS.MIN_PROFIT_USD) {
    console.warn("validateAndPreparePlan: profit below MIN_PROFIT_USD.", {
      profitUsd,
      min: SETTINGS.MIN_PROFIT_USD
    });
    return null;
  }

  return {
    plan,
    expectedProfitTokens: profitTokens,
    expectedProfitUsd: profitUsd
  };
}

/**
 * Final re-check before sending the tx:
 *  - Re-runs getAmountsOut across the entire path
 *  - Recomputes final profit and ensures it has not dropped
 *    below a safety threshold (e.g. 50% of original)
 *
 * This protects against MEV / price movement between initial
 * validation and gas estimation / sending.
 */
async function revalidatePlanBeforeSend(
  validated: { plan: ArbPlan; expectedProfitTokens: bigint; expectedProfitUsd: number },
  provider: ethers.Provider,
  minRetentionRatio: number = 0.5 // final profit must be at least 50% of original expectation
): Promise<{ finalProfitTokens: bigint; finalProfitUsd: number } | null> {
  const { plan, expectedProfitTokens, expectedProfitUsd } = validated;

  const routerCache = new Map<string, ethers.Contract>();
  const getRouter = (addr: string) => {
    const key = addr.toLowerCase();
    if (!routerCache.has(key)) {
      routerCache.set(key, new ethers.Contract(addr, ROUTER_ABI, provider));
    }
    return routerCache.get(key)!;
  };

  let currentAmount = BigInt(plan.loanAmount.toString());

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const router = getRouter(step.router);

    const amountIn =
      i === 0 && step.amountIn && BigInt(step.amountIn) > 0n
        ? BigInt(step.amountIn)
        : currentAmount;

    if (amountIn <= 0n) {
      console.warn("revalidatePlanBeforeSend: zero amountIn at step", i);
      return null;
    }

    let expectedOut: bigint;
    try {
      const amounts: bigint[] = await router.getAmountsOut(amountIn, step.path);
      expectedOut = amounts[amounts.length - 1];
    } catch (err) {
      console.warn("revalidatePlanBeforeSend: getAmountsOut failed at step", i, err);
      return null;
    }

    if (expectedOut <= 0n) {
      console.warn("revalidatePlanBeforeSend: expectedOut <= 0 at step", i);
      return null;
    }

    currentAmount = expectedOut;
  }

  const finalAmount = currentAmount;
  const loanAmount = BigInt(plan.loanAmount.toString());
  if (finalAmount <= loanAmount) {
    console.warn("revalidatePlanBeforeSend: finalAmount <= loanAmount");
    return null;
  }

  const finalProfitTokens = finalAmount - loanAmount;
  const finalProfitUsd = amountWeiToUsd(finalProfitTokens);

  // Ensure profit hasn't collapsed relative to original expectation
  if (finalProfitUsd < expectedProfitUsd * minRetentionRatio) {
    console.warn("revalidatePlanBeforeSend: profit dropped too much.", {
      original: expectedProfitUsd,
      final: finalProfitUsd,
      ratio: finalProfitUsd / expectedProfitUsd
    });
    return null;
  }

  return { finalProfitTokens, finalProfitUsd };
}

/**
 * Execute a validated ArbPlan if:
 *  - profit > MIN_PROFIT_USD
 *  - profit > gasCost * GAS_RISK_MULTIPLIER
 *  - final re-check (just before send) still passes
 */
export async function executeArbPlanTx(
  plan: ArbPlan,
  rpcUrl: string,
  privateKey: string,
  arbContract: string
): Promise<ethers.TransactionReceipt | null> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // 1) Initial validation + expected profit
  const validated = await validateAndPreparePlan(plan, provider);
  if (!validated) {
    console.log("❌ Plan failed initial validation.");
    return null;
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(arbContract, ArbExecutorABI, wallet);

  // 2) Estimate gas
  let gasLimit: bigint;
  try {
    const est = await contract.estimateGas.executeArb(validated.plan);
    gasLimit = BigInt(Math.floor(Number(est) * 1.2));
  } catch (e) {
    console.warn("⚠️ Gas estimation failed, using fallback gas limit.", e);
    gasLimit = BigInt(SETTINGS.DEFAULT_GAS_LIMIT);
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 3_000_000_000n; // fallback 3 gwei

  const gasCostWei = gasLimit * gasPrice;
  const gasCostUsd = amountWeiToUsd(gasCostWei);

  console.log("💰 Expected Profit (USD):", validated.expectedProfitUsd.toFixed(4));
  console.log("⛽ Gas Cost (USD):", gasCostUsd.toFixed(4));

  // 3) Require profit > gas * multiplier
  const minProfitUsdNeeded = gasCostUsd * SETTINGS.GAS_RISK_MULTIPLIER;
  if (validated.expectedProfitUsd < minProfitUsdNeeded) {
    console.log(
      "❌ Skipping trade: expected profit does not beat gas * multiplier.",
      { expectedProfit: validated.expectedProfitUsd, minNeeded: minProfitUsdNeeded }
    );
    return null;
  }

  // 4) Final live re-check just before broadcasting tx
  const rechecked = await revalidatePlanBeforeSend(validated, provider);
  if (!rechecked) {
    console.log("❌ Final re-check failed. Not sending transaction.");
    return null;
  }

  const netProfitAfterGasUsd = rechecked.finalProfitUsd - gasCostUsd;

  console.log("📊 Final Profit (USD):", rechecked.finalProfitUsd.toFixed(4));
  console.log("📉 Net Profit After Gas (USD):", netProfitAfterGasUsd.toFixed(4));

  if (netProfitAfterGasUsd <= 0) {
    console.log("❌ Net profit after gas is not positive. Aborting.");
    return null;
  }

  // 5) Send the transaction
  const tx = await contract.executeArb(validated.plan, { gasLimit });

  console.log("🚀 Sent executeArb tx:", tx.hash);

  const receipt = await tx.wait();
  console.log(
    `✅ executeArb confirmed | block=${receipt.blockNumber} | status=${receipt.status}`
  );

  return receipt;
}

/**
 * Picks a "best" opportunity and executes it, going through
 * all validation + gas + final re-check logic.
 */
export async function executeBestOpportunity(
  opps: any[],
  rpcUrl: string,
  privateKey: string,
  arbContract: string,
  loanAmount: bigint,
  minProfit: bigint,
  beneficiary: string,
  buildArbPlanForOpportunity: (
    opp: any,
    loanAmount: bigint,
    minProfit: bigint,
    beneficiary: string
  ) => ArbPlan
): Promise<ethers.TransactionReceipt | null> {
  if (!opps.length) {
    console.log("No opportunities to execute.");
    return null;
  }

  // TODO: sort by expected profit; for now we just pick the first
  const best = opps[0];
  console.log("Selected opportunity:", best);

  const plan = buildArbPlanForOpportunity(
    best,
    loanAmount,
    minProfit,
    beneficiary
  );

  return executeArbPlanTx(plan, rpcUrl, privateKey, arbContract);
}
