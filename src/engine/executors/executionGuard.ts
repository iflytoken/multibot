// src/engine/executors/executionGuard.ts

/**
 * ExecutionGuard:
 *  - Tracks DEX/pair/router failures
 *  - Blacklists repeated failures
 *  - Classifies execution errors
 */

export interface GuardRecord {
  failures: number;
  lastFailure: number;
}

const FAILURE_LIMIT = 3;          // after 3 failures → temporarily blacklist
const BLACKLIST_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const routerBlacklist: Map<string, GuardRecord> = new Map();

export function classifyError(err: any): string {
  const msg = String(err?.message || "").toLowerCase();

  if (msg.includes("insufficient liquidity")) return "NO_LIQUIDITY";
  if (msg.includes("execution reverted")) return "REVERT";
  if (msg.includes("nonce")) return "NONCE_ERROR";
  if (msg.includes("underpriced")) return "REPLACEMENT_UNDERPRICED";
  if (msg.includes("rate limit")) return "RATE_LIMIT";
  if (msg.includes("intrinsic gas")) return "OUT_OF_GAS";
  return "UNKNOWN";
}

export function shouldBlockRouter(router: string): boolean {
  const rec = routerBlacklist.get(router.toLowerCase());
  if (!rec) return false;

  const elapsed = Date.now() - rec.lastFailure;

  // Expire blacklist after recovery window
  if (elapsed > BLACKLIST_WINDOW_MS) {
    routerBlacklist.delete(router.toLowerCase());
    return false;
  }

  return rec.failures >= FAILURE_LIMIT;
}

export function recordRouterFailure(router: string) {
  const key = router.toLowerCase();
  const rec = routerBlacklist.get(key);

  if (!rec) {
    routerBlacklist.set(key, { failures: 1, lastFailure: Date.now() });
    return;
  }

  rec.failures += 1;
  rec.lastFailure = Date.now();
}
