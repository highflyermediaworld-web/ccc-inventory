import { storage } from "./storage";
import type { Inventory } from "@shared/schema";
import { aiText } from "./ai";

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

export type PriceSource = "Scryfall" | "PokemonTCG" | "TCGdex" | "AI est" | "Manual" | "Seed";

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
// ---------------------------------------------------------------------------
// Free Pokémon TCG API (pokemontcg.io) — US-focused TCGplayer market prices.
// No API key required for public data; optional POKEMON_TCG_API_KEY env var
// raises rate limits if set. Response has `tcgplayer.prices` keyed by variant
// (normal, holofoil, reverseHolofoil, etc.) with { low, mid, high, market, directLow }.
// ---------------------------------------------------------------------------
async function getPokemonTcgApiPrice(
  name: string,
  set?: string | null,
  rarity?: string | null,
): Promise<PriceResult | null> {
  if (!name) return null;
  try {
    // Parse messy import names first (e.g. "Kirlia - 212/198 - SV01: Scarlet & Violet Base Set (SVI)")
    const parsed = parsePokemonName(name);
    const cleanName = parsed.cleanName || name;
    const collectorNumber = parsed.collectorNumber;
    const setHint = set || parsed.setCode || null;

    // Escape special Lucene chars in the name. Wrap in quotes for full-phrase match.
    const escapedName = cleanName.replace(/["\\]/g, "");
    const nameClause = `name:"${escapedName}"`;
    const numberClause = collectorNumber ? `number:${collectorNumber}` : "";

    const headers: Record<string, string> = { ...COMMON_HEADERS };
    if (process.env.POKEMON_TCG_API_KEY) {
      headers["X-Api-Key"] = process.env.POKEMON_TCG_API_KEY;
    }

    const searchOnce = async (query: string) => {
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(
        query,
      )}&pageSize=25&orderBy=-set.releaseDate`;
      const res = await fetch(url, { headers });
      if (!res.ok) return [];
      const data: any = await res.json();
      return Array.isArray(data?.data) ? data.data : [];
    };

    // Broad search by name (+ number if we have it). We'll filter by set client-side
    // — quoted set names in Lucene are brittle for names like "151" or with special chars.
    const baseQ = [nameClause, numberClause].filter(Boolean).join(" ");
    let cards: any[] = await searchOnce(baseQ);

    // If nothing on name+number, retry name-only (in case the number was wrong).
    if (cards.length === 0 && numberClause) {
      cards = await searchOnce(nameClause);
    }
    if (cards.length === 0) return null;

    // Score candidates by set-name overlap with the hint (case-insensitive).
    // If no hint, take the newest (already sorted by set.releaseDate desc).
    let card = cards[0];
    if (setHint) {
      const setLc = setHint.toLowerCase().replace(/[()]/g, "").trim();
      const scored = cards.map((c) => {
        const cSet = (c?.set?.name || "").toLowerCase();
        const cSeries = (c?.set?.series || "").toLowerCase();
        let score = 0;
        if (cSet === setLc) score += 100;
        else if (cSet.includes(setLc) || setLc.includes(cSet)) score += 50;
        if (cSeries.includes(setLc) || setLc.includes(cSeries)) score += 10;
        // Prefer cards that actually have TCGplayer prices.
        if (c?.tcgplayer?.prices) score += 5;
        return { c, score };
      });
      scored.sort((a, b) => b.score - a.score);
      if (scored[0].score > 0) card = scored[0].c;
    }

    // Pick the best price from tcgplayer.prices variants.
    // Prefer holofoil for rare/holo cards, else normal, else first available.
    const tp = card?.tcgplayer?.prices || {};
    const variantKeys = Object.keys(tp);
    let variant: string | null = null;
    const rLc = (rarity || "").toLowerCase();
    const isHoloish =
      rLc.includes("holo") ||
      rLc.includes("rare") ||
      rLc.includes("vmax") ||
      rLc.includes("vstar") ||
      rLc.includes("ex") ||
      rLc.includes("gx");
    const pref = isHoloish
      ? ["holofoil", "reverseHolofoil", "normal", "unlimitedHolofoil", "1stEditionHolofoil"]
      : ["normal", "holofoil", "reverseHolofoil"];
    for (const k of pref) {
      if (variantKeys.includes(k)) {
        variant = k;
        break;
      }
    }
    if (!variant && variantKeys.length > 0) variant = variantKeys[0];

    let price: number | null = null;
    if (variant) {
      const v = tp[variant] || {};
      if (typeof v.market === "number" && v.market > 0) price = v.market;
      else if (typeof v.mid === "number" && v.mid > 0) price = v.mid;
      else if (typeof v.directLow === "number" && v.directLow > 0) price = v.directLow;
    }

    // Cardmarket fallback (EUR → USD).
    if (price == null) {
      const cm = card?.cardmarket?.prices || {};
      if (typeof cm.averageSellPrice === "number" && cm.averageSellPrice > 0) {
        price = cm.averageSellPrice * 1.08;
      } else if (typeof cm.trendPrice === "number" && cm.trendPrice > 0) {
        price = cm.trendPrice * 1.08;
      }
    }

    if (price == null) return null;

    const image = card?.images?.large || card?.images?.small || null;
    const noteBits: string[] = [];
    if (variant && variant !== "normal") noteBits.push(`${variant} variant`);
    if (card?.set?.name) noteBits.push(`set: ${card.set.name}`);

    return {
      marketValue: Math.round(price * 100) / 100,
      imageUrl: image,
      source: "PokemonTCG",
      note: noteBits.join(", ") || undefined,
    };
  } catch {
    return null;
  }
}

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
    const text = await aiText(prompt, { maxTokens: 250 });
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

// --- Graded slab detection + AI-based graded price estimate ------------------
// TCGplayer's public search/pricepoints API does not surface graded slabs as
// separate products — those listings live on eBay-style channels. For graded
// items we still fetch the raw TCGplayer points (useful as a floor / reference)
// and additionally run an AI estimate anchored on the raw price + the grade,
// then write that into marketValue.
export function isGraded(condition: string | null | undefined): boolean {
  if (!condition) return false;
  const c = String(condition).trim().toUpperCase();
  return /^(PSA|CGC|BGS|SGC|HGA|GMA|ACE)\b/.test(c);
}

// Estimate graded-slab market value in USD using Claude. We pass the raw
// TCGplayer market price (if known) as an anchor so the model produces a
// sensible grade premium instead of a blind guess.
export async function getGradedEstimate(opts: {
  name: string;
  set: string;
  franchise: string;
  rarity: string;
  condition: string;
  rawMarketPrice: number | null;
}): Promise<PriceResult | null> {
  const { name, set, franchise, rarity, condition, rawMarketPrice } = opts;
  if (!name && !set) return null;
  const anchor =
    rawMarketPrice != null && isFinite(rawMarketPrice)
      ? `\n- Raw (ungraded NM) TCGplayer market price reference: $${rawMarketPrice.toFixed(2)}`
      : "";
  const prompt = `Estimate the current secondary-market value in USD for this GRADED slab. Use eBay sold comps, PWCC, TCGplayer graded listings, and general grading premium knowledge. The condition string already encodes the grading company and grade. Return ONLY valid JSON:\n{ "marketValue": number (USD), "disclaimer": string }\nDetails:\n- Name: ${name}\n- Set: ${set}\n- Franchise: ${franchise}\n- Rarity: ${rarity}\n- Grade: ${condition}${anchor}\n\nApply a realistic grade premium over the raw price (PSA 10 is typically 2x-6x raw for modern cards, higher for chase cards; PSA 9 ~1.2x-2x; CGC/BGS slightly less than equivalent PSA). If uncertain, return a best-guess number and clearly call out the uncertainty in the disclaimer. Always include the disclaimer string. Never return null for marketValue — use 0 if completely unknown.`;
  try {
    const text = await aiText(prompt, { maxTokens: 300 });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const v = typeof parsed.marketValue === "number" ? parsed.marketValue : 0;
    return {
      marketValue: v,
      imageUrl: null,
      source: "AI est (graded)",
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
    // Primary: free pokemontcg.io API (US TCGplayer market prices).
    result = await getPokemonTcgApiPrice(name, set, item.rarity);
    // Fallback: TCGdex (mixes TCGplayer + Cardmarket EU).
    if (!result) result = await getTcgdexPrice(name, set);
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

// Common Pokemon / TCG spelling corrections seen in spreadsheet imports.
// We split these from expandProductName so callers can ALSO get a clean
// corrected name to persist back to the inventory row (not just a search query).
const SPELLING_CORRECTIONS: [RegExp, string][] = [
  [/\bCharzard\b/gi, "Charizard"],
  [/\bCharizad\b/gi, "Charizard"],
  [/\bCharzaird\b/gi, "Charizard"],
  [/\bShinning\b/gi, "Shining"],
  [/\bShinnying\b/gi, "Shining"],
  [/\bPikatchu\b/gi, "Pikachu"],
  [/\bPickachu\b/gi, "Pikachu"],
  [/\bPickachoo\b/gi, "Pikachu"],
  [/\bMewto\b/gi, "Mewtwo"],
  [/\bMeuwto\b/gi, "Mewtwo"],
  [/\bLuigia\b/gi, "Lugia"],
  [/\bLughia\b/gi, "Lugia"],
  [/\bUmbeon\b/gi, "Umbreon"],
  [/\bSylvon\b/gi, "Sylveon"],
  [/\bRayqaza\b/gi, "Rayquaza"],
  [/\bRayquza\b/gi, "Rayquaza"],
  [/\bGyrados\b/gi, "Gyarados"],
  [/\bGiratena\b/gi, "Giratina"],
  [/\bArceaus\b/gi, "Arceus"],
  [/\bLatia's\b/gi, "Latias"],
  [/\.D\.\s+(?=[A-Z])/g, ".D."],
  [/\(\s*ALT\s*\)/gi, "(Alternate Art)"],
  [/\(\s*Alt Art\s*\)/gi, "(Alternate Art)"],
  [/\(\s*AA\s*\)/gi, "(Alternate Art)"],
  [/\bFeraligator\b/gi, "Feraligatr"],
  [/\bPokeball\b/gi, "Poke Ball"],
  [/\bLarrys\b/gi, "Larry's"],
  [/\bLatio's\b/gi, "Latios"],
  [/\bDailga\b/gi, "Dialga"],
  [/\bPalika\b/gi, "Palkia"],
  [/\bSnorlex\b/gi, "Snorlax"],
  [/\bGardvor\b/gi, "Gardevoir"],
  [/\bGardivoir\b/gi, "Gardevoir"],
  [/\bGarchompe\b/gi, "Garchomp"],
  [/\bGreninga\b/gi, "Greninja"],
  [/\bLucareo\b/gi, "Lucario"],
  [/\bZorark\b/gi, "Zoroark"],
  // Common Gen-9 / SV-era typos seen in the inventory
  [/\bQuaquavval\b/gi, "Quaquaval"],
  [/\bVenusuar\b/gi, "Venusaur"],
  [/\bEtahn\b/gi, "Ethan"],
  [/\bEtahn's\b/gi, "Ethan's"],
  [/\bFezanddipiti\b/gi, "Fezandipiti"],
  [/\bFezandidpiti\b/gi, "Fezandipiti"],
  [/\bTogekiff\b/gi, "Togekiss"],
  [/\bTrafalagar\b/gi, "Trafalgar"],
  [/\bGrap\b/gi, "Garp"],
  // Yu-Gi-Oh
  [/\bExodea\b/gi, "Exodia"],
  [/\bDarkmagicain\b/gi, "Dark Magician"],
  // MTG
  [/\bMagic the gathering\b/gi, "Magic: The Gathering"],
];

// Set-name corrections. Used during TCGplayer search and exposed via the
// autocorrect-names endpoint so the inventory's setName column gets cleaned
// up too. Matching is anchored on whole words so "Shinning Fates" -> "Shining
// Fates" while a set called "Shining Legends" stays untouched.
// One Piece set codes -> the set names TCGplayer indexes. Codes themselves
// never appear in TCGplayer product names, so "OP05 - JP" finds nothing.
export const ONE_PIECE_SET_CODES: [RegExp, string][] = [
  [/\bOP-?01\b/gi, "Romance Dawn"],
  [/\bOP-?02\b/gi, "Paramount War"],
  [/\bOP-?03\b/gi, "Pillars of Strength"],
  [/\bOP-?04\b/gi, "Kingdoms of Intrigue"],
  [/\bOP-?05\b/gi, "Awakening of the New Era"],
  [/\bOP-?06\b/gi, "Wings of the Captain"],
  [/\bOP-?07\b/gi, "500 Years in the Future"],
  [/\bOP-?08\b/gi, "Two Legends"],
  [/\bOP-?09\b/gi, "Emperors in the New World"],
  [/\bOP-?10\b/gi, "Royal Blood"],
  [/\bOP-?11\b/gi, "A Fist of Divine Speed"],
  [/\bOP-?12\b/gi, "Legacy of the Master"],
  [/\bOP-?13\b/gi, "Carrying On His Will"],
  [/\bOP-?14\b/gi, "The Azure Sea's Seven"],
  [/\bOP-?15\b/gi, "Adventure on Kami's Island"],
  [/\bEB-?01\b/gi, "Memorial Collection"],
  [/\bEB-?02\b/gi, "Anime 25th Collection"],
  [/\bEB-?03\b/gi, "Extra Booster: One Piece Heroines Edition"],
  [/\bEB-?04\b/gi, "Adventure on Kami's Island"],
  [/\bPRB-?01\b/gi, "Premium Booster -The Best-"],
  [/\bPRB-?02\b/gi, "Premium Booster -The Best- Vol. 2"],
];
const ONE_PIECE_SET_NAMES = ONE_PIECE_SET_CODES.map(([, n]) => n);

export const SET_NAME_CORRECTIONS: [RegExp, string][] = [
  [/\bShinning\s+Fates\b/gi, "Shining Fates"],
  [/\bShinnying\s+Fates\b/gi, "Shining Fates"],
  [/\bPalden\s+Fates\b/gi, "Paldean Fates"],
  [/\bPaldea\s+Fates\b/gi, "Paldean Fates"],
  [/\bPhantsmal\s+Flames\b/gi, "Phantasmal Flames"],
  [/\bPhantasmal\s+Falmes\b/gi, "Phantasmal Flames"],
  [/\bTransformation\s+Masdk\b/gi, "Twilight Masquerade"],
  [/\bTwilight\s+Masqurade\b/gi, "Twilight Masquerade"],
  [/\bCelebration\b/gi, "Celebrations"],
  [/\bScarlet\s*&?\s*Violet\s*-\s*151\s*\(JP\)/gi, "Pokemon 151"],
  [/\bScarlet\s+Violet\s*-\s*151\b/gi, "Pokemon 151"],
  [/\bSv9\s*\(Korean\)/gi, "Journey Together"],
  [/\bSv09\b/gi, "Journey Together"],
  [/\bAscended\s+Heros\b/gi, "Ascended Heroes"],
  [/\bPhantasmal\s+Flame\b/gi, "Phantasmal Flames"],
];

export function correctSetName(raw: string | null | undefined): string | null {
  if (!raw) return raw ?? null;
  let n = raw;
  for (const [re, to] of SET_NAME_CORRECTIONS) n = n.replace(re, to);
  // Bare set codes ("OP05 - JP", "EB03", "OP15 - EB04"): swap the leading code
  // for the set name so the search has real words to work with.
  if (/^\s*(OP|EB|PRB)-?\d{2}\b/i.test(n)) {
    for (const [re, to] of ONE_PIECE_SET_CODES) {
      if (re.test(n)) { re.lastIndex = 0; n = n.replace(re, to); break; }
      re.lastIndex = 0;
    }
  }
  return n;
}

// "Nico Robin (107) (Parallel) - Emperors in the New World (OP09)": the set is
// written into the item name. Pull it out so it's used as the set and not
// scored as part of the card name.
function extractEmbeddedSet(rawName: string): { name: string; set: string } | null {
  for (const setName of ONE_PIECE_SET_NAMES) {
    const re = new RegExp("\\s*-?\\s*" + setName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(\\((OP|EB|PRB)-?\\d{2}\\))?", "i");
    const m = re.exec(rawName);
    if (m && m.index > 0) {
      const name = (rawName.slice(0, m.index) + " " + rawName.slice(m.index + m[0].length)).replace(/\s+/g, " ").replace(/\s*-\s*$/, "").trim();
      if (name) return { name, set: setName };
    }
  }
  return null;
}

// Marketplace-style titles ("Zoro-Juurou SP OP05-067 R Emperors in the New
// World OP09 ONE PIECE Card Japanese") won't match anything as-is. Pull out
// the card name (text before the first card code / rarity letter), and any
// set name embedded in the title, so a second search can use those instead.
function simplifyListingTitle(rawName: string): { name: string; set: string | null } | null {
  let n = rawName.replace(/\b(ONE PIECE|POKEMON|POK\u00c9MON)\b.*$/i, " ").trim();
  let embeddedSet: string | null = null;
  for (const setName of ONE_PIECE_SET_NAMES) {
    const re = new RegExp(setName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(n)) { embeddedSet = setName; n = n.replace(re, " "); break; }
  }
  // Cut at the first card code (OP05-067, SV08-123) or lone rarity marker.
  const m = /\b([A-Z]{1,4}\d{2,3}-\d{3}\b|(?:SR|SEC|UC|R|C|L|P)\b(?=\s|$))/.exec(n);
  let lead = (m ? n.slice(0, m.index) : n).replace(/\s+/g, " ").trim();
  if (!lead || lead === rawName.trim()) return null;
  return { name: lead, set: embeddedSet };
}

// Apply spelling corrections to a name string and return the corrected version.
// Pure function over SPELLING_CORRECTIONS so import/upload routes can call this
// without going through TCGplayer matching.
export function correctSpelling(rawName: string): string {
  if (!rawName) return rawName;
  let n = rawName;
  for (const [re, to] of SPELLING_CORRECTIONS) n = n.replace(re, to);
  // Collapse extra whitespace but PRESERVE original punctuation / structure.
  return n.replace(/[ \t]+/g, " ").trim();
}

// Expand common short-hand product names ("ETB", "BB") to what TCGplayer indexes.
function expandProductName(rawName: string): string {
  if (!rawName) return "";
  let n = rawName.trim();
  // Whole-word substitutions, longest first
  const replacements: [RegExp, string][] = [
    [/\bElite Trainer Box\b/gi, "Elite Trainer Box"],
    [/\bETB\b/gi, "Elite Trainer Box"],
    [/\bBooster Bundle Display\b/gi, "Booster Bundle"],
    [/\bBooster Box\s*\/\s*Display\b/gi, "Booster Box"],
    [/\bBooster Display Box\b/gi, "Booster Box"],
    [/\bBooster Display\b/gi, "Booster Box"],
    [/\bBooster Packs?\b/gi, "Booster Pack"],
    [/\bvol\.?\s*(\d+)/gi, "Vol. $1"],
    [/\bSleeved Boosters?\b/gi, "Sleeved Booster Pack"],
    [/\bBB\b/gi, "Booster Box"],
    [/\bUPC\b/gi, "Ultra Premium Collection"],
    [/\bPC\b/gi, "Premium Collection"],
    // "SWSH FA/ Charizard VMAX" -> drop "FA/" since FA = Full Art which TCGplayer doesn't index that way.
    [/\bFA\s*\/\s*/gi, ""],
    [/\bFA\b/gi, ""],
  ];
  for (const [re, to] of replacements) n = n.replace(re, to);
  // Also apply the global spelling corrections so search queries benefit too.
  n = correctSpelling(n);
  // Strip parens — TCGplayer search returns 0 results when parens appear.
  // Also strip trailing language tags like "(JP)" / "(EN)" which exclude
  // English search results we want to match anyway.
  n = n.replace(/\([^)]*\)/g, " ");
  // Collapse any extra whitespace introduced by the substitutions.
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

// Build a tokenized set of the meaningful words in a name (lowercase, length >= 3).
// Strips common years and product-line filler so matching focuses on the card name.
function nameTokens(s: string): Set<string> {
  const STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "new",
    "pokemon",
    "swsh",
    "sword",
    "shield",
    "set",
    "base",
    "japanese",
    "english",
    "korean",
    "holo",
    "reverse",
    "foil",
    "misc",
    "cards",
    "products",
    "vending",
    "booster",
    "pack",
  ]);
  // Set-code regex: things like sv01, sv09, swsh07, me01, me02, tw01, pal, evo.
  const SET_CODE = /^(sv|swsh|me|tw|pal|sm|xy|bw|hgss|dp|ex|sf|cel|cre|cpa|cnc|cyl|cra|crz|chr|stb|spe|sve|sit|sit|paf)\d{0,2}$/;
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(
        (t) =>
          t.length >= 3 &&
          !STOPWORDS.has(t) &&
          !/^\d{4}$/.test(t) && // drop bare years like 2025
          !SET_CODE.test(t)
      )
  );
}

// Extract card number tokens like "185/159", "098/159", "sv05-068". Strong
// signal when both sides match.
function cardNumbers(s: string): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  const re = /\b\d{1,3}\s*\/\s*\d{1,3}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) != null) {
    out.add(m[0].replace(/\s+/g, ""));
  }
  return out;
}

// Score a candidate by how well its productName overlaps with the query name.
// Returns 0..1. Score = max(query coverage, candidate coverage) so a clean
// query against a noisy candidate (or vice versa) both score well, but two
// totally different Pokemon names won't accidentally cross-match.
function matchScore(queryName: string, candidateName: string): number {
  const q = nameTokens(queryName);
  const c = nameTokens(candidateName);
  if (q.size === 0 || c.size === 0) return 0;
  let hits = 0;
  for (const tok of q) if (c.has(tok)) hits++;
  const queryCoverage = hits / q.size;
  const candidateCoverage = hits / c.size;
  return Math.max(queryCoverage, candidateCoverage);
}

// Sealed-product score. Every word of the item NAME must appear in the
// candidate (so "Booster Pack" never matches a "Booster Box", and "Knockout
// pack" never matches a "2-Pack Blister Pack"). The SET part only confirms the
// match: generic set labels ("Misc Cards & Products") carry no weight, and a
// real set name must be at least half present. Extra candidate words are
// penalised lightly so the plain product outranks "... Case" / "Code Card" variants.
const GENERIC_SET_TOKENS = new Set([
  "misc", "miscellaneous", "cards", "card", "products", "product", "promo", "promos",
  "pokemon", "tcg", "the", "and", "sealed", "accessories",
  "one", "piece", "game", // "One Piece Card Game ..." prefix on sealed product names
]);
function sealedTokens(x: string, minLen = 2): Set<string> {
  return new Set(
    (x || "")
      .toLowerCase()
      .replace(/\b[a-z]{1,4}\d{1,3}(\.\d)?:/g, " ") // "sv08:", "me01:" set-code prefixes
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => (t.length >= minLen || /^\d$/.test(t)) && !/^\d{4}$/.test(t) && !GENERIC_SET_TOKENS.has(t))
  );
}
function sealedMatchScore(
  setPart: string,
  namePart: string,
  candFull: string,
  variantPart: string = ""
): number {
  const c = sealedTokens(candFull, 1);
  const nameT = sealedTokens(namePart);
  // Set codes ("OP15", "EB04", "SV08") aren't in TCGplayer product names — drop them.
  const setT = new Set(
    Array.from(sealedTokens(setPart)).filter((t) => !/^[a-z]{1,4}\d{1,3}[a-z]?$/.test(t))
  );
  const varT = sealedTokens(variantPart, 1);
  if (c.size === 0 || nameT.size === 0) return 0;
  // A name that's only numbers ("2") carries no product information.
  if (Array.from(nameT).every((t) => /^\d+$/.test(t))) return 0;
  let nameHits = 0;
  for (const t of nameT) if (c.has(t)) nameHits++;
  let setHits = 0;
  for (const t of setT) if (c.has(t)) setHits++;
  let varHits = 0;
  for (const t of varT) if (c.has(t)) varHits++;
  const nameCov = nameHits / nameT.size;
  const setCov = setT.size ? setHits / setT.size : 1;
  if (nameCov < 1 || setCov < 0.5) {
    return Math.min(0.45, 0.45 * (nameCov * 0.7 + setCov * 0.3));
  }
  // The variant in parens ("Pokeball Tin (Ultra Ball)", "EX Box (Mega
  // Feraligatr)") decides between sibling products: a candidate that carries
  // it wins; one that clearly names a different variant is rejected.
  if (varT.size && varHits < varT.size) {
    // Candidate is a sibling product with a different (or no) variant.
    return 0.45;
  }
  const extra = c.size - nameHits - setHits - varHits;
  return Math.max(0.5, 1 - extra * 0.08);
}

// Returns true if the query and candidate share an exact card number like
// "185/159". Card numbers uniquely identify a card within a set, so an exact
// match is a strong signal that overrides low token overlap.
function sharesCardNumber(query: string, candidate: string): boolean {
  const a = cardNumbers(query);
  const b = cardNumbers(candidate);
  for (const num of a) if (b.has(num)) return true;
  return false;
}

// Find the best matching TCGplayer productId for an item. Returns null on no match.
export async function findTcgplayerProductId(
  rawName: string,
  setHint: string | null,
  franchise: string,
  category?: string | null
): Promise<number | null> {
  if (!rawName) return null;
  try {
    const productLine = TCGPLAYER_PRODUCT_LINE_MAP[franchise];
    const embedded = extractEmbeddedSet(rawName);
    const nameForSearch = correctSpelling(embedded ? embedded.name : rawName);
    const expandedName = expandProductName(nameForSearch);
    // Strip parenthetical descriptors and trailing modifiers from setHint;
    // TCGplayer search returns 0 results when parens are in the query.
    const cleanSet = (embedded ? embedded.set : correctSetName(setHint))
      ?.replace(/\([^)]*\)/g, " ")
      .replace(/\s+-\s+.*$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const sealedItem = String(category || "").toLowerCase() === "sealed";
    // "(Ultra Ball)", "(Alternate Art)", "(107)" — the variant TCGplayer lists
    // in [brackets]/(parens). Searched with the name so the right sibling is in
    // the result set, and used to pick between siblings below. Sealed products
    // require it to match; singles just prefer the candidate that carries it.
    const variantHint = correctSpelling(
      (nameForSearch.match(/\(([^)]*)\)/g) || []).map((m) => m.slice(1, -1)).join(" ")
    ).replace(/\b(JP|EN|Japanese|English|Girl)\b/gi, " ").replace(/\s+/g, " ").trim();
    const queryParts: string[] = [];
    if (cleanSet) queryParts.push(cleanSet);
    queryParts.push(expandedName);
    const baseQuery = queryParts.join(" ");
    const runSearch = async (query: string): Promise<any[]> => {
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
      if (!res.ok) return [];
      const data: any = await res.json();
      return data?.results?.[0]?.results ?? [];
    };
    let items: any[] = variantHint ? await runSearch(`${baseQuery} ${variantHint}`) : [];
    if (!items.length) items = await runSearch(baseQuery);
    // Nothing? Drop the set hint, then try the simplified card name.
    let scoreName = expandedName;
    let scoreSet = cleanSet || "";
    if (!items.length && cleanSet) items = await runSearch(expandedName);
    if (!items.length) {
      const simple = simplifyListingTitle(rawName);
      if (simple) {
        scoreName = expandProductName(simple.name);
        scoreSet = simple.set || scoreSet;
        items = await runSearch(`${scoreSet} ${scoreName}`.trim());
        if (!items.length && scoreSet) items = await runSearch(scoreName);
      }
    }
    if (!items.length) return null;

    // Filter by product line if known.
    const lineFiltered = productLine
      ? items.filter(
          (i: any) =>
            String(i?.productLineName || "").toLowerCase() ===
            productLine.toLowerCase()
        )
      : items;
    // Never cross game lines: a Pokémon item must not match a Dragon Ball or
    // One Piece product just because the words overlap.
    if (productLine && !lineFiltered.length) return null;
    const pool = lineFiltered.length ? lineFiltered : items;

    // Score every candidate by token overlap with the (expanded) name.
    // This prevents "Charizard VMAX" picking up Eternatus VMAX just because
    // it shares the same set + product type. Card-number match boosts score.
    // Generic sealed names ("Booster Pack", "ETB", "Booster Bundle") lose every
    // token to the stopword list, so name-only scoring returns 0 even when
    // TCGplayer handed us the exact product. For those, score the full
    // "set + product" string against the candidate's "set + product" string
    // with no stopwords, so the set name and the product type both count.
    const nameOnlyTokens = nameTokens(scoreName).size;
    const scored = pool.map((it: any) => {
      const candName = String(it?.productName || "");
      const candSet = String(it?.setName || "");
      let score = matchScore(scoreName, candName);
      const full = sealedMatchScore(scoreSet, scoreName, `${candSet} ${candName}`, variantHint);
      // Singles: prefer the printing from the known set, and the candidate
      // that carries the same variant ("(Alternate Art)", "(107)").
      if (!sealedItem && score >= 0.5) {
        if (scoreSet) {
          const setT = new Set(Array.from(sealedTokens(scoreSet)).filter((t) => !/^[a-z]{1,4}\d{1,3}[a-z]?$/.test(t)));
          const cT = sealedTokens(candSet, 1);
          let hits = 0;
          for (const t of setT) if (cT.has(t)) hits++;
          if (setT.size) score += hits / setT.size >= 0.5 ? 0.05 : -0.12;
        }
        if (variantHint) {
          const vT = sealedTokens(variantHint, 1);
          const cT = sealedTokens(candName, 1);
          let hits = 0;
          for (const t of vT) if (cT.has(t)) hits++;
          if (vT.size) score += 0.2 * (hits / vT.size);
        }
      }
      if (sealedItem) {
        // Sealed products are judged by the strict whole-name rule only: the
        // loose single-word overlap lets "Pokeball Tin" hit any product with
        // "Pokeball" in it.
        score = full;
      } else if (nameOnlyTokens === 0 || score < 0.5) {
        score = Math.max(score, full);
      }
      // Boost when the card number matches exactly (e.g. 185/159 == 185/159).
      if (sharesCardNumber(rawName, candName)) {
        score = Math.max(score, 0.9);
      }
      return { item: it, score, full, candName };
    });
    // Ties (e.g. "Booster Box" vs "Booster Box Case") go to the candidate whose
    // full name is the closest fit, then to TCGplayer's own ranking.
    scored.sort((a, b) => b.score - a.score || b.full - a.full);
    if (process.env.DEBUG_TCGP) {
      console.log(`[tcgp:debug] ${JSON.stringify(rawName)} set=${JSON.stringify(scoreSet)} name=${JSON.stringify(scoreName)} variant=${JSON.stringify(variantHint)}`);
      for (const c of scored.slice(0, 6)) console.log(`   ${c.score.toFixed(2)} ${c.item?.productId} ${c.item?.setName} | ${c.candName}`);
    }
    const best = scored[0];
    if (!best) return null;

    // Require at least 0.5 overlap (smaller-set denominator). Card-number
    // matches are auto-boosted to 0.9 above so they always pass.
    const THRESHOLD = 0.5;
    if (best.score < THRESHOLD) {
      console.warn(
        `[tcgp] low-confidence match for ${JSON.stringify(rawName)}: best ${JSON.stringify(best.item?.productName)} score=${best.score.toFixed(2)} — skipping`
      );
      return null;
    }

    const id = best.item?.productId;
    if (!id) return null;
    return Math.trunc(Number(id));
  } catch {
    return null;
  }
}

async function getTcgplayerImage(
  rawName: string,
  setHint: string | null,
  franchise: string,
  category?: string | null
): Promise<string | null> {
  const id = await findTcgplayerProductId(rawName, setHint, franchise, category);
  if (!id) return null;
  return `https://product-images.tcgplayer.com/fit-in/437x437/${id}.jpg`;
}

// --- TCGplayer rich Price Points ---------------------------------------------
// Fetches the full Price Points panel data for a productId:
// - Market Price, Listed Median (from /v2/product/{id}/pricepoints)
// - Most Recent Sale (from /v2/product/{id}/latestsales)
// - 3-month snapshot + price history (from /price/history/{id}/detailed)
// Optional: skuId-based volatility and current sellers/qty.
export interface TcgplayerPricePoints {
  productId: number;
  marketPrice: number | null;
  listedMedian: number | null;
  mostRecentSale: number | null;
  currentQty: number | null;
  currentSellers: number | null;
  volatility: string | null; // "LOW" | "MED" | "HIGH"
  lowSale3mo: number | null;
  highSale3mo: number | null;
  totalSold3mo: number | null;
  avgDailySold: number | null;
  history: Array<{ date: string; marketPrice: number; low: number; high: number; qty: number }>;
}

const TCGP_HEADERS = {
  "User-Agent": UA,
  Accept: "application/json",
  Origin: "https://www.tcgplayer.com",
  Referer: "https://www.tcgplayer.com/",
};

async function tcgpFetch(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, {
      ...(init || {}),
      headers: { ...TCGP_HEADERS, ...((init as any)?.headers || {}) },
    });
    if (!res.ok) {
      console.warn(`[tcgp] non-ok ${res.status} for ${url.replace(/\?.*/, "")}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.warn(`[tcgp] fetch error for ${url.replace(/\?.*/, "")}: ${err?.message || err}`);
    return null;
  }
}

// Exposed for the debug endpoint so we can confirm exactly which calls TCGplayer rejects in prod.
// Kept around for diagnostics if we ever want to verify what works from new hosting.
export async function debugTcgplayerCalls(productId: number) {
  if (!productId) return { error: "productId required" };
  const probe = async (label: string, url: string, init?: RequestInit) => {
    try {
      const res = await fetch(url, {
        ...(init || {}),
        headers: { ...TCGP_HEADERS, ...((init as any)?.headers || {}) },
      });
      const text = await res.text();
      return {
        label,
        url,
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type"),
        bodyPreview: text.slice(0, 400),
        _fullBody: text,
      };
    } catch (err: any) {
      return { label, url, error: String(err?.message || err) };
    }
  };
  // First get skuId from details so we can probe sku-keyed endpoints too.
  const details = await probe(
    "details",
    `https://mp-search-api.tcgplayer.com/v1/product/${productId}/details`
  );
  let skuId: number | null = null;
  try {
    const detailsJson = JSON.parse((details as any)._fullBody || "");
    skuId = detailsJson?.skus?.[0]?.skuId ?? null;
  } catch {}
  const probes: any[] = [
    probe("pricepoints", `https://mpapi.tcgplayer.com/v2/product/${productId}/pricepoints`),
    probe("latestsales", `https://mpapi.tcgplayer.com/v2/product/${productId}/latestsales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1 }),
    }),
    probe(
      "history",
      `https://infinite-api.tcgplayer.com/price/history/${productId}/detailed?range=quarter`
    ),
    Promise.resolve(details),
  ];
  if (skuId) {
    probes.push(
      probe(
        "volatility",
        `https://mpgateway.tcgplayer.com/v1/pricepoints/marketprice/skus/${skuId}/volatility`
      ),
      probe(
        "listings",
        `https://mp-search-api.tcgplayer.com/v1/product/${productId}/listings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filters: {
              term: { sellerStatus: "Live", channelId: 0 },
              range: { quantity: { gte: 1 } },
              exclude: { channelExclusion: 0 },
            },
            context: { shippingCountry: "US", cart: {} },
            aggregations: ["listingType", "seller-key"],
            size: 0,
          }),
        }
      )
    );
  }
  const allResults = await Promise.all(probes);
  // Strip the heavy _fullBody from output
  return {
    skuId,
    results: allResults.map((r: any) => {
      if (r && "_fullBody" in r) {
        const { _fullBody, ...rest } = r;
        return rest;
      }
      return r;
    }),
  };
}

export async function fetchTcgplayerPricePoints(
  productId: number
): Promise<TcgplayerPricePoints | null> {
  if (!productId) return null;
  const result: TcgplayerPricePoints = {
    productId,
    marketPrice: null,
    listedMedian: null,
    mostRecentSale: null,
    currentQty: null,
    currentSellers: null,
    volatility: null,
    lowSale3mo: null,
    highSale3mo: null,
    totalSold3mo: null,
    avgDailySold: null,
    history: [],
  };

  // NOTE: TCGplayer's mpapi/latestsales and infinite-api/history endpoints return
  // 403 to Render's egress IPs, so we don't call them. We instead use the two
  // endpoints that DO work from server hosting: /pricepoints and /details.
  // The unsupported fields (mostRecentSale, history, 3mo low/high/totals, volatility)
  // stay null. If we later move behind a proxy/Worker, the disabled blocks can be re-enabled.
  const [pricePts, productDetails] = await Promise.all([
    tcgpFetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/pricepoints`),
    tcgpFetch(
      `https://mp-search-api.tcgplayer.com/v1/product/${productId}/details`
    ),
  ]);

  // 1. pricepoints → marketPrice + listedMedian (pick the Normal printing first,
  //    fall back to any printing that has a marketPrice).
  if (Array.isArray(pricePts)) {
    const priced = (p: any) => typeof p?.marketPrice === "number" && p.marketPrice > 0;
    const normal =
      pricePts.find((p: any) => p.printingType === "Normal" && priced(p)) ||
      pricePts.find((p: any) => priced(p)) ||
      pricePts.find((p: any) => p.printingType === "Normal") ||
      pricePts[0];
    if (normal) {
      if (typeof normal.marketPrice === "number") result.marketPrice = normal.marketPrice;
      if (typeof normal.listedMedianPrice === "number")
        result.listedMedian = normal.listedMedianPrice;
    }
  }

  // 2. details → sellers, currentQty, fallback marketPrice/medianPrice
  if (productDetails && typeof productDetails === "object") {
    const sellers = Number(productDetails.sellers);
    if (isFinite(sellers)) result.currentSellers = Math.round(sellers);
    const listings = Number(productDetails.listings);
    if (isFinite(listings)) result.currentQty = Math.round(listings);
    // Fallbacks if pricepoints didn't populate.
    if (result.marketPrice == null) {
      const mp = Number(productDetails.marketPrice);
      if (isFinite(mp)) result.marketPrice = mp;
    }
    if (result.listedMedian == null) {
      const med = Number(productDetails.medianPrice);
      if (isFinite(med)) result.listedMedian = med;
    }
  }

  return result;
}

// Convert TcgplayerPricePoints into the DB column patch shape.
export function pricePointsToPatch(
  pts: TcgplayerPricePoints
): Record<string, any> {
  return {
    tcgpProductId: pts.productId,
    tcgpMarketPrice: pts.marketPrice,
    tcgpMostRecentSale: pts.mostRecentSale,
    tcgpListedMedian: pts.listedMedian,
    tcgpCurrentQty: pts.currentQty,
    tcgpCurrentSellers: pts.currentSellers,
    tcgpVolatility: pts.volatility,
    tcgpLowSale3mo: pts.lowSale3mo,
    tcgpHighSale3mo: pts.highSale3mo,
    tcgpTotalSold3mo: pts.totalSold3mo,
    tcgpAvgDailySold: pts.avgDailySold,
    tcgpHistoryJson: pts.history.length ? JSON.stringify(pts.history) : null,
    tcgpPricedAt: Math.floor(Date.now() / 1000),
  };
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
// Does this image URL actually load? TCGplayer sometimes lists a product before
// it has a photo (the CDN answers 404 with JSON), and third-party links go
// stale. Cheap HEAD check, cached for an hour so bulk passes don't repeat it.
const IMAGE_OK_CACHE = new Map<string, { ok: boolean; at: number }>();
export async function imageUrlLoads(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  if (url.startsWith("data:") || url.startsWith("/")) return true; // uploaded / local
  const hit = IMAGE_OK_CACHE.get(url);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.ok;
  let ok = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    let res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, signal: ctrl.signal, redirect: "follow" });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, { method: "GET", headers: { "User-Agent": UA, Range: "bytes=0-0" }, signal: ctrl.signal, redirect: "follow" });
    }
    clearTimeout(t);
    const ct = res.headers.get("content-type") || "";
    ok = res.ok && (ct.startsWith("image/") || ct === "application/octet-stream" || ct === "");
  } catch {
    // Network hiccup: don't poison the cache, treat as unknown-but-usable.
    return true;
  }
  IMAGE_OK_CACHE.set(url, { ok, at: Date.now() });
  return ok;
}

