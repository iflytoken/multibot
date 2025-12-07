import { ethers } from "ethers";
import { ROUTERS } from "../../config/routers";
import { SETTINGS } from "../../config/settings";
import { FACTORY_ABI, PAIR_ABI, ROUTER_ABI } from "../../constants";
import { batchRpc } from "../../utils/batchRpc";  // will be added in Step 3

/**
 * Pool Data Format returned to opportunity engine
 */
export interface PoolInfo {
  tokenA: string;
  tokenB: string;
  dexes: Array<{
    name: string;
    router: string;
    pair: string;
    reserveA: bigint;
    reserveB: bigint;
    price: number;         // A priced in B
    liquidityUsd: number;
  }>;
}


/**
 * Discover all pairs across all DEX factories
 * (Based on Polybot approach)
 */
export async function loadAllPairs(provider: ethers.Provider) {
  const results = [];
  const factories = [];

  // Step 1 — discover factories
  for (const r of ROUTERS) {
    try {
      const router = new ethers.Contract(r.address, ROUTER_ABI, provider);
      const factory = await router.factory();

      factories.push({
        name: r.name,
        router: r.address,
        factory
      });

    } catch (err) {
      console.warn(`RouterDiscovery: failed ${r.name}: ${err}`);
    }
  }

  // Step 2 — Enumerate all pairs
  for (const dex of factories) {
    try {
      const factory = new ethers.Contract(dex.factory, FACTORY_ABI, provider);
      const totalPairs = await factory.allPairsLength();

      for (let i = 0n; i < totalPairs; i++) {
        const pairAddr = await factory.allPairs(i);

        results.push({
          dex,
          pairAddr
        });
      }

    } catch (err) {
      console.warn(`PairEnum: Failed on ${dex.name}: ${err}`);
      continue;
    }
  }

  return results;
}



/**
 * Fetch reserves, pricing, liquidity for each pair across all routers.
 * Uses batch RPC (from MEV bot pattern) for efficiency.
 */
export async function scanPools(provider: ethers.Provider) {
  const rawPairs = await loadAllPairs(provider);

  // Prepare RPC batch calls to fetch token0/token1 of each pair
  const calls = rawPairs.map(p => ({
    to: p.pairAddr,
    data: new ethers.Interface(PAIR_ABI).encodeFunctionData("token0", [])
  }));

  const callsToken1 = rawPairs.map(p => ({
    to: p.pairAddr,
    data: new ethers.Interface(PAIR_ABI).encodeFunctionData("token1", [])
  }));

  // Step 1 — Get token0/token1 for all pairs
  const token0Results = await batchRpc(provider, calls, SETTINGS.RPC_BATCH);
  const token1Results = await batchRpc(provider, callsToken1, SETTINGS.RPC_BATCH);

  const pools = new Map<string, PoolInfo>();

  // Step 2 — Fetch reserves
  const reserveCalls = rawPairs.map((p, i) => ({
    to: p.pairAddr,
    data: new ethers.Interface(PAIR_ABI).encodeFunctionData("getReserves", [])
  }));

  const reserveResults = await batchRpc(provider, reserveCalls, SETTINGS.RPC_BATCH);

  // Constants for liquidity estimation
  const USD_MAP = {
    "WBNB": 580,
    "BUSD": 1,
    "USDT": 1,
    "USDC": 1,
    "CAKE": 3,
    "ETH": 3400,
    "BTCB": 65000
  };

  // Step 3 — Normalize + combine into PoolInfo objects
  for (let i = 0; i < rawPairs.length; i++) {
    const { dex, pairAddr } = rawPairs[i];
    const token0 = ethers.getAddress(ethers.decodeBytes(token0Results[i])[0]);
    const token1 = ethers.getAddress(ethers.decodeBytes(token1Results[i])[0]);

    const [reserve0, reserve1] = ethers.decodeBytes(reserveResults[i]);

    const key = token0 < token1
      ? `${token0}-${token1}`
      : `${token1}-${token0}`;

    if (!pools.has(key)) {
      pools.set(key, {
        tokenA: token0 < token1 ? token0 : token1,
        tokenB: token0 < token1 ? token1 : token0,
        dexes: []
      });
    }

    // Compute liquidity (rough USD estimate)
    const r0 = BigInt(reserve0);
    const r1 = BigInt(reserve1);

    // crude heuristic: select symbol by well-known token addresses
    const decimals = 18;
    const float0 = Number(r0) / 10 ** decimals;
    const float1 = Number(r1) / 10 ** decimals;

    const symbol0 = symbolFromKnown(token0);
    const symbol1 = symbolFromKnown(token1);

    const price0 = USD_MAP[symbol0] || 0;
    const price1 = USD_MAP[symbol1] || 0;

    const liqUsd = float0 * price0 + float1 * price1;

    // Skip low-liquidity pairs
    if (liqUsd < SETTINGS.MIN_LIQ_USD) continue;

    // Compute price of tokenA in tokenB terms:
    let priceAB = float1 / float0;
    if (token0 > token1) {
      // tokens flipped
      priceAB = float0 / float1;
    }

    pools.get(key).dexes.push({
      name: dex.name,
      router: dex.router,
      pair: pairAddr,
      reserveA: token0 < token1 ? r0 : r1,
      reserveB: token0 < token1 ? r1 : r0,
      price: priceAB,
      liquidityUsd: liqUsd
    });
  }

  // Convert Map → Array
  return Array.from(pools.values());
}


/**
 * Attempt to identify token symbols (used for liquidity est.)
 * This mimics Polybot’s approach: map well-known addresses.
 */
function symbolFromKnown(addr: string): string {
  const m = addr.toLowerCase();
  if (m === "0xae13d989dac2f0debff460ac112a837c89baa7cd") return "WBNB"; // BSC testnet WBNB
  if (m === "0xed24fc36d5ee211ea25a80239fb8c4cfd80f12ee") return "BUSD";
  if (m === "0x7ef95a0fee0dd31b26940fdc1381e99bfbb1f0cd") return "USDT";
  if (m === "0xfa60d973f7642b748046464e165a65b7323b0dee") return "CAKE";
  return "UNKNOWN";
}

