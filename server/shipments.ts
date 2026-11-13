// Shipments: one record per order that needs to go in the mail.
//
// Paid Stripe orders create one automatically (address comes from Stripe's
// shipping-address collection). Zelle/Venmo/etc. orders can be added by hand.
// Each shipment has a printable 4×6 address label and a packing slip; postage
// is paid at the USPS counter or on Click-N-Ship, so no carrier account is
// needed. Weight / zone / estimated postage are pre-computed so the clerk (or
// Click-N-Ship form) can be filled in quickly.
//
//   GET    /api/admin/shipments                 list (newest first)
//   POST   /api/admin/shipments                 create by hand
//   PATCH  /api/admin/shipments/:id             status / tracking / note / address
//   DELETE /api/admin/shipments/:id
//   GET    /api/admin/shipments/:id/label       printable 4×6 label (HTML)
//   GET    /api/admin/shipments/:id/packing-slip printable packing slip (HTML)
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { getShippingSettings } from "./shipping";
import type { Shipment, ShipmentItem } from "@shared/schema";
import { ouncesFor, zoneBetween, groundAdvantagePostage, normalizeZip, SHIPPING_SERVICE, type ShippingSettings } from "@shared/shipping";

export type ShipAddress = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
};

/** Pull the ship-to address from a Checkout Session (API-version tolerant). */
export function addressFromSession(session: Stripe.Checkout.Session): ShipAddress | null {
  const anyS = session as any;
  const shipping = anyS.shipping_details ?? session.collected_information?.shipping_details ?? null;
  const name: string | null = shipping?.name ?? session.customer_details?.name ?? null;
  const a = shipping?.address ?? session.customer_details?.address ?? null;
  if (!a || !a.line1 || !a.postal_code) return null;
  return {
    name: name || "Online buyer",
    line1: a.line1,
    line2: a.line2 ?? null,
    city: a.city ?? "",
    state: a.state ?? "",
    zip: String(a.postal_code).replace(/\D/g, "").slice(0, 5),
  };
}

function compute(items: ShipmentItem[], zip: string, settings: ShippingSettings) {
  const ounces = ouncesFor(items.map((i) => ({ category: i.category, quantity: i.quantity })), settings);
  const z = zoneBetween(settings.originZip, zip);
  const postage = z ? groundAdvantagePostage(ounces, z.zone) : null;
  return { ounces, zone: z?.zone ?? null, postageEstimate: postage?.postage ?? null };
}

/** Create the shipment for a paid online order. Idempotent per order ref. */
export async function createShipmentForOrder(opts: {
  orderRef: string;
  address: ShipAddress;
  email?: string | null;
  phone?: string | null;
  items: ShipmentItem[];
  shippingCharged: number;
  orderTotal: number;
}): Promise<Shipment | null> {
  const existing = await storage.getShipmentByOrderRef(opts.orderRef);
  if (existing) return existing;
  const settings = await getShippingSettings();
  const c = compute(opts.items, opts.address.zip, settings);
  const row = await storage.createShipment({
    orderRef: opts.orderRef,
    customerName: opts.address.name,
    customerEmail: opts.email ?? null,
    customerPhone: opts.phone ?? null,
    line1: opts.address.line1,
    line2: opts.address.line2 ?? null,
    city: opts.address.city,
    state: opts.address.state,
    zip: opts.address.zip,
    items: JSON.stringify(opts.items),
    ounces: c.ounces,
    service: SHIPPING_SERVICE,
    zone: c.zone,
    postageEstimate: c.postageEstimate,
    shippingCharged: opts.shippingCharged,
    orderTotal: opts.orderTotal,
    status: "To ship",
  });
  console.log(`[ship] label ready #${row.id} for ${opts.orderRef} → ${opts.address.city}, ${opts.address.state} ${opts.address.zip} (${c.ounces} oz, zone ${c.zone ?? "?"})`);
  return row;
}

