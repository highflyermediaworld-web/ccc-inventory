import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Trade } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge, CategoryBadge, FranchiseBadge } from "@/components/Badges";
import { formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Check, X } from "lucide-react";

export default function TradesPage() {
  const { data: trades = [] } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });

  const incoming = useMemo(
    () => trades.filter((t) => t.direction === "Incoming" && t.status === "Pending"),
    [trades]
  );
  const outgoing = useMemo(
    () => trades.filter((t) => t.direction === "Outgoing"),
    [trades]
  );
  const history = useMemo(
    () =>
      trades.filter(
        (t) => t.status === "Accepted" || t.status === "Declined"
      ),
    [trades]
  );

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <PageHeader
        eyebrow="Negotiations"
        title="Trades"
        description={`${incoming.length} pending incoming · ${outgoing.filter(t => t.status === "Pending").length} pending outgoing · ${history.length} completed`}
      />

      <Tabs defaultValue="incoming" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="incoming" data-testid="tab-incoming">
            Incoming ({incoming.length})
          </TabsTrigger>
          <TabsTrigger value="outgoing" data-testid="tab-outgoing">
            Outgoing ({outgoing.length})
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            History ({history.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="incoming">
          <IncomingTrades trades={incoming} />
        </TabsContent>
        <TabsContent value="outgoing">
          <OutgoingTrades trades={outgoing} />
        </TabsContent>
        <TabsContent value="history">
          <TradeHistory trades={history} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SnapshotCard({ title, snap }: { title: string; snap: any }) {
  if (!snap) return (
    <div className="border border-dashed border-border rounded-md p-3 text-xs text-muted-foreground">
      {title}: —
    </div>
  );
  return (
    <div className="border border-border rounded-md p-3 bg-accent/20">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {title}
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        <FranchiseBadge franchise={snap.franchise} />
        <CategoryBadge category={snap.category} />
      </div>
      <div className="text-sm font-semibold truncate">{snap.name}</div>
      <div className="text-xs text-muted-foreground truncate">
        {snap.setName} · {snap.condition ?? "NM"}
      </div>
    </div>
  );
}

function IncomingTrades({ trades }: { trades: Trade[] }) {
  const { toast } = useToast();
  const acceptMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/trades/${id}/accept`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({ title: "Trade accepted", description: "New item added to inventory." });
    },
  });
  const declineMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/trades/${id}/decline`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      toast({ title: "Trade declined" });
    },
  });

  if (trades.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-sm text-muted-foreground">
          No incoming trade offers.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {trades.map((t) => {
        const offered = t.offeredSnapshot ? JSON.parse(t.offeredSnapshot) : null;
        const requested = t.requestedSnapshot ? JSON.parse(t.requestedSnapshot) : null;
        return (
          <Card key={t.id} data-testid={`card-incoming-trade-${t.id}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Offer from
                  </div>
                  <div className="text-sm font-semibold">{t.counterparty}</div>
                </div>
                <div className="text-xs text-muted-foreground">{formatDate(t.createdAt)}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center mb-4">
                <SnapshotCard title="They offer" snap={offered} />
                <ArrowRight className="h-5 w-5 text-muted-foreground mx-auto hidden md:block" />
                <SnapshotCard title="They want" snap={requested} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => declineMutation.mutate(t.id)}
                  data-testid={`button-decline-${t.id}`}
                >
                  <X className="h-4 w-4 mr-1" /> Decline
                </Button>
                <Button
                  size="sm"
                  onClick={() => acceptMutation.mutate(t.id)}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid={`button-accept-${t.id}`}
                >
                  <Check className="h-4 w-4 mr-1" /> Accept
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function OutgoingTrades({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="text-sm font-medium mb-1">No outgoing offers</div>
          <p className="text-xs text-muted-foreground">
            Use "Propose Trade" from the Inventory page to offer one of your items for a marketplace listing.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {trades.map((t) => {
        const offered = t.offeredSnapshot ? JSON.parse(t.offeredSnapshot) : null;
        const requested = t.requestedSnapshot ? JSON.parse(t.requestedSnapshot) : null;
        return (
          <Card key={t.id} data-testid={`card-outgoing-trade-${t.id}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Offered to
                  </div>
                  <div className="text-sm font-semibold">{t.counterparty ?? "—"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                  <span className="text-xs text-muted-foreground">{formatDate(t.createdAt)}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center">
                <SnapshotCard title="You offer" snap={offered} />
                <ArrowRight className="h-5 w-5 text-muted-foreground mx-auto hidden md:block" />
                <SnapshotCard title="You request" snap={requested} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TradeHistory({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-sm text-muted-foreground">
          No completed trades yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm numeric">
          <thead className="border-b border-border">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left font-semibold px-4 py-2.5">Date</th>
              <th className="text-left font-semibold px-4 py-2.5">Direction</th>
              <th className="text-left font-semibold px-4 py-2.5">Counterparty</th>
              <th className="text-left font-semibold px-4 py-2.5">You gave</th>
              <th className="text-left font-semibold px-4 py-2.5">You got</th>
              <th className="text-left font-semibold px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const offered = t.offeredSnapshot ? JSON.parse(t.offeredSnapshot) : null;
              const requested = t.requestedSnapshot ? JSON.parse(t.requestedSnapshot) : null;
              // For incoming trades they offered -> we got; we gave = the requested side
              const gave = t.direction === "Incoming" ? requested : offered;
              const got = t.direction === "Incoming" ? offered : requested;
              return (
                <tr
                  key={t.id}
                  className="border-b border-border last:border-0 hover:bg-accent/40"
                  data-testid={`row-trade-history-${t.id}`}
                >
                  <td className="px-4 py-2.5 text-xs">{formatDate(t.createdAt)}</td>
                  <td className="px-4 py-2.5 text-xs">{t.direction}</td>
                  <td className="px-4 py-2.5 text-xs">{t.counterparty ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs truncate max-w-xs">{gave?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs truncate max-w-xs">{got?.name ?? "—"}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
