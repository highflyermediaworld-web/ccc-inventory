import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Listing, Inventory } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { CategoryBadge, FranchiseBadge } from "@/components/Badges";
import { formatCurrency, formatDate, daysBetween } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Search, ShoppingCart, XCircle, Pencil } from "lucide-react";

export default function MarketplacePage() {
  const { data: allListings = [] } = useQuery<Listing[]>({
    queryKey: ["/api/listings"],
  });
  const { data: inventory = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory"],
  });

  const myListings = useMemo(
    () => allListings.filter((l) => !l.sellerName),
    [allListings]
  );
  const marketListings = useMemo(
    () => allListings.filter((l) => !!l.sellerName),
    [allListings]
  );

  const invById = useMemo(() => {
    const m: Record<string, Inventory> = {};
    inventory.forEach((i) => (m[i.id] = i));
    return m;
  }, [inventory]);

  return (
    <div className="p-4 md:p-8 max-w-[1500px]">
      <PageHeader
        eyebrow="Market"
        title="Marketplace"
        description={`${myListings.length} active listings · ${marketListings.length} items available to buy`}
      />

      <Tabs defaultValue="mine" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="mine" data-testid="tab-my-listings">
            My listings ({myListings.length})
          </TabsTrigger>
          <TabsTrigger value="browse" data-testid="tab-browse-market">
            Browse market ({marketListings.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mine">
          <MyListings listings={myListings} invById={invById} />
        </TabsContent>

        <TabsContent value="browse">
          <BrowseMarket listings={marketListings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MyListings({
  listings,
  invById,
}: {
  listings: Listing[];
  invById: Record<string, Inventory>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<Listing | null>(null);
  const [price, setPrice] = useState("");

  const unlistMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/listings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Listing removed" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, askingPrice }: { id: number; askingPrice: number }) => {
      const res = await apiRequest("PATCH", `/api/listings/${id}`, { askingPrice });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Price updated" });
      setEditing(null);
    },
  });

  if (listings.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="text-sm font-medium mb-1">No active listings</div>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Use the "List for sale" action on any inventory item to post it on the marketplace.
          </p>
        </CardContent>
      </Card>
    );
  }

  const now = Math.floor(Date.now() / 1000);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {listings.map((l) => {
          const item = l.itemId ? invById[l.itemId] : null;
          const days = daysBetween(now, l.listedAt);
          return (
            <Card key={l.id} data-testid={`card-my-listing-${l.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {item?.id ?? "—"}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {days === 0 ? "today" : `${days}d listed`}
                  </span>
                </div>
                {item && (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <FranchiseBadge franchise={item.franchise} />
                      <CategoryBadge category={item.category} />
                    </div>
                    <div className="text-sm font-semibold truncate mb-0.5">{item.name}</div>
                    <div className="text-xs text-muted-foreground truncate mb-3">
                      {item.setName} · {item.condition ?? "—"}
                    </div>
                  </>
                )}
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Asking
                    </div>
                    <div className="text-xl font-bold tnum text-primary">
                      {formatCurrency(l.askingPrice)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Market
                    </div>
                    <div className="text-sm font-medium tnum text-muted-foreground">
                      {formatCurrency(item?.marketValue)}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setEditing(l);
                      setPrice(l.askingPrice.toString());
                    }}
                    data-testid={`button-edit-price-${l.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit price
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm("Unlist this item?"))
                        unlistMutation.mutate(l.id);
                    }}
                    data-testid={`button-unlist-${l.id}`}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Unlist
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update asking price</DialogTitle>
            <DialogDescription>
              {editing && editing.itemId && invById[editing.itemId]?.name}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              data-testid="input-new-price"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editing)
                  updateMutation.mutate({
                    id: editing.id,
                    askingPrice: Number(price),
                  });
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="button-save-price"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BrowseMarket({ listings }: { listings: Listing[] }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const parsed = listings.map((l) => ({
    ...l,
    snap: l.itemSnapshot ? JSON.parse(l.itemSnapshot) : {},
  }));

  const filtered = parsed.filter((l) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      l.snap.name?.toLowerCase().includes(q) ||
      l.snap.setName?.toLowerCase().includes(q) ||
      l.snap.franchise?.toLowerCase().includes(q) ||
      l.sellerName?.toLowerCase().includes(q)
    );
  });

  const buyMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/listings/${id}/buy`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({
        title: "Purchase complete",
        description: `Added ${data.newItemId} to your inventory.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Purchase failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <div className="mb-4 max-w-md relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8 h-9"
          placeholder="Search marketplace…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-market-search"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((l) => (
          <Card
            key={l.id}
            className="group hover:border-primary/40 transition-colors"
            data-testid={`card-market-${l.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <FranchiseBadge franchise={l.snap.franchise} />
                <CategoryBadge category={l.snap.category} />
              </div>
              <div className="text-sm font-semibold truncate mb-0.5">{l.snap.name}</div>
              <div className="text-xs text-muted-foreground truncate mb-1">
                {l.snap.setName}
              </div>
              <div className="text-[11px] text-muted-foreground mb-3">
                {l.snap.condition ?? "NM"}
                {l.snap.rarity && ` · ${l.snap.rarity}`}
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Price
                  </div>
                  <div className="text-lg font-bold tnum text-primary">
                    {formatCurrency(l.askingPrice)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Seller
                  </div>
                  <div className="text-xs font-medium">{l.sellerName}</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  Listed {formatDate(l.listedAt)}
                </span>
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => {
                    if (
                      confirm(
                        `Buy ${l.snap.name} from ${l.sellerName} for ${formatCurrency(l.askingPrice)}?`
                      )
                    )
                      buyMutation.mutate(l.id);
                  }}
                  disabled={buyMutation.isPending}
                  data-testid={`button-buy-${l.id}`}
                >
                  <ShoppingCart className="h-3.5 w-3.5 mr-1" /> Buy now
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            No listings match your search.
          </CardContent>
        </Card>
      )}
    </>
  );
}
