// src/engine/index.ts

import { ethers } from "ethers";
import { batchRpc } from "../utils/batchRpc";
import { scanAllPools } from "./poolScanner";
import { optimizePaths } from "./pathOptimizer";
import { findOpportunities } from "./opportunityFinder";

// -------------------------
// ENV + Provider
// -------------------------
const RPC_URL = process.env.RPC_URL || "https://bsc-dataseed.binance.org";
const provider = new ethers.JsonRpcProvider(RPC_URL);

// -------------------------
// SCAN CONFIG
// -------------------------
const SCAN_INTERVAL_MS = 6000; // Every 6 seconds
const BATCH_SIZE = 75;         // RPC batch size optimized for Ankr
const MIN_LIQ_USD = 20000;     // Pool liquidity filter
const ENABLE_TRI = true;       // Enable triangular arbitrage scanning

// Token list will be dynamically constructed from pools
let GLOBAL_TOKEN_LIST: string[] = [];

console.log("🚀 Arbitrage Engine Started");
console.log("RPC Provider:", RPC_URL);
console.log("----------------------------------------------");

async function runScanLoop() {
  while (true) {
    const scanStart = Date.now();

    try {
      console.log("\n\n🔍 Starting Scan...");

      // --------------------------------------------------------
      // STEP 1 — Fetch pools from all DEXes
      // --------------------------------------------------------
      const { pools, rpcCalls } = await scanAllPools(provider, MIN_LIQ_USD);
      console.log(`Found ${pools.length} deep pools`);

      // Save token list for triangular paths
      GLOBAL_TOKEN_LIST = Array.from(
        new Set(pools.flatMap(p => [p.tokenA, p.tokenB]))
      );
      console.log(`Token universe: ${GLOBAL_TOKEN_LIST.length} tokens`);

      // --------------------------------------------------------
      // STEP 2 — Perform batched RPC reserve fetches
      // --------------------------------------------------------
      console.log(`Performing ${rpcCalls.length} batched RPC calls...`);
      const rpcResults = await batchRpc(provider, rpcCalls, BATCH_SIZE);

      // Embed fresh reserves back into pool objects
      for (let i = 0; i < pools.length; i++) {
        const res = rpcResults[i];
        if (!res) continue;

        // getReserves() → returns { r0, r1 }
        const r0 = BigInt("0x" + res.slice(2, 66));
        const r1 = BigInt("0x" + res.slice(66, 130));

        pools[i].reserve0 = r0;
        pools[i].reserve1 = r1;
      }

      console.log("Reserves updated.");

      // --------------------------------------------------------
      // STEP 3 — Build multi-hop paths (optional)
      // --------------------------------------------------------
      let allPaths = [];

      if (ENABLE_TRI) {
        allPaths = optimizePaths(pools, GLOBAL_TOKEN_LIST);
        console.log(`Generated ${allPaths.length} candidate pathways`);
      }

      // --------------------------------------------------------
      // STEP 4 — Find arbitrage opportunities
      // --------------------------------------------------------
      const opps = findOpportunities(pools, allPaths);

      console.log(`🟢 Opportunities found: ${opps.length}`);

      for (const opp of opps) {
        console.log(
          `💰 ${opp.type.toUpperCase()} | ${opp.tokenA}/${opp.tokenB} | ${opp.profitPct.toFixed(
            3
          )}% | via ${opp.path.join(" → ")}`
        );
      }

      const elapsed = (Date.now() - scanStart) / 1000;
      console.log(`⏱ Scan completed in ${elapsed.toFixed(2)} seconds`);

    } catch (err) {
      console.error("❌ Scan error:", err);
    }

    await sleep(SCAN_INTERVAL_MS);
  }
}

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

runScanLoop();
