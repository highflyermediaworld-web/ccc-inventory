// Graded-slab pricing from Alt (alt.xyz) via ReefAPI.
//
// TCGplayer only prices raw cards, so a PSA 10 Umbreon priced from TCGplayer
// shows the $25 raw market instead of the ~$110 the slab trades for. Alt
// publishes a per-grade "Alt Value" built from real graded sales (eBay,
// Fanatics/PWCC, Goldin, Heritage, Alt…). Alt has no public API, so this goes
// through ReefAPI's altxyz engine (https://reefapi.com/docs/altxyz) — the key
// is pasted in admin (Settings → Alt slab pricing) or set as REEFAPI_KEY.
//
// Each search or card lookup costs 3 ReefAPI credits. Graded items are
// refreshed at most once per ALT_MAX_AGE_SEC (24h) unless forced.

import { storage } from "./storage";
import type { Inventory } from "@shared/schema";
import { altGradeFor, gradeOfItem, isGradedItem } from "@shared/grading";

const BASE = (process.env.REEFAPI_BASE_URL || "https://api.reefapi.com").replace(/\/$/, "");
const KEY_SETTING = "reefapi_key";
const STATE_SETTING = "alt_pricing_state";
export const ALT_MAX_AGE_SEC = 24 * 60 * 60;

export type AltState = {
  lastRunAt: number | null;
  lastRunChecked: number;
  lastRunPriced: number;
  lastRunUnmatched: number;
  lastError: string | null;
  creditsRemaining: number | null;
  creditsUsed: number; // lifetime, best-effort
};

const defaultState = (): AltState => ({
  lastRunAt: null,
  lastRunChecked: 0,
  lastRunPriced: 0,
  lastRunUnmatched: 0,
  lastError: null,
  creditsRemaining: null,
  creditsUsed: 0,
});

async function loadState(): Promise<AltState> {
  try {
    const raw = await storage.getSetting(STATE_SETTING);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    /* fall through */
  }
  return defaultState();
}
async function saveState(st: AltState): Promise<void> {
  await storage.setSetting(STATE_SETTING, JSON.stringify(st));
}

/** Resolve the key: the one saved from admin wins over the environment. */
export async function getAltKey(): Promise<{ key: string; source: "settings" | "env" } | null> {
  const saved = (await storage.getSetting(KEY_SETTING)) || "";
  if (saved.trim()) return { key: saved.trim(), source: "settings" };
  const env = (process.env.REEFAPI_KEY || "").trim();
  if (env) return { key: env, source: "env" };
  return null;
}

// ── ReefAPI transport ──────────────────────────────────────────────
type ReefEnvelope<T> = { ok: boolean; data?: T; meta?: any; error?: { code?: string; message?: string } };

