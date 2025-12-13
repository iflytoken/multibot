// src/utils/batchRpc.ts

import { JsonRpcProvider } from "ethers";

export interface RpcCall {
    to: string;
    data: string;
}

/**
 * Safe pseudo-batching for BSC-compatible RPCs.
 * Executes eth_call in controlled parallel chunks.
 */
export async function batchRpc(
    provider: JsonRpcProvider,
    calls: RpcCall[],
    batchSize = 20
): Promise<string[]> {

    const results: string[] = [];

    for (let i = 0; i < calls.length; i += batchSize) {
        const chunk = calls.slice(i, i + batchSize);

        const chunkResults = await Promise.allSettled(
            chunk.map(async (call) => {
                try {
                    return await provider.call({
                        to: call.to,
                        data: call.data
                    });
                } catch (err) {
                    console.warn("⚠ eth_call failed:", {
                        to: call.to,
                        error: (err as Error).message
                    });
                    return "0x";
                }
            })
        );

        for (const r of chunkResults) {
            if (r.status === "fulfilled") {
                results.push(r.value);
            } else {
                results.push("0x");
            }
        }
    }

    return results;
}
