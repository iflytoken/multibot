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

// Utility
function amountWeiToUsd(amountWei: bigint): number {
  const price = SETTINGS.USD_PRICE_MAP.WBNB || 0;
  return Number(amountWei) / 1e18 * price;
}

// ----------------------------------------------------------
// PRE-TRADE VALIDATION (Step 6.1 & 6.3)
// ----------------------------------------------------------
async function validatePlan(plan: ArbPlan, provider: ethers.Provider) {
  const maxSlippage = SETTINGS.MAX_SLIPPAGE_BPS / 10000;
  const routerCache = new Map();

  const getRouter = (addr: string) => {
    const key = addr.toLowerCase();
    if (!routerCache.has(key)) {
      routerCache.set(key, new ethers.Contract(addr, ROUTER_ABI, provider));
    }
    return routerCache.get(key);
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
      const out = await router.getAmountsOut(amount, step.path);
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
// FINAL CHECK BEFORE SEND (Step 6.3)
// ----------------------------------------------------------
async function finalCheck(plan: ArbPlan, provider: ethers.Provider) {
  const routerCache = new Map();
  const getRouter = (addr: string) => {
    const key = addr.toLowerCase();
    if (!routerCache.has(key)) {
      routerCache.set(key, new ethers.Contract(addr, ROUTER_ABI, provider));
    }
    return routerCache.get(key);
  };

  let amount = BigInt(plan.loanAmount.toString());

  for (const step of plan.steps) {
    const router = getRouter(step.router);

    try {
      const out = await router.getAmountsOut(amount, step.path);
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
// MAIN EXECUTION PIPELINE (Step 6.4 Hardening)
// ----------------------------------------------------------
export async function executeArbPlanTx(
  plan: ArbPlan,
  rpcUrl: string,
  privateKey: string,
  arbContractAddress: string
) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // STEP A — Validation
  const validated = await validatePlan(plan, provider);
  if (!validated) {
    console.log("❌ Validation failed.");
    return null;
  }

  const nonceManager = new SafeNonceManager(provider, privateKey);
  await nonceManager.waitReady();

  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(arbContractAddress, ArbExecutorABI, wallet);

  // STEP B — Gas estimate
  let gasLimit: bigint = BigInt(SETTINGS.DEFAULT_GAS_LIMIT);
  try {
    const est = await contract.estimateGas.executeArb(validated.plan);
    gasLimit = BigInt(Math.floor(Number(est) * 1.25));
  } catch (_) {}

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 3_000_000_000n;

  const gasCostWei = gasLimit * gasPrice;
  const gasCostUsd = amountWeiToUsd(gasCostWei);

  const minProfitRequired = gasCostUsd * SETTINGS.GAS_RISK_MULTIPLIER;
  if (validated.profitUsd < minProfitRequired) {
    console.log("❌ Profit does not exceed gas * multiplier.");
    return null;
  }

  // STEP C — Final validation before sending
  const final = await finalCheck(plan, provider);
  if (!final) {
    console.log("❌ Final check failed.");
    return null;
  }

  if (final.profitUsd < minProfitRequired) {
    console.log("❌ Price moved unfavorably before execution.");
    return null;
  }

  // STEP D — Send transaction safely with nonce control
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

    return receipt;
  } catch (err: any) {
    const category = classifyError(err);
    console.log("❌ Execution error:", category, err);

    // penalize every router used in this plan
    for (const step of plan.steps) {
      recordRouterFailure(step.router);
    }

    return null;
  }
}
