import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import express from "express";
import { storage, db } from "./storage";
import {
  insertInventorySchema,
  insertListingSchema,
  insertTradeSchema,
  insertCustomerRequestSchema,
  insertUserSchema,
  inventory,
  listings,
  transactions,
  trades,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { registerScanRoutes } from "./scan";
import {
  getAutoImportStatus,
  runAutoImport,
  setAutoImportConfig,
} from "./autoImport";
import { refreshItem, refreshAll, persistRefreshResult } from "./pricing";
import { broadcast } from "./realtime";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  requireAuth,
  hashPassword,
  verifyPassword,
  cookieOptions,
  SESSION_TTL_SECONDS,
  SESSION_COOKIE,
} from "./auth";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const CUSTOMER_UPLOADS_DIR = path.join(UPLOADS_DIR, "customer");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(CUSTOMER_UPLOADS_DIR, { recursive: true });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ===== Uploads (scan photos) =====
  app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "30d" }));

  // ===== AUTH (public) =====
  // Signup is gated by ADMIN_INVITE_CODE env var. The status endpoint lets the
  // UI show the right message when signup is disabled.
  app.get("/api/auth/status", async (_req, res) => {
    try {
      const userCount = await storage.countUsers();
      const signupEnabled = !!(process.env.ADMIN_INVITE_CODE ?? "").trim();
      res.json({ userCount, signupEnabled });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Status unavailable" });
    }
  });

  app.post("/api/auth/signup", async (req, res) => {
    try {
      const inviteCode = (process.env.ADMIN_INVITE_CODE ?? "").trim();
      if (!inviteCode) {
        return res
          .status(503)
          .json({ message: "Sign-up not available \u2014 ADMIN_INVITE_CODE not configured" });
      }
      const schema = insertUserSchema.extend({ inviteCode: z.string() });
      const parsed = schema.parse(req.body);
      if (parsed.inviteCode !== inviteCode) {
        return res.status(403).json({ message: "Invalid invite code" });
      }
      // Uniqueness
      const existingByName = await storage.getUserByUsernameOrEmail(parsed.username);
      if (existingByName) return res.status(409).json({ message: "Username already taken" });
      const existingByEmail = await storage.getUserByUsernameOrEmail(parsed.email);
      if (existingByEmail) return res.status(409).json({ message: "Email already registered" });

      const passwordHash = await hashPassword(parsed.password);
      const user = await storage.createUser({
        username: parsed.username.trim(),
        email: parsed.email.trim().toLowerCase(),
        passwordHash,
      });
      const session = await storage.createSession(user.id, SESSION_TTL_SECONDS);
      res.cookie(SESSION_COOKIE, session.id, cookieOptions());
      const { passwordHash: _omit, ...pub } = user;
      res.status(201).json({ user: pub });
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid input" });
      }
      res.status(400).json({ message: err?.message || "Sign-up failed" });
    }
  });

  // ── Admin credentials (env var — same pattern as Montalvo) ──
  // Owner can change ADMIN_USERNAME / ADMIN_PASSWORD in Render at any time;
  // login matches against env vars first, then upserts the user row so existing
  // session infrastructure keeps working.
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Cpullscards";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cpulls2026";

  app.post("/api/auth/login", async (req, res) => {
    try {
      const schema = z.object({
        identifier: z.string().trim().min(1),
        password: z.string().min(1),
      });
      const { identifier, password } = schema.parse(req.body);

      // Env-var admin path: matches username (case-insensitive) + password.
      const matchesEnvAdmin =
        identifier.toLowerCase() === ADMIN_USERNAME.toLowerCase() &&
        password === ADMIN_PASSWORD;

      if (matchesEnvAdmin) {
        const email = `${ADMIN_USERNAME}@cpulls.cards`.toLowerCase();
        let user =
          (await storage.getUserByUsernameOrEmail(ADMIN_USERNAME)) ??
          (await storage.getUserByUsernameOrEmail(email));
        const passwordHash = await hashPassword(ADMIN_PASSWORD);
        if (!user) {
          user = await storage.createUser({
            username: ADMIN_USERNAME,
            email,
            passwordHash,
          });
        } else {
          // Keep stored hash in sync so old sessions that reach requireAuth still work
          await storage.updateUserPassword(user.id, passwordHash);
        }
        const session = await storage.createSession(user.id, SESSION_TTL_SECONDS);
        res.cookie(SESSION_COOKIE, session.id, cookieOptions());
        const { passwordHash: _omit, ...pub } = user;
        return res.json({ user: pub });
      }

      // Fallback: existing DB-stored user lookup
      const user = await storage.getUserByUsernameOrEmail(identifier);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ message: "Invalid credentials" });
      const session = await storage.createSession(user.id, SESSION_TTL_SECONDS);
      res.cookie(SESSION_COOKIE, session.id, cookieOptions());
      const { passwordHash: _omit, ...pub } = user;
      res.json({ user: pub });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Login failed" });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (token) await storage.deleteSession(token);
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Logout failed" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    res.json({ user: (req as any).user });
  });

  // ===== ADMIN USER MANAGEMENT =====
  // List, create, reset, and delete admin users. All require an authenticated session.
  app.get("/api/admin/users", requireAuth, async (_req, res) => {
    try {
      const rows = await storage.listUsers();
      const pub = rows.map((u: any) => {
        const { passwordHash: _omit, ...rest } = u;
        return rest;
      });
      res.json({ users: pub });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to list users" });
    }
  });

  app.post("/api/admin/users", requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        username: z.string().trim().min(2).max(64),
        password: z.string().min(8, "At least 8 characters"),
        email: z.string().trim().email().optional(),
      });
      const parsed = schema.parse(req.body);
      const username = parsed.username;
      const email = (parsed.email ?? `${username}@cpulls.cards`).toLowerCase();

      const existsName = await storage.getUserByUsernameOrEmail(username);
      if (existsName) return res.status(409).json({ message: "Username already taken" });
      const existsEmail = await storage.getUserByUsernameOrEmail(email);
      if (existsEmail) return res.status(409).json({ message: "Email already registered" });

      const passwordHash = await hashPassword(parsed.password);
      const user = await storage.createUser({ username, email, passwordHash });
      const { passwordHash: _omit, ...pub } = user;
      res.status(201).json({ user: pub });
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid input" });
      }
      res.status(400).json({ message: err?.message || "Failed to create user" });
    }
  });

  app.patch("/api/admin/users/:id/password", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      const schema = z.object({ password: z.string().min(8, "At least 8 characters") });
      const { password } = schema.parse(req.body);
      const user = await storage.getUserById(id);
      if (!user) return res.status(404).json({ message: "User not found" });
      const passwordHash = await hashPassword(password);
      await storage.updateUserPassword(id, passwordHash);
      // Invalidate all sessions for that user so they have to sign in again
      await storage.deleteSessionsForUser(id);
      res.json({ ok: true });
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid input" });
      }
      res.status(400).json({ message: err?.message || "Failed to reset password" });
    }
  });

  app.delete("/api/admin/users/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      const me = (req as any).user;
      if (me?.id === id) return res.status(400).json({ message: "Cannot delete the currently signed-in account" });
      const total = await storage.countUsers();
      if (total <= 1) return res.status(400).json({ message: "At least one admin must remain" });
      await storage.deleteSessionsForUser(id);
      await storage.deleteUser(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Failed to delete user" });
    }
  });


  // ===== AUTH GUARD =====
  // Every /api/* route is protected except the allowlist below. This runs after
  // all /api/auth/* handlers (registered above) because Express resolves them
  // in definition order — routes registered first match first.
  const PUBLIC_PREFIXES = [
    "/api/auth/",
    "/api/shop/", // public storefront: listings, buy, trade, upload
  ];
  app.use("/api", (req, res, next) => {
    // Full req.path here is relative to the "/api" mount: "/inventory", etc.
    const full = "/api" + req.path;
    if (PUBLIC_PREFIXES.some((p) => full.startsWith(p))) return next();
    return requireAuth(req, res, next);
  });

  // Accept a base64 image, persist to disk, return a relative URL.
  app.post("/api/uploads/image", async (req, res) => {
    try {
      const schema = z.object({
        imageBase64: z.string().min(10),
        mediaType: z.string().optional(),
      });
      const { imageBase64, mediaType } = schema.parse(req.body);
      const clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const ext =
        mediaType && mediaType.includes("png")
          ? "png"
          : mediaType && mediaType.includes("webp")
            ? "webp"
            : "jpg";
      const filename = `${randomUUID()}.${ext}`;
      const fullPath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(fullPath, Buffer.from(clean, "base64"));
      res.json({ url: `/uploads/${filename}` });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Upload failed" });
    }
  });

  // ===== AUTO IMPORT (Excel from Google Drive every 30 min) =====
  app.get("/api/admin/auto-import", requireAuth, async (_req, res) => {
    res.json(getAutoImportStatus());
  });

  app.post("/api/admin/auto-import/run", requireAuth, async (req, res) => {
    const wipe = req.body?.wipe === true;
    const result = await runAutoImport({ wipe });
    res.json(result);
  });

  app.patch("/api/admin/auto-import", requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        url: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
        intervalMin: z.number().int().min(5).max(1440).optional(),
      });
      const patch = schema.parse(req.body);
      const next = setAutoImportConfig(patch);
      res.json(next);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Invalid config" });
    }
  });

  // ===== SCAN (AI) =====
  registerScanRoutes(app);

  // ===== PRICING (real feeds) =====
  app.post("/api/pricing/refresh/:itemId", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.itemId);
      if (!item) return res.status(404).json({ message: "Item not found" });
      const result = await refreshItem(item);
      if (result.marketValue != null) {
        await persistRefreshResult(item, result);
        const updated = await storage.getInventoryItem(item.id);
        if (updated) broadcast({ type: "inventory:update", payload: updated });
      }
      res.json(result);
    } catch (err: any) {
      console.error("pricing/refresh error:", err);
      res.status(500).json({ message: err?.message || "Refresh failed" });
    }
  });

  app.post("/api/pricing/refresh-all", async (_req, res) => {
    // Long-running: client shows a spinner until this resolves.
    try {
      const result = await refreshAll();
      broadcast({ type: "inventory:bulk", payload: {} });
      res.json(result);
    } catch (err: any) {
      console.error("pricing/refresh-all error:", err);
      res.status(500).json({ message: err?.message || "Refresh failed" });
    }
  });

  // Price history for a single item (sorted ascending)
  app.get("/api/inventory/:id/history", async (req, res) => {
    try {
      const history = await storage.listPriceHistory(req.params.id);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "History fetch failed" });
    }
  });

  // ===== INVENTORY =====
  app.get("/api/inventory", async (_req, res) => {
    const items = await storage.listInventory();
    res.json(items);
  });

  app.get("/api/inventory/:id", async (req, res) => {
    const item = await storage.getInventoryItem(req.params.id);
    if (!item) return res.status(404).json({ message: "Not found" });
    res.json(item);
  });

  app.post("/api/inventory", async (req, res) => {
    try {
      const parsed = insertInventorySchema.parse(req.body);
      const item = await storage.createInventory(parsed);
      // If the user set a market value on creation, record it as the first history row.
      if (item.marketValue != null) {
        await storage.createPriceHistory({
          itemId: item.id,
          price: Number(item.marketValue),
          source: "Manual",
        });
      }
      broadcast({ type: "inventory:create", payload: item });
      res.status(201).json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    try {
      const patch = insertInventorySchema.partial().parse(req.body);
      const existing = await storage.getInventoryItem(req.params.id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      // Auto-recompute totalCost when qty or costPerUnit is edited.
      if (
        (patch.qty !== undefined || patch.costPerUnit !== undefined) &&
        patch.totalCost === undefined
      ) {
        const nextQty = patch.qty !== undefined ? Number(patch.qty) : Number(existing.qty);
        const nextCpu =
          patch.costPerUnit !== undefined
            ? Number(patch.costPerUnit)
            : Number(existing.costPerUnit ?? 0);
        if (!Number.isNaN(nextQty) && !Number.isNaN(nextCpu)) {
          (patch as any).totalCost = Math.round(nextQty * nextCpu * 100) / 100;
        }
      }
      const item = await storage.updateInventory(req.params.id, patch);
      // If market value changed via manual edit, record a Manual history row
      if (
        item &&
        patch.marketValue != null &&
        Number(patch.marketValue) !== Number(existing.marketValue ?? NaN)
      ) {
        await storage.createPriceHistory({
          itemId: item.id,
          price: Number(patch.marketValue),
          source: "Manual",
        });
      }
      if (item) broadcast({ type: "inventory:update", payload: item });
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inventory/:id", async (req, res) => {
    await storage.deleteInventory(req.params.id);
    broadcast({ type: "inventory:delete", payload: { id: req.params.id } });
    res.json({ ok: true });
  });

  // Mark as sold — creates transaction + updates status
  app.post("/api/inventory/:id/sell", async (req, res) => {
    try {
      const schema = z.object({
        soldPrice: z.number(),
        counterparty: z.string().optional(),
        notes: z.string().optional(),
      });
      const { soldPrice, counterparty, notes } = schema.parse(req.body);
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ message: "Not found" });
      const updated = await storage.updateInventory(req.params.id, {
        status: "Sold",
        soldPrice,
      });
      const pnl = (soldPrice ?? 0) - (item.totalCost ?? 0);
      await storage.createTransaction({
        type: "Sell",
        itemId: item.id,
        itemName: `${item.setName} — ${item.name}`,
        counterparty: counterparty ?? null,
        price: soldPrice,
        pnl,
        notes: notes ?? null,
      });
      // Deactivate any user listings for this item
      const existing = await storage.listListings();
      for (const l of existing.filter((x) => x.itemId === item.id && !x.sellerName)) {
        await storage.deactivateListing(l.id);
      }
      if (updated) broadcast({ type: "inventory:update", payload: updated });
      broadcast({ type: "transactions:update", payload: {} });
      broadcast({ type: "listings:update", payload: {} });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Bulk replace (for Excel import)
  app.post("/api/inventory/import", async (req, res) => {
    try {
      const schema = z.object({
        items: z.array(insertInventorySchema),
        mode: z.enum(["replace", "merge"]).default("merge"),
      });
      const { items, mode } = schema.parse(req.body);
      if (mode === "replace") {
        await storage.replaceInventory(items);
      } else {
        // Merge: upsert each
        for (const it of items) {
          const existing = await storage.getInventoryItem(it.id);
          if (existing) {
            await storage.updateInventory(it.id, it);
          } else {
            await storage.createInventory(it);
          }
        }
      }
      broadcast({ type: "inventory:bulk", payload: {} });
      res.json({ ok: true, count: items.length });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ===== LISTINGS =====
  app.get("/api/listings", async (req, res) => {
    const scope = req.query.scope as string | undefined;
    const all = await storage.listListings();
    if (scope === "mine") {
      return res.json(all.filter((l) => !l.sellerName));
    } else if (scope === "market") {
      return res.json(all.filter((l) => !!l.sellerName));
    }
    res.json(all);
  });

  app.post("/api/listings", async (req, res) => {
    try {
      const schema = z.object({
        itemId: z.string(),
        askingPrice: z.number(),
      });
      const { itemId, askingPrice } = schema.parse(req.body);
      const item = await storage.getInventoryItem(itemId);
      if (!item) return res.status(404).json({ message: "Item not found" });
      const listing = await storage.createListing({
        itemId,
        askingPrice,
        sellerName: null,
        itemSnapshot: null,
        active: 1,
      });
      const updInv = await storage.updateInventory(itemId, { status: "Listed", asking: askingPrice });
      broadcast({ type: "listings:update", payload: {} });
      if (updInv) broadcast({ type: "inventory:update", payload: updInv });
      res.status(201).json(listing);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/listings/:id", async (req, res) => {
    try {
      const schema = z.object({ askingPrice: z.number() });
      const { askingPrice } = schema.parse(req.body);
      const updated = await storage.updateListing(Number(req.params.id), {
        askingPrice,
      });
      if (updated?.itemId) {
        const updInv = await storage.updateInventory(updated.itemId, { asking: askingPrice });
        if (updInv) broadcast({ type: "inventory:update", payload: updInv });
      }
      broadcast({ type: "listings:update", payload: {} });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/listings/:id", async (req, res) => {
    const id = Number(req.params.id);
    const listing = await storage.getListing(id);
    await storage.deactivateListing(id);
    if (listing?.itemId) {
      const updInv = await storage.updateInventory(listing.itemId, {
        status: "In Inventory",
        asking: null,
      });
      if (updInv) broadcast({ type: "inventory:update", payload: updInv });
    }
    broadcast({ type: "listings:update", payload: {} });
    res.json({ ok: true });
  });

  // Buy Now — purchase a mock marketplace listing
  app.post("/api/listings/:id/buy", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const listing = await storage.getListing(id);
      if (!listing || !listing.sellerName) {
        return res.status(404).json({ message: "Marketplace listing not found" });
      }
      const snap = listing.itemSnapshot ? JSON.parse(listing.itemSnapshot) : {};
      // Create a new inventory item with auto-generated SKU
      const prefixMap: Record<string, string> = {
        Pokémon: "PK",
        "One Piece": "OP",
        "Magic The Gathering": "MTG",
        DBZ: "DBZ",
        "League of Legends": "LOL",
        "Union Arena": "UA",
      };
      const prefix = prefixMap[snap.franchise] ?? "X";
      // Find next number
      const existing = await storage.listInventory();
      const maxNum = existing
        .filter((i) => i.id.startsWith(prefix + "-"))
        .map((i) => parseInt(i.id.split("-")[1] || "0", 10))
        .filter((n) => !isNaN(n))
        .reduce((a, b) => Math.max(a, b), 0);
      const newId = `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
      await storage.createInventory({
        id: newId,
        franchise: snap.franchise ?? "Unknown",
        category: snap.category ?? "Raw",
        setName: snap.setName ?? "",
        name: snap.name ?? "",
        rarity: snap.rarity ?? null,
        condition: snap.condition ?? "NM",
        qty: 1,
        source: listing.sellerName,
        costPerUnit: listing.askingPrice,
        totalCost: listing.askingPrice,
        marketValue: listing.askingPrice,
        asking: null,
        soldPrice: null,
        status: "In Inventory",
        notes: `Purchased from ${listing.sellerName}`,
      });
      await storage.deactivateListing(id);
      const newItem = await storage.getInventoryItem(newId);
      if (newItem) broadcast({ type: "inventory:create", payload: newItem });
      broadcast({ type: "listings:update", payload: {} });
      broadcast({ type: "transactions:update", payload: {} });
      await storage.createTransaction({
        type: "Buy",
        itemId: newId,
        itemName: `${snap.setName ?? ""} — ${snap.name ?? ""}`,
        counterparty: listing.sellerName,
        price: listing.askingPrice,
        pnl: null,
        notes: null,
      });
      res.json({ ok: true, newItemId: newId });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ===== TRANSACTIONS =====
  app.get("/api/transactions", async (_req, res) => {
    const items = await storage.listTransactions();
    res.json(items);
  });

  // ===== TRADES =====
  app.get("/api/trades", async (_req, res) => {
    const items = await storage.listTrades();
    res.json(items);
  });

  // Propose outgoing trade: offer one of my items for a marketplace listing
  app.post("/api/trades", async (req, res) => {
    try {
      const schema = z.object({
        offeredItemId: z.string(),
        requestedListingId: z.number(),
      });
      const { offeredItemId, requestedListingId } = schema.parse(req.body);
      const myItem = await storage.getInventoryItem(offeredItemId);
      const listing = await storage.getListing(requestedListingId);
      if (!myItem || !listing) {
        return res.status(404).json({ message: "Item or listing not found" });
      }
      const offeredSnap = {
        franchise: myItem.franchise,
        category: myItem.category,
        setName: myItem.setName,
        name: myItem.name,
        rarity: myItem.rarity,
        condition: myItem.condition,
      };
      const requestedSnap = listing.itemSnapshot
        ? JSON.parse(listing.itemSnapshot)
        : null;
      const trade = await storage.createTrade({
        offeredItemId,
        offeredSnapshot: JSON.stringify(offeredSnap),
        requestedListingId,
        requestedSnapshot: requestedSnap ? JSON.stringify(requestedSnap) : null,
        status: "Pending",
        direction: "Outgoing",
        counterparty: listing.sellerName,
      });
      broadcast({ type: "trades:update", payload: trade });
      res.status(201).json(trade);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/trades/:id/accept", async (req, res) => {
    const id = Number(req.params.id);
    const trade = await storage.getTrade(id);
    if (!trade) return res.status(404).json({ message: "Not found" });
    // For incoming: we accept — we lose nothing (snapshot trade), add requested to inventory
    // For outgoing (shouldn't normally happen, but just in case): same effect
    if (trade.direction === "Incoming" && trade.offeredSnapshot) {
      const snap = JSON.parse(trade.offeredSnapshot);
      const prefixMap: Record<string, string> = {
        Pokémon: "PK",
        "One Piece": "OP",
        "Magic The Gathering": "MTG",
        DBZ: "DBZ",
        "League of Legends": "LOL",
        "Union Arena": "UA",
      };
      const prefix = prefixMap[snap.franchise] ?? "X";
      const existing = await storage.listInventory();
      const maxNum = existing
        .filter((i) => i.id.startsWith(prefix + "-"))
        .map((i) => parseInt(i.id.split("-")[1] || "0", 10))
        .filter((n) => !isNaN(n))
        .reduce((a, b) => Math.max(a, b), 0);
      const newId = `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
      await storage.createInventory({
        id: newId,
        franchise: snap.franchise,
        category: snap.category,
        setName: snap.setName,
        name: snap.name,
        rarity: snap.rarity ?? null,
        condition: snap.condition ?? "NM",
        qty: 1,
        source: trade.counterparty ?? "Trade",
        costPerUnit: 0,
        totalCost: 0,
        marketValue: null,
        asking: null,
        soldPrice: null,
        status: "In Inventory",
        notes: `Acquired via trade with ${trade.counterparty}`,
      });
      // If there was a requested item from our side, mark it as Traded
      if (trade.requestedSnapshot) {
        // no-op — requested here was what they wanted from us. Find by snapshot is fuzzy; skip.
      }
      await storage.createTransaction({
        type: "Trade",
        itemId: newId,
        itemName: `${snap.setName} — ${snap.name}`,
        counterparty: trade.counterparty,
        price: null,
        pnl: null,
        notes: "Accepted incoming trade",
      });
    }
    const updated = await storage.updateTrade(id, { status: "Accepted" });
    broadcast({ type: "trades:update", payload: updated });
    broadcast({ type: "inventory:bulk", payload: {} });
    broadcast({ type: "transactions:update", payload: {} });
    res.json(updated);
  });

  app.post("/api/trades/:id/decline", async (req, res) => {
    const id = Number(req.params.id);
    const updated = await storage.updateTrade(id, { status: "Declined" });
    broadcast({ type: "trades:update", payload: updated });
    res.json(updated);
  });

  // ===== PUBLIC SHOP =====
  // Public listings feed — only returns YOUR listings (sellerName null)
  // with asking price > 0. Strips out admin-only fields (cost, P/L).
  app.get("/api/shop/listings", async (_req, res) => {
    try {
      const inv = await storage.listInventory();
      // Everything currently in stock is shoppable. We treat any item with
      // qty > 0 and status in {In Inventory, Listed} as a live listing.
      // Price priority: asking → marketValue. Items with neither are skipped.
      const SHOPPABLE_STATUSES = new Set(["In Inventory", "Listed"]);
      const filtered = inv
        .filter((i) => {
          if (!SHOPPABLE_STATUSES.has(i.status)) return false;
          if ((i.qty ?? 0) <= 0) return false;
          const price =
            (typeof i.asking === "number" && i.asking > 0 ? i.asking : null) ??
            (typeof i.marketValue === "number" && i.marketValue > 0 ? i.marketValue : null);
          return price !== null;
        })
        .map((i) => {
          const price =
            (typeof i.asking === "number" && i.asking > 0 ? i.asking : null) ??
            (typeof i.marketValue === "number" && i.marketValue > 0 ? i.marketValue : 0);
          return {
            id: i.id,
            name: i.name,
            setName: i.setName,
            rarity: i.rarity,
            condition: i.condition,
            category: i.category,
            franchise: i.franchise,
            qty: i.qty,
            askingPrice: price,
            marketValue: i.marketValue,
            imageUrl: i.imageUrl,
            notes: i.notes,
          };
        });
      res.json(filtered);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Shop load failed" });
    }
  });

  // Customer upload (for trade photos) — base64 in, URL out
  app.post("/api/shop/upload", async (req, res) => {
    try {
      const schema = z.object({
        imageBase64: z.string().min(10),
        mediaType: z.string().optional(),
      });
      const { imageBase64, mediaType } = schema.parse(req.body);
      const clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(clean, "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "Image exceeds 5 MB" });
      }
      const ext =
        mediaType && mediaType.includes("png")
          ? "png"
          : mediaType && mediaType.includes("webp")
            ? "webp"
            : "jpg";
      const filename = `${randomUUID()}.${ext}`;
      const fullPath = path.join(CUSTOMER_UPLOADS_DIR, filename);
      fs.writeFileSync(fullPath, buffer);
      res.json({ url: `/uploads/customer/${filename}` });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Upload failed" });
    }
  });

  // Submit a Buy request
  app.post("/api/shop/buy", async (req, res) => {
    try {
      const parsed = insertCustomerRequestSchema.parse({
        ...req.body,
        type: "Buy",
      });
      const request = await storage.createCustomerRequest(parsed);
      broadcast({ type: "customerRequest:new", payload: request });
      res.status(201).json({ ok: true, requestId: request.id });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Buy request failed" });
    }
  });

  // Submit a Trade request
  app.post("/api/shop/trade", async (req, res) => {
    try {
      const parsed = insertCustomerRequestSchema.parse({
        ...req.body,
        type: "Trade",
      });
      const request = await storage.createCustomerRequest(parsed);
      broadcast({ type: "customerRequest:new", payload: request });
      res.status(201).json({ ok: true, requestId: request.id });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Trade request failed" });
    }
  });

  // ===== ADMIN: CUSTOMER REQUESTS =====
  app.get("/api/requests", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const rows = await storage.listCustomerRequests(
        status && status !== "All" ? status : undefined
      );
      // Attach item thumbnails for convenience
      const inv = await storage.listInventory();
      const invMap = new Map(inv.map((i) => [i.id, i] as const));
      const enriched = rows.map((r) => ({
        ...r,
        item: r.itemId ? invMap.get(r.itemId) ?? null : null,
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Requests load failed" });
    }
  });

  app.patch("/api/requests/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const schema = z.object({
        status: z.enum(["New", "Accepted", "Declined", "Completed"]).optional(),
        adminNote: z.string().optional().nullable(),
      });
      const patch = schema.parse(req.body);
      const updated = await storage.updateCustomerRequest(id, patch as any);
      if (updated) broadcast({ type: "customerRequest:update", payload: updated });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Update failed" });
    }
  });

  // Accept a Buy request — optionally mark item Sold and create Sell transaction
  app.post("/api/requests/:id/accept-buy", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const schema = z.object({
        markSold: z.boolean().default(true),
        adminNote: z.string().optional().nullable(),
      });
      const { markSold, adminNote } = schema.parse(req.body);
      const request = await storage.getCustomerRequest(id);
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.type !== "Buy") {
        return res.status(400).json({ message: "Not a Buy request" });
      }
      const updated = await storage.updateCustomerRequest(id, {
        status: "Accepted",
        adminNote: adminNote ?? null,
      } as any);
      if (markSold && request.itemId) {
        const item = await storage.getInventoryItem(request.itemId);
        if (item) {
          const soldPrice = request.offerPrice ?? item.asking ?? 0;
          const updInv = await storage.updateInventory(item.id, {
            status: "Sold",
            soldPrice,
          });
          const pnl = (soldPrice ?? 0) - (item.totalCost ?? 0);
          await storage.createTransaction({
            type: "Sell",
            itemId: item.id,
            itemName: `${item.setName} — ${item.name}`,
            counterparty: request.customerName,
            price: soldPrice,
            pnl,
            notes: `Shop request #${id}`,
          });
          // Deactivate any active listings for this item
          const allListings = await storage.listListings();
          for (const l of allListings.filter(
            (x) => x.itemId === item.id && !x.sellerName
          )) {
            await storage.deactivateListing(l.id);
          }
          if (updInv) broadcast({ type: "inventory:update", payload: updInv });
          broadcast({ type: "transactions:update", payload: {} });
          broadcast({ type: "listings:update", payload: {} });
        }
      }
      if (updated) broadcast({ type: "customerRequest:update", payload: updated });
      res.json({ ok: true, request: updated });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Accept failed" });
    }
  });

  return httpServer;
}
