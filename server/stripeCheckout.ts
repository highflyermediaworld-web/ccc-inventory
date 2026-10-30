// Card payments through Stripe Checkout (hosted page). Enabled only when
// STRIPE_SECRET_KEY is set; the storefront asks /api/shop/checkout/config and
// hides the card button otherwise.
//
// Flow: Buy dialog → POST /api/shop/checkout/session → redirect to Stripe →
// Stripe sends the buyer back to /?checkout_session=cs_…#/checkout/success →
// the success page calls GET /api/shop/checkout/confirm, which verifies the
// session was paid and records the sale exactly once.
import Stripe from "stripe";
import type { Express, Request } from "express";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { broadcast } from "./realtime";
import type { Inventory } from "@shared/schema";
import * as fs from "node:fs";
import * as path from "node:path";

const SECRET = process.env.STRIPE_SECRET_KEY || "";
// California sales tax, as a percentage. Override with SALES_TAX_PERCENT.
export const SALES_TAX_PERCENT = Number(process.env.SALES_TAX_PERCENT || "8.75");
const PAYMENT_LABEL = "Card (Stripe)";

let stripe: Stripe | null = null;
export function isStripeEnabled(): boolean {
  return SECRET.startsWith("sk_") || SECRET.startsWith("rk_");
}
function client(): Stripe {
  if (!stripe) stripe = new Stripe(SECRET, { apiVersion: "2025-02-24.acacia" as any });
  return stripe;
}

function shopPrice(item: Inventory): number | null {
  if (typeof item.asking === "number" && item.asking > 0) return item.asking;
  if (typeof item.marketValue === "number" && item.marketValue > 0) return item.marketValue;
  return null;
}
function buyable(item: Inventory): boolean {
  return (item.status === "In Inventory" || item.status === "Listed") && (item.qty ?? 0) > 0;
}

