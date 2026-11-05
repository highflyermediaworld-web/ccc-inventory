/**
 * Instagram → Upcoming Shows sync.
 *
 * Every 30 minutes (IG_SHOWS_INTERVAL_MIN) read the newest posts on the shop's
 * own Instagram account through the official Instagram Graph API, ask the AI
 * provider whether each new caption announces a card show, and publish the
 * ones it is confident about into the storefront's shows list
 * (app_settings "shop_shows"). Anything uncertain waits in a review queue the
 * owner can approve from Admin → Shop settings.
 *
 * Instagram does not expose posts to anonymous visitors (servers and headless
 * browsers both land on the login page), so this needs an access token for the
 * account itself. Generate one in Meta for Developers (Instagram product →
 * "API setup with Instagram business login" → Generate token) and paste it in
 * Admin → Shop settings, or set INSTAGRAM_ACCESS_TOKEN. Long-lived tokens last
 * 60 days; this module refreshes them weekly so they never lapse.
 */
import { storage } from "./storage";
import { aiText } from "./ai";
import { broadcast } from "./realtime";
import { SHOWS as DEFAULT_SHOWS, type CardShow } from "@shared/shows-data";

const TOKEN_KEY = "ig_access_token";
const STATE_KEY = "ig_shows_state";
const GRAPH = process.env.INSTAGRAM_GRAPH_HOST || "https://graph.instagram.com";
const MAX_SEEN = 400;
const PUBLISH_MIN_CONFIDENCE = 0.75;
const REVIEW_MIN_CONFIDENCE = 0.35;

export type IgPost = {
  id: string;
  caption: string;
  permalink: string;
  timestamp: string;
  mediaType: string;
  thumbnail: string | null;
};

export type PendingShow = {
  postId: string;
  postUrl: string;
  postedAt: string;
  confidence: number;
  show: CardShow;
  reason?: string;
};

export type IgShowsState = {
  enabled: boolean;
  intervalMin: number;
  account: { id: string; username: string } | null;
  tokenSource: "settings" | "env" | null;
  tokenExpiresAt: number | null;
  lastRefreshAt: number | null;
  lastCheckAt: number | null;
  lastCheckDurationMs: number | null;
  lastError: string | null;
  lastPostAt: string | null;
  postsSeen: number;
  showsPublished: number;
  lastPublished: { name: string; start: string; postUrl: string; at: number }[];
  pending: PendingShow[];
  seen: Record<string, number>; // postId -> epoch seconds first seen
  running: boolean;
  nextCheckAt: number | null;
};

const now = () => Math.floor(Date.now() / 1000);

function defaultState(): IgShowsState {
  return {
    enabled: process.env.IG_SHOWS_DISABLED !== "1",
    intervalMin: parseInt(process.env.IG_SHOWS_INTERVAL_MIN ?? "30", 10) || 30,
    account: null,
    tokenSource: null,
    tokenExpiresAt: null,
    lastRefreshAt: null,
    lastCheckAt: null,
    lastCheckDurationMs: null,
    lastError: null,
    lastPostAt: null,
    postsSeen: 0,
    showsPublished: 0,
    lastPublished: [],
    pending: [],
    seen: {},
    running: false,
    nextCheckAt: null,
  };
}

let state: IgShowsState = defaultState();
let loaded = false;
let timer: NodeJS.Timeout | null = null;

async function loadState(): Promise<IgShowsState> {
  if (loaded) return state;
  try {
    const raw = await storage.getSetting(STATE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state = { ...defaultState(), ...saved, running: false };
    }
  } catch (err: any) {
    console.warn("[igShows] could not load state:", err?.message ?? err);
  }
  loaded = true;
  return state;
}

async function saveState(): Promise<void> {
  const { running, nextCheckAt, ...persist } = state;
  // Keep the seen-set bounded so the setting never grows without limit.
  const ids = Object.entries(persist.seen).sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN);
  persist.seen = Object.fromEntries(ids);
  persist.lastPublished = persist.lastPublished.slice(0, 20);
  persist.pending = persist.pending.slice(0, 30);
  await storage.setSetting(STATE_KEY, JSON.stringify(persist));
}

/** Resolve the token: the one saved from admin wins over the environment. */
export async function getToken(): Promise<{ token: string; source: "settings" | "env" } | null> {
  const saved = (await storage.getSetting(TOKEN_KEY)) || "";
  if (saved.trim()) return { token: saved.trim(), source: "settings" };
  const env = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (env) return { token: env, source: "env" };
  return null;
}

