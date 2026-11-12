// Shipping quotes for the storefront: USPS Ground Advantage retail postage by
// zone (distance from the shop's ZIP) and weight (item count by category),
// plus the owner's handling fee / free-shipping threshold.
//
//   GET  /api/shop/shipping/quote?zip=94110&items=PK-001:1,OP-002:2  (public)
//   GET  /api/admin/shipping          current settings + defaults
//   PUT  /api/admin/shipping          save settings
import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import type { Inventory } from "@shared/schema";
import {
  DEFAULT_SHIPPING,
  mergeShippingSettings,
  quoteShipping,
  SHIPPING_SERVICE,
  SHIPPING_DAYS,
  type ShippingQuote,
  type ShippingSettings,
} from "@shared/shipping";

const KEY = "shipping_settings";

export async function getShippingSettings(): Promise<ShippingSettings> {
  const raw = await storage.getSetting(KEY);
  if (!raw) return DEFAULT_SHIPPING;
  try { return mergeShippingSettings(JSON.parse(raw)); } catch { return DEFAULT_SHIPPING; }
}

/** Quote for already-resolved lines (used by checkout so the amount can't be spoofed). */
export async function quoteForLines(
  lines: { item: Inventory; quantity: number; unit: number }[],
  destZip: string | null | undefined,
): Promise<ShippingQuote> {
  const settings = await getShippingSettings();
  const subtotal = lines.reduce((n, l) => n + l.unit * l.quantity, 0);
  return quoteShipping(lines.map((l) => ({ category: l.item.category, quantity: l.quantity })), destZip, settings, subtotal);
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  originZip: z.string().trim().regex(/^\d{5}$/, "Ship-from ZIP must be 5 digits"),
  handlingFee: z.coerce.number().min(0).max(100),
  freeOver: z.union([z.coerce.number().min(0).max(100000), z.null(), z.literal("")]).optional(),
  ozRaw: z.coerce.number().min(0.1).max(64),
  ozSlab: z.coerce.number().min(0.1).max(64),
  ozSealed: z.coerce.number().min(0.1).max(1120),
  ozPackaging: z.coerce.number().min(0).max(64),
});

export function registerShippingRoutes(app: Express) {
  app.get("/api/shop/shipping/quote", async (req, res) => {
    try {
      const settings = await getShippingSettings();
      const zip = String(req.query.zip ?? "");
      const pairs = String(req.query.items ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const i = s.lastIndexOf(":");
          return i > 0 ? { id: s.slice(0, i), qty: Math.max(1, Math.min(99, Number(s.slice(i + 1)) || 1)) } : { id: s, qty: 1 };
        })
        .slice(0, 60);
      const lines: { item: Inventory; quantity: number; unit: number }[] = [];
      for (const p of pairs) {
        const item = await storage.getInventoryItem(p.id);
        if (!item) continue;
        const unit = typeof item.asking === "number" && item.asking > 0 ? item.asking : (item.marketValue ?? 0);
        lines.push({ item, quantity: p.qty, unit });
      }
      // Admin preview: "sample=raw:2,slab:1,sealed:0" quotes a synthetic parcel.
      const sample = String(req.query.sample ?? "");
      const shipItems = lines.map((l) => ({ category: l.item.category, quantity: l.quantity }));
      if (sample) {
        for (const part of sample.split(",")) {
          const [cat, n] = part.split(":");
          const qty = Math.max(0, Math.min(500, Number(n) || 0));
          if (cat && qty) shipItems.push({ category: cat === "slab" ? "Slab" : cat === "sealed" ? "Sealed" : "Raw", quantity: qty });
        }
      }
      const subtotal = lines.reduce((n, l) => n + l.unit * l.quantity, 0);
      const quote = quoteShipping(shipItems, zip, settings, subtotal);
      res.json({ enabled: settings.enabled, service: SHIPPING_SERVICE, days: SHIPPING_DAYS, freeOver: settings.freeOver, quote });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Couldn't quote shipping" });
    }
  });

  app.get("/api/admin/shipping", requireAuth, async (_req, res) => {
    res.json({ settings: await getShippingSettings(), defaults: DEFAULT_SHIPPING, service: SHIPPING_SERVICE });
  });

  app.put("/api/admin/shipping", requireAuth, async (req, res) => {
    try {
      const body = settingsSchema.parse(req.body?.settings ?? req.body);
      const clean = mergeShippingSettings({
        ...body,
        freeOver: body.freeOver === "" || body.freeOver == null ? null : Number(body.freeOver),
      });
      await storage.setSetting(KEY, JSON.stringify(clean));
      res.json({ ok: true, settings: clean });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: err.issues[0]?.message || "Invalid shipping settings" });
      res.status(400).json({ message: err?.message || "Failed to save shipping settings" });
    }
  });
}
