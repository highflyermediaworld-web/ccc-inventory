import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, API_BASE } from "@/lib/queryClient";
import type { Shipment, ShipmentItem, Inventory } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Truck, Printer, FileText, Copy, Check as CheckIcon, PackageCheck, Plus, ExternalLink, Undo2, Trash2 } from "lucide-react";

type Row = Omit<Shipment, "items"> & { items: ShipmentItem[] };

const TABS = [
  { key: "To ship", label: "To ship" },
  { key: "Shipped", label: "Shipped" },
  { key: "All", label: "All" },
];

function weightLabel(oz: number) {
  if (oz < 16) return `${Math.ceil(oz)} oz`;
  const lb = Math.floor(oz / 16);
  const rem = Math.ceil(oz - lb * 16);
  return rem ? `${lb} lb ${rem} oz` : `${lb} lb`;
}
function addressText(s: Row) {
  return [s.customerName, s.line1, s.line2, `${s.city}, ${s.state} ${s.zip}`].filter(Boolean).join("\n");
}
function cleanErr(err: any) {
  const m = String(err?.message ?? err ?? "");
  return m.replace(/^\d{3}:\s*/, "").replace(/^\{.*"message":"([^"]+)".*\}$/, "$1");
}

export default function ShipmentsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("To ship");
  const [creating, setCreating] = useState(false);
  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["/api/admin/shipments"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/shipments")).json(),
    refetchInterval: 60_000,
  });
  const byTab = useMemo(() => {
    const m: Record<string, Row[]> = { "To ship": [], Shipped: [], All: [] };
    for (const r of rows) {
      if (m[r.status]) m[r.status].push(r);
      m.All.push(r);
    }
    return m;
  }, [rows]);
  const visible = byTab[tab] ?? [];

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) => (await apiRequest("PATCH", `/api/admin/shipments/${id}`, body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/shipments"] }),
    onError: (err: any) => toast({ title: "Couldn't update", description: cleanErr(err), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/admin/shipments/${id}`)).json(),
    onSuccess: () => { toast({ title: "Shipment removed" }); queryClient.invalidateQueries({ queryKey: ["/api/admin/shipments"] }); },
  });

  return (
    <div className="p-5 sm:p-8">
      <PageHeader
        eyebrow="Fulfilment"
        title="Shipping"
        description="Every paid online order lands here with a ready-to-print USPS label and packing slip. Pay postage at the counter or on Click-N-Ship, then mark it shipped."
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="https://cns.usps.com/" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" data-testid="button-click-n-ship"><ExternalLink className="size-4 mr-2" /> Click-N-Ship</Button>
            </a>
            <Button onClick={() => setCreating(true)} data-testid="button-new-shipment"><Plus className="size-4 mr-2" /> New shipment</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1 mb-6 border-b border-border">
        {TABS.map((t) => {
          const count = byTab[t.key]?.length ?? 0;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`tab-ship-${t.key}`}
              className={cn("relative px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px", active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <span className="inline-flex items-center gap-2">
                {t.label}
                {count > 0 && (
                  <span className={cn("inline-flex items-center justify-center px-1.5 min-w-[20px] h-5 text-[10px] font-bold tabular-nums", t.key === "To ship" ? "bg-primary text-primary-foreground" : active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{count}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-muted/40 animate-pulse" />)}</div>
      ) : visible.length === 0 ? (
        <div className="border border-dashed border-border p-10 text-center">
          <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{tab === "To ship" ? "Nothing waiting to ship. Paid online orders appear here automatically." : "No shipments here yet."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => <ShipmentCard key={s.id} s={s} onPatch={(body) => patch.mutate({ id: s.id, body })} onDelete={() => remove.mutate(s.id)} busy={patch.isPending} />)}
        </div>
      )}

      {creating && <NewShipmentDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function ShipmentCard({ s, onPatch, onDelete, busy }: { s: Row; onPatch: (b: Record<string, unknown>) => void; onDelete: () => void; busy: boolean }) {
  const [tracking, setTracking] = useState(s.tracking ?? "");
  const [copied, setCopied] = useState(false);
  const count = s.items.reduce((n, i) => n + i.quantity, 0);
  const shipped = s.status === "Shipped";
  const label = `${API_BASE}/api/admin/shipments/${s.id}/label`;
  const slip = `${API_BASE}/api/admin/shipments/${s.id}/packing-slip`;
  // On phones open in the same tab so the "← Shipping" button brings you back;
  // on desktop a new tab keeps the queue open while printing.
  const newTab = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  const tgt = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  async function copy() {
    try { await navigator.clipboard.writeText(addressText(s)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="border border-border bg-card p-4 grid gap-4 lg:grid-cols-[1.2fr_1fr_14rem] min-w-0 overflow-hidden" data-testid={`shipment-${s.id}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5", shipped ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-200" : "bg-primary text-primary-foreground")}>{s.status}</span>
          <span className="text-xs text-muted-foreground">#{s.id} · {formatDateTime(s.createdAt)}</span>
          {s.orderRef && <span className="text-xs text-muted-foreground truncate max-w-[220px]" title={s.orderRef}>{s.orderRef.startsWith("cs_") ? `Stripe …${s.orderRef.slice(-8)}` : s.orderRef}</span>}
        </div>
        <pre className="mt-2 font-sans text-sm leading-snug whitespace-pre-wrap" data-testid={`shipment-address-${s.id}`}>{addressText(s)}</pre>
        {(s.customerEmail || s.customerPhone) && <div className="mt-1 text-xs text-muted-foreground">{[s.customerEmail, s.customerPhone].filter(Boolean).join(" · ")}</div>}
      </div>
      <div className="text-sm min-w-0">
        <ul className="space-y-0.5">
          {s.items.map((i, idx) => <li key={idx} className="flex justify-between gap-3 min-w-0"><span className="truncate min-w-0">{i.quantity > 1 ? `${i.quantity}× ` : ""}{i.name}{i.setName ? <span className="text-muted-foreground"> · {i.setName}</span> : null}</span>{i.unitPrice != null && <span className="tabular-nums text-muted-foreground shrink-0">{formatCurrency(i.unitPrice * i.quantity)}</span>}</li>)}
        </ul>
        <div className="mt-2 text-xs text-muted-foreground">
          {s.service} · {weightLabel(s.ounces)} · {count} item{count === 1 ? "" : "s"}{s.zone ? ` · zone ${s.zone}` : ""}
          {s.postageEstimate != null && <> · est. postage <b className="text-foreground">{formatCurrency(s.postageEstimate)}</b></>}
          {s.shippingCharged != null && <> · customer paid {s.shippingCharged > 0 ? formatCurrency(s.shippingCharged) : "free"}</>}
        </div>
        {s.tracking && <div className="mt-1 text-xs break-all">Tracking: <a className="underline" href={`https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(s.tracking)}`} target="_blank" rel="noopener noreferrer">{s.tracking}</a></div>}
        {s.note && <div className="mt-1 text-xs text-muted-foreground">{s.note}</div>}
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        <a href={label} {...tgt}><Button className="w-full" size="sm" data-testid={`button-label-${s.id}`}><Printer className="size-4 mr-2" /> Print label</Button></a>
        <a href={slip} {...tgt}><Button className="w-full" variant="outline" size="sm"><FileText className="size-4 mr-2" /> Packing slip</Button></a>
        <Button variant="outline" size="sm" onClick={copy}>{copied ? <CheckIcon className="size-4 mr-2" /> : <Copy className="size-4 mr-2" />}{copied ? "Copied" : "Copy address"}</Button>
        {!shipped ? (
          <div className="flex gap-1 min-w-0">
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking # (optional)" className="h-9 text-xs min-w-0 flex-1" data-testid={`input-tracking-${s.id}`} />
            <Button size="sm" className="h-9 shrink-0" disabled={busy} onClick={() => onPatch({ status: "Shipped", tracking: tracking.trim() || null })} data-testid={`button-shipped-${s.id}`}><PackageCheck className="size-4 mr-1" /> Shipped</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onPatch({ status: "To ship" })}><Undo2 className="size-4 mr-2" /> Back to “To ship”</Button>
        )}
        <Button variant="outline" size="sm" className="border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)} data-testid={`button-delete-${s.id}`}><Trash2 className="size-4 mr-2" /> Delete label</Button>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this shipping label?</AlertDialogTitle>
              <AlertDialogDescription>Removes label #{s.id} for {s.customerName}. The order, payment and inventory are not affected — you can recreate it with New shipment.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete} data-testid={`button-delete-confirm-${s.id}`}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function NewShipmentDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: inventory = [] } = useQuery<Inventory[]>({ queryKey: ["/api/inventory"] });
  const [f, setF] = useState({ customerName: "", customerEmail: "", customerPhone: "", line1: "", line2: "", city: "", state: "", zip: "", orderRef: "", shippingCharged: "", orderTotal: "", note: "" });
  const [items, setItems] = useState<ShipmentItem[]>([]);
  const [search, setSearch] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return inventory.filter((i) => i.status !== "Sold" && (`${i.id} ${i.name} ${i.setName ?? ""}`.toLowerCase().includes(q))).slice(0, 8);
  }, [search, inventory]);
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/shipments", {
      ...f,
      customerEmail: f.customerEmail || null,
      customerPhone: f.customerPhone || null,
      line2: f.line2 || null,
      orderRef: f.orderRef || undefined,
      shippingCharged: f.shippingCharged === "" ? null : Number(f.shippingCharged),
      orderTotal: f.orderTotal === "" ? null : Number(f.orderTotal),
      note: f.note || null,
      items,
    })).json(),
    onSuccess: () => { toast({ title: "Shipment created", description: "Label and packing slip are ready to print." }); queryClient.invalidateQueries({ queryKey: ["/api/admin/shipments"] }); onClose(); },
    onError: (err: any) => toast({ title: "Couldn't create shipment", description: cleanErr(err), variant: "destructive" }),
  });
  const field = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={f[k]} onChange={(e) => set(k, e.target.value)} className="mt-1" data-testid={`input-newship-${k}`} {...props} />
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New shipment</DialogTitle>
          <DialogDescription>For orders paid by Zelle, Venmo, Cash App or PayPal. Weight and postage are estimated from the items.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("customerName", "Customer name *")}
          {field("orderRef", "Order reference", { placeholder: "e.g. Zelle 11/12 · Request #42" })}
          {field("line1", "Street address *", { autoComplete: "address-line1" })}
          {field("line2", "Apt / unit", { autoComplete: "address-line2" })}
          {field("city", "City *")}
          <div className="grid grid-cols-2 gap-3">
            {field("state", "State *", { maxLength: 2, placeholder: "CA" })}
            {field("zip", "ZIP *", { inputMode: "numeric", maxLength: 10 })}
          </div>
          {field("customerEmail", "Email", { type: "email" })}
          {field("customerPhone", "Phone")}
        </div>
        <div>
          <Label className="text-xs">Items *</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search inventory by name or ID…" className="mt-1" data-testid="input-newship-search" />
          {matches.length > 0 && (
            <div className="border border-border mt-1 max-h-48 overflow-y-auto">
              {matches.map((i) => (
                <button key={i.id} type="button" className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex justify-between gap-3"
                  onClick={() => { setItems((arr) => [...arr, { itemId: i.id, name: i.name, setName: i.setName ?? null, quantity: 1, category: i.category, unitPrice: i.asking ?? i.marketValue ?? null }]); setSearch(""); }}>
                  <span className="truncate">{i.id} · {i.name}<span className="text-muted-foreground"> · {i.setName} · {i.category}</span></span>
                  <span className="tabular-nums text-muted-foreground shrink-0">{formatCurrency(i.asking ?? i.marketValue)}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="mt-1 text-xs underline text-muted-foreground" onClick={() => setItems((arr) => [...arr, { itemId: null, name: "Custom item", setName: null, quantity: 1, category: "Raw", unitPrice: null }])}>+ add a custom line</button>
          {items.length > 0 && (
            <ul className="mt-2 space-y-1">
              {items.map((it, idx) => (
                <li key={idx} className="grid grid-cols-[1fr_72px_96px_auto] gap-2 items-center text-sm">
                  <Input value={it.name} onChange={(e) => setItems((arr) => arr.map((x, j) => j === idx ? { ...x, name: e.target.value } : x))} className="h-8" />
                  <Input type="number" min={1} value={it.quantity} onChange={(e) => setItems((arr) => arr.map((x, j) => j === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))} className="h-8 tabular-nums" />
                  <select value={it.category} onChange={(e) => setItems((arr) => arr.map((x, j) => j === idx ? { ...x, category: e.target.value } : x))} className="h-8 border border-input bg-background px-2 text-sm">
                    <option>Raw</option><option>Slab</option><option>Sealed</option>
                  </select>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setItems((arr) => arr.filter((_, j) => j !== idx))}><Trash2 className="size-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("shippingCharged", "Shipping the customer paid ($)", { type: "number", step: "0.01", placeholder: "0 = free" })}
          {field("orderTotal", "Order total paid ($)", { type: "number", step: "0.01" })}
        </div>
        <div>
          <Label className="text-xs">Note for packing slip</Label>
          <Textarea value={f.note} onChange={(e) => set("note", e.target.value)} rows={2} className="mt-1" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !items.length} data-testid="button-newship-save">{create.isPending ? "Creating…" : "Create shipment"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
