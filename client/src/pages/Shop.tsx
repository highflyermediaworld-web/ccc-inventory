import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CardThumb } from "@/components/CardThumb";
import { CategoryBadge, FranchiseBadge } from "@/components/Badges";
import { SocialLinks, BRAND_HANDLE, TIKTOK_URL, INSTAGRAM_URL } from "@/components/SocialLinks";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SiTiktok, SiInstagram } from "react-icons/si";
import {
  Search,
  ShoppingBag,
  ArrowLeftRight,
  SlidersHorizontal,
  X,
  Upload as UploadIcon,
  Check,
  Sparkles,
  ArrowDown,
} from "lucide-react";

// ---------- Types ----------
type ShopListing = {
  id: string;
  name: string;
  setName: string;
  rarity: string | null;
  condition: string | null;
  category: string;
  franchise: string;
  qty: number;
  askingPrice: number;
  marketValue: number | null;
  imageUrl: string | null;
  notes: string | null;
};

const FRANCHISES = [
  "Pokémon",
  "One Piece",
  "Magic The Gathering",
  "DBZ",
  "League of Legends",
  "Union Arena",
];
const CATEGORIES = ["Sealed", "Raw", "Slab"];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG", "PSA 10", "PSA 9", "PSA 8", "CGC 9.5", "CGC 9", "BGS 7"];

