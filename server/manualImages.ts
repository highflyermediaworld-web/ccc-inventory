// Hand-picked product photos for listings that no card database or
// marketplace can resolve automatically (Target accessories, graded vintage,
// Japanese-only prints). The files ship with the client bundle under
// /catalog and are attached once, on boot, to items that still have no photo.
// The admin can replace any of them from the item editor at any time.
import { storage } from "./storage";

export const MANUAL_IMAGES: Record<string, { url: string; name: RegExp }> = {
  // Pokémon x Target accessories
  "PK-533": { url: "/catalog/pk-533.jpg", name: /bag charm/i }, // Poké Ball Bag Charm
  "PK-534": { url: "/catalog/pk-534.jpg", name: /tumbler/i }, // Pikachu Tumbler 20oz
  "PK-537": { url: "/catalog/pk-537.jpg", name: /pop \\+ go/i }, // Wet Brush Pop + Go Detangler (Pikachu)
  "PK-531": { url: "/catalog/pk-531.jpg", name: /hair clips/i }, // Pikachu Clips 8pc
  "PK-532": { url: "/catalog/pk-532.jpg", name: /nail art/i }, // INKED by Dani Nail Art Tattoos
  "PK-535": { url: "/catalog/pk-535.jpg", name: /headphones/i }, // Pikachu Wireless Headphones
  "PK-536": { url: "/catalog/pk-536.jpg", name: /phone grip/i }, // PopSockets Pokémon PopGrip (Eevee Flux)
  "PK-538": { url: "/catalog/pk-538.jpg", name: /pretty in petite/i }, // Caboodles Case Blue/Yellow
  // Graded / vintage
  "PK-045": { url: "/catalog/pk-045.jpg", name: /venusaur.*blue back/i }, // 1997 Topsun Venusaur Blue Back #3
  "PK-046": { url: "/catalog/pk-046.jpg", name: /bandai.*ivysaur/i }, // 1996 Bandai Carddass Ivysaur #2 (green)
  "PK-013": { url: "/catalog/pk-013.jpg", name: /cbb3.*gengar/i }, // 2025 S-Chinese Gem Pack Vol.3 Gengar CBB3C 03 07/07
  "PK-047": { url: "/catalog/pk-047.jpg", name: /bulbasaur.*best buy/i }, // 2023 151 Bulbasaur 001/165 Best Buy stamped promo
  // Japanese-only print
  "PK-366": { url: "/catalog/pk-366.jpg", name: /medicham.*207/i }, // Medicham 207/193 Mega Dream ex (M2a)
};

const MANUAL_IMAGES_KEY = "manual_images_v1";

export async function applyManualImages(): Promise<number> {
  try {
    if (await storage.getSetting(MANUAL_IMAGES_KEY)) return 0;
    let applied = 0;
    for (const [id, { url, name }] of Object.entries(MANUAL_IMAGES)) {
      const item = await storage.getInventoryItem(id);
      // The SKU must still be the card the photo was picked for.
      if (!item || item.imageUrl || !name.test(item.name)) continue;
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
