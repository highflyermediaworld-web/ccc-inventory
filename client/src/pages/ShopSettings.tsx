import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { SHOWS as DEFAULT_SHOWS, splitShows, type CardShow } from "@/data/shows";
import { Tent, Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, Save, ExternalLink, Calculator, Radio, BookUser, MessageSquare } from "lucide-react";
import { Link } from "wouter";

type ShowsResponse = { source: "default" | "settings"; shows: CardShow[] | null };

const EMPTY: CardShow = { name: "", start: "", end: "", hours: "", venue: "", city: "", host: "", url: "", note: "" };

export default function ShopSettings() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ShowsResponse>({
    queryKey: ["/api/shop/shows"],
    queryFn: async () => (await apiRequest("GET", "/api/shop/shows")).json(),
  });

  const [rows, setRows] = useState<CardShow[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!data || dirty) return;
    setRows((data.shows ?? DEFAULT_SHOWS).map((s) => ({ ...EMPTY, ...s })));
  }, [data, dirty]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/shop/shows"] });

  const save = useMutation({
    mutationFn: async (shows: CardShow[]) => (await apiRequest("PUT", "/api/admin/shop/shows", { shows })).json(),
    onSuccess: (r: any) => {
      toast({ title: "Shows published", description: `${r.count} show${r.count === 1 ? "" : "s"} now live on the storefront.` });
      setDirty(false);
      invalidate();
    },
    onError: (err: any) => toast({ title: "Couldn't save shows", description: cleanErr(err), variant: "destructive" }),
  });
  const reset = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/admin/shop/shows"),
    onSuccess: () => {
      toast({ title: "Back to the built-in list" });
      setDirty(false);
      invalidate();
    },
    onError: (err: any) => toast({ title: "Couldn't reset", description: cleanErr(err), variant: "destructive" }),
  });

  function update(i: number, patch: Partial<CardShow>) {
    setRows((r) => r.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setDirty(true);
  }
  function move(i: number, dir: -1 | 1) {
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
    setDirty(true);
  }
  function remove(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
    setDirty(true);
  }
  function add() {
    setRows((r) => [{ ...EMPTY }, ...r]);
    setDirty(true);
  }

  const { upcoming, past } = splitShows(undefined, rows.filter((s) => s.start));
  const invalid = rows.find((s) => !s.name.trim() || !s.city.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(s.start));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Storefront"
        title="Shop settings"
        description="What customers see on the public shop. Changes publish instantly."
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="#/" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" data-testid="button-open-shop"><ExternalLink className="size-4 mr-2" /> Open shop</Button>
            </a>
            <Button onClick={() => save.mutate(rows)} disabled={save.isPending || !dirty || !!invalid} data-testid="button-save-shows">
              <Save className="size-4 mr-2" /> {save.isPending ? "Publishing…" : "Publish shows"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Calculator className="size-4 text-gold" /> Sell &amp; Trade offers</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>Cash offer</span><b className="text-foreground tabular-nums">70% of TCGplayer market</b></div>
            <div className="flex justify-between"><span>Trade credit</span><b className="text-foreground tabular-nums">80% of TCGplayer market</b></div>
            <p className="pt-1 text-xs">Fixed rates shown on the storefront calculator and FAQ.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Radio className="size-4 text-gold" /> Live banner</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Toggle the storefront Live banner and set the stream link.</p>
            <Link href="/admin/live" className="mt-2 inline-block text-primary font-semibold hover:underline" data-testid="link-live-settings">Open Live stream →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><BookUser className="size-4 text-gold" /> About page</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Edit the story, quick facts and photo at #/about.</p>
            <Link href="/admin/about-page" className="mt-2 inline-block text-primary font-semibold hover:underline" data-testid="link-about-settings">Open About page editor →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="size-4 text-gold" /> Ask CPulls chat</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Storefront assistant answers from the FAQ, About story, shows and live inventory. Uses the same AI key as the scanner.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Tent className="size-4 text-gold" /> Shows on the shop</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>Upcoming</span><b className="text-foreground tabular-nums" data-testid="text-upcoming-count">{upcoming.length}</b></div>
            <div className="flex justify-between"><span>Where we've been</span><b className="text-foreground tabular-nums">{past.length}</b></div>
            <p className="pt-1 text-xs">Source: {data?.source === "settings" ? "published from this page" : "built-in list"}{dirty ? " · unsaved edits" : ""}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">Upcoming shows</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Past dates move to "Where we've been" automatically. Dates are YYYY-MM-DD.</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => reset.mutate()} disabled={reset.isPending || data?.source !== "settings"} title="Discard the published list and show the built-in one" data-testid="button-reset-shows">
              <RotateCcw className="size-4 mr-1.5" /> Use built-in list
            </Button>
            <Button size="sm" onClick={add} data-testid="button-add-show"><Plus className="size-4 mr-1.5" /> Add show</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading shows…</p>}
          {!isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">No shows yet — add one above.</p>}
          {rows.map((s, i) => {
            const bad = !s.name.trim() || !s.city.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(s.start);
            const isPast = s.start && past.includes(s);
            return (
              <div key={i} className={"rounded-md border p-3 sm:p-4 " + (bad ? "border-destructive/50" : isPast ? "border-border opacity-80" : "border-border")} data-testid={`show-row-${i}`}>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
                    {isPast ? "Past" : "Upcoming"}{bad ? " · needs name, city and start date" : ""}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"><ArrowDown className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => remove(i)} aria-label="Remove show" data-testid={`button-remove-show-${i}`}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Show name" className="sm:col-span-2"><Input value={s.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="East Bay Card Show" data-testid={`input-show-name-${i}`} /></Field>
                  <Field label="Start"><Input type="date" value={s.start} onChange={(e) => update(i, { start: e.target.value })} data-testid={`input-show-start-${i}`} /></Field>
                  <Field label="End (multi-day)"><Input type="date" value={s.end ?? ""} onChange={(e) => update(i, { end: e.target.value })} /></Field>
                  <Field label="Venue" className="sm:col-span-2"><Input value={s.venue ?? ""} onChange={(e) => update(i, { venue: e.target.value })} placeholder="Santa Clara Convention Center" /></Field>
                  <Field label="City"><Input value={s.city} onChange={(e) => update(i, { city: e.target.value })} placeholder="Santa Clara, CA" data-testid={`input-show-city-${i}`} /></Field>
                  <Field label="Hours"><Input value={s.hours ?? ""} onChange={(e) => update(i, { hours: e.target.value })} placeholder="Sat 11 AM – 5 PM" /></Field>
                  <Field label="Host Instagram (no @)"><Input value={s.host ?? ""} onChange={(e) => update(i, { host: e.target.value.replace(/^@/, "") })} placeholder="hypeconco" /></Field>
                  <Field label="Tickets / info link" className="sm:col-span-2"><Input value={s.url ?? ""} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://" /></Field>
                  <Field label="Note"><Input value={s.note ?? ""} onChange={(e) => update(i, { note: e.target.value })} placeholder="Free entry · bring your binder" /></Field>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={"space-y-1 " + className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function cleanErr(err: any): string {
  const msg = (err?.message ?? "").replace(/^\d+:\s*/, "");
  try { return JSON.parse(msg).message ?? msg; } catch { return msg || "Try again"; }
}
