import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, API_BASE, queryClient } from "@/lib/queryClient";
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
import { ShopChat } from "@/components/ShopChat";
import { PaymentOptionCards, PaymentChips } from "@/components/PaymentOptions";
import { BRAND_HANDLE, TIKTOK_URL, INSTAGRAM_URL } from "@/components/SocialLinks";
import { resolveUploadUrl, thumbSrcSet } from "@/lib/uploads";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import { splitShows, showDateParts, type CardShow } from "@/data/shows";
import { SiTiktok, SiInstagram } from "react-icons/si";
import {
  Search,
  ShoppingBag,
  ArrowLeftRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Upload as UploadIcon,
  Check,
  Sparkles,
  ShieldCheck,
  Award,
  Truck,
  Star,
  Camera,
  Package,
  Layers,
  Gem,
  Zap,
  Flame,
  UserRound,
  LayoutDashboard,
  MapPin,
  Clock,
  CalendarDays,
  Tent,
  Calculator,
  Loader2,
  Banknote,
  Radio,
  BadgeCheck,
  Wallet,
} from "lucide-react";
import { PAYMENT_METHODS, PAYMENT_METHODS_SENTENCE } from "@shared/storefront";
import "@/shop.css";

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
  /** false when sold out / qty 0 — item stays visible with an Out of stock banner */
  inStock?: boolean;
  /** TCGplayer sales velocity (copies sold in the last 3 months / per day) */
  sold3mo?: number | null;
  tcgpProductId?: number | null;
  tcgpMarketPrice?: number | null;
  tcgpPricedAt?: number | null;
  soldPerDay?: number | null;
  askingPrice: number;
  marketValue: number | null;
  imageUrl: string | null;
  notes?: string | null;
  createdAt?: number | null;
};

type LiveStatus = {
  isLive: boolean;
  platform: string;
  handle: string;
  url: string;
  title: string;
};

const CATEGORIES = ["Sealed", "Raw", "Slab"];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG", "PSA 10", "PSA 9", "PSA 8", "CGC 9.5", "CGC 9", "BGS 7"];
const PAGE_SIZE = 24;
// Preview builds can point the storefront at a static inventory snapshot.
const LISTINGS_URL: string = (import.meta as any).env?.VITE_SHOP_LISTINGS_URL || "/api/shop/listings";

// Live TCGplayer lookups (public, rate-limited on the server).
type PriceHit = {
  productId: number;
  name: string;
  setName: string | null;
  line: string | null;
  rarity: string | null;
  number: string | null;
  sealed: boolean;
  marketPrice: number | null;
  lowestPrice: number | null;
  imageUrl: string;
};
type Printing = { printing: string; marketPrice: number | null; listedMedian: number | null };
type LivePrice = {
  id: string;
  inStock: boolean;
  askingPrice: number | null;
  marketValue: number | null;
  tcgpMarketPrice: number | null;
  tcgpListedMedian: number | null;
  tcgpPricedAt: number | null;
  refreshed: boolean;
};
const PRICE_LINES: Array<{ label: string; line: string | null }> = [
  { label: "All games", line: null },
  { label: "Pokémon", line: "Pokemon" },
  { label: "One Piece", line: "One Piece Card Game" },
  { label: "Magic", line: "Magic: The Gathering" },
  { label: "Dragon Ball", line: "Dragon Ball Super CCG" },
  { label: "Yu-Gi-Oh", line: "YuGiOh" },
  { label: "Riftbound", line: "Riftbound" },
];
function agoLabel(unixSec: number | null | undefined): string {
  if (!unixSec) return "";
  const mins = Math.max(0, Math.round((Date.now() / 1000 - unixSec) / 60));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

type SortKey = "featured" | "bestsellers" | "newest" | "price-asc" | "price-desc" | "name";

// ---------- Helpers ----------
const GRADE_RE = /^(PSA|CGC|BGS|SGC|TAG|ACE)\s*([\d.]+)/i;

function gradeLabel(condition: string | null | undefined): string | null {
  if (!condition) return null;
  const m = condition.match(GRADE_RE);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
}

const COND_NAMES: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
  Mint: "Mint",
};

function conditionName(c: string | null | undefined): string {
  if (!c) return "";
  return COND_NAMES[c] ?? c;
}

function categoryLabel(c: string): string {
  if (c === "Raw") return "Singles";
  if (c === "Slab") return "Graded";
  return c;
}

