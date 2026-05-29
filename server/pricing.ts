import { storage } from "./storage";
import type { Inventory } from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";

// ===================================================================
// Pricing feed module
// - Scryfall for Magic The Gathering
// - TCGdex for Pok\u00e9mon
// - Claude (existing) as a fallback for everything else
// ===================================================================

const UA = "CCC-Inventory/1.0";
const COMMON_HEADERS = {
  "User-Agent": UA,
  Accept: "application/json",
};

// --- 1-hour in-memory cache ---------------------------------------------------
interface CacheEntry {
  result: PriceResult;
  expiresAt: number;
}
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheKey(franchise: string, name: string, set: string) {
  return `${franchise}:${(name ?? "").toLowerCase().trim()}:${(set ?? "").toLowerCase().trim()}`;
}
function cacheGet(key: string): PriceResult | null {
  const e = CACHE.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return e.result;
}
function cacheSet(key: string, result: PriceResult) {
  CACHE.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

export type PriceSource = "Scryfall" | "TCGdex" | "AI est" | "Manual" | "Seed";

export interface PriceResult {
  marketValue: number | null;
  imageUrl: string | null;
  source: PriceSource;
  note?: string;
}

// --- helpers ------------------------------------------------------------------
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// --- Scryfall -----------------------------------------------------------------
export async function getScryfallPrice(
  name: string,
  set?: string | null
): Promise<PriceResult | null> {
  if (!name) return null;
  const params = new URLSearchParams();
  params.set("fuzzy", name);
  if (set) params.set("set", set.toLowerCase().replace(/^.*?([a-z0-9]{2,5}).*$/i, "$1"));
  const url = `https://api.scryfall.com/cards/named?${params.toString()}`;
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) return null;
    const data: any = await res.json();
    const usdStr = data?.prices?.usd ?? data?.prices?.usd_foil ?? null;
    const price = usdStr ? Number(usdStr) : null;
    const image =
      data?.image_uris?.normal ??
      data?.card_faces?.[0]?.image_uris?.normal ??
      null;
    if (price == null) return null;
    return {
      marketValue: price,
      imageUrl: image,
      source: "Scryfall",
    };
  } catch {
    return null;
  }
}

// --- TCGdex -------------------------------------------------------------------
export async function getTcgdexPrice(
  name: string,
  set?: string | null
): Promise<PriceResult | null> {
  if (!name) return null;
  try {
    // 1. Search by name \u2192 list of minimal cards
    const searchUrl = `https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(name)}`;
    const searchRes = await fetch(searchUrl, { headers: COMMON_HEADERS });
    if (!searchRes.ok) return null;
    const searchData: any = await searchRes.json();
    if (!Array.isArray(searchData) || searchData.length === 0) return null;

    // Narrow by set name if provided (substring match, case-insensitive)
    let chosen: any = searchData[0];
    if (set) {
      const setLc = set.toLowerCase();
      const match = searchData.find((c: any) => {
        const candidateSet = (c?.set?.name ?? c?.set ?? "").toLowerCase?.() ?? "";
        return candidateSet.includes(setLc) || setLc.includes(candidateSet);
      });
      if (match) chosen = match;
    }

    if (!chosen?.id) return null;

    // 2. Fetch full card with pricing
    const detailUrl = `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(chosen.id)}?pricing=true`;
    const detailRes = await fetch(detailUrl, { headers: COMMON_HEADERS });
    if (!detailRes.ok) return null;
    const card: any = await detailRes.json();

    // Pricing sources
    const tcgMarket = firstPriceFrom(card?.pricing?.tcgplayer, "market");
    const tcgMid = firstPriceFrom(card?.pricing?.tcgplayer, "mid");
    const cmAvg = firstPriceFrom(card?.pricing?.cardmarket, "avg");

    let price: number | null = null;
    let note: string | undefined;
    if (tcgMarket != null) price = tcgMarket;
    else if (tcgMid != null) price = tcgMid;
    else if (cmAvg != null) {
      price = cmAvg * 1.08; // EUR \u2192 USD, approximate
      note = "Converted from EUR at ~1.08 (approximate)";
    }

    if (price == null) return null;

    // Image: append /high.png for full-res (TCGdex convention)
    const image = card?.image ? `${card.image}/high.png` : null;

    return {
      marketValue: Math.round(price * 100) / 100,
      imageUrl: image,
      source: "TCGdex",
      note,
    };
  } catch {
    return null;
  }
}