const itemSchema = z.object({
  itemId: z.string().nullable().optional(),
  name: z.string().min(1),
  setName: z.string().nullable().optional(),
  quantity: z.coerce.number().int().min(1).max(500),
  category: z.string().default("Raw"),
  unitPrice: z.coerce.number().nullable().optional(),
});
const createSchema = z.object({
  orderRef: z.string().trim().max(120).optional(),
  customerName: z.string().trim().min(1, "Name is required").max(80),
  customerEmail: z.string().trim().max(120).optional().nullable(),
  customerPhone: z.string().trim().max(40).optional().nullable(),
  line1: z.string().trim().min(1, "Street address is required").max(80),
  line2: z.string().trim().max(80).optional().nullable(),
  city: z.string().trim().min(1, "City is required").max(60),
  state: z.string().trim().length(2, "State must be 2 letters"),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "ZIP must be 5 digits"),
  items: z.array(itemSchema).min(1, "Add at least one item"),
  shippingCharged: z.coerce.number().min(0).optional().nullable(),
  orderTotal: z.coerce.number().min(0).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  ounces: z.coerce.number().min(0.1).max(2000).optional().nullable(),
});
const patchSchema = createSchema.partial().extend({
  status: z.enum(["To ship", "Shipped", "Cancelled"]).optional(),
  tracking: z.string().trim().max(60).optional().nullable(),
});