async function graphGet<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}${path.startsWith("/") ? "" : "/"}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = body?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    const code = body?.error?.code;
    throw new Error(`Instagram API ${res.status}${code ? ` (code ${code})` : ""}: ${msg}`);
  }
  return body as T;
}

/** Who does this token belong to? Used when saving a token and for the status card. */
export async function whoAmI(token: string): Promise<{ id: string; username: string }> {
  const me = await graphGet<{ id: string; username?: string }>("/me", { fields: "id,username", access_token: token });
  return { id: String(me.id), username: me.username || "" };
}

export async function fetchRecentPosts(token: string, limit = 20): Promise<IgPost[]> {
  const data = await graphGet<{ data: any[] }>("/me/media", {
    fields: "id,caption,permalink,timestamp,media_type,thumbnail_url,media_url",
    limit: String(limit),
    access_token: token,
  });
  return (data.data ?? []).map((m) => ({
    id: String(m.id),
    caption: String(m.caption ?? ""),
    permalink: String(m.permalink ?? ""),
    timestamp: String(m.timestamp ?? ""),
    mediaType: String(m.media_type ?? ""),
    thumbnail: m.thumbnail_url || (m.media_type === "IMAGE" ? m.media_url : null) || null,
  }));
}

/** Long-lived tokens last 60 days; refresh once a week (must be >24h old). */
async function maybeRefreshToken(): Promise<void> {
  const t = await getToken();
  if (!t || t.source !== "settings") return; // env tokens are managed by the operator
  const last = state.lastRefreshAt ?? 0;
  if (now() - last < 7 * 24 * 3600) return;
  try {
    const r = await graphGet<{ access_token: string; expires_in: number }>("/refresh_access_token", {
      grant_type: "ig_refresh_token",
      access_token: t.token,
    });
    if (r.access_token) {
      await storage.setSetting(TOKEN_KEY, r.access_token);
      state.lastRefreshAt = now();
      state.tokenExpiresAt = now() + (Number(r.expires_in) || 60 * 24 * 3600);
      console.log("[igShows] token refreshed");
    }
  } catch (err: any) {
    // A token younger than 24h can't be refreshed yet; that's fine.
    if (!/24 hours|too soon|not eligible/i.test(String(err?.message))) {
      console.warn("[igShows] token refresh failed:", err?.message ?? err);
    }
  }
}

// ---------- caption → show ----------

const CAPTION_HINT = /\b(show|con\b|convention|expo|vend(ing|or)|booth|table|meet (us|me)|come (see|find|visit)|this (weekend|saturday|sunday)|pop[- ]?up|market|swap meet|card night|trade night)\b/i;

function extractJson(text: string): any | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function cleanShow(raw: any): CardShow | null {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? "").trim().slice(0, 120);
  const start = String(raw.start ?? "").trim();
  const city = String(raw.city ?? "").trim().slice(0, 80);
  if (!name || !ISO.test(start) || !city) return null;
  const end = String(raw.end ?? "").trim();
  const show: CardShow = { name, start, city };
  if (ISO.test(end) && end > start) show.end = end;
  const opt = (k: keyof CardShow, max: number) => {
    const v = String((raw as any)[k] ?? "").trim();
    if (v) (show as any)[k] = v.slice(0, max);
  };
  opt("hours", 120); opt("venue", 160); opt("url", 300); opt("note", 200);
  if (show.url && !/^https?:\/\//i.test(show.url)) show.url = `https://${show.url.replace(/^\/+/, "")}`;
  if (show.url && !/^https?:\/\/[\w.-]+\.[a-z]{2,}/i.test(show.url)) delete show.url;
  const host = String(raw.host ?? "").trim().replace(/^@+/, "").replace(/[^A-Za-z0-9._]/g, "");
  if (host) show.host = host.slice(0, 60);
  return show;
}

/**
 * Ask the AI whether a caption announces shows the shop will vend at. Returns
 * [] for ordinary posts (pulls, restocks, giveaways...).
 */
