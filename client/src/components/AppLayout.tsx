import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "./Logo";
import { useTheme } from "./ThemeProvider";
import {
  LayoutDashboard,
  Package,
  Store,
  ArrowLeftRight,
  Receipt,
  ScanLine,
  Moon,
  Sun,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { path: "/inventory", label: "Inventory", icon: Package, testId: "nav-inventory" },
  { path: "/scan", label: "Scan", icon: ScanLine, testId: "nav-scan" },
  { path: "/marketplace", label: "Marketplace", icon: Store, testId: "nav-marketplace" },
  { path: "/trades", label: "Trades", icon: ArrowLeftRight, testId: "nav-trades" },
  { path: "/transactions", label: "Transactions", icon: Receipt, testId: "nav-transactions" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggle } = useTheme();

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center px-5 border-b border-sidebar-border">
          <Logo />
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map((item) => {
            const active = location === item.path;
            const Icon = item.icon;
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
                {active && (
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
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">
            v1.0 · Collector
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-sidebar text-sidebar-foreground border-b border-sidebar-border z-40 flex items-center justify-between px-4">
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
          className="md:hidden fixed inset-0 top-14 z-30 bg-sidebar text-sidebar-foreground"
          onClick={() => setMobileOpen(false)}
        >
          <nav className="p-4 space-y-1">
            {NAV.map((item) => {
              const active = location === item.path;
              const Icon = item.icon;
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
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 md:pt-0 pt-14">
        {children}
      </main>
    </div>
  );
}
