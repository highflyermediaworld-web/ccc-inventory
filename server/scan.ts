import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { tryRealSourcesOnly } from "./pricing";

const anthropic = new Anthropic();
// Anthropic real model id (the underscored aliases only work via Perplexity's gateway).
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

/**
 * Robustly extract the first JSON object/array from model output.
 * Handles code fences, stray prose, trailing text, etc.
 */
function parseJSON<T = any>(raw: string): T | null {
  if (!raw) return null;
  // Strip code fences
  let text = raw.replace(/```(?:json)?/gi, "```").split("```").filter(Boolean);
  let candidate = text.length > 1 ? text[1] : raw;
  // Try direct parse first
  try {
    return JSON.parse(candidate.trim());
  } catch {}
  // Find first balanced { ... } or [ ... ]
  for (const s of [candidate, raw]) {
    const startObj = s.indexOf("{");
    const startArr = s.indexOf("[");
    let start = -1;
    if (startObj === -1) start = startArr;
    else if (startArr === -1) start = startObj;
    else start = Math.min(startObj, startArr);
    if (start < 0) continue;
    const openChar = s[start];
    const closeChar = openChar === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === openChar) depth++;
      else if (c === closeChar) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function extractText(msg: Anthropic.Messages.Message): string {
  for (const block of msg.content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

async function identifyCardFromImage(
  imageBase64: string,
  mediaType: string,
  mode: "card" | "sealed" = "card"
): Promise<any> {
  const prompt =
    mode === "sealed"
      ? `You are identifying SEALED trading card product from a photo — booster boxes, booster bundles, ETBs (elite trainer boxes), collection boxes, tins, blisters, theme decks, starter decks, etc. Return ONLY valid JSON (no prose, no code fences) matching this exact schema:
{
  "name": string (full product name, e.g. "Vivid Voltage Booster Box"),
  "set": string (set / expansion name, e.g. "Vivid Voltage"),
  "number": string (set number / SKU printed on box if visible, else ""),
  "rarity": string (always "" for sealed product),
  "category": one of ["Booster Box","Booster Bundle","ETB","Collection Box","Tin","Blister","Theme Deck","Starter Deck","Booster Pack","Other Sealed"],
  "franchise": one of ["Pokémon","One Piece","Magic The Gathering","DBZ","League of Legends","Union Arena","Other"],
  "confidence": number from 0 to 1,
  "suggestedCondition": "Sealed"
}
If you cannot identify the product, return {"confidence":0,"name":"","set":"","number":"","rarity":"","category":"Other Sealed","franchise":"Other","suggestedCondition":"Sealed"}.`
      : `You are identifying a trading card from a photo. Return ONLY valid JSON (no prose, no code fences) matching this exact schema:
{
  "name": string,
  "set": string,
  "number": string,
  "rarity": string,
  "franchise": one of ["Pokémon","One Piece","Magic The Gathering","DBZ","League of Legends","Union Arena","Other"],
  "confidence": number from 0 to 1,
  "suggestedCondition": one of ["NM","LP","MP","HP","DMG","Sealed","Graded"]
}
If you cannot identify the card, return {"confidence":0,"name":"","set":"","number":"","rarity":"","franchise":"Other","suggestedCondition":"NM"}.`;

  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const validMediaType = (
    ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)
      ? mediaType
      : "image/jpeg"
  ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: validMediaType,
              data: cleanBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const text = extractText(msg);
  const parsed = parseJSON<any>(text);
  return (
    parsed ?? {
      name: "",
      set: "",
      number: "",
      rarity: "",
      franchise: "Other",
      confidence: 0,
      suggestedCondition: "NM",
    }
  );
}

export function registerScanRoutes(app: Express) {
  // --- IDENTIFY single image ---
  app.post("/api/scan/identify", async (req, res) => {
    try {
      const { imageBase64, mediaType, mode } = req.body ?? {};
      if (!imageBase64) {
        return res.status(400).json({ message: "imageBase64 required" });
      }
      const cleanMode: "card" | "sealed" = mode === "sealed" ? "sealed" : "card";
      const result = await identifyCardFromImage(
        imageBase64,
        mediaType || "image/jpeg",
        cleanMode
      );
      res.json(result);
    } catch (err: any) {
      console.error("scan/identify error:", err);
      res.status(500).json({ message: err.message || "Identify failed" });
    }
  });

  // --- BULK identify (concurrency 3) ---
  app.post("/api/scan/bulk", async (req, res) => {
    try {
      const schema = req.body?.images;
      if (!Array.isArray(schema)) {
        return res.status(400).json({ message: "images array required" });
      }
      const items: { imageBase64: string; mediaType: string }[] = schema;
      const results: any[] = new Array(items.length);
      const concurrency = 3;
      let idx = 0;
      async function worker() {
        while (true) {
          const i = idx++;
          if (i >= items.length) return;
          const item = items[i];
          try {
            results[i] = await identifyCardFromImage(
              item.imageBase64,
              item.mediaType || "image/jpeg"
            );
          } catch (e: any) {
            results[i] = { error: e.message || "failed", confidence: 0 };
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, () =>
          worker()
        )
      );
      res.json({ results });
    } catch (err: any) {
      console.error("scan/bulk error:", err);
      res.status(500).json({ message: err.message || "Bulk failed" });
    }
  });

  // --- BARCODE lookup (UPC/EAN) or QR URL fetch+extract ---
  app.get("/api/scan/barcode", async (req, res) => {
    try {
      const code = String(req.query.code || "").trim();
      const type = String(req.query.type || "upc"); // upc | qr
      if (!code) return res.status(400).json({ message: "code required" });

      // If it's a URL (QR slab case), fetch the page and have Claude extract grading info.
      if (/^https?:\/\//i.test(code)) {
        let pageText = "";
        try {
          const r = await fetch(code, {
            headers: { "User-Agent": "Mozilla/5.0 CCC-Scanner" },
          });
          const html = await r.text();
          // Strip script/style and tags, truncate
          pageText = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 8000);
        } catch (e: any) {
          pageText = "";
        }

        const prompt = `The URL ${code} was scanned from a QR code, typically on a PSA/CGC/BGS graded card slab. Below is the page text. Extract grading info and return ONLY valid JSON:
{
  "certNumber": string,
  "cardName": string,
  "setName": string,
  "year": string,
  "grade": string,
  "grader": one of ["PSA","CGC","BGS","SGC","Other"],
  "franchise": one of ["Pokémon","One Piece","Magic The Gathering","DBZ","League of Legends","Union Arena","Other"],
  "confidence": number 0 to 1
}
If unknown, set confidence:0.

PAGE TEXT:
${pageText || "(could not fetch — reason unknown)"}`;

        const msg = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        });
        const text = extractText(msg);
        const parsed = parseJSON<any>(text) ?? { confidence: 0 };
        return res.json({ kind: "slab", ...parsed, sourceUrl: code });
      }

      // UPC / EAN: ask Claude
      const prompt = `The UPC/EAN barcode "${code}" was scanned on a trading-card product. Identify the product. Return ONLY valid JSON:
{
  "productName": string,
  "franchise": one of ["Pokémon","One Piece","Magic The Gathering","DBZ","League of Legends","Union Arena","Other"],
  "setName": string,
  "category": one of ["Sealed","Raw"],
  "confidence": number 0 to 1
}
If unknown, set confidence:0.`;
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      const text = extractText(msg);
      const parsed = parseJSON<any>(text) ?? { confidence: 0 };
      res.json({ kind: "upc", code, ...parsed });
    } catch (err: any) {
      console.error("scan/barcode error:", err);
      res.status(500).json({ message: err.message || "Barcode lookup failed" });
    }
  });

  // --- SEARCH (autocomplete) ---
  app.get("/api/scan/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.json({ suggestions: [] });

      const prompt = `A trading-card collector is typing "${q}" into a search box. Return up to 8 distinct matching cards or sealed products as a JSON array (no prose, no fences):
[
  { "name": string, "set": string, "franchise": one of ["Pokémon","One Piece","Magic The Gathering","DBZ","League of Legends","Union Arena","Other"], "rarity": string, "category": one of ["Sealed","Raw","Slab"] }
]
Focus on popular / well-known cards. If nothing obvious, return [].`;
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      });
      const text = extractText(msg);
      const parsed = parseJSON<any>(text);
      const suggestions = Array.isArray(parsed) ? parsed.slice(0, 8) : [];
      res.json({ suggestions });
    } catch (err: any) {
      console.error("scan/search error:", err);
      res.status(500).json({ message: err.message || "Search failed" });
    }
  });

  // --- PRICE estimate ---
  app.post("/api/scan/price", async (req, res) => {
    try {
      const { name, set, franchise, rarity, condition } = req.body ?? {};
      if (!name && !set) {
        return res.json({
          marketValue: null,
          disclaimer: "Not enough info to estimate.",
        });
      }
      // Try real sources first (Scryfall/TCGdex) and short-circuit if we got a price.
      try {
        const real = await tryRealSourcesOnly({
          name: name ?? "",
          set: set ?? "",
          franchise: franchise ?? "",
        });
        if (real && real.marketValue != null) {
          return res.json({
            marketValue: real.marketValue,
            imageUrl: real.imageUrl,
            source: real.source,
            disclaimer: `Live price from ${real.source}.${real.note ? " " + real.note : ""}`,
          });
        }
      } catch {}
      const prompt = `Estimate current secondary-market value in USD for this trading card / product. Reason from general TCG market knowledge (eBay sold, TCGPlayer, etc.). Return ONLY valid JSON:
{ "marketValue": number (USD), "disclaimer": string }
Details:
- Name: ${name ?? ""}
- Set: ${set ?? ""}
- Franchise: ${franchise ?? ""}
- Rarity: ${rarity ?? ""}
- Condition: ${condition ?? "NM"}

If uncertain, return a best-guess number and make the disclaimer clearly call out the uncertainty. Always include the disclaimer string. Never return null for marketValue — use 0 if completely unknown.`;
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      });
      const text = extractText(msg);
      const parsed = parseJSON<any>(text) ?? {
        marketValue: 0,
        disclaimer: "Unable to estimate.",
      };
      const marketValue =
        typeof parsed.marketValue === "number" ? parsed.marketValue : 0;
      res.json({
        marketValue,
        source: "AI est",
        disclaimer:
          parsed.disclaimer ||
          "AI estimate based on general market knowledge. Verify with a live sales source before trading.",
      });
    } catch (err: any) {
      console.error("scan/price error:", err);
      res.status(500).json({ message: err.message || "Price failed" });
    }
  });
}
