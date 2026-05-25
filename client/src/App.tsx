import { useEffect } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useRealtime } from "@/lib/realtime";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import Marketplace from "@/pages/Marketplace";
import Trades from "@/pages/Trades";
import Transactions from "@/pages/Transactions";
import Scan from "@/pages/Scan";
import Shop from "@/pages/Shop";
import Requests from "@/pages/Requests";
import Users from "@/pages/Users";
import AutoImport from "@/pages/AutoImport";
import AdminLive from "@/pages/AdminLive";
import Intake from "@/pages/Intake";
import Payments from "@/pages/Payments";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import NotFound from "@/pages/not-found";

// Redirects legacy /#/shop to the new home page at /#/.
function ShopRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/");
  }, [setLocation]);
  return null;
}

// Admin shell: sidebar layout + protected admin routes.
function AdminShell() {
  useRealtime();
  return (
    <ProtectedRoute>
      <AppLayout>
        <Switch>
          <Route path="/admin" component={Dashboard} />
          <Route path="/admin/inventory" component={Inventory} />
          <Route path="/admin/marketplace" component={Marketplace} />
          <Route path="/admin/trades" component={Trades} />
          <Route path="/admin/transactions" component={Transactions} />
          <Route path="/admin/scan" component={Scan} />
          <Route path="/admin/requests" component={Requests} />
          <Route path="/admin/users" component={Users} />
          <Route path="/admin/auto-import" component={AutoImport} />
          <Route path="/admin/live" component={AdminLive} />
          <Route path="/admin/intake" component={Intake} />
          <Route path="/admin/payments" component={Payments} />
          <Route component={NotFound} />
        </Switch>
      </AppLayout>
    </ProtectedRoute>
  );
}

function AppRouter() {
  const [location] = useLocation();

  // Auth pages render standalone (no sidebar)
  if (location.startsWith("/login")) return <Login />;
  if (location.startsWith("/signup")) return <Signup />;

  // Admin section — sidebar + protected
  if (location.startsWith("/admin")) return <AdminShell />;

  // /shop → / (legacy)
  if (location.startsWith("/shop")) return <ShopRedirect />;

  // Home / catch-all: customer storefront
  return (
    <Switch>
      <Route path="/" component={Shop} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