// TCGdex pricing objects nest variants (normal/holo/reverse etc.). Pick the
// first available number at the requested key across any variant.
function firstPriceFrom(obj: any, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  // Direct {key: number}
  if (typeof obj[key] === "number") return obj[key];
  // Variants: {normal: {market: n}, holo: {...}, ...}
  for (const variantKey of Object.keys(obj)) {
    const v = obj[variantKey];
    if (v && typeof v === "object" && typeof v[key] === "number") {
      return v[key];
    }
  }
  return null;
}

// --- Claude fallback (same signature as /api/scan/price) ---------------------
const anthropic = new Anthropic();
// Anthropic real model id (the underscored aliases only work via Perplexity's gateway).
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

export async function getClaudeEstimate(opts: {
  name: string;
  set: string;
  franchise: string;
  rarity: string;
  condition: string;
}): Promise<PriceResult | null> {
  const { name, set, franchise, rarity, condition } = opts;
  if (!name && !set) return null;
  const prompt = `Estimate current secondary-market value in USD for this trading card / product. Reason from general TCG market knowledge (eBay sold, TCGPlayer, etc.). Return ONLY valid JSON:\n{ "marketValue": number (USD), "disclaimer": string }\nDetails:\n- Name: ${name}\n- Set: ${set}\n- Franchise: ${franchise}\n- Rarity: ${rarity}\n- Condition: ${condition || "NM"}\n\nIf uncertain, return a best-guess number and make the disclaimer clearly call out the uncertainty. Always include the disclaimer string. Never return null for marketValue \u2014 use 0 if completely unknown.`;
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 250,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.find((b: any) => b.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const v = typeof parsed.marketValue === "number" ? parsed.marketValue : 0;
    return {
      marketValue: v,
      imageUrl: null,
      source: "AI est",
      note: parsed.disclaimer,
    };
  } catch {
    return null;
  }
}

// --- Per-item refresh ---------------------------------------------------------
export async function refreshItem(item: Inventory): Promise<PriceResult> {
  const name = item.name;
  const set = item.setName ?? null;
  const franchise = item.franchise;

  const key = cacheKey(franchise, name, set ?? "");
  const hit = cacheGet(key);
  if (hit) return hit;

  let result: PriceResult | null = null;
  if (franchise === "Magic The Gathering") {
    result = await getScryfallPrice(name, set);
  } else if (franchise === "Pok\u00e9mon") {
    result = await getTcgdexPrice(name, set);
  }

  // Fallback to Claude for Other / One Piece / DBZ / Union Arena / LoL \u2014 and as
  // last-resort fallback if the dedicated API returned null.
  if (!result) {
    const fallback = await getClaudeEstimate({
      name,
      set: set ?? "",
      franchise,
      rarity: item.rarity ?? "",
      condition: item.condition ?? "NM",
    });
    if (fallback) result = fallback;
  }

  if (!result) {
    result = { marketValue: null, imageUrl: null, source: "AI est", note: "Unable to estimate" };
  }

  cacheSet(key, result);
  return result;
}

// Clean a messy Pokemon card name from spreadsheet imports.
// Input examples:
//   "Kirlia - 212/198 - SV01: Scarlet & Violet Base Set (SVI)"
//   "N's Zoroark ex - 185/159 - SV09: Journey Together (JTG)"
//   "Umbreon VMAX - SWSH07: Evolving Skies (SWSH07)"
// Returns: { cleanName, collectorNumber, setCode }
function parsePokemonName(raw: string): {
  cleanName: string;
  collectorNumber: string | null;
  setCode: string | null;
} {
  let cleanName = raw;
  let collectorNumber: string | null = null;
  let setCode: string | null = null;

  // Pull out collector number like "212/198"
  const numMatch = raw.match(/\b(\d{1,4})\s*\/\s*\d{1,4}\b/);
  if (numMatch) collectorNumber = numMatch[1];

  // Pull out trailing set code in parens like "(SVI)" or "(SWSH07)"
  const codeMatch = raw.match(/\(([A-Z0-9]{2,8})\)\s*$/);
  if (codeMatch) setCode = codeMatch[1];

  // Trim everything after the first ' - ' if it contains a collector number or set code
  const dashIdx = raw.indexOf(" - ");
  if (dashIdx > 0) {
    const tail = raw.slice(dashIdx);
    if (/\d+\s*\/\s*\d+/.test(tail) || /\([A-Z0-9]{2,8}\)/.test(tail)) {
      cleanName = raw.slice(0, dashIdx).trim();
    }
  }
  // Drop any parenthetical (Alternate Full Art) tags as well
  cleanName = cleanName.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return { cleanName, collectorNumber, setCode };
}

