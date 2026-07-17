import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Logo } from "./Logo";
import { SocialLinks } from "./SocialLinks";
import { useTheme } from "./ThemeProvider";
import { useAuth } from "@/lib/auth";
import type { CustomerRequest } from "@shared/schema";
import {
  LayoutDashboard,
  Package,
  Store,
  ArrowLeftRight,
  Receipt,
  ScanLine,
  Inbox,
  Users as UsersIcon,
  FileSpreadsheet,
  Radio,
  HandCoins,
  CreditCard,
  Moon,
  Sun,
  Menu,
  X,
  LogOut,
  UserCircle,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRealtimeStatus } from "@/lib/realtime";

const NAV = [
  { path: "/admin", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { path: "/admin/inventory", label: "Inventory", icon: Package, testId: "nav-inventory" },
  { path: "/admin/scan", label: "Scan", icon: ScanLine, testId: "nav-scan" },
  { path: "/admin/intake", label: "Buy / Trade In", icon: HandCoins, testId: "nav-intake" },
  { path: "/admin/payments", label: "Payments", icon: CreditCard, testId: "nav-payments" },
  { path: "/admin/marketplace", label: "Marketplace", icon: Store, testId: "nav-marketplace" },
  { path: "/admin/trades", label: "Trades", icon: ArrowLeftRight, testId: "nav-trades" },
  { path: "/admin/transactions", label: "Transactions", icon: Receipt, testId: "nav-transactions" },
  { path: "/admin/requests", label: "Requests", icon: Inbox, testId: "nav-requests" },
  { path: "/admin/users", label: "Admin Users", icon: UsersIcon, testId: "nav-users" },
  { path: "/admin/auto-import", label: "Auto-import", icon: FileSpreadsheet, testId: "nav-auto-import" },
  { path: "/admin/live", label: "Live stream", icon: Radio, testId: "nav-live" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();

  async function handleSignOut() {
    await logout();
    setLocation("/");
  }

  // Unread "New" customer requests count — lights a dot on the Requests nav.
  const { data: newRequests = [] } = useQuery<CustomerRequest[]>({
    queryKey: ["/api/requests", "New"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/requests?status=New");
        return await res.json();
      } catch {
        return [];
      }
    },
    refetchInterval: 60_000,
  });
  const unreadCount = newRequests.length;

  // Clear the "pulse" when the user actually visits the Requests page.
  const [lastSeenCount, setLastSeenCount] = useState(0);
  useEffect(() => {
    if (location === "/admin/requests") setLastSeenCount(unreadCount);
  }, [location, unreadCount]);
  const showUnreadDot = unreadCount > 0 && location !== "/admin/requests";

  return (
    <TooltipContextHack>
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center px-5 border-b border-sidebar-border" style={{ boxShadow: "0 1px 0 hsl(var(--brand-gold) / 0.2)" }}>
          <Logo />
        </div>
        {/* Back-to-shop pill */}
        <Link
          href="/"
          data-testid="link-back-to-shop"
          className="mx-3 mt-3 flex items-center justify-between rounded-md border border-[hsl(var(--brand-gold)/0.35)] bg-[hsl(var(--brand-gold)/0.08)] px-3 py-2 text-xs font-semibold text-sidebar-foreground/90 hover:bg-[hsl(var(--brand-gold)/0.18)] hover:text-sidebar-foreground transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <Store className="h-3.5 w-3.5 text-[hsl(var(--brand-gold-bright))]" />
            <span>View customer shop</span>
          </span>
          <ExternalLink className="h-3 w-3 opacity-60" />
        </Link>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map((item) => {
            const active = location === item.path;
            const Icon = item.icon;
            const isRequests = item.path === "/admin/requests";
            return (
              <Link
                key={item.path}
                href={item.path}
                data-testid={item.testId}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                {isRequests && showUnreadDot && (
                  <span
                    className="ml-auto inline-flex items-center gap-1.5"
                    data-testid="requests-unread-dot"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
                      <span className="relative rounded-full h-2 w-2 bg-primary" />
                    </span>
                    <span className="text-[10px] tabular-nums text-primary font-bold">
                      {unreadCount}
                    </span>
                  </span>
                )}
                {active && !(isRequests && showUnreadDot) && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <button
            onClick={toggle}
            data-testid="button-theme-toggle"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
            <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>

          {user && (
            <div className="mt-2 rounded-md border border-[hsl(var(--brand-gold)/0.25)] bg-sidebar-accent/40 px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <UserCircle className="h-4 w-4 shrink-0 text-[hsl(var(--brand-gold-bright))]" />
                <span
                  className="truncate text-xs font-semibold text-sidebar-foreground"
                  data-testid="text-current-username"
                  title={user.email}
                >
                  {user.username}
                </span>
                <span className="ml-auto text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--brand-gold-bright))] font-bold">
                  Admin
                </span>
              </div>
              <button
                onClick={handleSignOut}
                data-testid="button-sign-out"
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-sidebar-border/60 bg-sidebar/60 px-2 py-1.5 text-[11px] font-semibold text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:border-[hsl(var(--brand-gold)/0.4)] transition-colors"
              >
                <LogOut className="h-3 w-3" />
                Sign out
              </button>
            </div>
          )}

          <div className="px-3 pt-2 pb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">
              @cpulls.cards
            </span>
            <SocialLinks size="sm" variant="ghost" />
          </div>
          <div className="px-3 py-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">
            <span>v1.0 · Collector</span>
            <ConnectionDot />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div
        className="md:hidden fixed top-0 inset-x-0 h-14 bg-sidebar text-sidebar-foreground border-b border-sidebar-border z-40 flex items-center justify-between px-4"
        style={{ boxShadow: "inset 0 1px 0 hsl(var(--brand-gold) / 0.35), 0 1px 0 hsl(var(--brand-gold) / 0.2)" }}
      >
        <Logo />
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            className="p-2 rounded-md hover:bg-sidebar-accent"
            data-testid="button-theme-toggle-mobile"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setMobileOpen((x) => !x)}
            className="p-2 rounded-md hover:bg-sidebar-accent"
            data-testid="button-mobile-menu"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 top-14 z-30 bg-sidebar text-sidebar-foreground overflow-y-auto"
          onClick={() => setMobileOpen(false)}
          style={{ boxShadow: "inset 0 1px 0 hsl(var(--brand-gold) / 0.35)" }}
        >
          {/* Back-to-shop pill (mirrors desktop sidebar) */}
          <Link
            href="/"
            data-testid="link-back-to-shop-mobile"
            className="mx-4 mt-4 flex items-center justify-between rounded-md border border-[hsl(var(--brand-gold)/0.35)] bg-[hsl(var(--brand-gold)/0.08)] px-3 py-2.5 text-sm font-semibold text-sidebar-foreground/90 hover:bg-[hsl(var(--brand-gold)/0.18)] hover:text-sidebar-foreground transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <Store className="h-4 w-4 text-[hsl(var(--brand-gold-bright))]" />
              <span>View customer shop</span>
            </span>
            <ExternalLink className="h-3.5 w-3.5 opacity-60" />
          </Link>
          <nav className="p-4 space-y-1">
            {NAV.map((item) => {
              const active = location === item.path;
              const Icon = item.icon;
              const isRequests = item.path === "/admin/requests";
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-4 py-3 text-base font-medium",
                    active
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground/80"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                  {isRequests && showUnreadDot && (
                    <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="px-4 pt-4 pb-6 border-t border-sidebar-border mt-4 space-y-3">
            {user && (
              <div className="rounded-md border border-[hsl(var(--brand-gold)/0.25)] bg-sidebar-accent/40 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <UserCircle className="h-4 w-4 shrink-0 text-[hsl(var(--brand-gold-bright))]" />
                  <span className="truncate text-sm font-semibold">{user.username}</span>
                  <span className="ml-auto text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--brand-gold-bright))] font-bold">
                    Admin
                  </span>
                </div>
                <button
                  onClick={handleSignOut}
                  data-testid="button-sign-out-mobile"
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-sidebar-border/60 bg-sidebar/60 px-2 py-1.5 text-[11px] font-semibold text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:border-[hsl(var(--brand-gold)/0.4)] transition-colors"
                >
                  <LogOut className="h-3 w-3" /> Sign out
                </button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">
                @cpulls.cards
              </span>
              <SocialLinks size="sm" variant="ghost" />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 md:pt-0 pt-14">
        {children}
      </main>
    </div>
    </TooltipContextHack>
  );
}

// Small wrapper to satisfy JSX fragment wrapping (keeps diff minimal).
function TooltipContextHack({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function ConnectionDot() {
  const status = useRealtimeStatus();
  const live = status === "open";
  return (
    <span
      className="flex items-center gap-1.5 normal-case tracking-normal"
      data-testid="realtime-status"
      title={live ? "Realtime sync is live" : "Reconnecting to server\u2026"}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          live ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
        )}
      />
      <span className="text-[10px]">
        {live ? "Live" : "Reconnecting\u2026"}
      </span>
    </span>
  );
}
