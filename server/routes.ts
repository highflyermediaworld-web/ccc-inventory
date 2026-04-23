import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import express from "express";
import { storage, db } from "./storage";
import {
  insertInventorySchema,
  insertListingSchema,
  insertTradeSchema,
  inventory,
  listings,
  transactions,
  trades,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { registerScanRoutes } from "./scan";
import { refreshItem, refreshAll, persistRefreshResult } from "./pricing";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ===== Uploads (scan photos) =====
  app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "30d" }));

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
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/inventory/:id", async (req, res) => {
    await storage.deleteInventory(req.params.id);
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
      await storage.updateInventory(itemId, { status: "Listed", asking: askingPrice });
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
        await storage.updateInventory(updated.itemId, { asking: askingPrice });
      }
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
      await storage.updateInventory(listing.itemId, {
        status: "In Inventory",
        asking: null,
      });
    }
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
    res.json(updated);
  });

  app.post("/api/trades/:id/decline", async (req, res) => {
    const id = Number(req.params.id);
    const updated = await storage.updateTrade(id, { status: "Declined" });
    res.json(updated);
  });

  return httpServer;
}
