import { useQuery } from "@tanstack/react-query";
import { Truck, Check } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";

export type ShippingConfig = { enabled: boolean; service: string; days: string; freeOver: number | null };

/** Public shipping config (free-shipping threshold, service, transit days). */
export function useShippingConfig() {
  const q = useQuery<ShippingConfig>({
    queryKey: ["/api/shop/shipping/quote", "config"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/shop/shipping/quote?zip=00000&items=`, { credentials: "omit" });
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const enabled = q.data?.enabled !== false;
  const freeOver = enabled ? (q.data?.freeOver ?? null) : null;
  return { enabled, freeOver, service: q.data?.service ?? "USPS Ground Advantage", days: q.data?.days ?? "2–5 business days" };
}

const whole = (n: number) => (Number.isInteger(n) ? `$${n}` : formatCurrency(n));

/** Header strip note: "Free shipping over $100". Renders nothing when no threshold is set. */
export function FreeShippingNote({ className = "" }: { className?: string }) {
  const { freeOver } = useShippingConfig();
  if (freeOver == null) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} data-testid="text-free-shipping-note">
      <Truck className="h-3.5 w-3.5" /> Free shipping over {whole(freeOver)}
    </span>
  );
}

/** Slim mobile-only strip under the header (the desktop micro strip is hidden on phones). */
export function MobileShippingStrip() {
  const { freeOver } = useShippingConfig();
  return (
    <div className="md:hidden border-t border-white/10 bg-black text-white/85 text-[12px]" data-testid="strip-mobile-shipping">
      <div className="pc-container h-7 flex items-center justify-center gap-4 whitespace-nowrap overflow-hidden">
        {freeOver != null && <span className="inline-flex items-center gap-1.5 font-semibold text-white"><Truck className="h-3.5 w-3.5" /> Free shipping over {whole(freeOver)}</span>}
        <span className="truncate">Orders ship within 48 hours</span>
      </div>
    </div>
  );
}

/**
 * Cart / Buy-dialog progress toward free shipping, judged on the
 * merchandise subtotal before tax (shipping and tax never count).
 */
export function FreeShippingProgress({ subtotal, className = "" }: { subtotal: number; className?: string }) {
  const { freeOver } = useShippingConfig();
  if (freeOver == null) return null;
  const unlocked = subtotal >= freeOver;
  const pct = Math.max(0, Math.min(100, (subtotal / freeOver) * 100));
  const remaining = Math.max(0, freeOver - subtotal);
  return (
    <div className={`border border-border p-3 ${unlocked ? "bg-black text-white" : "bg-muted/40"} ${className}`} data-testid="free-shipping-progress" data-unlocked={unlocked ? "1" : "0"}>
      <div className="flex items-center gap-2 text-sm">
        {unlocked ? <Check className="h-4 w-4 shrink-0" /> : <Truck className="h-4 w-4 shrink-0" />}
        {unlocked ? (
          <span><b>You've unlocked free shipping.</b> Orders over {whole(freeOver)} before tax ship free.</span>
        ) : (
          <span>Add <b>{formatCurrency(remaining)}</b> more for free shipping (orders over {whole(freeOver)} before tax).</span>
        )}
      </div>
      {!unlocked && (
        <div className="mt-2 h-1.5 w-full bg-border" aria-hidden>
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
