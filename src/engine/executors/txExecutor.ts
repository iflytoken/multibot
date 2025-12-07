// src/engine/executors/txExecutor.ts

import { ethers } from "ethers";
import type { ArbPlan } from "./executorBridge";
import ArbExecutorABI from "../../abi/ArbExecutor.json";
import { ROUTER_ABI } from "../../constants";
import { SETTINGS } from "../../config/settings";

/**
 * Pre-trade validation using live router.getAmountsOut:
 *  - Computes expected amounts per hop
 *  - Sets minOut on each step using slippage cap
 *  - Verifies final expected profit >= minProfit
 */
export async function validateAndPreparePlan(
  plan: ArbPlan,
  provider: ethers.Provider
): Promise<ArbPlan | null> {
  const maxSlippage = SETTINGS.MAX_SLIPPAGE_BPS / 10_000; // e.g. 50 → 0.005

  // Map router -> contract
  const routerCache = new Map<string, ethers.Contract>();

  function getRouter(addr: string) {
    const key = addr.toLowerCase();
    if (!routerCache.has(key)) {
      routerCache.set(
        key,
        new ethers.Contract(addr, ROUTER_ABI, provider)
      );
    }
    return routerCache.get(key)!;
  }

  let currentAmount = BigInt(plan.loanAmount.toString());

  // Walk through all steps in order, computing expected outs
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const router = getRouter(step.router);

    const amountIn =
      i === 0 && step.amountIn && BigInt(step.amountIn.toString()) > 0n
        ? BigInt(step.amountIn.toString())
        : currentAmount;

    if (amountIn <= 0n) {
      console.warn("validateAndPreparePlan: zero amountIn in step", i);
      return null;
    }

    let expectedOut: bigint;

    try {
      const amounts: bigint[] = await router.getAmountsOut(amountIn, step.path);
      expectedOut = amounts[amounts.length - 1];
    } catch (err) {
      console.warn("validateAndPreparePlan: getAmountsOut failed in step", i, err);
      return null;
    }

    if (expectedOut <= 0n) {
      console.warn("validateAndPreparePlan: expectedOut <= 0 in step", i);
      return null;
    }

    // Set slippage-protected minOut
    const minOutBig =
      expectedOut - BigInt(Math.floor(Number(expectedOut) * maxSlippage));

    plan.steps[i].amountIn = amountIn.toString();
    plan.steps[i].minOut = minOutBig.toString();

    currentAmount = expectedOut;
  }

  // After all hops, check profit
  const finalAmount = currentAmount;
  const loanAmount = BigInt(plan.loanAmount.toString());
  const minProfit = BigInt(plan.minProfit.toString());

  if (finalAmount <= loanAmount + minProfit) {
    console.warn(
      "validateAndPreparePlan: Expected final amount does not clear minProfit",
      { finalAmount: finalAmount.toString(), loanAmount: loanAmount.toString(), minProfit: minProfit.toString() }
    );
    return null;
  }

  return plan;
}

/**
 * Executes a single ArbPlan against your deployed ArbExecutor contract,
 * AFTER validating with router quotes.
 */
export async function executeArbPlanTx(
  plan: ArbPlan,
  rpcUrl: string,
  privateKey: string,
  arbContract: string
): Promise<ethers.TransactionReceipt | null> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const validated = await validateAndPreparePlan(plan, provider);
  if (!validated) {
    console.log("❌ Plan validation failed, skipping execution.");
    return null;
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(arbContract, ArbExecutorABI, wallet);

  const gasLimitBuffer = 1.2;
  const gasEstimate = await contract.estimateGas.executeArb(validated);
  const gasLimit = BigInt(
    Math.floor(Number(gasEstimate) * gasLimitBuffer)
  );

  const tx = await contract.executeArb(validated, { gasLimit });

  console.log(`🚀 Sent executeArb tx: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(
    `✅ executeArb confirmed in block ${receipt.blockNumber}, status=${receipt.status}`
  );

  return receipt;
}

/**
 * Picks a "best" opportunity and executes it.
 */
export async function executeBestOpportunity(
  opps: Array<any>,
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

  // TODO: Sort by profit estimate; for now, take first
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
