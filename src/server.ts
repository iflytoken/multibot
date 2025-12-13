// src/server.ts
//
// Lightweight WebSocket server that broadcasts:
//   - metrics snapshots
//   - log messages
//   - detected opportunities
//   - execution events
//
// React UI connects to ws://localhost:8080
//

import { WebSocketServer } from "ws";

// -----------------------------
// WebSocket Server Setup
// -----------------------------
const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`🔌 WebSocket server running on ws://localhost:${PORT}`);

// Track connected clients
let clients: Set<any> = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("🟢 Dashboard connected.");

  ws.on("close", () => {
    clients.delete(ws);
    console.log("🔴 Dashboard disconnected.");
  });

  ws.send(JSON.stringify({ type: "welcome", data: "Dashboard connected" }));
});

// -----------------------------
// Broadcast Helper
// -----------------------------
export function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data });

  for (const client of clients) {
    try {
      client.send(message);
    } catch (e) {
      console.log("⚠️ Failed to send WS message:", e);
    }
  }
}

// -----------------------------
// Heartbeat (optional)
// -----------------------------
setInterval(() => {
  broadcast("heartbeat", { ts: Date.now() });
}, 5000);

export default wss;
