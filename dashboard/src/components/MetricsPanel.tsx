import React from "react";
import type { MetricsState } from "../hooks/useDashboardSocket";

interface Props {
  metrics: MetricsState;
}

export const MetricsPanel: React.FC<Props> = ({ metrics }) => {
  return (
    <div className="bg-dark-800 border border-dark-700 rounded-2xl p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Engine Metrics</h2>
        <span className="text-xs text-slate-400">
          Scans: {metrics.scanCount}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
        <MetricTile
          label="Total Opportunities"
          value={metrics.totalOppsFound}
        />
        <MetricTile
          label="Direct Opps"
          value={metrics.totalDirectOpps}
        />
        <MetricTile
          label="Triangular Opps"
          value={metrics.totalTriOpps}
        />
        <MetricTile
          label="Last Scan (ms)"
          value={metrics.lastScanDurationMs.toFixed(0)}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <MetricTile
          label="Exec Attempted"
          value={metrics.executionsAttempted}
        />
        <MetricTile
          label="Exec Succeeded"
          value={metrics.executionsSucceeded}
        />
        <MetricTile
          label="Exec Failed"
          value={metrics.executionsFailed}
        />
        <MetricTile
          label="Net Profit (USD)"
          value={"$" + metrics.estimatedNetProfitUsd.toFixed(4)}
        />
      </div>

      <div className="mt-4 text-xs text-slate-400 space-y-1">
        <div>
          Skipped (Validation): {metrics.skippedValidation} | Gas:{" "}
          {metrics.skippedGas} | FinalCheck: {metrics.skippedFinalCheck}
        </div>
        {metrics.lastErrorCategory && (
          <div>Last error: {metrics.lastErrorCategory}</div>
        )}
      </div>
    </div>
  );
};

const MetricTile: React.FC<{ label: string; value: string | number }> = ({
  label,
  value
}) => (
  <div className="bg-dark-900 rounded-xl px-3 py-2 border border-dark-700 flex flex-col">
    <span className="text-[0.7rem] uppercase tracking-wide text-slate-400">
      {label}
    </span>
    <span className="text-base font-semibold mt-1">{value}</span>
  </div>
);
