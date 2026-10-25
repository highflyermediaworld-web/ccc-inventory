// Hand-picked product photos for listings that no card database or
// marketplace can resolve automatically (Target accessories, graded vintage,
// Japanese-only prints). The files ship with the client bundle under
// /catalog and are attached once, on boot, to items that still have no photo.
// The admin can replace any of them from the item editor at any time.
import { storage } from "./storage";

export const MANUAL_IMAGES: Record<string, string> = {
  // Pokémon x Target accessories
  "PK-533": "/catalog/pk-533.jpg", // Poké Ball Bag Charm
  "PK-534": "/catalog/pk-534.jpg", // Pikachu Tumbler 20oz
  "PK-537": "/catalog/pk-537.jpg", // Wet Brush Pop + Go Detangler (Pikachu)
  "PK-531": "/catalog/pk-531.jpg", // Pikachu Clips 8pc
  "PK-532": "/catalog/pk-532.jpg", // INKED by Dani Nail Art Tattoos
  "PK-535": "/catalog/pk-535.jpg", // Pikachu Wireless Headphones
  "PK-536": "/catalog/pk-536.jpg", // PopSockets Pokémon PopGrip (Eevee Flux)
  "PK-538": "/catalog/pk-538.jpg", // Caboodles Case Blue/Yellow
  // Graded / vintage
  "PK-045": "/catalog/pk-045.jpg", // 1997 Topsun Venusaur Blue Back #3
  "PK-046": "/catalog/pk-046.jpg", // 1996 Bandai Carddass Ivysaur #2 (green)
  "PK-013": "/catalog/pk-013.jpg", // 2025 S-Chinese Gem Pack Vol.3 Gengar CBB3C 03 07/07
  "PK-047": "/catalog/pk-047.jpg", // 2023 151 Bulbasaur 001/165 Best Buy stamped promo
  // Japanese-only print
  "PK-366": "/catalog/pk-366.jpg", // Medicham 207/193 Mega Dream ex (M2a)
};

const MANUAL_IMAGES_KEY = "manual_images_v1";

export async function applyManualImages(): Promise<number> {
  try {
    if (await storage.getSetting(MANUAL_IMAGES_KEY)) return 0;
    let applied = 0;
    for (const [id, url] of Object.entries(MANUAL_IMAGES)) {
      const item = await storage.getInventoryItem(id);
      if (!item || item.imageUrl) continue;
      await storage.updateInventory(id, { imageUrl: url } as any);
      applied++;
    }
    await storage.setSetting(MANUAL_IMAGES_KEY, String(Date.now()));
    if (applied) console.log(`[catalog] attached ${applied} hand-picked photo(s)`);
    return applied;
  } catch (err) {
    console.error("[catalog] manual photo pass failed", err);
    return 0;
  }
}
