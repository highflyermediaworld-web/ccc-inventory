// Self-contained recurring price refresh. Runs inside the server process every
// 5 minutes (AUTO_PRICING_INTERVAL_MIN; floor 5) — the storefront additionally
// re-pulls whatever is on a shopper's screen, so prices are effectively live. so the website keeps prices fresh on its own, with no external
// cron required. Mirrors the structure of autoImport.ts.
//
// Each cycle:
//   1. Pulls all inventory items that are In Inventory / Listed.
//   2. For each, ensures we have a TCGplayer productId (search/match).
//   3. Fetches Price Points (market, median, qty, sellers).
//   4. For graded slabs (PSA/CGC/BGS/SGC...), runs the AI graded estimate
//      anchored on the raw TCGplayer price and writes that into marketValue.
//   5. For raw cards, mirrors the TCGplayer market price into marketValue when
//      it is empty or still equal to the previously synced TCGplayer price
//      (i.e. not overridden by hand), so listings track the market.
//
// The full cycle is broken into small batches with sleeps in between so it
// never blocks the event loop and won't slam TCGplayer.

import {
  findTcgplayerProductId,
  fetchTcgplayerPricePoints,
  pricePointsToPatch,
  isGraded,
  getGradedEstimate,
  sweepDeadImageUrls, fetchMissingImagesBatch,
  applyFollowedPrice,
  fetchImageOnly,
  tcgplayerImageUrl,
  imageUrlLoads,
} from "./pricing";
import { storage } from "./storage";
import { broadcast } from "./realtime";
import type { Inventory } from "@shared/schema";

type AutoPricingStatus = {
  enabled: boolean;
  intervalMin: number;
  lastRunAt: number | null;
  lastRunDurationMs: number | null;
  lastRunUpdated: number;
  lastRunSkipped: number;
  lastRunFailed: number;
  lastRunTotal: number;
  lastRunImagesUpdated: number;
  nextRunAt: number | null;
  running: boolean;
};

const status: AutoPricingStatus = {
  enabled: true,
  intervalMin: 5,
  lastRunAt: null,
  lastRunDurationMs: null,
  lastRunUpdated: 0,
  lastRunSkipped: 0,
  lastRunFailed: 0,
  lastRunTotal: 0,
  lastRunImagesUpdated: 0,
  nextRunAt: null,
  running: false,
};

let timer: NodeJS.Timeout | null = null;

