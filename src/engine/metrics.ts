// src/engine/metrics.ts

/**
 * Simple in-memory metrics store for the arbitrage engine.
 * Tracks:
 *  - scan counts
 *  - opportunity counts
 *  - execution attempts, successes, failures
 *  - skip reasons (validation, gas, final check)
 *  - rough net profit estimate (USD)
 */

export type ExecutionSkipReason = "VALIDATION" | "GAS" | "FINAL_CHECK";

export interface MetricsState {
  scanCount: number;
  lastScanDurationMs: number;

  totalOppsFound: number;
  totalDirectOpps: number;
  totalTriOpps: number;

  executionsAttempted: number;
  executionsSucceeded: number;
  executionsFailed: number;

  skippedValidation: number;
  skippedGas: number;
  skippedFinalCheck: number;

  lastErrorCategory?: string;

  estimatedNetProfitUsd: number;
}

const state: MetricsState = {
  scanCount: 0,
  lastScanDurationMs: 0,

  totalOppsFound: 0,
  totalDirectOpps: 0,
  totalTriOpps: 0,

  executionsAttempted: 0,
  executionsSucceeded: 0,
  executionsFailed: 0,

  skippedValidation: 0,
  skippedGas: 0,
  skippedFinalCheck: 0,

  lastErrorCategory: undefined,

  estimatedNetProfitUsd: 0
};

export const Metrics = {
  recordScan: (params: {
    durationMs: number;
    oppsTotal: number;
    directOpps: number;
    triOpps: number;
  }) => {
    state.scanCount += 1;
    state.lastScanDurationMs = params.durationMs;
    state.totalOppsFound += params.oppsTotal;
    state.totalDirectOpps += params.directOpps;
    state.totalTriOpps += params.triOpps;
  },

  recordExecutionAttempt: () => {
    state.executionsAttempted += 1;
  },

  recordExecutionSuccess: (netProfitUsd: number) => {
    state.executionsSucceeded += 1;
    state.estimatedNetProfitUsd += netProfitUsd;
  },

  recordExecutionFailure: (errorCategory?: string) => {
    state.executionsFailed += 1;
    if (errorCategory) {
      state.lastErrorCategory = errorCategory;
    }
  },

  recordExecutionSkip: (reason: ExecutionSkipReason) => {
    switch (reason) {
      case "VALIDATION":
        state.skippedValidation += 1;
        break;
      case "GAS":
        state.skippedGas += 1;
        break;
      case "FINAL_CHECK":
        state.skippedFinalCheck += 1;
        break;
    }
  },

  getSnapshot: (): MetricsState => {
    return { ...state };
  },

  logSummary: () => {
    const s = state;
    console.log(
      [
        "📊 METRICS SUMMARY",
        `Scans=${s.scanCount}`,
        `LastScan=${s.lastScanDurationMs.toFixed(0)}ms`,
        `Opps: total=${s.totalOppsFound}, direct=${s.totalDirectOpps}, tri=${s.totalTriOpps}`,
        `Exec: attempted=${s.executionsAttempted}, ok=${s.executionsSucceeded}, fail=${s.executionsFailed}`,
        `Skipped: validation=${s.skippedValidation}, gas=${s.skippedGas}, finalCheck=${s.skippedFinalCheck}`,
        `NetProfit≈$${s.estimatedNetProfitUsd.toFixed(4)}`,
        s.lastErrorCategory ? `LastError=${s.lastErrorCategory}` : ""
      ].join(" | ")
    );
  }
};
