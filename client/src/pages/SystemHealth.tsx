import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeStatus } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { Activity, Database, ScanLine, RefreshCw, Wifi, KeyRound, Server, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

type Health = {
  now: string;
  uptimeSec: number;
  node: string;
  env: string;
  commit: string | null;
  database: { ok: boolean; driver: string; users: number; inventory: number; requests: number; owners?: number; it?: number; error?: string };
  scanner: { provider: string | null; model: string | null; ok: boolean; error: string | null; status: number | null } | null;
  pricing: { enabled: boolean; intervalMin: number; lastRunAt: number | null; lastRunDurationMs: number | null; lastRunUpdated: number; lastRunFailed: number; lastRunTotal: number; nextRunAt: number | null; running: boolean; error?: string } | null;
  keys: { gemini: boolean; openai: boolean; anthropic: boolean; inviteCode: boolean; breakGlassLogin: boolean };
  responseMs: number;
};

type Level = "ok" | "warn" | "down";

function Dot({ level }: { level: Level }) {
  const Icon = level === "ok" ? CheckCircle2 : level === "warn" ? AlertTriangle : XCircle;
  return (
    <Icon
      className={cn("size-5 shrink-0", level === "ok" ? "text-emerald-500" : level === "warn" ? "text-amber-500" : "text-red-500")}
      aria-label={level === "ok" ? "Healthy" : level === "warn" ? "Needs attention" : "Down"}
    />
  );
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function ago(ts: number | null) {
  if (!ts) return "never";
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
function inMins(ts: number | null) {
  if (!ts) return "—";
  const m = Math.round((ts - Date.now()) / 60000);
  return m <= 0 ? "due now" : `in ${m} min`;
}

export default function SystemHealth() {
  const { toast } = useToast();
  const rt = useRealtimeStatus();
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<Health>({
    queryKey: ["/api/system/health"],
    queryFn: async () => (await apiRequest("GET", "/api/system/health")).json(),
    refetchInterval: 60_000,
  });

  const runPricing = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/pricing/auto/run"),
    onSuccess: () => { toast({ title: "Price refresh started" }); setTimeout(() => refetch(), 2500); },
    onError: (err: any) => toast({ title: "Couldn't start refresh", description: err?.message ?? "Try again", variant: "destructive" }),
  });

  const dbLevel: Level = !data ? "warn" : data.database.ok ? "ok" : "down";
  const pending = !data;
  const scanLevel: Level = !data?.scanner ? "warn" : data.scanner.ok ? "ok" : data.scanner.provider ? "down" : "warn";
  const priceLevel: Level = !data?.pricing ? "warn" : !data.pricing.enabled ? "warn" : data.pricing.lastRunFailed > 0 && data.pricing.lastRunUpdated === 0 ? "down" : "ok";
  const rtLevel: Level = rt === "open" ? "ok" : rt === "connecting" ? "warn" : "down";
  const overall: Level = pending ? "warn" : [dbLevel, scanLevel, priceLevel, rtLevel].includes("down") ? "down" : [dbLevel, scanLevel, priceLevel, rtLevel].includes("warn") ? "warn" : "ok";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="System health"
        description="Live status of the database, card scanner, TCGplayer price sync and realtime link."
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-health">
            <RefreshCw className={cn("size-4 mr-2", isFetching && "animate-spin")} /> Refresh
          </Button>
        }
      />

      <Card className={cn("border-l-4", overall === "ok" ? "border-l-emerald-500" : overall === "warn" ? "border-l-amber-500" : "border-l-red-500")} data-testid="card-overall">
        <CardContent className="py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Dot level={overall} />
            <span data-testid="text-overall">{isLoading ? "Checking…" : overall === "ok" ? "All systems normal" : overall === "warn" ? "Running, with warnings" : "Something needs attention"}</span>
          </div>
          {data && (
            <div className="text-sm text-muted-foreground flex flex-wrap gap-x-5 gap-y-1">
              <span className="inline-flex items-center gap-1.5"><Server className="size-3.5" /> up {fmtUptime(data.uptimeSec)}</span>
              <span>Node {data.node}</span>
              <span>{data.env}{data.commit ? ` · ${data.commit}` : ""}</span>
              <span>API {data.responseMs} ms</span>
              <span>checked {dataUpdatedAt ? ago(dataUpdatedAt) : "—"}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="card-database">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><Database className="size-4 text-gold" /> Database</CardTitle>
            <Dot level={dbLevel} />
          </CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <Row k="Driver" v={data?.database.driver === "turso" ? "Turso (hosted SQLite)" : "Local SQLite"} />
            <Row k="Inventory items" v={data?.database.inventory} />
            <Row k="Customer requests" v={data?.database.requests} />
            <Row k="Logins" v={data ? `${data.database.users} (${data.database.owners ?? 0} Owner · ${data.database.it ?? 0} IT)` : undefined} />
            {data?.database.error && <p className="text-red-500 text-xs pt-1">{data.database.error}</p>}
          </CardContent>
        </Card>

        <Card data-testid="card-scanner">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><ScanLine className="size-4 text-gold" /> Card scanner</CardTitle>
            <Dot level={scanLevel} />
          </CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <Row k="Provider" v={!data ? undefined : data.scanner?.provider ? data.scanner.provider[0].toUpperCase() + data.scanner.provider.slice(1) : "none configured"} />
            <Row k="Model" v={!data ? undefined : data.scanner?.model ?? "—"} />
            <Row k="Status" v={data?.scanner ? (data.scanner.ok ? "Responding" : `Error${data.scanner.status ? ` ${data.scanner.status}` : ""}`) : undefined} />
            {data?.scanner?.error && <p className="text-red-500 text-xs pt-1 break-words">{data.scanner.error}</p>}
            {data && !data.scanner?.provider && <p className="text-amber-600 text-xs pt-1">Add GEMINI_API_KEY (or OPENAI_API_KEY) on the server to enable scanning.</p>}
          </CardContent>
        </Card>

        <Card data-testid="card-pricing">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><Activity className="size-4 text-gold" /> TCGplayer price sync</CardTitle>
            <Dot level={priceLevel} />
          </CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <Row k="Background refresh" v={data?.pricing ? (data.pricing.enabled ? `every ${data.pricing.intervalMin} min` : "disabled") : undefined} />
            <Row k="Last run" v={data?.pricing ? `${ago(data.pricing.lastRunAt)}${data.pricing.lastRunAt ? ` · ${data.pricing.lastRunUpdated}/${data.pricing.lastRunTotal} updated${data.pricing.lastRunFailed ? `, ${data.pricing.lastRunFailed} failed` : ""}` : ""}` : undefined} />
            <Row k="Next run" v={data?.pricing ? (data.pricing.running ? "running now" : inMins(data.pricing.nextRunAt)) : undefined} />
            <p className="text-xs text-muted-foreground pt-1">Storefront listings also pull live TCGplayer prices while customers browse.</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => runPricing.mutate()} disabled={runPricing.isPending || data?.pricing?.running} data-testid="button-run-pricing">
              <RefreshCw className="size-4 mr-1.5" /> Refresh prices now
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-realtime">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><Wifi className="size-4 text-gold" /> Realtime link</CardTitle>
            <Dot level={rtLevel} />
          </CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <Row k="This browser" v={rt === "open" ? "Connected" : rt === "connecting" ? "Reconnecting…" : "Disconnected"} />
            <p className="text-xs text-muted-foreground pt-1">Pushes inventory, request and show changes to every open admin tab and the storefront without a reload.</p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2" data-testid="card-keys">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><KeyRound className="size-4 text-gold" /> Server configuration</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-sm">
            <Flag on={data ? data.keys.gemini : undefined} label="Gemini key" />
            <Flag on={data ? data.keys.openai : undefined} label="OpenAI key" optional />
            <Flag on={data ? data.keys.anthropic : undefined} label="Anthropic key" optional />
            <Flag on={data ? data.keys.inviteCode : undefined} label="Sign-up invite code" optional />
            <Flag on={data ? data.keys.breakGlassLogin : undefined} label="Env break-glass login" optional invert />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number | undefined }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground font-medium text-right tabular-nums">{v === undefined ? "…" : v}</span>
    </div>
  );
}

function Flag({ on, label, optional, invert }: { on: boolean | undefined; label: string; optional?: boolean; invert?: boolean }) {
  // invert: being ON is the thing worth noticing (e.g. an env login that bypasses the users table)
  const level: Level = on === undefined ? "warn" : on ? (invert ? "warn" : "ok") : optional ? "ok" : "warn";
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <Dot level={level} />
      <div className="min-w-0">
        <div className="font-medium text-foreground truncate">{label}</div>
        <div className="text-xs text-muted-foreground">{on === undefined ? "…" : on ? "set" : optional ? "not set" : "missing"}</div>
      </div>
    </div>
  );
}