const BATCH_SIZE = 8;
const PER_ITEM_TIMEOUT_MS = 8000;
const GRADED_TIMEOUT_MS = 12000;
const SLEEP_BETWEEN_BATCHES_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Price a single item: find/reuse its TCGplayer product, pull price points,
// and write marketValue following the graded / raw rules described above.
async function priceItem(item: Inventory): Promise<"updated" | "skipped" | "failed"> {
    try {
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
        new Promise((resolve) =>
          setTimeout(() => resolve(null), PER_ITEM_TIMEOUT_MS)
        ),
      ]);

      if (points) {
        const patch = pricePointsToPatch(points);
        if (isGraded(item.condition)) {
          // Graded: refresh marketValue with AI graded estimate only when
          // empty, so user-entered values are preserved between cycles.
          if (item.marketValue == null) {
            const graded = await Promise.race<any>([
              getGradedEstimate({
                name: item.name,
                set: item.setName ?? "",
                franchise: item.franchise,
                rarity: item.rarity ?? "",
                condition: item.condition ?? "",
                rawMarketPrice: points.marketPrice,
              }),
              new Promise((resolve) =>
                setTimeout(() => resolve(null), GRADED_TIMEOUT_MS)
              ),
            ]);
            if (
              graded &&
              graded.marketValue != null &&
              graded.marketValue > 0
            ) {
              (patch as any).marketValue = graded.marketValue;
            }
          }
        } else {
          // Raw cards track the live TCGplayer market price unless the
          // value was pinned by hand in admin (then the manual price wins).
          await applyFollowedPrice(item, points, patch as any);
        }
        // Keep the photo on the same TCGplayer product the price came from.
        // The image pass can land on a sibling printing (002/165 instead of
        // 167/165) when it runs before pricing; once the price match is
        // known, that product's photo is the right one. Hand-picked photos
        // (local /catalog/ files, Scryfall, etc.) are left alone.
        const tcgpImg = /^https:\/\/product-images\.tcgplayer\.com\/fit-in\/\d+x\d+\/(\d+)\.jpg$/.exec(item.imageUrl ?? "");
        const imgPid = tcgpImg ? Number(tcgpImg[1]) : null;
        if ((!item.imageUrl || (imgPid && imgPid !== points.productId)) && points.productId) {
          const wanted = tcgplayerImageUrl(points.productId);
          if (await imageUrlLoads(wanted)) (patch as any).imageUrl = wanted;
        }
        await storage.updateInventory(item.id, patch as any);
        return "updated";
      } else if (isGraded(item.condition) && item.marketValue == null) {
        // No TCGplayer match for a graded slab — pure AI fallback.
        const graded = await Promise.race<any>([
          getGradedEstimate({
            name: item.name,
            set: item.setName ?? "",
            franchise: item.franchise,
            rarity: item.rarity ?? "",
            condition: item.condition ?? "",
            rawMarketPrice: null,
          }),
          new Promise((resolve) =>
            setTimeout(() => resolve(null), GRADED_TIMEOUT_MS)
          ),
        ]);
        if (
          graded &&
          graded.marketValue != null &&
          graded.marketValue > 0
        ) {
          await storage.updateInventory(item.id, {
            marketValue: graded.marketValue,
          } as any);
          return "updated";
        } else {
          return "skipped";
        }
      } else {
        return "skipped";
      }
    } catch (err) {
      console.error(
        "[autoPricing] item failed",
        item.id,
        (err as any)?.message ?? err
      );
      return "failed";
    }
}

async function runAutoPricing(): Promise<void> {
  if (status.running) {
    console.log("[autoPricing] previous run still in progress — skipping");
    return;
  }
  status.running = true;
  const startedAt = Date.now();
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const items = await storage.listInventory();
    const candidates = items.filter(
      (i) => i.status === "In Inventory" || i.status === "Listed"
    );
    status.lastRunTotal = candidates.length;
    console.log(
      `[autoPricing] cycle start — ${candidates.length} eligible items`
    );

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      // Items in a batch are processed in parallel so a full cycle fits
      // comfortably inside the 5-minute interval.
      await Promise.all(batch.map(async (item) => {
        const r = await priceItem(item);
        if (r === "updated") updated++;
        else if (r === "skipped") skipped++;
        else failed++;
      }));

      // Yield between batches so live requests stay responsive.
      await sleep(SLEEP_BETWEEN_BATCHES_MS);
    }

    // --- Photo backfill: same pattern as the images endpoint. Loop the
    // batch helper until no more candidates remain or we've processed a safe
    // cap of items in one cycle.
    let imagesUpdated = 0;
    try {
      await sweepDeadImageUrls().catch((e) => console.error("[autoPricing] image verify sweep failed", e));
      let offset = 0;
      const MAX_IMAGE_BATCHES = 30; // ~450 items/cycle ceiling
      for (let b = 0; b < MAX_IMAGE_BATCHES; b++) {
        const result = await fetchMissingImagesBatch(15, offset);
        imagesUpdated += result.updated;
        if (result.processed === 0 || result.remaining === 0) break;
        // Successful updates drop out of the candidate set, so re-query from 0
        // each loop — skipped/failed advance offset to make forward progress.
        offset = result.updated > 0 ? 0 : result.nextOffset;
        await sleep(SLEEP_BETWEEN_BATCHES_MS);
      }
    } catch (err) {
      console.error("[autoPricing] image backfill failed", err);
    }
    status.lastRunImagesUpdated = imagesUpdated;

    broadcast({ type: "inventory:bulk", payload: {} });
  } catch (err) {
    console.error("[autoPricing] cycle failed", err);
  } finally {
    const durationMs = Date.now() - startedAt;
    status.lastRunAt = Math.floor(Date.now() / 1000);
    status.lastRunDurationMs = durationMs;
    status.lastRunUpdated = updated;
    status.lastRunSkipped = skipped;
    status.lastRunFailed = failed;
    status.nextRunAt = Math.floor(
      (Date.now() + status.intervalMin * 60 * 1000) / 1000
    );
    status.running = false;
    console.log(
      `[autoPricing] cycle done — prices updated=${updated} skipped=${skipped} failed=${failed} | photos updated=${status.lastRunImagesUpdated} | in ${Math.round(
        durationMs / 1000
      )}s`
    );
  }
}

