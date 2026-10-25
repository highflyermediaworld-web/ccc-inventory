/**
 * Provider-agnostic AI text/vision helper.
 *
 * Every AI call in this app is a single user prompt (optionally with one
 * image) that returns a short JSON-ish text answer, so a tiny abstraction is
 * enough to let the shop run on whichever provider has a working key:
 *
 *   AI_PROVIDER=gemini|openai|anthropic   explicit override (optional)
 *   GEMINI_API_KEY     → Google Gemini   (free tier available, no card needed)
 *   OPENAI_API_KEY     → OpenAI
 *   ANTHROPIC_API_KEY  → Anthropic (original integration)
 *
 * Without an override the first configured key in that order wins.
 */
import Anthropic from "@anthropic-ai/sdk";

export type AiProvider = "gemini" | "openai" | "anthropic";
export type AiImage = { base64: string; mediaType: string };

export class AiError extends Error {
  status: number;
  provider: AiProvider | "none";
  constructor(message: string, status: number, provider: AiProvider | "none") {
    super(message);
    this.name = "AiError";
    this.status = status;
    this.provider = provider;
  }
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
// Anthropic real model id (the underscored aliases only work via Perplexity's gateway).
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

const VALID_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ValidImageType = (typeof VALID_IMAGE_TYPES)[number];

function normalizeImage(img: AiImage): { data: string; mediaType: ValidImageType } {
  const data = img.base64.replace(/^data:image\/\w+;base64,/, "");
  const mediaType = (VALID_IMAGE_TYPES as readonly string[]).includes(img.mediaType)
    ? (img.mediaType as ValidImageType)
    : "image/jpeg";
  return { data, mediaType };
}

export function aiProvider(): AiProvider | null {
  const forced = String(process.env.AI_PROVIDER || "").toLowerCase();
  if (forced === "gemini" || forced === "openai" || forced === "anthropic") return forced;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function aiModel(provider: AiProvider | null = aiProvider()): string | null {
  if (provider === "gemini") return GEMINI_MODEL;
  if (provider === "openai") return OPENAI_MODEL;
  if (provider === "anthropic") return ANTHROPIC_MODEL;
  return null;
}

let anthropicClient: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

async function readError(res: Response, provider: AiProvider): Promise<AiError> {
  let detail = "";
  try {
    const body: any = await res.json();
    detail = body?.error?.message || body?.message || JSON.stringify(body).slice(0, 300);
  } catch {
    detail = await res.text().catch(() => "");
  }
  return new AiError(`${provider} ${res.status}: ${detail || res.statusText}`, res.status, provider);
}

async function geminiText(prompt: string, maxTokens: number, image?: AiImage): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("GEMINI_API_KEY is not set", 401, "gemini");
  const parts: any[] = [];
  if (image) {
    const { data, mediaType } = normalizeImage(image);
    parts.push({ inline_data: { mime_type: mediaType, data } });
  }
  parts.push({ text: prompt });
  const body: any = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0,
      // 2.5-series models spend "thinking" tokens out of the same budget, so
      // give them headroom and turn thinking off for these short JSON tasks.
      maxOutputTokens: Math.max(maxTokens, 1024),
    },
  };
  if (/^gemini-2\.5/.test(GEMINI_MODEL)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!res.ok) throw await readError(res, "gemini");
  const data: any = await res.json();
  const cand = data?.candidates?.[0];
  if (!cand) {
    const why = data?.promptFeedback?.blockReason || "no candidates";
    throw new AiError(`gemini returned no answer (${why})`, 502, "gemini");
  }
  return (cand?.content?.parts ?? [])
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

async function openaiText(prompt: string, maxTokens: number, image?: AiImage): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError("OPENAI_API_KEY is not set", 401, "openai");
  const content: any[] = [];
  if (image) {
    const { data, mediaType } = normalizeImage(image);
    content.push({ type: "image_url", image_url: { url: `data:${mediaType};base64,${data}`, detail: "high" } });
  }
  content.push({ type: "text", text: prompt });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: Math.max(maxTokens, 512),
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readError(res, "openai");
  const data: any = await res.json();
  const msg = data?.choices?.[0]?.message?.content;
  if (typeof msg === "string") return msg.trim();
  if (Array.isArray(msg)) return msg.map((p: any) => p?.text ?? "").join("").trim();
  return "";
}

async function anthropicText(prompt: string, maxTokens: number, image?: AiImage): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiError("ANTHROPIC_API_KEY is not set", 401, "anthropic");
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  if (image) {
    const { data, mediaType } = normalizeImage(image);
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
  }
  content.push({ type: "text", text: prompt });
  try {
    const msg = await anthropic().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    });
    for (const block of msg.content) {
      if (block.type === "text") return block.text.trim();
    }
    return "";
  } catch (err: any) {
    const status = Number(err?.status) || 502;
    throw new AiError(`anthropic ${status}: ${err?.message || err}`, status, "anthropic");
  }
}

/**
 * Run one prompt (optionally with an image) against the configured provider
 * and return the raw text answer. Throws AiError with the upstream HTTP status
 * when the provider rejects the call (billing, auth, quota, outage…).
 */
export async function aiText(
  prompt: string,
  opts: { maxTokens?: number; image?: AiImage } = {},
): Promise<string> {
  const provider = aiProvider();
  const maxTokens = opts.maxTokens ?? 512;
  if (provider === "gemini") return geminiText(prompt, maxTokens, opts.image);
  if (provider === "openai") return openaiText(prompt, maxTokens, opts.image);
  if (provider === "anthropic") return anthropicText(prompt, maxTokens, opts.image);
  throw new AiError(
    "No AI provider configured — set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY",
    503,
    "none",
  );
}

/** Cheap connectivity probe for the admin health check. */
export async function aiHealth(): Promise<{ provider: AiProvider | null; model: string | null; ok: boolean; error: string | null; status: number | null }> {
  const provider = aiProvider();
  const model = aiModel(provider);
  if (!provider) return { provider, model, ok: false, error: "No AI provider configured", status: 503 };
  try {
    const text = await aiText('Reply with exactly the word OK.', { maxTokens: 16 });
    return { provider, model, ok: text.length > 0, error: text.length ? null : "Empty reply", status: null };
  } catch (err: any) {
    return { provider, model, ok: false, error: err?.message || String(err), status: Number(err?.status) || null };
  }
}