function relativeTime(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds) return null;
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  const d = Math.floor(diff / 86400);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.floor(mo / 12)} yr ago`;
}

const inStock = (l: ShopListing) => l.inStock !== false;

/** In-stock items always sort ahead of sold-out ones. */
function stockFirst(cmp: (a: ShopListing, b: ShopListing) => number) {
  return (a: ShopListing, b: ShopListing) => {
    const sa = inStock(a) ? 0 : 1;
    const sb = inStock(b) ? 0 : 1;
    return sa !== sb ? sa - sb : cmp(a, b);
  };
}

const velocity = (l: ShopListing) => Math.max(l.sold3mo ?? 0, (l.soldPerDay ?? 0) * 90);
const byPriceDesc = stockFirst((a, b) => b.askingPrice - a.askingPrice);
const byBestSellers = stockFirst((a, b) => velocity(b) - velocity(a) || b.askingPrice - a.askingPrice);

/**
 * "Featured" ranking: biggest sellers and top-value items first.
 * Each item gets a percentile rank for price and for sales velocity; the
 * two are averaged so a hot $20 seller and a $3,000 grail both surface.
 */
function rankFeatured(list: ShopListing[]): Map<string, number> {
  const score = new Map<string, number>();
  const n = list.length || 1;
  const byP = [...list].sort((a, b) => a.askingPrice - b.askingPrice);
  const byV = [...list].sort((a, b) => velocity(a) - velocity(b));
  const anyVelocity = list.some((l) => velocity(l) > 0);
  byP.forEach((l, i) => score.set(l.id, (i + 1) / n));
  if (anyVelocity) {
    byV.forEach((l, i) => {
      const v = velocity(l) > 0 ? (i + 1) / n : 0;
      score.set(l.id, (score.get(l.id) ?? 0) * 0.5 + v * 0.5 + (velocity(l) > 0 ? 0.05 : 0));
    });
  }
  return score;
}
const byPriceAsc = stockFirst((a, b) => a.askingPrice - b.askingPrice);
const byNewest = stockFirst((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
const byName = stockFirst((a, b) => a.name.localeCompare(b.name));

// ---------- Page ----------
export default function ShopPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isSignedIn = !!user;
  const { toast } = useToast();

  const { data: listings = [], isLoading } = useQuery<ShopListing[]>({
    queryKey: [LISTINGS_URL],
  });

  const { data: live } = useQuery<LiveStatus | null>({
    queryKey: ["/api/live", "shop"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/live", { credentials: "include" });
        if (!res.ok) return null;
        return (await res.json()) as LiveStatus;
      } catch {
        return null;
      }
    },
    refetchInterval: 60_000,
  });

  // Vault filters
  const [search, setSearch] = useState("");
  const [hideSoldOut, setHideSoldOut] = useState(false);
  const [franchiseFilter, setFranchiseFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [conditionFilter, setConditionFilter] = useState<string>("all");
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("featured");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [buyTarget, setBuyTarget] = useState<ShopListing | null>(null);
  const [tradeTarget, setTradeTarget] = useState<ShopListing | null>(null);

  const vaultRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tradeRef = useRef<HTMLElement>(null);
  const showsRef = useRef<HTMLElement>(null);

  // Reset pagination when filters change
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [search, franchiseFilter, categoryFilter, conditionFilter, minPrice, maxPrice, sort, hideSoldOut]);

  // "Find in our shop" from the card lookup / scanner: search the vault for it.
  useEffect(() => {
    const onFind = (e: Event) => {
      const q = String((e as CustomEvent<{ q?: string }>).detail?.q ?? "").trim();
      if (!q) return;
      setSearch(q);
      setFranchiseFilter([]);
      setCategoryFilter("all");
      setConditionFilter("all");
      setMinPrice("");
      setMaxPrice("");
      setHideSoldOut(false);
      requestAnimationFrame(() => {
        vaultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        searchRef.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("pc:find-in-shop", onFind);
    return () => window.removeEventListener("pc:find-in-shop", onFind);
  }, []);

  // Derived data ---------------------------------------------------------
  const available = useMemo(() => listings.filter(inStock), [listings]);

  // "Hot seller" = in-stock items in the top 15% of TCGplayer sales velocity
  // (and selling at least a copy a week).
  const hotIds = useMemo(() => {
    const withV = available.filter((l) => velocity(l) >= 12).sort((a, b) => velocity(b) - velocity(a));
    const take = Math.max(0, Math.min(withV.length, Math.ceil(available.length * 0.15)));
    return new Set(withV.slice(0, take).map((l) => l.id));
  }, [available]);
  const bestSellers = useMemo(() => available.filter((l) => hotIds.has(l.id)).sort(byBestSellers).slice(0, 12), [available, hotIds]);
  const soldOutCount = listings.length - available.length;

  const franchises = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of available) {
      if (!l.franchise || l.franchise === "Other") continue;
      counts.set(l.franchise, (counts.get(l.franchise) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [available]);

  const sealed = useMemo(() => listings.filter((l) => l.category === "Sealed").sort(byPriceDesc), [listings]);
  const slabs = useMemo(() => listings.filter((l) => l.category === "Slab").sort(byPriceDesc), [listings]);
  const singles = useMemo(() => listings.filter((l) => l.category === "Raw").sort(byPriceDesc), [listings]);
  const newest = useMemo(() => [...listings].filter((l) => l.createdAt).sort(byNewest).slice(0, 12), [listings]);
  const onePiece = useMemo(() => listings.filter((l) => l.franchise === "One Piece").sort(byPriceDesc), [listings]);
  const pokemon = useMemo(() => listings.filter((l) => l.franchise === "Pokémon").sort(byPriceDesc), [listings]);
  const deals = useMemo(
    () =>
      available
        .filter((l) => l.marketValue != null && l.marketValue > 0 && l.askingPrice < l.marketValue)
        .sort((a, b) => (b.marketValue! - b.askingPrice) / b.marketValue! - (a.marketValue! - a.askingPrice) / a.marketValue!),
    [available]
  );

  const topWithPhoto = (arr: ShopListing[]) => arr.find((l) => inStock(l) && !!l.imageUrl) ?? arr.find(inStock) ?? null;
  const featureTabs = useMemo(() => {
    const tabs: { key: string; label: string; item: ShopListing | null }[] = [
      { key: "pull", label: "Top Pull", item: topWithPhoto(singles) },
      { key: "slab", label: "Top Slab", item: topWithPhoto(slabs) },
      { key: "sealed", label: "Top Sealed", item: topWithPhoto(sealed) },
    ];
    return tabs.filter((t) => t.item);
  }, [singles, slabs, sealed]);
  const [featureKey, setFeatureKey] = useState<string>("pull");
  const feature = featureTabs.find((t) => t.key === featureKey) ?? featureTabs[0] ?? null;

  const latest = newest.find(inStock) ?? null;

  const stats = useMemo(() => {
    const totalQty = available.reduce((sum, l) => sum + (l.qty || 0), 0);
    return {
      totalQty,
      franchiseCount: franchises.length,
      sealedCount: sealed.filter(inStock).length,
      slabCount: slabs.filter(inStock).length,
      singlesCount: singles.filter(inStock).length,
    };
  }, [available, franchises, sealed, slabs, singles]);

  // ---- Real-time prices for whatever is on screen ----
  // Every time the visible slice changes (and every 60 s while the tab is in
  // the foreground) ask the server to re-pull those cards from TCGplayer and
  // merge the fresh prices into the listings cache in place.
  const [pricesAt, setPricesAt] = useState<number | null>(null);
  const visibleIdsRef = useRef<string[]>([]);
  const lastRunRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const refreshVisible = useCallback(async (force = false) => {
    const ids = visibleIdsRef.current;
    if (!ids.length || document.visibilityState === "hidden") return;
    const key = ids.join(",");
    if (!force && lastRunRef.current.key === key && Date.now() - lastRunRef.current.at < 30_000) return;
    lastRunRef.current = { key, at: Date.now() };
    try {
      const res = await fetch(`${API_BASE}/api/shop/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const fresh: LivePrice[] = Array.isArray(data?.prices) ? data.prices : [];
      if (!fresh.length) return;
      const byId = new Map(fresh.map((p) => [p.id, p]));
      queryClient.setQueryData<ShopListing[]>([LISTINGS_URL], (prev) =>
        prev
          ? prev.map((l) => {
              const p = byId.get(l.id);
              if (!p) return l;
              return {
                ...l,
                askingPrice: p.askingPrice ?? l.askingPrice,
                marketValue: p.marketValue ?? l.marketValue,
                tcgpMarketPrice: p.tcgpMarketPrice,
                tcgpPricedAt: p.tcgpPricedAt,
                inStock: p.inStock,
              };
            })
          : prev
      );
      setPricesAt(Date.now());
    } catch {
      /* offline / preview — keep cached prices */
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);
    const out = listings.filter((l) => {
      if (hideSoldOut && !inStock(l)) return false;
      if (q && !`${l.name} ${l.setName} ${l.rarity ?? ""} ${l.franchise}`.toLowerCase().includes(q)) return false;
      if (franchiseFilter.length && !franchiseFilter.includes(l.franchise)) return false;
      if (categoryFilter !== "all" && l.category !== categoryFilter) return false;
      if (conditionFilter !== "all" && l.condition !== conditionFilter) return false;
      if (!isNaN(min) && l.askingPrice < min) return false;
      if (!isNaN(max) && l.askingPrice > max) return false;
      return true;
    });
    switch (sort) {
      case "newest":
        out.sort(byNewest);
        break;
      case "price-asc":
        out.sort(byPriceAsc);
        break;
      case "price-desc":
        out.sort(byPriceDesc);
        break;
      case "bestsellers":
        out.sort(byBestSellers);
        break;
      case "featured": {
        const rank = rankFeatured(listings);
        out.sort(stockFirst((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0)));
        break;
      }
      case "name":
        out.sort(byName);
        break;
    }
    return out;
  }, [listings, search, franchiseFilter, categoryFilter, conditionFilter, minPrice, maxPrice, sort, hideSoldOut]);

  const visibleKey = filtered.slice(0, visible).map((l) => l.id).join(",");
  useEffect(() => {
    visibleIdsRef.current = visibleKey ? visibleKey.split(",").slice(0, 24) : [];
    const t = setTimeout(() => refreshVisible(false), 800);
    return () => clearTimeout(t);
  }, [visibleKey, refreshVisible]);
  useEffect(() => {
    const iv = setInterval(() => refreshVisible(true), 60_000);
    const onVis = () => { if (document.visibilityState === "visible") refreshVisible(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [refreshVisible]);

  const hasAnyListings = listings.length > 0;
  const activeFilterCount =
    franchiseFilter.length +
    (categoryFilter !== "all" ? 1 : 0) +
    (conditionFilter !== "all" ? 1 : 0) +
    (minPrice ? 1 : 0) +
    (maxPrice ? 1 : 0) +
    (hideSoldOut ? 1 : 0) +
    (search ? 1 : 0);

  // Actions -------------------------------------------------------------
  function resetFilters() {
    setSearch("");
    setFranchiseFilter([]);
    setCategoryFilter("all");
    setConditionFilter("all");
    setMinPrice("");
    setMaxPrice("");
    setSort("featured");
    setHideSoldOut(false);
  }

  function toggleFranchise(f: string) {
    setFranchiseFilter((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  function scrollToVault() {
    vaultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToShows() {
    setMobileNavOpen(false);
    showsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToTrade() {
    tradeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Jump into the vault pre-filtered (used by nav, category tiles and "View all"). */
  function browse(opts: { category?: string; franchise?: string; sort?: SortKey } = {}) {
    resetFilters();
    if (opts.category) setCategoryFilter(opts.category);
    if (opts.franchise) setFranchiseFilter([opts.franchise]);
    if (opts.sort) setSort(opts.sort);
    setMobileNavOpen(false);
    // Let state settle before scrolling so the grid has re-rendered.
    requestAnimationFrame(() => scrollToVault());
  }

  function focusSearch() {
    scrollToVault();
    setTimeout(() => searchRef.current?.focus(), 350);
  }

  const navItems: { label: string; onClick: () => void }[] = [
    { label: "Sealed", onClick: () => browse({ category: "Sealed" }) },
    { label: "Singles", onClick: () => browse({ category: "Raw" }) },
    { label: "Graded", onClick: () => browse({ category: "Slab" }) },
    ...franchises.slice(0, 3).map((f) => ({ label: f.name === "Magic The Gathering" ? "Magic" : f.name, onClick: () => browse({ franchise: f.name }) })),
    { label: "New Arrivals", onClick: () => browse({ sort: "newest" }) },
    { label: "Shows", onClick: scrollToShows },
    { label: "Sell & Trade", onClick: () => { setMobileNavOpen(false); scrollToTrade(); } },
  ];
  // Shows: admin-managed list (Admin → Shop settings) with the built-in list as fallback.
  const { data: remoteShows } = useQuery<CardShow[] | null>({
    queryKey: ["/api/shop/shows", "shop"],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/shop/shows`, { credentials: "omit" });
        if (!res.ok) return null;
        const j = await res.json();
        return Array.isArray(j?.shows) ? (j.shows as CardShow[]) : null;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
  });
  const { upcoming: upcomingShows, past: pastShows } = useMemo(() => splitShows(undefined, remoteShows ?? undefined), [remoteShows]);

  const liveUrl = live?.url || TIKTOK_URL;
  const livePlatform = (live?.platform || "tiktok").toLowerCase();
  const livePlatformName = livePlatform === "tiktok" ? "TikTok" : livePlatform.charAt(0).toUpperCase() + livePlatform.slice(1);

  // Render ---------------------------------------------------------------
  return (
    <div className="pc min-h-screen">
      {/* ============ ANNOUNCEMENT BAR ============ */}
      <div className="pc-announce">
        <div className="pc-container py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {live?.isLive ? (
              <>
                <span className="pc-live-dot shrink-0" aria-hidden />
                <div className="min-w-0 leading-tight">
                  <div className="pc-announce-eyebrow">Live now on {livePlatformName}</div>
                  <div className="pc-font font-semibold text-[15px] sm:text-base truncate">{live.title || "Live pulls — come hang out"}</div>
                </div>
              </>
            ) : (
              <>
                <Flame className="h-4 w-4 shrink-0 text-amber-200" aria-hidden />
                <div className="min-w-0 leading-tight">
                  <div className="pc-announce-eyebrow">Live pulls &amp; new drops</div>
                  <div className="pc-font font-semibold text-[15px] sm:text-base truncate">
                    Follow {BRAND_HANDLE} on TikTok for live pulls, drops and giveaways
                  </div>
                </div>
              </>
            )}
          </div>
          <a
            href={live?.isLive ? liveUrl : TIKTOK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="pc-btn pc-btn-sm pc-btn-white shrink-0"
            data-testid="link-announce-cta"
          >
            {live?.isLive ? "Watch live" : "Follow"} <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* ============ HEADER ============ */}
      <header className="pc-header sticky top-0 z-40">
        {/* micro strip */}
        <div className="hidden md:block border-b border-white/10">
          <div className="pc-container h-9 flex items-center justify-between text-[13px] text-white/80">
            <div className="flex items-center gap-5">
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> California · Ships nationwide</span>
              <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Orders ship within 48 hours</span>
            </div>
            <div className="flex items-center gap-1">
              <a href="#/faq" className="pc-strip-link" data-testid="link-faq">FAQ</a>
              <a href="#/about" className="pc-strip-link" data-testid="link-about">About</a>
              <span className="mx-1 h-4 w-px bg-white/20" aria-hidden />
              <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" aria-label={`${BRAND_HANDLE} on TikTok`} className="pc-icon-btn !h-8 !w-8"><SiTiktok className="h-3.5 w-3.5" /></a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label={`${BRAND_HANDLE} on Instagram`} className="pc-icon-btn !h-8 !w-8"><SiInstagram className="h-3.5 w-3.5" /></a>
            </div>
          </div>
        </div>
        {/* main row */}
        <div className="pc-container h-[72px] flex items-center justify-between gap-4">
          <a href="#/" className="flex items-center gap-3 shrink-0" aria-label="Chris Collects Co home">
            <img src="/logo-96.png" alt="" width={44} height={44} className="h-11 w-11 rounded-lg object-cover ring-1 ring-white/15" />
            <span className="pc-wordmark">
              Chris Collects
              <small>Co</small>
            </span>
          </a>
          <nav className="pc-nav hidden xl:flex items-center gap-0.5" aria-label="Shop">
            {navItems.map((n) => (
              <button key={n.label} onClick={n.onClick} data-testid={`nav-${n.label.replace(/\s+/g, "-").toLowerCase()}`}>
                {n.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <button className="pc-icon-btn" onClick={focusSearch} aria-label="Search the shop" data-testid="button-nav-search">
              <Search className="h-5 w-5" />
            </button>
            {isAdmin ? (
              <a href="#/admin" className="pc-icon-btn" aria-label="Open admin dashboard" title="Admin" data-testid="link-nav-admin">
                <LayoutDashboard className="h-5 w-5" />
              </a>
            ) : (
              <a
                href={isSignedIn ? "#/admin" : "#/login?next=/admin"}
                className="pc-icon-btn"
                aria-label="Owner sign in"
                title="Owner sign in"
                data-testid="link-nav-signin"
              >
                <UserRound className="h-5 w-5" />
              </a>
            )}
            <button onClick={() => browse()} className="pc-btn pc-btn-sm pc-btn-red !hidden sm:!inline-flex" data-testid="button-nav-shop">
              <ShoppingBag className="h-4 w-4" /> Shop all
            </button>
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <button className="pc-icon-btn xl:!hidden" aria-label="Open menu" data-testid="button-nav-menu">
                  <Menu className="h-6 w-6" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="pc pc-dialog w-[86vw] sm:w-[380px]">
                <SheetHeader>
                  <SheetTitle className="pc-font text-2xl font-bold">Shop</SheetTitle>
                </SheetHeader>
                <div className="mt-6 grid gap-1">
                  {navItems.map((n) => (
                    <button
                      key={n.label}
                      onClick={n.onClick}
                      className="pc-font text-left text-lg font-semibold py-3 px-3 rounded-lg hover:bg-black/5 flex items-center justify-between"
                    >
                      {n.label} <ChevronRight className="h-5 w-5 text-neutral-400" />
                    </button>
                  ))}
                  <div className="my-2 h-px bg-black/10" aria-hidden />
                  {[{ label: "FAQ", href: "#/faq" }, { label: "About", href: "#/about" }].map((l) => (
                    <a key={l.href} href={l.href} onClick={() => setMobileNavOpen(false)} className="pc-font text-left text-lg font-semibold py-3 px-3 rounded-lg hover:bg-black/5 flex items-center justify-between" data-testid={`drawer-link-${l.label.toLowerCase()}`}>
                      {l.label} <ChevronRight className="h-5 w-5 text-neutral-400" />
                    </a>
                  ))}
                </div>
                <div className="mt-8 flex gap-2">
                  <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-black flex-1"><SiTiktok className="h-4 w-4" /> TikTok</a>
                  <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-outline flex-1"><SiInstagram className="h-4 w-4" /> Instagram</a>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* ============ CATEGORY CIRCLES ============ */}
      <section className="bg-white border-b border-[var(--pc-line)]">
        <div className="pc-container pt-7 pb-6">
          <div className="text-center">
            <span className="pc-kicker">Chris Collects Co · California</span>
            <h1 className="mt-2 text-[1.6rem] sm:text-[2.1rem] tracking-tight">
              Pulled live. Shipped fast. <span className="pc-accent">Traded fair.</span>
            </h1>
          </div>
          <div className="mt-5 grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-8 gap-x-2 gap-y-3">
            <CategoryTile label="Sell Cards" count={null} icon={<ArrowLeftRight className="h-7 w-7" />} glow="rgba(34,197,94,0.25)" badge={{ text: "Trade", tone: "green" }} onClick={scrollToTrade} />
            <CategoryTile label="New Arrivals" count={newest.length || null} image={topWithPhoto(newest)?.imageUrl} glow="rgba(59,130,246,0.25)" badge={{ text: "New", tone: "green" }} onClick={() => browse({ sort: "newest" })} />
            <CategoryTile label="Sealed" count={sealed.length} image={topWithPhoto(sealed)?.imageUrl} glow="rgba(59,91,219,0.25)" onClick={() => browse({ category: "Sealed" })} />
            <CategoryTile label="Singles" count={singles.length} image={topWithPhoto(singles)?.imageUrl} glow="rgba(220,38,38,0.22)" onClick={() => browse({ category: "Raw" })} />
            <CategoryTile label="Graded" count={slabs.length} image={topWithPhoto(slabs)?.imageUrl} glow="rgba(245,179,1,0.3)" badge={slabs.length ? { text: "Hot", tone: "red" } : undefined} onClick={() => browse({ category: "Slab" })} />
            <CategoryTile label="Pokémon" count={pokemon.length} image={topWithPhoto(pokemon)?.imageUrl} glow="rgba(245,179,1,0.25)" onClick={() => browse({ franchise: "Pokémon" })} />
            <CategoryTile label="One Piece" count={onePiece.length} image={topWithPhoto(onePiece)?.imageUrl} glow="rgba(220,38,38,0.22)" onClick={() => browse({ franchise: "One Piece" })} />
            <CategoryTile label="Deals" count={deals.length || null} image={topWithPhoto(deals)?.imageUrl} icon={<Zap className="h-7 w-7" />} glow="rgba(34,197,94,0.25)" onClick={() => browse({ sort: "price-asc" })} />
          </div>
        </div>
      </section>

      {/* ============ FEATURE + TILES ============ */}
      <section className="pc-dark">
        <div className="pc-container py-6 sm:py-8 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* Feature card */}
          <div className="pc-feature grid md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] min-w-0">
            <div className="pc-feature-media min-h-[300px]">
              {feature?.item ? (
                <FeatureImage listing={feature.item} />
              ) : isLoading ? (
                <div className="h-[280px] w-[200px] pc-skeleton opacity-20" />
              ) : (
                <Sparkles className="h-16 w-16 text-white/40" />
              )}
            </div>
            <div className="p-6 sm:p-7 flex flex-col">
              {featureTabs.length > 1 && (
                <div className="pc-tabs">
                  {featureTabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setFeatureKey(t.key)}
                      className={cn("pc-tab", feature?.key === t.key && "is-active")}
                      data-testid={`tab-feature-${t.key}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              {feature?.item ? (
                <>
                  <div className="mt-5 pc-font text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
                    {feature.label} · {feature.item.franchise}
                  </div>
                  <h2 className="mt-1.5 text-[1.6rem] sm:text-[2rem] leading-tight">{feature.item.name}</h2>
                  <div className="mt-1 text-sm text-white/70 pc-body">
                    {feature.item.setName}
                    {feature.item.condition ? ` · ${gradeLabel(feature.item.condition) ?? conditionName(feature.item.condition)}` : ""}
                    {feature.item.rarity ? ` · ${feature.item.rarity}` : ""}
                  </div>
                  <div className="mt-5 flex items-center gap-3 flex-wrap">
                    <span className="pc-price text-[2rem]" data-testid="text-feature-price">{formatCurrency(feature.item.askingPrice)}</span>
                    {feature.item.marketValue != null && feature.item.marketValue > feature.item.askingPrice && (
                      <span className="pc-tag pc-tag-deal">Below market · mkt {formatCurrency(feature.item.marketValue)}</span>
                    )}
                    {feature.item.qty <= 2 && <span className="pc-tag pc-tag-hot">Only {feature.item.qty} left</span>}
                  </div>
                  <div className="mt-6 flex gap-2 flex-wrap">
                    <button onClick={() => setBuyTarget(feature.item!)} className="pc-btn pc-btn-red" data-testid="button-feature-buy">
                      <ShoppingBag className="h-4 w-4" /> Request to buy
                    </button>
                    <button onClick={() => setTradeTarget(feature.item!)} className="pc-btn pc-btn-ghost-dark" data-testid="button-feature-trade">
                      <ArrowLeftRight className="h-4 w-4" /> Propose a trade
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-5">
                  <h2 className="text-2xl">New drops coming soon</h2>
                  <p className="mt-2 text-white/70 text-sm pc-body">Follow {BRAND_HANDLE} for pulls, drops and early access.</p>
                </div>
              )}
              <div className="mt-auto pt-6 text-xs text-white/60 pc-body">
                Live TCGplayer market pricing · refreshes while you browse
              </div>
            </div>
          </div>

          {/* Side tiles */}
          <div className="grid gap-3 content-start min-w-0">
            <button className="pc-tile" onClick={scrollToTrade} data-testid="tile-trade">
              <span className="pc-tile-icon bg-emerald-500/20 text-emerald-300"><ArrowLeftRight className="h-6 w-6" /></span>
              <span>
                <h3>Sell &amp; Trade Your Cards</h3>
                <p>Pick any card in the vault and propose a trade. Personal counter within 24 hours.</p>
              </span>
              <span className="pc-tile-go"><ArrowRight className="h-4 w-4" /></span>
            </button>
            <a className="pc-tile" href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" data-testid="tile-live">
              <span className="pc-tile-icon bg-red-500/20 text-red-300"><Radio className="h-6 w-6" /></span>
              <span>
                <h3>Live Pulls on TikTok</h3>
                <p>{BRAND_HANDLE} · Watch rips, grails and giveaways live.</p>
              </span>
              <span className="pc-tile-go"><ArrowRight className="h-4 w-4" /></span>
            </a>
            <a className="pc-tile" href="#promise" data-testid="tile-guarantee">
              <span className="pc-tile-icon bg-amber-400/20 text-amber-300"><ShieldCheck className="h-6 w-6" /></span>
              <span>
                <h3>100% Satisfaction Guarantee</h3>
                <p>Not exactly as described? Full refund, no questions asked.</p>
              </span>
              <span className="pc-tile-go"><ArrowRight className="h-4 w-4" /></span>
            </a>
            {latest && (
              <button className="pc-tile !border-amber-400/40" onClick={() => setBuyTarget(latest)} data-testid="tile-latest">
                <span className="pc-tile-icon bg-amber-400/15 overflow-hidden">
                  <CardThumb imageUrl={latest.imageUrl} franchise={latest.franchise} size="lg" className="h-full w-full" />
                </span>
                <span className="min-w-0">
                  <span className="pc-font text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300">Latest listing</span>
                  <h3 className="truncate">{latest.name}</h3>
                  <p className="truncate">{latest.setName} · {formatCurrency(latest.askingPrice)}{relativeTime(latest.createdAt) ? ` · ${relativeTime(latest.createdAt)}` : ""}</p>
                </span>
                <span className="pc-tile-go"><ArrowRight className="h-4 w-4" /></span>
              </button>
            )}
          </div>
        </div>
        {/* stats strip */}
        <div className="border-t border-white/10">
          <div className="pc-container py-4 flex md:grid md:grid-cols-5 gap-x-6 gap-y-3 justify-between overflow-x-auto [scrollbar-width:none] text-center">
            {[
              { n: hasAnyListings ? stats.totalQty.toLocaleString() : "—", l: "Cards in stock" },
              { n: hasAnyListings ? `${stats.franchiseCount}` : "—", l: "TCGs supported" },
              { n: hasAnyListings ? `${stats.sealedCount}` : "—", l: "Sealed products" },
              { n: hasAnyListings ? `${stats.slabCount}` : "—", l: "Graded slabs" },
              { n: "48 hrs", l: "Ship time" },
            ].map((s) => (
              <div key={s.l} className="shrink-0" data-testid={`stat-${s.l.replace(/\s+/g, "-").toLowerCase()}`}>
                <div className="pc-font text-2xl font-bold tabular-nums">{s.n}</div>
                <div className="pc-font text-[11px] uppercase tracking-[0.16em] text-white/60 font-medium">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="pc-rainbow-rule" aria-hidden />

      {/* ============ SHELVES ============ */}
      {isLoading && (
        <section className="bg-white">
          <div className="pc-container py-10">
            <div className="h-9 w-64 pc-skeleton mb-6" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] pc-skeleton" />
              ))}
            </div>
          </div>
        </section>
      )}

      {newest.length > 0 && (
        <Shelf
          tone="light"
          pill={<span className="pc-pill pc-pill-dark pc-pill-dot">Just landed</span>}
          title="Fresh Arrivals"
          subtitle="The newest cards and sealed product to hit the shelf."
          items={newest}
          count={listings.length}
          viewAllLabel="View all · newest first"
          onViewAll={() => browse({ sort: "newest" })}
          onBuy={setBuyTarget}
          onTrade={setTradeTarget}
          hotIds={hotIds}
          showNewTag
        />
      )}

      {bestSellers.length >= 4 && (
        <Shelf
          tone="paper"
          pill={<span className="pc-pill pc-pill-red"><Flame className="h-3.5 w-3.5" /> Moving fast</span>}
          title="Best Sellers"
          subtitle="The cards and product collectors are buying most right now, by TCGplayer sales volume."
          items={bestSellers}
          count={hotIds.size}
          viewAllLabel="View all best sellers"
          onViewAll={() => browse({ sort: "bestsellers" })}
          onBuy={setBuyTarget}
          onTrade={setTradeTarget}
          hotIds={hotIds}
        />
      )}

      {sealed.length > 0 && (
        <Shelf
          tone="paper"
          pill={<span className="pc-pill pc-pill-blue"><Package className="h-3.5 w-3.5" /> Sealed</span>}
          title="Booster Boxes, ETBs & Tins"
          subtitle="Factory sealed product, stored and shipped with care."
          items={sealed.slice(0, 12)}
          count={sealed.length}
          onViewAll={() => browse({ category: "Sealed" })}
          onBuy={setBuyTarget}
          onTrade={setTradeTarget}
          hotIds={hotIds}
        />
      )}

      {slabs.length > 0 && (
        <Shelf
          tone="dark"
          pill={<span className="pc-pill pc-pill-gold"><Gem className="h-3.5 w-3.5" /> Graded</span>}
          title="Graded Slabs"
          subtitle="Authenticated and graded slabs, ready to ship."
          items={slabs.slice(0, 12)}
          count={slabs.length}
          onViewAll={() => browse({ category: "Slab" })}
          onBuy={setBuyTarget}
          onTrade={setTradeTarget}
          hotIds={hotIds}
          gold
        />
      )}

      {singles.length > 0 && (
        <Shelf
          tone="dark"
          binder
          pill={<span className="pc-pill pc-pill-red"><Layers className="h-3.5 w-3.5" /> Singles</span>}
          title="Raw Singles"
          subtitle="Hand-inspected singles. Images shown are of the actual card."
          items={singles.slice(0, 12)}
          count={singles.length}
          onViewAll={() => browse({ category: "Raw" })}
          onBuy={setBuyTarget}
          onTrade={setTradeTarget}
          hotIds={hotIds}
        />
      )}

      {onePiece.length > 0 && (
        <Shelf
          tone="light"
          pill={<span className="pc-pill pc-pill-dark">One Piece</span>}
          title="One Piece TCG"
          subtitle="Leaders, alt arts and sealed product from the Grand Line."
          items={onePiece.slice(0, 12)}
          count={onePiece.length}
          onViewAll={() => browse({ franchise: "One Piece" })}
          onBuy={setBuyTarget}
          onTrade={setTradeTarget}
          hotIds={hotIds}
        />
      )}

      {/* ============ THE VAULT (full catalog) ============ */}
      <section ref={vaultRef} className="pc-paper-bg scroll-mt-[72px] border-t border-[var(--pc-line)]" id="vault">
        <div className="pc-container py-10 sm:py-14">
          <div className="pc-sec-head">
            <div>
              <div className="pc-sec-title">
                <span className="pc-pill pc-pill-dark"><Layers className="h-3.5 w-3.5" /> The Vault</span>
                <h2>Shop Everything</h2>
              </div>
              <p className="pc-sec-sub">
                {hasAnyListings ? `${listings.length.toLocaleString()} listings across ${stats.franchiseCount} games. Live market pricing on every card.` : "Inventory is loading."}
              </p>
            </div>
            <div className="text-sm text-neutral-600 pc-body text-right">
              <div data-testid="text-vault-count">
                Showing <b className="pc-font text-base text-neutral-900">{Math.min(visible, filtered.length)}</b> of <b className="pc-font text-base text-neutral-900">{filtered.length}</b>
              </div>
              {pricesAt && (
                <div className="pc-live-prices" data-testid="text-live-prices">
                  <span className="pc-live-dot" aria-hidden /> Live TCGplayer prices · synced {agoLabel(Math.floor(pricesAt / 1000))}
                </div>
              )}
            </div>
          </div>

          {/* Filter bar */}
          <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] items-end">
            <div>
              <label htmlFor="shop-search" className="pc-field-label">Search</label>
              <div className="relative mt-1.5">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                <input
                  id="shop-search"
                  ref={searchRef}
                  data-testid="input-shop-search"
                  placeholder="Card name, set, rarity, game…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pc-input !pl-10"
                />
              </div>
            </div>
            <div>
              <label className="pc-field-label">Type</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-11 w-full lg:w-[140px] mt-1.5 rounded-lg bg-white" data-testid="select-shop-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="pc">
                  <SelectItem value="all">All types</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="pc-field-label">Condition</label>
              <Select value={conditionFilter} onValueChange={setConditionFilter}>
                <SelectTrigger className="h-11 w-full lg:w-[150px] mt-1.5 rounded-lg bg-white" data-testid="select-shop-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="pc">
                  <SelectItem value="all">Any condition</SelectItem>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:contents">
              <div className="lg:w-[110px]">
                <label htmlFor="shop-min" className="pc-field-label">Min $</label>
                <input id="shop-min" type="number" inputMode="decimal" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="0" className="pc-input mt-1.5 tabular-nums" data-testid="input-shop-min-price" />
              </div>
              <div className="lg:w-[110px]">
                <label htmlFor="shop-max" className="pc-field-label">Max $</label>
                <input id="shop-max" type="number" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Any" className="pc-input mt-1.5 tabular-nums" data-testid="input-shop-max-price" />
              </div>
            </div>
            <div>
              <label className="pc-field-label">Sort</label>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger className="h-11 w-full lg:w-[170px] mt-1.5 rounded-lg bg-white" data-testid="select-shop-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="pc">
                  <SelectItem value="featured">Featured: top items &amp; best sellers</SelectItem>
                  <SelectItem value="bestsellers">Best sellers</SelectItem>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="price-asc">Price: low to high</SelectItem>
                  <SelectItem value="price-desc">Price: high to low</SelectItem>
                  <SelectItem value="name">Name A–Z</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Game chips */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            <button
              onClick={() => setFranchiseFilter([])}
              className={cn("pc-chip", franchiseFilter.length === 0 && "is-active")}
              data-testid="pill-franchise-all"
            >
              All games <span className="pc-chip-count">{listings.length}</span>
            </button>
            {franchises.map((f) => {
              const active = franchiseFilter.includes(f.name);
              return (
                <button key={f.name} onClick={() => toggleFranchise(f.name)} className={cn("pc-chip", active && "is-active")} data-testid={`pill-franchise-${f.name}`}>
                  {f.name} <span className="pc-chip-count">{f.count}</span>
                </button>
              );
            })}
            {soldOutCount > 0 && (
              <button
                onClick={() => setHideSoldOut((v) => !v)}
                className={cn("pc-chip", hideSoldOut && "is-active")}
                aria-pressed={hideSoldOut}
                data-testid="pill-hide-soldout"
              >
                {hideSoldOut ? "Showing in stock only" : "Hide sold out"} <span className="pc-chip-count">{soldOutCount}</span>
              </button>
            )}
            {activeFilterCount > 0 && (
              <button onClick={resetFilters} className="pc-chip !border-red-300 !text-red-700" data-testid="button-shop-reset">
                <X className="h-3.5 w-3.5" /> Clear ({activeFilterCount})
              </button>
            )}
          </div>

          {/* Grid */}
          <div className="mt-6">
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="aspect-[3/4] pc-skeleton" />
                ))}
              </div>
            ) : filtered.length > 0 ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {filtered.slice(0, visible).map((l) => (
                    <ProductCard key={l.id} listing={l} onBuy={() => setBuyTarget(l)} onTrade={() => setTradeTarget(l)} hot={hotIds.has(l.id)} />
                  ))}
                </div>
                {visible < filtered.length && (
                  <div className="mt-8 flex flex-col items-center gap-2">
                    <button onClick={() => setVisible((v) => v + PAGE_SIZE)} className="pc-btn pc-btn-black px-8" data-testid="button-show-more">
                      Show more <ArrowRight className="h-4 w-4" />
                    </button>
                    <div className="text-xs text-neutral-500 pc-body">{filtered.length - visible} more to load</div>
                  </div>
                )}
              </>
            ) : hasAnyListings ? (
              <EmptyFilters onReset={resetFilters} />
            ) : (
              <EmptyNoListings />
            )}
          </div>
        </div>
      </section>

      {/* ============ UPCOMING SHOWS ============ */}
      <section ref={showsRef} id="shows" className="pc-shows scroll-mt-[72px]">
        <div className="pc-container py-12 sm:py-16">
          <div className="pc-sec-head">
            <div>
              <div className="pc-sec-title">
                <span className="pc-pill pc-pill-red"><Tent className="h-3.5 w-3.5" /> On the road</span>
              </div>
              <h2 className="mt-3 text-[2rem] sm:text-[2.6rem]">Upcoming Shows</h2>
              <p className="pc-sec-sub max-w-[52ch]">
                Catch Chris Collects Co vending around Northern California. Bring your binder: we buy, sell and trade at every table.
              </p>
            </div>
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-outline" data-testid="link-shows-instagram">
              <SiInstagram className="h-4 w-4" /> Show announcements
            </a>
          </div>

          {upcomingShows.length > 0 ? (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="list-shows-upcoming">
              {upcomingShows.map((s, i) => (
                <ShowCard key={`${s.name}-${s.start}`} show={s} next={i === 0} />
              ))}
            </div>
          ) : (
            <div className="pc-shows-empty mt-8" data-testid="shows-empty">
              <span className="pc-shows-empty-icon"><CalendarDays className="h-6 w-6" /></span>
              <div className="min-w-0">
                <h3 className="text-xl">Next show: TBA</h3>
                <p className="pc-body text-[15px] mt-1 text-neutral-600">
                  New dates drop on Instagram first. Follow {BRAND_HANDLE} or ask on a live and we&apos;ll tell you where the table is next.
                </p>
              </div>
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-red sm:ml-auto shrink-0" data-testid="button-shows-follow">
                Follow for dates <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          )}

          {pastShows.length > 0 && (
            <div className="mt-10">
              <div className="flex items-center gap-3">
                <h3 className="text-base uppercase tracking-[0.14em] text-neutral-500">Where we&apos;ve been</h3>
                <span className="h-px flex-1 bg-[var(--pc-line)]" />
              </div>
              <div className="pc-shows-past mt-4" data-testid="list-shows-past">
                {pastShows.slice(0, 8).map((s) => {
                  const d = showDateParts(s);
                  return (
                    <div key={`${s.name}-${s.start}`} className="pc-show-past">
                      <span className="pc-show-past-date">{d.month} {d.day}</span>
                      <span className="pc-show-past-name">{s.name}</span>
                      <span className="pc-show-past-city">{s.city}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ============ SELL & TRADE ============ */}
      <section ref={tradeRef} id="trade" className="pc-dark scroll-mt-[72px]">
        <div className="pc-container py-12 sm:py-16 grid gap-8 lg:grid-cols-[1.1fr_1fr] items-start">
          <div>
            <span className="pc-pill pc-pill-red"><ArrowLeftRight className="h-3.5 w-3.5" /> Sell &amp; Trade</span>
            <h2 className="mt-4 text-[2rem] sm:text-[2.6rem]">Buy, Sell &amp; Trade Cards With a Collector</h2>
            <p className="mt-3 text-white/75 pc-body max-w-xl leading-relaxed">
              Every trade is reviewed by Chris, not a script. Pick a card from the vault, tell us what you've got, add photos, and you'll get a personal counter within 24 hours.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="pc-step"><b>1</b> Pick a card you want</span>
              <span className="pc-step"><b>2</b> Describe &amp; photograph your offer</span>
              <span className="pc-step"><b>3</b> Get a counter within 24 hrs</span>
            </div>
            <div className="mt-7 flex gap-2 flex-wrap">
              <button onClick={() => browse()} className="pc-btn pc-btn-red" data-testid="button-trade-browse">
                Browse the vault <ArrowRight className="h-4 w-4" />
              </button>
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-ghost-dark">
                <SiInstagram className="h-4 w-4" /> DM us on Instagram
              </a>
            </div>
          </div>

          <SellCalculator />

          <div className="grid sm:grid-cols-3 gap-3 lg:col-span-2">
            {[
              { Icon: ShieldCheck, title: "Every card, verified", body: "Grades, edges and centering inspected in-hand. What you see in the photo is what ships." },
              { Icon: Award, title: "Fair, transparent pricing", body: "Live TCGplayer market data on every listing, refreshed in real time while you browse." },
              { Icon: Truck, title: "Shipped in 48 hours", body: "Toploader, team bag and bubble mailer minimum. High-value cards ship insured with tracking." },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <div className="h-11 w-11 rounded-xl bg-red-500/20 text-red-300 grid place-items-center mb-3"><Icon className="h-5 w-5" /></div>
                <h3 className="text-lg">{title}</h3>
                <p className="mt-1.5 text-sm text-white/70 pc-body leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WAYS TO PAY ============ */}
      <section id="pay" className="pc-paper-bg scroll-mt-[72px]" data-testid="section-pay">
        <div className="pc-container py-12 sm:py-16">
          <div className="pc-sec-title">
            <h2>Ways to Pay</h2>
          </div>
          <p className="pc-sec-sub">
            Once Chris confirms your card is in hand, pay with whichever app you already use. Tap to open it on your phone, or scan the code from another device.
          </p>
          <div className="mt-6">
            <PaymentOptionCards />
          </div>
          <p className="mt-4 text-xs text-neutral-500 pc-body">
            Please wait for the confirmation message before sending payment, and include the card name in the note. In person at shows: cash, Apple Cash, or tap to pay with any credit or debit card.
          </p>
        </div>
      </section>

      {/* ============ GUARANTEE ============ */}
      <section id="promise" className="bg-white scroll-mt-[72px]">
        <div className="pc-container py-12 sm:py-16">
          <div className="rounded-2xl border border-[var(--pc-line)] bg-[var(--pc-paper)] p-7 sm:p-10 grid gap-6 lg:grid-cols-[auto_1fr_auto] items-center">
            <div className="h-16 w-16 rounded-2xl bg-red-600 text-white grid place-items-center shrink-0"><BadgeCheck className="h-8 w-8" /></div>
            <div>
              <span className="pc-pill pc-pill-red">The Chris Collects Co promise</span>
              <h2 className="mt-3 text-[1.6rem] sm:text-[2.1rem] leading-tight">
                If the card doesn't arrive exactly as described, you get a full refund — no photos, no restocking fees, no questions.
              </h2>
              <p className="mt-3 text-neutral-600 pc-body leading-relaxed max-w-3xl">
                Every order is packed by hand and cross-checked against the listing photo. On the rare occasion something is off, we make it right the same day.
              </p>
            </div>
            <button onClick={() => browse()} className="pc-btn pc-btn-black" data-testid="button-promise-shop">
              Shop with confidence <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ============ REVIEWS ============ */}
      <section id="reviews" className="pc-paper-bg border-t border-[var(--pc-line)]">
        <div className="pc-container py-12 sm:py-16">
          <div className="pc-sec-head">
            <div>
              <div className="pc-sec-title">
                <span className="pc-pill pc-pill-light"><Check className="h-3.5 w-3.5 text-emerald-600" /> Verified buyers</span>
                <h2>Loved by Collectors</h2>
              </div>
              <p className="pc-sec-sub">Real notes from collectors who bought and traded with Chris Collects Co.</p>
            </div>
            <div className="pc-stars" aria-label="5 out of 5 stars">
              {[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-5 w-5 fill-current" />)}
            </div>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { quote: "The centering on my Charizard was exactly as pictured. Packed like a museum piece. This is how every seller should operate.", name: "Marcus D.", role: "Pokémon collector · Bay Area" },
              { quote: "Traded in a stack of duplicates and got a fair counter within a few hours. Chris actually knows the market — not just running a script.", name: "Priya S.", role: "MTG player · Los Angeles" },
              { quote: "Followed the live pulls on TikTok for months before buying. What you see is what you get, every single time.", name: "Tyler R.", role: "One Piece TCG · Sacramento" },
            ].map((t) => (
              <figure key={t.name} className="pc-review">
                <div className="pc-stars mb-3">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-4 w-4 fill-current" />)}</div>
                <blockquote className="text-[15px] leading-relaxed text-neutral-800 pc-body flex-1">"{t.quote}"</blockquote>
                <figcaption className="mt-5 pt-4 border-t border-[var(--pc-line)]">
                  <div className="pc-font font-semibold">{t.name}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">{t.role}</div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ============ COMMUNITY ============ */}
      <section className="bg-white">
        <div className="pc-container py-12 sm:py-16">
          <div className="text-center">
            <span className="pc-pill pc-pill-dark">Follow us</span>
            <h2 className="mt-3 text-[2rem] sm:text-[2.4rem]">Join the Chris Collects Co Community</h2>
            <p className="pc-sec-sub">Live pulls, new drops and big hits. Don't miss a thing.</p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" className="pc-social pc-social-tiktok" data-testid="link-community-tiktok">
              <span className="pc-social-icon"><SiTiktok className="h-6 w-6" /></span>
              <h3>TikTok</h3>
              <span className="pc-handle">{BRAND_HANDLE}</span>
              <p>Live pack rips, big hits and giveaways on our live shows.</p>
              <span className="pc-btn pc-btn-sm pc-btn-white mt-auto self-start">Watch live <ArrowRight className="h-4 w-4" /></span>
            </a>
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-social pc-social-instagram" data-testid="link-community-instagram">
              <span className="pc-social-icon"><SiInstagram className="h-6 w-6" /></span>
              <h3>Instagram</h3>
              <span className="pc-handle">{BRAND_HANDLE}</span>
              <p>New drops, grails and giveaways right in your feed.</p>
              <span className="pc-btn pc-btn-sm pc-btn-white mt-auto self-start">Follow <ArrowRight className="h-4 w-4" /></span>
            </a>
            <button onClick={() => browse({ sort: "newest" })} className="pc-social pc-social-shop text-left" data-testid="link-community-shop">
              <span className="pc-social-icon"><Sparkles className="h-6 w-6" /></span>
              <h3>New Drops</h3>
              <span className="pc-handle">Updated as cards are pulled</span>
              <p>Fresh singles and sealed product land in the vault as soon as they're photographed.</p>
              <span className="pc-btn pc-btn-sm pc-btn-white mt-auto self-start">See what's new <ArrowRight className="h-4 w-4" /></span>
            </button>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="pc-dark pc-footer">
        <div className="pc-container py-12 grid gap-10 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <img src="/logo-96.png" alt="" width={44} height={44} className="h-11 w-11 rounded-lg object-cover ring-1 ring-white/15" />
              <span className="pc-wordmark">Chris Collects<small>Co</small></span>
            </div>
            <p className="mt-4 text-sm text-white/70 pc-body leading-relaxed max-w-sm">
              A collector-run trading card shop. Pokémon, One Piece, Magic and more — bought, sold and traded directly with Chris.
            </p>
            <div className="mt-5 flex gap-2">
              <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" aria-label="TikTok" className="pc-icon-btn bg-white/10"><SiTiktok className="h-4 w-4" /></a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="pc-icon-btn bg-white/10"><SiInstagram className="h-4 w-4" /></a>
            </div>
          </div>
          <div>
            <h3 className="text-lg mb-3">Shop</h3>
            <ul className="grid gap-2 text-sm pc-body">
              {navItems.map((n) => (
                <li key={n.label}><button onClick={n.onClick} className="text-white/78 hover:text-white">{n.label}</button></li>
              ))}
              <li><button onClick={() => document.getElementById("pay")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="text-white/78 hover:text-white" data-testid="footer-link-pay">Ways to pay</button></li>
              <li><a href="#/faq" className="text-white/78 hover:text-white" data-testid="footer-link-faq">FAQ</a></li>
              <li><a href="#/about" className="text-white/78 hover:text-white" data-testid="footer-link-about">About Chris Collects Co</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg mb-3">Store Information</h3>
            <ul className="grid gap-2.5 text-sm pc-body text-white/78">
              <li className="flex items-start gap-2"><MapPin className="h-4 w-4 mt-0.5 shrink-0" /> Based in California · Online orders ship nationwide</li>
              <li className="flex items-start gap-2"><Truck className="h-4 w-4 mt-0.5 shrink-0" /> Orders ship within 48 hours, tracked and insured on high-value cards</li>
              <li className="flex items-start gap-2" data-testid="footer-payments"><Wallet className="h-4 w-4 mt-0.5 shrink-0" /> We take {PAYMENT_METHODS_SENTENCE}</li>
              <li className="flex items-start gap-2"><SiInstagram className="h-4 w-4 mt-0.5 shrink-0" /> Questions: DM {BRAND_HANDLE} on Instagram or TikTok</li>
              <li className="flex items-start gap-2"><ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" /> 100% satisfaction guarantee on every order</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="pc-container py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-white/60 pc-body">
            <span>© {new Date().getFullYear()} Chris Collects Co · Curated by a collector</span>
            <a href={isAdmin ? "#/admin" : "#/login?next=/admin"} className="!text-white/60 hover:!text-white">{isAdmin ? "Admin dashboard" : "Owner sign in"}</a>
          </div>
        </div>
      </footer>

      {/* Dialogs */}
      {buyTarget && <BuyDialog listing={buyTarget} onOpenChange={(o) => !o && setBuyTarget(null)} />}
      {tradeTarget && <TradeDialog listing={tradeTarget} onOpenChange={(o) => !o && setTradeTarget(null)} />}

      <ShopChat />
    </div>
  );
}

// ---------- Category tile ----------
const CASH_RATE = 0.7;
const TRADE_RATE = 0.8;

// Shrink a camera photo before upload (long side ≤ 1024px, JPEG) so a 12 MP
// shot becomes ~100–200 KB instead of several MB — a card's name and number
// are still perfectly legible at this size, and the upload + AI read are faster.
async function downscalePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that photo"));
      el.src = url;
    });
    const MAX = 1024;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that photo");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// TCGplayer names look like "Charizard ex - 223/197"; the shop search wants
// just the card name.
function shopQueryFor(hit: PriceHit): string {
  const base = hit.name.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+-\s+[\w/]+\s*$/, "").trim();
  return base || hit.name;
}

type ScanState =
  | { status: "idle" }
  | { status: "working"; preview: string }
  | { status: "done"; preview: string; label: string; alt: PriceHit[]; matched: boolean }
  | { status: "error"; preview: string | null; message: string };

function CardLookup({ onPick }: { onPick: (hit: PriceHit, price: number, printing: string | null) => void }) {
  const [q, setQ] = useState("");
  const [line, setLine] = useState<string | null>("Pokemon");
  const [hits, setHits] = useState<PriceHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PriceHit | null>(null);
  const [printings, setPrintings] = useState<Printing[]>([]);
  const [printing, setPrinting] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });

  type ScanOutcome = "matched" | "ambiguous" | "unreadable" | "nomatch" | "error";

  // One scan round-trip: photo → identify → TCGplayer matches → calculator.
  // `quiet` (live camera) keeps the UI calm on misses so the camera can retry.
  async function runScan(preview: string, quiet = false): Promise<ScanOutcome> {
    try {
      if (!quiet) setScan({ status: "working", preview });
      const res = await fetch(`${API_BASE}/api/prices/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ imageBase64: preview, mediaType: "image/jpeg" }),
      });
      if (!res.ok) {
        if (res.status === 429) throw new Error("Too many scans — give it a minute.");
        if (res.status === 503) throw new Error("Card scanner is temporarily unavailable — type the card name below instead.");
        throw new Error("Couldn't read the card — try a clearer, straight-on photo.");
      }
      const data = await res.json();
      const results: PriceHit[] = Array.isArray(data?.results) ? data.results : [];
      const ident = data?.identified ?? {};
      const label = [ident.name, ident.number ? `#${ident.number}` : null, ident.set || null].filter(Boolean).join(" · ");
      if (!ident?.name || Number(ident.confidence) < 0.5) {
        if (!quiet) setScan({ status: "error", preview, message: "Couldn't read the card — try a clearer, straight-on photo." });
        return "unreadable";
      }
      if (!results.length) {
        if (!quiet) setScan({ status: "error", preview, message: `Read it as “${label}” but found no TCGplayer match — try typing it below.` });
        return "nomatch";
      }
      setPicked(null); setPrintings([]); setPrinting(null); setQ(""); setError(null);
      const auto = data?.autoPick ? results.find((h) => h.productId === data.autoPick) : null;
      if (auto) {
        void pick(auto);
        setScan({ status: "done", preview, label, alt: results.filter((h) => h.productId !== auto.productId), matched: true });
        return "matched";
      }
      setHits(results);
      setScan({ status: "done", preview, label, alt: [], matched: false });
      return "ambiguous";
    } catch (err: any) {
      setScan({ status: "error", preview, message: err?.message || "Scan failed" });
      return "error";
    }
  }

  async function onScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    closeCamera();
    try {
      const preview = await downscalePhoto(file);
      setPicked(null); setPrintings([]); setPrinting(null); setHits([]); setQ(""); setError(null);
      await runScan(preview);
    } catch (err: any) {
      setScan({ status: "error", preview: null, message: err?.message || "Couldn't read that photo" });
    }
  }

  // ── Live camera: recognizes the card automatically once it's held steady ──
  const [cam, setCam] = useState<{ status: string; misses: number; busy: boolean } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const guideRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const camRef = useRef<{ timer: number | null; prev: Uint8ClampedArray | null; steady: number; lastShot: number; inFlight: boolean; misses: number; closed: boolean }>({ timer: null, prev: null, steady: 0, lastShot: 0, inFlight: false, misses: 0, closed: false });
  const canUseCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  function closeCamera() {
    camRef.current.closed = true;
    if (camRef.current.timer) window.clearInterval(camRef.current.timer);
    camRef.current.timer = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCam(null);
  }

  function openScanner() {
    if (!canUseCamera) { fileRef.current?.click(); return; }
    camRef.current = { timer: null, prev: null, steady: 0, lastShot: 0, inFlight: false, misses: 0, closed: false };
    setCam({ status: "Starting camera…", misses: 0, busy: false });
  }

  // Grab the area inside the guide frame from the live video as a 960px JPEG.
  function captureFrame(): string | null {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide || !video.videoWidth) return null;
    const vr = video.getBoundingClientRect();
    const gr = guide.getBoundingClientRect();
    const scale = Math.max(vr.width / video.videoWidth, vr.height / video.videoHeight); // object-fit: cover
    const offX = (vr.width - video.videoWidth * scale) / 2;
    const offY = (vr.height - video.videoHeight * scale) / 2;
    const pad = 0.06;
    const sx = Math.max(0, (gr.left - vr.left - offX) / scale - gr.width * pad / scale);
    const sy = Math.max(0, (gr.top - vr.top - offY) / scale - gr.height * pad / scale);
    const sw = Math.min(video.videoWidth - sx, (gr.width * (1 + 2 * pad)) / scale);
    const sh = Math.min(video.videoHeight - sy, (gr.height * (1 + 2 * pad)) / scale);
    if (sw < 40 || sh < 40) return null;
    const out = document.createElement("canvas");
    const k = Math.min(1, 960 / Math.max(sw, sh));
    out.width = Math.round(sw * k);
    out.height = Math.round(sh * k);
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.76);
  }

  useEffect(() => {
    if (!cam) return;
    let cancelled = false;
    const state = camRef.current;
    const probe = document.createElement("canvas");
    probe.width = 64; probe.height = 48;
    const pctx = probe.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled || state.closed) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
        setCam((c) => (c ? { ...c, status: "Hold the card inside the frame" } : c));
      } catch {
        if (cancelled) return;
        closeCamera();
        fileRef.current?.click();
        return;
      }

      state.timer = window.setInterval(async () => {
        const video = videoRef.current;
        if (!video || !pctx || !video.videoWidth || state.inFlight || state.closed) return;
        // Motion check: a steady frame = the customer is holding the card still.
        pctx.drawImage(video, 0, 0, probe.width, probe.height);
        const px = pctx.getImageData(0, 0, probe.width, probe.height).data;
        if (state.prev) {
          let diff = 0;
          for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i] - state.prev[i]) + Math.abs(px[i + 1] - state.prev[i + 1]);
          const mean = diff / (px.length / 4);
          state.steady = mean < 12 ? state.steady + 1 : 0;
        }
        state.prev = px.slice();
        const now = Date.now();
        // First attempt fires after a single steady frame; retries wait for two so a
        // customer re-positioning the card isn't photographed mid-move.
        const need = state.misses === 0 ? 1 : 2;
        if (state.steady < need || now - state.lastShot < 1200 || state.misses >= 6) return;
        const shot = captureFrame();
        if (!shot) return;
        state.inFlight = true;
        state.lastShot = now;
        setCam((c) => (c ? { ...c, status: "Reading…", busy: true } : c));
        const outcome = await runScan(shot, true);
        state.inFlight = false;
        if (state.closed) return;
        if (outcome === "matched" || outcome === "ambiguous" || outcome === "error") {
          closeCamera();
          return;
        }
        state.misses += 1;
        state.steady = 0;
        const hint = state.misses >= 6
          ? "Having trouble — tap Take photo, or upload a picture."
          : outcome === "nomatch"
            ? "Read the card but found no TCGplayer match — try again or type it."
            : "Couldn't read it yet — fill the frame, avoid glare, hold still.";
        setCam((c) => (c ? { ...c, status: hint, misses: state.misses, busy: false } : c));
      }, 280);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam !== null]);

  useEffect(() => () => closeCamera(), []); // stop the camera if the section unmounts

  async function manualCapture() {
    const state = camRef.current;
    if (state.inFlight) return;
    const shot = captureFrame();
    if (!shot) return;
    state.inFlight = true;
    setCam((c) => (c ? { ...c, status: "Reading…", busy: true } : c));
    const outcome = await runScan(shot, true);
    state.inFlight = false;
    if (outcome === "matched" || outcome === "ambiguous" || outcome === "error") { closeCamera(); return; }
    state.misses += 1;
    setCam((c) => (c ? { ...c, status: outcome === "nomatch" ? "Read the card but found no TCGplayer match — try again or type it." : "Couldn't read it — fill the frame, avoid glare, try again.", misses: state.misses, busy: false } : c));
  }

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); setError(null); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const params = new URLSearchParams({ q: term });
        if (line) params.set("line", line);
        const res = await fetch(`${API_BASE}/api/prices/search?${params}`, { signal: ac.signal, credentials: "omit" });
        if (!res.ok) throw new Error(res.status === 429 ? "Too many lookups — give it a minute." : "Lookup failed");
        const data = await res.json();
        setHits(Array.isArray(data?.results) ? data.results : []);
        setError(null);
      } catch (e: any) {
        if (e?.name !== "AbortError") { setError(e?.message || "Lookup failed"); setHits([]); }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, line]);

  async function pick(hit: PriceHit) {
    setPicked(hit);
    setHits([]);
    setQ("");
    setPrintings([]);
    setPrinting(null);
    if (hit.marketPrice != null) onPick(hit, hit.marketPrice, null);
    try {
      const res = await fetch(`${API_BASE}/api/prices/product/${hit.productId}`, { credentials: "omit" });
      if (!res.ok) return;
      const data = await res.json();
      const list: Printing[] = (data?.printings || []).filter((p: Printing) => p.marketPrice != null);
      setPrintings(list);
      if (list.length) {
        const first = list.find((p) => p.printing === "Normal") || list[0];
        setPrinting(first.printing);
        onPick(hit, first.marketPrice!, first.printing);
      }
    } catch {
      /* keep the search-result price */
    }
  }

  function choosePrinting(p: Printing) {
    if (!picked || p.marketPrice == null) return;
    setPrinting(p.printing);
    onPick(picked, p.marketPrice, p.printing);
  }

  const current = printings.find((p) => p.printing === printing) || null;
  const shownPrice = current?.marketPrice ?? picked?.marketPrice ?? null;

  return (
    <div className="pc-lookup" data-testid="card-lookup">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="pc-field-label pc-calc-label !mb-0">Scan or look up a card — live TCGplayer price</span>
        <select
          className="pc-lookup-line"
          value={line ?? ""}
          onChange={(e) => setLine(e.target.value || null)}
          aria-label="Game"
          data-testid="select-lookup-line"
        >
          {PRICE_LINES.map((l) => (
            <option key={l.label} value={l.line ?? ""}>{l.label}</option>
          ))}
        </select>
      </div>
      <div className="pc-calc-input mt-1.5">
        <span className="pc-calc-prefix"><Search className="h-4 w-4" /></span>
        <input
          type="search"
          placeholder="Card name, number or set… e.g. Charizard ex 223/197"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search TCGplayer for a card"
          autoComplete="off"
          data-testid="input-calc-search"
        />
        {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin text-white/60" aria-hidden />}
        <button
          type="button"
          className="pc-scan-btn"
          onClick={openScanner}
          disabled={scan.status === "working" || cam !== null}
          aria-label="Scan a card with your camera"
          data-testid="button-scan-card"
        >
          {scan.status === "working" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
          <span>{scan.status === "working" ? "Reading…" : "Scan"}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          onChange={onScanFile}
          data-testid="input-scan-file"
        />
      </div>
      {cam && createPortal(
        <div className="pc pc-cam" role="dialog" aria-modal="true" aria-label="Live card scanner" data-testid="scanner-overlay">
          <video ref={videoRef} className="pc-cam-video" playsInline muted autoPlay data-testid="video-scanner" />
          <div className="pc-cam-shade" aria-hidden />
          <div ref={guideRef} className={cn("pc-cam-guide", cam.busy && "is-busy")} aria-hidden>
            <i /><i /><i /><i />
          </div>
          <button type="button" className="pc-cam-close" onClick={closeCamera} aria-label="Close scanner" data-testid="button-scanner-close">
            <X className="h-5 w-5" />
          </button>
          <div className="pc-cam-bar">
            <p className="pc-cam-status" role="status" aria-live="polite" data-testid="text-scanner-status">
              {cam.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              <span>{cam.status}</span>
            </p>
            <p className="pc-cam-hint">Recognizes the card automatically — no button needed.</p>
            <div className="pc-cam-actions">
              <button type="button" className="pc-cam-btn is-primary" onClick={manualCapture} disabled={cam.busy} data-testid="button-scanner-capture">
                <Camera className="h-4 w-4" aria-hidden /> Take photo
              </button>
              <button type="button" className="pc-cam-btn" onClick={() => fileRef.current?.click()} disabled={cam.busy} data-testid="button-scanner-upload">
                Upload a picture
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {scan.status !== "idle" && (
        <div className={cn("pc-scan-note", scan.status === "error" && "is-error")} role={scan.status === "error" ? "alert" : "status"} data-testid="scan-status">
          {scan.status !== "working" && scan.preview && <img src={scan.preview} alt="" className="pc-scan-thumb" />}
          <div className="min-w-0 flex-1">
            {scan.status === "working" && <span>Reading your card… <span className="text-white/60">usually 2–3 seconds</span></span>}
            {scan.status === "done" && (
              <>
                <span className="block">Scanned: <b className="text-white">{scan.label}</b>{scan.matched ? " — matched on TCGplayer." : " — pick the right match below."}</span>
                {scan.matched && scan.alt.length > 0 && (
                  <button type="button" className="pc-scan-link" onClick={() => setHits(scan.alt)} data-testid="button-scan-alternatives">
                    Not the right card? See {scan.alt.length} other match{scan.alt.length === 1 ? "" : "es"}
                  </button>
                )}
              </>
            )}
            {scan.status === "error" && <span>{scan.message}</span>}
          </div>
          <button type="button" className="pc-lookup-clear" onClick={() => setScan({ status: "idle" })} aria-label="Dismiss scan result" data-testid="button-scan-dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-amber-200" role="alert">{error}</p>}
      {!!hits.length && (
        <ul className="pc-lookup-results" role="listbox" aria-label="Matching cards" data-testid="list-lookup-results">
          {hits.map((h) => (
            <li key={h.productId}>
              <button type="button" className="pc-lookup-row" onClick={() => pick(h)} data-testid={`lookup-hit-${h.productId}`}>
                <img src={h.imageUrl} alt="" loading="lazy" className="pc-lookup-thumb" />
                <span className="min-w-0 flex-1">
                  <span className="pc-lookup-name">{h.name}</span>
                  <span className="pc-lookup-meta">{[h.setName, h.rarity, h.number ? `#${h.number}` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="pc-lookup-price">{h.marketPrice != null ? formatCurrency(h.marketPrice) : "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!hits.length && !loading && q.trim().length >= 2 && !error && (
        <p className="mt-2 text-[12px] text-white/55" data-testid="lookup-empty">No TCGplayer match — try the card number or switch the game filter.</p>
      )}
      {picked && (
        <div className="pc-lookup-picked" data-testid="lookup-picked">
          <img src={picked.imageUrl} alt="" className="pc-lookup-thumb is-lg" />
          <div className="min-w-0 flex-1">
            <div className="pc-lookup-name">{picked.name}</div>
            <div className="pc-lookup-meta">{[picked.setName, picked.rarity, picked.number ? `#${picked.number}` : null].filter(Boolean).join(" · ")}</div>
            <div className="mt-1 text-[12px] text-white/70">
              TCGplayer market <b className="text-white">{shownPrice != null ? formatCurrency(shownPrice) : "—"}</b>
              <span className="pc-live-dot" aria-hidden /> live
            </div>
            {printings.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Printing">
                {printings.map((p) => (
                  <button
                    key={p.printing}
                    type="button"
                    role="radio"
                    aria-checked={printing === p.printing}
                    onClick={() => choosePrinting(p)}
                    className={cn("pc-calc-preset", printing === p.printing && "is-active")}
                    data-testid={`lookup-printing-${p.printing.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {p.printing} · {formatCurrency(p.marketPrice!)}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="pc-scan-link mt-2"
              onClick={() => window.dispatchEvent(new CustomEvent("pc:find-in-shop", { detail: { q: shopQueryFor(picked) } }))}
              data-testid="button-find-in-shop"
            >
              <Search className="h-3.5 w-3.5" aria-hidden /> Find “{shopQueryFor(picked)}” in our shop
            </button>
          </div>
          <button type="button" className="pc-lookup-clear" onClick={() => { setPicked(null); setPrintings([]); setPrinting(null); }} aria-label="Clear selected card" data-testid="button-lookup-clear">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function SellCalculator() {
  const [value, setValue] = useState("");
  const [qty, setQty] = useState(1);
  const [source, setSource] = useState<string | null>(null);
  const market = Math.max(0, parseFloat(value.replace(/[^0-9.]/g, "")) || 0);
  const total = market * Math.max(1, qty);
  const cash = total * CASH_RATE;
  const trade = total * TRADE_RATE;
  const has = total > 0;
  const presets = [10, 25, 50, 100, 250, 500];

  return (
    <div className="pc-calc" data-testid="sell-calculator">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="pc-calc-kicker">Sell calculator</span>
          <h3 className="text-xl sm:text-2xl mt-1">What&apos;s my card worth to Chris Collects Co?</h3>
        </div>
        <span className="pc-calc-badge"><Calculator className="h-5 w-5" /></span>
      </div>
      <p className="mt-2 text-sm text-white/70 pc-body">
        Scan a card with your camera or search it by name for its live TCGplayer market price, or just type a value. We pay <b className="text-white">{Math.round(CASH_RATE * 100)}% in cash</b> or <b className="text-white">{Math.round(TRADE_RATE * 100)}% in trade credit</b> toward anything in the vault.
      </p>

      <div className="mt-5">
        <CardLookup
          onPick={(hit, price, printing) => {
            setValue(price.toFixed(2));
            setSource(`${hit.name}${printing && printing !== "Normal" ? ` (${printing})` : ""}`);
          }}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px]">
        <label className="block">
          <span className="pc-field-label pc-calc-label">Market value per card{source ? <span className="normal-case tracking-normal text-white/55"> · from {source}</span> : null}</span>
          <div className="pc-calc-input">
            <span className="pc-calc-prefix">$</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={value}
              onChange={(e) => { setValue(e.target.value); setSource(null); }}
              aria-label="Market value per card in dollars"
              data-testid="input-calc-value"
            />
          </div>
        </label>
        <label className="block">
          <span className="pc-field-label pc-calc-label">Quantity</span>
          <div className="pc-calc-input">
            <input
              type="number"
              min={1}
              max={999}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
              aria-label="Quantity"
              data-testid="input-calc-qty"
            />
          </div>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => { setValue(String(p)); setSource(null); }} className={cn("pc-calc-preset", market === p && "is-active")} data-testid={`button-calc-preset-${p}`}>
            ${p}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="pc-calc-out" data-testid="calc-cash">
          <span className="pc-calc-out-label"><Banknote className="h-4 w-4" /> Cash offer</span>
          <span className="pc-calc-out-value">{has ? formatCurrency(cash) : "—"}</span>
          <span className="pc-calc-out-sub">{Math.round(CASH_RATE * 100)}% of market</span>
        </div>
        <div className="pc-calc-out is-trade" data-testid="calc-trade">
          <span className="pc-calc-out-label"><ArrowLeftRight className="h-4 w-4" /> Trade credit</span>
          <span className="pc-calc-out-value">{has ? formatCurrency(trade) : "—"}</span>
          <span className="pc-calc-out-sub">{Math.round(TRADE_RATE * 100)}% of market{has ? ` · +${formatCurrency(trade - cash)} vs cash` : ""}</span>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-white/55 pc-body">
        Estimate only. Final offers are based on in-hand condition, authenticity and current TCGplayer market; graded cards and sealed product are quoted individually.
      </p>
    </div>
  );
}

function ShowCard({ show, next }: { show: CardShow; next?: boolean }) {
  const d = showDateParts(show);
  const where = [show.venue, show.city].filter(Boolean).join(" · ");
  const body = (
    <>
      <div className="pc-show-date" aria-hidden>
        <span className="pc-show-month">{d.month}</span>
        <span className="pc-show-day">{d.day}</span>
        <span className="pc-show-wd">{d.weekday}</span>
      </div>
      <div className="min-w-0 flex-1">
        {next && <span className="pc-tag pc-tag-hot">Next up</span>}
        <h3 className="pc-show-name">{show.name}</h3>
        <p className="pc-show-where"><MapPin className="h-3.5 w-3.5 shrink-0 mt-[3px]" /> <span>{where}</span></p>
        {show.hours && <p className="pc-show-meta"><Clock className="h-3.5 w-3.5 shrink-0" /> {show.hours}</p>}
        {show.note && <p className="pc-show-note">{show.note}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {show.host && (
            <a href={`https://www.instagram.com/${show.host}/`} target="_blank" rel="noopener noreferrer" className="pc-chip !h-8 text-[13px]">
              <SiInstagram className="h-3.5 w-3.5" /> @{show.host}
            </a>
          )}
          {show.url && (
            <a href={show.url} target="_blank" rel="noopener noreferrer" className="pc-chip !h-8 text-[13px] is-active">
              Tickets &amp; info <ArrowRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </>
  );
  return (
    <article className={cn("pc-show", next && "is-next")} data-testid={`show-${show.start}`}>
      {body}
    </article>
  );
}

function CategoryTile({
  label,
  count,
  image,
  icon,
  glow,
  badge,
  onClick,
}: {
  label: string;
  count: number | null;
  image?: string | null;
  icon?: React.ReactNode;
  glow: string;
  badge?: { text: string; tone: "green" | "red" | "gold" };
  onClick: () => void;
}) {
  const src = resolveUploadUrl(image ?? null);
  return (
    <button className="pc-cat" onClick={onClick} data-testid={`cat-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <span className="pc-cat-ring" style={{ ["--glow" as string]: glow }}>
        {badge && (
          <span className={cn("pc-tag pc-cat-badge", badge.tone === "green" && "pc-tag-new", badge.tone === "red" && "pc-tag-hot", badge.tone === "gold" && "pc-tag-grade")}>
            {badge.text}
          </span>
        )}
        {src && !icon ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <span className="pc-cat-fallback">{icon ?? <Layers className="h-7 w-7" />}</span>
        )}
      </span>
      <span className="pc-cat-label">
        {label}
        {count != null && count > 0 && <span className="pc-cat-count">{count} items</span>}
      </span>
    </button>
  );
}

// ---------- Feature image ----------
function FeatureImage({ listing }: { listing: ShopListing }) {
  const src = resolveUploadUrl(listing.imageUrl);
  if (!src) {
    return <CardThumb imageUrl={listing.imageUrl} franchise={listing.franchise} size="lg" className="h-[300px] w-[215px] rounded-xl" />;
  }
  return <img src={src} alt={listing.name} />;
}

// ---------- Shelf (horizontal carousel) ----------
function Shelf({
  tone,
  pill,
  title,
  subtitle,
  items,
  count,
  viewAllLabel,
  onViewAll,
  onBuy,
  onTrade,
  gold,
  binder,
  showNewTag,
  hotIds,
}: {
  tone: "light" | "paper" | "dark";
  pill: React.ReactNode;
  title: string;
  subtitle: string;
  items: ShopListing[];
  count: number;
  viewAllLabel?: string;
  onViewAll: () => void;
  onBuy: (l: ShopListing) => void;
  onTrade: (l: ShopListing) => void;
  gold?: boolean;
  binder?: boolean;
  showNewTag?: boolean;
  hotIds?: Set<string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  function update() {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  function scrollBy(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  }

  const sectionClass = tone === "dark" ? "pc-dark" : tone === "paper" ? "pc-paper-bg" : "bg-white";
  const slug = title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return (
    <section className={cn(sectionClass, tone !== "dark" && "border-b border-[var(--pc-line)]")} data-testid={`shelf-${slug}`}>
      <div className="pc-container py-10 sm:py-12">
        <div className={cn(binder && "pc-binder")}>
          <div className="pc-sec-head">
            <div>
              <div className="pc-sec-title">
                {pill}
                <h2>{title}</h2>
              </div>
              <p className="pc-sec-sub">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onViewAll} className="pc-btn pc-btn-red" data-testid={`button-viewall-${slug}`}>
                {viewAllLabel ?? "View all"} <span className="opacity-80 font-medium">· {count} items</span> <ArrowRight className="h-4 w-4" />
              </button>
              <button className="pc-arrow !hidden sm:!inline-flex" onClick={() => scrollBy(-1)} disabled={!canPrev} aria-label="Scroll left"><ChevronLeft className="h-5 w-5" /></button>
              <button className="pc-arrow !hidden sm:!inline-flex" onClick={() => scrollBy(1)} disabled={!canNext} aria-label="Scroll right"><ChevronRight className="h-5 w-5" /></button>
            </div>
          </div>
          <div ref={ref} className="pc-shelf mt-6">
            {items.map((l) => (
              <ProductCard key={l.id} listing={l} onBuy={() => onBuy(l)} onTrade={() => onTrade(l)} gold={gold} showNewTag={showNewTag} hot={hotIds?.has(l.id)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Product card ----------
function ProductCard({
  listing,
  onBuy,
  onTrade,
  gold,
  showNewTag,
  hot,
}: {
  listing: ShopListing;
  onBuy: () => void;
  onTrade: () => void;
  gold?: boolean;
  showNewTag?: boolean;
  hot?: boolean;
}) {
  // Only call it a deal when it's meaningfully under market (≥5% and ≥ $2 off).
  const belowMarket =
    listing.marketValue != null &&
    listing.marketValue > 0 &&
    listing.marketValue - listing.askingPrice >= 2 &&
    listing.askingPrice <= listing.marketValue * 0.95;
  const grade = gradeLabel(listing.condition);
  const isSlab = listing.category === "Slab" || !!grade;
  const isSealed = listing.category === "Sealed";
  const condKey = (listing.condition ?? "").toUpperCase();
  const [imgFailed, setImgFailed] = useState(false);
  const src = imgFailed ? null : resolveUploadUrl(listing.imageUrl);
  const thumb = thumbSrcSet(src);
  const soldOut = !inStock(listing);
  const hotSeller = hot || false;
  const isNew = !soldOut && (showNewTag || (listing.createdAt ? Date.now() / 1000 - listing.createdAt < 7 * 86400 : false));

  return (
    <div
      data-testid={`card-listing-${listing.id}`}
      data-stock={soldOut ? "out" : "in"}
      className={cn("pc-product", (gold || isSlab) && "is-gold", soldOut && "is-soldout")}
    >
      <div className="pc-product-media">
        {src ? (
          <img
            src={thumb?.src ?? src}
            srcSet={thumb?.srcSet}
            sizes={thumb?.sizes}
            alt={listing.name}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-contain p-3"
          />
        ) : (
          <CardThumb imageUrl={null} franchise={listing.franchise} size="lg" className="h-full w-full" />
        )}
        {soldOut && (
          <div className="pc-soldout-banner" role="status" data-testid={`banner-soldout-${listing.id}`}>
            <span>Out of stock</span>
          </div>
        )}
        <div className="pc-product-tags">
          <div className="flex flex-col gap-1 items-start">
            {isSlab && grade ? (
              <span className="pc-tag pc-tag-grade">{grade}</span>
            ) : isSealed ? (
              <span className="pc-tag pc-tag-sealed">Sealed</span>
            ) : listing.condition ? (
              <span className={cn("pc-tag pc-tag-cond", `is-${condKey.toLowerCase()}`)}>
                <b>{listing.condition}</b> {conditionName(listing.condition)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 items-end">
            {isNew && <span className="pc-tag pc-tag-new">New</span>}
            {!soldOut && hotSeller && <span className="pc-tag pc-tag-hot">Hot seller</span>}
            {!soldOut && belowMarket && <span className="pc-tag pc-tag-deal">Deal</span>}
          </div>
        </div>
      </div>
      <div className="pc-product-body">
        <div className="pc-product-vendor">{listing.franchise}</div>
        <div className="pc-product-name" title={listing.name}>{listing.name}</div>
        <div className="pc-product-meta">
          {listing.setName}
          {listing.rarity ? ` · ${listing.rarity}` : ""}
        </div>
        <div className="pc-product-foot">
          <div className="flex items-baseline min-w-0">
            <span className="pc-price" data-testid={`text-price-${listing.id}`}>{formatCurrency(listing.askingPrice)}</span>
            {!soldOut && belowMarket && <span className="pc-price-was">{formatCurrency(listing.marketValue!)}</span>}
          </div>
          <div className="pc-product-actions">
            {soldOut ? (
              <button type="button" className="pc-btn pc-btn-outline is-disabled" disabled aria-disabled="true" data-testid={`button-soldout-${listing.id}`}>
                Sold out
              </button>
            ) : (
              <>
                <button onClick={onBuy} className="pc-btn pc-btn-red" data-testid={`button-buy-${listing.id}`}>
                  <ShoppingBag className="h-4 w-4" /> Buy
                </button>
                <button onClick={onTrade} className="pc-btn pc-btn-outline pc-btn-icon" aria-label={`Propose a trade for ${listing.name}`} title="Propose a trade" data-testid={`button-trade-${listing.id}`}>
                  <ArrowLeftRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Empty states ----------
function EmptyFilters({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-neutral-300 bg-white p-10 text-center">
      <div className="pc-font text-xl font-bold mb-1">No listings match your filters</div>
      <p className="text-sm text-neutral-600 mb-5 pc-body">Try clearing a filter or broadening your price range.</p>
      <button onClick={onReset} className="pc-btn pc-btn-black" data-testid="button-empty-reset">Clear all filters</button>
    </div>
  );
}

function EmptyNoListings() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-neutral-300 bg-white p-10 text-center">
      <Sparkles className="h-8 w-8 text-red-600 mx-auto mb-3" />
      <div className="pc-font text-xl font-bold mb-1">New drops coming soon</div>
      <p className="text-sm text-neutral-600 mb-5 pc-body">Follow {BRAND_HANDLE} for pulls, drops, and early access.</p>
      <div className="flex justify-center gap-2">
        <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-black"><SiTiktok className="h-4 w-4" /> TikTok</a>
        <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-outline"><SiInstagram className="h-4 w-4" /> Instagram</a>
      </div>
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
    paymentMethod: "",
    quantity: 1,
    message: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [live, setLive] = useState<LivePrice | null>(null);

  // Point-of-purchase refresh: pull the current TCGplayer price for this card.
  useEffect(() => {
    let cancelled = false;
    setLive(null);
    fetch(`${API_BASE}/api/shop/price/${encodeURIComponent(listing.id)}`, { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && d.id) setLive(d as LivePrice); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [listing.id]);
  const shownPrice = live?.askingPrice ?? listing.askingPrice;
  // Surface the live market reference only when it backs up the price (shop
  // price at or under market) and is plausibly the same product — a mismatched
  // TCGplayer match shouldn't confuse the shopper.
  const rawMarket = live?.tcgpMarketPrice ?? listing.tcgpMarketPrice ?? null;
  const liveMarket =
    rawMarket != null && rawMarket > 0 && shownPrice > 0 && shownPrice <= rawMarket * 1.05 && rawMarket <= shownPrice * 3
      ? rawMarket
      : null;
  const livePricedAt = live?.tcgpPricedAt ?? listing.tcgpPricedAt ?? null;

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
      paymentMethod: form.paymentMethod || null,
      quantity: form.quantity,
      offerPrice: listing.askingPrice,
      message: form.message.trim() || null,
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="pc-dialog max-w-md max-h-[90vh] overflow-y-auto">
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
                <div className="mt-1 text-base font-bold text-primary tabular-nums" data-testid="text-buy-price">
                  {formatCurrency(shownPrice)}
                </div>
                {liveMarket != null && (
                  <div className="text-[11px] text-muted-foreground" data-testid="text-buy-market">
                    TCGplayer market {formatCurrency(liveMarket)}{livePricedAt ? ` · updated ${agoLabel(livePricedAt)}` : ""}
                  </div>
                )}
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
                    <SelectContent className="pc">
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
                <Label className="text-xs">How would you like to pay?</Label>
                <Select
                  value={form.paymentMethod}
                  onValueChange={(v) => setForm((f) => ({ ...f, paymentMethod: v }))}
                >
                  <SelectTrigger className="mt-1" data-testid="select-buy-payment">
                    <SelectValue placeholder="Pick one (optional)" />
                  </SelectTrigger>
                  <SelectContent className="pc">
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  No payment is taken here. Chris confirms the card, then sends the details for the method you pick. Card tap is for in-person pickup at shows.
                </p>
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
                  : `Request to buy for ${formatCurrency(shownPrice * form.quantity)}`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <SuccessPane
            title="Request sent"
            preferredContact={form.preferredContact}
            description={
              form.paymentMethod
                ? `Chris will confirm the card and send ${form.paymentMethod} payment details. Usually within 24 hours.`
                : "Chris will reach out to confirm and arrange payment. Usually within 24 hours."
            }
            onClose={() => onOpenChange(false)}
            payAmount={shownPrice * form.quantity}
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
      <DialogContent className="pc-dialog max-w-lg max-h-[90vh] overflow-y-auto">
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
                  <SelectContent className="pc">
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
  payAmount,
}: {
  title: string;
  description: string;
  preferredContact: string;
  onClose: () => void;
  /** When set, shows the ways-to-pay chips for this amount (Buy requests). */
  payAmount?: number;
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
        {payAmount ? (
          <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-left">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2 text-center">Ways to pay once confirmed</div>
            <PaymentChips amount={payAmount} />
            <p className="text-[11px] text-muted-foreground mt-2 text-center">Zelle · Venmo · Cash App · PayPal — or cash at a show. Wait for Chris's confirmation before sending.</p>
          </div>
        ) : null}
      </div>
      <Button onClick={onClose} data-testid="button-success-close">
        Close
      </Button>
    </div>
  );
}
