// src/engine/scanners/poolScanner.ts

import type { Provider } from "ethers";
import { Interface } from "ethers";
import { PANCAKE_FACTORY } from "../config/routers";
import { getTokensHybrid, TokenConfig } from "../config/tokens";
import { batchRpc } from "../../utils/batchRpc";

const iface = new Interface([
    "function getPair(address,address) external view returns (address)",
    "function getReserves() external view returns (uint112,uint112,uint32)"
]);

export async function scanAllPools(provider: Provider) {
    console.log("🔎 Scanning PancakeSwap V2…");

    const rpcUrl = process.env.VITE_RPC_URL;
    if (!rpcUrl) {
        console.error("❌ Missing RPC URL");
        return [];
    }

    const tokens: TokenConfig[] = getTokensHybrid();
    const pairs: {
        tokenA: TokenConfig;
        tokenB: TokenConfig;
        pair: string;
    }[] = [];

    // -------------------------------
    // 1) DISCOVER PAIRS
    // -------------------------------
    for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
            const A = tokens[i];
            const B = tokens[j];

            console.log(`🔍 Checking pair ${A.symbol}/${B.symbol}`);

            const calldata = iface.encodeFunctionData("getPair", [
                A.address,
                B.address
            ]);

            let raw: string;
            try {
                raw = await provider.call({
                    to: PANCAKE_FACTORY,
                    data: calldata
                });
            } catch {
                console.log(`⚠ Skipping ${A.symbol}/${B.symbol} — getPair failed`);
                continue;
            }

            const decoded = iface.decodeFunctionResult("getPair", raw)[0] as string;

            if (decoded === "0x0000000000000000000000000000000000000000") {
                console.log(`⚠ No pair ${A.symbol}/${B.symbol}`);
                continue;
            }

            const pairAddress = decoded.toLowerCase();

            console.log(`✔ FOUND PAIR: ${A.symbol}/${B.symbol} → ${pairAddress}`);
            pairs.push({ tokenA: A, tokenB: B, pair: pairAddress });
        }
    }

    if (pairs.length === 0) {
        console.log("⚠ No valid pools discovered.");
        return [];
    }

    console.log(`🎯 Found ${pairs.length} valid pairs.`);
    console.log("Fetching reserves...");

    // -------------------------------
    // 2) BATCH RESERVES CALL
    // -------------------------------
    const calls = pairs.map((p) => ({
        to: p.pair,
        data: iface.encodeFunctionData("getReserves")
    }));

    let results: string[];

    try {
        results = await batchRpc(provider, calls, 20);

    } catch (err) {
        console.error("❌ batchRpc failed:", err);
        return [];
    }

    if (!Array.isArray(results)) {
        console.error("❌ batchRpc returned invalid result", results);
        return [];
    }

    if (results.length !== pairs.length) {
        console.warn("⚠ Mismatched results count", {
            results: results.length,
            pairs: pairs.length
        });
    }

    // -------------------------------
    // 3) PARSE RESERVES
    // -------------------------------
    const pools: {
        tokenA: TokenConfig;
        tokenB: TokenConfig;
        pair: string;
        reserve0: bigint;
        reserve1: bigint;
    }[] = [];

    for (let i = 0; i < results.length; i++) {
        const raw = results[i];

        if (!raw || raw === "0x") {
            console.log(`⚠ No reserves for ${pairs[i].pair}`);
            continue;
        }

        try {
            const decoded = iface.decodeFunctionResult("getReserves", raw);
            pools.push({
                tokenA: pairs[i].tokenA,
                tokenB: pairs[i].tokenB,
                pair: pairs[i].pair,
                reserve0: decoded[0],
                reserve1: decoded[1]
            });
        } catch {
            console.log(`⚠ Could not decode reserves for ${pairs[i].pair}`);
        }
    }

    return pools;
}
