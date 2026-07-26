/**
 * CPulls Cards — service worker
 *
 * Strategy:
 *   • App shell (HTML)   → network-first, fall back to cached shell offline.
 *   • Hashed assets      → cache-first (immutable, Vite adds content hash).
 *   • API / auth calls   → network-only, never cache (stale inventory kills trust).
 *   • Images (uploads)   → stale-while-revalidate (fine to show slightly stale).
 *   • Cross-origin       → bypass entirely.
 *
 * The cache version below is bumped on every deploy via the build step so old
 * caches get purged automatically.
 */

const VERSION = "v1";
const SHELL_CACHE = `ccc-shell-${VERSION}`;
const ASSET_CACHE = `ccc-assets-${VERSION}`;
const IMG_CACHE = `ccc-img-${VERSION}`;

// Precache the app shell only — everything else populates on demand.
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([SHELL_CACHE, ASSET_CACHE, IMG_CACHE]);
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Allow the app to tell the SW to activate a new version immediately.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isApiRequest(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname === "/health"
  );
}

function isHashedAsset(url) {
  // Vite emits /assets/index-XXXXXXXX.js and .css with a content hash.
  return url.pathname.startsWith("/assets/");
}

function isImage(url, request) {
  if (request.destination === "image") return true;
  return /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin requests (Stripe, Cloudflare, TikTok embeds, etc.)
  if (url.origin !== self.location.origin) return;

  // API + auth → network only.
  if (isApiRequest(url)) return;

  // Navigations (SPA shell) → network-first with cached fallback.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }

  // Hashed built assets → cache-first (they're immutable per hash).
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Images → stale-while-revalidate.
  if (isImage(url, request)) {
    event.respondWith(staleWhileRevalidate(request, IMG_CACHE));
    return;
  }

  // Everything else same-origin → network with cache fallback.
  event.respondWith(networkThenCache(request, SHELL_CACHE));
});

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put("/index.html", fresh.clone());
    return fresh;
  } catch (err) {
    const cached =
      (await cache.match(request)) ||
      (await cache.match("/index.html")) ||
      (await cache.match("/"));
    if (cached) return cached;
    return new Response(
      "<h1>Offline</h1><p>CPulls Cards is offline. Reconnect and reload.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

async function networkThenCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}
