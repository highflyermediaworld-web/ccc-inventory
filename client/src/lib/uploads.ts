// Resolves an imageUrl that may be:
// - null/undefined \u2192 returns null
// - absolute URL (http/https) \u2192 passes through
// - relative /uploads/... \u2192 prepends the deployed asset base so the sandbox proxy
//   sees port 5000 (handled by queryClient's __PORT_5000__ replacement).
import { API_BASE } from "@/lib/queryClient";

export function resolveUploadUrl(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith("/uploads/")) {
    if (API_BASE) return API_BASE.replace(/\/$/, "") + imageUrl;
    return imageUrl;
  }
  return imageUrl;
}

// TCGplayer product photos are served in fixed square sizes. The storefront
// grid shows them at ~200-260 CSS px, so the 437px master is 3-4x more bytes
// than needed. Build a srcset so the browser picks the smallest that fits.
const TCGP_IMG = /^(https:\/\/product-images\.tcgplayer\.com\/fit-in\/)(\d+)x(\d+)(\/\d+\.jpg)$/i;
export function tcgplayerSized(url: string, size: number): string {
  const m = url.match(TCGP_IMG);
  return m ? `${m[1]}${size}x${size}${m[4]}` : url;
}
export function thumbSrcSet(url: string | null | undefined): { src: string; srcSet?: string; sizes?: string } | null {
  if (!url) return null;
  if (!TCGP_IMG.test(url)) return { src: url };
  return {
    src: tcgplayerSized(url, 300),
    srcSet: [200, 300, 437].map((s) => `${tcgplayerSized(url, s)} ${s}w`).join(", "),
    sizes: "(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 240px",
  };
}
