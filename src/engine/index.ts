// src/engine/index.ts

import { ethers } from "ethers";
import { batchRpc } from "../utils/batchRpc";
import { scanAllPools } from "./poolScanner";
import { optimizePaths } from "./pathOptimizer";
import { findOpportunities } from "./opportunityFinder";

// Step 5–6: execution
import {
  buildArbPlanForOpportunity
} from "./executors/executorBridge";
import {
  executeBestOpportunity
} from "./executors/txExecutor";

// Step 6.5: metrics
import { Metrics } from "./metrics";

// -------------------------
// ENV + Provider
// -------------------------
const RPC_URL = process.env.RPC_URL || "https://bsc-dataseed.binance.org";
const provider = new ethers.JsonRpcProvider(RPC_URL);

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const ARB_CONTRACT = process.env.ARB_CONTRACT || "";
const BENEFICIARY = process.env.BENEFICIARY || "";

const ENABLE_EXECUTION =
  (process.env.ENABLE_EXECUTION || "false").toLowerCase() === "true";

if (!ENABLE_EXECUTION) {
  console.log("⚠️  EXECUTION DISABLED — running in scan-only mode");
} else {
  console.log("🔥 EXECUTION ENABLED — bot will send real transactions");
}

// -------------------------
// SCAN CONFIG
// -------------------------
const SCAN_INTERVAL_MS = 6000; // Every 6 seconds
const BATCH_SIZE = 75;
const MIN_LIQ_USD = 20000;
const ENABLE_TRI = true;

// Loan + Profit settings
const LOAN_AMOUNT = 0.05 * 1e18;    // 0.05 unit
const MIN_PROFIT = 0.002 * 1e18;    // 0.002 unit

let GLOBAL_TOKEN_LIST: string[] = [];

console.log("🚀 Arbitrage Engine Started");
console.log("RPC Provider:", RPC_URL);
console.log("----------------------------------------------");

async function runScanLoop() {
  while (true) {
    const scanStart = Date.now();

    try {
      console.log("\n\n🔍 Starting Scan...");

      // STEP 1 — Fetch pools
      const { pools, rpcCalls } = await scanAllPools(provider, MIN_LIQ_USD);
      console.log(`Found ${pools.length} deep pools`);

      GLOBAL_TOKEN_LIST = Array.from(
        new Set(pools.flatMap(p => [p.tokenA, p.tokenB]))
      );
      console.log(`Token universe: ${GLOBAL_TOKEN_LIST.length} tokens`);

      // STEP 2 — Batched reserves
      console.log(`Performing ${rpcCalls.length} batched RPC calls...`);
      const rpcResults = await batchRpc(provider, rpcCalls, BATCH_SIZE);

      for (let i = 0; i < pools.length; i++) {
        const res = rpcResults[i];
        if (!res) continue;

        const r0 = BigInt("0x" + res.slice(2, 66));
        const r1 = BigInt("0x" + res.slice(66, 130));

        pools[i].reserve0 = r0;
        pools[i].reserve1 = r1;
      }

      console.log("Reserves updated.");

      // STEP 3 — Multi-hop paths
      let allPaths: any[] = [];
      if (ENABLE_TRI) {
        allPaths = optimizePaths(pools, GLOBAL_TOKEN_LIST);
        console.log(`Generated ${allPaths.length} candidate pathways`);
      }

      // STEP 4 — Opportunities
      const opps = findOpportunities(pools, allPaths);
      console.log(`🟢 Opportunities found: ${opps.length}`);

      const directCount = opps.filter((o: any) => o.type === "DIRECT").length;
      const triCount = opps.filter((o: any) => o.type === "TRIANGULAR").length;

      for (const opp of opps) {
        console.log(
          `💰 ${opp.type.toUpperCase()} | ${opp.tokenA}/${opp.tokenB} | ${opp.profitPct.toFixed(
            3
          )}% | via ${opp.path.join(" → ")}`
        );
      }

      const elapsedMs = Date.now() - scanStart;
      const elapsedSec = elapsedMs / 1000;
      console.log(`⏱ Scan completed in ${elapsedSec.toFixed(2)} seconds`);

      // METRICS: record scan stats
      Metrics.recordScan({
        durationMs: elapsedMs,
        oppsTotal: opps.length,
        directOpps: directCount,
        triOpps: triCount
      });

      // STEP 5 — Execute best opp (if enabled)
      if (ENABLE_EXECUTION && opps.length > 0) {
        console.log("⚡ Attempting execution of best opportunity...");
        await executeBestOpportunity(
          opps,
          RPC_URL,
          PRIVATE_KEY,
          ARB_CONTRACT,
          BigInt(LOAN_AMOUNT),
          BigInt(MIN_PROFIT),
          BENEFICIARY,
          buildArbPlanForOpportunity
        );
      }

      // METRICS: print summary line
      Metrics.logSummary();

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

