import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
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
  // TCGplayer price points (filled by /api/pricing/refresh)
  tcgpProductId: integer("tcgp_product_id"),
  tcgpMarketPrice: real("tcgp_market_price"),
  tcgpMostRecentSale: real("tcgp_most_recent_sale"),
  tcgpListedMedian: real("tcgp_listed_median"),
  tcgpCurrentQty: integer("tcgp_current_qty"),
  tcgpCurrentSellers: integer("tcgp_current_sellers"),
  tcgpVolatility: text("tcgp_volatility"), // "LOW" | "MED" | "HIGH"
  tcgpLowSale3mo: real("tcgp_low_sale_3mo"),
  tcgpHighSale3mo: real("tcgp_high_sale_3mo"),
  tcgpTotalSold3mo: integer("tcgp_total_sold_3mo"),
  tcgpAvgDailySold: real("tcgp_avg_daily_sold"),
  tcgpHistoryJson: text("tcgp_history_json"), // JSON array of {date,marketPrice,low,high,qty}
  tcgpPricedAt: integer("tcgp_priced_at"), // unix seconds of last price refresh
  // "manual" pins marketValue (set when edited by hand in admin); "tcgp" means
  // the value is tracking the live TCGplayer market price; "alt" = graded
  // value from Alt; "ai" = graded AI estimate. Null = not pinned.
  marketValueSource: text("market_value_source"),
  // Graded slabs: Alt (alt.xyz) per-grade value via ReefAPI. altGrade is the
  // grade the value was pulled for ("PSA 10", "CGC Pristine").
  altCardId: text("alt_card_id"),
  altGrade: text("alt_grade"),
  altName: text("alt_name"),
  altUrl: text("alt_url"),
  altValue: real("alt_value"),
  altValueLow: real("alt_value_low"),
  altValueHigh: real("alt_value_high"),
  altPop: integer("alt_pop"),
  altLastSalePrice: real("alt_last_sale_price"),
  altLastSaleDate: text("alt_last_sale_date"),
  altPricedAt: integer("alt_priced_at"),
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

// Customer requests — inbound Buy/Trade requests from the public shop page
export const customerRequests = sqliteTable("customer_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'Buy' | 'Trade'
  itemId: text("item_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  customerHandle: text("customer_handle"), // Instagram/TikTok handle for trade requests
  preferredContact: text("preferred_contact").notNull(),
  quantity: integer("quantity").notNull().default(1),
  offerPrice: real("offer_price"),
  offerDescription: text("offer_description"),
  offerImageUrls: text("offer_image_urls"), // JSON array string
  message: text("message"),
  paymentMethod: text("payment_method"), // customer's preferred way to pay (Buy requests)
  adminNote: text("admin_note"),
  status: text("status").notNull().default("New"), // New | Accepted | Declined | Completed
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertCustomerRequestSchema = createInsertSchema(customerRequests).omit({
  id: true,
  createdAt: true,
  status: true,
  adminNote: true,
});
export type InsertCustomerRequest = z.infer<typeof insertCustomerRequestSchema>;
export type CustomerRequest = typeof customerRequests.$inferSelect;

// ── Shipments: one per paid online order (or created by hand) ────
export const shipments = sqliteTable("shipments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderRef: text("order_ref"), // Stripe session id or free text (e.g. "Zelle 11/12")
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  items: text("items").notNull(), // JSON [{itemId,name,setName,quantity,category,unitPrice}]
  ounces: real("ounces").notNull(),
  service: text("service").notNull().default("USPS Ground Advantage"),
  zone: integer("zone"),
  postageEstimate: real("postage_estimate"),
  shippingCharged: real("shipping_charged"),
  orderTotal: real("order_total"),
  status: text("status").notNull().default("To ship"), // To ship | Shipped | Cancelled
  tracking: text("tracking"),
  note: text("note"),
  shippedAt: integer("shipped_at"),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type Shipment = typeof shipments.$inferSelect;
export type InsertShipment = typeof shipments.$inferInsert;
export type ShipmentItem = { itemId: string | null; name: string; setName: string | null; quantity: number; category: string; unitPrice: number | null };

// ── Auth: users + sessions ───────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"), // 'owner' | 'it' (legacy rows: 'admin' = owner)
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});
export type AppSetting = typeof appSettings.$inferSelect;

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // random hex token
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(), // unix seconds
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, passwordHash: true, createdAt: true, role: true })
  .extend({
    username: z.string().trim().min(2, "Username too short").max(32),
    email: z.string().trim().email("Enter a valid email"),
    password: z.string().min(8, "At least 8 characters"),
  });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PublicUser = Omit<User, "passwordHash">;
export type Session = typeof sessions.$inferSelect;
