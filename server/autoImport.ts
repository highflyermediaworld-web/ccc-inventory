import * as XLSX from "xlsx";
import { storage, withDbRetry, isTransientDbError, applyNameAutocorrect } from "./storage";
import { refreshItemsNow } from "./autoPricing";
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

function imageUrlFromRow(row: Record<string, any>): string | null {
  const raw = parseStr(
    pick(row, "image", "image url", "imageurl", "photo", "photo url", "picture", "img")
  );
  if (!raw) return null;
  // Google Sheets =IMAGE("url") formulas come through as the formula text.
  const m = raw.match(/https?:\/\/[^\s"')]+/i);
  return m ? m[0] : null;
}

// Names copied from TCGplayer come as "Product - Group Name (ABBR)" and
// sometimes "Card - 012 (Variant) - Group Name (ABBR) - FB10-057". The group
// segment duplicates the Set column and wrecks product matching, so drop it.
const GROUP_SEGMENT = /\s+-\s+((?:(?!\s+-\s+)[^()])+?)\s+\((?=[A-Za-z0-9_:\-]*[A-Za-z])([A-Za-z0-9][A-Za-z0-9_:\-]{1,14})\)(?=\s+-\s+|$)/g;
function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["the", "and", "promo", "promos", "cards", "packs", "set"].includes(w))
  );
}
function isGroupSegment(group: string, setName: string | null | undefined): boolean {
  const setWords = words(setName ?? "");
  const groupWords = words(group);
  const overlaps = setWords.size === 0 || [...groupWords].some((w) => setWords.has(w));
  // Classic TCGplayer group prefixes count even without a Set column.
  return overlaps || /^(SV|SWSH|SM|XY|ME|ME\d+|OP\d+|EB\d+|FB\d+|ST\d+|BT\d+|DBS|MCAP)\b|:/.test(group);
}
export function stripGroupSuffix(name: string, setName: string | null | undefined): string {
  let out = name.trim();
  for (let guard = 0; guard < 3; guard++) {
    let removed = false;
    GROUP_SEGMENT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GROUP_SEGMENT.exec(out))) {
      if (!isGroupSegment(m[1].trim(), setName)) continue;
      const candidate = (out.slice(0, m.index) + out.slice(m.index + m[0].length)).trim();
      if (!candidate) break;
      out = candidate;
      removed = true;
      break;
    }
    if (!removed) break;
  }
  // "Card - SM - Unbroken Bonds (SM10)" leaves a dangling era token behind.
  out = out.replace(/\s+-\s+(SM|SWSH|SV|XY|BW|DP|HGSS|ME|EX)$/i, "").trim();
  return out;
}

// Fields that identify *which* card a row is. If any of these change on an
// existing item, its looked-up photo and TCGplayer match are stale.
// ---- stock reconciliation between the sheet and online sales ----
const SHEET_STOCK_KEY = "autoImport_sheetStock";
const SOLD_STATUSES = new Set(["Sold", "Traded Out", "Traded"]);

function stockSignature(it: Pick<InsertInventory, "qty" | "status">): string {
  return `${it.qty ?? 1}|${it.status ?? "In Inventory"}`;
}

