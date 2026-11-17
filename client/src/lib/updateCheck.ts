/**
 * Stale-build guard. A long-lived tab (or a PWA launched from the home screen)
 * can keep running a bundle from days ago while the API has moved on — e.g. a
 * cart without the ZIP field hitting a server that requires one.
 *
 * We compare the hashed /assets/*.js files this page loaded against the ones
 * referenced by a fresh copy of index.html. When they differ a new build is
 * live: reload as soon as the tab is (re)focused, which is a moment the user
 * isn't mid-tap. The cart lives in localStorage, so nothing is lost.
 */
const CHECK_MIN_GAP_MS = 60_000;
let lastCheck = 0;
let reloading = false;

function currentAssets(): string[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
    .map((s) => new URL(s.src, location.href).pathname)
    .filter((p) => p.startsWith("/assets/"))
    .sort();
}

async function freshAssets(): Promise<string[] | null> {
  try {
    const r = await fetch(`/index.html?u=${Date.now()}`, { cache: "no-store", credentials: "omit" });
    if (!r.ok) return null;
    const html = await r.text();
    const found = new Set<string>();
    for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)) found.add(m[1]);
    return Array.from(found).sort();
  } catch {
    return null;
  }
}

export async function checkForNewBuild(reason: string): Promise<boolean> {
  if (reloading || !import.meta.env.PROD) return false;
  const now = Date.now();
  if (now - lastCheck < CHECK_MIN_GAP_MS) return false;
  lastCheck = now;
  const mine = currentAssets();
  if (!mine.length) return false;
  const fresh = await freshAssets();
  if (!fresh || !fresh.length) return false;
  const stale = mine.some((p) => !fresh.includes(p));
  if (!stale) return false;
  console.info(`[update] new build detected (${reason}); reloading`);
  reloading = true;
  // Let an active service worker pick up the new shell too.
  try { (await navigator.serviceWorker?.getRegistration())?.update(); } catch {}
  location.reload();
  return true;
}

export function startUpdateChecks() {
  if (!import.meta.env.PROD) return;
  // First check shortly after load; afterwards whenever the tab comes back.
  setTimeout(() => void checkForNewBuild("load"), 4_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForNewBuild("focus");
  });
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) void checkForNewBuild("bfcache");
  });
  // Belt and braces for tabs that never lose focus.
  setInterval(() => void checkForNewBuild("interval"), 30 * 60_000);
}
