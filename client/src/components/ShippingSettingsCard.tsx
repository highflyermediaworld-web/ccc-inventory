import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Truck, Save } from "lucide-react";
import { apiRequest, queryClient, API_BASE } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import type { ShippingSettings } from "@shared/shipping";

type Resp = { settings: ShippingSettings; defaults: ShippingSettings; service: string };
type Quote =
  | { ok: true; zone: number; miles: number; ounces: number; tier: string; postage: number; handling: number; amount: number; free: boolean; destZip: string; rates: string }
  | { ok: false; reason: string };

function cleanErr(err: any) {
  const m = String(err?.message ?? err ?? "");
  return m.replace(/^\d{3}:\s*/, "").replace(/^\{.*"message":"([^"]+)".*\}$/, "$1");
}

export function ShippingSettingsCard() {
  const { toast } = useToast();
  const q = useQuery<Resp>({
    queryKey: ["/api/admin/shipping"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/shipping")).json(),
  });
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  useEffect(() => {
    if (q.data) {
      const s = q.data.settings;
      setForm({
        enabled: s.enabled,
        originZip: s.originZip,
        handlingFee: String(s.handlingFee),
        freeOver: s.freeOver == null ? "" : String(s.freeOver),
        ozRaw: String(s.ozRaw),
        ozSlab: String(s.ozSlab),
        ozSealed: String(s.ozSealed),
        ozPackaging: String(s.ozPackaging),
      });
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/admin/shipping", { settings: form })).json(),
    onSuccess: () => {
      toast({ title: "Shipping settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/shipping"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop/shipping/quote"] });
    },
    onError: (err: any) => toast({ title: "Couldn't save", description: cleanErr(err), variant: "destructive" }),
  });

  // Preview: quote a sample parcel to a ZIP using the saved settings.
  const [testZip, setTestZip] = useState("10001");
  const [testRaw, setTestRaw] = useState("1");
  const [testSlab, setTestSlab] = useState("0");
  const [preview, setPreview] = useState<Quote | null>(null);
  async function runPreview() {
    setPreview(null);
    // Synthetic items are resolved server-side by id; use the sample-only
    // route parameters instead: the quote endpoint accepts repeated ids, so
    // we pass "category" pseudo-ids it will ignore and rely on counts here.
    const r = await fetch(`${API_BASE}/api/shop/shipping/quote?zip=${encodeURIComponent(testZip)}&sample=${encodeURIComponent(`raw:${testRaw},slab:${testSlab}`)}`, { credentials: "include" });
    const d = await r.json().catch(() => null);
    if (d?.quote) setPreview(d.quote);
  }

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: string, label: string, step = "0.1", hint?: string) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} min={0} value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} className="mt-1 tabular-nums" data-testid={`input-ship-${k}`} />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <Card data-testid="card-shipping-settings">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4" /> Shipping — {q.data?.service ?? "USPS Ground Advantage"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Customers pay USPS's current retail postage for their distance zone and the order's weight, plus your handling fee. Shipping is added before tax and isn't taxed.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center justify-between border border-border p-3">
          <div>
            <div className="text-sm font-semibold">Charge shipping at checkout</div>
            <div className="text-[11px] text-muted-foreground">Off = shipping shows as free and no ZIP is required.</div>
          </div>
          <Switch checked={form.enabled !== false} onCheckedChange={(v) => set("enabled", v)} data-testid="switch-ship-enabled" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 max-w-3xl">
          <div>
            <Label className="text-xs">Ship-from ZIP</Label>
            <Input inputMode="numeric" maxLength={5} value={String(form.originZip ?? "")} onChange={(e) => set("originZip", e.target.value.replace(/\D/g, "").slice(0, 5))} className="mt-1 tabular-nums" data-testid="input-ship-origin" />
            <p className="mt-1 text-[11px] text-muted-foreground">Where parcels are dropped off; sets the distance zone.</p>
          </div>
          {num("handlingFee", "Handling fee ($)", "0.25", "Added to every paid shipment. 0 = postage only.")}
          <div>
            <Label className="text-xs">Free shipping over ($)</Label>
            <Input type="number" step="1" min={0} value={String(form.freeOver ?? "")} onChange={(e) => set("freeOver", e.target.value)} placeholder="Never" className="mt-1 tabular-nums" data-testid="input-ship-freeover" />
            <p className="mt-1 text-[11px] text-muted-foreground">Leave blank to always charge.</p>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Weight estimates (ounces)</div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 max-w-3xl">
            {num("ozRaw", "Per raw card", "0.1", "Sleeve + toploader")}
            {num("ozSlab", "Per slab", "0.1", "PSA / CGC / BGS")}
            {num("ozSealed", "Per sealed item", "1", "Raise for ETBs and boxes")}
            {num("ozPackaging", "Packaging", "0.5", "Mailer + cardboard")}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">USPS tiers: up to 4 oz, 8 oz, 12 oz, 15.999 oz, then whole pounds. Zones 1–8 by distance from the ship-from ZIP.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !q.data} data-testid="button-ship-save">
            <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save shipping settings"}
          </Button>
          {q.data && (
            <span className="text-[11px] text-muted-foreground">Defaults: ZIP {q.data.defaults.originZip}, {q.data.defaults.ozRaw} oz/card, {q.data.defaults.ozSlab} oz/slab, {q.data.defaults.ozPackaging} oz packaging.</span>
          )}
        </div>

        <div className="border border-border p-3">
          <div className="text-sm font-semibold mb-2">Preview a quote (saved settings)</div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end max-w-2xl">
            <div>
              <Label className="text-xs">Customer ZIP</Label>
              <Input inputMode="numeric" maxLength={5} value={testZip} onChange={(e) => setTestZip(e.target.value.replace(/\D/g, "").slice(0, 5))} className="mt-1 tabular-nums" data-testid="input-ship-test-zip" />
            </div>
            <div>
              <Label className="text-xs">Raw cards</Label>
              <Input type="number" min={0} value={testRaw} onChange={(e) => setTestRaw(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label className="text-xs">Slabs</Label>
              <Input type="number" min={0} value={testSlab} onChange={(e) => setTestSlab(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <Button variant="secondary" onClick={runPreview} data-testid="button-ship-preview">Quote</Button>
          </div>
          {preview && (
            <p className="mt-2 text-sm" data-testid="text-ship-preview">
              {preview.ok
                ? <>Zone {preview.zone} ({preview.miles} mi) · {preview.ounces} oz → {preview.tier} parcel · postage {formatCurrency(preview.postage)}{preview.handling > 0 ? ` + ${formatCurrency(preview.handling)} handling` : ""} → <b>{preview.free ? "Free" : formatCurrency(preview.amount)}</b> <span className="text-muted-foreground">· {preview.rates}</span></>
                : <span className="text-red-600">{preview.reason}</span>}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
