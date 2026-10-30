import * as XLSX from "xlsx";
import { storage, withDbRetry, isTransientDbError } from "./storage";
import { broadcast } from "./realtime";
import type { InsertInventory } from "@shared/schema";

/**
 * Auto-import inventory from a Google Drive-hosted Excel file (or any direct
 * .xlsx download URL). Runs every AUTO_IMPORT_INTERVAL_MIN minutes.
 *
 * Default sync mode: UPSERT — updates rows that match by SKU, inserts new
 * rows, leaves anything not in the sheet alone (e.g. items added via Scan).
 *
 * Configuration (env vars):
 *   AUTO_IMPORT_URL              — full share URL or direct download URL
 *   AUTO_IMPORT_ENABLED          — "true" / "false" (default: true if URL set)
 *   AUTO_IMPORT_INTERVAL_MIN     — minutes between runs (default 30)
 */

const DEFAULT_INTERVAL_MIN = 30;

export type AutoImportStatus = {
  enabled: boolean;
  url: string | null;
  intervalMin: number;
  lastRunAt: number | null;
  lastRunOk: boolean | null;
  lastRunMessage: string | null;
  lastInserted: number;
  lastUpdated: number;
  lastSkipped: number;
  nextRunAt: number | null;
};

const status: AutoImportStatus = {
  enabled: false,
  url: null,
  intervalMin: DEFAULT_INTERVAL_MIN,
  lastRunAt: null,
  lastRunOk: null,
  lastRunMessage: null,
  lastInserted: 0,
  lastUpdated: 0,
  lastSkipped: 0,
  nextRunAt: null,
};

let timer: NodeJS.Timeout | null = null;
let runningPromise: Promise<AutoImportStatus> | null = null;

// Persistence keys for the app_settings KV table. Storing config in the DB
// instead of process env means the URL survives Render redeploys.
const KEY_URL = "autoImport.url";
const KEY_ENABLED = "autoImport.enabled";
const KEY_INTERVAL = "autoImport.intervalMin";

async function loadPersistedConfig(): Promise<{
  url: string | null;
  enabled: boolean | null;
  intervalMin: number | null;
}> {
  try {
    const [url, enabled, interval] = await Promise.all([
      storage.getSetting(KEY_URL),
      storage.getSetting(KEY_ENABLED),
      storage.getSetting(KEY_INTERVAL),
    ]);
    const intervalNum = interval != null ? parseInt(interval, 10) : NaN;
    return {
      url: url && url.trim() ? url.trim() : null,
      enabled:
        enabled == null
          ? null
          : enabled.toLowerCase() === "true" || enabled === "1",
      intervalMin: Number.isFinite(intervalNum) ? intervalNum : null,
    };
  } catch (err) {
    console.error("[autoImport] failed to load persisted config", err);
    return { url: null, enabled: null, intervalMin: null };
  }
}

async function persistConfig(opts: {
  url?: string | null;
  enabled?: boolean;
  intervalMin?: number;
}) {
  try {
    const writes: Promise<unknown>[] = [];
    if (opts.url !== undefined) {
      writes.push(storage.setSetting(KEY_URL, opts.url ?? ""));
    }
    if (opts.enabled !== undefined) {
      writes.push(storage.setSetting(KEY_ENABLED, opts.enabled ? "true" : "false"));
    }
    if (opts.intervalMin !== undefined) {
      writes.push(storage.setSetting(KEY_INTERVAL, String(opts.intervalMin)));
    }
    await Promise.all(writes);
  } catch (err) {
    console.error("[autoImport] failed to persist config", err);
  }
}

/**
 * Convert a Google Drive share URL into a direct download URL. Accepts:
 *   https://drive.google.com/file/d/{ID}/view
 *   https://docs.google.com/spreadsheets/d/{ID}/edit?...
 *   https://drive.google.com/open?id={ID}
 * For non-Drive URLs, returns as-is.
 */
