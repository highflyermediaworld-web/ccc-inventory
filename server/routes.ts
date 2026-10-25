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
import { normalizeRole, roleLabel, isOwner } from "@shared/roles";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { registerScanRoutes, identifyCardFromImage } from "./scan";
import {
  getAutoImportStatus,
  runAutoImport,
  setAutoImportConfig,
} from "./autoImport";
import {
  refreshItem,
  refreshAll,
  persistRefreshResult,
  fetchImageOnly,
  fetchMissingImagesBatch,
  findTcgplayerProductId,
  fetchTcgplayerPricePoints,
  pricePointsToPatch,
  debugTcgplayerCalls,
  correctSpelling,
  correctSetName,
  isGraded,
  getGradedEstimate,
  searchTcgplayerProducts,
  fetchTcgplayerPrintings,
  tcgplayerProductLineFor,
  tcgplayerImageUrl,
  refreshItemPricePoints,
  refreshManyPricePoints,
} from "./pricing";
import {
  getAutoPricingStatus,
  triggerAutoPricingNow,
} from "./autoPricing";
import { broadcast } from "./realtime";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { aiHealth } from "./ai";
import { registerStorefrontRoutes } from "./storefront";
import {
  requireAuth,
  requireOwner,
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

  // ===== Storefront content (About page editor) + shop assistant =====
  registerStorefrontRoutes(app, UPLOADS_DIR);

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

  // ── Login ──
  // Accounts live in the users table (seeded from ADMIN_INITIAL_* / IT_INITIAL_*
  // on first boot, managed afterwards in Admin → Team & logins). An optional
  // ADMIN_USERNAME + ADMIN_PASSWORD pair in the environment acts as a break-glass
  // Owner login; there is deliberately no built-in default.
  const ENV_ADMIN_USERNAME = (process.env.ADMIN_USERNAME ?? "").trim();
  const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
  const loginAttempts = new Map<string, { n: number; until: number }>();
  const LOGIN_WINDOW_MS = 10 * 60 * 1000;
  const LOGIN_MAX = 12;
  function loginThrottled(ip: string): boolean {
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || rec.until < now) { loginAttempts.set(ip, { n: 1, until: now + LOGIN_WINDOW_MS }); return false; }
    rec.n += 1;
    return rec.n > LOGIN_MAX;
  }

  app.post("/api/auth/login", async (req, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || "?";
      if (loginThrottled(ip)) return res.status(429).json({ message: "Too many attempts — wait a few minutes and try again" });
      const schema = z.object({
        identifier: z.string().trim().min(1),
        password: z.string().min(1),
        role: z.enum(["owner", "it"]).optional(), // which door was picked on the login page
      });
      const { identifier, password, role: wanted } = schema.parse(req.body);

      const matchesEnvAdmin =
        !!ENV_ADMIN_USERNAME && !!ENV_ADMIN_PASSWORD &&
        identifier.toLowerCase() === ENV_ADMIN_USERNAME.toLowerCase() &&
        password === ENV_ADMIN_PASSWORD;

      let user = matchesEnvAdmin
        ? ((await storage.getUserByUsernameOrEmail(ENV_ADMIN_USERNAME)) ??
           (await storage.getUserByUsernameOrEmail(`${ENV_ADMIN_USERNAME}@cpulls.cards`.toLowerCase())))
        : await storage.getUserByUsernameOrEmail(identifier);

      if (matchesEnvAdmin) {
        const passwordHash = await hashPassword(ENV_ADMIN_PASSWORD);
        if (!user) {
          user = await storage.createUser({ username: ENV_ADMIN_USERNAME, email: `${ENV_ADMIN_USERNAME}@cpulls.cards`.toLowerCase(), passwordHash, role: "owner" });
        } else {
          await storage.updateUserPassword(user.id, passwordHash);
        }
      } else {
        if (!user) return res.status(401).json({ message: "Invalid credentials" });
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return res.status(401).json({ message: "Invalid credentials" });
      }

      const actual = normalizeRole(user.role);
      if (wanted && wanted !== actual) {
        return res.status(403).json({
          code: "wrong_role",
          role: actual,
          message: `This is an ${roleLabel(actual)} login — switch to the ${roleLabel(actual)} tab to sign in.`,
        });
      }

      loginAttempts.delete(ip);
      const session = await storage.createSession(user.id, SESSION_TTL_SECONDS);
      res.cookie(SESSION_COOKIE, session.id, cookieOptions());
      const { passwordHash: _omit, ...pub } = user;
      res.json({ user: { ...pub, role: actual } });
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
        return { ...rest, role: normalizeRole(u.role) };
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
        role: z.enum(["owner", "it"]).default("it"),
      });
      const parsed = schema.parse(req.body);
      const me = (req as any).user;
      if (parsed.role === "owner" && !isOwner(me?.role)) {
        return res.status(403).json({ message: "Only an Owner can create Owner logins" });
      }
      const username = parsed.username;
      const email = (parsed.email ?? `${username}@cpulls.cards`).toLowerCase();

      const existsName = await storage.getUserByUsernameOrEmail(username);
      if (existsName) return res.status(409).json({ message: "Username already taken" });
      const existsEmail = await storage.getUserByUsernameOrEmail(email);
      if (existsEmail) return res.status(409).json({ message: "Email already registered" });

      const passwordHash = await hashPassword(parsed.password);
      const user = await storage.createUser({ username, email, passwordHash, role: parsed.role });
      const { passwordHash: _omit, ...pub } = user;
      res.status(201).json({ user: { ...pub, role: normalizeRole(user.role) } });
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
      const me = (req as any).user;
      if (isOwner(user.role) && !isOwner(me?.role) && me?.id !== id) {
        return res.status(403).json({ message: "Only an Owner can reset an Owner login" });
      }
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
      const target = await storage.getUserById(id);
      if (!target) return res.status(404).json({ message: "User not found" });
      if (isOwner(target.role) && !isOwner(me?.role)) {
        return res.status(403).json({ message: "Only an Owner can remove an Owner login" });
      }
      const all = await storage.listUsers();
      if (all.length <= 1) return res.status(400).json({ message: "At least one login must remain" });
      if (isOwner(target.role) && all.filter((u) => isOwner(u.role)).length <= 1) {
        return res.status(400).json({ message: "At least one Owner login must remain" });
      }
      await storage.deleteSessionsForUser(id);
      await storage.deleteUser(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Failed to delete user" });
    }
  });

  // Change a login's role. Owner only; the last Owner can't be demoted.
  app.patch("/api/admin/users/:id/role", requireAuth, requireOwner, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
      const { role } = z.object({ role: z.enum(["owner", "it"]) }).parse(req.body);
      const target = await storage.getUserById(id);
      if (!target) return res.status(404).json({ message: "User not found" });
      if (isOwner(target.role) && role !== "owner") {
        const owners = (await storage.listUsers()).filter((u) => isOwner(u.role));
        if (owners.length <= 1) return res.status(400).json({ message: "At least one Owner login must remain" });
      }
      await storage.updateUserRole(id, role);
      res.json({ ok: true, role });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: err.issues[0]?.message || "Invalid input" });
      res.status(400).json({ message: err?.message || "Failed to change role" });
    }
  });

  // ===== SHOP SETTINGS: upcoming shows =====
  // Shows are stored as JSON in app_settings ("shop_shows"). When nothing has
  // been saved yet the storefront falls back to its built-in list.
  const showSchema = z.object({
    name: z.string().trim().min(1).max(120),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD"),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    hours: z.string().trim().max(120).optional(),
    venue: z.string().trim().max(160).optional(),
    city: z.string().trim().min(1).max(80),
    host: z.string().trim().max(60).optional(),
    url: z.string().trim().max(300).optional(),
    note: z.string().trim().max(200).optional(),
  });
  app.get("/api/shop/shows", async (_req, res) => {
    try {
      const raw = await storage.getSetting("shop_shows");
      if (!raw) return res.json({ source: "default", shows: null });
      res.json({ source: "settings", shows: JSON.parse(raw) });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load shows" });
    }
  });
  app.put("/api/admin/shop/shows", requireAuth, async (req, res) => {
    try {
      const shows = z.array(showSchema).max(60).parse(req.body?.shows ?? []);
      const clean = shows.map((sh) => Object.fromEntries(Object.entries({ ...sh, host: sh.host?.replace(/^@+/, "") }).filter(([, v]) => v !== "" && v !== undefined)));
      await storage.setSetting("shop_shows", JSON.stringify(clean));
      broadcast({ type: "shows:update", payload: {} });
      res.json({ ok: true, count: clean.length });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: err.issues[0]?.message || "Invalid show" });
      res.status(400).json({ message: err?.message || "Failed to save shows" });
    }
  });
  app.delete("/api/admin/shop/shows", requireAuth, async (_req, res) => {
    try {
      await storage.setSetting("shop_shows", "");
      broadcast({ type: "shows:update", payload: {} });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Failed to reset shows" });
    }
  });

  // ===== SYSTEM HEALTH (admin) =====
  app.get("/api/system/health", requireAuth, async (_req, res) => {
    const startedAt = Date.now();
    const out: any = {
      now: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      env: process.env.NODE_ENV || "development",
      commit: (process.env.RENDER_GIT_COMMIT || "").slice(0, 7) || null,
      database: { ok: false, driver: process.env.TURSO_DATABASE_URL ? "turso" : "sqlite", users: 0, inventory: 0, requests: 0 },
      scanner: null as any,
      pricing: null as any,
      keys: {
        gemini: !!process.env.GEMINI_API_KEY,
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        inviteCode: !!(process.env.ADMIN_INVITE_CODE ?? "").trim(),
        breakGlassLogin: !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD),
      },
    };
    try {
      const [users, inv, reqs] = await Promise.all([storage.listUsers(), storage.listInventory(), storage.listCustomerRequests()]);
      out.database = { ...out.database, ok: true, users: users.length, inventory: inv.length, requests: (reqs as any[]).length, owners: users.filter((u) => isOwner(u.role)).length, it: users.filter((u) => !isOwner(u.role)).length };
    } catch (err: any) {
      out.database.error = err?.message || String(err);
    }
    try { out.scanner = await aiHealth(); } catch (err: any) { out.scanner = { ok: false, error: err?.message || String(err) }; }
    try { out.pricing = getAutoPricingStatus(); } catch (err: any) { out.pricing = { error: err?.message || String(err) }; }
    out.responseMs = Date.now() - startedAt;
    res.json(out);
  });


  // ===== AUTH GUARD =====
  // Every /api/* route is protected except the allowlist below. This runs after
  // all /api/auth/* handlers (registered above) because Express resolves them
  // in definition order — routes registered first match first.
  const PUBLIC_PREFIXES = [
    "/api/auth/",
    "/api/shop/", // public storefront: listings, buy, trade, upload, live price
    "/api/prices/", // public, rate-limited TCGplayer lookups for the sell calculator
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

  // ===== TCGplayer rich Price Points =====
  // Pull the full Price Points panel (Market, Most Recent Sale, Listed Median,
  // Current Qty/Sellers, Volatility, 3-month Low/High/Total Sold/Avg Daily,
  // plus full price history chart series) for a single inventory item.
  app.post("/api/pricing/points/:itemId", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.itemId);
      if (!item) return res.status(404).json({ message: "Item not found" });

      let productId = item.tcgpProductId ?? null;
      if (!productId) {
        productId = await findTcgplayerProductId(
          item.name,
          item.setName ?? null,
          item.franchise,
          item.category
        );
      }
      // Graded slabs: if there's no TCGplayer match (or no price points), still
      // produce a graded AI estimate so the user gets a number. We do this
      // BEFORE the early returns below.
      const handleGradedNoPoints = async () => {
        if (!isGraded(item.condition)) return null;
        const graded = await getGradedEstimate({
          name: item.name,
          set: item.setName ?? "",
          franchise: item.franchise,
          rarity: item.rarity ?? "",
          condition: item.condition ?? "",
          rawMarketPrice: null,
        });
        if (graded && graded.marketValue != null && graded.marketValue > 0) {
          await storage.updateInventory(item.id, {
            marketValue: graded.marketValue,
          } as any);
          const upd = await storage.getInventoryItem(item.id);
          if (upd) broadcast({ type: "inventory:update", payload: upd });
          return upd;
        }
        return null;
      };

      if (!productId) {
        const gradedItem = await handleGradedNoPoints();
        if (gradedItem) {
          return res.json({
            found: false,
            productId: null,
            gradedEstimate: true,
            item: gradedItem,
          });
        }
        return res.json({ found: false, productId: null });
      }

      const points = await fetchTcgplayerPricePoints(productId);
      if (!points) {
        const gradedItem = await handleGradedNoPoints();
        if (gradedItem) {
          return res.json({
            found: false,
            productId,
            gradedEstimate: true,
            item: gradedItem,
          });
        }
        return res.json({ found: false, productId });
      }

      const patch = pricePointsToPatch(points);
      // Graded slabs: TCGplayer returns the RAW price for the product, which is
      // not the slab value. Keep tcgp* columns as the raw reference and write a
      // graded AI estimate into marketValue instead. Always refresh marketValue
      // for graded items on manual refresh (overwrites stale value).
      if (isGraded(item.condition)) {
        const graded = await getGradedEstimate({
          name: item.name,
          set: item.setName ?? "",
          franchise: item.franchise,
          rarity: item.rarity ?? "",
          condition: item.condition ?? "",
          rawMarketPrice: points.marketPrice,
        });
        if (graded && graded.marketValue != null && graded.marketValue > 0) {
          (patch as any).marketValue = graded.marketValue;
        }
      } else if (points.marketPrice != null && item.marketValue == null) {
        // Ungraded: only auto-populate marketValue if it was empty.
        (patch as any).marketValue = points.marketPrice;
      }
      await storage.updateInventory(item.id, patch as any);
      const updated = await storage.getInventoryItem(item.id);
      if (updated) broadcast({ type: "inventory:update", payload: updated });
      res.json({ found: true, productId, points, item: updated });
    } catch (err: any) {
      console.error("pricing/points error:", err);
      res.status(500).json({ message: err?.message || "Price points fetch failed" });
    }
  });

  // Batched bulk refresh of price points across the whole inventory — same
  // restart-resilient pattern as the image backfill. Client loops until
  // remaining = 0.
  app.post("/api/pricing/points-batch", async (req, res) => {
    try {
      const batchSize = Math.min(
        Math.max(parseInt(String((req.query.batch as string) ?? "8"), 10) || 8, 1),
        20
      );
      const offset = Math.max(
        parseInt(String((req.query.offset as string) ?? "0"), 10) || 0,
        0
      );
      // Items eligible for a price-points refresh: must be In Inventory or Listed.
      // For bulk backfill we exclude already-priced items so the candidate window shrinks each batch.
      // (Manual single-item refresh uses /api/pricing/points/:itemId which has no exclusion.)
      const items = await storage.listInventory();
      const force = String(req.query.force ?? "").toLowerCase() === "1";
      const candidates = items.filter(
        (i) =>
          (i.status === "In Inventory" || i.status === "Listed") &&
          (force || !i.tcgpPricedAt)
      );
      const startIdx = Math.max(0, Math.min(offset, candidates.length));
      const batch = candidates.slice(startIdx, startIdx + batchSize);

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const item of batch) {
        try {
          // 8s timeout per item so one slow source can't stall the batch.
          const points = await Promise.race<any>([
            (async () => {
              let pid = item.tcgpProductId ?? null;
              if (!pid) {
                pid = await findTcgplayerProductId(
                  item.name,
                  item.setName ?? null,
                  item.franchise,
                  item.category
                );
              }
              if (!pid) return null;
              return await fetchTcgplayerPricePoints(pid);
            })(),
            new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
          ]);
          if (points) {
            const patch = pricePointsToPatch(points);
            if (isGraded(item.condition)) {
              // Graded slab: run AI graded estimate anchored on the raw price.
              // Only refresh marketValue if it's empty OR force=1 (so nightly
              // refresh doesn't churn user-entered marketValues).
              if (item.marketValue == null || force) {
                const graded = await Promise.race<any>([
                  getGradedEstimate({
                    name: item.name,
                    set: item.setName ?? "",
                    franchise: item.franchise,
                    rarity: item.rarity ?? "",
                    condition: item.condition ?? "",
                    rawMarketPrice: points.marketPrice,
                  }),
                  new Promise((resolve) => setTimeout(() => resolve(null), 12000)),
                ]);
                if (graded && graded.marketValue != null && graded.marketValue > 0) {
                  (patch as any).marketValue = graded.marketValue;
                }
              }
            } else if (points.marketPrice != null && item.marketValue == null) {
              // Ungraded: auto-populate marketValue only if previously empty.
              (patch as any).marketValue = points.marketPrice;
            }
            await storage.updateInventory(item.id, patch as any);
            updated++;
          } else if (isGraded(item.condition) && (item.marketValue == null || force)) {
            // No TCGplayer match for this graded slab — fall back to a pure AI
            // graded estimate so the item still gets a value.
            const graded = await Promise.race<any>([
              getGradedEstimate({
                name: item.name,
                set: item.setName ?? "",
                franchise: item.franchise,
                rarity: item.rarity ?? "",
                condition: item.condition ?? "",
                rawMarketPrice: null,
              }),
              new Promise((resolve) => setTimeout(() => resolve(null), 12000)),
            ]);
            if (graded && graded.marketValue != null && graded.marketValue > 0) {
              await storage.updateInventory(item.id, {
                marketValue: graded.marketValue,
              } as any);
              updated++;
            } else {
              skipped++;
            }
          } else {
            skipped++;
          }
        } catch (err) {
          console.error("[pricing] points refresh failed for", item.id, err);
          failed++;
        }
      }

      const processed = batch.length;
      // With force=0: updated items drop out of the candidate set (filter excludes
      //   those with tcgpPricedAt), so candidates shrinks each call. Only advance
      //   past skipped/failed; updated items vacate their slot naturally.
      // With force=1: candidates DOESN'T shrink (we re-price everything), so we
      //   must advance offset by processed to make forward progress; otherwise
      //   we'd loop on the same 8 items forever.
      const nextOffset = force
        ? startIdx + processed
        : startIdx + skipped + failed;
      const remaining = force
        ? Math.max(0, candidates.length - nextOffset)
        : Math.max(0, candidates.length - updated - nextOffset);
      broadcast({ type: "inventory:bulk", payload: {} });
      res.json({
        updated,
        skipped,
        failed,
        processed,
        remaining,
        total: items.length,
        nextOffset,
      });
    } catch (err: any) {
      console.error("pricing/points-batch error:", err);
      res.status(500).json({ message: err?.message || "Bulk price points failed" });
    }
  });

  // One-time pass: rewrite every existing inventory name through the spelling
  // autocorrect dictionary. Returns the list of changes. Pass ?apply=1 to
  // actually persist; otherwise it's a dry-run preview.
  app.post("/api/inventory/autocorrect-names", async (req, res) => {
    try {
      const apply = String(req.query.apply ?? "").toLowerCase() === "1";
      const items = await storage.listInventory();
      const changes: Array<{
        id: string;
        field: "name" | "setName";
        before: string;
        after: string;
      }> = [];
      for (const item of items) {
        const patch: any = {};
        if (item.name) {
          const cn = correctSpelling(item.name);
          if (cn !== item.name) {
            changes.push({ id: item.id, field: "name", before: item.name, after: cn });
            patch.name = cn;
          }
        }
        if (item.setName) {
          const cs = correctSetName(item.setName);
          if (cs && cs !== item.setName) {
            changes.push({
              id: item.id,
              field: "setName",
              before: item.setName,
              after: cs,
            });
            patch.setName = cs;
          }
        }
        if (Object.keys(patch).length > 0 && apply) {
          // Also clear the stale tcgpProductId so the next pricing refresh
          // re-matches with the corrected spelling.
          patch.tcgpProductId = null;
          await storage.updateInventory(item.id, patch);
        }
      }
      if (apply) broadcast({ type: "inventory:bulk", payload: {} });
      res.json({
        applied: apply,
        total: items.length,
        changedCount: changes.length,
        changes: changes.slice(0, 200),
      });
    } catch (err: any) {
      console.error("autocorrect-names error:", err);
      res.status(500).json({ message: err?.message || "Autocorrect failed" });
    }
  });

  // Clear all TCGplayer matches (productId + cached price points) so a fresh
  // bulk run can re-match with the current matcher. Use ?onlySuspect=1 to only
  // clear matches where the inventory marketValue differs from the matched
  // tcgpMarketPrice by more than a 5x ratio (likely a wrong-product match).
  app.post("/api/pricing/clear-matches", async (req, res) => {
    try {
      const onlySuspect = String(req.query.onlySuspect ?? "").toLowerCase() === "1";
      const items = await storage.listInventory();
      let cleared = 0;
      for (const item of items) {
        if (!item.tcgpProductId && !item.tcgpPricedAt) continue;
        if (onlySuspect) {
          const mv = Number(item.marketValue);
          const tp = Number(item.tcgpMarketPrice);
          if (!isFinite(mv) || mv <= 0 || !isFinite(tp) || tp <= 0) continue;
          const ratio = Math.max(mv, tp) / Math.min(mv, tp);
          if (ratio < 5) continue; // close enough, leave alone
        }
        await storage.updateInventory(item.id, {
          tcgpProductId: null,
          tcgpMarketPrice: null,
          tcgpMostRecentSale: null,
          tcgpListedMedian: null,
          tcgpCurrentQty: null,
          tcgpCurrentSellers: null,
          tcgpVolatility: null,
          tcgpLowSale3mo: null,
          tcgpHighSale3mo: null,
          tcgpTotalSold3mo: null,
          tcgpAvgDailySold: null,
          tcgpHistoryJson: null,
          tcgpPricedAt: null,
        } as any);
        cleared++;
      }
      res.json({ cleared, total: items.length });
    } catch (err: any) {
      console.error("clear-matches error:", err);
      res.status(500).json({ message: err?.message || "Clear failed" });
    }
  });

  // Debug-only probe: hit each TCGplayer endpoint directly and return raw statuses.
  app.get("/api/pricing/debug-tcgp/:productId", async (req, res) => {
    const pid = parseInt(req.params.productId, 10);
    if (!pid) return res.status(400).json({ error: "productId must be a positive integer" });
    try {
      const out = await debugTcgplayerCalls(pid);
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "debug failed" });
    }
  });

  app.get("/api/pricing/points-batch/status", async (_req, res) => {
    try {
      const items = await storage.listInventory();
      const candidates = items.filter(
        (i) => i.status === "In Inventory" || i.status === "Listed"
      );
      const withPoints = candidates.filter((i) => i.tcgpPricedAt).length;
      res.json({
        total: candidates.length,
        withPoints,
        remaining: candidates.length - withPoints,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Status check failed" });
    }
  });

  // In-process auto-refresh status + manual trigger. The server runs a
  // built-in 30-min loop that refreshes prices AND backfills missing photos.
  app.get("/api/pricing/auto/status", (_req, res) => {
    res.json(getAutoPricingStatus());
  });
  app.post("/api/pricing/auto/run", async (_req, res) => {
    const status = await triggerAutoPricingNow();
    res.json({ triggered: true, status });
  });

  // Fetch image for a single item (no price change)
  app.post("/api/inventory/:id/fetch-image", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ message: "Item not found" });
      const url = await fetchImageOnly(item);
      if (!url) return res.json({ imageUrl: null, found: false });
      await storage.updateInventory(item.id, { imageUrl: url } as any);
      const updated = await storage.getInventoryItem(item.id);
      if (updated) broadcast({ type: "inventory:update", payload: updated });
      res.json({ imageUrl: url, found: true });
    } catch (err: any) {
      console.error("inventory/fetch-image error:", err);
      res.status(500).json({ message: err?.message || "Image fetch failed" });
    }
  });

  // Backfill is now SYNCHRONOUS but small-batch: each POST processes one
  // chunk and returns. The client calls it repeatedly until remaining=0.
  // This survives Render restarts because progress is persisted in the DB
  // (each successful lookup is saved before the next call).
  app.post("/api/inventory/fetch-missing-images", async (req, res) => {
    try {
      const batchSize = Math.min(
        Math.max(parseInt(String((req.query.batch as string) ?? "15"), 10) || 15, 1),
        50
      );
      const offset = Math.max(
        parseInt(String((req.query.offset as string) ?? "0"), 10) || 0,
        0
      );
      const force = String(req.query.force ?? "") === "1" || offset === 0;
      const result = await fetchMissingImagesBatch(batchSize, offset, force);
      // Broadcast once per batch so the UI refreshes
      broadcast({ type: "inventory:bulk", payload: {} });
      res.json(result);
    } catch (err: any) {
      console.error("inventory/fetch-missing-images error:", err);
      res.status(500).json({ message: err?.message || "Bulk image fetch failed" });
    }
  });

  app.get("/api/inventory/fetch-missing-images/status", async (_req, res) => {
    try {
      const items = await storage.listInventory();
      const candidates = items.filter((i) => !i.imageUrl);
      const withImage = items.filter((i) => i.imageUrl).length;
      res.json({
        total: items.length,
        withImage,
        remaining: candidates.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Status check failed" });
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
      // Note: spelling autocorrect happens inside storage.createInventory.
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
      // Note: spelling autocorrect happens inside storage.updateInventory.
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
      // A hand-edited market value pins the item so the live TCGplayer sync
      // stops overwriting it. Clearing the value un-pins it.
      if (patch.marketValue !== undefined) {
        (patch as any).marketValueSource = patch.marketValue == null ? null : "manual";
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
  const isShopInStock = (i: { status: string; qty: number | null }) =>
    (i.status === "In Inventory" || i.status === "Listed") && (i.qty ?? 0) > 0;

  // Reject buy/trade requests for items that are no longer available.
  async function assertShopItemAvailable(itemId: unknown): Promise<string | null> {
    if (typeof itemId !== "string" || !itemId) return null; // schema validation handles shape
    const item = await storage.getInventoryItem(itemId);
    if (!item) return "That item is no longer listed.";
    if (!isShopInStock(item)) return "Sorry, that item is out of stock.";
    return null;
  }

  app.get("/api/shop/listings", async (_req, res) => {
    try {
      const inv = await storage.listInventory();
      // Every priced item stays on the storefront. Items with qty > 0 and
      // status in {In Inventory, Listed} are buyable; anything else (qty 0,
      // Sold, Traded) is returned with inStock=false so the shop can show an
      // "Out of stock" banner instead of hiding it.
      // Price priority: asking → marketValue. Items with neither are skipped.
      const SHOP_STATUSES = new Set(["In Inventory", "Listed", "Sold", "Traded"]);
      const filtered = inv
        .filter((i) => {
          if (!SHOP_STATUSES.has(i.status)) return false;
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
            inStock: isShopInStock(i),
            sold3mo: i.tcgpTotalSold3mo ?? null,
            soldPerDay: i.tcgpAvgDailySold ?? null,
            askingPrice: price,
            marketValue: i.marketValue,
            tcgpProductId: i.tcgpProductId ?? null,
            tcgpMarketPrice: i.tcgpMarketPrice ?? null,
            tcgpPricedAt: i.tcgpPricedAt ?? null,
            imageUrl: i.imageUrl,
            notes: i.notes,
            createdAt: i.createdAt ?? null,
          };
        });
      res.json(filtered);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Shop load failed" });
    }
  });

  // ── Public, real-time TCGplayer prices ──────────────────────────────
  // Lightweight per-IP limiter so the public lookup can't be used to hammer
  // TCGplayer through our server. 40 requests per minute per IP.
  const priceHits = new Map<string, { count: number; resetAt: number }>();
  function priceRateLimited(req: Request): boolean {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const now = Date.now();
    const slot = priceHits.get(ip);
    if (!slot || slot.resetAt < now) {
      priceHits.set(ip, { count: 1, resetAt: now + 60_000 });
      if (priceHits.size > 5000) priceHits.clear();
      return false;
    }
    slot.count += 1;
    return slot.count > 40;
  }

  // Search any card/product on TCGplayer and return live market prices.
  app.get("/api/prices/search", async (req, res) => {
    if (priceRateLimited(req)) {
      return res.status(429).json({ message: "Slow down a little — try again in a minute." });
    }
    const q = String(req.query.q ?? "").slice(0, 120);
    const franchise = typeof req.query.franchise === "string" ? req.query.franchise : null;
    const line =
      typeof req.query.line === "string" && req.query.line
        ? req.query.line
        : tcgplayerProductLineFor(franchise);
    if (q.trim().length < 2) return res.json({ results: [] });
    try {
      const results = await searchTcgplayerProducts(q, line, 12);
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({ query: q, line, results, fetchedAt: Math.floor(Date.now() / 1000) });
    } catch (err: any) {
      res.status(502).json({ message: err?.message || "TCGplayer lookup failed" });
    }
  });

  // Per-printing (Normal / Holofoil / Reverse…) live price points for one product.
  app.get("/api/prices/product/:productId", async (req, res) => {
    if (priceRateLimited(req)) {
      return res.status(429).json({ message: "Slow down a little — try again in a minute." });
    }
    const productId = Math.trunc(Number(req.params.productId));
    if (!productId) return res.status(400).json({ message: "Invalid product id" });
    try {
      const printings = await fetchTcgplayerPrintings(productId);
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({
        productId,
        imageUrl: tcgplayerImageUrl(productId),
        printings,
        fetchedAt: Math.floor(Date.now() / 1000),
      });
    } catch (err: any) {
      res.status(502).json({ message: err?.message || "TCGplayer lookup failed" });
    }
  });

  // Point-of-purchase refresh: re-pull one listing's TCGplayer price if the
  // stored one is older than 10 minutes, then return the current shop price.
  app.get("/api/shop/price/:itemId", async (req, res) => {
    if (priceRateLimited(req)) {
      return res.status(429).json({ message: "Slow down a little — try again in a minute." });
    }
    try {
      const existing = await storage.getInventoryItem(String(req.params.itemId));
      if (!existing) return res.status(404).json({ message: "That item is no longer listed." });
      const { item, refreshed } = await refreshItemPricePoints(existing, 60);
      const price =
        (typeof item.asking === "number" && item.asking > 0 ? item.asking : null) ??
        (typeof item.marketValue === "number" && item.marketValue > 0 ? item.marketValue : null);
      res.json({
        id: item.id,
        inStock: isShopInStock(item),
        askingPrice: price,
        marketValue: item.marketValue ?? null,
        tcgpProductId: item.tcgpProductId ?? null,
        tcgpMarketPrice: item.tcgpMarketPrice ?? null,
        tcgpListedMedian: item.tcgpListedMedian ?? null,
        tcgpPricedAt: item.tcgpPricedAt ?? null,
        refreshed,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Price refresh failed" });
    }
  });

  // Real-time refresh for the cards currently on a shopper's screen (≤ 24).
  // Anything priced in the last 90 s is served from the DB; the rest is
  // re-pulled from TCGplayer in parallel and persisted.
  app.post("/api/shop/prices", async (req, res) => {
    if (priceRateLimited(req)) {
      return res.status(429).json({ message: "Slow down a little — try again in a minute." });
    }
    try {
      const ids = Array.isArray(req.body?.ids)
        ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length <= 40).slice(0, 24)
        : [];
      if (!ids.length) return res.json({ prices: [], fetchedAt: Math.floor(Date.now() / 1000) });
      const items = await refreshManyPricePoints(ids, 90);
      const prices = items.map((item) => ({
        id: item.id,
        inStock: isShopInStock(item),
        askingPrice:
          (typeof item.asking === "number" && item.asking > 0 ? item.asking : null) ??
          (typeof item.marketValue === "number" && item.marketValue > 0 ? item.marketValue : null),
        marketValue: item.marketValue ?? null,
        tcgpMarketPrice: item.tcgpMarketPrice ?? null,
        tcgpPricedAt: item.tcgpPricedAt ?? null,
      }));
      res.json({ prices, fetchedAt: Math.floor(Date.now() / 1000) });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Price refresh failed" });
    }
  });

  // ── Public card scan: photo → identified card → live TCGplayer matches ──
  // Stricter limiter than the text lookups (each scan is a vision call).
  const scanHits = new Map<string, { count: number; resetAt: number }>();
  function scanRateLimited(req: Request): boolean {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const now = Date.now();
    const slot = scanHits.get(ip);
    if (!slot || slot.resetAt < now) {
      scanHits.set(ip, { count: 1, resetAt: now + 60_000 });
      if (scanHits.size > 5000) scanHits.clear();
      return false;
    }
    slot.count += 1;
    return slot.count > 24;
  }
  const normNumber = (v: string | null | undefined) =>
    String(v ?? "").split("/")[0].trim().replace(/^0+(?=\d)/, "").toLowerCase();
  // "Charizard ex - 223/197 (Special Illustration Rare)" → "charizard ex";
  // "SV03: Obsidian Flames" → "obsidian flames".
  const normName = (v: string | null | undefined) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/\s+-\s+[\w/]+\s*$/, "")
      .replace(/^[a-z0-9]{2,6}:\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  app.post("/api/prices/scan", async (req, res) => {
    if (scanRateLimited(req)) {
      return res.status(429).json({ message: "Too many scans — give it a minute." });
    }
    try {
      const imageBase64 = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64 : "";
      const mediaType = typeof req.body?.mediaType === "string" ? req.body.mediaType : "image/jpeg";
      if (imageBase64.length < 100) return res.status(400).json({ message: "imageBase64 required" });
      if (imageBase64.length > 8_000_000) return res.status(413).json({ message: "Photo too large" });
      const requestedMode = req.body?.mode === "sealed" ? "sealed" : "card";

      const ident = await identifyCardFromImage(imageBase64, mediaType, requestedMode);
      const name = String(ident?.name ?? "").trim();
      const confidence = Number(ident?.confidence) || 0;
      const identified = {
        name,
        set: String(ident?.set ?? "").trim(),
        number: String(ident?.number ?? "").trim(),
        franchise: String(ident?.franchise ?? "Other"),
        confidence,
      };
      if (!name || confidence < 0.15) {
        return res.json({ identified, query: null, line: null, results: [], autoPick: null });
      }

      const line = tcgplayerProductLineFor(identified.franchise);
      const num = normNumber(identified.number);
      const identName = normName(name);
      const identSet = normName(identified.set);

      // Most specific query first; keep searching until something matches on
      // both card name and number (or we run out of phrasings). Every hit
      // found along the way stays in the pool so the customer can still pick.
      const attempts: Array<{ q: string; line: string | null }> = [];
      if (identified.set) attempts.push({ q: `${name} ${identified.set}`, line });
      if (num) attempts.push({ q: `${name} ${num}`, line });
      attempts.push({ q: name, line });
      if (line) attempts.push({ q: name, line: null });

      type Hit = Awaited<ReturnType<typeof searchTcgplayerProducts>>[number];
      const score = (h: Hit) => {
        const hName = normName(h.name);
        const hSet = normName(h.setName);
        const nameMatch = hName === identName ? 4 : hName.includes(identName) || identName.includes(hName) ? 1 : 0;
        const numMatch = num && normNumber(h.number) === num ? 2 : 0;
        const setMatch = identSet ? (hSet === identSet ? 2 : hSet.includes(identSet) || identSet.includes(hSet) ? 1 : 0) : 0;
        return nameMatch + numMatch + setMatch;
      };
      const confident = (h: Hit) => normName(h.name) === identName && (!num || normNumber(h.number) === num);

      // Fire every phrasing at once (each is ~0.4–0.7 s) and merge in priority
      // order, so matching costs one round-trip instead of up to four.
      const pool = new Map<number, Hit>();
      const settled = await Promise.all(
        attempts.map((a) => searchTcgplayerProducts(a.q, a.line, 12).catch(() => [] as Hit[])),
      );
      for (const hits of settled) {
        for (const h of hits) if (!pool.has(h.productId)) pool.set(h.productId, h);
      }
      const firstHitIdx = settled.findIndex((hits) => hits.length > 0);
      const used = firstHitIdx >= 0 ? attempts[firstHitIdx] : null;
      const results = Array.from(pool.values()).sort((a, b) => score(b) - score(a)).slice(0, 12);
      const top = results[0];
      const second = results[1];
      // Auto-select only when the best hit matches on name AND number (or is
      // the lone exact-name hit) and nothing else ties it.
      const autoPick =
        top && confident(top) && (!second || score(second) < score(top))
          ? top.productId
          : null;
      res.json({
        identified,
        query: used?.q ?? null,
        line: used?.line ?? line,
        results,
        autoPick,
        fetchedAt: Math.floor(Date.now() / 1000),
      });
    } catch (err: any) {
      console.error("prices/scan error:", err?.status, err?.message || err);
      // Vision provider problems (billing, auth, rate limits, outages) are not
      // the customer's fault — say so plainly instead of blaming the photo.
      const upstream = Number(err?.status);
      if (err?.name === "AiError" || (upstream && upstream !== 500)) {
        return res.status(503).json({ message: "Card scanner is temporarily unavailable — type the card name below instead.", code: "scanner_unavailable" });
      }
      res.status(502).json({ message: err?.message || "Scan failed" });
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
      const unavailable = await assertShopItemAvailable(parsed.itemId);
      if (unavailable) return res.status(409).json({ message: unavailable });
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
      const unavailable = await assertShopItemAvailable(parsed.itemId);
      if (unavailable) return res.status(409).json({ message: unavailable });
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

  // ── Buy / Trade Intake (admin) ────────────────────────────────
  // List open deals (incoming pending trades + new customer requests) for the
  // intake page's "attach to a deal" dropdown.
  app.get("/api/intake/open-deals", requireAuth, async (_req, res) => {
    try {
      const allTrades = await storage.listTrades();
      const allRequests = await storage.listCustomerRequests();
      const openTrades = allTrades
        .filter((t) => t.status === "Pending" && t.direction === "Incoming")
        .map((t) => ({
          kind: "trade" as const,
          id: t.id,
          label: `Trade #${t.id} \u2014 ${t.counterparty ?? "unknown"}`,
          counterparty: t.counterparty,
        }));
      const openRequests = allRequests
        .filter((r) => r.status === "New" && (r.type === "Trade" || r.type === "Buy"))
        .map((r) => ({
          kind: "request" as const,
          id: r.id,
          label: `${r.type} req #${r.id} \u2014 ${r.customerName}`,
          counterparty: r.customerName,
        }));
      res.json({ deals: [...openTrades, ...openRequests] });
    } catch (err: any) {
      console.error("intake/open-deals error:", err);
      res.status(500).json({ message: err.message || "Failed to list deals" });
    }
  });

  // Scan a card and add it directly to inventory (optionally attach a Buy txn
  // and link to an open trade/request). Returns the new inventory row.
  app.post("/api/intake/scan-add", requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        franchise: z.string().min(1),
        category: z.string().min(1), // Sealed | Raw | Slab
        setName: z.string().default(""),
        name: z.string().min(1),
        rarity: z.string().optional().default(""),
        condition: z.string().optional().default("NM"),
        qty: z.number().int().min(1).default(1),
        costPerUnit: z.number().nullable().optional(),
        marketValue: z.number().nullable().optional(),
        imageUrl: z.string().optional().nullable(),
        notes: z.string().optional(),
        // Intake-specific
        counterparty: z.string().nullable().optional(), // who you're buying/trading from
        intakeType: z.enum(["Buy", "Trade"]).default("Buy"),
        attachTo: z
          .object({ kind: z.enum(["trade", "request"]), id: z.number() })
          .nullable()
          .optional(),
      });
      const body = schema.parse(req.body);

      // Build SKU server-side using the same prefix convention as the client
      const PREFIX: Record<string, string> = {
        "Pok\u00e9mon": "PK",
        "One Piece": "OP",
        "Magic The Gathering": "MTG",
        DBZ: "DBZ",
        "League of Legends": "LOL",
        "Union Arena": "UA",
        Other: "X",
      };
      const prefix = PREFIX[body.franchise] ?? "X";
      const existing = await storage.listInventory();
      const maxN = existing
        .map((i) => i.id)
        .filter((id) => id.startsWith(prefix + "-"))
        .map((id) => parseInt(id.split("-")[1] || "0", 10))
        .filter((n) => !Number.isNaN(n))
        .reduce((a, b) => Math.max(a, b), 0);
      const sku = `${prefix}-${String(maxN + 1).padStart(3, "0")}`;

      const qty = body.qty;
      const cpu = body.costPerUnit ?? 0;
      const totalCost = Math.round(qty * cpu * 100) / 100;

      const item = await storage.createInventory({
        id: sku,
        franchise: body.franchise,
        category: body.category,
        setName: body.setName,
        name: body.name,
        rarity: body.rarity || null,
        condition: body.condition || "NM",
        qty,
        source: body.intakeType === "Trade" ? "Trade In" : "Buy In",
        costPerUnit: cpu || null,
        totalCost: totalCost || null,
        marketValue: body.marketValue ?? null,
        asking: null,
        soldPrice: null,
        status: "In Inventory",
        notes: body.notes || null,
        imageUrl: body.imageUrl || null,
      } as any);

      if (item?.marketValue != null) {
        await storage.createPriceHistory({
          itemId: item.id,
          price: Number(item.marketValue),
          source: "Manual",
        });
      }

      // Record a Buy/Trade transaction so it shows up in the ledger
      const baseNote =
        body.intakeType === "Trade"
          ? "Scanned in from a walk-up trade"
          : "Scanned in from a walk-up buy";
      const linkNote = body.attachTo
        ? ` \u00b7 ${body.attachTo.kind === "trade" ? "Trade" : "Request"} #${body.attachTo.id}`
        : "";
      await storage.createTransaction({
        type: body.intakeType === "Trade" ? "Trade" : "Buy",
        itemId: sku,
        itemName: body.name,
        counterparty: body.counterparty || null,
        price: cpu || 0,
        pnl: null,
        notes: baseNote + linkNote,
      } as any);

      // Optionally append a note to the linked trade/request.
      // Trades have no notes column — we surface the linkage on the
      // transaction notes instead (already done above when intakeType=Trade).
      if (body.attachTo) {
        try {
          if (body.attachTo.kind === "trade") {
            // No-op for now: trades schema has no notes column. We rely on the
            // matching counterparty + transaction ledger to surface the link.
            console.log(
              `intake: scanned ${sku} for trade #${body.attachTo.id}`
            );
          } else if (body.attachTo.kind === "request") {
            const r = await storage.getCustomerRequest(body.attachTo.id);
            if (r) {
              const prev = (r as any).adminNote ?? "";
              const append = `Scanned in: ${sku} \u2014 ${body.name}`;
              await storage.updateCustomerRequest(body.attachTo.id, {
                adminNote: prev ? `${prev}\n${append}` : append,
              } as any);
            }
          }
        } catch (e) {
          console.warn("intake: failed to attach to deal", e);
        }
      }

      broadcast({ type: "inventory:create", payload: item });
      res.status(201).json({ ok: true, item });
    } catch (err: any) {
      console.error("intake/scan-add error:", err);
      res.status(400).json({ message: err.message || "Intake failed" });
    }
  });

  // ── Payments (admin POS) ────────────────────────────────────────
  // Cart-style sale: takes N inventory items, marks them Sold, records one
  // Sell transaction per item with the payment method captured in notes.
  app.post("/api/payments/sell", requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        items: z
          .array(
            z.object({
              itemId: z.string().min(1),
              soldPrice: z.number(),
            })
          )
          .min(1),
        counterparty: z.string().optional().nullable(),
        paymentMethod: z
          .enum(["Cash", "Venmo", "Zelle", "CashApp", "Other"])
          .default("Cash"),
        discount: z.number().optional().default(0),
        tax: z.number().optional().default(0),
        notes: z.string().optional().nullable(),
      });
      const body = schema.parse(req.body);

      const results: any[] = [];
      let subtotal = 0;
      let totalPnl = 0;

      for (const line of body.items) {
        const item = await storage.getInventoryItem(line.itemId);
        if (!item) {
          results.push({ itemId: line.itemId, ok: false, error: "Not found" });
          continue;
        }
        if (item.status === "Sold") {
          results.push({ itemId: line.itemId, ok: false, error: "Already sold" });
          continue;
        }
        const updated = await storage.updateInventory(line.itemId, {
          status: "Sold",
          soldPrice: line.soldPrice,
        });
        const pnl = (line.soldPrice ?? 0) - (item.totalCost ?? 0);
        subtotal += line.soldPrice ?? 0;
        totalPnl += pnl;
        await storage.createTransaction({
          type: "Sell",
          itemId: item.id,
          itemName: `${item.setName} \u2014 ${item.name}`,
          counterparty: body.counterparty || null,
          price: line.soldPrice,
          pnl,
          notes: `Paid via ${body.paymentMethod}${
            body.notes ? " \u00b7 " + body.notes : ""
          }`,
        } as any);
        // Deactivate any user listings for this item
        const existing = await storage.listListings();
        for (const l of existing.filter(
          (x) => x.itemId === item.id && !x.sellerName
        )) {
          await storage.deactivateListing(l.id);
        }
        if (updated) broadcast({ type: "inventory:update", payload: updated });
        results.push({ itemId: line.itemId, ok: true, item: updated });
      }

      const total =
        Math.round((subtotal + (body.tax ?? 0) - (body.discount ?? 0)) * 100) /
        100;
      broadcast({ type: "transactions:update", payload: {} });
      broadcast({ type: "listings:update", payload: {} });
      res.json({
        ok: true,
        subtotal: Math.round(subtotal * 100) / 100,
        tax: body.tax ?? 0,
        discount: body.discount ?? 0,
        total,
        pnl: Math.round(totalPnl * 100) / 100,
        paymentMethod: body.paymentMethod,
        lines: results,
      });
    } catch (err: any) {
      console.error("payments/sell error:", err);
      res.status(400).json({ message: err?.message || "Sale failed" });
    }
  });

  // Two-sided trade commit: their items become new inventory rows (intake),
  // your items get marked Traded with a Trade transaction. Optional cash
  // boot (difference) is recorded as a separate transaction.
  app.post("/api/payments/trade", requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        // Items the customer is giving us
        theirItems: z
          .array(
            z.object({
              franchise: z.string().min(1),
              category: z.string().min(1),
              setName: z.string().default(""),
              name: z.string().min(1),
              rarity: z.string().optional().default(""),
              condition: z.string().optional().default("NM"),
              marketValue: z.number().nullable().optional(),
              imageUrl: z.string().nullable().optional(),
            })
          )
          .default([]),
        // Items we're giving them (from existing inventory)
        ourItemIds: z.array(z.string()).default([]),
        counterparty: z.string().optional().nullable(),
        cashBoot: z.number().optional().default(0), // positive = they pay us cash on top
        bootDirection: z
          .enum(["in", "out", "none"])
          .optional()
          .default("none"),
        bootMethod: z
          .enum(["Cash", "Venmo", "Zelle", "CashApp", "Other"])
          .optional()
          .default("Cash"),
        notes: z.string().optional().nullable(),
      });
      const body = schema.parse(req.body);

      // SKU helper
      const PREFIX: Record<string, string> = {
        "Pok\u00e9mon": "PK",
        "One Piece": "OP",
        "Magic The Gathering": "MTG",
        DBZ: "DBZ",
        "League of Legends": "LOL",
        "Union Arena": "UA",
        Other: "X",
      };

      const allInv = await storage.listInventory();
      function nextSku(franchise: string, existing: string[]): string {
        const prefix = PREFIX[franchise] ?? "X";
        const maxN = existing
          .filter((id) => id.startsWith(prefix + "-"))
          .map((id) => parseInt(id.split("-")[1] || "0", 10))
          .filter((n) => !Number.isNaN(n))
          .reduce((a, b) => Math.max(a, b), 0);
        return `${prefix}-${String(maxN + 1).padStart(3, "0")}`;
      }

      // Their items → create inventory rows
      const usedIds = allInv.map((i) => i.id);
      const created: any[] = [];
      let theirValue = 0;
      for (const it of body.theirItems) {
        const sku = nextSku(it.franchise, usedIds);
        usedIds.push(sku);
        const row = await storage.createInventory({
          id: sku,
          franchise: it.franchise,
          category: it.category,
          setName: it.setName,
          name: it.name,
          rarity: it.rarity || null,
          condition: it.condition || "NM",
          qty: 1,
          source: "Trade In",
          costPerUnit: it.marketValue ?? null,
          totalCost: it.marketValue ?? null,
          marketValue: it.marketValue ?? null,
          asking: null,
          soldPrice: null,
          status: "In Inventory",
          notes: `Acquired via trade with ${body.counterparty ?? "customer"}`,
          imageUrl: it.imageUrl || null,
        } as any);
        if (row?.marketValue != null) {
          await storage.createPriceHistory({
            itemId: row.id,
            price: Number(row.marketValue),
            source: "Manual",
          });
        }
        theirValue += it.marketValue ?? 0;
        await storage.createTransaction({
          type: "Trade",
          itemId: sku,
          itemName: it.name,
          counterparty: body.counterparty || null,
          price: it.marketValue ?? 0,
          pnl: null,
          notes: `Trade-in from ${body.counterparty ?? "customer"}`,
        } as any);
        if (row) broadcast({ type: "inventory:create", payload: row });
        created.push(row);
      }

      // Our items → mark Traded
      const ourLines: any[] = [];
      let ourValue = 0;
      for (const id of body.ourItemIds) {
        const item = await storage.getInventoryItem(id);
        if (!item) {
          ourLines.push({ itemId: id, ok: false, error: "Not found" });
          continue;
        }
        const updated = await storage.updateInventory(id, {
          status: "Traded",
          soldPrice: item.marketValue ?? null,
        });
        const pnl =
          (item.marketValue ?? 0) - (item.totalCost ?? 0);
        ourValue += item.marketValue ?? 0;
        await storage.createTransaction({
          type: "Trade",
          itemId: id,
          itemName: `${item.setName} \u2014 ${item.name}`,
          counterparty: body.counterparty || null,
          price: item.marketValue ?? 0,
          pnl,
          notes: `Trade-out to ${body.counterparty ?? "customer"}`,
        } as any);
        // Deactivate any user listings for this item
        const listings = await storage.listListings();
        for (const l of listings.filter(
          (x) => x.itemId === id && !x.sellerName
        )) {
          await storage.deactivateListing(l.id);
        }
        if (updated) broadcast({ type: "inventory:update", payload: updated });
        ourLines.push({ itemId: id, ok: true, item: updated });
      }

      // Cash boot — record as a separate Buy/Sell-style transaction
      if (body.bootDirection !== "none" && (body.cashBoot ?? 0) > 0) {
        await storage.createTransaction({
          type: body.bootDirection === "in" ? "Sell" : "Buy",
          itemId: null,
          itemName: "Cash boot (trade)",
          counterparty: body.counterparty || null,
          price: body.cashBoot,
          pnl: null,
          notes: `${body.bootDirection === "in" ? "Customer paid" : "Paid customer"} ${body.cashBoot} via ${body.bootMethod}${
            body.notes ? " \u00b7 " + body.notes : ""
          }`,
        } as any);
      }

      broadcast({ type: "transactions:update", payload: {} });
      broadcast({ type: "listings:update", payload: {} });

      res.json({
        ok: true,
        theirValue: Math.round(theirValue * 100) / 100,
        ourValue: Math.round(ourValue * 100) / 100,
        cashBoot: body.cashBoot ?? 0,
        bootDirection: body.bootDirection,
        created,
        ourLines,
      });
    } catch (err: any) {
      console.error("payments/trade error:", err);
      res.status(400).json({ message: err?.message || "Trade failed" });
    }
  });

  // ── Live stream banner ──────────────────────────────────────────
  // Public: customers fetch this to show the live banner on the shop
  app.get("/api/live", async (_req, res) => {
    try {
      const isLive = (await storage.getSetting("live_isLive")) === "true";
      const platform = (await storage.getSetting("live_platform")) || "tiktok";
      const handle = (await storage.getSetting("live_handle")) || "cpulls.cards";
      const url = (await storage.getSetting("live_url")) || "";
      const title = (await storage.getSetting("live_title")) || "Live pulls — come hang out";
      res.json({ isLive, platform, handle, url, title });
    } catch (err: any) {
      console.error("GET /api/live error:", err);
      res.status(500).json({ message: err?.message || "Failed to load live status" });
    }
  });

  // Admin: toggle live + set channel info
  app.post("/api/live", requireAuth, async (req, res) => {
    try {
      const { isLive, platform, handle, url, title } = req.body ?? {};
      if (typeof isLive === "boolean") {
        await storage.setSetting("live_isLive", isLive ? "true" : "false");
      }
      if (typeof platform === "string") await storage.setSetting("live_platform", platform);
      if (typeof handle === "string") await storage.setSetting("live_handle", handle);
      if (typeof url === "string") await storage.setSetting("live_url", url);
      if (typeof title === "string") await storage.setSetting("live_title", title);
      broadcast({ type: "live:update", payload: {} });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("POST /api/live error:", err);
      res.status(500).json({ message: err?.message || "Failed to save live status" });
    }
  });

  return httpServer;
}
