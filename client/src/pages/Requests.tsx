import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { CustomerRequest, Inventory } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CardThumb } from "@/components/CardThumb";
import { StatusBadge } from "@/components/Badges";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Inbox,
  ShoppingBag,
  ArrowLeftRight,
  Mail,
  Phone,
  AtSign,
  Copy,
  Check as CheckIcon,
} from "lucide-react";

type RequestRow = CustomerRequest & { item: Inventory | null };

const TABS: { key: string; label: string }[] = [
  { key: "New", label: "New" },
  { key: "Accepted", label: "Accepted" },
  { key: "Declined", label: "Declined" },
  { key: "Completed", label: "Completed" },
  { key: "All", label: "All" },
];

export default function RequestsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>("New");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Fetch all requests once; filter client-side so we can display per-tab counts.
  const { data: allRequests = [], isLoading } = useQuery<RequestRow[]>({
    queryKey: ["/api/requests"],
  });

  const byStatus = useMemo(() => {
    const map: Record<string, RequestRow[]> = {
      New: [],
      Accepted: [],
      Declined: [],
      Completed: [],
      All: [],
    };
    for (const r of allRequests) {
      if (map[r.status]) map[r.status].push(r);
      map.All.push(r);
    }
    return map;
  }, [allRequests]);

  const visible = byStatus[activeTab] ?? [];
  const selected = allRequests.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="p-5 sm:p-8">
      <PageHeader
        eyebrow="Inbox"
        title="Customer Requests"
        description="Buy and trade requests submitted from your public shop at /#/shop."
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-border">
        {TABS.map((t) => {
          const count = byStatus[t.key]?.length ?? 0;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              data-testid={`tab-${t.key}`}
              className={cn(
                "relative px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="inline-flex items-center gap-2">
                {t.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center rounded-full px-1.5 min-w-[20px] h-5 text-[10px] font-bold tabular-nums",
                      t.key === "New"
                        ? "bg-primary text-primary-foreground"
                        : active
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-md bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <div className="text-sm text-muted-foreground">
            No {activeTab === "All" ? "" : activeTab.toLowerCase() + " "}requests yet.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <RequestCard key={r.id} req={r} onClick={() => setSelectedId(r.id)} />
          ))}
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent
          side="right"
          className="w-[90vw] sm:max-w-lg overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>
              Request #{selected?.id} · {selected?.type}
            </SheetTitle>
          </SheetHeader>
          {selected && (
            <RequestDrawer
              req={selected}
              onClose={() => setSelectedId(null)}
              toast={toast}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------- Row card ----------
function RequestCard({ req, onClick }: { req: RequestRow; onClick: () => void }) {
  const typeBadge =
    req.type === "Buy"
      ? "bg-blue-500/20 text-blue-800 dark:bg-blue-400/25 dark:text-blue-100 border-blue-500/40"
      : "bg-violet-500/20 text-violet-800 dark:bg-violet-400/25 dark:text-violet-100 border-violet-500/40";
  return (
    <button
      onClick={onClick}
      data-testid={`row-request-${req.id}`}
      className="w-full text-left rounded-md border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {req.item ? (
          <div className="w-10 h-14 shrink-0">
            <CardThumb
              imageUrl={req.item.imageUrl}
              franchise={req.item.franchise}
              size="sm"
              className="h-full w-full"
            />
          </div>
        ) : (
          <div className="w-10 h-14 bg-muted rounded-md shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                typeBadge
              )}
            >
              {req.type === "Buy" ? (
                <ShoppingBag className="h-3 w-3" />
              ) : (
                <ArrowLeftRight className="h-3 w-3" />
              )}
              {req.type}
            </span>
            <StatusBadge status={req.status} />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {formatDateTime(req.createdAt)}
            </span>
          </div>
          <div className="mt-1 font-medium text-sm truncate">
            {req.customerName}{" "}
            <span className="text-muted-foreground font-normal">·</span>{" "}
            <span className="text-muted-foreground font-normal">{req.customerEmail}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {req.item ? `${req.item.setName} — ${req.item.name}` : "—"}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        {req.type === "Buy" && req.offerPrice != null ? (
          <div className="text-base font-bold text-primary tabular-nums">
            {formatCurrency(req.offerPrice)}
          </div>
        ) : req.type === "Trade" ? (
          <div className="text-[11px] text-muted-foreground max-w-[180px] truncate">
            offers: {req.offerDescription?.slice(0, 50) || "—"}
          </div>
        ) : null}
      </div>
    </button>
  );
}

// ---------- Drawer ----------
function RequestDrawer({
  req,
  onClose,
  toast,
}: {
  req: RequestRow;
  onClose: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [adminNote, setAdminNote] = useState(req.adminNote ?? "");
  const [markSold, setMarkSold] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: async (patch: { status: string; adminNote?: string | null }) => {
      const res = await apiRequest("PATCH", `/api/requests/${req.id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: "Request updated" });
      onClose();
    },
    onError: (err: any) =>
      toast({ title: "Update failed", description: err?.message, variant: "destructive" }),
  });

  const acceptBuyMutation = useMutation({
    mutationFn: async (body: { markSold: boolean; adminNote?: string | null }) => {
      const res = await apiRequest("POST", `/api/requests/${req.id}/accept-buy`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({ title: "Buy request accepted" });
      onClose();
    },
    onError: (err: any) =>
      toast({ title: "Accept failed", description: err?.message, variant: "destructive" }),
  });

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  const images: string[] = useMemo(() => {
    if (!req.offerImageUrls) return [];
    try {
      return JSON.parse(req.offerImageUrls) as string[];
    } catch {
      return [];
    }
  }, [req.offerImageUrls]);

  return (
    <div className="mt-6 space-y-5">
      {/* Item */}
      {req.item && (
        <div className="rounded-md border border-border bg-muted/30 p-3 flex gap-3">
          <div className="w-16 h-20 shrink-0">
            <CardThumb
              imageUrl={req.item.imageUrl}
              franchise={req.item.franchise}
              size="lg"
              className="h-full w-full"
            />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
              {req.item.setName} · {req.item.franchise}
            </div>
            <div className="font-semibold text-sm truncate">{req.item.name}</div>
            <div className="text-xs text-muted-foreground">
              {req.item.condition} · {req.item.rarity || "—"}
            </div>
            {req.item.asking != null && (
              <div className="text-sm font-bold text-primary tabular-nums mt-1">
                asking {formatCurrency(req.item.asking)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Customer contact */}
      <section>
        <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-2">
          Customer
        </h3>
        <div className="space-y-1.5">
          <ContactRow
            icon={<span className="font-bold text-[10px]">NAME</span>}
            value={req.customerName}
            onCopy={() => copy(req.customerName, "name")}
            copied={copiedKey === "name"}
          />
          <ContactRow
            icon={<Mail className="h-3.5 w-3.5" />}
            value={req.customerEmail}
            onCopy={() => copy(req.customerEmail, "email")}
            copied={copiedKey === "email"}
            href={`mailto:${req.customerEmail}`}
          />
          {req.customerPhone && (
            <ContactRow
              icon={<Phone className="h-3.5 w-3.5" />}
              value={req.customerPhone}
              onCopy={() => copy(req.customerPhone!, "phone")}
              copied={copiedKey === "phone"}
              href={`tel:${req.customerPhone}`}
            />
          )}
          {req.customerHandle && (
            <ContactRow
              icon={<AtSign className="h-3.5 w-3.5" />}
              value={req.customerHandle}
              onCopy={() => copy(req.customerHandle!, "handle")}
              copied={copiedKey === "handle"}
            />
          )}
          <div className="text-xs text-muted-foreground pt-1">
            Preferred: <span className="font-semibold text-foreground">{req.preferredContact}</span>
          </div>
        </div>
      </section>

      {/* Buy / Trade details */}
      {req.type === "Buy" ? (
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-2">
            Offer
          </h3>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Offered price</span>
            <span className="text-xl font-bold text-primary tabular-nums">
              {formatCurrency(req.offerPrice)}
            </span>
          </div>
          {req.quantity > 1 && (
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-xs text-muted-foreground">Quantity</span>
              <span className="text-sm tabular-nums">{req.quantity}</span>
            </div>
          )}
        </section>
      ) : (
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-2">
            Their offer
          </h3>
          <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-3 border border-border">
            {req.offerDescription || "—"}
          </p>
          {images.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {images.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square rounded border border-border overflow-hidden bg-muted/30 hover:border-primary transition-colors"
                >
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {req.message && (
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-2">
            Message
          </h3>
          <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-3 border border-border">
            {req.message}
          </p>
        </section>
      )}

      {/* Admin note input */}
      <section>
        <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
          Your note (internal)
        </Label>
        <Textarea
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          placeholder="Notes only visible to you"
          rows={2}
          className="mt-1"
          data-testid="textarea-admin-note"
        />
      </section>

      {/* Actions */}
      <section className="space-y-3 pt-3 border-t border-border">
        {req.type === "Buy" && req.status === "New" && req.itemId && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={markSold}
              onCheckedChange={(v) => setMarkSold(!!v)}
              data-testid="checkbox-mark-sold"
            />
            <span>
              On accept: mark item <span className="font-semibold">Sold</span> and create Sell
              transaction @ {formatCurrency(req.offerPrice)}
            </span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {req.status !== "Accepted" && (
            <Button
              onClick={() => {
                if (req.type === "Buy") {
                  acceptBuyMutation.mutate({ markSold, adminNote: adminNote || null });
                } else {
                  statusMutation.mutate({ status: "Accepted", adminNote: adminNote || null });
                }
              }}
              disabled={acceptBuyMutation.isPending || statusMutation.isPending}
              className="gap-1.5"
              data-testid="button-accept"
            >
              <CheckIcon className="h-4 w-4" /> Accept
            </Button>
          )}
          {req.status !== "Declined" && (
            <Button
              variant="outline"
              onClick={() =>
                statusMutation.mutate({ status: "Declined", adminNote: adminNote || null })
              }
              disabled={statusMutation.isPending}
              data-testid="button-decline"
            >
              Decline
            </Button>
          )}
          {req.status !== "Completed" && (
            <Button
              variant="outline"
              onClick={() =>
                statusMutation.mutate({ status: "Completed", adminNote: adminNote || null })
              }
              disabled={statusMutation.isPending}
              data-testid="button-complete"
            >
              Mark Completed
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function ContactRow({
  icon,
  value,
  onCopy,
  copied,
  href,
}: {
  icon: React.ReactNode;
  value: string;
  onCopy: () => void;
  copied: boolean;
  href?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-12 text-muted-foreground flex items-center justify-center">{icon}</span>
      {href ? (
        <a
          href={href}
          className="flex-1 truncate text-foreground hover:text-primary"
          target={href.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer"
        >
          {value}
        </a>
      ) : (
        <span className="flex-1 truncate">{value}</span>
      )}
      <button
        onClick={onCopy}
        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        aria-label="Copy"
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
