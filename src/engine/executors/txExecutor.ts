// src/engine/executors/txExecutor.ts

import { ethers } from "ethers";
import type { ArbPlan } from "./executorBridge";
import ArbExecutorABI from "../../abi/ArbExecutor.json";
import { settings } from "../config/settings";
import { TOKENS } from "../config/tokens";
import { ROUTERS } from "../config/routers";

import { SafeNonceManager } from "./nonceManager";
import {
  classifyError,
  recordRouterFailure,
  shouldBlockRouter
} from "./executionGuard";
import { Metrics } from "../metrics";

// ----------------------------------------
// Local execution tuning / fallbacks
// ----------------------------------------

const DEFAULT_GAS_LIMIT = 1_500_000n;
const DEFAULT_MAX_GAS_GWEI = 8n;

/**
 * Build an ethers.Contract instance for ArbExecutor.
 */
function getArbContract(
  rpcUrl: string,
  privateKey: string,
  contractAddress: string
) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(
    contractAddress,
    ArbExecutorABI,
    wallet
  );

  return { provider, wallet, contract };
}

/**
 * Choose the "best" opportunity from the sorted list.
 * Assumes opps are already sorted by profitPct desc.
 */
function selectBestOpportunity(opps: any[]): any | null {
  if (!opps || opps.length === 0) return null;
  return opps[0];
}

/**
 * Core execution function.
 *
 * - opps: list from findOpportunities() (already sorted)
 * - rpcUrl: BSC mainnet RPC
 * - privateKey: wallet to sign tx
 * - contractAddress: deployed ArbExecutor address
 * - loanAmountUsd: logical loan size (usd notion) — used by plan builder
 * - minProfitUsd: logical minimum profit (usd notion)
 * - beneficiary: address to receive profit
 * - buildPlan: function that maps an opportunity → ArbPlan struct
 */
export async function executeBestOpportunity(
  opps: any[],
  rpcUrl: string,
  privateKey: string,
  contractAddress: string,
  loanAmountUsd: number,
  minProfitUsd: number,
  beneficiary: string,
  buildPlan: (
    opp: any,
    loanAmountUsd: number,
    minProfitUsd: number,
    beneficiary: string
  ) => ArbPlan
) {
  const startTs = Date.now();

  if (!opps || opps.length === 0) {
    return null;
  }

  if (!privateKey || !contractAddress || !beneficiary) {
    console.warn(
      "[EXEC] Missing PRIVATE_KEY / ARB_CONTRACT / BENEFICIARY. Skipping execution."
    );
    return null;
  }

  const best = selectBestOpportunity(opps);
  if (!best) return null;

  // Safety gate: avoid executing microscopic spreads
  const minExecSpread =
    settings?.MIN_EXEC_SPREAD_PCT !== undefined
      ? settings.MIN_EXEC_SPREAD_PCT
      : 0.2; // 0.2% default
  if (best.profitPct < minExecSpread) {
    return null;
  }

  // Build ArbPlan for the chosen opportunity
  const plan: ArbPlan = buildPlan(
    best,
    loanAmountUsd,
    minProfitUsd,
    beneficiary
  );

  const { provider, wallet, contract } = getArbContract(
    rpcUrl,
    privateKey,
    contractAddress
  );

  const nonceManager = new SafeNonceManager(wallet);

  // Gas controls
  const gasLimit =
    settings?.MAX_GAS_LIMIT !== undefined
      ? BigInt(settings.MAX_GAS_LIMIT)
      : DEFAULT_GAS_LIMIT;

  const maxGasGwei =
    settings?.MAX_GAS_PRICE_GWEI !== undefined
      ? BigInt(settings.MAX_GAS_PRICE_GWEI)
      : DEFAULT_MAX_GAS_GWEI;

  const gasPrice = (await provider.getGasPrice()).min(
    ethers.parseUnits(maxGasGwei.toString(), "gwei")
  );

  // Basic router-level guard (optional)
  const primaryRouter =
    best.type === "DIRECT"
      ? best.path?.[0]
      : best.dexes?.[0] || "UNKNOWN";

  if (shouldBlockRouter && primaryRouter && shouldBlockRouter(primaryRouter)) {
    console.warn(
      `[EXEC] Router ${primaryRouter} is currently blocked by guard. Skipping.`
    );
    return null;
  }

  try {
    const nextNonce = await nonceManager.getNextNonce();

    const tx = await contract.executeArb(plan, {
      gasLimit,
      gasPrice,
      nonce: nextNonce
    });

    Metrics.recordExecutionAttempt({
      router: primaryRouter,
      hash: tx.hash,
      timestamp: Date.now(),
      profitPct: best.profitPct
    });

    const receipt = await tx.wait();

    Metrics.recordExecutionResult({
      hash: receipt.hash,
      status: receipt.status === 1 ? "success" : "failed",
      gasUsed: receipt.gasUsed?.toString() || "0"
    });

    return receipt;
  } catch (err: any) {
    const classification = classifyError
      ? classifyError(err)
      : { type: "UNKNOWN", reason: err?.reason || err?.message };

    Metrics.recordExecutionError({
      classification,
      message: err?.message || "Unknown error",
      timestamp: Date.now()
    });

    if (recordRouterFailure && primaryRouter) {
      recordRouterFailure(primaryRouter);
    }

    console.error("[EXEC] Execution failed:", classification, err);
    return null;
  }
}