// Pokemon TCG API (pokemontcg.io) lookup. Free, no key required.
// Has both cards (with high-res images) AND set logos.
async function getPokemonTcgImage(
  cleanName: string,
  setHint: string | null,
  number: string | null
): Promise<string | null> {
  try {
    // Build a Lucene-style query against the v2 cards endpoint
    const parts: string[] = [];
    if (cleanName) parts.push(`name:"${cleanName.replace(/"/g, "\\\"")}"`);
    if (number) parts.push(`number:${number}`);
    if (setHint) parts.push(`set.name:"${setHint.replace(/"/g, "\\\"")}"`);
    const q = parts.join(" ");
    const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=5`;
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) return null;
    const data: any = await res.json();
    const card = data?.data?.[0];
    return card?.images?.large || card?.images?.small || null;
  } catch {
    return null;
  }
}

// Get the set logo image (used as fallback for sealed Pokemon products)
async function getPokemonSetLogo(setHint: string | null): Promise<string | null> {
  if (!setHint) return null;
  try {
    // Strip parenthetical and "SV01:" style prefix
    const cleanSet = setHint
      .replace(/^[A-Z]{1,4}\d{0,3}:\s*/i, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
    const url = `https://api.pokemontcg.io/v2/sets?q=${encodeURIComponent(`name:"${cleanSet}"`)}&pageSize=3`;
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) return null;
    const data: any = await res.json();
    const set = data?.data?.[0];
    return set?.images?.logo || set?.images?.symbol || null;
  } catch {
    return null;
  }
}

// TCGplayer public search API. Returns the productId of the top hit, which
// lets us build a direct image URL: https://product-images.tcgplayer.com/fit-in/437x437/<id>.jpg
// Works for ALL franchises (Pokemon, MTG, Yu-Gi-Oh, One Piece, DBZ, Union Arena, etc.) and ALL
// product types (singles, booster boxes, ETBs, tins, decks).
const TCGPLAYER_PRODUCT_LINE_MAP: Record<string, string> = {
  "Pok\u00e9mon": "Pokemon",
  "Magic The Gathering": "Magic: The Gathering",
  "One Piece": "One Piece Card Game",
  "DBZ": "Dragon Ball Super CCG",
  "Yu-Gi-Oh": "YuGiOh",
  "Union Arena": "Union Arena",
  "League of Legends": "Riftbound",
};

// Expand common short-hand product names ("ETB", "BB") to what TCGplayer indexes.
function expandProductName(rawName: string): string {
  if (!rawName) return "";
  let n = rawName.trim();
  // Whole-word substitutions, longest first
  const replacements: [RegExp, string][] = [
    [/\bElite Trainer Box\b/gi, "Elite Trainer Box"],
    [/\bETB\b/gi, "Elite Trainer Box"],
    [/\bBooster Bundle Display\b/gi, "Booster Bundle"],
    [/\bBooster Display\b/gi, "Booster Box"],
    [/\bBB\b/gi, "Booster Box"],
    [/\bUPC\b/gi, "Ultra Premium Collection"],
    [/\bPC\b/gi, "Premium Collection"],
  ];
  for (const [re, to] of replacements) n = n.replace(re, to);
  return n;
}

