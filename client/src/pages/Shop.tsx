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
import { LiveStreamBanner } from "@/components/LiveStreamBanner";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { LayoutDashboard } from "lucide-react";
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
  ShieldCheck,
  Award,
  Truck,
  Quote,
  Star,
  Camera,
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
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isSignedIn = !!user;

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

  const stats = useMemo(() => {
    const empty = listings.length === 0;
    const totalQty = listings.reduce((sum, l) => sum + (l.qty || 0), 0);
    const franchises = new Set(
      listings
        .map((l) => l.franchise)
        .filter((f): f is string => !!f && f !== "Other")
    );
    const sealedCount = listings.filter((l) => l.category === "Sealed").length;
    const slabCount = listings.filter((l) => l.category === "Slab").length;
    const fmt = (n: number) => {
      if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k+`;
      if (n >= 100) return `${Math.floor(n / 10) * 10}+`;
      return `${n}`;
    };
    return {
      totalQtyLabel: empty ? "\u2014" : fmt(totalQty),
      franchisesLabel: empty ? "\u2014" : `${franchises.size}`,
      sealedLabel: empty ? "\u2014" : fmt(sealedCount),
      slabLabel: empty ? "\u2014" : fmt(slabCount),
      totalQty,
      franchiseCount: franchises.size,
      sealedCount,
      slabCount,
    };
  }, [listings]);

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
      {/* ============ STICKY NAV — solid cream (dark hero below) ============ */}
      <header className="sticky top-0 z-40 bg-[hsl(var(--brand-cream))] border-b border-[hsl(var(--border))] shadow-[0_1px_0_hsl(var(--brand-gold)/0.2),0_8px_24px_-12px_hsl(var(--brand-aubergine)/0.25)]">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo.jpeg"
              alt="Chris Collects Co logo"
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover ring-1 ring-[hsl(var(--brand-gold)/0.55)]"
            />
            <div className="leading-tight">
              <div className="serif text-lg font-semibold tracking-tight text-[hsl(var(--brand-aubergine))]">
                CPulls Cards
              </div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-gold font-semibold">
                {BRAND_HANDLE}
              </div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[hsl(var(--brand-aubergine))]/80">
            <button onClick={scrollToListings} className="hover:text-[hsl(var(--brand-aubergine))] transition-colors">
              Shop
            </button>
            <a href="#why" className="hover:text-[hsl(var(--brand-aubergine))] transition-colors">
              Why us
            </a>
            <a href="#promise" className="hover:text-[hsl(var(--brand-aubergine))] transition-colors">
              Guarantee
            </a>
            <a href="#reviews" className="hover:text-[hsl(var(--brand-aubergine))] transition-colors">
              Reviews
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <a
              href={TIKTOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Follow ${BRAND_HANDLE} on TikTok`}
              className="hidden sm:inline-flex items-center justify-center h-9 w-9 rounded-full border border-[hsl(var(--brand-aubergine)/0.15)] hover:border-[hsl(var(--brand-gold)/0.6)] hover:bg-[hsl(var(--brand-gold)/0.08)] transition-colors"
            >
              <SiTiktok className="h-4 w-4" />
            </a>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Follow ${BRAND_HANDLE} on Instagram`}
              className="hidden sm:inline-flex items-center justify-center h-9 w-9 rounded-full border border-[hsl(var(--brand-aubergine)/0.15)] hover:border-[hsl(var(--brand-gold)/0.6)] hover:bg-[hsl(var(--brand-gold)/0.08)] transition-colors"
            >
              <SiInstagram className="h-4 w-4" />
            </a>
            {isAdmin ? (
              <a
                href="#/admin"
                data-testid="link-nav-admin"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-[hsl(var(--brand-gold)/0.55)] bg-[hsl(var(--brand-gold)/0.10)] text-[hsl(var(--brand-aubergine))] text-sm font-semibold hover:bg-[hsl(var(--brand-gold)/0.18)] transition-colors"
              >
                <LayoutDashboard className="h-4 w-4 text-gold" />
                <span className="hidden sm:inline">Admin</span>
              </a>
            ) : !isSignedIn ? (
              <a
                href="#/login?next=/admin"
                data-testid="link-nav-signin"
                className="hidden sm:inline-flex items-center h-9 px-3 rounded-full text-[hsl(var(--brand-aubergine))]/70 text-sm font-medium hover:text-[hsl(var(--brand-aubergine))] transition-colors"
              >
                Owner sign in
              </a>
            ) : null}
            <Button
              size="sm"
              onClick={scrollToListings}
              className="eb-cta-gold gap-1.5"
              data-testid="button-nav-shop"
            >
              Shop now <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* ============ HERO ============ */}
      <section className="eb-hero relative overflow-hidden">
        {/* Subtle gold glow decoration */}
        <div
          aria-hidden
          className="absolute -top-40 -right-24 h-[520px] w-[520px] rounded-full bg-[hsl(var(--brand-gold-bright)/0.14)] blur-3xl pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-[hsl(var(--brand-gold)/0.10)] blur-3xl pointer-events-none"
        />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8 py-16 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-center">
            <div>
              <div className="eb-eyebrow mb-4">
                Trading cards · Est. 2024 · California
              </div>
              <h1 className="serif text-[2.75rem] sm:text-6xl leading-[1.02] tracking-tight font-medium text-[hsl(var(--brand-cream))] mb-5">
                Rare pulls,
                <br />
                <span className="text-gold-bright">expertly curated.</span>
              </h1>
              <p className="text-[hsl(var(--brand-cream)/0.82)] text-base sm:text-lg leading-relaxed max-w-xl mb-8">
                Every card in the shop is pulled, graded, or hand-sourced by a lifelong collector. Buy outright with confidence, or propose a trade — every request gets a personal review.
              </p>
              <div className="flex items-center gap-4 flex-wrap">
                <Button
                  size="lg"
                  onClick={scrollToListings}
                  className="eb-cta-gold gap-2 h-12 px-7 text-base"
                  data-testid="button-shop-cta"
                >
                  Browse the collection <ArrowDown className="h-4 w-4" />
                </Button>
                <a
                  href="#promise"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand-cream))] hover:text-gold-bright transition-colors"
                >
                  Read the guarantee →
                </a>
              </div>
              {hasAnyListings && (
                <div className="mt-8 flex items-center gap-6 text-sm text-[hsl(var(--brand-cream)/0.7)]">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-[hsl(var(--brand-gold-bright))] live-pulse-dot" />
                    <span className="tabular-nums">
                      {listings.length} {listings.length === 1 ? "card" : "cards"} in stock
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-gold-bright">
                    {[0,1,2,3,4].map((i) => (
                      <Star key={i} className="h-4 w-4 fill-current" />
                    ))}
                    <span className="ml-2 text-[hsl(var(--brand-cream)/0.7)]">from live shoppers</span>
                  </div>
                </div>
              )}
            </div>

            {featured.length > 0 && (
              <div className="relative hidden lg:block">
                <div className="grid grid-cols-2 gap-4">
                  {featured.slice(0, 4).map((l, idx) => (
                    <button
                      key={l.id}
                      onClick={() => setBuyTarget(l)}
                      className={[
                        "eb-card group relative overflow-hidden text-left transition-transform",
                        idx === 1 ? "translate-y-6" : "",
                        idx === 2 ? "-translate-y-6" : "",
                      ].join(" ")}
                      style={{ animationDelay: `${idx * 80}ms` }}
                      data-testid={`featured-${l.id}`}
                    >
                      <div className="aspect-[3/4] bg-[hsl(var(--brand-aubergine-2))]">
                        <CardThumb
                          imageUrl={l.imageUrl}
                          franchise={l.franchise}
                          size="lg"
                          className="h-full w-full"
                        />
                      </div>
                      <div className="p-3 bg-[hsl(var(--card))]">
                        <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] truncate">
                          {l.setName}
                        </div>
                        <div className="text-xs font-semibold truncate text-[hsl(var(--foreground))]">
                          {l.name}
                        </div>
                        <div className="mt-1 text-sm font-bold text-gold tabular-nums">
                          {formatCurrency(l.askingPrice)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ TRUST BAR (live inventory) ============ */}
      <section className="eb-band-cream-2 border-y border-[hsl(var(--border))]">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          {[
            { n: stats.totalQtyLabel, l: "Cards in stock" },
            { n: stats.franchisesLabel, l: "TCGs supported" },
            { n: stats.sealedLabel, l: "Sealed products" },
            { n: "48 hrs", l: "Ship time" },
          ].map((s) => (
            <div key={s.l} data-testid={`stat-${s.l.replace(/\s+/g, "-").toLowerCase()}`}>
              <div className="serif text-2xl sm:text-3xl font-semibold text-[hsl(var(--brand-aubergine))] tabular-nums">
                {s.n}
              </div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-gold font-semibold mt-1">
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ WHY CHOOSE US ============ */}
      <section id="why" className="eb-band-cream">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 pt-16 pb-14">
          <div className="eb-section-header text-center py-0">
            <div className="eb-eyebrow">Why collectors choose us</div>
            <h2 className="serif mx-auto">A collector-run shop, held to a higher standard.</h2>
            <p className="mx-auto text-center">
              Chris personally sources, grades, and photographs every card. When you buy from CPulls, you get a card handled the way a serious collector would want their own.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3 mt-10">
            {[
              {
                Icon: ShieldCheck,
                title: "Every card, verified",
                body: "Grades, edges, and centering inspected in-hand. What you see in the photo is what ships — no bait-and-switch.",
              },
              {
                Icon: Award,
                title: "Fair, transparent pricing",
                body: "Live TCGplayer market data on every listing, updated every 30 minutes. Trade proposals get a personal counter within 24 hours.",
              },
              {
                Icon: Truck,
                title: "Shipped in 48 hours",
                body: "Toploader, team bag, bubble mailer minimum. High-value cards ship in Card Saver II with tracking and insurance included.",
              },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="eb-card p-6">
                <div className="h-11 w-11 rounded-full bg-[hsl(var(--brand-gold)/0.14)] flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-gold-bright" />
                </div>
                <h3 className="serif text-xl font-semibold mb-2">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ LIVE STREAM BANNER (moved below hero) ============ */}
      <section className="border-y border-[hsl(var(--border))] bg-background">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-5">
          <LiveStreamBanner />
        </div>
      </section>

      {/* ============ GUARANTEE BAND ============ */}
      <section id="promise" className="eb-band-dark relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-32 left-1/2 -translate-x-1/2 h-[420px] w-[720px] rounded-full bg-[hsl(var(--brand-gold-bright)/0.10)] blur-3xl pointer-events-none"
        />
        <div className="relative mx-auto max-w-4xl px-5 sm:px-8 py-16 sm:py-20 text-center">
          <div className="eb-eyebrow">The CPulls promise</div>
          <h2 className="serif mt-3 text-3xl sm:text-5xl leading-[1.08] text-[hsl(var(--brand-cream))] font-medium">
            If the card doesn’t arrive exactly as described, you get a full refund — no photos, no restocking fees, no questions.
          </h2>
          <p className="mt-6 text-[hsl(var(--brand-cream)/0.75)] max-w-2xl mx-auto">
            Every order is packed by hand and cross-checked against the listing photo. On the rare occasion something is off, we make it right the same day.
          </p>
          <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--brand-gold)/0.5)] bg-[hsl(var(--brand-gold-bright)/0.10)] px-4 py-2">
            <ShieldCheck className="h-4 w-4 text-gold-bright" />
            <span className="text-sm font-semibold text-gold-bright">100% satisfaction guaranteed</span>
          </div>
        </div>
      </section>

      {/* ============ TESTIMONIALS ============ */}
      <section id="reviews" className="eb-band-cream-2">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-16 sm:py-20">
          <div className="eb-section-header text-center py-0">
            <div className="eb-eyebrow">What buyers say</div>
            <h2 className="serif mx-auto">Trusted by collectors from coast to coast.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3 mt-10">
            {[
              {
                quote: "The centering on my Charizard was exactly as pictured. Packed like a museum piece. This is how every seller should operate.",
                name: "Marcus D.",
                role: "Pok\u00e9mon collector · Bay Area",
              },
              {
                quote: "Traded in a stack of duplicates and got a fair counter within a few hours. Chris actually knows the market — not just running a script.",
                name: "Priya S.",
                role: "MTG player · Los Angeles",
              },
              {
                quote: "Followed the live pulls on TikTok for months before buying. What you see is what you get, every single time.",
                name: "Tyler R.",
                role: "One Piece TCG · Sacramento",
              },
            ].map((t) => (
              <figure
                key={t.name}
                className="eb-card p-6 flex flex-col"
              >
                <Quote className="h-6 w-6 text-gold-bright mb-3" />
                <blockquote className="text-[15px] leading-relaxed flex-1">
                  “{t.quote}”
                </blockquote>
                <figcaption className="mt-5 pt-4 border-t border-[hsl(var(--brand-cream)/0.15)]">
                  <div className="serif font-semibold">{t.name}</div>
                  <div className="text-xs opacity-75 mt-0.5">{t.role}</div>
                </figcaption>
              </figure>
            ))}
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
      className="card-tilt group relative rounded-lg border-2 border-border bg-card overflow-hidden hover:border-primary/60"
    >
      <div className="holo-sheen aspect-[3/4] bg-black relative">
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
          <span className="font-anime text-2xl tabular-nums text-primary glow-red-sm leading-none">
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
