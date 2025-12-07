// src/engine/executors/txExecutor.ts

import { ethers } from "ethers";
import type { ArbPlan } from "./executorBridge";
import ArbExecutorABI from "../../abi/ArbExecutor.json";

/**
 * Executes a single ArbPlan against your deployed ArbExecutor contract.
 *
 * @param plan            ArbPlan struct (TS side)
 * @param rpcUrl          RPC URL (BSC testnet / mainnet)
 * @param privateKey      Signer private key
 * @param arbContract     Deployed ArbExecutor address
 */
export async function executeArbPlanTx(
  plan: ArbPlan,
  rpcUrl: string,
  privateKey: string,
  arbContract: string
): Promise<ethers.TransactionReceipt> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(arbContract, ArbExecutorABI, wallet);

  // Slight gas buffer because some routers underestimate
  const gasLimitBuffer = 1.2;

  // Estimate gas for executeArb(plan)
  const gasEstimate = await contract.estimateGas.executeArb(plan);
  const gasLimit = BigInt(
    Math.floor(Number(gasEstimate) * gasLimitBuffer)
  );

  const tx = await contract.executeArb(plan, {
    gasLimit
  });

  console.log(`🚀 Sent executeArb tx: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(
    `✅ executeArb confirmed in block ${receipt.blockNumber}, status=${receipt.status}`
  );

  return receipt;
}

/**
 * Simple helper to pick the "best" opportunity (direct or tri)
 * and execute it with a given loanAmount & minProfit.
 *
 * In a real engine you'd have:
 *  - risk checks
 *  - on-chain router.getAmountsOut sanity check
 *  - concurrency / reorg handling
 */
export async function executeBestOpportunity(
  opps: Array<any>,              // mixture of DIRECT + TRIANGULAR
  rpcUrl: string,
  privateKey: string,
  arbContract: string,
  loanAmount: bigint,
  minProfit: bigint,
  beneficiary: string,
  buildArbPlanForOpportunity: (opp: any, loanAmount: bigint, minProfit: bigint, beneficiary: string) => ArbPlan
) {
  if (!opps.length) {
    console.log("No opportunities to execute.");
    return;
  }

  // Very naive: just pick the first. You can later sort by profit / %.
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