async function getTcgplayerImage(
  rawName: string,
  setHint: string | null,
  franchise: string
): Promise<string | null> {
  if (!rawName) return null;
  try {
    const productLine = TCGPLAYER_PRODUCT_LINE_MAP[franchise];
    const expandedName = expandProductName(rawName);
    // Build query: set + expanded name (set first because TCGplayer product
    // names always start with the set, e.g. "Surging Sparks Elite Trainer Box").
    const queryParts: string[] = [];
    if (setHint) queryParts.push(setHint);
    queryParts.push(expandedName);
    const query = queryParts.join(" ");
    const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(query)}&isList=false`;
    const body = {
      algorithm: "",
      from: 0,
      size: 10,
      filters: { term: {}, range: {}, match: {} },
      sort: {},
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        Accept: "application/json",
        Origin: "https://www.tcgplayer.com",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const items: any[] = data?.results?.[0]?.results ?? [];
    if (!items.length) return null;
    // Prefer the first item matching the franchise's TCGplayer productLineName,
    // otherwise fall back to the absolute top result.
    let pick = productLine
      ? items.find(
          (i: any) =>
            String(i?.productLineName || "").toLowerCase() ===
            productLine.toLowerCase()
        )
      : null;
    if (!pick) pick = items[0];
    const id = pick?.productId;
    if (!id) return null;
    return `https://product-images.tcgplayer.com/fit-in/437x437/${Math.trunc(
      Number(id)
    )}.jpg`;
  } catch {
    return null;
  }
}

// Detect if an item is sealed product (Booster Box, ETB, etc.)
function isSealedProduct(item: Inventory): boolean {
  if (item.category && /sealed/i.test(item.category)) return true;
  const n = (item.name || "").toLowerCase();
  return /\b(booster|etb|elite trainer|bundle|display|tin|collection box|premium|sealed|pack|deck box|battle box|theme deck)\b/.test(
    n
  );
}

// Fetch only an image URL for an item (no pricing).
// Strategy (in order):
//   1. MTG -> Scryfall  /  Pokemon -> TCGdex (existing)
//   2. Pokemon -> pokemontcg.io with cleaned name + collector number
//   3. Sealed Pokemon products -> set logo from pokemontcg.io
//   4. Other franchises -> ask Claude for a public image URL
export async function fetchImageOnly(item: Inventory): Promise<string | null> {
  const rawName = item.name;
  const set = item.setName ?? null;
  const franchise = item.franchise;

  // ---- MTG ----
  if (franchise === "Magic The Gathering") {
    const r = await getScryfallPrice(rawName, set);
    if (r?.imageUrl) return r.imageUrl;
  }

  // ---- Pokemon ----
  if (franchise === "Pok\u00e9mon") {
    const { cleanName, collectorNumber, setCode } = parsePokemonName(rawName);

    // For sealed Pokemon product, prefer TCGplayer (real product photo) before
    // falling back to card-database queries (which only know about singles).
    if (isSealedProduct(item)) {
      const tcgp = await getTcgplayerImage(rawName, set, franchise);
      if (tcgp) return tcgp;
    }

    // Try TCGdex with the cleaned name first
    const tcgdex = await getTcgdexPrice(cleanName, set);
    if (tcgdex?.imageUrl) return tcgdex.imageUrl;

    // Try pokemontcg.io with cleaned name + number + set hint
    const ptcg = await getPokemonTcgImage(cleanName, set, collectorNumber);
    if (ptcg) return ptcg;

    // Try pokemontcg.io with the set code only (last resort name match)
    if (setCode) {
      const ptcg2 = await getPokemonTcgImage(cleanName, setCode, collectorNumber);
      if (ptcg2) return ptcg2;
    }

    // Sealed products: fall back to set logo (better than blank)
    if (isSealedProduct(item)) {
      const logo = await getPokemonSetLogo(set);
      if (logo) return logo;
    }
  }

  // ---- MTG sealed product: Scryfall doesn't have sealed images. Try TCGplayer. ----
  if (franchise === "Magic The Gathering" && isSealedProduct(item)) {
    const tcgp = await getTcgplayerImage(rawName, set, franchise);
    if (tcgp) return tcgp;
  }

  // ---- TCGplayer search (works for ALL franchises + sealed product) ----
  const tcgpAll = await getTcgplayerImage(rawName, set, franchise);
  if (tcgpAll) return tcgpAll;

  // ---- Last resort: ask Claude for a public image URL ----
  try {
    const prompt = `Provide a single direct public image URL (ends in .jpg, .jpeg, .png, or .webp) for this trading card / collectible product. Prefer images hosted on tcgplayer.com (product-images.tcgplayer.com), TCGdex, Scryfall, the official manufacturer site, or a well-known card database. Return ONLY valid JSON:\n{ "imageUrl": string | null }\nProduct:\n- Name: ${rawName}\n- Set: ${set ?? ""}\n- Franchise: ${franchise}\n- Rarity: ${item.rarity ?? ""}\nIf you cannot find a high-confidence direct image URL, return null. Do not fabricate URLs.`;
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.find((b: any) => b.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const url = typeof parsed.imageUrl === "string" ? parsed.imageUrl.trim() : null;
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) return null;
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) {
      if (!/(scryfall|tcgdex|tcgplayer|pokemontcg)/i.test(url)) return null;
    }
    return url;
  } catch {
    return null;
  }
}

// Bulk image fetch with throttling. Only touches items where imageUrl is null.
// Process a SMALL batch of items that need images. Returns counts for THIS
// batch plus the remaining work, so the client can loop. Each successful
// lookup is persisted to the DB before the next iteration, so progress
// survives server restarts.
export async function fetchMissingImagesBatch(
  batchSize: number = 15
): Promise<{
  updated: number;
  skipped: number;
  failed: number;
  processed: number;
  remaining: number;
  total: number;
  withImage: number;
}> {
  const items = await storage.listInventory();
  const allCandidates = items.filter(
    (i) => !i.imageUrl && (i.status === "In Inventory" || i.status === "Listed")
  );
  const batch = allCandidates.slice(0, batchSize);
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;

  for (const item of batch) {
    try {
      const url = await fetchImageOnly(item);
      if (url) {
        await storage.updateInventory(item.id, { imageUrl: url } as any);
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error("[pricing] image fetch failed for", item.id, err);
      failed++;
    }
    processed++;
    // Lower sleeps now that TCGplayer is the primary source (single fast API).
    if (item.franchise === "Magic The Gathering") await sleep(100);
    else if (item.franchise === "Pok\u00e9mon") await sleep(150);
    else await sleep(100);
  }

  const withImage =
    items.filter((i) => i.imageUrl).length + updated;
  return {
    updated,
    skipped,
    failed,
    processed,
    remaining: allCandidates.length - processed,
    total: items.length,
    withImage,
  };
}

// Attempts only the real sources; returns null if nothing found. Used by the
// legacy /api/scan/price endpoint to try real APIs before falling back to AI.
export async function tryRealSourcesOnly(opts: {
  name: string;
  set: string;
  franchise: string;
}): Promise<PriceResult | null> {
  const { franchise, name, set } = opts;
  if (franchise === "Magic The Gathering") {
    const r = await getScryfallPrice(name, set);
    if (r) return r;
  } else if (franchise === "Pok\u00e9mon") {
    const r = await getTcgdexPrice(name, set);
    if (r) return r;
  }
  return null;
}

// --- Persist helpers ----------------------------------------------------------
export async function persistRefreshResult(
  item: Inventory,
  result: PriceResult
) {
  const patch: Partial<Inventory> = {};
  if (result.marketValue != null) {
    patch.marketValue = result.marketValue;
  }
  if (result.imageUrl && !item.imageUrl) {
    patch.imageUrl = result.imageUrl;
  }
  if (Object.keys(patch).length > 0) {
    await storage.updateInventory(item.id, patch as any);
  }
  if (result.marketValue != null) {
    await storage.createPriceHistory({
      itemId: item.id,
      price: result.marketValue,
      source: result.source,
    });
  }
}

// --- Bulk refresh with throttling --------------------------------------------
export async function refreshAll(): Promise<{
  updated: number;
  failed: number;
  skipped: number;
}> {
  const items = await storage.listInventory();
  const active = items.filter((i) => i.status === "In Inventory" || i.status === "Listed");
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of active) {
    try {
      const result = await refreshItem(item);
      if (result.marketValue != null) {
        await persistRefreshResult(item, result);
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error("[pricing] refresh failed for", item.id, err);
      failed++;
    }
    // Throttle: 150ms for Scryfall (MTG), 500ms for TCGdex (Pok\u00e9mon), 0 otherwise
    if (item.franchise === "Magic The Gathering") {
      await sleep(150);
    } else if (item.franchise === "Pok\u00e9mon") {
      await sleep(500);
    } else {
      await sleep(50);
    }
  }

  return { updated, failed, skipped };
}

export { sleep };
