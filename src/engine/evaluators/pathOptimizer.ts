// src/engine/evaluators/pathOptimizer.ts

import type { PoolInfo } from "../scanners/poolScanner";

/**
 * Edge in the token graph: represents a swap from tokenIn -> tokenOut
 * using a specific DEX (router + pair).
 */
export interface Edge {
  tokenIn: string;
  tokenOut: string;
  dexName: string;
  router: string;
  pair: string;
  reserveIn: bigint;
  reserveOut: bigint;
}

/**
 * Token graph: adjacency list mapping token -> outgoing edges.
 */
export type TokenGraph = Map<string, Edge[]>;

/**
 * Build a directed token graph from the scanned pools.
 * For each pool (tokenA, tokenB, dex), we add two edges:
 *   tokenA -> tokenB
 *   tokenB -> tokenA
 */
export function buildTokenGraph(pools: PoolInfo[]): TokenGraph {
  const graph: TokenGraph = new Map();

  function addEdge(edge: Edge) {
    if (!graph.has(edge.tokenIn)) {
      graph.set(edge.tokenIn, []);
    }
    graph.get(edge.tokenIn)!.push(edge);
  }

  for (const pool of pools) {
    const { tokenA, tokenB, dexes } = pool;

    for (const dex of dexes) {
      // A -> B
      addEdge({
        tokenIn: tokenA,
        tokenOut: tokenB,
        dexName: dex.name,
        router: dex.router,
        pair: dex.pair,
        reserveIn: dex.reserveA,
        reserveOut: dex.reserveB
      });

      // B -> A
      addEdge({
        tokenIn: tokenB,
        tokenOut: tokenA,
        dexName: dex.name,
        router: dex.router,
        pair: dex.pair,
        reserveIn: dex.reserveB,
        reserveOut: dex.reserveA
      });
    }
  }

  return graph;
}

/**
 * Simple constant-product AMM pricing (Uniswap V2 style).
 * This is only used for rough path evaluation off-chain.
 */
export function simulateSwap(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;

  const amountInWithFee = amountIn * 997n; // 0.3% fee
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

/**
 * A multihop path: sequence of edges from a start token to some end token.
 */
export interface Path {
  tokens: string[];  // [t0, t1, t2, ...]
  edges: Edge[];     // edges[i]: tokens[i] -> tokens[i+1]
}

/**
 * Find all simple paths from startToken up to maxHops (depth-limited DFS).
 *   - Prevents revisiting the same token in a single path (no trivial loops)
 *   - If returnToStart=true, only keep paths that end back at startToken (triangular)
 */
export function findPaths(
  graph: TokenGraph,
  startToken: string,
  maxHops: number,
  returnToStart: boolean = false
): Path[] {
  const paths: Path[] = [];

  function dfs(
    currentToken: string,
    currentTokens: string[],
    currentEdges: Edge[],
    depth: number
  ) {
    if (depth > maxHops) return;

    const neighbors = graph.get(currentToken) || [];
    for (const edge of neighbors) {
      // Avoid immediate backtracking on same edge
      const nextToken = edge.tokenOut;

      // Simple cycle-prevention: don't revisit tokens on the path
      if (currentTokens.includes(nextToken) && !returnToStart) continue;

      const newTokens = [...currentTokens, nextToken];
      const newEdges = [...currentEdges, edge];

      // If we're doing triangular paths and came back to start
      if (returnToStart && nextToken === startToken && newEdges.length >= 2) {
        paths.push({ tokens: newTokens, edges: newEdges });
        continue;
      }

      // For non-triangular search, add intermediate paths as well
      if (!returnToStart) {
        paths.push({ tokens: newTokens, edges: newEdges });
      }

      // Continue exploring deeper
      dfs(nextToken, newTokens, newEdges, depth + 1);
    }
  }

  dfs(startToken, [startToken], [], 0);

  return paths;
}

/**
 * Evaluate a path using AMM formula and a given starting amount.
 * Returns the final output amount after applying all swaps.
 */
export function evaluatePath(
  path: Path,
  amountIn: bigint
): bigint {
  let currentAmount = amountIn;

  for (const edge of path.edges) {
    currentAmount = simulateSwap(currentAmount, edge.reserveIn, edge.reserveOut);
    if (currentAmount <= 0n) return 0n;
  }

  return currentAmount;
}

/**
 * Find candidate triangular arbitrage cycles:
 *   token -> ... -> token, with up to maxHops edges (e.g., 2 or 3).
 */
export function findTriangularPaths(
  graph: TokenGraph,
  maxHops: number
): Path[] {
  const allTokens = Array.from(graph.keys());
  const allCycles: Path[] = [];

  for (const startToken of allTokens) {
    const cycles = findPaths(graph, startToken, maxHops, true);
    allCycles.push(...cycles);
  }

  return allCycles;
}

/**
 * Given a set of pools and a starting amount, find promising triangular
 * arbitrage candidates using rough off-chain simulation.
 *
 * In practice, you would:
 *  - filter by profitThreshold
 *  - then validate with on-chain router.getAmountsOut before execution
 */
export function findProfitableTriangularCycles(
  pools: PoolInfo[],
  startAmount: bigint,
  profitThreshold: bigint
): Array<{
  path: Path;
  amountIn: bigint;
  amountOut: bigint;
  profit: bigint;
}> {
  const graph = buildTokenGraph(pools);
  const cycles = findTriangularPaths(graph, 3); // up to 3 hops
  const results: Array<{
    path: Path;
    amountIn: bigint;
    amountOut: bigint;
    profit: bigint;
  }> = [];

  for (const cycle of cycles) {
    const out = evaluatePath(cycle, startAmount);
    if (out > startAmount) {
      const profit = out - startAmount;
      if (profit >= profitThreshold) {
        results.push({
          path: cycle,
          amountIn: startAmount,
          amountOut: out,
          profit
        });
      }
    }
  }

  return results;
}

