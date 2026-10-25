import { Switch, Route } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useRealtime } from "@/lib/realtime";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import Marketplace from "@/pages/Marketplace";
import Trades from "@/pages/Trades";
import Transactions from "@/pages/Transactions";
import Scan from "@/pages/Scan";
import ShopSettings from "@/pages/ShopSettings";
import AboutSettings from "@/pages/AboutSettings";
import SystemHealth from "@/pages/SystemHealth";
import Requests from "@/pages/Requests";
import Users from "@/pages/Users";
import AutoImport from "@/pages/AutoImport";
import AdminLive from "@/pages/AdminLive";
import Intake from "@/pages/Intake";
import Payments from "@/pages/Payments";
import NotFound from "@/pages/not-found";

// Admin shell: sidebar layout + protected admin routes.
export default function AdminShell() {
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
          <Route path="/admin/shop-settings" component={ShopSettings} />
          <Route path="/admin/about-page" component={AboutSettings} />
          <Route path="/admin/system" component={SystemHealth} />
          <Route component={NotFound} />
        </Switch>
      </AppLayout>
    </ProtectedRoute>
  );
}
