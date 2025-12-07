
// src/engine/executors/executorBridge.ts

import type { BigNumberish } from "ethers";

/**
 * These interfaces mirror the shapes returned by your upgraded
 * opportunityFinder.ts (direct + triangular).
 */

export interface DirectOpportunity {
  type: "DIRECT";
  tokenA: string;
  tokenB: string;
  buyDex: {
    name: string;
    router: string;
    pair: string;
  };
  sellDex: {
    name: string;
    router: string;
    pair: string;
  };
  spread: number; // e.g. 0.012 = 1.2%
}

export interface TriangularOpportunity {
  type: "TRIANGULAR";
  tokens: string[];   // e.g. [A, B, C, A]
  dexPath: string[];  // ["Pancake", "Thena", "Ape"]
  routers: string[];  // router addresses
  amountIn: bigint;
  amountOut: bigint;
  profit: bigint;
}

/**
 * These TS types mirror the Solidity structs in ArbExecutor.sol
 *
 * struct SwapAction {
 *   address router;
 *   address[] path;
 *   uint256 amountIn;
 *   uint256 minOut;
 * }
 *
 * struct ArbPlan {
 *   address loanToken;
 *   uint256 loanAmount;
 *   SwapAction[] steps;
 *   uint256 minProfit;
 *   address beneficiary;
 * }
 */

export interface SwapAction {
  router: string;
  path: string[];
  amountIn: BigNumberish;
  minOut: BigNumberish;
}

export interface ArbPlan {
  loanToken: string;
  loanAmount: BigNumberish;
  steps: SwapAction[];
  minProfit: BigNumberish;
  beneficiary: string;
}

/**
 * Build an ArbPlan from a DIRECT A↔B opportunity:
 *
 * Plan:
 *  1. Borrow tokenA
 *  2. Swap A -> B at buyDex
 *  3. Swap B -> A at sellDex
 */
export function buildArbPlanFromDirect(
  opp: DirectOpportunity,
  loanAmount: BigNumberish,
  minProfit: BigNumberish,
  beneficiary: string
): ArbPlan {
  if (opp.type !== "DIRECT") {
    throw new Error("Expected DIRECT opportunity");
  }

  const steps: SwapAction[] = [
    {
      // Buy cheaper tokenA using tokenB? In our convention:
      // We borrow tokenA, so first leg is A -> B on buyDex
      router: opp.buyDex.router,
      path: [opp.tokenA, opp.tokenB],
      amountIn: loanAmount,
      minOut: 1 // will be enforced more strictly with router.getAmountsOut in engine
    },
    {
      // Second leg: B -> A on sellDex
      router: opp.sellDex.router,
      path: [opp.tokenB, opp.tokenA],
      amountIn: 0, // use full balance of B at this step
      minOut: 1
    }
  ];

  const plan: ArbPlan = {
    loanToken: opp.tokenA,
    loanAmount,
    steps,
    minProfit,
    beneficiary
  };

  return plan;
}

/**
 * Build an ArbPlan from a TRIANGULAR opportunity:
 *
 * Plan:
 *   1. Borrow tokens[0]
 *   2. Swap along routers[] and path tokens[]
 *   3. End back at tokens[0], repay + keep profit
 *
 * Example:
 *   tokens: [A, B, C, A]
 *   routers: [r1, r2, r3]
 */
export function buildArbPlanFromTriangular(
  opp: TriangularOpportunity,
  loanAmount: BigNumberish,
  minProfit: BigNumberish,
  beneficiary: string
): ArbPlan {
  if (opp.type !== "TRIANGULAR") {
    throw new Error("Expected TRIANGULAR opportunity");
  }

  if (opp.tokens.length < 3 || opp.tokens.length !== opp.routers.length + 1) {
    throw new Error("Invalid triangular opportunity path");
  }

  const steps: SwapAction[] = [];

  for (let i = 0; i < opp.routers.length; i++) {
    const tokenIn = opp.tokens[i];
    const tokenOut = opp.tokens[i + 1];

    steps.push({
      router: opp.routers[i],
      path: [tokenIn, tokenOut],
      amountIn: i === 0 ? loanAmount : 0, // first hop uses loanAmount, others use full balance
      minOut: 1
    });
  }

  const loanToken = opp.tokens[0];

  const plan: ArbPlan = {
    loanToken,
    loanAmount,
    steps,
    minProfit,
    beneficiary
  };

  return plan;
}

/**
 * Utility: given a generic opp (direct or triangular), dispatch to
 * the correct builder.
 */
export function buildArbPlanForOpportunity(
  opp: DirectOpportunity | TriangularOpportunity,
  loanAmount: BigNumberish,
  minProfit: BigNumberish,
  beneficiary: string
): ArbPlan {
  if (opp.type === "DIRECT") {
    return buildArbPlanFromDirect(opp, loanAmount, minProfit, beneficiary);
  } else {
    return buildArbPlanFromTriangular(opp, loanAmount, minProfit, beneficiary);
  }
}
