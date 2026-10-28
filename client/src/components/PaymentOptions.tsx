import { useState } from "react";
import { ExternalLink, QrCode, X } from "lucide-react";
import { PAYMENT_OPTIONS, type PaymentOption } from "@/data/payments";

/**
 * Storefront "Ways to pay" cards. Each card shows the handle, a tap-to-pay
 * link (opens the app on phones) and the QR code for paying from another device.
 */
export function PaymentOptionCards({ amount }: { amount?: number }) {
  const [zoom, setZoom] = useState<PaymentOption | null>(null);
  return (
    <>
      <div className="pc-pay-grid" data-testid="payment-options">
        {PAYMENT_OPTIONS.map((p) => {
          const href = amount && p.linkWithAmount ? p.linkWithAmount(amount) : p.link;
          return (
            <article key={p.id} className="pc-pay-card" style={{ ["--pay" as any]: p.color }} data-testid={`payment-${p.id}`}>
              <div className="pc-pay-head">
                <span className="pc-pay-mark" aria-hidden>{p.name[0]}</span>
                <div className="min-w-0">
                  <h3>{p.name}</h3>
                  <div className="pc-pay-handle" data-testid={`payment-handle-${p.id}`}>{p.handle}</div>
                </div>
              </div>
              <button type="button" className="pc-pay-qr" onClick={() => setZoom(p)} aria-label={`Show ${p.name} QR code larger`} data-testid={`payment-qr-${p.id}`}>
                <img src={p.qr} alt={`${p.name} QR code for ${p.handle}`} width={160} height={160} loading="lazy" />
                <span><QrCode className="h-3.5 w-3.5" /> Tap to enlarge</span>
              </button>
              <p className="pc-pay-note">{p.note}</p>
              <a href={href} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-sm pc-pay-btn" data-testid={`payment-link-${p.id}`}>
                Pay with {p.name} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </article>
          );
        })}
      </div>
      {zoom && (
        <div className="pc-pay-zoom" role="dialog" aria-modal="true" aria-label={`${zoom.name} QR code`} onClick={() => setZoom(null)} data-testid="payment-zoom">
          <div className="pc-pay-zoom-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="pc-pay-zoom-close" onClick={() => setZoom(null)} aria-label="Close" data-testid="payment-zoom-close"><X className="h-5 w-5" /></button>
            <img src={zoom.qr} alt={`${zoom.name} QR code for ${zoom.handle}`} width={320} height={320} />
            <div className="pc-pay-zoom-title">{zoom.name}</div>
            <div className="pc-pay-zoom-handle">{zoom.handle}</div>
            {amount ? <div className="pc-pay-zoom-amount">${amount.toFixed(2)}</div> : null}
            <p>Scan with your phone camera or the {zoom.name} app.</p>
          </div>
        </div>
      )}
    </>
  );
}

/** Compact inline list: "Zelle · Venmo · Cash App · PayPal" with links. */
export function PaymentChips({ amount, className = "" }: { amount?: number; className?: string }) {
  return (
    <div className={`pc-pay-chips ${className}`} data-testid="payment-chips">
      {PAYMENT_OPTIONS.map((p) => (
        <a
          key={p.id}
          href={amount && p.linkWithAmount ? p.linkWithAmount(amount) : p.link}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ["--pay" as any]: p.color }}
          data-testid={`payment-chip-${p.id}`}
        >
          <span aria-hidden /> {p.name}
        </a>
      ))}
    </div>
  );
}
