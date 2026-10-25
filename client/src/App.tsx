import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/lib/auth";
import Shop from "@/pages/Shop";
import { FaqPage, AboutPage } from "@/pages/Info";

// Admin, login and signup are split into their own chunks so the public
// storefront only downloads what it needs.
const AdminShell = lazy(() => import("./AdminApp"));
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));

function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground" aria-busy="true">
      Loading…
    </div>
  );
}
import NotFound from "@/pages/not-found";

// Redirects legacy /#/shop to the new home page at /#/.
function ShopRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/");
  }, [setLocation]);
  return null;
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
      <Route path="/faq" component={FaqPage} />
      <Route path="/about" component={AboutPage} />
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
              <Suspense fallback={<RouteFallback />}>
                <AppRouter />
              </Suspense>
            </Router>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
