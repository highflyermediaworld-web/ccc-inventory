import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { storage } from "./storage";
import { parseCookieHeader, SESSION_COOKIE } from "./auth";

const clients = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

export function attachRealtime(httpServer: Server) {
  if (wss) return;
  // Don't auto-attach: verify sessions before accepting the upgrade so the
  // socket never escapes unauthenticated.
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    const url = req.url || "";
    if (!url.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    try {
      const cookies = parseCookieHeader(req.headers.cookie);
      const token = cookies[SESSION_COOKIE];
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const session = await storage.getSession(token);
      if (!session || session.expiresAt < Math.floor(Date.now() / 1000)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss!.handleUpgrade(req, socket as any, head, (ws) => {
        wss!.emit("connection", ws, req);
      });
    } catch {
      try {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      } catch {}
    }
  });

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