async function loadSheetStockSnapshot(): Promise<Record<string, string>> {
  try {
    const raw = await storage.getSetting(SHEET_STOCK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveSheetStockSnapshot(snap: Record<string, string>): Promise<void> {
  try {
    await storage.setSetting(SHEET_STOCK_KEY, JSON.stringify(snap));
  } catch (err) {
    console.warn("[autoImport] couldn't save sheet stock snapshot", err);
  }
}

/**
 * Decide whether the app's qty/status should survive this import.
 *  - Sheet row unchanged since the last import → the sheet has nothing new to
 *    say about stock; keep the app's numbers (an online sale lowered them).
 *  - Sheet row changed → Christian updated it; the sheet wins.
 *  - No snapshot yet (first run after this logic shipped) → keep the app's
 *    numbers only when they look like a sale happened in the app: fewer on
 *    hand than the sheet, or app says Sold while the sheet still says in stock.
 */
function keepAppStock(
  cur: { qty: number | null; status: string | null; soldPrice?: number | null },
  it: Pick<InsertInventory, "qty" | "status">,
  prevSig: string | undefined
): boolean {
  const sig = stockSignature(it);
  if (prevSig !== undefined) return prevSig === sig;
  const sheetQty = it.qty ?? 1;
  const appQty = cur.qty ?? 0;
  const sheetSold = SOLD_STATUSES.has(it.status ?? "");
  const appSold = SOLD_STATUSES.has(cur.status ?? "");
  if (appSold && !sheetSold && cur.soldPrice != null) return true;
  if (appQty < sheetQty && !sheetSold) return true;
  return false;
}

const IDENTITY_FIELDS = ["name", "setName", "franchise", "category", "rarity", "condition"] as const;

function same(a: unknown, b: unknown): boolean {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (typeof na === "number" && typeof nb === "number") return Math.abs(na - nb) < 1e-9;
  return na === nb;
}

function rowToItem(row: Record<string, any>, sheetFranchise: string): InsertInventory | null {
  const id = parseStr(pick(row, "id", "sku", "item id", "itemid", "card id", "cardid"));
  const name = parseStr(
    pick(row, "name", "item name", "itemname", "card name", "item", "title")
  );
  if (!id || !name) return null;
  const setNameRaw = parseStr(pick(row, "set", "set name", "setname", "edition"));

  const item: Record<string, unknown> = {
    id,
    franchise: normalizeFranchise(parseStr(pick(row, "franchise")) || sheetFranchise),
    category: parseStr(pick(row, "category", "type")) || "Raw",
    setName: setNameRaw,
    name: stripGroupSuffix(name, setNameRaw),
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
    // Optional: a photo link in the sheet wins over anything we'd look up.
    ...(imageUrlFromRow(row) ? { imageUrl: imageUrlFromRow(row) } : {}),
  };

  // The sheet is only authoritative for the columns it actually has. A sheet
  // without a Market Value column must not blank out the TCGplayer price the
  // app maintains, and an empty money cell means "no opinion", not zero.
  const OPTIONAL_COLUMNS: Record<string, string[]> = {
    rarity: ["rarity"],
    condition: ["condition", "grade"],
    qty: ["qty", "quantity", "count"],
    source: ["source", "supplier", "acquired from", "acquisition source", "acquisitionsource"],
    costPerUnit: ["cost per unit", "cost", "costperunit", "unit cost"],
    totalCost: ["total cost", "totalcost"],
    marketValue: ["market value", "marketvalue", "value", "current market value", "currentmarketvalue"],
    asking: ["asking", "asking price", "price", "askingprice"],
    soldPrice: ["sold price", "soldprice", "sale price", "actual sale price", "actualsaleprice"],
    status: ["status", "inventory status", "inventorystatus"],
    notes: ["notes", "note", "comment"],
  };
  const MONEY = new Set(["costPerUnit", "totalCost", "marketValue", "asking", "soldPrice"]);
  for (const [field, cols] of Object.entries(OPTIONAL_COLUMNS)) {
    if (!hasColumn(row, ...cols)) delete item[field];
    else if (MONEY.has(field) && item[field] == null) delete item[field];
  }
  return item as InsertInventory;
}

function hasColumn(row: Record<string, any>, ...keys: string[]): boolean {
  const present = new Set(Object.keys(row).map(normalizeKey));
  return keys.some((k) => present.has(normalizeKey(k)));
}

/**
 * Detect whether a sheet looks like an inventory sheet (has Item ID + Item Name
 * columns, or sheet name contains "inventory"). Skips Sales Log, Events,
 * Expenses, Grading queue, Dashboard, etc.
 */
function looksLikeInventorySheet(sheetName: string, firstRow?: Record<string, any>): boolean {
  const n = sheetName.toLowerCase();
  if (/sales|expense|event|grading|dashboard|cheat|helper/.test(n)) return false;
  // Archived copies of the inventory must never be merged into the live one.
  if (/outdated|archive|backup|\bold\b|previous|deprecated|\(old\)/.test(n)) return false;
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
      let unchanged = 0;
      // Items that need a photo / price lookup as soon as the import ends.
      const touched: string[] = [];

      const retry = <T,>(fn: () => Promise<T>) =>
        withDbRetry(fn, { attempts: 4, label: "autoImport" });
      const nextStock: Record<string, string> = {};
      let stockKept = 0;

      if (opts.wipe) {
        await retry(() => storage.replaceInventory(items));
        inserted = items.length;
        touched.push(...items.map((it) => it.id));
      } else {
        const existing = await retry(() => storage.listInventory());
        const existingById = new Map(existing.map((r) => [r.id, r]));
        // Stock (qty/status) is shared between the sheet and the shop: online
        // sales lower qty / mark Sold in the app, while Christian edits the
        // sheet by hand. Remember what the sheet said last time so we only
        // apply the sheet's stock when the sheet itself changed — otherwise a
        // card sold online would pop back into stock on the next import.
        const prevStock = await loadSheetStockSnapshot();
        for (const it of items) {
          try {
            const cur = existingById.get(it.id);
            const stockSig = stockSignature(it);
            nextStock[it.id] = stockSig;
            if (cur) {
              // Only write the columns that actually differ, so a 700-row
              // sheet that hasn't changed costs zero database writes.
              const normalized = applyNameAutocorrect(it) as Record<string, unknown>;
              const patch: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(normalized)) {
                if (k === "id") continue;
                if (!same(v, (cur as any)[k])) patch[k] = v;
              }
              if (("qty" in patch || "status" in patch) && keepAppStock(cur, it, prevStock[it.id])) {
                delete patch.qty;
                delete patch.status;
                stockKept += 1;
              }
              const identityChanged = IDENTITY_FIELDS.some((f) => f in patch);
              if (identityChanged) {
                // The row now describes a different card: drop the looked-up
                // photo and TCGplayer match so they're re-resolved. Photos the
                // admin uploaded or the sheet supplies are kept.
                const lookedUp = cur.imageUrl && /^https?:\/\//.test(cur.imageUrl) && !("imageUrl" in patch);
                if (lookedUp) patch.imageUrl = null;
                patch.tcgpProductId = null;
              }
              if (Object.keys(patch).length === 0) {
                unchanged += 1;
              } else {
                const u = await retry(() => storage.updateInventory(it.id, patch as any));
                if (u) updated += 1;
                else skipped += 1;
              }
              const after = { ...cur, ...patch } as typeof cur;
              if (identityChanged || !after.imageUrl || after.tcgpProductId == null) touched.push(it.id);
            } else {
              try {
                await retry(() => storage.createInventory(it));
              } catch (err) {
                // A retried insert may have landed on the first attempt even
                // though the socket died; treat "already exists" as success.
                if (!/unique|constraint|already exists/i.test(String((err as any)?.message ?? err))) throw err;
              }
              inserted += 1;
              touched.push(it.id);
            }
          } catch (err) {
            skipped += 1;
            console.warn(`[autoImport] row skipped (${it.id})`, err);
          }
        }
      }

      if (!opts.wipe) {
        await saveSheetStockSnapshot(nextStock);
        if (stockKept) console.log(`[autoImport] kept app stock for ${stockKept} item${stockKept === 1 ? "" : "s"} sold through the shop (sheet unchanged)`);
      }

      status.lastRunOk = true;
      status.lastInserted = inserted;
      status.lastUpdated = updated;
      status.lastSkipped = skipped;
      // Cap the follow-up lookup so a huge first import can't monopolise the
      // TCGplayer API; the scheduled cycle sweeps up anything left over.
      const MAX_TARGETED = 120;
      const toRefresh = touched.slice(0, MAX_TARGETED);
      status.lastRunMessage = opts.wipe
        ? `Wiped and imported ${items.length} rows fresh`
        : `Imported ${items.length} rows (${inserted} new, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped)`;
      if (toRefresh.length) {
        status.lastRunMessage += ` — fetching photos and prices for ${toRefresh.length} item${toRefresh.length === 1 ? "" : "s"}`;
      }

      broadcast({ type: "inventory:bulk", payload: { source: "autoImport" } });
      console.log(`[autoImport] ${status.lastRunMessage}`);

      if (toRefresh.length) {
        // Fire-and-forget so the Run Now button returns immediately; progress
        // shows up live in the inventory as each item resolves.
        void refreshItemsNow(toRefresh).catch((e) =>
          console.error("[autoImport] follow-up photo/price refresh failed", e)
        );
      }
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
