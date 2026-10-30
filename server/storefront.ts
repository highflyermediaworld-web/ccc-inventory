/**
 * Storefront content + shop assistant routes.
 *
 *  Public
 *    GET  /api/shop/about          → About page copy (owner-published or defaults)
 *    POST /api/shop/chat           → "Ask CPulls" assistant (rate-limited)
 *  Admin (any signed-in staff)
 *    PUT    /api/admin/shop/about        → publish About copy
 *    DELETE /api/admin/shop/about        → back to the built-in copy
 *    POST   /api/admin/shop/about/photo  → upload the About photo (base64 in, URL out)
 *
 * About copy lives in app_settings under `shop_about` (Turso, survives deploys).
 * The photo is written to the persistent uploads disk under /uploads/about/.
 */
import type { Express, Request } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { broadcast } from "./realtime";
import { aiText, AiError } from "./ai";
import {
  ABOUT_LIMITS,
  BRAND_HANDLE,
  CASH_PCT,
  DEFAULT_ABOUT,
  FAQ_GROUPS,
  GAMES,
  INSTAGRAM_URL,
  TIKTOK_URL,
  TRADE_PCT,
  mergeAbout,
  plainText,
  type AboutContent,
} from "@shared/storefront";
import { SHOWS as DEFAULT_SHOWS, type CardShow } from "@shared/shows-data";

const ABOUT_KEY = "shop_about";

const aboutSchema = z.object({
  kicker: z.string().trim().max(60),
  title: z.string().trim().min(1, "Headline is required").max(140),
  intro: z.string().trim().max(600),
  storyHeading: z.string().trim().max(80),
  story: z.array(z.string().trim().max(1200)).max(ABOUT_LIMITS.story),
  photoUrl: z.string().trim().max(500).nullable(),
  photoAlt: z.string().trim().max(160),
  photoCaption: z.string().trim().max(160),
  facts: z.array(z.object({ title: z.string().trim().max(60), sub: z.string().trim().max(120) })).max(ABOUT_LIMITS.facts),
  valuesHeading: z.string().trim().max(80),
  values: z.array(z.object({ title: z.string().trim().max(60), body: z.string().trim().max(300) })).max(ABOUT_LIMITS.values),
  ctaHeading: z.string().trim().max(80),
  ctaBody: z.string().trim().max(300),
});

async function loadAbout(): Promise<{ source: "default" | "settings"; about: AboutContent }> {
  const raw = await storage.getSetting(ABOUT_KEY);
  if (!raw) return { source: "default", about: DEFAULT_ABOUT };
  try {
    return { source: "settings", about: mergeAbout(JSON.parse(raw)) };
  } catch {
    return { source: "default", about: DEFAULT_ABOUT };
  }
}

async function loadShows(): Promise<CardShow[]> {
  const raw = await storage.getSetting("shop_shows");
  if (!raw) return DEFAULT_SHOWS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CardShow[]) : DEFAULT_SHOWS;
  } catch {
    return DEFAULT_SHOWS;
  }
}

/* ------------------------------------------------------------------ */
/*  Assistant                                                          */
/* ------------------------------------------------------------------ */

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(800),
      }),
    )
    .min(1)
    .max(14),
});

