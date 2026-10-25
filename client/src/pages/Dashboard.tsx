import { useQuery, useMutation } from "@tanstack/react-query";
import type { Inventory, Transaction } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";
import { GoLiveToggle } from "@/components/GoLiveToggle";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CategoryBadge, FranchiseBadge } from "@/components/Badges";
import { formatCurrency, formatNumber, formatPercent, pnlClass, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { roleLabel } from "@shared/roles";
import { RefreshCw } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Package, DollarSign, BarChart3, Boxes } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: boolean;
}

function KpiCard({ label, value, sub, subClass, icon: Icon, accent }: KpiCardProps) {
  return (
    <Card className="relative overflow-hidden">
      {/* gold accent left rail (brighter on featured KPI) */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{
          background: accent
            ? "linear-gradient(to bottom, hsl(var(--brand-gold-bright)), hsl(var(--brand-gold)))"
            : "linear-gradient(to bottom, hsl(var(--brand-gold) / 0.55), hsl(var(--brand-gold) / 0.15))",
        }}
      />
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
            {label}
          </div>
          <Icon className={accent ? "h-4 w-4 text-gold-bright" : "h-4 w-4 text-muted-foreground"} />
        </div>
        <div
          className={`serif tnum text-3xl font-semibold tracking-tight ${accent ? "text-gold-bright" : "text-foreground"}`}
          data-testid={`kpi-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
        >
          {value}
        </div>
        {sub && (
          <div className={`mt-1.5 text-xs tnum ${subClass ?? "text-muted-foreground"}`}>
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: inventory = [], isLoading } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory"],
  });
  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
  });

  const refreshAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pricing/refresh-all", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({
        title: "Prices refreshed",
        description: `Updated ${data?.updated ?? 0} · Failed ${data?.failed ?? 0} · Skipped ${data?.skipped ?? 0}`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Refresh failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  // Only items still in inventory for value calculations
  const active = inventory.filter((i) => i.status === "In Inventory" || i.status === "Listed");
  const totalItems = inventory.reduce((a, i) => a + (i.qty ?? 1), 0);
  const totalActive = active.reduce((a, i) => a + (i.qty ?? 1), 0);
  const totalCost = active.reduce((a, i) => a + (i.totalCost ?? 0), 0);
  const totalMarket = active.reduce((a, i) => a + (i.marketValue ?? 0), 0);
  const unrealized = totalMarket - totalCost;
  const unrealizedPct = totalCost > 0 ? (unrealized / totalCost) * 100 : 0;

  // Per franchise
  const franchises = Array.from(new Set(inventory.map((i) => i.franchise)));
  const franchiseStats = franchises.map((f) => {
    const items = active.filter((i) => i.franchise === f);
    const cost = items.reduce((a, i) => a + (i.totalCost ?? 0), 0);
    const market = items.reduce((a, i) => a + (i.marketValue ?? 0), 0);
    return {
      franchise: f,
      count: items.length,
      cost,
      market,
      gl: market - cost,
      glPct: cost > 0 ? ((market - cost) / cost) * 100 : 0,
    };
  }).sort((a, b) => b.market - a.market);

  // Category breakdown
  const catStats = ["Sealed", "Raw", "Slab"].map((cat) => {
    const items = active.filter((i) => i.category === cat);
    return {
      category: cat,
      count: items.reduce((a, i) => a + (i.qty ?? 1), 0),
      market: items.reduce((a, i) => a + (i.marketValue ?? 0), 0),
    };
  });

  const CAT_COLORS: Record<string, string> = {
    Sealed: "hsl(173 50% 50%)",
    Raw: "hsl(218 15% 55%)",
    Slab: "hsl(41 65% 55%)",
  };

  // Top 5 most valuable
  const top5 = [...active]
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
    .slice(0, 5);

  // Recent activity: last 10 transactions (if any); otherwise show most-recently-sold items
  const recent = transactions.slice(0, 10);
  const soldItems = inventory.filter((i) => i.status === "Sold").slice(0, 5);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-muted rounded" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-28 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-[1500px]">
      <PageHeader
        eyebrow={`Command Center · ${roleLabel(user?.role)} view`}
        title={`Welcome back${user?.username ? `, ${user.username}` : ""}`}
        description={`${totalItems} items across ${franchises.length} franchises. Unrealized G/L ${formatCurrency(unrealized)}.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshAllMutation.mutate()}
            disabled={refreshAllMutation.isPending}
            data-testid="button-refresh-prices-dashboard"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshAllMutation.isPending ? "animate-spin" : ""}`} />
            {refreshAllMutation.isPending ? "Refreshing…" : "Refresh Prices"}
          </Button>
        }
      />

      {/* Go Live one-tap toggle */}
      <GoLiveToggle />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiCard
          label="Total items"
          value={formatNumber(totalItems)}
          sub={`${totalActive} in inventory`}
          icon={Boxes}
        />
        <KpiCard
          label="In inventory"
          value={formatNumber(totalActive)}
          sub={`${inventory.filter(i => i.status === "Sold").length} sold · ${inventory.filter(i => i.status === "Listed").length} listed`}
          icon={Package}
        />
        <KpiCard
          label="Total cost"
          value={formatCurrency(totalCost, { compact: true })}
          sub={`${formatCurrency(totalCost)} exact`}
          icon={DollarSign}
        />
        <KpiCard
          label="Market value"
          value={formatCurrency(totalMarket, { compact: true })}
          sub={`${formatCurrency(totalMarket)} exact`}
          icon={BarChart3}
          accent
        />
        <KpiCard
          label="Unrealized G/L"
          value={formatCurrency(unrealized, { compact: true })}
          sub={formatPercent(unrealizedPct)}
          subClass={pnlClass(unrealized)}
          icon={unrealized >= 0 ? TrendingUp : TrendingDown}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-1">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold mb-0.5">Portfolio mix</div>
                <h2 className="serif text-xl font-medium tracking-tight">Category breakdown</h2>
                <p className="text-xs text-muted-foreground">Market value by type</p>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={catStats}
                    dataKey="market"
                    nameKey="category"
                    innerRadius={48}
                    outerRadius={82}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {catStats.map((c) => (
                      <Cell key={c.category} fill={CAT_COLORS[c.category]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: any) => formatCurrency(Number(value))}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {catStats.map((c) => (
                <div key={c.category} className="text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: CAT_COLORS[c.category] }}
                    />
                    <span className="text-[10px] uppercase tracking-wider font-semibold">
                      {c.category}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-bold tnum">{formatCurrency(c.market, { compact: true })}</div>
                  <div className="text-[10px] text-muted-foreground tnum">
                    {c.count} items
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold mb-0.5">Franchise performance</div>
                <h2 className="serif text-xl font-medium tracking-tight">Franchise value</h2>
                <p className="text-xs text-muted-foreground">Cost vs. market value per franchise</p>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={franchiseStats} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="franchise"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => v.length > 8 ? v.slice(0, 8) + "…" : v}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => "$" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: any) => formatCurrency(Number(v))}
                  />
                  <Bar dataKey="cost" fill="hsl(218 15% 45%)" radius={[3, 3, 0, 0]} name="Cost" />
                  <Bar dataKey="market" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="Market" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Franchise cards */}
      <div className="mb-6">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold mb-0.5">Portfolio detail</div>
            <h2 className="serif text-xl font-medium tracking-tight">By franchise</h2>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {franchiseStats.length} total
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {franchiseStats.map((f) => (
            <Card key={f.franchise} data-testid={`card-franchise-${f.franchise}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <FranchiseBadge franchise={f.franchise} />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground tnum">
                    {f.count} items
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost</div>
                    <div className="tnum text-sm font-semibold">{formatCurrency(f.cost, { compact: true })}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Market</div>
                    <div className="tnum text-sm font-semibold text-primary">{formatCurrency(f.market, { compact: true })}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">G/L</span>
                  <span className={`tnum text-xs font-semibold ${pnlClass(f.gl)}`}>
                    {formatCurrency(f.gl, { compact: true })} · {formatPercent(f.glPct)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Top 5 + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold mb-0.5">Featured holdings</div>
                <h2 className="serif text-xl font-medium tracking-tight">Top 5 by market value</h2>
                <p className="text-xs text-muted-foreground">Most valuable active holdings</p>
              </div>
            </div>
            <div className="divide-y divide-border">
              {top5.map((i, idx) => {
                const gl = (i.marketValue ?? 0) - (i.totalCost ?? 0);
                return (
                  <div
                    key={i.id}
                    className="py-3 flex items-center gap-3"
                    data-testid={`row-top-${i.id}`}
                  >
                    <div className="w-6 text-center text-xs text-muted-foreground tnum">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <CategoryBadge category={i.category} />
                        <span className="text-[10px] text-muted-foreground tnum">{i.id}</span>
                      </div>
                      <div className="text-sm font-medium truncate">{i.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {i.setName} · {i.franchise}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold tnum">{formatCurrency(i.marketValue)}</div>
                      <div className={`text-[10px] tnum ${pnlClass(gl)}`}>
                        {gl >= 0 ? "+" : ""}{formatCurrency(gl)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold mb-0.5">Ledger</div>
                <h2 className="serif text-xl font-medium tracking-tight">Recent activity</h2>
                <p className="text-xs text-muted-foreground">Last 10 transactions</p>
              </div>
            </div>
            {recent.length === 0 ? (
              <div className="py-8 text-center">
                <div className="text-xs text-muted-foreground mb-3">
                  No transactions yet. Recently sold items:
                </div>
                {soldItems.length === 0 && (
                  <div className="text-xs text-muted-foreground">—</div>
                )}
                <div className="divide-y divide-border text-left">
                  {soldItems.map((i) => (
                    <div key={i.id} className="py-2">
                      <div className="text-xs font-medium truncate">{i.name}</div>
                      <div className="text-[10px] text-muted-foreground flex justify-between tnum">
                        <span>{i.setName}</span>
                        <span>{formatCurrency(i.soldPrice)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recent.map((t) => (
                  <div
                    key={t.id}
                    className="py-2.5 flex items-center gap-3"
                    data-testid={`row-activity-${t.id}`}
                  >
                    <div
                      className={`shrink-0 w-10 text-[10px] font-bold text-center uppercase tracking-wider rounded-sm py-1 ${
                        t.type === "Buy"
                          ? "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-400/25 dark:text-emerald-100"
                          : t.type === "Sell"
                          ? "bg-rose-500/20 text-rose-800 dark:bg-rose-400/25 dark:text-rose-100"
                          : "bg-violet-500/20 text-violet-800 dark:bg-violet-400/25 dark:text-violet-100"
                      }`}
                    >
                      {t.type}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{t.itemName ?? t.itemId ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatDate(t.date)} · {t.counterparty ?? "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold tnum">{formatCurrency(t.price)}</div>
                      {t.pnl !== null && t.pnl !== undefined && (
                        <div className={`text-[10px] tnum ${pnlClass(t.pnl)}`}>
                          {t.pnl >= 0 ? "+" : ""}{formatCurrency(t.pnl)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
