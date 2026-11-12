/**
 * Shipping: USPS Ground Advantage retail postage, priced the way USPS does —
 * by distance zone (origin ZIP → destination ZIP) and by weight (ounce tiers
 * up to 15.999 oz, then whole pounds).
 *
 * Zones are derived from the great-circle distance between 3-digit ZIP
 * prefix centroids (U.S. Census 2020 ZCTA gazetteer) using the USPS mileage
 * bands. Rate tables come from USPS Notice 123; two are kept so the price
 * flips automatically when the holiday table expires:
 *   - Oct 4, 2026 – Jan 17, 2027  (temporary holiday prices)
 *   - Jul 12, 2026 base prices    (before and after)
 *
 * Shipping is charged on top of the cards and is NOT taxed: California does
 * not tax separately stated delivery charges by common carrier.
 */
import ZIP3_RAW from "./zip3.json";

const ZIP3 = ZIP3_RAW as unknown as Record<string, [number, number]>;

export const SHIPPING_SERVICE = "USPS Ground Advantage";
export const SHIPPING_DAYS = "2–5 business days";

export type ShippingSettings = {
  enabled: boolean;
  /** Ship-from ZIP (5 digits). */
  originZip: string;
  /** Flat handling added to postage, dollars. */
  handlingFee: number;
  /** Free shipping when the merchandise subtotal reaches this, dollars; null = never. */
  freeOver: number | null;
  /** Estimated weight per item, ounces, by inventory category. */
  ozRaw: number;
  ozSlab: number;
  ozSealed: number;
  /** Mailer / box / padding, ounces per parcel. */
  ozPackaging: number;
};

export const DEFAULT_SHIPPING: ShippingSettings = {
  enabled: true,
  originZip: "94612",
  handlingFee: 0,
  freeOver: null,
  ozRaw: 0.6,      // sleeve + toploader + team bag
  ozSlab: 3.5,     // PSA/CGC/BGS slab in a sleeve
  ozSealed: 12,    // blister / small box; owner can raise for ETBs
  ozPackaging: 2,  // bubble mailer + cardboard sandwich
};

export function mergeShippingSettings(saved: Partial<ShippingSettings> | null | undefined): ShippingSettings {
  const s = saved ?? {};
  const num = (v: unknown, d: number, min = 0, max = 1000) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const zip = String(s.originZip ?? "").replace(/\D/g, "").slice(0, 5);
  return {
    enabled: s.enabled === undefined ? DEFAULT_SHIPPING.enabled : !!s.enabled,
    originZip: zip.length === 5 ? zip : DEFAULT_SHIPPING.originZip,
    handlingFee: num(s.handlingFee, DEFAULT_SHIPPING.handlingFee, 0, 100),
    freeOver: s.freeOver == null || s.freeOver === ("" as any) ? null : num(s.freeOver, 0, 0, 100000) || null,
    ozRaw: num(s.ozRaw, DEFAULT_SHIPPING.ozRaw, 0.1, 64),
    ozSlab: num(s.ozSlab, DEFAULT_SHIPPING.ozSlab, 0.1, 64),
    ozSealed: num(s.ozSealed, DEFAULT_SHIPPING.ozSealed, 0.1, 1120),
    ozPackaging: num(s.ozPackaging, DEFAULT_SHIPPING.ozPackaging, 0, 64),
  };
}

/* ------------------------------------------------------------------ */
/*  Zones                                                              */
/* ------------------------------------------------------------------ */

export function normalizeZip(input: string | null | undefined): string | null {
  const m = String(input ?? "").trim().match(/^(\d{5})(?:-?\d{4})?$/);
  return m ? m[1] : null;
}

export function zipKnown(zip: string): boolean {
  return !!ZIP3[zip.slice(0, 3)];
}

