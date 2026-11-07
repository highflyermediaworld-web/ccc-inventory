import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RefreshCw, KeyRound, Trash2, AlertTriangle, Award, ExternalLink } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { isOwner as isOwnerRole } from "@shared/roles";

type Status = {
  configured: boolean;
  keySource: "settings" | "env" | null;
  keyHint: string | null;
  provider: string;
  maxAgeHours: number;
  creditsPerLookup: number;
  gradedCount: number;
  pricedCount: number;
  staleCount: number;
  lastRunAt: number | null;
  lastRunChecked: number;
  lastRunPriced: number;
  lastRunUnmatched: number;
  lastError: string | null;
  creditsRemaining: number | null;
  creditsUsed: number;
};

const ago = (sec: number | null) => {
  if (!sec) return "never";
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
};

function cleanErr(err: any) {
  const m = String(err?.message ?? err ?? "");
  return m.replace(/^\d{3}:\s*/, "").replace(/^\{.*"message":"([^"]+)".*\}$/, "$1");
}

export function AltPricingCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isOwner = isOwnerRole(user?.role);
  const [key, setKey] = useState("");
  const [showKeyBox, setShowKeyBox] = useState(false);

  const q = useQuery<Status>({
    queryKey: ["/api/admin/alt/status"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/alt/status")).json(),
    refetchInterval: 60_000,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/alt/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
  };

  const runNow = useMutation({
    mutationFn: async (force: boolean) => (await apiRequest("POST", "/api/admin/alt/refresh", { force })).json() as Promise<Status>,
    onSuccess: (st) => {
      refresh();
      toast({
        title: st.lastError ? "Alt refresh had a problem" : "Slabs repriced from Alt",
        description: st.lastError ?? `${st.lastRunPriced} priced · ${st.lastRunUnmatched} without a match · ${st.lastRunChecked} checked`,
        variant: st.lastError ? "destructive" : undefined,
      });
    },
    onError: (err) => toast({ title: "Refresh failed", description: cleanErr(err), variant: "destructive" }),
  });
  const saveKey = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/alt/key", { key })).json(),
    onSuccess: (r: any) => {
      setKey(""); setShowKeyBox(false); refresh();
      toast({ title: "Alt pricing connected", description: r?.credits != null ? `${r.credits} ReefAPI credits available. First slab refresh is running.` : "First slab refresh is running." });
    },
    onError: (err) => toast({ title: "Key rejected", description: cleanErr(err), variant: "destructive" }),
  });
  const removeKey = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/admin/alt/key"),
    onSuccess: () => { refresh(); toast({ title: "Alt pricing disconnected" }); },
  });

  const st = q.data;
  const connected = !!st?.configured;
  const perDay = st ? st.gradedCount * st.creditsPerLookup : 0;

  return (
    <Card data-testid="card-alt-pricing">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Award className="size-4 text-gold" /> Slab pricing from Alt
          <span className={`ml-auto text-[10px] uppercase tracking-wider font-semibold ${connected ? "text-emerald-500" : "text-muted-foreground"}`} data-testid="text-alt-status">
            {q.isLoading ? "…" : connected ? "Connected" : "Not connected"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-3">
        <p>
          Graded cards (PSA, CGC, BGS…) are priced from <b className="text-foreground">Alt</b>'s per-grade value — built from real slab sales on eBay, Fanatics, Goldin and Alt — instead of TCGplayer's raw-card market. Each slab is rechecked once every {st?.maxAgeHours ?? 24} hours; the ↻ on an inventory row rechecks it right away.
        </p>

        {st && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span>Graded cards for sale</span><b className="text-foreground text-right" data-testid="text-alt-graded">{st.gradedCount}</b>
            <span>Priced from Alt</span><b className="text-foreground text-right" data-testid="text-alt-priced">{st.pricedCount}</b>
            <span>Due for a recheck</span><b className="text-foreground text-right">{st.staleCount}</b>
            <span>Last run</span><b className="text-foreground text-right" data-testid="text-alt-last-run">{ago(st.lastRunAt)}{st.lastRunAt ? ` · ${st.lastRunPriced} priced` : ""}</b>
            {st.creditsRemaining != null && (<><span>ReefAPI credits left</span><b className="text-foreground text-right" data-testid="text-alt-credits">{st.creditsRemaining.toLocaleString()}</b></>)}
            <span>Credits per full pass</span><b className="text-foreground text-right">{perDay} <span className="font-normal">({st.creditsPerLookup} per slab)</span></b>
          </div>
        )}

        {st?.lastError && (
          <div className="flex items-start gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground" data-testid="text-alt-error">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-destructive" /> <span>{st.lastError}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => runNow.mutate(false)} disabled={runNow.isPending || !connected} data-testid="button-alt-run">
            <RefreshCw className={`size-3.5 mr-1 ${runNow.isPending ? "animate-spin" : ""}`} /> Recheck due slabs
          </Button>
          <Button size="sm" variant="ghost" onClick={() => runNow.mutate(true)} disabled={runNow.isPending || !connected} data-testid="button-alt-run-all" title={`Rechecks every graded card now (${perDay} credits)`}>
            Recheck all
          </Button>
          {isOwner && (
            <Button size="sm" variant="outline" onClick={() => setShowKeyBox((v) => !v)} data-testid="button-alt-key-toggle">
              <KeyRound className="size-3.5 mr-1" /> {connected ? "Replace key" : "Connect Alt pricing"}
            </Button>
          )}
          {isOwner && st?.keySource === "settings" && (
            <Button size="sm" variant="ghost" onClick={() => removeKey.mutate()} disabled={removeKey.isPending} data-testid="button-alt-disconnect">
              <Trash2 className="size-3.5 mr-1" /> Disconnect
            </Button>
          )}
        </div>

        {isOwner && showKeyBox && (
          <div className="space-y-2 border border-border p-3" data-testid="box-alt-key">
            <Label htmlFor="alt-key" className="text-xs">ReefAPI key</Label>
            <Input id="alt-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key from your ReefAPI dashboard" autoComplete="off" data-testid="input-alt-key" />
            <p className="text-[11px] leading-relaxed">
              Alt has no public API, so the shop reads it through ReefAPI. Sign up free at{" "}
              <a href="https://reefapi.com/signup" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground underline underline-offset-2">reefapi.com <ExternalLink className="size-3" /></a>
              {" "}(1,000 credits, no card needed), copy the API key and paste it here. Each slab lookup uses {st?.creditsPerLookup ?? 3} credits; the free credits never expire.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveKey.mutate()} disabled={saveKey.isPending || key.trim().length < 16} data-testid="button-alt-save-key">{saveKey.isPending ? "Checking…" : "Save & connect"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowKeyBox(false); setKey(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