export async function fetchImageOnly(item: Inventory): Promise<string | null> {
  const rawName = item.name;
  const set = item.setName ?? null;
  const franchise = item.franchise;

  // ---- Already matched on TCGplayer by the pricing pass? Use that product's image. ----
  const knownId = Number((item as any).tcgpProductId);
  if (Number.isFinite(knownId) && knownId > 0) {
    const u = tcgplayerImageUrl(knownId);
    if (await imageUrlLoads(u)) return u;
    // Product exists but has no photo yet — fall through to the other sources.
  }

  // ---- MTG ----
  if (franchise === "Magic The Gathering") {
    const r = await getScryfallPrice(rawName, set);
    if (r?.imageUrl && (await imageUrlLoads(r.imageUrl))) return r.imageUrl;
  }

  // ---- Pokemon ----
  // TCGplayer is the fastest, most reliable image source for Pokemon (sealed
  // AND singles). Try it FIRST and use cleaned name (strip number suffixes).
  if (franchise === "Pok\u00e9mon") {
    const parsed = parsePokemonName(rawName);
    // The singles cleaner strips the trailing "(Ultra Ball)" variant, which is
    // exactly what tells sealed products apart — keep the raw name for those.
    const cleanName = isSealedProduct(item) ? rawName : parsed.cleanName;
    const { collectorNumber, setCode } = parsed;

    // Try TCGplayer with cleaned name + set (fast, ~300ms)
    const tcgpClean = await getTcgplayerImage(cleanName, set, franchise, item.category);
    if (tcgpClean && (await imageUrlLoads(tcgpClean))) return tcgpClean;

    // Try TCGplayer with raw name as fallback
    if (cleanName !== rawName) {
      const tcgpRaw = await getTcgplayerImage(rawName, set, franchise, item.category);
      if (tcgpRaw && (await imageUrlLoads(tcgpRaw))) return tcgpRaw;
    }

    // Last resort for sealed: set logo from pokemontcg.io
    if (isSealedProduct(item)) {
      const logo = await getPokemonSetLogo(set);
      if (logo && (await imageUrlLoads(logo))) return logo;
    }
  }

  // ---- MTG sealed product: Scryfall doesn't have sealed images. Try TCGplayer. ----
  if (franchise === "Magic The Gathering" && isSealedProduct(item)) {
    const tcgp = await getTcgplayerImage(rawName, set, franchise, item.category);
    if (tcgp && (await imageUrlLoads(tcgp))) return tcgp;
  }

  // ---- TCGplayer search (works for ALL franchises + sealed product) ----
  const tcgpAll = await getTcgplayerImage(rawName, set, franchise, item.category);
  if (tcgpAll && (await imageUrlLoads(tcgpAll))) return tcgpAll;

  // Claude fallback removed from bulk path — it hallucinates URLs and is slow.
  // Real sources above cover the vast majority of items.
  return null;
}

