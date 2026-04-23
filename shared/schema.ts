import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Inventory items — primary key is the human-readable SKU (e.g. "PK-001")
export const inventory = sqliteTable("inventory", {
  id: text("id").primaryKey(), // SKU like "PK-001"
  franchise: text("franchise").notNull(),
  category: text("category").notNull(), // Sealed | Raw | Slab
  setName: text("set_name").notNull(),
  name: text("name").notNull(),
  rarity: text("rarity"),
  condition: text("condition"),
  qty: integer("qty").notNull().default(1),
  source: text("source"),
  costPerUnit: real("cost_per_unit"),
  totalCost: real("total_cost"),
  marketValue: real("market_value"),
  asking: real("asking"),
  soldPrice: real("sold_price"),
  status: text("status").notNull().default("In Inventory"), // In Inventory | Sold | Listed | Traded
  notes: text("notes"),
  imageUrl: text("image_url"),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Math.floor(Date.now() / 1000)),
});

// Price history — one row per market value update
export const priceHistory = sqliteTable("price_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: text("item_id").notNull(),
  price: real("price").notNull(),
  source: text("source").notNull(), // Scryfall | TCGdex | AI est | Manual | Seed
  recordedAt: integer("recorded_at")
    .notNull()
    .$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertPriceHistorySchema = createInsertSchema(priceHistory).omit({
  id: true,
  recordedAt: true,
});
export type InsertPriceHistory = z.infer<typeof insertPriceHistorySchema>;
export type PriceHistory = typeof priceHistory.$inferSelect;

export const insertInventorySchema = createInsertSchema(inventory).omit({
  createdAt: true,
});
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventory.$inferSelect;

// Transactions ledger
export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // Buy | Sell | Trade
  itemId: text("item_id"), // references inventory.id, nullable
  itemName: text("item_name"), // cached label for display
  counterparty: text("counterparty"),
  price: real("price"),
  pnl: real("pnl"), // realized profit/loss
  date: integer("date")
    .notNull()
    .$defaultFn(() => Math.floor(Date.now() / 1000)),
  notes: text("notes"),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  date: true,
});
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Listings — user's own listings (sellerName null) and mock marketplace listings (sellerName set)
export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: text("item_id"), // nullable for external mock listings
  askingPrice: real("asking_price").notNull(),
  listedAt: integer("listed_at")
    .notNull()
    .$defaultFn(() => Math.floor(Date.now() / 1000)),
  sellerName: text("seller_name"), // null = user's listing
  itemSnapshot: text("item_snapshot"), // JSON: { franchise, category, setName, name, rarity, condition }
  active: integer("active").notNull().default(1), // 0 = removed/sold
});

export const insertListingSchema = createInsertSchema(listings).omit({
  id: true,
  listedAt: true,
});
export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listings.$inferSelect;

// Trades
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  offeredItemId: text("offered_item_id"), // id in inventory (could be theirs for incoming)
  offeredSnapshot: text("offered_snapshot"), // JSON for display
  requestedListingId: integer("requested_listing_id"),
  requestedSnapshot: text("requested_snapshot"), // JSON for display
  status: text("status").notNull().default("Pending"), // Pending | Accepted | Declined
  direction: text("direction").notNull(), // Outgoing | Incoming
  counterparty: text("counterparty"),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertTradeSchema = createInsertSchema(trades).omit({
  id: true,
  createdAt: true,
});
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;
