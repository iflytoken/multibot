// src/engine/evaluators/pathOptimizer.ts

import { ethers } from "ethers";

/**
 * Path object shape:
 * {
 *   type: "TRIANGULAR",
 *   tokens: [tokenA, tokenB, tokenC],
 *   pairs: [pairAB, pairBC, pairCA],
 *   dexes: [dexAB, dexBC, dexCA]
 * }
 */

/**
 * Build adjacency graph from pools.
 * This enables efficient multi-hop pathfinding.
 */
function buildGraph(pools: any[]) {
  const graph: Record<string, any[]> = {};

  for (const p of pools) {
    if (!graph[p.tokenA]) graph[p.tokenA] = [];
    if (!graph[p.tokenB]) graph[p.tokenB] = [];

    graph[p.tokenA].push({
      next: p.tokenB,
      pair: p.pairAddress,
      dex: p.dex,
    });

    graph[p.tokenB].push({
      next: p.tokenA,
      pair: p.pairAddress,
      dex: p.dex,
    });
  }

  return graph;
}

/**
 * Generate all valid triangular arbitrage paths.
 * (tokenA → tokenB → tokenC → tokenA)
 */
export function optimizePaths(pools: any[], tokenList: string[]) {
  const graph = buildGraph(pools);
  const paths: any[] = [];

  for (const tokenA of tokenList) {
    const neighborsA = graph[tokenA];
    if (!neighborsA) continue;

    for (const hop1 of neighborsA) {
      const tokenB = hop1.next;
      const neighborsB = graph[tokenB];
      if (!neighborsB) continue;

      for (const hop2 of neighborsB) {
        const tokenC = hop2.next;
        if (tokenC === tokenA) continue; // no loops
        const neighborsC = graph[tokenC];
        if (!neighborsC) continue;

        // Final hop must return to tokenA
        const hop3 = neighborsC.find(n => n.next === tokenA);
        if (!hop3) continue;

        // Collect full triangular path
        paths.push({
          type: "TRIANGULAR",
          tokens: [tokenA, tokenB, tokenC],
          pairs: [hop1.pair, hop2.pair, hop3.pair],
          dexes: [hop1.dex, hop2.dex, hop3.dex],
        });
      }
    }
  }

  return paths;
}

