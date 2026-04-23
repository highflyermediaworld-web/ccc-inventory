import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

const clients = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

export function attachRealtime(httpServer: Server) {
  if (wss) return;
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => {
      try { ws.close(); } catch {}
      clients.delete(ws);
    });
    // Send a small hello so clients know we're live
    try {
      ws.send(JSON.stringify({ type: "hello", payload: { ts: Date.now() } }));
    } catch {}
  });
}

export function broadcast(event: { type: string; payload: any }) {
  const msg = JSON.stringify(event);
  clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(msg); } catch {}
    }
  });
}
