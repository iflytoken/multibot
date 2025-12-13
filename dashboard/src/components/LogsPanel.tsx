import React from "react";
import type { LogEntry } from "../hooks/useDashboardSocket";

interface Props {
  logs: LogEntry[];
}

export const LogsPanel: React.FC<Props> = ({ logs }) => {
  return (
    <div className="bg-dark-800 border border-dark-700 rounded-2xl p-4 h-[320px] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Live Logs</h2>
        <span className="text-xs text-slate-400">
          Showing last {logs.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto text-xs font-mono space-y-1 pr-1">
        {logs.length === 0 && (
          <div className="text-slate-500 italic">Waiting for log events…</div>
        )}
        {logs.map((log, idx) => (
          <div key={idx} className="text-slate-300">
            <span className="text-slate-500 mr-2">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            {log.msg}
          </div>
        ))}
      </div>
    </div>
  );
};
