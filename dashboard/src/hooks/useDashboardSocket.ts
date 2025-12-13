import { useEffect, useRef, useState } from "react";

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

export interface LogEntry {
  timestamp: number;
  msg: string;
}

export interface Opportunity {
  type: "DIRECT" | "TRIANGULAR" | string;
  tokenA: string;
  tokenB: string;
  profitPct: number;
  path: string[];
}

export interface ExecutionEvent {
  status: "success" | "failed";
  tx?: string;
  reason?: string;
  timestamp?: number;
  profit?: number;
}

type SocketStatus = "connecting" | "open" | "closed";

const defaultMetrics: MetricsState = {
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

export function useDashboardSocket(url: string) {
  const [metrics, setMetrics] = useState<MetricsState>(defaultMetrics);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [executions, setExecutions] = useState<ExecutionEvent[]>([]);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<number | null>(null);

  useEffect(() => {
    function connect() {
      setSocketStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setSocketStatus("open");
      };

      ws.onclose = () => {
        setSocketStatus("closed");

        // auto-reconnect
        if (reconnectTimeout.current) {
          window.clearTimeout(reconnectTimeout.current);
        }
        reconnectTimeout.current = window.setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const { type, data } = parsed;

          switch (type) {
            case "log":
              if (data?.msg) {
                setLogs((prev) => {
                  const next = [
                    {
                      timestamp: data.timestamp ?? Date.now(),
                      msg: data.msg
                    } as LogEntry,
                    ...prev
                  ];
                  return next.slice(0, 200); // cap log length
                });
              }
              break;

            case "metrics":
              setMetrics((prev) => ({ ...prev, ...data }));
              break;

            case "opportunities":
              if (Array.isArray(data)) {
                setOpportunities(data);
              }
              break;

            case "execution":
              setExecutions((prev) => [
                {
                  status: data.status,
                  tx: data.tx,
                  reason: data.reason,
                  timestamp: data.timestamp ?? Date.now(),
                  profit: data.profit
                },
                ...prev
              ].slice(0, 100));
              break;

            default:
              break;
          }
        } catch (e) {
          console.warn("WS message parse error:", e);
        }
      };
    }

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeout.current) {
        window.clearTimeout(reconnectTimeout.current);
      }
    };
  }, [url]);

  return {
    metrics,
    logs,
    opportunities,
    executions,
    socketStatus
  };
}
