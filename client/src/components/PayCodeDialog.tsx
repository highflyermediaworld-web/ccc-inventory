import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { PaymentOption } from "@/data/payments";

/**
 * Full-screen-ish pay code to turn toward a customer at the table: big QR,
 * amount, handle. High-contrast light panel so phone cameras lock on fast.
 */
export function PayCodeDialog({ open, onOpenChange, option, amount }: { open: boolean; onOpenChange: (o: boolean) => void; option: PaymentOption; amount: number }) {
  const href = option.linkWithAmount ? option.linkWithAmount(amount) : option.link;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden" data-testid="dialog-pay-code">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center text-white font-bold" style={{ background: option.color }} aria-hidden>{option.name[0]}</span>
            Pay with {option.name}
          </DialogTitle>
          <DialogDescription>Turn the screen toward the customer. They scan with their camera or the {option.name} app.</DialogDescription>
        </DialogHeader>
        <div className="bg-white text-neutral-900 px-6 py-6 text-center" style={{ borderTop: `5px solid ${option.color}` }}>
          <img src={option.qr} alt={`${option.name} QR code for ${option.handle}`} width={300} height={300} className="mx-auto w-[min(100%,300px)] h-auto" style={{ imageRendering: "pixelated" }} />
          <div className="mt-4 text-4xl font-bold tabular-nums" data-testid="text-pay-code-amount">{formatCurrency(amount)}</div>
          <div className="mt-1 text-sm font-semibold text-neutral-700 break-words" data-testid="text-pay-code-handle">{option.handle}</div>
          <div className="text-xs text-neutral-500 mt-0.5">{option.note}</div>
        </div>
        <div className="px-6 py-4 flex flex-wrap gap-2 justify-between items-center">
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary inline-flex items-center gap-1.5" data-testid="link-pay-code-open">
            Open link <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Button onClick={() => onOpenChange(false)} data-testid="button-pay-code-done">Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