class ReefError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function reefPost<T>(action: string, body: Record<string, unknown>, keyOverride?: string): Promise<{ data: T; meta: any }> {
  const key = keyOverride ?? (await getAltKey())?.key;
  if (!key) throw new ReefError("NO_KEY", "No ReefAPI key — paste one in Settings → Alt slab pricing");
  const res = await fetch(`${BASE}/altxyz/v1/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let env: ReefEnvelope<T> | null = null;
  try {
    env = JSON.parse(text);
  } catch {
    throw new ReefError("BAD_RESPONSE", `ReefAPI ${res.status}: ${text.slice(0, 160)}`);
  }
  if (!env || !env.ok) {
    const code = env?.error?.code || `HTTP_${res.status}`;
    throw new ReefError(code, env?.error?.message || `ReefAPI ${action} failed (${code})`);
  }
  // Remember the credit balance when the envelope carries it.
  const credits = env.meta?.credits;
  const remaining =
    typeof credits === "number" ? credits
    : typeof credits?.remaining === "number" ? credits.remaining
    : typeof credits?.balance === "number" ? credits.balance
    : null;
  if (!keyOverride) {
    const st = await loadState();
    if (remaining != null) st.creditsRemaining = remaining;
    const cost =
      typeof env.meta?.charged_credits === "number" ? env.meta.charged_credits
      : typeof credits?.cost === "number" ? credits.cost
      : typeof credits?.used === "number" ? credits.used : 3;
    st.creditsUsed += cost;
    await saveState(st);
  }
  return { data: env.data as T, meta: env.meta ?? {} };
}

// ── Row shapes (subset of what altxyz returns) ─────────────────────
export type AltRow = {
  card_id: string;
  name: string;
  year?: number | string | null;
  set?: string | null;
  number?: string | null;
  variety?: string | null;
  subject?: string | null;
  category?: string | null;
  url?: string | null;
  pop?: number | null;
  last_sale?: { date?: string; price_usd?: number; grade?: string } | null;
  in_grade?: {
    grade?: string;
    alt_value?: number | null;
    alt_value_low?: number | null;
    alt_value_high?: number | null;
    alt_value_confidence?: number | null;
    pop?: number | null;
    last_sale?: { date?: string; price_usd?: number; grade?: string } | null;
  } | null;
};

export type AltQuote = {
  cardId: string;
  cardName: string;
  url: string | null;
  grade: string;
  altValue: number | null;
  altValueLow: number | null;
  altValueHigh: number | null;
  pop: number | null;
  lastSalePrice: number | null;
  lastSaleDate: string | null;
  /** The number we'll store as marketValue: Alt Value, else last sale in grade. */
  price: number | null;
  score: number;
};

// ── Query building ─────────────────────────────────────────────────
export function altCategoryFor(franchise: string | null | undefined): string {
  const f = (franchise || "").toLowerCase();
  if (/pok[eé]mon/.test(f)) return "pokemon";
  if (/one ?piece/.test(f)) return "one_piece";
  if (/yu-?gi-?oh/.test(f)) return "yugioh";
  if (/magic|mtg/.test(f)) return "magic";
  return "tcg";
}

// Non-English prints are different cards. Japanese is a soft penalty (many
// of the shop's slabs ARE Japanese sets — High Class Decks, SV8a, M-P promos
// — even when the listing doesn't say so, and an English row still outranks
// it when one exists); everything else is a hard reject unless the listing
// names that language.
const JP_WORDS = /\b(japanese|japan)\b/i;
const LANG_WORDS = /\b(german|chinese|korean|thai|italian|french|spanish|portuguese|indonesian|russian|dutch|polish|taiwan|hong kong)\b/i;
const NOISE = new Set([
  "the", "and", "of", "ex", "gx", "v", "vmax", "vstar", "card", "cards", "promo", "promos", "promotional",
  "sv", "swsh", "set", "base", "alternate", "art", "full", "parallel", "super", "manga", "jp", "en",
  "pokemon", "pokémon", "tcg", "collection", "edition", "booster", "extra", "deck", "class", "high",
  "highg", "sh", "trainer", "gallery", "vault", "shiny",
]);

function words(s: string | null | undefined): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w) && !/^\d+$/.test(w))
    // "promos"/"promo", "cards"/"card", "mcdonalds"/"mcdonald" — compare stems.
    .map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
}

/** "176", "002/019" → "2", "FB07-049" → "FB07-049", "SV006/SV122" → "SV006". */
export function itemCardNumber(name: string): string | null {
  const n = name || "";
  const code = n.match(/\b([A-Z]{1,4}\d{1,2}-\d{3})\b/i);
  if (code) return code[1].toUpperCase();
  // Keep the number as printed ("002", "SV006") — Alt's search likes the
  // printed form; normNumber() strips zeros when comparing.
  const paren = n.match(/\((\d{3})\)/);
  if (paren) return paren[1];
  const slash = n.match(/\b([A-Z]{0,2}\d{1,3})\/[A-Z0-9-]{1,6}\b/i);
  if (slash) return slash[1].toUpperCase();
  const dash = n.match(/-\s*(\d{1,3})\b(?!\/)/);
  if (dash) return dash[1];
  const tail = n.match(/\b(\d{3})\b\s*$/);
  if (tail) return tail[1];
  return null;
}

function normNumber(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v).trim().toUpperCase().replace(/^#/, "");
  s = s.split("/")[0];
  const code = s.match(/\b([A-Z]{1,4}\d{1,2}-\d{3})\b/);
  if (code) return code[1];
  s = s.replace(/^(\D*)0+(\d)/, "$1$2");
  return s || null;
}

/** Character / card words without numbers, variants and set codes. */
function characterOf(name: string): string {
  return (name || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b[A-Z]{1,4}\d{1,2}-\d{3}\b/gi, " ")
    .replace(/\b[A-Z]{0,2}\d{1,3}\/[A-Z]{0,2}\d{1,3}\b/gi, " ")
    .replace(/\s-\s.*$/, " ")
    .replace(/#?\b\d{1,3}\b/g, " ")
    .replace(/[.:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSet(set: string | null | undefined): string {
  return (set || "")
    .replace(/\b[A-Z]{1,4}\d{0,3}[a-z]?:\s*/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Alt's search is AND-keyword: every word must appear in the row, and Alt
// names sets its own way ("Black Star Promo" vs our "Mega Evolution Promos").
// So the primary query is just character + number — that returns every
// language print of the card and the scorer picks the right one. The set
// only goes into the query when the listing has no number.
export function altQueryFor(item: Pick<Inventory, "name" | "setName" | "franchise">): string {
  const character = characterOf(item.name);
  const num = itemCardNumber(item.name);
  if (num) return `${character} ${num}`.trim();
  return `${character} ${cleanSet(item.setName)}`.trim();
}
/** Second try when the first query returns nothing: character + set words. */
export function altFallbackQueryFor(item: Pick<Inventory, "name" | "setName" | "franchise">): string | null {
  const q = `${characterOf(item.name)} ${cleanSet(item.setName)}`.trim();
  return q && q !== altQueryFor(item) ? q : null;
}

// ── Scoring ────────────────────────────────────────────────────────
export function scoreAltRow(item: Pick<Inventory, "name" | "setName">, row: AltRow): number {
  const hay = `${row.name || ""} ${row.set || ""} ${row.variety || ""} ${row.subject || ""}`;
  const hayWords = new Set(words(hay));
  let score = 0;

  // Card number — the strongest identity.
  const want = normNumber(itemCardNumber(item.name));
  const have = normNumber(row.number) ?? (() => {
    const m = (row.name || "").match(/#\s*([A-Z]{0,2}\d{1,3}(?:-\d{3})?)/i);
    return m ? normNumber(m[1]) : null;
  })();
  if (want && have) {
    if (want === have) score += 0.5;
    else if (want.includes("-") !== have.includes("-")) score += 0; // code vs plain number — unknown
    else score -= 0.4;
  } else if (want && !have) {
    score -= 0.05;
  }

  // Character words.
  const charWords = words(characterOf(item.name));
  if (charWords.length) {
    let hits = 0;
    for (const w of charWords) if (hayWords.has(w)) hits++;
    score += 0.3 * (hits / charWords.length);
    if (hits === 0) score -= 0.5;
  }

  // Set words.
  const setWords = words(cleanSet(item.setName));
  let setHits = 0;
  if (setWords.length) {
    for (const w of setWords) if (hayWords.has(w)) setHits++;
    // Agreeing set words help; a set that shares nothing with the row is a
    // real signal against it (the "#020 Figure Collection" Pikachu is not
    // the "#020 McDonald's" Pikachu).
    score += setHits ? 0.2 * (setHits / setWords.length) : -0.25;
  }

  // Language: a German/Japanese print is a different card unless the
  // listing says so.
  const itemText = `${item.name} ${item.setName || ""}`;
  const itemJp = /\b(JP|JPN|Japanese)\b/i.test(itemText);
  const itemLang = itemText.match(LANG_WORDS)?.[1]?.toLowerCase() ?? null;
  const rowJp = JP_WORDS.test(hay);
  const rowLang = hay.match(LANG_WORDS)?.[1]?.toLowerCase() ?? null;
  if (rowLang) {
    score += itemLang === rowLang ? 0.15 : -0.8;
  } else if (rowJp) {
    // A Japanese row is plausible only when the listing says JP or its set
    // name is recognisably the same set ("Terastal Fest", "High Class Deck",
    // "McDonald's"). A Japanese #126 from another set is not our 126/193.
    score += itemJp ? 0.15 : setHits > 0 ? -0.1 : -0.8;
  } else if (itemJp || itemLang) {
    score -= 0.2;
  }

  // A row that actually carries a value in this grade is the one we want.
  if (row.in_grade?.alt_value != null) score += 0.1;
  else if (row.in_grade?.last_sale?.price_usd != null) score += 0.05;
  // Tiny nudge for population so near-ties resolve toward the real print.
  const pop = Number(row.in_grade?.pop ?? row.pop ?? 0);
  if (pop > 0) score += Math.min(0.04, Math.log10(pop + 1) / 100);
  return score;
}

export const ALT_MATCH_THRESHOLD = 0.45;

function quoteFrom(row: AltRow, grade: string, score: number): AltQuote {
  const ig = row.in_grade || {};
  const altValue = ig.alt_value != null ? Number(ig.alt_value) : null;
  const lastSale = ig.last_sale?.price_usd != null ? Number(ig.last_sale.price_usd) : null;
  return {
    cardId: row.card_id,
    cardName: row.name,
    url: row.url || null,
    grade,
    altValue,
    altValueLow: ig.alt_value_low != null ? Number(ig.alt_value_low) : null,
    altValueHigh: ig.alt_value_high != null ? Number(ig.alt_value_high) : null,
    pop: ig.pop != null ? Number(ig.pop) : null,
    lastSalePrice: lastSale,
    lastSaleDate: ig.last_sale?.date || null,
    price: altValue ?? lastSale,
    score,
  };
}

// ── Lookups ────────────────────────────────────────────────────────
export async function altSearchForItem(item: Inventory): Promise<AltQuote | null> {
  const g = gradeOfItem(item);
  if (!g) return null;
  const grade = altGradeFor(g);
  const category = altCategoryFor(item.franchise);
  const query = altQueryFor(item);
  const search = async (q: string) => {
    const { data } = await reefPost<{ rows: AltRow[] }>("search", { query: q, category, grade, limit: 20 });
    return Array.isArray(data?.rows) ? data.rows : [];
  };
  let rows = await search(query);
  if (!rows.length) {
    const fb = altFallbackQueryFor(item);
    if (fb) rows = await search(fb);
  }
  if (process.env.DEBUG_ALT) console.log(`[alt:debug] ${item.id} q=${JSON.stringify(query)} grade=${grade} rows=${rows.length}`);
  let best: { row: AltRow; score: number } | null = null;
  for (const row of rows) {
    const score = scoreAltRow(item, row);
    if (process.env.DEBUG_ALT) console.log(`   ${score.toFixed(2)} ${row.card_id} ${row.name} | #${row.number} | ${row.set} | ${row.in_grade?.alt_value}`);
    if (!best || score > best.score) best = { row, score };
  }
  if (!best || best.score < ALT_MATCH_THRESHOLD) return null;
  return quoteFrom(best.row, grade, best.score);
}

