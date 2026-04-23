import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/AppLayout";
import { useRealtime } from "@/lib/realtime";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import Marketplace from "@/pages/Marketplace";
import Trades from "@/pages/Trades";
import Transactions from "@/pages/Transactions";
import Scan from "@/pages/Scan";
import NotFound from "@/pages/not-found";

function AppRouter() {
  useRealtime();
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/marketplace" component={Marketplace} />
        <Route path="/trades" component={Trades} />
        <Route path="/transactions" component={Transactions} />
        <Route path="/scan" component={Scan} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
