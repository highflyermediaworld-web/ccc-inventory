import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { SiInstagram } from "react-icons/si";
import { RefreshCw, Check, X, ExternalLink, KeyRound, Trash2, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { isOwner as isOwnerRole } from "@shared/roles";
import type { CardShow } from "@/data/shows";

type Pending = { postId: string; postUrl: string; postedAt: string; confidence: number; show: CardShow; reason?: string };
type Status = {
  enabled: boolean;
  intervalMin: number;
  account: { id: string; username: string } | null;
  tokenSource: "settings" | "env" | null;
  hasToken: boolean;
  tokenExpiresAt: number | null;
  lastCheckAt: number | null;
  lastError: string | null;
  lastPostAt: string | null;
  postsSeen: number;
  showsPublished: number;
  lastPublished: { name: string; start: string; postUrl: string; at: number }[];
  pending: Pending[];
  running: boolean;
  nextCheckAt: number | null;
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

export function InstagramShowsCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isOwner = isOwnerRole(user?.role);
  const [token, setToken] = useState("");
  const [showTokenBox, setShowTokenBox] = useState(false);

  const q = useQuery<Status>({
    queryKey: ["/api/admin/instagram/status"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/instagram/status")).json(),
    refetchInterval: 60_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/instagram/status"] });
  const invalidateShows = () => queryClient.invalidateQueries({ queryKey: ["/api/shop/shows"] });

  const check = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/instagram/check", {})).json() as Promise<Status>,
    onSuccess: (st) => {
      refresh(); invalidateShows();
      toast({ title: st.lastError ? "Instagram check had a problem" : "Instagram checked", description: st.lastError ?? `${st.pending.length} waiting for review · ${st.showsPublished} published so far`, variant: st.lastError ? "destructive" : undefined });
    },
    onError: (err) => toast({ title: "Check failed", description: cleanErr(err), variant: "destructive" }),
  });
  const saveToken = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/instagram/token", { token })).json(),
    onSuccess: (r: any) => { setToken(""); setShowTokenBox(false); refresh(); toast({ title: "Instagram connected", description: `Reading posts from @${r.account?.username || "your account"}. First check is running.` }); },
    onError: (err) => toast({ title: "Token rejected", description: cleanErr(err), variant: "destructive" }),
  });
  const removeToken = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/admin/instagram/token"),
    onSuccess: () => { refresh(); toast({ title: "Instagram disconnected" }); },
  });
  const resolve = useMutation({
    mutationFn: async (v: { postId: string; start: string; action: "add" | "dismiss" }) => (await apiRequest("POST", "/api/admin/instagram/pending", v)).json(),
    onSuccess: (_d, v) => { refresh(); invalidateShows(); toast({ title: v.action === "add" ? "Show published" : "Suggestion dismissed" }); },
    onError: (err) => toast({ title: "Couldn't update", description: cleanErr(err), variant: "destructive" }),
  });

  const st = q.data;
  const connected = !!st?.hasToken && !!st?.account;

  return (
    <Card data-testid="card-instagram-shows">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <SiInstagram className="size-4 text-gold" /> Instagram show posts
          <span className={`ml-auto text-[10px] uppercase tracking-wider font-semibold ${connected ? "text-emerald-500" : "text-muted-foreground"}`} data-testid="text-ig-status">
            {q.isLoading ? "…" : connected ? "Connected" : st?.hasToken ? "Token set" : "Not connected"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-3">
        <p>
          Every {st?.intervalMin ?? 30} minutes the shop reads the newest posts on
          {st?.account ? <> <b className="text-foreground">@{st.account.username}</b></> : " your Instagram"} and adds any show announcements to Upcoming Shows automatically. Posts it isn't sure about wait here for a yes or no.
        </p>

        {st && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span>Last check</span><b className="text-foreground text-right" data-testid="text-ig-last-check">{st.running ? "running…" : ago(st.lastCheckAt)}</b>
            <span>Posts read</span><b className="text-foreground text-right">{st.postsSeen}</b>
            <span>Shows published</span><b className="text-foreground text-right">{st.showsPublished}</b>
            {st.lastPostAt && (<><span>Newest post</span><b className="text-foreground text-right">{st.lastPostAt.slice(0, 10)}</b></>)}
          </div>
        )}

        {st?.lastError && (
          <div className="flex items-start gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground" data-testid="text-ig-error">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-destructive" /> <span>{st.lastError}</span>
          </div>
        )}

        {st && st.pending.length > 0 && (
          <div className="space-y-2" data-testid="list-ig-pending">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gold">Needs a yes or no</div>
            {st.pending.map((p) => (
              <div key={`${p.postId}-${p.show.start}`} className="border border-border p-3 space-y-1" data-testid={`ig-pending-${p.postId}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground truncate">{p.show.name}</div>
                    <div className="text-xs">{p.show.start}{p.show.end ? ` – ${p.show.end}` : ""} · {[p.show.venue, p.show.city].filter(Boolean).join(", ")}</div>
                    {p.reason && <div className="text-[11px] italic">{p.reason} · {Math.round(p.confidence * 100)}% sure</div>}
                  </div>
                  <a href={p.postUrl} target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 text-foreground shrink-0">Post <ExternalLink className="size-3" /></a>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => resolve.mutate({ postId: p.postId, start: p.show.start, action: "add" })} disabled={resolve.isPending} data-testid={`button-ig-add-${p.postId}`}><Check className="size-3.5 mr-1" /> Add to shows</Button>
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ postId: p.postId, start: p.show.start, action: "dismiss" })} disabled={resolve.isPending} data-testid={`button-ig-dismiss-${p.postId}`}><X className="size-3.5 mr-1" /> Not a show</Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {st && st.lastPublished.length > 0 && (
          <div className="text-xs">
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1">Recently added from Instagram</div>
            <ul className="space-y-0.5">
              {st.lastPublished.slice(0, 4).map((l, i) => (
                <li key={`${l.postUrl}-${i}`} className="flex justify-between gap-2"><span className="truncate text-foreground">{l.name}</span><span className="shrink-0">{l.start}</span></li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => check.mutate()} disabled={check.isPending || !st?.hasToken} data-testid="button-ig-check-now">
            <RefreshCw className={`size-3.5 mr-1 ${check.isPending ? "animate-spin" : ""}`} /> Check now
          </Button>
          {isOwner && (
            <Button size="sm" variant="outline" onClick={() => setShowTokenBox((v) => !v)} data-testid="button-ig-token-toggle">
              <KeyRound className="size-3.5 mr-1" /> {st?.hasToken ? "Replace token" : "Connect Instagram"}
            </Button>
          )}
          {isOwner && st?.tokenSource === "settings" && (
            <Button size="sm" variant="ghost" onClick={() => removeToken.mutate()} disabled={removeToken.isPending} data-testid="button-ig-disconnect">
              <Trash2 className="size-3.5 mr-1" /> Disconnect
            </Button>
          )}
        </div>

        {isOwner && showTokenBox && (
          <div className="space-y-2 border border-border p-3" data-testid="box-ig-token">
            <Label htmlFor="ig-token" className="text-xs">Instagram access token</Label>
            <Input id="ig-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the long-lived token from Meta for Developers" autoComplete="off" data-testid="input-ig-token" />
            <p className="text-[11px] leading-relaxed">
              Meta for Developers → your app → <b>Instagram</b> → <b>API setup with Instagram business login</b> → add @cpulls.cards → <b>Generate token</b>. The account must be a Professional (Business or Creator) account. Tokens last 60 days; the shop renews them for you.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveToken.mutate()} disabled={saveToken.isPending || token.trim().length < 20} data-testid="button-ig-save-token">{saveToken.isPending ? "Checking…" : "Save & connect"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowTokenBox(false); setToken(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
