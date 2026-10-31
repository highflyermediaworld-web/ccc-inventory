import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, ExternalLink, Loader2, Copy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What to charge; the session is created when the dialog opens. */
  payload: {
    items: { itemId: string; soldPrice: number }[];
    counterparty?: string | null;
    customerEmail?: string | null;
    discount?: number;
    tax?: number;
    notes?: string | null;
  } | null;
  /** Called once Stripe reports the payment as paid and the sale is recorded. */
  onPaid: (summary: any) => void;
};

type Phase = "creating" | "waiting" | "paid" | "expired" | "error";

/**
 * Register-side Stripe charge. Creates a Checkout Session at the register's
 * prices, shows a big QR (customer scans with their phone) plus an "open here"
 * link for tapping on the counter device, and polls until paid.
 */
export function CardChargeDialog({ open, onOpenChange, payload, onPaid }: Props) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("creating");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ id: string; url: string; total: number } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<number | null>(null);
  const sessionRef = useRef<string | null>(null);

  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => {
    if (!open || !payload) return;
    let cancelled = false;
    setPhase("creating");
    setError(null);
    setSession(null);
    setQr(null);
    setCopied(false);
    (async () => {
      try {
        const res = await apiRequest("POST", "/api/payments/card-session", payload);
        const data = await res.json();
        if (cancelled) return;
        setSession(data);
        sessionRef.current = data.id;
        setQr(await QRCode.toDataURL(data.url, { margin: 1, width: 640, errorCorrectionLevel: "M", color: { dark: "#111114", light: "#ffffff" } }));
        setPhase("waiting");
        pollRef.current = window.setInterval(async () => {
          try {
            const r = await apiRequest("GET", `/api/payments/card-session/${data.id}`);
            const st = await r.json();
            if (st.status === "paid") {
              stopPolling();
              setPhase("paid");
              onPaid(st.summary);
            } else if (st.status === "expired") {
              stopPolling();
              setPhase("expired");
            }
          } catch {
            /* transient; keep polling */
          }
        }, 2500);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Couldn't start the card payment.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function cancelAndClose() {
    stopPolling();
    const id = sessionRef.current;
    if (id && phase === "waiting") {
      apiRequest("POST", `/api/payments/card-session/${id}/cancel`).catch(() => {});
    }
    sessionRef.current = null;
    onOpenChange(false);
  }

  async function copyLink() {
    if (!session?.url) return;
    try {
      await navigator.clipboard.writeText(session.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Couldn't copy", description: session.url });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : phase === "paid" ? onOpenChange(false) : cancelAndClose())}>
      <DialogContent className="max-w-md p-0 overflow-hidden" data-testid="dialog-card-charge">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center text-white font-bold bg-[#635bff]" aria-hidden>S</span>
            Pay by card
          </DialogTitle>
          <DialogDescription>
            {phase === "paid"
              ? "Payment received and the sale is recorded."
              : "Turn the screen toward the customer to scan, or open the link on this device so they can tap or type their card."}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-white text-neutral-900 px-6 py-6 text-center border-t-[5px] border-[#635bff] min-h-[380px] flex flex-col items-center justify-center">
          {phase === "creating" && (
            <div className="flex flex-col items-center gap-3 text-neutral-600">
              <Loader2 className="h-8 w-8 animate-spin" />
              <div className="text-sm">Starting secure checkout…</div>
            </div>
          )}
          {phase === "error" && (
            <div className="text-sm text-red-600 font-semibold" data-testid="text-card-charge-error">{error}</div>
          )}
          {(phase === "waiting" || phase === "expired") && session && (
            <>
              {qr && (
                <img
                  src={qr}
                  alt="Scan to pay by card"
                  width={300}
                  height={300}
                  className={"mx-auto w-[min(100%,300px)] h-auto " + (phase === "expired" ? "opacity-30" : "")}
                  data-testid="img-card-charge-qr"
                />
              )}
              <div className="mt-4 text-4xl font-bold tabular-nums" data-testid="text-card-charge-amount">{formatCurrency(session.total)}</div>
              {phase === "waiting" ? (
                <div className="mt-2 inline-flex items-center gap-2 text-sm text-neutral-600">
                  <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment…
                </div>
              ) : (
                <div className="mt-2 text-sm font-semibold text-red-600">This code expired. Close and start again.</div>
              )}
              <div className="text-xs text-neutral-500 mt-1">Card, Apple Pay or Google Pay · secured by Stripe</div>
            </>
          )}
          {phase === "paid" && session && (
            <div className="flex flex-col items-center gap-3" data-testid="card-charge-paid">
              <div className="h-16 w-16 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center">
                <Check className="h-9 w-9" />
              </div>
              <div className="text-4xl font-bold tabular-nums">{formatCurrency(session.total)}</div>
              <div className="text-sm font-semibold text-emerald-700">Paid</div>
              <div className="text-xs text-neutral-500">Inventory updated and the sale is in the ledger. Stripe emails the receipt if the customer entered an email.</div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 flex flex-wrap gap-2 justify-between items-center">
          {phase === "waiting" && session ? (
            <div className="flex items-center gap-3">
              <a href={session.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary inline-flex items-center gap-1.5" data-testid="link-card-charge-open">
                Open on this device <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button type="button" onClick={copyLink} className="text-sm font-semibold text-muted-foreground inline-flex items-center gap-1.5 hover:text-foreground" data-testid="button-card-charge-copy">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : <span />}
          {phase === "paid" ? (
            <Button onClick={() => onOpenChange(false)} data-testid="button-card-charge-done">Done</Button>
          ) : (
            <Button variant="outline" onClick={cancelAndClose} data-testid="button-card-charge-cancel">
              {phase === "waiting" ? "Cancel payment" : "Close"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