function parseItems(s: Shipment): ShipmentItem[] {
  try { return JSON.parse(s.items) as ShipmentItem[]; } catch { return []; }
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
/** USPS Pub 28 style: uppercase, no punctuation. */
function uspsLine(v: string | null | undefined): string {
  return String(v ?? "").toUpperCase().replace(/[.,#]/g, (c) => (c === "#" ? "# " : "")).replace(/\s+/g, " ").trim();
}
function weightLabel(oz: number): string {
  if (oz < 16) return `${Math.ceil(oz)} oz`;
  const lb = Math.floor(oz / 16);
  const rem = Math.ceil(oz - lb * 16);
  return rem ? `${lb} lb ${rem} oz` : `${lb} lb`;
}

const LABEL_CSS = `
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e5e5e5; font-family: "Helvetica Neue", Arial, sans-serif; color: #000; }
  .label { width: 4in; height: 6in; background: #fff; margin: 0.25in auto; padding: 0.22in 0.25in; display: flex; flex-direction: column; border: 1px solid #bbb; position: relative; }
  @media print { html, body { background: #fff; } .label { margin: 0; border: 0; page-break-after: always; } .toolbar { display: none !important; } }
  .from { font-size: 9pt; line-height: 1.25; }
  .from .n { font-weight: 700; }
  .svc { margin-top: 0.14in; border-top: 3px solid #000; border-bottom: 3px solid #000; padding: 0.06in 0; display: flex; justify-content: space-between; align-items: center; }
  .svc b { font-size: 12.5pt; letter-spacing: 0.03em; white-space: nowrap; }
  .svc span { font-size: 8.5pt; text-align: right; line-height: 1.25; white-space: nowrap; }
  .to { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0.1in 0.05in; }
  .to .k { font-size: 8pt; letter-spacing: 0.18em; color: #444; margin-bottom: 0.08in; }
  .to .l { font-size: 15pt; font-weight: 700; line-height: 1.22; letter-spacing: 0.01em; }
  .to .l.city { margin-top: 0.02in; }
  .postage { border: 2px dashed #000; padding: 0.08in; text-align: center; font-size: 9pt; line-height: 1.3; }
  .postage b { display: block; font-size: 10.5pt; letter-spacing: 0.08em; }
  .meta { margin-top: 0.1in; display: flex; justify-content: space-between; font-size: 8pt; color: #333; border-top: 1px solid #000; padding-top: 0.06in; }
  .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #101013; color: #fff; padding: 10px 16px; display: flex; gap: 10px; align-items: center; font-size: 13px; z-index: 9; }
  .toolbar button, .toolbar a { background: #d32f2f; color: #fff; border: 0; padding: 8px 14px; font-weight: 700; cursor: pointer; text-decoration: none; font-size: 13px; }
  .toolbar a.ghost { background: transparent; border: 1px solid #555; }
  .toolbar .sp { flex: 1; }
  body.has-toolbar .label:first-of-type { margin-top: 60px; }
`;

function renderLabel(s: Shipment, settings: ShippingSettings): string {
  const items = parseItems(s);
  const count = items.reduce((n, i) => n + i.quantity, 0);
  const fromLines = [
    uspsLine(settings.fromName),
    uspsLine(settings.fromLine1),
    uspsLine(settings.fromLine2),
    `${uspsLine(settings.fromCity)} ${uspsLine(settings.fromState)} ${settings.originZip}`.trim(),
  ].filter(Boolean);
  const toLines = [uspsLine(s.customerName), uspsLine(s.line1), uspsLine(s.line2)].filter(Boolean);
  const cityLine = `${uspsLine(s.city)} ${uspsLine(s.state)} ${s.zip}`.trim();
  const missingFrom = !settings.fromLine1;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Label #${s.id} — ${esc(s.customerName)}</title><style>${LABEL_CSS}</style></head>
<body class="has-toolbar">
<div class="toolbar">
  <span>Shipping label #${s.id} · ${esc(s.customerName)} · ${weightLabel(s.ounces)} · zone ${s.zone ?? "?"}</span>
  <span class="sp"></span>
  ${missingFrom ? `<span style="color:#ffb4b4">Add your return address in Shop settings → Shipping</span>` : ""}
  <a class="ghost" href="/api/admin/shipments/${s.id}/packing-slip">Packing slip</a>
  <button onclick="window.print()">Print label</button>
</div>
<div class="label">
  <div class="from">${fromLines.map((l, i) => `<div class="${i === 0 ? "n" : ""}">${esc(l)}</div>`).join("")}${missingFrom ? `<div style="color:#999">[RETURN ADDRESS — set in Shop settings]</div>` : ""}</div>
  <div class="svc"><b>${esc(s.service.toUpperCase())}</b><span>${weightLabel(s.ounces)}<br>${count} item${count === 1 ? "" : "s"}${s.zone ? ` · Zone ${s.zone}` : ""}</span></div>
  <div class="to">
    <div class="k">SHIP TO</div>
    ${toLines.map((l) => `<div class="l">${esc(l)}</div>`).join("")}
    <div class="l city">${esc(cityLine)}</div>
  </div>
  <div class="postage"><b>POSTAGE PAID AT COUNTER</b>${s.postageEstimate != null ? `Est. retail ${esc(s.service)}: $${s.postageEstimate.toFixed(2)}` : "Ask for Ground Advantage"}</div>
  <div class="meta"><span>Order ${esc(s.orderRef ? shortRef(s.orderRef) : `#${s.id}`)}</span><span>${new Date(s.createdAt * 1000).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}</span><span>${esc(settings.fromName)}</span></div>
</div>
</body></html>`;
}

function shortRef(ref: string): string {
  return ref.startsWith("cs_") ? ref.slice(-8).toUpperCase() : ref;
}

const SLIP_CSS = `
  @page { size: letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; padding: 0.6in; max-width: 8.5in; }
  @media print { body { padding: 0; } .toolbar { display: none !important; } }
  .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #101013; color: #fff; padding: 10px 16px; display: flex; gap: 10px; align-items: center; font-size: 13px; }
  .toolbar button, .toolbar a { background: #d32f2f; color: #fff; border: 0; padding: 8px 14px; font-weight: 700; cursor: pointer; text-decoration: none; font-size: 13px; }
  .toolbar a.ghost { background: transparent; border: 1px solid #555; }
  .toolbar .sp { flex: 1; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #000; padding-bottom: 14px; margin-top: 50px; }
  @media print { .head { margin-top: 0; } }
  .brand { font-size: 26px; font-weight: 900; letter-spacing: -0.01em; }
  .brand small { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.2em; color: #d32f2f; }
  .meta { text-align: right; font-size: 12px; line-height: 1.5; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 20px 0; font-size: 13px; line-height: 1.45; }
  .k { font-size: 10px; letter-spacing: 0.18em; color: #666; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th { text-align: left; font-size: 10px; letter-spacing: 0.14em; color: #666; border-bottom: 1px solid #000; padding: 6px 0; }
  td { padding: 8px 0; border-bottom: 1px solid #ddd; vertical-align: top; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  .tot { margin-left: auto; width: 280px; margin-top: 12px; font-size: 13px; }
  .tot div { display: flex; justify-content: space-between; padding: 4px 0; }
  .tot .g { border-top: 2px solid #000; font-weight: 800; font-size: 15px; margin-top: 4px; padding-top: 8px; }
  .foot { margin-top: 36px; font-size: 12px; color: #444; border-top: 1px solid #000; padding-top: 12px; line-height: 1.5; }
`;

function renderSlip(s: Shipment, settings: ShippingSettings): string {
  const items = parseItems(s);
  const sub = items.reduce((n, i) => n + (i.unitPrice ?? 0) * i.quantity, 0);
  const ship = s.shippingCharged ?? 0;
  const total = s.orderTotal ?? sub + ship;
  const tax = Math.max(0, Math.round((total - sub - ship) * 100) / 100);
  const money = (n: number) => `$${n.toFixed(2)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing slip #${s.id}</title><style>${SLIP_CSS}</style></head>
<body>
<div class="toolbar"><span>Packing slip #${s.id} · ${esc(s.customerName)}</span><span class="sp"></span><a class="ghost" href="/api/admin/shipments/${s.id}/label">Label</a><button onclick="window.print()">Print</button></div>
<div class="head">
  <div class="brand">${esc(settings.fromName)}<small>PACKING SLIP</small></div>
  <div class="meta">Order ${esc(s.orderRef ? shortRef(s.orderRef) : `#${s.id}`)}<br>${new Date(s.createdAt * 1000).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "America/Los_Angeles" })}<br>${esc(s.service)} · ${weightLabel(s.ounces)}</div>
</div>
<div class="cols">
  <div><div class="k">SHIP TO</div><b>${esc(s.customerName)}</b><br>${esc(s.line1)}<br>${s.line2 ? esc(s.line2) + "<br>" : ""}${esc(s.city)}, ${esc(s.state)} ${esc(s.zip)}${s.customerEmail ? `<br>${esc(s.customerEmail)}` : ""}${s.customerPhone ? `<br>${esc(s.customerPhone)}` : ""}</div>
  <div><div class="k">FROM</div><b>${esc(settings.fromName)}</b><br>${settings.fromLine1 ? esc(settings.fromLine1) + "<br>" : ""}${settings.fromLine2 ? esc(settings.fromLine2) + "<br>" : ""}${esc(settings.fromCity)}, ${esc(settings.fromState)} ${esc(settings.originZip)}</div>
</div>
<table><thead><tr><th>ITEM</th><th>DETAILS</th><th class="r">QTY</th><th class="r">PRICE</th></tr></thead><tbody>
${items.map((i) => `<tr><td><b>${esc(i.name)}</b>${i.itemId ? `<br><span style="color:#666;font-size:11px">${esc(i.itemId)}</span>` : ""}</td><td>${esc([i.setName, i.category].filter(Boolean).join(" · "))}</td><td class="r">${i.quantity}</td><td class="r">${i.unitPrice != null ? money(i.unitPrice * i.quantity) : "—"}</td></tr>`).join("")}
</tbody></table>
<div class="tot">
  <div><span>Subtotal</span><span>${money(sub)}</span></div>
  <div><span>Shipping (${esc(s.service)})</span><span>${ship > 0 ? money(ship) : "Free"}</span></div>
  ${tax > 0 ? `<div><span>Sales tax</span><span>${money(tax)}</span></div>` : ""}
  <div class="g"><span>Total paid</span><span>${money(total)}</span></div>
</div>
<div class="foot">Thanks for supporting ${esc(settings.fromName)}. Not exactly as described? Full refund, no questions asked — reply to your receipt or message @cpulls.cards. ${s.note ? `<br><br>${esc(s.note)}` : ""}</div>
</body></html>`;
}

export function registerShipmentRoutes(app: Express) {
  app.get("/api/admin/shipments", requireAuth, async (_req, res) => {
    const rows = await storage.getShipments();
    res.json(rows.map((r) => ({ ...r, items: parseItems(r) })));
  });

  app.post("/api/admin/shipments", requireAuth, async (req, res) => {
    try {
      const body = createSchema.parse(req.body);
      const settings = await getShippingSettings();
      const zip = normalizeZip(body.zip) ?? body.zip.slice(0, 5);
      const items = body.items as ShipmentItem[];
      const c = compute(items, zip, settings);
      const ounces = body.ounces ?? c.ounces;
      const postage = c.zone ? groundAdvantagePostage(ounces, c.zone)?.postage ?? null : null;
      const row = await storage.createShipment({
        orderRef: body.orderRef || null,
        customerName: body.customerName,
        customerEmail: body.customerEmail || null,
        customerPhone: body.customerPhone || null,
        line1: body.line1,
        line2: body.line2 || null,
        city: body.city,
        state: body.state.toUpperCase(),
        zip,
        items: JSON.stringify(items),
        ounces,
        service: SHIPPING_SERVICE,
        zone: c.zone,
        postageEstimate: postage,
        shippingCharged: body.shippingCharged ?? null,
        orderTotal: body.orderTotal ?? null,
        note: body.note || null,
        status: "To ship",
      });
      res.status(201).json({ ...row, items });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: err.issues[0]?.message || "Invalid shipment" });
      res.status(400).json({ message: err?.message || "Couldn't create shipment" });
    }
  });

  app.patch("/api/admin/shipments/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await storage.getShipment(id);
      if (!cur) return res.status(404).json({ message: "Shipment not found" });
      const body = patchSchema.parse(req.body);
      const patch: Partial<Shipment> = {};
      for (const k of ["customerName", "customerEmail", "customerPhone", "line1", "line2", "city", "state", "zip", "note", "tracking", "orderRef"] as const) {
        if (body[k] !== undefined) (patch as any)[k] = body[k] === "" ? null : body[k];
      }
      if (patch.state) patch.state = String(patch.state).toUpperCase();
      if (patch.zip) patch.zip = normalizeZip(String(patch.zip)) ?? String(patch.zip).slice(0, 5);
      if (body.items) patch.items = JSON.stringify(body.items);
      if (body.ounces != null) patch.ounces = body.ounces;
      if (body.status) {
        patch.status = body.status;
        patch.shippedAt = body.status === "Shipped" ? (cur.shippedAt ?? Math.floor(Date.now() / 1000)) : null;
      }
      // Re-price when anything affecting weight or zone changed.
      if (body.items || body.zip || body.ounces != null) {
        const settings = await getShippingSettings();
        const items = body.items ? (body.items as ShipmentItem[]) : parseItems(cur);
        const zip = patch.zip ?? cur.zip;
        const c = compute(items, zip, settings);
        const ounces = body.ounces ?? (body.items ? c.ounces : cur.ounces);
        patch.ounces = ounces;
        patch.zone = c.zone;
        patch.postageEstimate = c.zone ? groundAdvantagePostage(ounces, c.zone)?.postage ?? null : null;
      }
      const row = await storage.updateShipment(id, patch);
      res.json(row ? { ...row, items: parseItems(row) } : null);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: err.issues[0]?.message || "Invalid update" });
      res.status(400).json({ message: err?.message || "Couldn't update shipment" });
    }
  });

  app.delete("/api/admin/shipments/:id", requireAuth, async (req, res) => {
    await storage.deleteShipment(Number(req.params.id));
    res.json({ ok: true });
  });

  const html = (render: (s: Shipment, settings: ShippingSettings) => string) => async (req: Request, res: Response) => {
    const s = await storage.getShipment(Number(req.params.id));
    if (!s) return res.status(404).send("Shipment not found");
    const settings = await getShippingSettings();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(render(s, settings));
  };
  app.get("/api/admin/shipments/:id/label", requireAuth, html(renderLabel));
  app.get("/api/admin/shipments/:id/packing-slip", requireAuth, html(renderSlip));
}