export function toDirectDownloadUrl(input: string): string {
  if (!input) return input;
  const trimmed = input.trim();

  // /file/d/ID/ pattern
  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  }

  // /spreadsheets/d/ID/ pattern — Drive-hosted .xlsx (not native Sheet)
  const sheetMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetMatch) {
    // For Drive-stored .xlsx files (rtpof=true), uc?export=download works.
    // For native Google Sheets, we'd need /export?format=xlsx — try that too.
    if (trimmed.includes("rtpof=true")) {
      return `https://drive.google.com/uc?export=download&id=${sheetMatch[1]}`;
    }
    return `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=xlsx`;
  }

  // ?id=ID pattern
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch && trimmed.includes("drive.google.com")) {
    return `https://drive.google.com/uc?export=download&id=${idMatch[1]}`;
  }

  return trimmed;
}

const FRANCHISE_ALIASES: Record<string, string> = {
  "pokemon": "Pokémon",
  "pokémon": "Pokémon",
  "one piece": "One Piece",
  "magic": "Magic The Gathering",
  "magic the gathering": "Magic The Gathering",
  "mtg": "Magic The Gathering",
  "dbz": "DBZ",
  "dragon ball z": "DBZ",
  "league of legends": "League of Legends",
  "lol": "League of Legends",
  "union arena": "Union Arena",
};