// Bulk image fetch with throttling. Only touches items where imageUrl is null.
// Process a SMALL batch of items that need images. Returns counts for THIS
// batch plus the remaining work, so the client can loop. Each successful
// lookup is persisted to the DB before the next iteration, so progress
// survives server restarts.
// Verify saved remote photos actually load and clear the dead ones so the
// backfill re-resolves them. Guarded by a setting so it runs once per version.
const IMAGE_VERIFY_SWEEP_KEY = "image_verify_sweep_v1";
export async function sweepDeadImageUrls(): Promise<number> {
  const done = await storage.getSetting(IMAGE_VERIFY_SWEEP_KEY);
  if (done) return 0;
  await storage.setSetting(IMAGE_VERIFY_SWEEP_KEY, String(Date.now()));
  const items = (await storage.listInventory()).filter(
    (i) => i.imageUrl && /^https?:\/\//.test(i.imageUrl)
  );
  let cleared = 0;
  const CONCURRENCY = 6;
  for (let k = 0; k < items.length; k += CONCURRENCY) {
    await Promise.all(
      items.slice(k, k + CONCURRENCY).map(async (i) => {
        if (await imageUrlLoads(i.imageUrl)) return;
        await storage.updateInventory(i.id, { imageUrl: null } as any);
        cleared++;
      })
    );
  }
  console.log(`[pricing] image verify sweep: checked ${items.length}, cleared ${cleared} dead photo links`);
  return cleared;
}

