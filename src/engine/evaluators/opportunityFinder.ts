// ============================================================================
// opportunityFinder.ts
// Profit simulation + opportunity extraction
// Updated to work with hybrid token registry (getAllTokens())
// ============================================================================

import { BigNumber, ethers } from "ethers";
import type { PoolInfo } from "../scanners/poolScanner";
import { getAllTokens } from "../config/tokens";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function computeAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;

  // Uniswap V2 formula with 0.25% fee
  const amountInWithFee = amountIn * 9975n / 10000n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn + amountInWithFee;

  return numerator / denominator;
}

// -----------------------------------------------------------------------------
// DIRECT ARB CHECK (A → B on dex1, B → A on dex2)
// -----------------------------------------------------------------------------
function checkDirectArb(
  pools: PoolInfo[],
  tokenA: string,
  tokenB: string,
  loanAmount: bigint
) {
  const results: any[] = [];

  const poolsAB = pools.filter(
    p => (p.tokenA === tokenA && p.tokenB === tokenB) ||
         (p.tokenA === tokenB && p.tokenB === tokenA)
  );

  if (poolsAB.length < 2) return [];

  for (let i = 0; i < poolsAB.length; i++) {
    for (let j = 0; j < poolsAB.length; j++) {
      if (i === j) continue;

      const buyPool = poolsAB[i];
      const sellPool = poolsAB[j];

      // forward trade A → B
      const out1 =
        buyPool.tokenA === tokenA
          ? computeAmountOut(loanAmount, buyPool.reserve0, buyPool.reserve1)
          : computeAmountOut(loanAmount, buyPool.reserve1, buyPool.reserve0);

      if (out1 === 0n) continue;

      // backward trade B → A
      const out2 =
        sellPool.tokenA === tokenB
          ? computeAmountOut(out1, sellPool.reserve0, sellPool.reserve1)
          : computeAmountOut(out1, sellPool.reserve1, sellPool.reserve0);

      const profit = out2 - loanAmount;
      const profitPct = Number(profit) / Number(loanAmount) * 100;

      if (profit > 0n) {
        results.push({
          type: "DIRECT",
          tokenA,
          tokenB,
          buyDex: buyPool.dex,
          sellDex: sellPool.dex,
          profit,
          profitPct,
          path: [buyPool.dex, sellPool.dex]
        });
      }
    }
  }

  return results;
}

// -----------------------------------------------------------------------------
// TRIANGULAR ARB CHECK (A → B → C → A)
// -----------------------------------------------------------------------------
function checkTriangularArb(
  pools: PoolInfo[],
  tokenA: string,
  tokenB: string,
  tokenC: string,
  loanAmount: bigint
) {
  const results: any[] = [];

  const findPool = (x: string, y: string) =>
    pools.find(
      p =>
        (p.tokenA === x && p.tokenB === y) ||
        (p.tokenA === y && p.tokenB === x)
    );

  const pAB = findPool(tokenA, tokenB);
  const pBC = findPool(tokenB, tokenC);
  const pCA = findPool(tokenC, tokenA);

  if (!pAB || !pBC || !pCA) return [];

  // A → B
  const out1 =
    pAB.tokenA === tokenA
      ? computeAmountOut(loanAmount, pAB.reserve0, pAB.reserve1)
      : computeAmountOut(loanAmount, pAB.reserve1, pAB.reserve0);

  if (out1 === 0n) return [];

  // B → C
  const out2 =
    pBC.tokenA === tokenB
      ? computeAmountOut(out1, pBC.reserve0, pBC.reserve1)
      : computeAmountOut(out1, pBC.reserve1, pBC.reserve0);

  if (out2 === 0n) return [];

  // C → A
  const out3 =
    pCA.tokenA === tokenC
      ? computeAmountOut(out2, pCA.reserve0, pCA.reserve1)
      : computeAmountOut(out2, pCA.reserve1, pCA.reserve0);

  const profit = out3 - loanAmount;
  const profitPct = Number(profit) / Number(loanAmount) * 100;

  if (profit > 0n) {
    results.push({
      type: "TRIANGULAR",
      tokenA,
      tokenB,
      tokenC,
      profit,
      profitPct,
      path: [pAB.dex, pBC.dex, pCA.dex]
    });
  }

  return results;
}

// -----------------------------------------------------------------------------
// MAIN ENTRY POINT
// -----------------------------------------------------------------------------

export function findOpportunities(
  pools: PoolInfo[],
  paths: any[] = [],
  loanAmount: bigint = 1_000_000_000_000_000n // 0.001 base-loan
) {
  const opps: any[] = [];

  const allTokens = getAllTokens(); // 🔥 FIXED — replaces TOKENS

  // DIRECT ARB CHECKS
  for (const t1 of allTokens) {
    for (const t2 of allTokens) {
      if (t1.address === t2.address) continue;

      opps.push(
        ...checkDirectArb(pools, t1.address, t2.address, loanAmount)
      );
    }
  }

  // TRIANGULAR ARB CHECKS
  for (const t1 of allTokens) {
    for (const t2 of allTokens) {
      for (const t3 of allTokens) {
        if (
          t1.address === t2.address ||
          t2.address === t3.address ||
          t1.address === t3.address
        )
          continue;

        opps.push(
          ...checkTriangularArb(pools, t1.address, t2.address, t3.address, loanAmount)
        );
      }
    }
  }

  return opps.sort((a, b) => Number(b.profit) - Number(a.profit));
}
