import { useEffect, useSyncExternalStore } from "react";
import { queryClient } from "./queryClient";
import type { Inventory } from "@shared/schema";

type Event = { type: string; payload: any };

// Track cells currently being edited; while a field is being edited locally,
// we skip overwriting its value from inbound WS updates.
const editingKeys = new Set<string>(); // `${rowId}::${field}`
export function markEditing(rowId: string, field: string, on: boolean) {
  const k = `${rowId}::${field}`;
  if (on) editingKeys.add(k);
  else editingKeys.delete(k);
}
function isEditing(rowId: string, field: string) {
  return editingKeys.has(`${rowId}::${field}`);
}

function mergeRespectingEdits(prev: Inventory | undefined, next: Inventory): Inventory {
  if (!prev) return next;
  const merged: any = { ...next };
  for (const key of Object.keys(next)) {
    if (isEditing(next.id, key)) {
      // Preserve the user's in-progress value
      merged[key] = (prev as any)[key];
    }
  }
  return merged as Inventory;
}

function applyInventoryUpdate(payload: Inventory) {
  // Update the list
  queryClient.setQueryData<Inventory[] | undefined>(["/api/inventory"], (old) => {
    if (!old) return old;
    const idx = old.findIndex((i) => i.id === payload.id);
    if (idx === -1) return [...old, payload];
    const next = old.slice();
    next[idx] = mergeRespectingEdits(old[idx], payload);
    return next;
  });
  // Update the single-item cache if present
  queryClient.setQueryData<Inventory | undefined>(
    ["/api/inventory", payload.id],
    (old) => mergeRespectingEdits(old, payload)
  );
}

function applyInventoryCreate(payload: Inventory) {
  queryClient.setQueryData<Inventory[] | undefined>(["/api/inventory"], (old) => {
    if (!old) return [payload];
    if (old.some((i) => i.id === payload.id)) return old;
    return [...old, payload];
  });
  queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
}

function applyInventoryDelete(id: string) {
  queryClient.setQueryData<Inventory[] | undefined>(["/api/inventory"], (old) =>
    old ? old.filter((i) => i.id !== id) : old
  );
}

function handleEvent(evt: Event) {
  switch (evt.type) {
    case "inventory:update":
      if (evt.payload?.id) applyInventoryUpdate(evt.payload);
      break;
    case "inventory:create":
      if (evt.payload?.id) applyInventoryCreate(evt.payload);
      break;
    case "inventory:delete":
      if (evt.payload?.id) applyInventoryDelete(evt.payload.id);
      break;
    case "inventory:bulk":
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      break;
    case "transactions:update":
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-stats"] });
      break;
    case "listings:update":
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      break;
    case "trades:update":
    case "trades:delete":
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      break;
    case "customerRequest:new":
    case "customerRequest:update":
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      break;
    case "shows:update":
      queryClient.invalidateQueries({ queryKey: ["/api/shop/shows"] });
      break;
    case "live:update":
      queryClient.invalidateQueries({ queryKey: ["/api/live"] });
      break;
    default:
      break;
  }
}

// ====== Singleton socket with exponential-backoff reconnect ======

type Status = "connecting" | "open" | "closed";
let status: Status = "closed";
let socket: WebSocket | null = null;
let backoffMs = 1000;
const BACKOFF_CAP = 30_000;
let reconnectTimer: number | null = null;
let started = false;

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}
function setStatus(s: Status) {
  if (status === s) return;
  status = s;
  notify();
}

function wsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

function connect() {
  if (typeof window === "undefined") return;
  setStatus("connecting");
  try {
    socket = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  socket.addEventListener("open", () => {
    backoffMs = 1000;
    setStatus("open");
  });
  socket.addEventListener("message", (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data && typeof data.type === "string") handleEvent(data);
    } catch {
      // ignore malformed
    }
  });
  socket.addEventListener("close", () => {
    setStatus("closed");
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    try { socket?.close(); } catch {}
  });
}

function scheduleReconnect() {
  if (reconnectTimer != null) return;
  const delay = backoffMs;
  backoffMs = Math.min(BACKOFF_CAP, Math.round(backoffMs * 2));
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function startOnce() {
  if (started) return;
  started = true;
  connect();
}

function subscribeStatus(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getStatus() {
  return status;
}

export function useRealtime() {
  useEffect(() => {
    // Only connect the WebSocket inside the admin area. The public shop page,
    // login, and signup pages never need live sync — and the server now
    // rejects unauthenticated upgrades, so trying would just loop.
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (!hash.startsWith("#/admin")) return;
    }
    startOnce();
  }, []);
}

export function useRealtimeStatus(): Status {
  return useSyncExternalStore(subscribeStatus, getStatus, () => "closed" as Status);
}
