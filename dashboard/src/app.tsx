import React from "react";
import { useDashboardSocket } from "./hooks/useDashboardSocket";
import { MetricsPanel } from "./components/MetricsPanel";
import { LogsPanel } from "./components/LogsPanel";
import { OpportunitiesTable } from "./components/OpportunitiesTable";
import { ExecutionFeed } from "./components/ExecutionFeed";

const App: React.FC = () => {
  const {
    metrics,
    logs,
    opportunities,
    executions,
    socketStatus
  } = useDashboardSocket("ws://localhost:8080");

  return (
    <div className="min-h-screen bg-dark-900 text-slate-100">
      <header className="border-b border-dark-700 bg-dark-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-wide">
            FlashArb Engine Dashboard
          </h1>
          <p className="text-xs text-slate-400">
            Real-time monitoring for your BSC arbitrage engine
          </p>
        </div>
        <div
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            socketStatus === "open"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
              : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
          }`}
        >
          WS: {socketStatus.toUpperCase()}
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <MetricsPanel metrics={metrics} />
          </div>
          <div className="lg:col-span-1">
            <ExecutionFeed executions={executions} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <OpportunitiesTable opportunities={opportunities} />
          </div>
          <div className="lg:col-span-1">
            <LogsPanel logs={logs} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
