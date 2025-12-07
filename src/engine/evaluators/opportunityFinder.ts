// src/engine/evaluators/opportunityFinder.ts

import type { PoolInfo } from "../scanners/poolScanner";
import {
  buildTokenGraph,
  findProfitableTriangularCycles
} from "./pathOptimizer";

/**
 * DIRECT ARBITRAGE:
 * Scan all pools and detect simple A ↔ B price spread opportunities.
 * This preserves your original logic but wrapped into a cleaner function.
 */
export function findDirectOpportunities(
  pools: PoolInfo[],
  minSpread: number = 0.005 // 0.5% default threshold
) {
  const opps: Array<{
    type: "DIRECT";
    tokenA: string;
    tokenB: string;
    buyDex: any;
    sellDex: any;
    spread: number;
  }> = [];

  for (const pool of pools) {
    const dexes = pool.dexes;
    if (dexes.length < 2) continue;

    // Sort high price → low price
    dexes.sort((a, b) => b.price - a.price);

    const sell = dexes[0];
    const buy = dexes[dexes.length - 1];

    const spread = (sell.price - buy.price) / buy.price;

    if (spread > minSpread) {
      opps.push({
        type: "DIRECT",
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        buyDex: buy,
        sellDex: sell,
        spread
      });
    }
  }

  return opps;
}

/**
 * TRIANGULAR ARBITRAGE:
 * Uses the path graph to locate cycles of form:
 *   token → token1 → token2 → token
 * and simulate profits using AMM formula.
 */
export function findTriangularOpportunities(
  pools: PoolInfo[],
  startAmount: bigint,
  minProfit: bigint
) {
  const cycles = findProfitableTriangularCycles(pools, startAmount, minProfit);

  return cycles.map(cycle => ({
    type: "TRIANGULAR",
    tokens: cycle.path.tokens,            // token path e.g. [A,B,C,A]
    dexPath: cycle.path.edges.map(e => e.dexName),
    routers: cycle.path.edges.map(e => e.router),
    amountIn: cycle.amountIn,
    amountOut: cycle.amountOut,
    profit: cycle.profit
  }));
}

/**
 * MASTER FUNCTION:
 * Returns both direct arbitrage opportunities AND triangular opportunities.
 * This is useful for the engine loop.
 */
export function findAllOpportunities(
  pools: PoolInfo[],
  startAmount: bigint = 10_0000000000000000n, // 0.01 tokens default
  minSpread: number = 0.005,
  minProfit: bigint = 1_000000000000000n // 0.001 tokens default
) {
  const direct = findDirectOpportunities(pools, minSpread);
  const triangular = findTriangularOpportunities(pools, startAmount, minProfit);

  return {
    direct,
    triangular
  };
}