// 20 messages per minute per IP — enough for a real conversation, not enough
// to turn the shop into a free LLM proxy.
const chatHits = new Map<string, { count: number; resetAt: number }>();
function chatRateLimited(req: Request): boolean {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const hit = chatHits.get(ip);
  if (!hit || hit.resetAt < now) {
    chatHits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  hit.count += 1;
  return hit.count > 20;
}

const STOP = new Set(["the", "and", "for", "you", "have", "card", "cards", "any", "got", "with", "what", "how", "much", "does", "this", "that", "are", "your", "sell", "buy", "trade", "price", "cost", "about", "can", "get", "there", "where", "when", "from", "do", "is", "it", "a", "an", "of", "in", "on", "to", "me", "my", "i", "we", "us", "pls", "please", "hey", "hi", "hello", "stock", "instock", "one", "piece", "magic", "gathering", "pokemon", "pokémon", "dragon", "ball", "yugioh", "yu-gi-oh"]);

type Listing = {
  name: string;
  setName: string | null;
  condition: string | null;
  category: string | null;
  franchise: string | null;
  qty: number | null;
  status: string;
  asking: number | null;
  marketValue: number | null;
  tcgpMarketPrice: number | null;
};

const inStock = (i: { status: string; qty: number | null }) =>
  (i.status === "In Inventory" || i.status === "Listed") && (i.qty ?? 0) > 0;

function money(n: number | null | undefined): string {
  return typeof n === "number" && n > 0 ? `$${n.toFixed(2)}` : "n/a";
}

/** Pull the handful of inventory rows the customer is probably asking about. */
function matchInventory(question: string, inv: Listing[]): Listing[] {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9#/\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
  if (!tokens.length) return [];
  const scored = inv
    .map((i) => {
      const hay = `${i.name} ${i.setName ?? ""} ${i.franchise ?? ""}`.toLowerCase();
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score += t.length >= 5 ? 2 : 1;
      if (score && inStock(i)) score += 0.5;
      return { i, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((s) => s.i);
}

function fmtShow(s: CardShow): string {
  const when = s.end && s.end !== s.start ? `${s.start} to ${s.end}` : s.start;
  const where = [s.venue, s.city].filter(Boolean).join(", ");
  const extra = [s.hours, s.note, s.url ? `info: ${s.url}` : null].filter(Boolean).join(" · ");
  return `- ${s.name} — ${when} — ${where}${extra ? ` — ${extra}` : ""}`;
}

async function buildPrompt(messages: { role: "user" | "assistant"; content: string }[]): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const [{ about }, shows, inv] = await Promise.all([
    loadAbout(),
    loadShows(),
    storage.listInventory().catch(() => [] as any[]),
  ]);

  const listings: Listing[] = (inv as any[]).map((i) => ({
    name: i.name,
    setName: i.setName ?? null,
    condition: i.condition ?? null,
    category: i.category ?? null,
    franchise: i.franchise ?? null,
    qty: i.qty ?? null,
    status: i.status,
    asking: typeof i.asking === "number" ? i.asking : null,
    marketValue: typeof i.marketValue === "number" ? i.marketValue : null,
    tcgpMarketPrice: typeof i.tcgpMarketPrice === "number" ? i.tcgpMarketPrice : null,
  }));
  const live = listings.filter(inStock);
  const byGame = new Map<string, number>();
  for (const l of live) byGame.set(l.franchise || "Other", (byGame.get(l.franchise || "Other") ?? 0) + 1);

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const matches = matchInventory(lastUser, listings);

  const upcoming = shows
    .filter((s) => (s.end || s.start) >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 6);
  const recent = shows
    .filter((s) => (s.end || s.start) < today)
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 3);

  const faq = FAQ_GROUPS.map((g) => `## ${g.title}\n${g.items.map((f) => `Q: ${f.q}\nA: ${plainText(f.a)}`).join("\n")}`).join("\n\n");

  const liveStatus = (await storage.getSetting("live_isLive")) === "true";
  const liveUrl = (await storage.getSetting("live_url")) || TIKTOK_URL;

  const transcript = messages.map((m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.content}`).join("\n");

  return `You are the shop assistant for CPulls Cards, a one-person trading card shop run by Chris in California (ships nationwide). You chat with customers on the storefront website. Today is ${today}.

VOICE: friendly, casual, short. 1–3 sentences unless listing cards or shows. No emojis. Plain text only (no markdown, no bullet symbols other than a simple "-" when listing). Never invent cards, prices, dates or policies that are not in the facts below. If you don't know, say so and point them to DM ${BRAND_HANDLE} on Instagram or TikTok. You cannot place orders, hold cards, or make binding offers — Chris confirms everything personally. Prices below are USD and may move with the market; say "about" when quoting.

SHOP FACTS
- Offers for cards customers sell: ${CASH_PCT}% of TCGplayer market in cash, ${TRADE_PCT}% in trade credit. The Sell & Trade calculator on the shop page (with a camera scanner) gives instant numbers.
- Games carried: ${GAMES.join(", ")}, plus graded slabs and sealed product.
- Shipping: within 48 hours of payment, US only, sleeve + toploader + team bag + bubble mailer, insured + tracked on high-value cards. 100% satisfaction guarantee.
- Buying: tap Buy on a card in the vault, leave contact info, Chris replies usually within 24 hours.
- Payment: credit / debit card, Apple Pay or Google Pay directly on the site — the Pay with card button on a listing opens Stripe's secure checkout, and 8.75% California sales tax is added there. Zelle, Venmo, Cash App, PayPal and Apple Cash also work: customers send a Buy request, pick the method, and Chris sends payment details after confirming the card. Tap to pay in person at shows. Shipping is arranged after payment.
- Trading: tap Trade on a card, describe what you have, add photos; Chris counters within about 24 hours. Trades also happen at shows.
- Contact: DM ${BRAND_HANDLE} — Instagram ${INSTAGRAM_URL}, TikTok ${TIKTOK_URL}.
- Live stream right now: ${liveStatus ? `YES — watching link ${liveUrl}` : "no"}.
- Site pages: Shop/vault at #/, FAQ at #/faq, About at #/about. Upcoming shows are on the shop page.

ABOUT CHRIS
${about.intro}
${about.story.join("\n")}

INVENTORY SNAPSHOT
- ${live.length} cards in stock right now${byGame.size ? ` (${Array.from(byGame.entries()).map(([g, n]) => `${g}: ${n}`).join(", ")})` : ""}.
${matches.length ? `- Cards that may match the customer's question (name — set — condition — our price — TCGplayer market — availability):\n${matches.map((m) => `  - ${m.name} — ${m.setName ?? "?"} — ${m.condition ?? "?"} — ${money(m.asking ?? m.marketValue)} — ${money(m.tcgpMarketPrice)} — ${inStock(m) ? `in stock (qty ${m.qty})` : "sold out"}`).join("\n")}` : "- No inventory rows matched the customer's last message. If they asked about a specific card, say you don't see it in the vault right now and suggest searching the vault or DMing."}

UPCOMING SHOWS
${upcoming.length ? upcoming.map(fmtShow).join("\n") : "- None published right now; new dates are announced on Instagram first."}
${recent.length ? `\nRECENT SHOWS (already happened)\n${recent.map(fmtShow).join("\n")}` : ""}

FAQ
${faq}

CONVERSATION
${transcript}
Assistant:`;
}

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */

export function registerStorefrontRoutes(app: Express, uploadsDir: string) {
  const aboutDir = path.join(uploadsDir, "about");
  fs.mkdirSync(aboutDir, { recursive: true });

  // ── About page copy ───────────────────────────────────────────────
  app.get("/api/shop/about", async (_req, res) => {
    try {
      res.json(await loadAbout());
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load about page" });
    }
  });

  app.put("/api/admin/shop/about", requireAuth, async (req, res) => {
    try {
      const about = aboutSchema.parse(req.body?.about ?? req.body);
      const clean: AboutContent = {
        ...about,
        story: about.story.filter((p) => p.length > 0),
        facts: about.facts.filter((f) => f.title || f.sub),
        values: about.values.filter((v) => v.title || v.body),
        photoUrl: about.photoUrl && about.photoUrl.length ? about.photoUrl : null,
      };
      await storage.setSetting(ABOUT_KEY, JSON.stringify(clean));
      broadcast({ type: "about:update", payload: {} });
      res.json({ ok: true, about: clean });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: err.issues[0]?.message || "Invalid about content" });
      res.status(400).json({ message: err?.message || "Failed to save about page" });
    }
  });

  app.delete("/api/admin/shop/about", requireAuth, async (_req, res) => {
    try {
      await storage.setSetting(ABOUT_KEY, "");
      broadcast({ type: "about:update", payload: {} });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Failed to reset about page" });
    }
  });

  app.post("/api/admin/shop/about/photo", requireAuth, async (req, res) => {
    try {
      const { imageBase64, mediaType } = z
        .object({ imageBase64: z.string().min(10), mediaType: z.string().optional() })
        .parse(req.body);
      const clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(clean, "base64");
      if (buffer.length > 8 * 1024 * 1024) return res.status(400).json({ message: "Photo exceeds 8 MB" });
      const ext = mediaType?.includes("png") ? "png" : mediaType?.includes("webp") ? "webp" : "jpg";
      const filename = `${randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(aboutDir, filename), buffer);
      res.json({ url: `/uploads/about/${filename}` });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Upload failed" });
    }
  });

  // ── Shop assistant ────────────────────────────────────────────────
  app.post("/api/shop/chat", async (req, res) => {
    if (chatRateLimited(req)) {
      return res.status(429).json({ message: "Slow down a little — try again in a minute, or DM @cpulls.cards." });
    }
    try {
      const { messages } = chatSchema.parse(req.body);
      const prompt = await buildPrompt(messages);
      const raw = await aiText(prompt, { maxTokens: 400 });
      const reply = raw.replace(/^Assistant:\s*/i, "").trim();
      if (!reply) throw new AiError("empty reply", 502, "none");
      res.json({ reply });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Message is too long or empty." });
      // Provider outage, missing key, network failure — all the same to the
      // customer: the bot is offline, a human is still reachable.
      console.error("shop chat error:", err instanceof AiError ? `${err.provider} ${err.status}: ${err.message}` : err?.message || err);
      res.status(503).json({ message: "Chat is offline right now. DM @cpulls.cards on Instagram or TikTok and a real person will answer.", offline: true });
    }
  });
}
