import {
  inventory,
  transactions,
  listings,
  trades,
  priceHistory,
  customerRequests,
  users,
  sessions,
  appSettings,
} from "@shared/schema";
import type {
  Inventory,
  InsertInventory,
  Transaction,
  InsertTransaction,
  Listing,
  InsertListing,
  Trade,
  InsertTrade,
  PriceHistory,
  InsertPriceHistory,
  CustomerRequest,
  InsertCustomerRequest,
  User,
  Session,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, desc, asc, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { correctSpelling, correctSetName } from "./pricing";

// Storage-level autocorrect. Applied to every create/update so any code path
// (manual entry, CSV upload, intake form, trade, scan, auto-import) gets the
// same cleanup. Corrects both card name and set name.
export function applyNameAutocorrect<
  T extends { name?: string | null; setName?: string | null },
>(input: T): T {
  if (!input || typeof input !== "object") return input;
  const out: any = { ...input };
  let changed = false;
  if (typeof out.name === "string" && out.name) {
    const c = correctSpelling(out.name);
    if (c !== out.name) {
      out.name = c;
      changed = true;
    }
  }
  if (typeof out.setName === "string" && out.setName) {
    const c = correctSetName(out.setName);
    if (c && c !== out.setName) {
      out.setName = c;
      changed = true;
    }
  }
  return changed ? out : input;
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./data.db",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export const db = drizzle(client);

// Turso closes idle HTTP connections; the next request then fails with
// "socket hang up" / ECONNRESET before anything reaches the database. Wrap
// idempotent operations in this to absorb those drops instead of failing a
// whole job over one dead socket.
export function isTransientDbError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  const code = String((err as any)?.code ?? (err as any)?.cause?.code ?? "").toUpperCase();
  return (
    msg.includes("socket hang up") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    (msg.includes("hrana") && msg.includes("closed")) ||
    ["ECONNRESET", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET", "ECONNREFUSED"].includes(code)
  );
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 400, label = "db" }: { attempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) throw err;
      const delay = baseDelayMs * 2 ** i;
      console.warn(`[${label}] transient database error, retrying in ${delay}ms (${i + 1}/${attempts - 1})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Migrations (run on startup) ───────────────────────────────
export async function runMigrations() {
  try {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS inventory (
        id TEXT PRIMARY KEY,
        franchise TEXT NOT NULL,
        category TEXT NOT NULL,
        set_name TEXT NOT NULL,
        name TEXT NOT NULL,
        rarity TEXT,
        condition TEXT,
        qty INTEGER NOT NULL DEFAULT 1,
        source TEXT,
        cost_per_unit REAL,
        total_cost REAL,
        market_value REAL,
        asking REAL,
        sold_price REAL,
        status TEXT NOT NULL DEFAULT 'In Inventory',
        notes TEXT,
        image_url TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        item_id TEXT,
        item_name TEXT,
        counterparty TEXT,
        price REAL,
        pnl REAL,
        date INTEGER NOT NULL,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT,
        asking_price REAL NOT NULL,
        listed_at INTEGER NOT NULL,
        seller_name TEXT,
        item_snapshot TEXT,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offered_item_id TEXT,
        offered_snapshot TEXT,
        requested_listing_id INTEGER,
        requested_snapshot TEXT,
        status TEXT NOT NULL DEFAULT 'Pending',
        direction TEXT NOT NULL,
        counterparty TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        price REAL NOT NULL,
        source TEXT NOT NULL,
        recorded_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_price_history_item ON price_history(item_id, recorded_at);

      CREATE TABLE IF NOT EXISTS customer_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        item_id TEXT,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT,
        customer_handle TEXT,
        preferred_contact TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        offer_price REAL,
        offer_description TEXT,
        offer_image_urls TEXT,
        message TEXT,
        payment_method TEXT,
        admin_note TEXT,
        status TEXT NOT NULL DEFAULT 'New',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_customer_requests_status ON customer_requests(status, created_at);

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);

    // ---- Idempotent column additions for richer TCGplayer price points ----
    // SQLite has no ADD COLUMN IF NOT EXISTS, so wrap each in a try.
    const tcgpColumns = [
      ["tcgp_product_id", "INTEGER"],
      ["tcgp_market_price", "REAL"],
      ["tcgp_most_recent_sale", "REAL"],
      ["tcgp_listed_median", "REAL"],
      ["tcgp_current_qty", "INTEGER"],
      ["tcgp_current_sellers", "INTEGER"],
      ["tcgp_volatility", "TEXT"],
      ["tcgp_low_sale_3mo", "REAL"],
      ["tcgp_high_sale_3mo", "REAL"],
      ["tcgp_total_sold_3mo", "INTEGER"],
      ["tcgp_avg_daily_sold", "REAL"],
      ["tcgp_history_json", "TEXT"],
      ["tcgp_priced_at", "INTEGER"],
      ["market_value_source", "TEXT"],
    ];
    for (const [col, type] of tcgpColumns) {
      try {
        await client.execute(
          `ALTER TABLE inventory ADD COLUMN ${col} ${type}`
        );
      } catch {
        // column already exists — ignore
      }
    }

    try {
      await client.execute(`ALTER TABLE customer_requests ADD COLUMN payment_method TEXT`);
    } catch {
      // column already exists — ignore
    }

    console.log("[db] Migrations complete");
  } catch (err) {
    console.error("[db] Migration error:", err);
    throw err;
  }
}

// ── Init (migrations + optional seed) ──────────────────────────
export async function init() {
  await runMigrations();
  // Lazy import to avoid circular dependency at module load time.
  const { runSeed } = await import("./seed");
  await runSeed();
}

export interface IStorage {
  // Inventory
  listInventory(): Promise<Inventory[]>;
  getInventoryItem(id: string): Promise<Inventory | undefined>;
  createInventory(item: InsertInventory): Promise<Inventory>;
  updateInventory(
    id: string,
    patch: Partial<InsertInventory>
  ): Promise<Inventory | undefined>;
  deleteInventory(id: string): Promise<void>;
  replaceInventory(items: InsertInventory[]): Promise<void>;

  // Transactions
  listTransactions(): Promise<Transaction[]>;
  getTransaction(id: number): Promise<Transaction | undefined>;
  deleteTransaction(id: number): Promise<void>;
  createTransaction(t: InsertTransaction): Promise<Transaction>;

  // Listings
  listListings(): Promise<Listing[]>;
  getListing(id: number): Promise<Listing | undefined>;
  createListing(l: InsertListing): Promise<Listing>;
  updateListing(
    id: number,
    patch: Partial<InsertListing>
  ): Promise<Listing | undefined>;
  deactivateListing(id: number): Promise<void>;

  // Trades
  listTrades(): Promise<Trade[]>;
  getTrade(id: number): Promise<Trade | undefined>;
  createTrade(t: InsertTrade): Promise<Trade>;
  updateTrade(id: number, patch: Partial<InsertTrade>): Promise<Trade | undefined>;

  // Price history
  listPriceHistory(itemId: string): Promise<PriceHistory[]>;
  createPriceHistory(p: InsertPriceHistory): Promise<PriceHistory>;

  // Customer requests
  listCustomerRequests(status?: string): Promise<CustomerRequest[]>;
  getCustomerRequest(id: number): Promise<CustomerRequest | undefined>;
  createCustomerRequest(r: InsertCustomerRequest): Promise<CustomerRequest>;
  updateCustomerRequest(
    id: number,
    patch: Partial<CustomerRequest>
  ): Promise<CustomerRequest | undefined>;

  // Auth
  createUser(data: { username: string; email: string; passwordHash: string; role?: string }): Promise<User>;
  updateUserRole(id: number, role: string): Promise<void>;
  getUserByUsernameOrEmail(identifier: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  updateUserPassword(id: number, passwordHash: string): Promise<void>;
  countUsers(): Promise<number>;
  listUsers(): Promise<User[]>;
  deleteUser(id: number): Promise<void>;
  deleteSessionsForUser(userId: number): Promise<void>;
  createSession(userId: number, ttlSeconds: number): Promise<Session>;
  getSession(token: string): Promise<Session | undefined>;
  deleteSession(token: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async listInventory(): Promise<Inventory[]> {
    return (await db.select().from(inventory).all()) as Inventory[];
  }
  async getInventoryItem(id: string): Promise<Inventory | undefined> {
    const rows = await db.select().from(inventory).where(eq(inventory.id, id)).all();
    return rows[0] as Inventory | undefined;
  }
  async createInventory(item: InsertInventory): Promise<Inventory> {
    const normalized = applyNameAutocorrect(item);
    const result = await db.insert(inventory).values(normalized).returning();
    return result[0] as Inventory;
  }
  async updateInventory(
    id: string,
    patch: Partial<InsertInventory>
  ): Promise<Inventory | undefined> {
    const existing = await this.getInventoryItem(id);
    if (!existing) return undefined;
    const normalized = applyNameAutocorrect(patch);
    const result = await db
      .update(inventory)
      .set(normalized)
      .where(eq(inventory.id, id))
      .returning();
    return result[0] as Inventory | undefined;
  }
  async deleteInventory(id: string): Promise<void> {
    await db.delete(inventory).where(eq(inventory.id, id));
  }
  async replaceInventory(items: InsertInventory[]): Promise<void> {
    items = items.map((it) => applyNameAutocorrect(it));
    await db.delete(inventory);
    const now = Math.floor(Date.now() / 1000);
    // libsql has no sync transaction API like better-sqlite3; insert in
    // modest batches using Drizzle's query builder.
    const batchSize = 50;
    for (let i = 0; i < items.length; i += batchSize) {
      const slice = items.slice(i, i + batchSize).map((it: any) => ({
        id: it.id,
        franchise: it.franchise,
        category: it.category,
        setName: it.setName,
        name: it.name,
        rarity: it.rarity ?? null,
        condition: it.condition ?? null,
        qty: it.qty ?? 1,
        source: it.source ?? null,
        costPerUnit: it.costPerUnit ?? null,
        totalCost: it.totalCost ?? null,
        marketValue: it.marketValue ?? null,
        asking: it.asking ?? null,
        soldPrice: it.soldPrice ?? null,
        status: it.status ?? "In Inventory",
        notes: it.notes ?? null,
        imageUrl: it.imageUrl ?? null,
        createdAt: now,
      }));
      if (slice.length > 0) {
        await db.insert(inventory).values(slice);
      }
    }
  }

  async listTransactions(): Promise<Transaction[]> {
    return (await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.date))
      .all()) as Transaction[];
  }
  async createTransaction(t: InsertTransaction): Promise<Transaction> {
    const result = await db.insert(transactions).values(t).returning();
    return result[0] as Transaction;
  }
  async getTransaction(id: number): Promise<Transaction | undefined> {
    const rows = await db.select().from(transactions).where(eq(transactions.id, id)).all();
    return rows[0] as Transaction | undefined;
  }
  async deleteTransaction(id: number): Promise<void> {
    await db.delete(transactions).where(eq(transactions.id, id));
  }

  async listListings(): Promise<Listing[]> {
    return (await db
      .select()
      .from(listings)
      .where(eq(listings.active, 1))
      .orderBy(desc(listings.listedAt))
      .all()) as Listing[];
  }
  async getListing(id: number): Promise<Listing | undefined> {
    const rows = await db.select().from(listings).where(eq(listings.id, id)).all();
    return rows[0] as Listing | undefined;
  }
  async createListing(l: InsertListing): Promise<Listing> {
    const result = await db.insert(listings).values(l).returning();
    return result[0] as Listing;
  }
  async updateListing(
    id: number,
    patch: Partial<InsertListing>
  ): Promise<Listing | undefined> {
    const result = await db
      .update(listings)
      .set(patch)
      .where(eq(listings.id, id))
      .returning();
    return result[0] as Listing | undefined;
  }
  async deactivateListing(id: number): Promise<void> {
    await db.update(listings).set({ active: 0 }).where(eq(listings.id, id));
  }

  async listTrades(): Promise<Trade[]> {
    return (await db.select().from(trades).orderBy(desc(trades.createdAt)).all()) as Trade[];
  }
  async getTrade(id: number): Promise<Trade | undefined> {
    const rows = await db.select().from(trades).where(eq(trades.id, id)).all();
    return rows[0] as Trade | undefined;
  }
  async createTrade(t: InsertTrade): Promise<Trade> {
    const result = await db.insert(trades).values(t).returning();
    return result[0] as Trade;
  }
  async updateTrade(
    id: number,
    patch: Partial<InsertTrade>
  ): Promise<Trade | undefined> {
    const result = await db
      .update(trades)
      .set(patch)
      .where(eq(trades.id, id))
      .returning();
    return result[0] as Trade | undefined;
  }

  async listPriceHistory(itemId: string): Promise<PriceHistory[]> {
    return (await db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.itemId, itemId))
      .orderBy(asc(priceHistory.recordedAt))
      .all()) as PriceHistory[];
  }
  async createPriceHistory(p: InsertPriceHistory): Promise<PriceHistory> {
    const result = await db.insert(priceHistory).values(p).returning();
    return result[0] as PriceHistory;
  }

  async listCustomerRequests(status?: string): Promise<CustomerRequest[]> {
    if (status) {
      return (await db
        .select()
        .from(customerRequests)
        .where(eq(customerRequests.status, status))
        .orderBy(desc(customerRequests.createdAt))
        .all()) as CustomerRequest[];
    }
    return (await db
      .select()
      .from(customerRequests)
      .orderBy(desc(customerRequests.createdAt))
      .all()) as CustomerRequest[];
  }
  async getCustomerRequest(id: number): Promise<CustomerRequest | undefined> {
    const rows = await db
      .select()
      .from(customerRequests)
      .where(eq(customerRequests.id, id))
      .all();
    return rows[0] as CustomerRequest | undefined;
  }
  async createCustomerRequest(r: InsertCustomerRequest): Promise<CustomerRequest> {
    const result = await db.insert(customerRequests).values(r).returning();
    return result[0] as CustomerRequest;
  }
  async updateCustomerRequest(
    id: number,
    patch: Partial<CustomerRequest>
  ): Promise<CustomerRequest | undefined> {
    const result = await db
      .update(customerRequests)
      .set(patch)
      .where(eq(customerRequests.id, id))
      .returning();
    return result[0] as CustomerRequest | undefined;
  }

  // ── Auth ──────────────────────────────────────────────────────────
  async createUser(data: {
    username: string;
    email: string;
    passwordHash: string;
    role?: string;
  }): Promise<User> {
    const result = await db
      .insert(users)
      .values({
        username: data.username,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role ?? "owner",
      })
      .returning();
    return result[0] as User;
  }

  async updateUserRole(id: number, role: string): Promise<void> {
    await db.update(users).set({ role }).where(eq(users.id, id)).run();
  }

  async getUserByUsernameOrEmail(identifier: string): Promise<User | undefined> {
    const id = identifier.trim();
    const rows = await db
      .select()
      .from(users)
      .where(or(eq(users.username, id), eq(users.email, id)))
      .all();
    return rows[0] as User | undefined;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id)).all();
    return rows[0] as User | undefined;
  }

  async updateUserPassword(id: number, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, id)).run();
  }

  async listUsers(): Promise<User[]> {
    const rows = await db.select().from(users).orderBy(users.createdAt).all();
    return rows as User[];
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id)).run();
  }

  async deleteSessionsForUser(userId: number): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId)).run();
  }

  async countUsers(): Promise<number> {
    const rows = await db.select({ c: sql<number>`count(*)` }).from(users).all();
    const n = (rows[0] as any)?.c;
    return typeof n === "number" ? n : Number(n ?? 0);
  }

  async createSession(userId: number, ttlSeconds: number): Promise<Session> {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;
    const result = await db
      .insert(sessions)
      .values({ id: token, userId, expiresAt })
      .returning();
    return result[0] as Session;
  }

  async getSession(token: string): Promise<Session | undefined> {
    const rows = await db.select().from(sessions).where(eq(sessions.id, token)).all();
    return rows[0] as Session | undefined;
  }

  async deleteSession(token: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, token));
  }

  // ── App settings (key/value) ────────────────────────────────────
  async getSetting(key: string): Promise<string | null> {
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .all();
    return rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(appSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: now },
      });
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const rows = await db.select().from(appSettings).all();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }
}

export const storage = new DatabaseStorage();
