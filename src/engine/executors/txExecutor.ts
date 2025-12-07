// src/engine/executors/txExecutor.ts

import { ethers } from "ethers";
import type { ArbPlan } from "./executorBridge";
import ArbExecutorABI from "../../abi/ArbExecutor.json";
import { ROUTER_ABI } from "../../constants";
import { SETTINGS } from "../../config/settings";
import { SafeNonceManager } from "./nonceManager";
import {
  classifyError,
  recordRouterFailure,
  shouldBlockRouter
} from "./executionGuard";
import { Metrics } from "../metrics";

// Utility: assume WBNB-priced profits & gas for now
function amountWeiToUsd(amountWei: bigint): number {
  const price = SETTINGS.USD_PRICE_MAP.WBNB || 0;
  return Number(amountWei) / 1e18 * price;
}

// ----------------------------------------------------------
// PRE-TRADE VALIDATION
// ----------------------------------------------------------
async function validatePlan(plan: ArbPlan, provider: ethers.Provider) {
  const maxSlippage = SETTINGS.MAX_SLIPPAGE_BPS / 10000;
  const routerCache = new Map<string, ethers.Contract>();

  const getRouter = (addr: string) => {
    const key = addr.toLowerCase();
    if (!routerCache.has(key)) {
      routerCache.set(key, new ethers.Contract(addr, ROUTER_ABI, provider));
    }
    return routerCache.get(key)!;
  };

  let amount = BigInt(plan.loanAmount.toString());

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    if (shouldBlockRouter(step.router)) {
      console.log(`❌ Router blacklisted: ${step.router}`);
      return null;
    }

    const router = getRouter(step.router);

    try {
      const out: bigint[] = await router.getAmountsOut(amount, step.path);
      const expectedOut = out[out.length - 1];

      const minOut =
        expectedOut - BigInt(Math.floor(Number(expectedOut) * maxSlippage));

      step.amountIn = amount.toString();
      step.minOut = minOut.toString();

      amount = expectedOut;
    } catch (err) {
      console.warn("Validation getAmountsOut error:", err);
      recordRouterFailure(step.router);
      return null;
    }
  }

  const finalAmount = amount;
  const loanAmount = BigInt(plan.loanAmount.toString());

  if (finalAmount <= loanAmount) return null;

  const profitTokens = finalAmount - loanAmount;
  const profitUsd = amountWeiToUsd(profitTokens);

  if (profitUsd < SETTINGS.MIN_PROFIT_USD) return null;

  return { plan, profitTokens, profitUsd };
}

// ----------------------------------------------------------
// FINAL CHECK BEFORE SEND
// ----------------------------------------------------------
async function finalCheck(plan: ArbPlan, provider: ethers.Provider) {
  const routerCache = new Map<string, ethers.Contract>();
  const getRouter = (addr: string) => {
    const key = addr.toLowerCase();
    if (!routerCache.has(key)) {
      routerCache.set(key, new ethers.Contract(addr, ROUTER_ABI, provider));
    }
    return routerCache.get(key)!;
  };

  let amount = BigInt(plan.loanAmount.toString());

  for (const step of plan.steps) {
    const router = getRouter(step.router);

    try {
      const out: bigint[] = await router.getAmountsOut(amount, step.path);
      amount = out[out.length - 1];
    } catch (err) {
      console.log("❌ Final check router failed:", step.router);
      recordRouterFailure(step.router);
      return null;
    }
  }

  const loan = BigInt(plan.loanAmount.toString());
  if (amount <= loan) return null;

  const profitTokens = amount - loan;
  const profitUsd = amountWeiToUsd(profitTokens);

  return { profitTokens, profitUsd };
}

// ----------------------------------------------------------
// MAIN EXECUTION PIPELINE (with metrics)
// ----------------------------------------------------------
export async function executeArbPlanTx(
  plan: ArbPlan,
  rpcUrl: string,
  privateKey: string,
  arbContractAddress: string
): Promise<ethers.TransactionReceipt | null> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  Metrics.recordExecutionAttempt();

  // A) Initial validation
  const validated = await validatePlan(plan, provider);
  if (!validated) {
    console.log("❌ Validation failed.");
    Metrics.recordExecutionSkip("VALIDATION");
    return null;
  }

  const nonceManager = new SafeNonceManager(provider, privateKey);
  await nonceManager.waitReady();

  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(arbContractAddress, ArbExecutorABI, wallet);

  // B) Gas estimate
  let gasLimit: bigint = BigInt(SETTINGS.DEFAULT_GAS_LIMIT);
  try {
    const est = await contract.estimateGas.executeArb(validated.plan);
    gasLimit = BigInt(Math.floor(Number(est) * 1.25));
  } catch (e) {
    console.warn("⚠️ Gas estimation failed, using fallback.");
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 3_000_000_000n;

  const gasCostWei = gasLimit * gasPrice;
  const gasCostUsd = amountWeiToUsd(gasCostWei);

  const minProfitRequired = gasCostUsd * SETTINGS.GAS_RISK_MULTIPLIER;
  if (validated.profitUsd < minProfitRequired) {
    console.log("❌ Profit does not exceed gas * multiplier.");
    Metrics.recordExecutionSkip("GAS");
    return null;
  }

  // C) Final check just before send
  const final = await finalCheck(plan, provider);
  if (!final) {
    console.log("❌ Final check failed.");
    Metrics.recordExecutionSkip("FINAL_CHECK");
    return null;
  }

  if (final.profitUsd < minProfitRequired) {
    console.log("❌ Price moved unfavorably before execution.");
    Metrics.recordExecutionSkip("FINAL_CHECK");
    return null;
  }

  const netProfitAfterGasUsd = final.profitUsd - gasCostUsd;

  console.log("📊 Final Profit (USD):", final.profitUsd.toFixed(4));
  console.log("📉 Net Profit After Gas (USD):", netProfitAfterGasUsd.toFixed(4));

  if (netProfitAfterGasUsd <= 0) {
    console.log("❌ Net profit after gas is not positive. Aborting.");
    Metrics.recordExecutionSkip("GAS");
    return null;
  }

  // D) Send transaction with nonce control
  const nextNonce = await nonceManager.getNextNonce();

  try {
    const tx = await contract.executeArb(validated.plan, {
      gasLimit,
      gasPrice,
      nonce: nextNonce
    });

    console.log("🚀 Sent Tx:", tx.hash);

    const receipt = await tx.wait();
    console.log("✅ Confirmed:", receipt.hash);

    Metrics.recordExecutionSuccess(netProfitAfterGasUsd);

    return receipt;
  } catch (err: any) {
    const category = classifyError(err);
    console.log("❌ Execution error:", category, err);

    Metrics.recordExecutionFailure(category);

    for (const step of plan.steps) {
      recordRouterFailure(step.router);
    }

    return null;
  }
}

/**
 * Select best opp and run full pipeline.
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
