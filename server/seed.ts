import fs from "node:fs";
import path from "node:path";
import { db, storage } from "./storage";
import { inventory, listings, trades } from "@shared/schema";
import { hashPassword } from "./auth";

type SeedItem = {
  id: string;
  franchise: string;
  category: string;
  set: string;
  name: string;
  rarity: string | null;
  condition: string | null;
  qty: number;
  source: string | null;
  costPerUnit: number | null;
  totalCost: number | null;
  marketValue: number | null;
  asking: number | null;
  soldPrice: number | null;
  status: string;
  notes: string | null;
};

function loadSeedJson(): SeedItem[] {
  // In dev, file lives at server/seed-data-inventory.json relative to project root.
  // In production (bundled), use cwd fallback.
  const candidates = [
    path.resolve(process.cwd(), "server/seed-data-inventory.json"),
    path.resolve(process.cwd(), "seed-data-inventory.json"),
    path.resolve(process.cwd(), "dist/seed-data-inventory.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  }
  throw new Error("seed-data-inventory.json not found");
}

const MOCK_LISTINGS = [
  {
    sellerName: "KantoCollector",
    item: {
      franchise: "Pokémon",
      category: "Sealed",
      setName: "Prismatic Evolutions",
      name: "Elite Trainer Box",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 320,
  },
  {
    sellerName: "PikaTrades",
    item: {
      franchise: "Pokémon",
      category: "Slab",
      setName: "Base Set",
      name: "Charizard Holo PSA 8",
      rarity: "Holo Rare",
      condition: "PSA 8",
    },
    askingPrice: 1850,
  },
  {
    sellerName: "GrasstypeCo",
    item: {
      franchise: "Pokémon",
      category: "Raw",
      setName: "Evolving Skies",
      name: "Umbreon VMAX Alt Art",
      rarity: "Alt Art",
      condition: "NM",
    },
    askingPrice: 680,
  },
  {
    sellerName: "SilphCards",
    item: {
      franchise: "Pokémon",
      category: "Sealed",
      setName: "Twilight Masquerade",
      name: "Booster Bundle",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 42,
  },
  {
    sellerName: "OPKing",
    item: {
      franchise: "One Piece",
      category: "Sealed",
      setName: "OP-07 500 Years Future",
      name: "Booster Box",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 165,
  },
  {
    sellerName: "StrawHat_Shop",
    item: {
      franchise: "One Piece",
      category: "Raw",
      setName: "OP-01",
      name: "Monkey D. Luffy Leader Alt Art",
      rarity: "Super Rare",
      condition: "NM",
    },
    askingPrice: 210,
  },
  {
    sellerName: "WanoMarket",
    item: {
      franchise: "One Piece",
      category: "Slab",
      setName: "OP-02",
      name: "Yamato Leader CGC 9.5",
      rarity: "Leader",
      condition: "CGC 9.5",
    },
    askingPrice: 275,
  },
  {
    sellerName: "PlaneswalkerLLC",
    item: {
      franchise: "Magic The Gathering",
      category: "Sealed",
      setName: "Lord of the Rings",
      name: "Collector Booster Box",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 440,
  },
  {
    sellerName: "ManaVault",
    item: {
      franchise: "Magic The Gathering",
      category: "Raw",
      setName: "Modern Horizons 3",
      name: "Ugin, Eye of the Storms (Serialized)",
      rarity: "Mythic",
      condition: "NM",
    },
    askingPrice: 720,
  },
  {
    sellerName: "BlackLotusInc",
    item: {
      franchise: "Magic The Gathering",
      category: "Slab",
      setName: "Alpha",
      name: "Mox Sapphire BGS 7",
      rarity: "Power Nine",
      condition: "BGS 7",
    },
    askingPrice: 9200,
  },
  {
    sellerName: "CapsuleCorp",
    item: {
      franchise: "DBZ",
      category: "Sealed",
      setName: "Fusion World FB-01",
      name: "Booster Box",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 95,
  },
  {
    sellerName: "SaiyanCards",
    item: {
      franchise: "DBZ",
      category: "Raw",
      setName: "Fusion World FB-02",
      name: "SSJ4 Gogeta SCR",
      rarity: "Secret Rare",
      condition: "NM",
    },
    askingPrice: 140,
  },
  {
    sellerName: "RiftRunner",
    item: {
      franchise: "League of Legends",
      category: "Sealed",
      setName: "Worlds 2024",
      name: "Champion Display",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 80,
  },
  {
    sellerName: "HextechTrader",
    item: {
      franchise: "League of Legends",
      category: "Raw",
      setName: "Set 01",
      name: "Jinx Alt Art",
      rarity: "Legendary",
      condition: "NM",
    },
    askingPrice: 55,
  },
  {
    sellerName: "ArenaVendor",
    item: {
      franchise: "Union Arena",
      category: "Sealed",
      setName: "Jujutsu Kaisen",
      name: "Booster Box",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 60,
  },
  {
    sellerName: "ArenaVendor",
    item: {
      franchise: "Union Arena",
      category: "Raw",
      setName: "Demon Slayer",
      name: "Nezuko Kamado SR",
      rarity: "Super Rare",
      condition: "NM",
    },
    askingPrice: 38,
  },
  {
    sellerName: "HoennHoarder",
    item: {
      franchise: "Pokémon",
      category: "Sealed",
      setName: "Paldean Fates",
      name: "Booster Bundle",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 70,
  },
  {
    sellerName: "PaldeaProShop",
    item: {
      franchise: "Pokémon",
      category: "Raw",
      setName: "Scarlet & Violet 151",
      name: "Zapdos Ex Full Art",
      rarity: "Ultra Rare",
      condition: "NM",
    },
    askingPrice: 48,
  },
  {
    sellerName: "GalaxyCards",
    item: {
      franchise: "Magic The Gathering",
      category: "Sealed",
      setName: "Wilds of Eldraine",
      name: "Play Booster Box",
      rarity: null,
      condition: "NM",
    },
    askingPrice: 110,
  },
  {
    sellerName: "JohtoJewels",
    item: {
      franchise: "Pokémon",
      category: "Slab",
      setName: "Neo Genesis",
      name: "Lugia 1st Edition PSA 7",
      rarity: "Holo Rare",
      condition: "PSA 7",
    },
    askingPrice: 2400,
  },
];

const MOCK_INCOMING_TRADES = [
  {
    counterparty: "TrainerRed",
    // They offer something, they want one of the user's sealed ETBs
    offeredSnapshot: {
      franchise: "Pokémon",
      category: "Slab",
      setName: "Evolving Skies",
      name: "Umbreon VMAX Alt Art PSA 9",
      condition: "PSA 9",
    },
    // We'll set requestedListingId to 0 and store a snapshot of what they want
    requestedSnapshotOverride: {
      franchise: "Pokémon",
      category: "Sealed",
      setName: "Surging Sparks",
      name: "ETB",
      condition: "NM",
    },
  },
  {
    counterparty: "DragonRider88",
    offeredSnapshot: {
      franchise: "DBZ",
      category: "Slab",
      setName: "Fusion World FB-01",
      name: "Broly SCR CGC 9.5",
      condition: "CGC 9.5",
    },
    requestedSnapshotOverride: {
      franchise: "Magic The Gathering",
      category: "Sealed",
      setName: "Modern Horizons 3",
      name: "Collector Booster Box",
      condition: "NM",
    },
  },
  {
    counterparty: "OnePieceOracle",
    offeredSnapshot: {
      franchise: "One Piece",
      category: "Raw",
      setName: "OP-05",
      name: "Trafalgar Law Leader Alt Art",
      condition: "NM",
    },
    requestedSnapshotOverride: {
      franchise: "One Piece",
      category: "Sealed",
      setName: "OP-04",
      name: "Booster Box",
      condition: "NM",
    },
  },
];

export async function runSeed() {
  // Inventory
  const invRows = await db.select().from(inventory).all();
  if (invRows.length === 0) {
    const data = loadSeedJson();
    const now = Math.floor(Date.now() / 1000);
    const rows = data.map((d) => ({
      id: d.id,
      franchise: d.franchise,
      category: d.category,
      setName: d.set ?? "—",
      name: d.name ?? "(untitled)",
      rarity: d.rarity,
      condition: d.condition,
      qty: d.qty ?? 1,
      source: d.source,
      costPerUnit: d.costPerUnit,
      totalCost: d.totalCost,
      marketValue: d.marketValue,
      asking: d.asking,
      soldPrice: d.soldPrice,
      status: d.status ?? "In Inventory",
      notes: d.notes,
      createdAt: now,
    }));
    // Batch insert (libsql is async)
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      await db.insert(inventory).values(rows.slice(i, i + batchSize));
    }
    console.log(`[seed] inserted ${rows.length} inventory items`);
  }

  // Mock marketplace listings
  const listingRows = await db.select().from(listings).all();
  if (listingRows.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < MOCK_LISTINGS.length; i++) {
      const l = MOCK_LISTINGS[i];
      const daysAgo = Math.floor(Math.random() * 18) + 1;
      await db.insert(listings).values({
        itemId: null,
        askingPrice: l.askingPrice,
        listedAt: now - daysAgo * 86400,
        sellerName: l.sellerName,
        itemSnapshot: JSON.stringify(l.item),
        active: 1,
      });
    }
    console.log(`[seed] inserted ${MOCK_LISTINGS.length} mock listings`);
  }

  // Seed / reset admin from environment variables.
  //
  //  - ADMIN_INITIAL_USERNAME + ADMIN_INITIAL_PASSWORD: creates the first admin
  //    on a fresh DB. No-op once any user exists.
  //  - ADMIN_RESET=true together with the two vars above: forcefully resets the
  //    matching account's password (or creates it if missing). Use this to recover
  //    from a forgotten password — set the three vars in Render, redeploy, log in,
  //    then DELETE ADMIN_RESET (and rotate the password) so it can't run again.
  try {
    const userCount = await storage.countUsers();
    const seedUsername = (process.env.ADMIN_INITIAL_USERNAME ?? "").trim();
    const seedPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "";
    const resetFlag = (process.env.ADMIN_RESET ?? "").trim().toLowerCase() === "true";

    if (seedUsername && seedPassword) {
      const email = `${seedUsername}@cpulls.cards`.toLowerCase();
      const passwordHash = await hashPassword(seedPassword);

      if (userCount === 0) {
        await storage.createUser({
          username: seedUsername,
          email,
          passwordHash,
          role: "owner",
        });
        console.log(`[seed] created initial Owner login: ${seedUsername}`);
      } else if (resetFlag) {
        const existing =
          (await storage.getUserByUsernameOrEmail(seedUsername)) ??
          (await storage.getUserByUsernameOrEmail(email));
        if (existing) {
          await storage.updateUserPassword(existing.id, passwordHash);
          console.log(`[seed] ADMIN_RESET: password reset for user ${existing.username}`);
        } else {
          await storage.createUser({
            username: seedUsername,
            email,
            passwordHash,
          });
          console.log(`[seed] ADMIN_RESET: created admin user: ${seedUsername}`);
        }
      }
    }
  } catch (err) {
    console.error("[seed] initial-admin seed failed:", err);
  }

  // Optional IT login from IT_INITIAL_USERNAME + IT_INITIAL_PASSWORD. Created
  // once if that username doesn't exist yet; never resets an existing account.
  try {
    const itUser = (process.env.IT_INITIAL_USERNAME ?? "").trim();
    const itPass = process.env.IT_INITIAL_PASSWORD ?? "";
    if (itUser && itPass) {
      const email = `${itUser}@cpulls.cards`.toLowerCase();
      const existing = (await storage.getUserByUsernameOrEmail(itUser)) ?? (await storage.getUserByUsernameOrEmail(email));
      if (!existing) {
        await storage.createUser({ username: itUser, email, passwordHash: await hashPassword(itPass), role: "it" });
        console.log(`[seed] created initial IT login: ${itUser}`);
      }
    }
  } catch (err) {
    console.error("[seed] initial IT seed failed:", err);
  }

  // Mock incoming trades
  const tradeRows = await db.select().from(trades).all();
  if (tradeRows.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < MOCK_INCOMING_TRADES.length; i++) {
      const t = MOCK_INCOMING_TRADES[i];
      await db.insert(trades).values({
        offeredItemId: null,
        offeredSnapshot: JSON.stringify(t.offeredSnapshot),
        requestedListingId: null,
        requestedSnapshot: JSON.stringify(t.requestedSnapshotOverride),
        status: "Pending",
        direction: "Incoming",
        counterparty: t.counterparty,
        createdAt: now - (i + 1) * 3600,
      });
    }
    console.log(`[seed] inserted ${MOCK_INCOMING_TRADES.length} mock trades`);
  }

  // Seed default live-stream settings only if no values are set yet
  if (!(await storage.getSetting("live_handle"))) {
    await storage.setSetting("live_platform", "tiktok");
    await storage.setSetting("live_handle", "cpulls.cards");
    await storage.setSetting("live_url", "https://www.tiktok.com/@cpulls.cards/live");
    await storage.setSetting("live_title", "Live pulls \u2014 come hang out");
    await storage.setSetting("live_isLive", "false");
    console.log("[seed] seeded default live-stream settings");
  }
}
