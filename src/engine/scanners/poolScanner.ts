// src/engine/scanners/poolScanner.ts

import { ethers } from "ethers";
import { ROUTERS } from "../../config/routers";
import { SETTINGS } from "../../config/settings";
import { FACTORY_ABI, PAIR_ABI, ROUTER_ABI } from "../../constants";
import { batchRpc } from "../../utils/batchRpc";

export interface PoolInfo {
  tokenA: string;
  tokenB: string;
  dexes: Array<{
    name: string;
    router: string;
    pair: string;
    reserveA: bigint;
    reserveB: bigint;
    price: number;
    liquidityUsd: number;
    lastUpdate: number; // blockTimestampLast
  }>;
}

export async function loadAllPairs(provider: ethers.Provider) {
  const results: Array<{
    dex: { name: string; router: string; factory: string };
    pairAddr: string;
  }> = [];
  const factories: Array<{ name: string; router: string; factory: string }> = [];

  // 1) discover factories from routers
  for (const r of ROUTERS) {
    try {
      const router = new ethers.Contract(r.address, ROUTER_ABI, provider);
      const factory = await router.factory();
      factories.push({ name: r.name, router: r.address, factory });
    } catch (err) {
      console.warn(`RouterDiscovery: failed ${r.name}: ${err}`);
    }
  }

  // 2) enumerate pairs from each factory
  for (const dex of factories) {
    try {
      const factory = new ethers.Contract(dex.factory, FACTORY_ABI, provider);
      const totalPairs: bigint = await factory.allPairsLength();

      for (let i = 0n; i < totalPairs; i++) {
        const pairAddr: string = await factory.allPairs(i);
        results.push({ dex, pairAddr });
      }
    } catch (err) {
      console.warn(`PairEnum: Failed on ${dex.name}: ${err}`);
      continue;
    }
  }

  return results;
}

/**
 * Scan pools: fetch token0/1, reserves + timestamp, compute prices & liquidity,
 * and drop:
 *   - low-liquidity pools
 *   - stale pools (blockTimestampLast too old)
 */
export async function scanPools(provider: ethers.Provider): Promise<PoolInfo[]> {
  const rawPairs = await loadAllPairs(provider);

  const ifacePair = new ethers.Interface(PAIR_ABI);

  // Prepare batched calls
  const token0Calls = rawPairs.map(p => ({
    to: p.pairAddr,
    data: ifacePair.encodeFunctionData("token0", [])
  }));

  const token1Calls = rawPairs.map(p => ({
    to: p.pairAddr,
    data: ifacePair.encodeFunctionData("token1", [])
  }));

  const reserveCalls = rawPairs.map(p => ({
    to: p.pairAddr,
    data: ifacePair.encodeFunctionData("getReserves", [])
  }));

  // Batch RPC
  const [token0Results, token1Results, reserveResults] = await Promise.all([
    batchRpc(provider, token0Calls, SETTINGS.RPC_BATCH),
    batchRpc(provider, token1Calls, SETTINGS.RPC_BATCH),
    batchRpc(provider, reserveCalls, SETTINGS.RPC_BATCH)
  ]);

  const pools = new Map<string, PoolInfo>();

  // For staleness checks we need current timestamp
  const latestBlock = await provider.getBlock("latest");
  const nowTs = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
  const staleCutoff = nowTs - SETTINGS.STALE_SECONDS;

  const USD_MAP: Record<string, number> = {
    WBNB: 580,
    BUSD: 1,
    USDT: 1,
    USDC: 1,
    CAKE: 3,
    ETH: 3400,
    BTCB: 65000
  };

  for (let i = 0; i < rawPairs.length; i++) {
    const { dex, pairAddr } = rawPairs[i];

    const t0Raw = token0Results[i];
    const t1Raw = token1Results[i];
    const resRaw = reserveResults[i];

    if (!t0Raw || !t1Raw || !resRaw) continue;

    let token0: string;
    let token1: string;
    let reserve0: bigint;
    let reserve1: bigint;
    let blockTimestampLast: number;

    try {
      token0 = ethers.getAddress(
        ifacePair.decodeFunctionResult("token0", t0Raw)[0]
      );
      token1 = ethers.getAddress(
        ifacePair.decodeFunctionResult("token1", t1Raw)[0]
      );

      const decoded = ifacePair.decodeFunctionResult("getReserves", resRaw);
      reserve0 = decoded[0] as bigint;
      reserve1 = decoded[1] as bigint;
      blockTimestampLast = Number(decoded[2]);
    } catch (e) {
      continue;
    }

    // Drop pools that haven't updated in too long
    if (blockTimestampLast === 0 || blockTimestampLast < staleCutoff) {
      continue;
    }

    const key =
      token0.toLowerCase() < token1.toLowerCase()
        ? `${token0}-${token1}`
        : `${token1}-${token0}`;

    if (!pools.has(key)) {
      pools.set(key, {
        tokenA:
          token0.toLowerCase() < token1.toLowerCase() ? token0 : token1,
        tokenB:
          token0.toLowerCase() < token1.toLowerCase() ? token1 : token0,
        dexes: []
      });
    }

    const decimals = 18; // heuristic unless you add ERC20 decimals fetch
    const f0 = Number(reserve0) / 10 ** decimals;
    const f1 = Number(reserve1) / 10 ** decimals;

    const symbol0 = symbolFromKnown(token0);
    const symbol1 = symbolFromKnown(token1);

    const p0 = USD_MAP[symbol0] || 0;
    const p1 = USD_MAP[symbol1] || 0;

    const liqUsd = f0 * p0 + f1 * p1;
    if (liqUsd < SETTINGS.MIN_LIQ_USD) continue;

    // Price tokenA in terms of tokenB
    let priceAB: number;
    const tokenAIs0 = token0.toLowerCase() < token1.toLowerCase();

    if (tokenAIs0) {
      priceAB = f1 / f0;
    } else {
      priceAB = f0 / f1;
    }

    const pool = pools.get(key)!;
    pool.dexes.push({
      name: dex.name,
      router: dex.router,
      pair: pairAddr,
      reserveA: tokenAIs0 ? reserve0 : reserve1,
      reserveB: tokenAIs0 ? reserve1 : reserve0,
      price: priceAB,
      liquidityUsd: liqUsd,
      lastUpdate: blockTimestampLast
    });
  }

  return Array.from(pools.values());
}

function symbolFromKnown(addr: string): string {
  const m = addr.toLowerCase();
  if (m === "0xae13d989dac2f0debff460ac112a837c89baa7cd") return "WBNB";
  if (m === "0xed24fc36d5ee211ea25a80239fb8c4cfd80f12ee") return "BUSD";
  if (m === "0x7ef95a0fee0dd31b26940fdc1381e99bfbb1f0cd") return "USDT";
  if (m === "0xfa60d973f7642b748046464e165a65b7323b0dee") return "CAKE";
  return "UNKNOWN";
}