// ---------- Page ----------
export default function ShopPage() {
  const { data: listings = [], isLoading } = useQuery<ShopListing[]>({
    queryKey: ["/api/shop/listings"],
  });

  const [search, setSearch] = useState("");
  const [franchiseFilter, setFranchiseFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [conditionFilter, setConditionFilter] = useState<string>("all");
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [buyTarget, setBuyTarget] = useState<ShopListing | null>(null);
  const [tradeTarget, setTradeTarget] = useState<ShopListing | null>(null);

  const listingsRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return listings.filter((l) => {
      if (search) {
        const q = search.toLowerCase();
        if (!`${l.name} ${l.setName} ${l.rarity ?? ""}`.toLowerCase().includes(q)) return false;
      }
      if (franchiseFilter.length && !franchiseFilter.includes(l.franchise)) return false;
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (conditionFilter !== "all" && l.condition !== conditionFilter) return false;
      const min = parseFloat(minPrice);
      const max = parseFloat(maxPrice);
      if (!isNaN(min) && l.askingPrice < min) return false;
      if (!isNaN(max) && l.askingPrice > max) return false;
      return true;
    });
  }, [listings, search, franchiseFilter, categoryFilter, conditionFilter, minPrice, maxPrice]);

  const featured = useMemo(
    () => [...listings].sort((a, b) => b.askingPrice - a.askingPrice).slice(0, 4),
    [listings]
  );

  const hasAnyListings = listings.length > 0;
  const activeFilterCount =
    franchiseFilter.length +
    (categoryFilter !== "all" ? 1 : 0) +
    (conditionFilter !== "all" ? 1 : 0) +
    (minPrice ? 1 : 0) +
    (maxPrice ? 1 : 0) +
    (search ? 1 : 0);

  function resetFilters() {
    setSearch("");
    setFranchiseFilter([]);
    setCategoryFilter("all");
    setConditionFilter("all");
    setMinPrice("");
    setMaxPrice("");
  }

  function toggleFranchise(f: string) {
    setFranchiseFilter((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
    );
  }

  function scrollToListings() {
    listingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ============ HEADER BAND ============ */}
      <header className="relative border-b border-border bg-gradient-to-br from-[hsl(var(--sidebar))] via-[hsl(var(--sidebar))] to-[hsl(var(--sidebar))]/95 text-sidebar-foreground overflow-hidden">
        {/* Decorative diagonal pattern */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, hsl(var(--primary)) 0 1px, transparent 1px 24px)",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8 pt-10 pb-12">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
            <div className="flex items-start gap-4">
              {/* Logo */}
              <img
                src="/logo.jpeg"
                alt="Chris Collects Co logo"
                width={64}
                height={64}
                className="shrink-0 h-16 w-16 rounded-full object-cover ring-2 ring-primary/40 shadow-md"
              />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.28em] text-primary font-semibold mb-1.5">
                  {BRAND_HANDLE}
                </div>
                <h1
                  className="text-3xl sm:text-4xl font-bold tracking-tight leading-[1.05]"
                  data-testid="text-shop-title"
                >
                  CPulls Cards
                </h1>
                <p className="mt-2 text-sm text-sidebar-foreground/70 max-w-xl">
                  Trading cards curated by a collector · Pokémon · MTG · One Piece · DBZ &amp; more
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <a
                href={TIKTOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Follow ${BRAND_HANDLE} on TikTok`}
                data-testid="link-header-tiktok"
                className="flex items-center gap-2 rounded-md bg-sidebar-accent/50 hover:bg-sidebar-accent px-3 py-2 text-xs font-semibold transition-colors"
              >
                <SiTiktok className="h-4 w-4" />
                <span className="hidden sm:inline">TikTok</span>
              </a>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Follow ${BRAND_HANDLE} on Instagram`}
                data-testid="link-header-instagram"
                className="flex items-center gap-2 rounded-md bg-sidebar-accent/50 hover:bg-sidebar-accent px-3 py-2 text-xs font-semibold transition-colors"
              >
                <SiInstagram className="h-4 w-4" />
                <span className="hidden sm:inline">Instagram</span>
              </a>
            </div>
          </div>
        </div>

        {/* Subtle admin link pinned bottom-right */}
        <a
          href="/#/admin"
          className="absolute bottom-2 right-3 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/30 hover:text-sidebar-foreground/70 transition-colors"
          data-testid="link-admin"
        >
          Admin →
        </a>
      </header>

      {/* ============ HERO STRIP ============ */}
      <section className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-primary font-semibold mb-4">
                <Sparkles className="h-3 w-3" /> New drops weekly
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                Hand-picked pulls, ready to ship.
              </h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                Every card in the shop was pulled, graded, or sourced personally. Buy outright or
                propose a trade — Chris reviews every request.
              </p>
              <div className="mt-5 flex items-center gap-3">
                <Button
                  size="lg"
                  onClick={scrollToListings}
                  data-testid="button-shop-cta"
                  className="gap-2"
                >
                  Browse listings <ArrowDown className="h-4 w-4" />
                </Button>
                {hasAnyListings && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {listings.length} {listings.length === 1 ? "card" : "cards"} available
                  </span>
                )}
              </div>
            </div>

            {featured.length > 0 && (
              <div className="hidden lg:flex gap-3">
                {featured.slice(0, 4).map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setBuyTarget(l)}
                    className="group w-32 text-left rounded-lg border border-border bg-card overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/30"
                    data-testid={`featured-${l.id}`}
                  >
                    <div className="aspect-[3/4] bg-muted/50">
                      <CardThumb
                        imageUrl={l.imageUrl}
                        franchise={l.franchise}
                        size="lg"
                        className="h-full w-full"
                      />
                    </div>
                    <div className="p-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                        {l.setName}
                      </div>
                      <div className="text-[11px] font-semibold truncate">{l.name}</div>
                      <div className="mt-1 text-sm font-bold text-primary tabular-nums">
                        {formatCurrency(l.askingPrice)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ FILTERS + LISTINGS ============ */}
      <section ref={listingsRef} className="mx-auto max-w-7xl px-5 sm:px-8 py-8">
        {/* Desktop filters */}
        <div className="hidden md:flex flex-wrap items-end gap-3 mb-6">
          <div className="flex-1 min-w-[200px] max-w-sm">
            <Label htmlFor="shop-search" className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Search
            </Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="shop-search"
                data-testid="input-shop-search"
                placeholder="Card name, set, rarity…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Category
            </Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 w-[130px] mt-1" data-testid="select-shop-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Condition
            </Label>
            <Select value={conditionFilter} onValueChange={setConditionFilter}>
              <SelectTrigger className="h-9 w-[130px] mt-1" data-testid="select-shop-condition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All conditions</SelectItem>
                {CONDITIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Min $
            </Label>
            <Input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="0"
              className="h-9 w-[90px] mt-1 tabular-nums"
              data-testid="input-shop-min-price"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Max $
            </Label>
            <Input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="∞"
              className="h-9 w-[90px] mt-1 tabular-nums"
              data-testid="input-shop-max-price"
            />
          </div>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              data-testid="button-shop-reset"
              className="h-9 gap-1"
            >
              <X className="h-3.5 w-3.5" /> Clear ({activeFilterCount})
            </Button>
          )}
        </div>

        {/* Franchise pill row — desktop */}
        <div className="hidden md:flex flex-wrap gap-2 mb-6">
          {FRANCHISES.map((f) => {
            const active = franchiseFilter.includes(f);
            return (
              <button
                key={f}
                onClick={() => toggleFranchise(f)}
                data-testid={`pill-franchise-${f}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                )}
              >
                {f}
              </button>
            );
          })}
        </div>

        {/* Mobile sticky filter button */}
        <div className="md:hidden sticky top-0 z-20 -mx-5 px-5 py-3 mb-4 bg-background/90 backdrop-blur border-b border-border flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
              data-testid="input-shop-search-mobile"
            />
          </div>
          <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-shop-filters-mobile">
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-primary text-primary-foreground text-[10px] h-4 w-4 flex items-center justify-center tabular-nums">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[90vw] sm:w-[400px]">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Franchise
                  </Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {FRANCHISES.map((f) => {
                      const active = franchiseFilter.includes(f);
                      return (
                        <button
                          key={f}
                          onClick={() => toggleFranchise(f)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium",
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-transparent text-muted-foreground border-border"
                          )}
                        >
                          {f}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Condition</Label>
                  <Select value={conditionFilter} onValueChange={setConditionFilter}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All conditions</SelectItem>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Min $</Label>
                    <Input
                      type="number"
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      className="mt-1 tabular-nums"
                    />
                  </div>
                  <div>
                    <Label>Max $</Label>
                    <Input
                      type="number"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      className="mt-1 tabular-nums"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={resetFilters}>
                    Clear
                  </Button>
                  <Button className="flex-1" onClick={() => setMobileFiltersOpen(false)}>
                    Show {filtered.length}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Listings grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/5] rounded-lg bg-muted/40 animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
            {filtered.map((l) => (
              <ListingCard
                key={l.id}
                listing={l}
                onBuy={() => setBuyTarget(l)}
                onTrade={() => setTradeTarget(l)}
              />
            ))}
          </div>
        ) : hasAnyListings ? (
          <EmptyFilters onReset={resetFilters} />
        ) : (
          <EmptyNoListings />
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground">
            © CPulls Cards · Curated by a collector
          </div>
          <SocialLinks size="md" />
        </div>
      </footer>

      {/* Dialogs */}
      {buyTarget && (
        <BuyDialog listing={buyTarget} onOpenChange={(o) => !o && setBuyTarget(null)} />
      )}
      {tradeTarget && (
        <TradeDialog listing={tradeTarget} onOpenChange={(o) => !o && setTradeTarget(null)} />
      )}
    </div>
  );
}

// ---------- Listing Card ----------
function ListingCard({
  listing,
  onBuy,
  onTrade,
}: {
  listing: ShopListing;
  onBuy: () => void;
  onTrade: () => void;
}) {
  const belowMarket =
    listing.marketValue != null && listing.askingPrice < listing.marketValue;

  return (
    <div
      data-testid={`card-listing-${listing.id}`}
      className="group relative rounded-lg border border-border bg-card overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/30"
    >
      <div className="aspect-[3/4] bg-muted/40 relative">
        <CardThumb
          imageUrl={listing.imageUrl}
          franchise={listing.franchise}
          size="lg"
          className="h-full w-full"
        />
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          <FranchiseBadge franchise={listing.franchise} />
        </div>
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          <CategoryBadge category={listing.category} />
          {belowMarket && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              Below market
            </span>
          )}
        </div>
      </div>
      <div className="p-3 space-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
            {listing.setName}
          </div>
          <div
            className="text-sm font-semibold leading-tight truncate"
            title={listing.name}
          >
            {listing.name}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            {listing.rarity && <span>{listing.rarity}</span>}
            {listing.condition && (
              <>
                <span>·</span>
                <span className="font-mono">{listing.condition}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tabular-nums text-primary">
            {formatCurrency(listing.askingPrice)}
          </span>
          {listing.marketValue && listing.marketValue !== listing.askingPrice && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              mkt {formatCurrency(listing.marketValue)}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 pt-1">
          <Button
            size="sm"
            onClick={onBuy}
            className="flex-1 h-8 gap-1.5"
            data-testid={`button-buy-${listing.id}`}
          >
            <ShoppingBag className="h-3.5 w-3.5" /> Buy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onTrade}
            className="flex-1 h-8 gap-1.5"
            data-testid={`button-trade-${listing.id}`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" /> Trade
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Empty states ----------
function EmptyFilters({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <div className="text-lg font-semibold mb-1">No listings match your filters</div>
      <p className="text-sm text-muted-foreground mb-4">
        Try clearing a filter or broadening your price range.
      </p>
      <Button onClick={onReset} variant="outline" data-testid="button-empty-reset">
        Clear all filters
      </Button>
    </div>
  );
}

function EmptyNoListings() {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <Sparkles className="h-8 w-8 text-primary mx-auto mb-3" />
      <div className="text-lg font-semibold mb-1">New drops coming soon</div>
      <p className="text-sm text-muted-foreground mb-4">
        Follow {BRAND_HANDLE} for pulls, drops, and early access.
      </p>
      <SocialLinks size="md" variant="solid" className="justify-center" />
    </div>
  );
}

// ---------- Buy Dialog ----------
const PREFERRED_CONTACTS = [
  "Email",
  "Instagram DM",
  "TikTok DM",
  "Phone",
  "Text",
];

function BuyDialog({
  listing,
  onOpenChange,
}: {
  listing: ShopListing;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    preferredContact: "Email",
    quantity: 1,
    message: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/shop/buy", data);
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (err: any) => {
      toast({
        title: "Request failed",
        description: err?.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  function submit() {
    const e: Record<string, string> = {};
    if (!form.customerName.trim()) e.customerName = "Required";
    if (!form.customerEmail.trim()) e.customerEmail = "Required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail))
      e.customerEmail = "Invalid email";
    if (!form.preferredContact) e.preferredContact = "Required";
    setErrors(e);
    if (Object.keys(e).length) return;
    mutation.mutate({
      itemId: listing.id,
      customerName: form.customerName.trim(),
      customerEmail: form.customerEmail.trim(),
      customerPhone: form.customerPhone.trim() || null,
      preferredContact: form.preferredContact,
      quantity: form.quantity,
      offerPrice: listing.askingPrice,
      message: form.message.trim() || null,
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {!submitted ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">Request to buy</DialogTitle>
              <DialogDescription>
                Chris will review and reach out to arrange payment &amp; shipping.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 p-3 rounded-md border border-border bg-muted/30">
              <div className="w-16 aspect-[3/4] bg-muted rounded overflow-hidden shrink-0">
                <CardThumb
                  imageUrl={listing.imageUrl}
                  franchise={listing.franchise}
                  size="lg"
                  className="h-full w-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                  {listing.setName}
                </div>
                <div className="text-sm font-semibold truncate">{listing.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {listing.condition || ""}
                </div>
                <div className="mt-1 text-base font-bold text-primary tabular-nums">
                  {formatCurrency(listing.askingPrice)}
                </div>
              </div>
            </div>
            <div className="grid gap-3">
              <Field
                label="Your name *"
                value={form.customerName}
                onChange={(v) => setForm((f) => ({ ...f, customerName: v }))}
                error={errors.customerName}
                testId="input-buy-name"
              />
              <Field
                label="Email *"
                type="email"
                value={form.customerEmail}
                onChange={(v) => setForm((f) => ({ ...f, customerEmail: v }))}
                error={errors.customerEmail}
                testId="input-buy-email"
              />
              <Field
                label="Phone (optional)"
                value={form.customerPhone}
                onChange={(v) => setForm((f) => ({ ...f, customerPhone: v }))}
                testId="input-buy-phone"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Preferred contact</Label>
                  <Select
                    value={form.preferredContact}
                    onValueChange={(v) => setForm((f) => ({ ...f, preferredContact: v }))}
                  >
                    <SelectTrigger className="mt-1" data-testid="select-buy-contact">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFERRED_CONTACTS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {listing.qty > 1 && (
                  <div>
                    <Label className="text-xs">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      max={listing.qty}
                      value={form.quantity}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          quantity: Math.max(1, Math.min(listing.qty, Number(e.target.value) || 1)),
                        }))
                      }
                      className="mt-1 tabular-nums"
                      data-testid="input-buy-qty"
                    />
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Message (optional)</Label>
                <Textarea
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  rows={3}
                  placeholder="Any questions, shipping notes…"
                  className="mt-1"
                  data-testid="textarea-buy-message"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={mutation.isPending}
                data-testid="button-buy-submit"
              >
                {mutation.isPending
                  ? "Sending…"
                  : `Request to buy for ${formatCurrency(listing.askingPrice * form.quantity)}`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <SuccessPane
            title="Request sent"
            preferredContact={form.preferredContact}
            description="Chris will reach out to confirm and arrange payment. Usually within 24 hours."
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Trade Dialog ----------
function TradeDialog({
  listing,
  onOpenChange,
}: {
  listing: ShopListing;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerHandle: "",
    preferredContact: "Instagram DM",
    offerDescription: "",
    message: "",
  });
  const [images, setImages] = useState<string[]>([]); // uploaded URLs
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/shop/trade", data);
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
    onError: (err: any) =>
      toast({
        title: "Request failed",
        description: err?.message || "Please try again",
        variant: "destructive",
      }),
  });

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files).slice(0, 4 - images.length);
    setUploading(true);
    try {
      for (const file of arr) {
        if (file.size > 5 * 1024 * 1024) {
          toast({
            title: `${file.name} too large`,
            description: "Images must be under 5 MB",
            variant: "destructive",
          });
          continue;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const base64 = dataUrl.split(",")[1];
        const mediaType = dataUrl.match(/^data:([^;]+);/)?.[1] || "image/jpeg";
        const res = await apiRequest("POST", "/api/shop/upload", {
          imageBase64: base64,
          mediaType,
        });
        const body = await res.json();
        if (body.url) setImages((prev) => [...prev, body.url]);
      }
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    const e: Record<string, string> = {};
    if (!form.customerName.trim()) e.customerName = "Required";
    if (!form.customerEmail.trim()) e.customerEmail = "Required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail))
      e.customerEmail = "Invalid email";
    if (!form.customerHandle.trim()) e.customerHandle = "Required";
    if (!form.offerDescription.trim()) e.offerDescription = "Required";
    setErrors(e);
    if (Object.keys(e).length) return;
    mutation.mutate({
      itemId: listing.id,
      customerName: form.customerName.trim(),
      customerEmail: form.customerEmail.trim(),
      customerHandle: form.customerHandle.trim(),
      preferredContact: form.preferredContact,
      offerDescription: form.offerDescription.trim(),
      offerImageUrls: images.length ? JSON.stringify(images) : null,
      message: form.message.trim() || null,
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {!submitted ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">Propose a trade</DialogTitle>
              <DialogDescription>
                Tell Chris what you're offering. He'll reach out if interested.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 p-3 rounded-md border border-border bg-muted/30">
              <div className="w-14 aspect-[3/4] bg-muted rounded overflow-hidden shrink-0">
                <CardThumb
                  imageUrl={listing.imageUrl}
                  franchise={listing.franchise}
                  size="lg"
                  className="h-full w-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  You want
                </div>
                <div className="text-sm font-semibold truncate">{listing.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {listing.setName} · {listing.condition || ""}
                </div>
                <div className="text-xs text-primary tabular-nums mt-0.5">
                  asking {formatCurrency(listing.askingPrice)}
                </div>
              </div>
            </div>
            <div className="grid gap-3">
              <Field
                label="Your name *"
                value={form.customerName}
                onChange={(v) => setForm((f) => ({ ...f, customerName: v }))}
                error={errors.customerName}
                testId="input-trade-name"
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Email *"
                  type="email"
                  value={form.customerEmail}
                  onChange={(v) => setForm((f) => ({ ...f, customerEmail: v }))}
                  error={errors.customerEmail}
                  testId="input-trade-email"
                />
                <Field
                  label="IG / TikTok handle *"
                  value={form.customerHandle}
                  onChange={(v) => setForm((f) => ({ ...f, customerHandle: v }))}
                  error={errors.customerHandle}
                  testId="input-trade-handle"
                  placeholder="@yourhandle"
                />
              </div>
              <div>
                <Label className="text-xs">Preferred contact</Label>
                <Select
                  value={form.preferredContact}
                  onValueChange={(v) => setForm((f) => ({ ...f, preferredContact: v }))}
                >
                  <SelectTrigger className="mt-1" data-testid="select-trade-contact">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PREFERRED_CONTACTS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">What you're offering *</Label>
                <Textarea
                  value={form.offerDescription}
                  onChange={(e) => setForm((f) => ({ ...f, offerDescription: e.target.value }))}
                  rows={3}
                  placeholder="e.g., Charizard VMAX, Vivid Voltage, NM, Ultra Rare"
                  className={cn("mt-1", errors.offerDescription && "border-destructive")}
                  data-testid="textarea-trade-offer"
                />
                {errors.offerDescription && (
                  <p className="text-[11px] text-destructive mt-1">{errors.offerDescription}</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Photos of your card(s) (up to 4)</Label>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {images.map((url, i) => (
                    <div
                      key={i}
                      className="relative aspect-square rounded border border-border overflow-hidden bg-muted/30"
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/80 hover:bg-background flex items-center justify-center"
                        aria-label="Remove image"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {images.length < 4 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      data-testid="button-trade-upload"
                      className="aspect-square rounded border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                    >
                      {uploading ? (
                        <span className="text-[10px]">Uploading…</span>
                      ) : (
                        <UploadIcon className="h-5 w-5" />
                      )}
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFiles(e.target.files)}
                  className="hidden"
                />
              </div>
              <div>
                <Label className="text-xs">Message (optional)</Label>
                <Textarea
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  rows={2}
                  className="mt-1"
                  data-testid="textarea-trade-message"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={mutation.isPending}
                data-testid="button-trade-submit"
              >
                {mutation.isPending ? "Sending…" : "Send trade proposal"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <SuccessPane
            title="Trade request sent"
            preferredContact={form.preferredContact}
            description="Chris will review your offer and reach out if interested."
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Shared UI bits ----------
function Field({
  label,
  value,
  onChange,
  type = "text",
  error,
  testId,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  error?: string;
  testId?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("mt-1", error && "border-destructive")}
        data-testid={testId}
      />
      {error && <p className="text-[11px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

function SuccessPane({
  title,
  description,
  preferredContact,
  onClose,
}: {
  title: string;
  description: string;
  preferredContact: string;
  onClose: () => void;
}) {
  return (
    <div className="py-6 text-center space-y-4">
      <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div>
        <div className="text-lg font-semibold">{title}</div>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          {description.replace("{preferred contact}", preferredContact)}
        </p>
        <p className="text-xs text-muted-foreground mt-3">
          Chris will reach out via <span className="font-semibold">{preferredContact}</span>.
        </p>
      </div>
      <Button onClick={onClose} data-testid="button-success-close">
        Close
      </Button>
    </div>
  );
}