function publicOrigin(req: Request): string {
  const env = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (env) return env;
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}`;
}

function absoluteImage(origin: string, url: string | null): string[] {
  if (!url) return [];
  if (/^https?:\/\//.test(url)) return [url];
  if (url.startsWith("/")) return [`${origin}${url}`];
  return [];
}

// Stripe tax rates are reusable objects; create one per percentage and
// remember its id so every checkout shares it.
async function taxRateId(): Promise<string | null> {
  if (!(SALES_TAX_PERCENT > 0)) return null;
  const key = `stripe_tax_rate_${SALES_TAX_PERCENT}`;
  const cached = await storage.getSetting(key);
  if (cached) return cached;
  // Reuse a matching rate already in the Stripe account (e.g. after a DB
  // wipe) instead of creating a duplicate.
  const existing = await client().taxRates.list({ active: true, limit: 100 });
  const match = existing.data.find(
    (r) => Number(r.percentage) === SALES_TAX_PERCENT && !r.inclusive && (r.jurisdiction ?? "") === "US - CA"
  );
  if (match) {
    await storage.setSetting(key, match.id);
    return match.id;
  }
  const rate = await client().taxRates.create({
    display_name: "Sales Tax",
    description: `California sales tax ${SALES_TAX_PERCENT}%`,
    jurisdiction: "US - CA",
    percentage: SALES_TAX_PERCENT,
    inclusive: false,
  });
  await storage.setSetting(key, rate.id);
  return rate.id;
}


export type PaidSummary = {
  ok: true;
  items: { itemId: string; itemName: string; setName: string | null; imageUrl: string | null; quantity: number; unitPrice: number | null }[];
  itemId: string;
  itemName: string;
  setName: string | null;
  imageUrl: string | null;
  quantity: number;
  subtotal: number;
  tax: number;
  total: number;
  email: string | null;
  name: string | null;
  alreadyRecorded?: boolean;
};

/**
 * Record a paid Checkout Session exactly once: lower stock (or mark Sold),
 * write a Sell transaction and an Accepted Buy request per line. Used by the
 * success page confirm and by the background sweep, so a buyer who closes the
 * Stripe tab without coming back still gets their order recorded.
 */
export async function recordPaidSession(session: Stripe.Checkout.Session): Promise<PaidSummary> {
  const sessionId = session.id;
  // Parse the manifest ("PK-001x1@389.99,OP-012x2@0.41"); fall back to the
  // legacy single-item metadata for sessions created before carts.
  type Line = { itemId: string; quantity: number; unit: number | null };
  const parsedLines: Line[] = String(session.metadata?.items ?? "")
    .split(",")
    .map((s) => /^(.+?)x(\d+)(?:@([\d.]+))?$/.exec(s.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ itemId: m[1], quantity: Math.max(1, Number(m[2]) || 1), unit: m[3] ? Number(m[3]) : null }));
  if (!parsedLines.length && session.metadata?.itemId) {
    parsedLines.push({
      itemId: session.metadata.itemId,
      quantity: Math.max(1, Number(session.metadata?.quantity ?? 1) || 1),
      unit: Number(session.metadata?.unitPrice) || null,
    });
  }
  const total = (session.amount_total ?? 0) / 100;
  const subtotal = (session.amount_subtotal ?? 0) / 100;
  const taxAmount = (session.total_details?.amount_tax ?? 0) / 100;
  const details = session.customer_details;

  const resolved = await Promise.all(
    parsedLines.map(async (l) => ({ ...l, item: await storage.getInventoryItem(l.itemId) }))
  );
  const summaryItems = resolved.map((l) => ({
    itemId: l.itemId,
    itemName: l.item?.name ?? l.itemId,
    setName: l.item?.setName ?? null,
    imageUrl: l.item?.imageUrl ?? null,
    quantity: l.quantity,
    unitPrice: l.unit ?? (l.item ? shopPrice(l.item) : null),
  }));
  const first = summaryItems[0];
  const summary: PaidSummary = {
    ok: true,
    items: summaryItems,
    // Legacy single-item fields so older success pages keep working.
    itemId: first?.itemId ?? "",
    itemName: summaryItems.length > 1 ? `${summaryItems.length} items` : (first?.itemName ?? "Your order"),
    setName: summaryItems.length > 1 ? null : (first?.setName ?? null),
    imageUrl: first?.imageUrl ?? null,
    quantity: summaryItems.reduce((n, i) => n + i.quantity, 0),
    subtotal,
    tax: taxAmount,
    total,
    email: details?.email ?? session.customer_email ?? null,
    name: details?.name ?? null,
  };

  const doneKey = `stripe_session_${sessionId}`;
  if (await storage.getSetting(doneKey)) return { ...summary, alreadyRecorded: true };
  await storage.setSetting(doneKey, String(Date.now()));

  const addr = details?.address;
  const shipTo = addr
    ? [details?.name, addr.line1, addr.line2, `${addr.city ?? ""}, ${addr.state ?? ""} ${addr.postal_code ?? ""}`.trim()]
        .filter(Boolean)
        .join(", ")
    : null;
  const orderLabel = resolved.length > 1 ? ` · ${resolved.length}-item order` : "";
  let touchedInventory = false;
  for (const l of resolved) {
    const item = l.item;
    if (!item) {
      console.warn(`[stripe] paid session ${sessionId} references unknown item ${l.itemId}`);
      continue;
    }
    const unit = l.unit ?? shopPrice(item) ?? 0;
    const lineSubtotal = Math.round(unit * l.quantity * 100) / 100;
    // Tax is split across lines in proportion to their subtotal.
    const lineTax = subtotal > 0 ? Math.round((taxAmount * lineSubtotal / subtotal) * 100) / 100 : 0;
    const remaining = (item.qty ?? 0) - l.quantity;
    const soldOut = remaining <= 0;
    const updated = await storage.updateInventory(item.id, soldOut
      ? ({ status: "Sold", soldPrice: lineSubtotal, qty: 0 } as any)
      : ({ qty: remaining } as any));
    const costShare = soldOut ? (item.totalCost ?? 0) : ((item.costPerUnit ?? 0) * l.quantity);
    await storage.createTransaction({
      type: "Sell",
      itemId: item.id,
      itemName: `${item.setName} \u2014 ${item.name}${l.quantity > 1 ? ` \u00d7${l.quantity}` : ""}`,
      counterparty: details?.name || details?.email || "Online order",
      price: lineSubtotal,
      pnl: Math.round((lineSubtotal - costShare) * 100) / 100,
      notes: `Paid via ${PAYMENT_LABEL}${orderLabel} \u00b7 tax ${lineTax.toFixed(2)} \u00b7 order total ${total.toFixed(2)} \u00b7 ${sessionId}${shipTo ? ` \u00b7 ship to ${shipTo}` : ""}`,
    } as any);
    await storage.createCustomerRequest({
      type: "Buy",
      itemId: item.id,
      customerName: details?.name || "Online buyer",
      customerEmail: details?.email || session.customer_email || "unknown@stripe",
      customerPhone: details?.phone ?? null,
      preferredContact: "Email",
      quantity: l.quantity,
      offerPrice: unit,
      paymentMethod: PAYMENT_LABEL,
      message: `PAID online${orderLabel} \u2014 ${total.toFixed(2)} order total (${taxAmount.toFixed(2)} tax).${shipTo ? ` Ship to: ${shipTo}.` : ""} Stripe ${sessionId}`,
      status: "Accepted",
    } as any);
    if (updated) broadcast({ type: "inventory:update", payload: updated });
    broadcast({ type: "customerRequest:new", payload: { itemId: item.id } });
    touchedInventory = true;
    console.log(`[stripe] recorded sale ${item.id} \u00d7${l.quantity} line ${lineSubtotal.toFixed(2)} (${sessionId})`);
  }
  if (touchedInventory) broadcast({ type: "transactions:update", payload: {} });
  await sendReceipt(session, summary.email).catch((err: any) =>
    console.warn(`[stripe] receipt email failed for ${sessionId}:`, err?.message ?? err)
  );
  return summary;
}

/**
 * Ask Stripe to email the buyer a receipt. Stripe only auto-sends receipts
 * when "Email customers about successful payments" is on in the account
 * settings; setting receipt_email on the charge sends one regardless.
 */
async function sendReceipt(session: Stripe.Checkout.Session, email: string | null): Promise<void> {
  if (!email || !/\S+@\S+\.\S+/.test(email)) return;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) return;
  const pi = await client().paymentIntents.retrieve(piId);
  const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
  if (!chargeId) return;
  const charge = await client().charges.retrieve(chargeId);
  if (charge.receipt_email) return; // already sent
  await client().charges.update(chargeId, { receipt_email: email });
  console.log(`[stripe] receipt emailed to ${email} (${session.id})`);
}


// ---- safety net: paid sessions the browser never confirmed ----
// Stripe only redirects to our success page if the buyer clicks through. If
// they close the tab (or the redirect fails), the sale would otherwise never
// hit inventory. Sweep recent paid sessions and record any we haven't seen.
const SWEEP_LOOKBACK_SEC = 7 * 24 * 3600;
let sweeping = false;
export async function sweepPaidSessions(): Promise<{ checked: number; recorded: number }> {
  if (!isStripeEnabled() || sweeping) return { checked: 0, recorded: 0 };
  sweeping = true;
  let checked = 0;
  let recorded = 0;
  try {
    const since = Math.floor(Date.now() / 1000) - SWEEP_LOOKBACK_SEC;
    for await (const session of client().checkout.sessions.list({
      status: "complete",
      created: { gte: since },
      limit: 100,
      expand: ["data.customer_details"],
    })) {
      checked += 1;
      if (session.payment_status !== "paid") continue;
      if (await storage.getSetting(`stripe_session_${session.id}`)) continue;
      try {
        const summary = await recordPaidSession(session);
        if (!summary.alreadyRecorded) {
          recorded += 1;
          console.log(`[stripe] sweep recorded missed order ${session.id} (${summary.total.toFixed(2)}, ${summary.items.length} line${summary.items.length === 1 ? "" : "s"})`);
        }
      } catch (err: any) {
        console.error(`[stripe] sweep failed for ${session.id}:`, err?.message ?? err);
      }
    }
  } catch (err: any) {
    console.error("[stripe] sweep error:", err?.message ?? err);
  } finally {
    sweeping = false;
  }
  return { checked, recorded };
}

let sweepTimer: NodeJS.Timeout | null = null;
export function startPaidSessionSweep(intervalMin = 10): void {
  if (!isStripeEnabled() || sweepTimer) return;
  // First pass shortly after boot, then on an interval.
  setTimeout(() => void sweepPaidSessions(), 20_000);
  sweepTimer = setInterval(() => void sweepPaidSessions(), intervalMin * 60_000);
  sweepTimer.unref?.();
  console.log(`[stripe] paid-order sweep every ${intervalMin} min`);
}

export function registerStripeCheckoutRoutes(app: Express) {
  startPaidSessionSweep();

  // Admin: push the shop logo into the Stripe account's branding so receipts,
  // Checkout and emails carry it. Uploads client/public/logo.jpeg (square) as
  // both icon and logo.
  app.post("/api/shop/checkout/branding", requireAuth, async (_req, res) => {
    try {
      if (!isStripeEnabled()) return res.status(503).json({ message: "Stripe isn't configured." });
      const candidates = [
        path.resolve(process.cwd(), "dist/public/logo.jpeg"),
        path.resolve(process.cwd(), "client/public/logo.jpeg"),
      ];
      const file = candidates.find((p) => fs.existsSync(p));
      if (!file) return res.status(404).json({ message: "logo.jpeg not found on the server." });
      const data = fs.readFileSync(file);
      const upload = (purpose: "business_icon" | "business_logo") =>
        client().files.create({ purpose, file: { data, name: "chris-collects-co.jpg", type: "application/octet-stream" } });
      const [icon, logo] = await Promise.all([upload("business_icon"), upload("business_logo")]);
      const me = await client().accounts.retrieve();
      const updated = await client().accounts.update(me.id, {
        settings: { branding: { icon: icon.id, logo: logo.id } },
      } as any);
      res.json({ ok: true, account: updated.id, branding: updated.settings?.branding });
    } catch (err: any) {
      console.error("[stripe] branding error:", err?.message ?? err);
      res.status(500).json({ message: err?.message || "Branding update failed" });
    }
  });

  // Admin: run the missed-order sweep on demand.
  app.post("/api/shop/checkout/sweep", requireAuth, async (_req, res) => {
    try {
      res.json(await sweepPaidSessions());
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Sweep failed" });
    }
  });

  app.get("/api/shop/checkout/config", (_req, res) => {
    res.json({ enabled: isStripeEnabled(), taxPercent: SALES_TAX_PERCENT, label: PAYMENT_LABEL });
  });

  // Stripe refuses checkouts under $0.50 — the storefront steers tiny items
  // into the cart so they can be combined.
  const CARD_MINIMUM_CENTS = 50;

  // Body: { items: [{ itemId, quantity }], customerEmail? } — or the older
  // single-item shape { itemId, quantity }.
  app.post("/api/shop/checkout/session", async (req, res) => {
    try {
      if (!isStripeEnabled()) return res.status(503).json({ message: "Card payments aren't switched on yet." });
      const rawItems: any[] = Array.isArray(req.body?.items)
        ? req.body.items
        : req.body?.itemId
          ? [{ itemId: req.body.itemId, quantity: req.body.quantity ?? 1 }]
          : [];
      const wanted = new Map<string, number>();
      for (const r of rawItems) {
        const id = String(r?.itemId ?? "").trim();
        if (!id) continue;
        const q = Math.max(1, Math.min(99, Math.floor(Number(r?.quantity ?? 1)) || 1));
        wanted.set(id, (wanted.get(id) ?? 0) + q);
      }
      if (!wanted.size) return res.status(400).json({ message: "Your cart is empty." });
      if (wanted.size > 40) return res.status(400).json({ message: "That's too many different items for one checkout — split it into two orders." });
      const email = typeof req.body?.customerEmail === "string" && /\S+@\S+\.\S+/.test(req.body.customerEmail)
        ? req.body.customerEmail.trim()
        : undefined;

      const origin = publicOrigin(req);
      const lines: { item: Inventory; quantity: number; unit: number }[] = [];
      for (const [itemId, quantity] of wanted) {
        const item = await storage.getInventoryItem(itemId);
        if (!item) return res.status(404).json({ message: `${itemId} is no longer listed. Remove it from your cart and try again.` });
        if (!buyable(item)) return res.status(409).json({ message: `Sorry, ${item.name} just sold out. Remove it from your cart and try again.` });
        if ((item.qty ?? 0) < quantity) return res.status(409).json({ message: `Only ${item.qty} of ${item.name} left.` });
        const unit = shopPrice(item);
        if (!unit) return res.status(409).json({ message: `${item.name} isn't priced for online checkout yet.` });
        lines.push({ item, quantity, unit });
      }
      const subtotalCents = lines.reduce((n, l) => n + Math.round(l.unit * 100) * l.quantity, 0);
      if (subtotalCents < CARD_MINIMUM_CENTS) {
        return res.status(409).json({
          code: "below_minimum",
          message: "Card payments need a $0.50 minimum. Add another item to your cart, or request to buy another way.",
        });
      }

      const tax = await taxRateId();
      // Compact "ID×qty" list so the confirm step can record every line even
      // if an item is renamed later. Stripe metadata values max out at 500 chars.
      const manifest = lines.map((l) => `${l.item.id}x${l.quantity}@${l.unit}`).join(",");
      const session = await client().checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        line_items: lines.map((l) => ({
          quantity: l.quantity,
          ...(tax ? { tax_rates: [tax] } : {}),
          price_data: {
            currency: "usd",
            unit_amount: Math.round(l.unit * 100),
            product_data: {
              name: l.item.name,
              description: [l.item.setName, l.item.condition, l.item.rarity].filter(Boolean).join(" · ") || undefined,
              images: absoluteImage(origin, l.item.imageUrl),
              metadata: { itemId: l.item.id },
            },
          },
        })),
        shipping_address_collection: { allowed_countries: ["US"] },
        phone_number_collection: { enabled: true },
        metadata: {
          items: manifest.slice(0, 500),
          lineCount: String(lines.length),
          // Legacy single-item fields, kept for the first line.
          itemId: lines[0].item.id,
          quantity: String(lines[0].quantity),
          unitPrice: String(lines[0].unit),
        },
        success_url: `${origin}/?checkout_session={CHECKOUT_SESSION_ID}#/checkout/success`,
        cancel_url: `${origin}/#/`,
      });
      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[stripe] session error:", err?.message ?? err);
      res.status(500).json({ message: "Couldn't start checkout. Try again in a moment." });
    }
  });

  // Verify a returned session and record the sale once. Safe to call again:
  // the session id is remembered in settings.
  app.get("/api/shop/checkout/confirm", async (req, res) => {
    try {
      if (!isStripeEnabled()) return res.status(503).json({ message: "Card payments aren't switched on yet." });
      const sessionId = String(req.query.session_id ?? "");
      if (!/^cs_/.test(sessionId)) return res.status(400).json({ message: "Missing session." });

      const session = await client().checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent", "customer_details"],
      });
      if (session.payment_status !== "paid") {
        return res.status(402).json({ ok: false, status: session.payment_status, message: "Payment not completed." });
      }

      const summary = await recordPaidSession(session);
      res.json(summary);
    } catch (err: any) {
      console.error("[stripe] confirm error:", err?.message ?? err);
      res.status(500).json({ message: "Couldn't verify the payment. Your card was not charged twice; Chris will follow up by email." });
    }
  });
}
