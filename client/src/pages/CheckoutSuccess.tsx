import { useEffect, useState } from "react";
import { InfoShell } from "./Info";
import { API_BASE } from "@/lib/queryClient";
import { resolveUploadUrl } from "@/lib/uploads";
import { formatCurrency } from "@/lib/format";
import { Check, Loader2, AlertTriangle } from "lucide-react";

type Confirm = {
  ok: boolean;
  itemName: string;
  setName: string | null;
  imageUrl: string | null;
  quantity: number;
  subtotal: number;
  tax: number;
  total: number;
  email: string | null;
  name: string | null;
};

export function CheckoutSuccessPage() {
  const [state, setState] = useState<{ status: "loading" | "ok" | "error"; data?: Confirm; message?: string }>({
    status: "loading",
  });

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("checkout_session");
    if (!sessionId) {
      setState({ status: "error", message: "No checkout session found in this link." });
      return;
    }
    fetch(`${API_BASE}/api/shop/checkout/confirm?session_id=${encodeURIComponent(sessionId)}`, { credentials: "include" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.message || "Couldn't verify the payment.");
        return body as Confirm;
      })
      .then((data) => {
        setState({ status: "ok", data });
        // Drop the session id from the address bar so a refresh stays clean.
        try {
          window.history.replaceState(null, "", `${window.location.pathname}#/checkout/success`);
        } catch {}
      })
      .catch((e) => setState({ status: "error", message: e?.message || "Couldn't verify the payment." }));
  }, []);

  return (
    <InfoShell
      current="checkout"
      kicker="Order confirmed"
      title={<>Thanks. <em>You're all set.</em></>}
      intro="Your card payment went through. A receipt from Stripe is on its way to your inbox, and Chris ships within 48 hours."
    >
      <div className="pc-container py-10 md:py-14 max-w-2xl">
        {state.status === "loading" && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground" data-testid="checkout-loading">
            <Loader2 className="h-4 w-4 animate-spin" /> Confirming your payment…
          </div>
        )}
        {state.status === "error" && (
          <div className="border border-amber-500/40 bg-amber-500/10 p-5" data-testid="checkout-error">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-400" />
              <div className="text-sm">
                <div className="font-semibold">We couldn't confirm this payment automatically.</div>
                <p className="mt-1 text-muted-foreground">{state.message} If your card was charged, you're covered: Stripe emailed you a receipt and Chris will reach out to arrange shipping.</p>
              </div>
            </div>
            <a href="#/" className="pc-btn pc-btn-sm pc-btn-red mt-5 inline-flex">Back to the shop</a>
          </div>
        )}
        {state.status === "ok" && state.data && (
          <div className="border border-white/10 bg-white/[0.03]" data-testid="checkout-receipt">
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
              <span className="inline-flex h-8 w-8 items-center justify-center bg-emerald-500/15 text-emerald-400">
                <Check className="h-4 w-4" />
              </span>
              <div>
                <div className="font-semibold">Payment received</div>
                {state.data.email && <div className="text-xs text-muted-foreground">Receipt sent to {state.data.email}</div>}
              </div>
            </div>
            <div className="flex gap-4 px-5 py-5">
              <div className="w-20 aspect-[3/4] bg-black/30 shrink-0 overflow-hidden">
                {state.data.imageUrl && (
                  <img src={resolveUploadUrl(state.data.imageUrl)} alt="" className="h-full w-full object-contain" />
                )}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                {state.data.setName && <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{state.data.setName}</div>}
                <div className="font-semibold">{state.data.itemName}{state.data.quantity > 1 ? ` ×${state.data.quantity}` : ""}</div>
                <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-muted-foreground">
                  <dt>Subtotal</dt><dd className="text-right tabular-nums text-foreground">{formatCurrency(state.data.subtotal)}</dd>
                  <dt>Sales tax</dt><dd className="text-right tabular-nums text-foreground">{formatCurrency(state.data.tax)}</dd>
                  <dt className="font-semibold text-foreground">Total charged</dt><dd className="text-right tabular-nums font-semibold text-foreground">{formatCurrency(state.data.total)}</dd>
                </dl>
              </div>
            </div>
            <div className="border-t border-white/10 px-5 py-4 flex flex-wrap gap-3">
              <a href="#/" className="pc-btn pc-btn-sm pc-btn-red">Keep browsing</a>
              <a href="#/faq" className="pc-btn pc-btn-sm pc-btn-ghost-dark">Shipping &amp; returns</a>
            </div>
          </div>
        )}
      </div>
    </InfoShell>
  );
}
