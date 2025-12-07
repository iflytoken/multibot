// src/utils/batchRpc.ts

import { ethers } from "ethers";

/**
 * Batch RPC engine with:
 *  - request chunking
 *  - retry logic
 *  - jitter backoff
 *  - tolerance for rate-limit errors
 *
 * @param provider    ethers.Provider (JsonRpcProvider)
 * @param calls       array of: { to: string, data: string }
 * @param batchSize   number of calls per batch
 * @returns decoded result buffers[] (raw hex return data)
 */
export async function batchRpc(
  provider: ethers.Provider,
  calls: Array<{ to: string; data: string }>,
  batchSize: number = 50
): Promise<(string | null)[]> {
  const results: (string | null)[] = new Array(calls.length).fill(null);

  // Split calls into batches
  const batches: Array<Array<{ to: string; data: string; index: number }>> = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const chunk = calls.slice(i, i + batchSize).map((c, idx) => ({
      ...c,
      index: i + idx
    }));
    batches.push(chunk);
  }

  // Process all batches sequentially to avoid overwhelming RPC
  for (const batch of batches) {
    const batchPayload = batch.map((c, i) => ({
      jsonrpc: "2.0",
      id: i + 1,
      method: "eth_call",
      params: [
        { to: c.to, data: c.data },
        "latest"
      ]
    }));

    const MAX_RETRIES = 5;
    const BASE_DELAY = 150; // ms

    let attempt = 0;
    let ok = false;

    while (!ok && attempt < MAX_RETRIES) {
      try {
        const response = await (provider as any).send("rpc.batch", batchPayload);

        for (let i = 0; i < response.length; i++) {
          const item = response[i];
          const targetIndex = batch[i].index;

          if (item && item.result) {
            results[targetIndex] = item.result;
          } else {
            results[targetIndex] = null;
          }
        }

        ok = true;

      } catch (err: any) {
        attempt++;

        const isRateLimit =
          err.message?.includes("rate limit") ||
          err.code === -32005 ||
          err.code === -32000;

        if (isRateLimit) {
          const delay = BASE_DELAY * (1 + Math.random()) * attempt;
          console.warn(
            `[batchRpc] Rate limit hit. Retrying ${attempt}/${MAX_RETRIES} after ${delay.toFixed(
              0
            )}ms`
          );
          await sleep(delay);
        } else {
          console.error("[batchRpc] Unexpected RPC error:", err);
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Utility sleep function for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