/** Re-price an already matched card by card_id (same 3 credits, no re-matching risk). */
export async function altRepriceCard(cardId: string, grade: string): Promise<AltQuote | null> {
  const { data } = await reefPost<{ card: AltRow & { in_grade?: AltRow["in_grade"] } }>("card", { card_id: cardId, grade });
  const card = data?.card;
  if (!card) return null;
  return quoteFrom(card, grade, 1);
}

// ── Apply to inventory ─────────────────────────────────────────────
export function altPatchFor(q: AltQuote): Record<string, any> {
  return {
    altCardId: q.cardId,
    altGrade: q.grade,
    altName: q.cardName,
    altUrl: q.url,
    altValue: q.altValue,
    altValueLow: q.altValueLow,
    altValueHigh: q.altValueHigh,
    altPop: q.pop,
    altLastSalePrice: q.lastSalePrice,
    altLastSaleDate: q.lastSaleDate,
    altPricedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Price one graded item from Alt. Keeps the existing card_id when the grade
 * hasn't changed (re-price, not re-match). Returns the updated item.
 * Manual prices are never overwritten — the Alt fields are still refreshed so
 * admin can see the market.
 */
export async function priceGradedItemWithAlt(
  item: Inventory,
  opts: { force?: boolean; maxAgeSec?: number } = {}
): Promise<{ item: Inventory; refreshed: boolean; quote: AltQuote | null; reason?: string }> {
  if (!isGradedItem(item)) return { item, refreshed: false, quote: null, reason: "not graded" };
  const now = Math.floor(Date.now() / 1000);
  const maxAge = opts.maxAgeSec ?? ALT_MAX_AGE_SEC;
  const it: any = item;
  // One lookup per day whether or not Alt had a match — an unmatched slab
  // must not be re-searched every hourly pass (3 credits a time).
  if (!opts.force && it.altPricedAt && now - it.altPricedAt < maxAge) {
    return { item, refreshed: false, quote: null, reason: "fresh" };
  }
  const g = gradeOfItem(item)!;
  const grade = altGradeFor(g);
  let quote: AltQuote | null = null;
  if (it.altCardId && it.altGrade === grade && !opts.force) {
    quote = await altRepriceCard(it.altCardId, grade).catch(() => null);
  }
  if (!quote) quote = await altSearchForItem(item);
  if (!quote) {
    // No match: drop any earlier Alt match so a stale (or wrong) Alt value
    // can't linger; the AI graded estimate takes over on the next cycle.
    const clear: Record<string, any> = { altPricedAt: now };
    if (it.altCardId || it.altValue != null) {
      Object.assign(clear, { altCardId: null, altName: null, altUrl: null, altValue: null, altValueLow: null, altValueHigh: null, altPop: null, altLastSalePrice: null, altLastSaleDate: null });
    }
    if (it.marketValueSource === "alt") {
      clear.marketValue = null;
      clear.marketValueSource = null;
    }
    const updated = await storage.updateInventory(item.id, clear as any);
    return { item: (updated as Inventory) ?? ({ ...item, ...clear } as any), refreshed: false, quote: null, reason: "no match" };
  }
  const patch = altPatchFor(quote);
  if (quote.price != null && it.marketValueSource !== "manual") {
    const next = Math.round(quote.price * 100) / 100;
    patch.marketValue = next;
    patch.marketValueSource = "alt";
    const prev = item.marketValue == null ? null : Number(item.marketValue);
    if (prev == null || Math.abs(prev - next) >= 0.01) {
      try {
        await storage.createPriceHistory({ itemId: item.id, price: next, source: "Alt" });
      } catch {
        /* best-effort */
      }
    }
  }
  const updated = await storage.updateInventory(item.id, patch as any);
  return { item: (updated as Inventory) ?? ({ ...item, ...patch } as any), refreshed: true, quote };
}

/** Every graded item that's for sale (In Inventory / Listed). */
export async function listGradedItems(): Promise<Inventory[]> {
  const all = await storage.listInventory();
  return all.filter((i) => (i.status === "In Inventory" || i.status === "Listed") && isGradedItem(i));
}

let running = false;
export async function refreshAllGraded(opts: { force?: boolean; ids?: string[] } = {}): Promise<AltState> {
  const st = await loadState();
  if (running) return st;
  if (!(await getAltKey())) {
    st.lastError = "No ReefAPI key";
    await saveState(st);
    return st;
  }
  running = true;
  try {
    let items = await listGradedItems();
    if (opts.ids?.length) {
      const want = new Set(opts.ids.map((x) => String(x).toUpperCase()));
      items = items.filter((it) => want.has(String(it.id).toUpperCase()));
    }
    let priced = 0;
    let unmatched = 0;
    let checked = 0;
    let lastError: string | null = null;
    for (const item of items) {
      try {
        const r = await priceGradedItemWithAlt(item, { force: opts.force });
        if (r.reason === "fresh") continue;
        checked++;
        if (r.refreshed) priced++;
        else unmatched++;
      } catch (err: any) {
        lastError = err?.message || String(err);
        checked++;
        // Out of credits / bad key — no point hammering the rest.
        if (err instanceof ReefError && /NO_KEY|UNAUTHORIZED|INVALID_KEY|CREDITS|HTTP_401|HTTP_402|HTTP_403/i.test(err.code)) break;
      }
    }
    const fresh = await loadState();
    fresh.lastRunAt = Math.floor(Date.now() / 1000);
    fresh.lastRunChecked = checked;
    fresh.lastRunPriced = priced;
    fresh.lastRunUnmatched = unmatched;
    fresh.lastError = lastError;
    await saveState(fresh);
    return fresh;
  } finally {
    running = false;
  }
}

// ── Admin ──────────────────────────────────────────────────────────
export async function getAltStatus() {
  const key = await getAltKey();
  const st = await loadState();
  const graded = await listGradedItems();
  const now = Math.floor(Date.now() / 1000);
  return {
    configured: !!key,
    keySource: key?.source ?? null,
    keyHint: key ? `…${key.key.slice(-4)}` : null,
    provider: "Alt (alt.xyz) via ReefAPI",
    maxAgeHours: ALT_MAX_AGE_SEC / 3600,
    creditsPerLookup: 3,
    gradedCount: graded.length,
    pricedCount: graded.filter((i: any) => i.altValue != null || i.altLastSalePrice != null).length,
    staleCount: graded.filter((i: any) => !i.altPricedAt || now - i.altPricedAt >= ALT_MAX_AGE_SEC).length,
    ...st,
  };
}

/** Validate a key with one cheap search, then save it. */
export async function setAltKey(key: string): Promise<{ credits: number | null }> {
  const trimmed = key.trim();
  const { meta } = await reefPost<any>("search", { query: "charizard", category: "pokemon", limit: 1, enrich: false }, trimmed);
  await storage.setSetting(KEY_SETTING, trimmed);
  const credits = meta?.credits;
  const remaining = typeof credits === "number" ? credits : typeof credits?.remaining === "number" ? credits.remaining : null;
  const st = await loadState();
  st.lastError = null;
  if (remaining != null) st.creditsRemaining = remaining;
  await saveState(st);
  return { credits: remaining };
}

export async function clearAltKey(): Promise<void> {
  await storage.setSetting(KEY_SETTING, "");
}

// ── Scheduler (piggybacks on the auto-pricing cycle) ───────────────
let timer: NodeJS.Timeout | null = null;
export function startAltScheduler(intervalMs = 60 * 60 * 1000): void {
  if (timer || process.env.ALT_PRICING_DISABLED === "1") return;
  const tick = () => refreshAllGraded().catch((e) => console.warn("[alt] cycle failed:", e?.message || e));
  setTimeout(tick, 45_000);
  timer = setInterval(tick, intervalMs);
}
