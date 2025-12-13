// src/engine/index.ts

import dotenv from "dotenv";
dotenv.config();

import { JsonRpcProvider } from "ethers";
import { scanAllPools } from "./scanners/poolScanner";

// ----------------------------
// Env
// ----------------------------
const RPC_URL = process.env.VITE_RPC_URL;
const SCAN_INTERVAL = Number(process.env.VITE_SCAN_INTERVAL_MS || 5000);

if (!RPC_URL) {
    console.error("❌ VITE_RPC_URL not set");
    process.exit(1);
}

console.log("RPC Provider:", RPC_URL);

// ----------------------------
// SINGLE provider instance
// ----------------------------
const provider = new JsonRpcProvider(RPC_URL);

// Optional sanity check (once)
provider.getBlockNumber()
    .then(b => console.log("📡 Connected. Block:", b))
    .catch(err => {
        console.error("❌ RPC connection failed:", err.message);
        process.exit(1);
    });

// ----------------------------
// Scan loop
// ----------------------------
async function runScanLoop() {
    console.log("\n🔍 Starting Scan...");

    try {
        const pools = await scanAllPools(provider);

        if (!pools || pools.length === 0) {
            console.log("⚠ No pools found — retrying...");
            return;
        }

        console.log(`📦 Pools discovered: ${pools.length}`);
    } catch (err) {
        console.error("❌ Fatal scan error:", err);
    }
}

// ----------------------------
// Start
// ----------------------------
runScanLoop();
setInterval(runScanLoop, SCAN_INTERVAL);