// Items we already searched for and couldn't match are retried at most once
// per cooldown window (in-memory; a restart simply retries everything once).
const imageAttemptAt = new Map<string, number>();
const IMAGE_RETRY_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export async function fetchMissingImagesBatch(
  batchSize: number = 15,
  offset: number = 0,
  force: boolean = false
): Promise<{
  updated: number;
  skipped: number;
  failed: number;
  processed: number;
  remaining: number;
  total: number;
  withImage: number;
  nextOffset: number;
}> {
  const items = await storage.listInventory();
  const now = Date.now();
  const allCandidates = items.filter((i) => {
    if (i.imageUrl) return false;
    if (!force) {
      const last = imageAttemptAt.get(i.id);
      if (last && now - last < IMAGE_RETRY_COOLDOWN_MS) return false;
    }
    return true;
  });
  const startIdx = Math.max(0, Math.min(offset, allCandidates.length));
  const batch = allCandidates.slice(startIdx, startIdx + batchSize);
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;

  for (const item of batch) {
    try {
      // Hard per-item timeout (8s) so one slow source can't stall the batch.
      const url = await Promise.race<string | null>([
        fetchImageOnly(item),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (url) {
        await storage.updateInventory(item.id, { imageUrl: url } as any);
        imageAttemptAt.delete(item.id);
        updated++;
      } else {
        imageAttemptAt.set(item.id, Date.now());
        skipped++;
      }
    } catch (err) {
      console.error("[pricing] image fetch failed for", item.id, err);
      imageAttemptAt.set(item.id, Date.now());
      failed++;
    }
    processed++;
    // Lower sleeps now that TCGplayer is the primary source (single fast API).
    if (item.franchise === "Magic The Gathering") await sleep(80);
    else if (item.franchise === "Pok\u00e9mon") await sleep(120);
    else await sleep(80);
  }

  const withImage =
    items.filter((i) => i.imageUrl).length + updated;
  // nextOffset advances past skipped items so the client doesn't re-process
  // them on the next batch. Updated items dropped out of the candidate list,
  // so their slots shrink — we advance by (processed - updated) = skipped+failed.
  const nextOffset = startIdx + skipped + failed;
  // remaining: items still without an image that we haven't tried yet.
  const remaining = Math.max(0, allCandidates.length - updated - nextOffset);
  return {
    updated,
    skipped,
    failed,
    processed,
    remaining,
    total: items.length,
    withImage,
    nextOffset,
  };
}

// Attempts only the real sources; returns null if nothing found. Used by the
// legacy /api/scan/price endpoint to try real APIs before falling back to AI.
export async function tryRealSourcesOnly(opts: {
  name: string;
  set: string;
  franchise: string;
  rarity?: string;
}): Promise<PriceResult | null> {
  const { franchise, name, set, rarity } = opts;
  if (franchise === "Magic The Gathering") {
    const r = await getScryfallPrice(name, set);
    if (r) return r;
  } else if (franchise === "Pok\u00e9mon") {
    // Primary: pokemontcg.io (free, US TCGplayer market prices).
    const primary = await getPokemonTcgApiPrice(name, set, rarity);
    if (primary) return primary;
    // Fallback: TCGdex.
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

// ---------------------------------------------------------------------------
// Public, real-time TCGplayer lookups (used by the storefront sell calculator
// and the on-demand price refresh). Results are cached briefly in memory so a
// burst of shoppers typing the same card doesn't fan out to TCGplayer.
// ---------------------------------------------------------------------------
export interface TcgplayerSearchHit {
  productId: number;
  name: string;
  setName: string | null;
  setCode: string | null;
  line: string | null;
  rarity: string | null;
  number: string | null;
  sealed: boolean;
  marketPrice: number | null;
  lowestPrice: number | null;
  listings: number | null;
  imageUrl: string;
}

export interface TcgplayerPrinting {
  printing: string;
  marketPrice: number | null;
  listedMedian: number | null;
}

const SEARCH_CACHE = new Map<string, { expiresAt: number; hits: TcgplayerSearchHit[] }>();
const PRINTINGS_CACHE = new Map<number, { expiresAt: number; printings: TcgplayerPrinting[] }>();
const SEARCH_TTL_MS = 2 * 60 * 1000;
const PRINTINGS_TTL_MS = 60 * 1000;

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function tcgplayerProductLineFor(franchise: string | null | undefined): string | null {
  if (!franchise) return null;
  return TCGPLAYER_PRODUCT_LINE_MAP[franchise] ?? null;
}

export function tcgplayerImageUrl(productId: number, size = 437): string {
  return `https://product-images.tcgplayer.com/fit-in/${size}x${size}/${productId}.jpg`;
}

// Free-text product search. `productLine` is TCGplayer's product line name
// (e.g. "Pokemon"); pass null to search every game.
export async function searchTcgplayerProducts(
  rawQuery: string,
  productLine: string | null = null,
  size = 12
): Promise<TcgplayerSearchHit[]> {
  const query = expandProductName(rawQuery || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (query.length < 2) return [];
  const key = `${productLine ?? "*"}|${size}|${query.toLowerCase()}`;
  const cached = SEARCH_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.hits;

  const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(query)}&isList=false`;
  const body: any = {
    algorithm: "",
    from: 0,
    size: Math.min(Math.max(size, 1), 24),
    filters: { term: {}, range: {}, match: {} },
    sort: {},
  };
  if (productLine) body.filters.term.productLineName = [productLine];
  try {
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
    if (!res.ok) return [];
    const data: any = await res.json();
    const items: any[] = data?.results?.[0]?.results ?? [];
    const hits: TcgplayerSearchHit[] = items
      .map((it: any) => {
        const productId = Math.trunc(Number(it?.productId));
        if (!productId) return null;
        return {
          productId,
          name: String(it?.productName || "").trim(),
          setName: it?.setName ? String(it.setName) : null,
          setCode: it?.setCode ? String(it.setCode) : null,
          line: it?.productLineName ? String(it.productLineName) : null,
          rarity: it?.rarityName ? String(it.rarityName) : null,
          number: it?.customAttributes?.number ? String(it.customAttributes.number) : null,
          sealed: Boolean(it?.sealed),
          marketPrice: num(it?.marketPrice),
          lowestPrice: num(it?.lowestPrice),
          listings: num(it?.totalListings ?? it?.listings),
          imageUrl: tcgplayerImageUrl(productId, 200),
        } as TcgplayerSearchHit;
      })
      .filter(Boolean) as TcgplayerSearchHit[];
    SEARCH_CACHE.set(key, { expiresAt: Date.now() + SEARCH_TTL_MS, hits });
    if (SEARCH_CACHE.size > 500) {
      const oldest = SEARCH_CACHE.keys().next().value;
      if (oldest !== undefined) SEARCH_CACHE.delete(oldest);
    }
    return hits;
  } catch (err: any) {
    console.warn(`[tcgp] search failed for ${JSON.stringify(query)}: ${err?.message || err}`);
    return [];
  }
}

// Per-printing price points (Normal / Holofoil / Reverse Holofoil / 1st Edition…)
export async function fetchTcgplayerPrintings(productId: number): Promise<TcgplayerPrinting[]> {
  if (!productId) return [];
  const cached = PRINTINGS_CACHE.get(productId);
  if (cached && cached.expiresAt > Date.now()) return cached.printings;
  const pts = await tcgpFetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/pricepoints`);
  const printings: TcgplayerPrinting[] = Array.isArray(pts)
    ? pts
        .map((p: any) => {
          const mp = num(p?.marketPrice);
          const med = num(p?.listedMedianPrice);
          return {
            printing: String(p?.printingType || "Normal"),
            marketPrice: mp != null && mp > 0 ? mp : null,
            listedMedian: med != null && med > 0 ? med : null,
          };
        })
        .filter((p) => p.marketPrice != null || p.listedMedian != null)
    : [];
  PRINTINGS_CACHE.set(productId, { expiresAt: Date.now() + PRINTINGS_TTL_MS, printings });
  if (PRINTINGS_CACHE.size > 2000) {
    const oldest = PRINTINGS_CACHE.keys().next().value;
    if (oldest !== undefined) PRINTINGS_CACHE.delete(oldest);
  }
  return printings;
}

// Should marketValue follow the fresh TCGplayer market price? Yes for raw
// (ungraded) items unless the owner pinned the value by editing it in admin
// (marketValueSource === "manual"). Graded slabs keep their graded estimate.
export function shouldFollowTcgplayer(item: Inventory, points: TcgplayerPricePoints): boolean {
  if (points.marketPrice == null || points.marketPrice <= 0) return false;
  if (isGraded(item.condition)) return false;
  if ((item as any).marketValueSource === "manual" && item.marketValue != null) return false;
  // Mismatch guard: if a pre-existing (non-synced) value is wildly different
  // from the matched product's price, the TCGplayer match is probably wrong.
  // Leave the value alone so a bad match can't rewrite a real price.
  const prev = item.marketValue == null ? null : Number(item.marketValue);
  if (prev != null && prev > 0 && (item as any).marketValueSource !== "tcgp") {
    const ratio = Number(points.marketPrice) / prev;
    if (ratio > 4 || ratio < 0.25) {
      console.warn(`[tcgp] ${item.id} skipped follow: market $${points.marketPrice} vs stored $${prev} (likely mismatch)`);
      return false;
    }
  }
  return true;
}

// Apply a followed TCGplayer price to a patch and log a history row when the
// value actually moved (≥ 1 cent). Keeps the admin price chart meaningful.
export async function applyFollowedPrice(
  item: Inventory,
  points: TcgplayerPricePoints,
  patch: Record<string, any>
): Promise<void> {
  if (!shouldFollowTcgplayer(item, points)) return;
  const next = Math.round(Number(points.marketPrice) * 100) / 100;
  patch.marketValue = next;
  patch.marketValueSource = "tcgp";
  const prev = item.marketValue == null ? null : Number(item.marketValue);
  if (prev == null || Math.abs(prev - next) >= 0.01) {
    try {
      await storage.createPriceHistory({ itemId: item.id, price: next, source: "TCGplayer" });
    } catch {
      /* history is best-effort */
    }
  }
}

// Refresh up to `ids.length` items concurrently (bounded) — used by the
// storefront to keep whatever is on screen current.
export async function refreshManyPricePoints(
  ids: string[],
  maxAgeSec = 90,
  concurrency = 6
): Promise<Inventory[]> {
  const out: Inventory[] = [];
  const queue = [...new Set(ids)].slice(0, 24);
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        const existing = await storage.getInventoryItem(id);
        if (!existing) continue;
        const { item } = await Promise.race([
          refreshItemPricePoints(existing, maxAgeSec),
          new Promise<{ item: Inventory; refreshed: boolean }>((resolve) =>
            setTimeout(() => resolve({ item: existing, refreshed: false }), 6000)
          ),
        ]);
        out.push(item);
      } catch {
        /* skip */
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// Refresh a single item's TCGplayer price points if they're older than
// `maxAgeSec`. Returns the (possibly updated) item or null when nothing could be
// matched. Used by the storefront for point-of-purchase prices.
export async function refreshItemPricePoints(
  item: Inventory,
  maxAgeSec = 10 * 60
): Promise<{ item: Inventory; refreshed: boolean }> {
  const now = Math.floor(Date.now() / 1000);
  if (item.tcgpPricedAt && now - item.tcgpPricedAt < maxAgeSec && item.tcgpMarketPrice != null) {
    return { item, refreshed: false };
  }
  let pid = item.tcgpProductId ?? null;
  if (!pid) pid = await findTcgplayerProductId(item.name, item.setName ?? null, item.franchise, item.category);
  if (!pid) return { item, refreshed: false };
  const points = await fetchTcgplayerPricePoints(pid);
  if (!points) return { item, refreshed: false };
  const patch: Record<string, any> = pricePointsToPatch(points);
  await applyFollowedPrice(item, points, patch);
  const updated = await storage.updateInventory(item.id, patch as any);
  return { item: (updated as Inventory) ?? { ...item, ...patch }, refreshed: true };
}