export async function extractShowsFromCaption(post: IgPost): Promise<{ shows: CardShow[]; confidence: number; reason: string }> {
  const caption = post.caption.trim();
  if (!caption) return { shows: [], confidence: 0, reason: "no caption" };
  // Cheap pre-filter so we don't spend AI calls on pulls/restock posts.
  if (!CAPTION_HINT.test(caption) && !/\b(\d{1,2}\/\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(caption)) {
    return { shows: [], confidence: 0, reason: "no show keywords" };
  }
  const posted = post.timestamp ? post.timestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const prompt = `You read Instagram captions for Chris Collects Co, a trading-card shop in California that sells at card shows.
Decide whether this caption announces one or more upcoming card shows / conventions / pop-ups where the shop will be vending (a booth or table). Posts about pulls, restocks, giveaways, prices, or recapping a past show are NOT announcements.

Post date: ${posted}
Caption:
"""
${caption.slice(0, 2500)}
"""

Respond with JSON only, no prose:
{"is_show_announcement": true|false, "date_stated": true|false, "confidence": 0.0-1.0, "reason": "short", "shows": [{"name": "show name", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD or empty", "hours": "e.g. 10 AM – 5 PM or empty", "venue": "venue or empty", "city": "City, ST", "host": "organizer instagram handle without @ or empty", "url": "ticket/info link or empty", "note": "one short detail or empty"}]}
Rules: resolve dates relative to the post date (a date before the post date belongs to next year). Use the two-letter state. If the caption lists several shows, return each. "date_stated" is true only when the caption gives the actual day (e.g. "Nov 21-22", "12/7", "this Saturday the 8th"); "sometime in December", "soon" or "stay tuned" is NOT a stated date — set date_stated false and confidence 0.5 or less, and never invent a show name or day that is not in the caption. If unsure, lower the confidence rather than inventing details.`;
  const text = await aiText(prompt, { maxTokens: 700 });
  const j = extractJson(text);
  if (!j) return { shows: [], confidence: 0, reason: "unparseable AI reply" };
  let confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0));
  if (!j.is_show_announcement) return { shows: [], confidence, reason: String(j.reason ?? "not an announcement") };
  const shows = (Array.isArray(j.shows) ? j.shows : []).map(cleanShow).filter(Boolean) as CardShow[];
  // Belt and braces: a show needs a real day in the caption. If the model says
  // no date was stated, or the caption has no day number at all, it can only
  // go to the review queue, never straight to the storefront.
  const hasDayNumber = /\b\d{1,2}(st|nd|rd|th)?\b|\d{1,2}\/\d{1,2}/.test(caption);
  let reason = String(j.reason ?? "");
  if (j.date_stated === false || !hasDayNumber) {
    confidence = Math.min(confidence, 0.5);
    reason = `No exact date in the post — ${reason}`;
  }
  return { shows, confidence, reason };
}

// ---------- publishing ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function currentShows(): Promise<CardShow[]> {
  const raw = await storage.getSetting("shop_shows");
  if (raw) {
    try { return JSON.parse(raw) as CardShow[]; } catch { /* fall through */ }
  }
  return DEFAULT_SHOWS.map((s) => ({ ...s }));
}

/** Merge shows into the published list (update a same-name/same-date entry, else append). */
export async function publishShows(incoming: { show: CardShow; postUrl: string }[]): Promise<number> {
  if (!incoming.length) return 0;
  const list = await currentShows();
  let added = 0;
  for (const { show, postUrl } of incoming) {
    const tagged: CardShow = { ...show, source: "instagram", postUrl };
    const idx = list.findIndex((s) => s.start === show.start && (norm(s.name) === norm(show.name) || (s.venue && show.venue && norm(s.venue) === norm(show.venue))));
    if (idx >= 0) {
      // Keep anything the owner typed; fill blanks from the post.
      const cur = list[idx];
      list[idx] = { ...tagged, ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v !== "" && v != null)) } as CardShow;
    } else {
      list.push(tagged);
      added++;
    }
  }
  list.sort((a, b) => a.start.localeCompare(b.start));
  await storage.setSetting("shop_shows", JSON.stringify(list));
  broadcast({ type: "shows:update", payload: {} });
  return added;
}

// ---------- the check ----------

