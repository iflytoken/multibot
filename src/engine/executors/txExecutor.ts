// src/engine/executors/txExecutor.ts

import { ethers } from "ethers";
import type { ArbPlan } from "./executorBridge";
import ArbExecutorABI from "../../abi/ArbExecutor.json";
import { ROUTER_ABI } from "../../constants";
import { SETTINGS } from "../../config/settings";

/**
 * Computes token->USD value using price map
 */
function tokenToUsd(symbol: string, amount: bigint): number {
  const price = SETTINGS.USD_PRICE_MAP[symbol] || 0;
  return Number(amount) / 1e18 * price;
}

/**
 * Validate plan AND compute expected gas cost + net profit
 */
export async function validateAndPreparePlan(
  plan: ArbPlan,
  provider: ethers.Provider
): Promise<{ plan: ArbPlan; expectedProfitUsd: number } | null> {
  const maxSlippage = SETTINGS.MAX_SLIPPAGE_BPS / 10_000;

  const routerCache = new Map<string, ethers.Contract>();
  const getRouter = (addr: string) => {
    const key = addr.toLowerCase();
    if (!routerCache.has(key)) {
      routerCache.set(key, new ethers.Contract(addr, ROUTER_ABI, provider));
    }
    return routerCache.get(key)!;
  };

  // Walk through steps, compute expected outputs, slippage minOut
  let currentAmount = BigInt(plan.loanAmount.toString());

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const router = getRouter(step.router);

    const amountIn =
      i === 0 && step.amountIn && BigInt(step.amountIn) > 0n
        ? BigInt(step.amountIn)
        : currentAmount;

    if (amountIn <= 0n) return null;

    let expectedOut: bigint;
    try {
      const amounts = await router.getAmountsOut(amountIn, step.path);
      expectedOut = amounts[amounts.length - 1];
    } catch (e) {
      console.warn("validate: getAmountsOut failed", e);
      return null;
    }

    if (expectedOut <= 0n) return null;

    // Slippage guard: minOut = expected * (1 - slippage)
    const minOut =
      expectedOut -
      BigInt(Math.floor(Number(expectedOut) * maxSlippage));

    plan.steps[i].amountIn = amountIn.toString();
    plan.steps[i].minOut = minOut.toString();

    currentAmount = expectedOut;
  }

  // Compute profit in tokens + USD
  const finalAmount = currentAmount;
  const loanAmount = BigInt(plan.loanAmount.toString());
  const profitTokens = finalAmount - loanAmount;

  if (profitTokens <= 0n) return null;

  // Convert profit to USD using loan token's symbol
  const loanSym = plan.loanTokenSymbol || "WBNB";
  const expectedProfitUsd = tokenToUsd(loanSym, profitTokens);

  if (expectedProfitUsd < SETTINGS.MIN_PROFIT_USD) return null;

  return { plan, expectedProfitUsd };
}

/**
 * Executes the validated plan ONLY if expectedProfitUSD > gasCostUSD * multiplier
 */
export async function executeArbPlanTx(
  plan: ArbPlan,
  rpcUrl: string,
  privateKey: string,
  arbContract: string
): Promise<ethers.TransactionReceipt | null> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Validate + compute expected profit
  const validated = await validateAndPreparePlan(plan, provider);
  if (!validated) {
    console.log("❌ Plan failed validation.");
    return null;
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(arbContract, ArbExecutorABI, wallet);

  // ------------------------------
  // GAS COST ESTIMATION
  // ------------------------------
  let gasLimit: bigint;
  try {
    const est = await contract.estimateGas.executeArb(validated.plan);
    gasLimit = BigInt(Math.floor(Number(est) * 1.2));
  } catch (e) {
    console.warn("⚠️ Gas estimation failed, using fallback.", e);
    gasLimit = BigInt(SETTINGS.DEFAULT_GAS_LIMIT);
  }

  const gasPrice = await provider.getFeeData().then(d => d.gasPrice ?? 3_000_000_000n);

  // gas cost in wei
  const gasCostWei = gasLimit * gasPrice;

  // Convert gas cost to USD
  const gasCostUsd = tokenToUsd("WBNB", gasCostWei);

  // net profit = expected profit - gas cost
  const netProfitUsd = validated.expectedProfitUsd - gasCostUsd;

  console.log("💰 Expected Profit (USD):", validated.expectedProfitUsd.toFixed(4));
  console.log("⛽ Gas Cost (USD):", gasCostUsd.toFixed(4));
  console.log("📉 Net Profit (USD):", netProfitUsd.toFixed(4));

  // ------------------------------
  // RISK RULE: require profit > gas * multiplier
  // ------------------------------
  if (validated.expectedProfitUsd < gasCostUsd * SETTINGS.GAS_RISK_MULTIPLIER) {
    console.log("❌ Skipping trade: profit does not beat gas × multiplier.");
    return null;
  }

  // ------------------------------
  // SEND TRANSACTION
  // ------------------------------
  const tx = await contract.executeArb(validated.plan, { gasLimit });

  console.log("🚀 Sent executeArb tx:", tx.hash);
  const receipt = await tx.wait();

  console.log(
    `✅ Success block=${receipt.blockNumber} status=${receipt.status}`
  );

  return receipt;
}

/**
 * Selects best opp and executes if profitable after gas
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
) {
  if (!opps.length) return null;

  // Later: sort by expected profit
  const opp = opps[0];

  const plan = buildArbPlanForOpportunity(
    opp,
    loanAmount,
    minProfit,
    beneficiary
  );

  return executeArbPlanTx(plan, rpcUrl, privateKey, arbContract);
}

