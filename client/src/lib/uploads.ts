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