function haversineMiles(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** USPS mileage bands: 1 ≤50, 2 ≤150, 3 ≤300, 4 ≤600, 5 ≤1000, 6 ≤1400, 7 ≤1800, 8 beyond. */
export function zoneForMiles(miles: number): number {
  if (miles <= 50) return 1;
  if (miles <= 150) return 2;
  if (miles <= 300) return 3;
  if (miles <= 600) return 4;
  if (miles <= 1000) return 5;
  if (miles <= 1400) return 6;
  if (miles <= 1800) return 7;
  return 8;
}

export function zoneBetween(originZip: string, destZip: string): { zone: number; miles: number } | null {
  const o = ZIP3[originZip.slice(0, 3)];
  const d = ZIP3[destZip.slice(0, 3)];
  if (!o || !d) return null;
  if (originZip.slice(0, 3) === destZip.slice(0, 3)) return { zone: 1, miles: 0 };
  const miles = haversineMiles(o, d);
  return { zone: zoneForMiles(miles), miles: Math.round(miles) };
}

/* ------------------------------------------------------------------ */
/*  Rate tables — USPS Ground Advantage, Retail (Notice 123)           */
/*  Row: [max weight in ounces, zone1..zone9]                           */
/* ------------------------------------------------------------------ */

type RateRow = [number, number, number, number, number, number, number, number, number, number];

const LB = 16;

// Effective Oct 4, 2026 – Jan 17, 2027 (usps.com s-ground-advantage-retail.xlsx, final 9/14/2026)
const GA_RETAIL_2026_HOLIDAY: RateRow[] = [
  [4, 8.4, 8.55, 8.65, 8.8, 9.35, 9.5, 9.7, 10.2, 10.2],
  [8, 8.4, 8.55, 8.65, 8.8, 9.35, 9.5, 9.7, 10.2, 10.2],
  [12, 10.05, 10.45, 10.7, 11.1, 11.7, 12.1, 12.7, 13.65, 13.65],
  [15.999, 10.05, 10.45, 10.7, 11.1, 11.7, 12.1, 12.7, 13.65, 13.65],
  [1 * LB, 10.05, 10.45, 10.7, 11.1, 11.7, 12.1, 12.7, 13.65, 13.65],
  [2 * LB, 11.3, 12, 12.7, 13.5, 14.85, 15.85, 17.2, 19.8, 19.8],
  [3 * LB, 11.8, 12.5, 13.15, 14.2, 15.7, 17.2, 19.7, 23.15, 23.15],
  [4 * LB, 13.05, 13.55, 14.45, 15.65, 17.8, 19.7, 22.3, 25.65, 25.65],
  [5 * LB, 13.75, 14.35, 15.35, 16.6, 18.85, 21, 23.8, 27.45, 27.45],
  [6 * LB, 14.3, 14.7, 15.65, 17.15, 19.8, 22.45, 25.75, 29.75, 29.75],
  [7 * LB, 14.8, 15.2, 16.2, 17.9, 20.85, 23.95, 27.65, 32, 32],
  [8 * LB, 15.4, 15.65, 16.6, 18.45, 21.8, 25.5, 29.85, 34.55, 34.55],
  [9 * LB, 15.9, 16.2, 17.05, 19.1, 22.8, 26.95, 32.15, 37.1, 37.1],
  [10 * LB, 16.75, 17.1, 18.05, 20.2, 24.25, 28.9, 34.7, 40.85, 40.85],
  [11 * LB, 18, 18.55, 19.4, 21.65, 26.95, 32.2, 38.7, 46.05, 46.05],
  [12 * LB, 18.7, 19.1, 19.9, 22.55, 28.15, 34, 41.4, 49.25, 49.25],
  [13 * LB, 19.45, 19.75, 20.4, 23, 29.15, 35.85, 44.45, 53.75, 53.75],
  [14 * LB, 20.2, 20.3, 20.9, 23.8, 30.55, 38, 47.55, 57.65, 57.65],
  [15 * LB, 20.9, 21, 21.65, 24.45, 31.7, 39.5, 49.4, 60.1, 60.1],
  [16 * LB, 21.65, 21.8, 22.45, 25.55, 32.95, 41, 51.25, 62.65, 62.65],
  [17 * LB, 22.4, 22.65, 23.15, 26.65, 34.2, 42.7, 53.55, 65.6, 65.6],
  [18 * LB, 23.1, 23.35, 23.9, 27.2, 35.55, 44.5, 55.9, 68.6, 68.6],
  [19 * LB, 23.55, 23.8, 24.85, 27.65, 36.55, 45.55, 56.85, 70.75, 70.75],
  [20 * LB, 24, 24.2, 25.7, 28.55, 37.9, 47, 58.25, 72.15, 72.15],
];

// Effective Jul 12, 2026 (Notice 123, July 2026 price change); resumes Jan 18, 2027.
const GA_RETAIL_2026_JULY: RateRow[] = [
  [4, 7.9, 8.05, 8.15, 8.3, 8.6, 8.75, 8.95, 9.45, 9.45],
  [8, 7.9, 8.05, 8.15, 8.3, 8.6, 8.75, 8.95, 9.45, 9.45],
  [12, 9.55, 9.95, 10.2, 10.6, 10.95, 11.35, 11.95, 12.9, 12.9],
  [15.999, 9.55, 9.95, 10.2, 10.6, 10.95, 11.35, 11.95, 12.9, 12.9],
  [1 * LB, 9.55, 9.95, 10.2, 10.6, 10.95, 11.35, 11.95, 12.9, 12.9],
  [2 * LB, 10.8, 11.5, 12.2, 13, 14.1, 15.1, 16.45, 19.05, 19.05],
  [3 * LB, 11.3, 12, 12.65, 13.7, 14.95, 16.45, 18.95, 22.4, 22.4],
  [4 * LB, 12.25, 12.75, 13.65, 14.85, 16.4, 18.3, 20.9, 24.25, 24.25],
  [5 * LB, 12.95, 13.55, 14.55, 15.8, 17.45, 19.6, 22.4, 26.05, 26.05],
  [6 * LB, 13.5, 13.9, 14.85, 16.35, 18.4, 21.05, 24.35, 28.35, 28.35],
  [7 * LB, 14, 14.4, 15.4, 17.1, 19.45, 22.55, 26.25, 30.6, 30.6],
  [8 * LB, 14.6, 14.85, 15.8, 17.65, 20.4, 24.1, 28.45, 33.15, 33.15],
  [9 * LB, 15.1, 15.4, 16.25, 18.3, 21.4, 25.55, 30.75, 35.7, 35.7],
  [10 * LB, 15.95, 16.3, 17.25, 19.4, 22.85, 27.5, 33.3, 39.45, 39.45],
  [11 * LB, 16.75, 17.3, 18.15, 20.4, 24.2, 29.45, 35.95, 43.3, 43.3],
  [12 * LB, 17.45, 17.85, 18.65, 21.3, 25.4, 31.25, 38.65, 46.5, 46.5],
  [13 * LB, 18.2, 18.5, 19.15, 21.75, 26.4, 33.1, 41.7, 51, 51],
  [14 * LB, 18.95, 19.05, 19.65, 22.55, 27.8, 35.25, 44.8, 54.9, 54.9],
  [15 * LB, 19.65, 19.75, 20.4, 23.2, 28.95, 36.75, 46.65, 57.35, 57.35],
  [16 * LB, 20.4, 20.55, 21.2, 24.3, 30.2, 38.25, 48.5, 59.9, 59.9],
  [17 * LB, 21.15, 21.4, 21.9, 25.4, 31.45, 39.95, 50.8, 62.85, 62.85],
  [18 * LB, 21.85, 22.1, 22.65, 25.95, 32.8, 41.75, 53.15, 65.85, 65.85],
  [19 * LB, 22.3, 22.55, 23.6, 26.4, 33.8, 42.8, 54.1, 68, 68],
  [20 * LB, 22.75, 22.95, 24.45, 27.3, 35.15, 44.25, 55.5, 69.4, 69.4],
];

export function rateTableFor(date = new Date()): { rows: RateRow[]; label: string } {
  const t = date.getTime();
  const holidayStart = Date.UTC(2026, 9, 4);   // Oct 4, 2026
  const holidayEnd = Date.UTC(2027, 0, 18);    // through Jan 17, 2027
  if (t >= holidayStart && t < holidayEnd) return { rows: GA_RETAIL_2026_HOLIDAY, label: "USPS retail prices effective Oct 4, 2026" };
  return { rows: GA_RETAIL_2026_JULY, label: "USPS retail prices effective Jul 12, 2026" };
}

/** Postage for a parcel of `ounces` to `zone`, or null if over the table's 20 lb limit. */
export function groundAdvantagePostage(ounces: number, zone: number, date = new Date()): { postage: number; tier: string } | null {
  const z = Math.min(9, Math.max(1, Math.round(zone)));
  const { rows } = rateTableFor(date);
  const oz = Math.max(0.1, ounces);
  for (const row of rows) {
    if (oz <= row[0]) {
      const tier = row[0] < LB ? `${row[0] === 15.999 ? "15.999" : row[0]} oz` : `${Math.round(row[0] / LB)} lb`;
      return { postage: row[z], tier };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Quote                                                              */
/* ------------------------------------------------------------------ */

export type ShipItem = { category: string | null | undefined; quantity: number };

export type ShippingQuote =
  | {
      ok: true;
      service: string;
      zone: number;
      miles: number;
      ounces: number;
      tier: string;
      postage: number;
      handling: number;
      /** What the customer pays (0 when free shipping applies). */
      amount: number;
      free: boolean;
      destZip: string;
      rates: string;
    }
  | { ok: false; reason: string };

export function ouncesFor(items: ShipItem[], s: ShippingSettings): number {
  let oz = s.ozPackaging;
  for (const it of items) {
    const q = Math.max(0, Math.floor(it.quantity || 0));
    const c = String(it.category ?? "").toLowerCase();
    oz += q * (c === "slab" ? s.ozSlab : c === "sealed" ? s.ozSealed : s.ozRaw);
  }
  return Math.round(oz * 10) / 10;
}

export function quoteShipping(
  items: ShipItem[],
  destZipInput: string | null | undefined,
  settings: ShippingSettings,
  merchandiseSubtotal: number,
  date = new Date(),
): ShippingQuote {
  if (!settings.enabled) {
    return { ok: true, service: SHIPPING_SERVICE, zone: 0, miles: 0, ounces: 0, tier: "", postage: 0, handling: 0, amount: 0, free: true, destZip: "", rates: "" };
  }
  const destZip = normalizeZip(destZipInput);
  if (!destZip) return { ok: false, reason: "Enter a 5-digit US ZIP code." };
  const zb = zoneBetween(settings.originZip, destZip);
  if (!zb) return { ok: false, reason: "We can't find that ZIP code. Double-check it, or DM us for a quote." };
  const ounces = ouncesFor(items, settings);
  const rate = groundAdvantagePostage(ounces, zb.zone, date);
  if (!rate) return { ok: false, reason: "That order is over 20 lb — DM us for a shipping quote." };
  const handling = Math.round(settings.handlingFee * 100) / 100;
  const free = settings.freeOver != null && merchandiseSubtotal >= settings.freeOver;
  const amount = free ? 0 : Math.round((rate.postage + handling) * 100) / 100;
  return {
    ok: true,
    service: SHIPPING_SERVICE,
    zone: zb.zone,
    miles: zb.miles,
    ounces,
    tier: rate.tier,
    postage: rate.postage,
    handling,
    amount,
    free,
    destZip,
    rates: rateTableFor(date).label,
  };
}