export async function runInstagramCheck(opts: { force?: boolean } = {}): Promise<IgShowsState> {
  await loadState();
  if (state.running) return state;
  state.running = true;
  const started = Date.now();
  try {
    const t = await getToken();
    state.tokenSource = t?.source ?? null;
    if (!t) {
      state.lastError = "No Instagram access token yet";
      state.account = null;
      return state;
    }
    await maybeRefreshToken();
    const tok = (await getToken())!.token;
    if (!state.account) state.account = await whoAmI(tok);

    const posts = await fetchRecentPosts(tok, 20);
    const today = new Date().toISOString().slice(0, 10);
    const toPublish: { show: CardShow; postUrl: string }[] = [];
    let newPosts = 0;
    for (const post of posts) {
      if (state.seen[post.id] && !opts.force) continue;
      newPosts++;
      state.seen[post.id] = now();
      if (!state.lastPostAt || post.timestamp > state.lastPostAt) state.lastPostAt = post.timestamp;
      try {
        const r = await extractShowsFromCaption(post);
        for (const show of r.shows) {
          // Never publish shows that are already over.
          if ((show.end || show.start) < today) continue;
          if (r.confidence >= PUBLISH_MIN_CONFIDENCE) {
            toPublish.push({ show, postUrl: post.permalink });
          } else if (r.confidence >= REVIEW_MIN_CONFIDENCE) {
            if (!state.pending.some((p) => p.postId === post.id && p.show.start === show.start)) {
              state.pending.unshift({ postId: post.id, postUrl: post.permalink, postedAt: post.timestamp, confidence: r.confidence, show, reason: r.reason });
            }
          }
        }
      } catch (err: any) {
        console.warn(`[igShows] AI failed on post ${post.id}:`, err?.message ?? err);
        // Leave it unseen so the next cycle retries.
        delete state.seen[post.id];
      }
    }
    state.postsSeen += newPosts;
    if (toPublish.length) {
      const added = await publishShows(toPublish);
      state.showsPublished += added;
      for (const p of toPublish) state.lastPublished.unshift({ name: p.show.name, start: p.show.start, postUrl: p.postUrl, at: now() });
      console.log(`[igShows] published ${toPublish.length} show(s) (${added} new) from Instagram`);
    }
    state.lastError = null;
  } catch (err: any) {
    state.lastError = String(err?.message ?? err);
    console.warn("[igShows] check failed:", state.lastError);
  } finally {
    state.lastCheckAt = now();
    state.lastCheckDurationMs = Date.now() - started;
    state.running = false;
    state.nextCheckAt = timer ? now() + state.intervalMin * 60 : null;
    await saveState().catch(() => {});
  }
  return state;
}

/** Owner saved/replaced the token from admin. Validates it first. */
export async function setToken(token: string): Promise<{ id: string; username: string }> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Token is empty");
  const who = await whoAmI(trimmed);
  await storage.setSetting(TOKEN_KEY, trimmed);
  await loadState();
  state.account = who;
  state.tokenSource = "settings";
  state.lastError = null;
  state.lastRefreshAt = now(); // brand-new tokens can't be refreshed for 24h anyway
  state.tokenExpiresAt = now() + 60 * 24 * 3600;
  await saveState();
  return who;
}

export async function clearToken(): Promise<void> {
  await storage.setSetting(TOKEN_KEY, "");
  await loadState();
  state.account = null;
  state.tokenSource = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim() ? "env" : null;
  state.tokenExpiresAt = null;
  await saveState();
}

export async function resolvePending(postId: string, start: string, action: "add" | "dismiss"): Promise<IgShowsState> {
  await loadState();
  const idx = state.pending.findIndex((p) => p.postId === postId && p.show.start === start);
  if (idx === -1) throw new Error("That suggestion is no longer pending");
  const [p] = state.pending.splice(idx, 1);
  if (action === "add") {
    const added = await publishShows([{ show: p.show, postUrl: p.postUrl }]);
    state.showsPublished += added;
    state.lastPublished.unshift({ name: p.show.name, start: p.show.start, postUrl: p.postUrl, at: now() });
  }
  await saveState();
  return state;
}

/** Status for the admin card (never includes the token itself). */
export async function getStatus(): Promise<Omit<IgShowsState, "seen"> & { hasToken: boolean; seenCount: number }> {
  await loadState();
  const t = await getToken();
  const { seen, ...rest } = state;
  return { ...rest, tokenSource: t?.source ?? null, hasToken: !!t, seenCount: Object.keys(seen).length };
}

export function startInstagramShows(): void {
  if (process.env.IG_SHOWS_DISABLED === "1") {
    console.log("[igShows] disabled via env");
    state.enabled = false;
    return;
  }
  if (timer) clearInterval(timer);
  const intervalMin = parseInt(process.env.IG_SHOWS_INTERVAL_MIN ?? "30", 10) || 30;
  state.intervalMin = intervalMin;
  console.log(`[igShows] checking Instagram for show posts every ${intervalMin} min`);
  // First check shortly after boot, then on the interval.
  setTimeout(() => { runInstagramCheck().catch(() => {}); }, 20_000);
  timer = setInterval(() => { runInstagramCheck().catch(() => {}); }, intervalMin * 60 * 1000);
  state.nextCheckAt = now() + 20;
}
