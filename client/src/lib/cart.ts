// Shopping cart — a tiny store persisted in localStorage so a shopper can
// collect several cards and pay for them in one Stripe checkout (or send a
// single buy request). Only ids and quantities are stored; prices and names
// always come from the live listings so nothing stale is ever charged.
import { useSyncExternalStore } from "react";

export type CartLine = { id: string; qty: number };

const KEY = "ccc.cart.v1";
const listeners = new Set<() => void>();
let lines: CartLine[] = load();

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l: any) => l && typeof l.id === "string" && Number(l.qty) > 0)
      .map((l: any) => ({ id: l.id, qty: Math.floor(Number(l.qty)) }));
  } catch {
    return [];
  }
}

function commit(next: CartLine[]) {
  lines = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {}
  listeners.forEach((fn) => fn());
}

export const cart = {
  get: () => lines,
  add(id: string, qty = 1, max = Infinity) {
    const cur = lines.find((l) => l.id === id);
    const nextQty = Math.min(max, (cur?.qty ?? 0) + qty);
    if (cur) commit(lines.map((l) => (l.id === id ? { ...l, qty: nextQty } : l)));
    else commit([...lines, { id, qty: Math.min(max, qty) }]);
  },
  setQty(id: string, qty: number) {
    if (qty <= 0) return cart.remove(id);
    commit(lines.map((l) => (l.id === id ? { ...l, qty: Math.floor(qty) } : l)));
  },
  remove(id: string) {
    commit(lines.filter((l) => l.id !== id));
  },
  clear() {
    commit([]);
  },
  has: (id: string) => lines.some((l) => l.id === id),
  count: () => lines.reduce((n, l) => n + l.qty, 0),
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// Keep tabs in sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      lines = load();
      listeners.forEach((fn) => fn());
    }
  });
}

export function useCart(): CartLine[] {
  return useSyncExternalStore(cart.subscribe, cart.get, cart.get);
}

// Stripe won't create a checkout under this amount (USD).
export const CARD_MINIMUM = 0.5;
