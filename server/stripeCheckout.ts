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
import { storage } from "./storage";
import { broadcast } from "./realtime";
import type { Inventory } from "@shared/schema";

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

export function registerStripeCheckoutRoutes(app: Express) {
  app.get("/api/shop/checkout/config", (_req, res) => {
    res.json({ enabled: isStripeEnabled(), taxPercent: SALES_TAX_PERCENT, label: PAYMENT_LABEL });
  });

  app.post("/api/shop/checkout/session", async (req, res) => {
    try {
      if (!isStripeEnabled()) return res.status(503).json({ message: "Card payments aren't switched on yet." });
      const itemId = String(req.body?.itemId ?? "");
      const quantity = Math.max(1, Math.min(99, Number(req.body?.quantity ?? 1) || 1));
      const email = typeof req.body?.customerEmail === "string" && /\S+@\S+\.\S+/.test(req.body.customerEmail)
        ? req.body.customerEmail.trim()
        : undefined;

      const item = await storage.getInventoryItem(itemId);
      if (!item) return res.status(404).json({ message: "That item is no longer listed." });
      if (!buyable(item)) return res.status(409).json({ message: "Sorry, that item is out of stock." });
      if ((item.qty ?? 0) < quantity) return res.status(409).json({ message: `Only ${item.qty} left.` });
      const unit = shopPrice(item);
      if (!unit) return res.status(409).json({ message: "This item isn't priced for online checkout yet." });

      const origin = publicOrigin(req);
      const tax = await taxRateId();
      const session = await client().checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        line_items: [
          {
            quantity,
            ...(tax ? { tax_rates: [tax] } : {}),
            price_data: {
              currency: "usd",
              unit_amount: Math.round(unit * 100),
              product_data: {
                name: item.name,
                description: [item.setName, item.condition, item.rarity].filter(Boolean).join(" · ") || undefined,
                images: absoluteImage(origin, item.imageUrl),
                metadata: { itemId: item.id },
              },
            },
          },
        ],
        shipping_address_collection: { allowed_countries: ["US"] },
        phone_number_collection: { enabled: true },
        metadata: { itemId: item.id, quantity: String(quantity), unitPrice: String(unit) },
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

      const itemId = session.metadata?.itemId ?? "";
      const quantity = Math.max(1, Number(session.metadata?.quantity ?? 1) || 1);
      const total = (session.amount_total ?? 0) / 100;
      const subtotal = (session.amount_subtotal ?? 0) / 100;
      const taxAmount = (session.total_details?.amount_tax ?? 0) / 100;
      const details = session.customer_details;
      const item = await storage.getInventoryItem(itemId);

      const summary = {
        ok: true,
        itemId,
        itemName: item ? item.name : (session.metadata?.itemName ?? "Your order"),
        setName: item?.setName ?? null,
        imageUrl: item?.imageUrl ?? null,
        quantity,
        subtotal,
        tax: taxAmount,
        total,
        email: details?.email ?? session.customer_email ?? null,
        name: details?.name ?? null,
      };

      const doneKey = `stripe_session_${sessionId}`;
      if (await storage.getSetting(doneKey)) return res.json({ ...summary, alreadyRecorded: true });
      await storage.setSetting(doneKey, String(Date.now()));

      if (item) {
        const unit = Number(session.metadata?.unitPrice) || shopPrice(item) || subtotal / quantity;
        const remaining = (item.qty ?? 0) - quantity;
        const soldOut = remaining <= 0;
        const updated = await storage.updateInventory(item.id, soldOut
          ? ({ status: "Sold", soldPrice: subtotal, qty: 0 } as any)
          : ({ qty: remaining } as any));
        const costShare = soldOut ? (item.totalCost ?? 0) : ((item.costPerUnit ?? 0) * quantity);
        const addr = details?.address;
        const shipTo = addr
          ? [details?.name, addr.line1, addr.line2, `${addr.city ?? ""}, ${addr.state ?? ""} ${addr.postal_code ?? ""}`.trim()]
              .filter(Boolean)
              .join(", ")
          : null;
        await storage.createTransaction({
          type: "Sell",
          itemId: item.id,
          itemName: `${item.setName} \u2014 ${item.name}${quantity > 1 ? ` \u00d7${quantity}` : ""}`,
          counterparty: details?.name || details?.email || "Online order",
          price: subtotal,
          pnl: Math.round((subtotal - costShare) * 100) / 100,
          notes: `Paid via ${PAYMENT_LABEL} \u00b7 tax ${taxAmount.toFixed(2)} \u00b7 total ${total.toFixed(2)} \u00b7 ${sessionId}${shipTo ? ` \u00b7 ship to ${shipTo}` : ""}`,
        } as any);
        await storage.createCustomerRequest({
          type: "Buy",
          itemId: item.id,
          customerName: details?.name || "Online buyer",
          customerEmail: details?.email || session.customer_email || "unknown@stripe",
          customerPhone: details?.phone ?? null,
          preferredContact: "Email",
          quantity,
          offerPrice: unit,
          paymentMethod: PAYMENT_LABEL,
          message: `PAID online \u2014 ${total.toFixed(2)} total (${taxAmount.toFixed(2)} tax).${shipTo ? ` Ship to: ${shipTo}.` : ""} Stripe ${sessionId}`,
          status: "Accepted",
        } as any);
        if (updated) broadcast({ type: "inventory:update", payload: updated });
        broadcast({ type: "transactions:update", payload: {} });
        broadcast({ type: "customerRequest:new", payload: { itemId: item.id } });
        console.log(`[stripe] recorded sale ${item.id} \u00d7${quantity} total ${total.toFixed(2)} (${sessionId})`);
      } else {
        console.warn(`[stripe] paid session ${sessionId} references unknown item ${itemId}`);
      }
      res.json(summary);
    } catch (err: any) {
      console.error("[stripe] confirm error:", err?.message ?? err);
      res.status(500).json({ message: "Couldn't verify the payment. Your card was not charged twice; Chris will follow up by email." });
    }
  });
}
