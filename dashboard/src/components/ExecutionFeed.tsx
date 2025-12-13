import React from "react";
import type { ExecutionEvent } from "../hooks/useDashboardSocket";

interface Props {
  executions: ExecutionEvent[];
}

export const ExecutionFeed: React.FC<Props> = ({ executions }) => {
  return (
    <div className="bg-dark-800 border border-dark-700 rounded-2xl p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Execution Feed</h2>
        <span className="text-xs text-slate-400">
          Recent: {executions.length}
        </span>
      </div>
      <div className="space-y-2 text-xs">
        {executions.length === 0 && (
          <div className="text-slate-500 italic">
            No executions yet. When your engine sends txs, they’ll show here.
          </div>
        )}
        {executions.map((ex, idx) => (
          <div
            key={idx}
            className={`rounded-xl px-3 py-2 border ${
              ex.status === "success"
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-rose-500/40 bg-rose-500/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold capitalize">{ex.status}</span>
              <span className="text-[0.7rem] text-slate-400">
                {ex.timestamp
                  ? new Date(ex.timestamp).toLocaleTimeString()
                  : ""}
              </span>
            </div>
            {ex.tx && (
              <div className="mt-1 break-all text-[0.7rem]">
                Tx: <span className="text-slate-200">{ex.tx}</span>
              </div>
            )}
            {ex.reason && (
              <div className="mt-1 text-[0.7rem] text-slate-200">
                Reason: {ex.reason}
              </div>
            )}
            {ex.profit != null && (
              <div className="mt-1 text-[0.7rem] text-emerald-300">
                Profit: ${ex.profit.toFixed?.(4) ?? ex.profit}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