function normalizeFranchise(raw: string | null | undefined): string {
  if (!raw) return "Other";
  const key = String(raw).trim().toLowerCase();
  return FRANCHISE_ALIASES[key] ?? String(raw).trim();
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/[$,]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normalizeKey(k: string): string {
  // Lowercase, strip parentheticals, strip all non-alphanumerics.
  return k
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // remove (per unit), (who / where), etc.
    .replace(/[^a-z0-9]/g, "");
}

function pick(row: Record<string, any>, ...keys: string[]): any {
  // Try each candidate column key (case-insensitive, ignoring spaces/punct).
  const normalized = Object.keys(row).reduce<Record<string, string>>((acc, k) => {
    acc[normalizeKey(k)] = k;
    return acc;
  }, {});
  for (const key of keys) {
    const lookup = normalizeKey(key);
    const realKey = normalized[lookup];
    if (realKey !== undefined) {
      const val = row[realKey];
      if (val !== null && val !== undefined && val !== "") return val;
    }
  }
  return undefined;
}

function rowToItem(row: Record<string, any>, sheetFranchise: string): InsertInventory | null {
  const id = parseStr(pick(row, "id", "sku", "item id", "itemid", "card id", "cardid"));
  const name = parseStr(
    pick(row, "name", "item name", "itemname", "card name", "item", "title")
  );
  if (!id || !name) return null;

  return {
    id,
    franchise: normalizeFranchise(parseStr(pick(row, "franchise")) || sheetFranchise),
    category: parseStr(pick(row, "category", "type")) || "Raw",
    setName: parseStr(pick(row, "set", "set name", "setname", "edition")),
    name,
    rarity: parseStr(pick(row, "rarity")) || null,
    condition: parseStr(pick(row, "condition", "grade")) || null,
    qty: parseNum(pick(row, "qty", "quantity", "count")) ?? 1,
    source: parseStr(
      pick(
        row,
        "source",
        "supplier",
        "acquired from",
        "acquisition source",
        "acquisitionsource"
      )
    ) || null,
    costPerUnit: parseNum(
      pick(row, "cost per unit", "cost", "costperunit", "unit cost")
    ),
    totalCost: parseNum(pick(row, "total cost", "totalcost")),
    marketValue: parseNum(
      pick(
        row,
        "market value",
        "marketvalue",
        "value",
        "current market value",
        "currentmarketvalue"
      )
    ),
    asking: parseNum(
      pick(row, "asking", "asking price", "price", "askingprice")
    ),
    soldPrice: parseNum(
      pick(
        row,
        "sold price",
        "soldprice",
        "sale price",
        "actual sale price",
        "actualsaleprice"
      )
    ),
    status: parseStr(pick(row, "status", "inventory status", "inventorystatus")) || "In Inventory",
    notes: parseStr(pick(row, "notes", "note", "comment")) || null,
  } as InsertInventory;
}

/**
 * Detect whether a sheet looks like an inventory sheet (has Item ID + Item Name
 * columns, or sheet name contains "inventory"). Skips Sales Log, Events,
 * Expenses, Grading queue, Dashboard, etc.
 */
function looksLikeInventorySheet(sheetName: string, firstRow?: Record<string, any>): boolean {
  const n = sheetName.toLowerCase();
  if (/sales|expense|event|grading|dashboard|cheat|helper/.test(n)) return false;
  if (/inventory|stash|stock|items?/.test(n)) return true;
  if (!firstRow) return false;
  const keys = Object.keys(firstRow).map(normalizeKey);
  const hasId = keys.some((k) => k === "id" || k === "sku" || k === "itemid" || k === "cardid");
  const hasName = keys.some(
    (k) => k === "name" || k === "itemname" || k === "cardname" || k === "item"
  );
  return hasId && hasName;
}

async function fetchWorkbook(url: string): Promise<XLSX.WorkBook> {
  // Follow redirects (Google Drive serves a confirmation page for large files,
  // but our typical inventory size is well below the warning threshold).
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(`Download failed: HTTP ${resp.status}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  // Sanity check — Google sometimes returns an HTML virus-scan page.
  const head = buf.slice(0, 64).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    throw new Error(
      "Google returned an HTML page instead of the file. Make sure the share setting is 'Anyone with the link can view'."
    );
  }
  return XLSX.read(buf, { type: "buffer" });
}

export async function runAutoImport(opts: { wipe?: boolean } = {}): Promise<AutoImportStatus> {
  if (runningPromise) return runningPromise;
  runningPromise = (async () => {
    const startedAt = Date.now();
    status.lastRunAt = Math.floor(startedAt / 1000);

    try {
      if (!status.url) throw new Error("No source URL configured");
      const downloadUrl = toDirectDownloadUrl(status.url);
      const workbook = await fetchWorkbook(downloadUrl);

      const incoming: InsertInventory[] = [];
      const sheetsScanned: string[] = [];
      const sheetsSkipped: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
          defval: null,
          raw: true,
        });
        if (!looksLikeInventorySheet(sheetName, rows[0])) {
          sheetsSkipped.push(sheetName);
          continue;
        }
        sheetsScanned.push(sheetName);
        // Derive a default franchise hint from sheet name (e.g. "Pokémon - Inventory").
        const franchiseHint =
          sheetName.replace(/[-_–].*/, "").replace(/inventory/i, "").trim() ||
          sheetName;
        for (const row of rows) {
          const item = rowToItem(row, franchiseHint);
          if (item) incoming.push(item);
        }
      }
      console.log(
        `[autoImport] scanned sheets: ${sheetsScanned.join(", ") || "(none)"}; skipped: ${sheetsSkipped.join(", ") || "(none)"}`
      );

      // De-duplicate by SKU (keep last occurrence).
      const bySku = new Map<string, InsertInventory>();
      for (const it of incoming) bySku.set(it.id, it);
      const items = Array.from(bySku.values());

      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      const retry = <T,>(fn: () => Promise<T>) =>
        withDbRetry(fn, { attempts: 4, label: "autoImport" });

      if (opts.wipe) {
        await retry(() => storage.replaceInventory(items));
        inserted = items.length;
      } else {
        const existing = await retry(() => storage.listInventory());
        const existingIds = new Set(existing.map((r) => r.id));
        for (const it of items) {
          try {
            if (existingIds.has(it.id)) {
              const u = await retry(() => storage.updateInventory(it.id, it));
              if (u) updated += 1;
              else skipped += 1;
            } else {
              try {
                await retry(() => storage.createInventory(it));
              } catch (err) {
                // A retried insert may have landed on the first attempt even
                // though the socket died; treat "already exists" as success.
                if (!/unique|constraint|already exists/i.test(String((err as any)?.message ?? err))) throw err;
              }
              inserted += 1;
            }
          } catch (err) {
            skipped += 1;
            console.warn(`[autoImport] row skipped (${it.id})`, err);
          }
        }
      }

      status.lastRunOk = true;
      status.lastInserted = inserted;
      status.lastUpdated = updated;
      status.lastSkipped = skipped;
      status.lastRunMessage = opts.wipe
        ? `Wiped and imported ${items.length} rows fresh`
        : `Imported ${items.length} rows (${inserted} new, ${updated} updated, ${skipped} skipped)`;

      broadcast({ type: "inventory:bulk", payload: { source: "autoImport" } });
      console.log(`[autoImport] ${status.lastRunMessage}`);
    } catch (err: any) {
      status.lastRunOk = false;
      status.lastRunMessage = isTransientDbError(err)
        ? "Database connection dropped mid-import. It retried a few times without luck — run it again in a minute."
        : err?.message || String(err);
      console.error("[autoImport] failed:", err);
    } finally {
      status.nextRunAt = status.enabled
        ? Math.floor(Date.now() / 1000) + status.intervalMin * 60
        : null;
      runningPromise = null;
    }

    return { ...status };
  })();

  return runningPromise;
}

export async function startAutoImport() {
  // Load persisted config first — it overrides env vars so the UI setting
  // survives Render redeploys.
  const persisted = await loadPersistedConfig();

  const envUrl = (process.env.AUTO_IMPORT_URL || "").trim() || null;
  status.url = persisted.url ?? envUrl;

  const envInterval = parseInt(process.env.AUTO_IMPORT_INTERVAL_MIN || "", 10);
  const fallbackInterval =
    Number.isFinite(envInterval) && envInterval >= 5
      ? envInterval
      : DEFAULT_INTERVAL_MIN;
  status.intervalMin =
    persisted.intervalMin && persisted.intervalMin >= 5
      ? persisted.intervalMin
      : fallbackInterval;

  if (persisted.enabled !== null) {
    status.enabled = persisted.enabled && Boolean(status.url);
  } else {
    const enabledEnv = (process.env.AUTO_IMPORT_ENABLED || "").trim().toLowerCase();
    if (enabledEnv === "false" || enabledEnv === "0") {
      status.enabled = false;
    } else {
      status.enabled = Boolean(status.url);
    }
  }

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (!status.enabled || !status.url) {
    console.log("[autoImport] disabled (no URL configured)");
    status.nextRunAt = null;
    return;
  }

  console.log(
    `[autoImport] enabled — every ${status.intervalMin} min from ${status.url}`
  );

  // Run once shortly after startup, then on the interval.
  const kickoffMs = 30_000;
  status.nextRunAt = Math.floor((Date.now() + kickoffMs) / 1000);
  setTimeout(() => {
    runAutoImport().catch((e) => console.error("[autoImport] startup run failed", e));
  }, kickoffMs);

  timer = setInterval(() => {
    runAutoImport().catch((e) => console.error("[autoImport] interval run failed", e));
  }, status.intervalMin * 60 * 1000);
}

export function getAutoImportStatus(): AutoImportStatus {
  return { ...status };
}

export function setAutoImportConfig(opts: { url?: string | null; enabled?: boolean; intervalMin?: number }) {
  if (opts.url !== undefined) status.url = opts.url ? opts.url.trim() : null;
  if (opts.enabled !== undefined) status.enabled = opts.enabled && Boolean(status.url);
  if (opts.intervalMin !== undefined && opts.intervalMin >= 5) {
    status.intervalMin = opts.intervalMin;
  }

  // Persist to DB so config survives server restarts / Render redeploys.
  void persistConfig({
    url: opts.url,
    enabled: opts.enabled,
    intervalMin: opts.intervalMin,
  });

  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (status.enabled && status.url) {
    timer = setInterval(() => {
      runAutoImport().catch((e) => console.error("[autoImport] interval run failed", e));
    }, status.intervalMin * 60 * 1000);
    status.nextRunAt = Math.floor(Date.now() / 1000) + status.intervalMin * 60;
  } else {
    status.nextRunAt = null;
  }
  return { ...status };
}