export function startAutoPricing(): void {
  if (process.env.AUTO_PRICING_DISABLED === "1") {
    console.log("[autoPricing] disabled via env");
    status.enabled = false;
    return;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  const intervalMin = parseInt(
    process.env.AUTO_PRICING_INTERVAL_MIN ?? "5",
    10
  );
  if (isFinite(intervalMin) && intervalMin >= 5) {
    status.intervalMin = intervalMin;
  }

  console.log(
    `[autoPricing] enabled — every ${status.intervalMin} min (in-process scheduler)`
  );

  // Delay first cycle so server has time to settle after startup. The cycle
  // itself yields between batches, so it won't pin the event loop.
  const kickoffMs = 60_000;
  status.nextRunAt = Math.floor((Date.now() + kickoffMs) / 1000);
  setTimeout(() => {
    runAutoPricing().catch((e) =>
      console.error("[autoPricing] startup run failed", e)
    );
  }, kickoffMs);

  timer = setInterval(
    () => {
      runAutoPricing().catch((e) =>
        console.error("[autoPricing] interval run failed", e)
      );
    },
    status.intervalMin * 60 * 1000
  );
}

// Targeted refresh for a known set of items — used right after a spreadsheet
// import so new or renamed rows get their photo and TCGplayer price within
// seconds instead of waiting for the next scheduled cycle. Runs in small
// parallel batches and never throws.
let targetedRunning = false;
export async function refreshItemsNow(ids: string[]): Promise<{ priced: number; photos: number }> {
  const unique = Array.from(new Set(ids));
  let priced = 0;
  let photos = 0;
  if (unique.length === 0) return { priced, photos };
  if (targetedRunning) {
    console.log(`[autoPricing] targeted refresh already running — ${unique.length} item(s) will be picked up by the next cycle`);
    return { priced, photos };
  }
  targetedRunning = true;
  const startedAt = Date.now();
  try {
    console.log(`[autoPricing] targeted refresh — ${unique.length} item(s) from import`);
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const batchIds = unique.slice(i, i + BATCH_SIZE);
      await Promise.all(batchIds.map(async (id) => {
        try {
          const item = await storage.getInventoryItem(id);
          if (!item) return;
          if (!item.imageUrl) {
            const url = await Promise.race<string | null>([
              fetchImageOnly(item),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), PER_ITEM_TIMEOUT_MS)),
            ]);
            if (url) {
              await storage.updateInventory(id, { imageUrl: url } as any);
              photos++;
            }
          }
          if (item.status === "In Inventory" || item.status === "Listed") {
            const fresh = (await storage.getInventoryItem(id)) ?? item;
            if ((await priceItem(fresh)) === "updated") priced++;
          }
        } catch (err) {
          console.error("[autoPricing] targeted item failed", id, (err as any)?.message ?? err);
        }
      }));
      await sleep(SLEEP_BETWEEN_BATCHES_MS);
    }
    broadcast({ type: "inventory:bulk", payload: { source: "autoImport" } });
    console.log(
      `[autoPricing] targeted refresh done — prices updated=${priced} photos updated=${photos} | in ${Math.round((Date.now() - startedAt) / 1000)}s`
    );
  } finally {
    targetedRunning = false;
  }
  return { priced, photos };
}

export function getAutoPricingStatus(): AutoPricingStatus {
  return { ...status };
}

// Manual trigger — exposed via /api/pricing/auto/run.
export async function triggerAutoPricingNow(): Promise<AutoPricingStatus> {
  // Fire-and-forget; don't await full cycle so HTTP returns fast.
  runAutoPricing().catch((e) =>
    console.error("[autoPricing] manual run failed", e)
  );
  return { ...status };
}
