import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShoppingCart,
  ArrowLeftRight,
  Plus,
  Trash2,
  Search as SearchIcon,
  Banknote,
  Loader2,
  Check,
  Camera,
  QrCode,
} from "lucide-react";
import { PayCodeDialog } from "@/components/PayCodeDialog";
import { CardChargeDialog } from "@/components/CardChargeDialog";
import { CreditCard } from "lucide-react";
import { paymentByRegisterValue } from "@/data/payments";
import { RegisterScanner, type ScanDraft } from "@/components/RegisterScanner";
import type { Inventory } from "@shared/schema";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type PaymentMethod = "Cash" | "Zelle" | "Venmo" | "CashApp" | "PayPal" | "AppleCash" | "Card" | "Other";
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "Cash", label: "Cash" },
  { value: "Zelle", label: "Zelle" },
  { value: "Venmo", label: "Venmo" },
  { value: "CashApp", label: "Cash App" },
  { value: "PayPal", label: "PayPal" },
  { value: "AppleCash", label: "Apple Cash" },
  { value: "Card", label: "Card" },
  { value: "Other", label: "Other" },
];

const FRANCHISES = [
  "Pokémon",
  "One Piece",
  "Magic The Gathering",
  "DBZ",
  "League of Legends",
  "Union Arena",
  "Other",
];
const CATEGORIES = ["Sealed", "Raw", "Slab"];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG", "Sealed", "Graded"];

export default function PaymentsPage() {
  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        eyebrow="Register"
        title="Payments"
        description="Cart checkout for sales, two-sided calculator for trades. All payments land in your transactions ledger."
      />

      <Tabs defaultValue="sell" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="sell" data-testid="tab-sell">
            <ShoppingCart className="h-4 w-4 mr-1.5" /> Sell to customer
          </TabsTrigger>
          <TabsTrigger value="trade" data-testid="tab-trade">
            <ArrowLeftRight className="h-4 w-4 mr-1.5" /> Trade calculator
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sell">
          <SellTab />
        </TabsContent>
        <TabsContent value="trade">
          <TradeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===================================================================
// Sell tab — cart checkout
// ===================================================================

type CartLine = { item: Inventory; soldPrice: number };

function SellTab() {
  const { toast } = useToast();
  const { data: inventory = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory"],
  });
  const available = useMemo(
    () => inventory.filter((i) => i.status === "In Inventory" || i.status === "Listed"),
    [inventory]
  );

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [counterparty, setCounterparty] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");
  const [payCodeOpen, setPayCodeOpen] = useState(false);
  const payOption = paymentByRegisterValue(paymentMethod);
  const [cardOpen, setCardOpen] = useState(false);
  const [customerEmail, setCustomerEmail] = useState("");
  const { data: checkoutCfg } = useQuery<{ enabled: boolean; taxPercent: number }>({
    queryKey: ["/api/shop/checkout/config"],
    staleTime: 5 * 60 * 1000,
  });
  const stripeReady = !!checkoutCfg?.enabled;
  const [discountStr, setDiscountStr] = useState("");
  const [taxStr, setTaxStr] = useState("");
  const [notes, setNotes] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return available.slice(0, 25);
    const q = query.toLowerCase();
    return available
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q) ||
          i.setName.toLowerCase().includes(q)
      )
      .slice(0, 25);
  }, [available, query]);

  const cartIds = new Set(cart.map((c) => c.item.id));
  const subtotal = cart.reduce((s, c) => s + (c.soldPrice || 0), 0);
  const discount = Number(discountStr) || 0;
  const tax = Number(taxStr) || 0;
  const total = Math.max(0, Math.round((subtotal + tax - discount) * 100) / 100);

  const addToCart = (item: Inventory) => {
    if (cartIds.has(item.id)) return;
    setCart((c) => [
      ...c,
      { item, soldPrice: item.asking ?? item.marketValue ?? 0 },
    ]);
    setQuery("");
    setShowSearch(false);
  };

  const removeFromCart = (id: string) =>
    setCart((c) => c.filter((x) => x.item.id !== id));

  const updatePrice = (id: string, val: number) =>
    setCart((c) =>
      c.map((x) => (x.item.id === id ? { ...x, soldPrice: val } : x))
    );

  const resetSale = () => {
    setCart([]);
    setDiscountStr("");
    setTaxStr("");
    setNotes("");
    setCustomerEmail("");
  };

  const onCardPaid = (summary: any) => {
    queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
    queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/shop/listings"] });
    toast({
      title: "Card payment received",
      description: `${cart.length} item${cart.length === 1 ? "" : "s"} · ${formatCurrency(summary?.total ?? total)} via Stripe`,
    });
    resetSale();
  };

  const chargeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payments/sell", {
        items: cart.map((c) => ({
          itemId: c.item.id,
          soldPrice: c.soldPrice,
        })),
        counterparty: counterparty || null,
        paymentMethod,
        discount,
        tax,
        notes: notes || null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop/listings"] });
      toast({
        title: "Sale recorded",
        description: `${cart.length} item${cart.length === 1 ? "" : "s"} · ${formatCurrency(data.total)} via ${data.paymentMethod}`,
      });
      resetSale();
    },
    onError: (err: any) => {
      toast({
        title: "Sale failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
      {/* Left: cart */}
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold mb-0.5">Session</div>
                <h3 className="serif text-xl font-medium tracking-tight">
                  Cart ({cart.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setShowScanner(true)}
                  data-testid="button-scan-to-cart"
                >
                  <Camera className="h-4 w-4 mr-1.5" /> Scan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowSearch((x) => !x)}
                  data-testid="button-add-to-cart"
                >
                  <Plus className="h-4 w-4 mr-1.5" /> Add item
                </Button>
              </div>
            </div>

            <RegisterScanner
              open={showScanner}
              onClose={() => setShowScanner(false)}
              onItemReady={(item) => addToCart(item)}
              inventory={inventory}
            />

            {showSearch && (
              <div className="mb-3 border border-border rounded-md">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, SKU, or set..."
                    className="pl-9 border-0 focus-visible:ring-0"
                    data-testid="input-search-inventory"
                  />
                </div>
                <ul className="max-h-72 overflow-y-auto border-t border-border divide-y divide-border">
                  {filtered.length === 0 ? (
                    <li className="p-3 text-xs text-muted-foreground">
                      No matching items.
                    </li>
                  ) : (
                    filtered.map((item) => (
                      <li
                        key={item.id}
                        className="p-2.5 flex items-center gap-3 hover:bg-accent cursor-pointer"
                        onClick={() => addToCart(item)}
                        data-testid={`search-result-${item.id}`}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="h-12 w-9 object-cover rounded border border-border"
                          />
                        ) : (
                          <div className="h-12 w-9 rounded border border-border bg-muted" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {item.name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.id} · {item.setName} ·{" "}
                            {item.condition ?? "NM"}
                          </div>
                        </div>
                        <div className="text-sm font-bold tabular-nums">
                          {formatCurrency(
                            item.asking ?? item.marketValue ?? 0
                          )}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}

            {cart.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-border rounded-md">
                <ShoppingCart className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Cart is empty. Tap "Add item" to start a sale.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {cart.map((line) => (
                  <li
                    key={line.item.id}
                    className="py-3 flex items-center gap-3"
                    data-testid={`cart-line-${line.item.id}`}
                  >
                    {line.item.imageUrl ? (
                      <img
                        src={line.item.imageUrl}
                        alt=""
                        className="h-14 w-10 object-cover rounded border border-border"
                      />
                    ) : (
                      <div className="h-14 w-10 rounded border border-border bg-muted" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {line.item.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {line.item.id} · {line.item.setName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={line.soldPrice}
                        onChange={(e) =>
                          updatePrice(line.item.id, Number(e.target.value))
                        }
                        className="w-24 text-right"
                        data-testid={`input-price-${line.item.id}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFromCart(line.item.id)}
                        data-testid={`button-remove-${line.item.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: checkout summary */}
      <div className="space-y-4">
        <Card className="manga-panel">
          <CardContent className="p-4 md:p-5 space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Customer
              </Label>
              <Input
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                placeholder="Name or handle (optional)"
                data-testid="input-sell-customer"
              />
              {paymentMethod === "Card" && stripeReady && (
                <Input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="Email for the receipt (optional)"
                  className="mt-2"
                  data-testid="input-sell-email"
                />
              )}
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                Payment method
              </Label>
              <div className="grid grid-cols-3 gap-1.5">
                {METHODS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setPaymentMethod(m.value)}
                    data-testid={`button-method-${m.value}`}
                    className={cn(
                      "h-10 rounded-md text-xs font-bold uppercase tracking-wider border transition-colors",
                      paymentMethod === m.value
                        ? "bg-primary text-primary-foreground border-primary shadow-glow-red-sm"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Discount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={discountStr}
                  onChange={(e) => setDiscountStr(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-discount"
                />
              </div>
              <div>
                <Label className="text-xs">Tax</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={taxStr}
                  onChange={(e) => setTaxStr(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-tax"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                rows={2}
                data-testid="input-sell-notes"
              />
            </div>

            {/* Totals */}
            <div className="border-t border-border pt-3 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">
                  {formatCurrency(subtotal)}
                </span>
              </div>
              {tax > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="tabular-nums">{formatCurrency(tax)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="tabular-nums">
                    -{formatCurrency(discount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1.5 border-t border-border">
                <span className="serif text-base font-bold">
                  TOTAL
                </span>
                <span className="serif text-2xl font-bold text-primary tabular-nums">
                  {formatCurrency(total)}
                </span>
              </div>
            </div>

            {payOption && (
              <Button
                variant="outline"
                className="w-full min-h-11"
                disabled={total <= 0}
                onClick={() => setPayCodeOpen(true)}
                data-testid="button-show-pay-code"
              >
                <QrCode className="h-4 w-4 mr-2" /> Show {payOption.name} code to customer
              </Button>
            )}
            {payOption && (
              <PayCodeDialog open={payCodeOpen} onOpenChange={setPayCodeOpen} option={payOption} amount={total} />
            )}

            {paymentMethod === "Card" && stripeReady ? (
              <>
                <Button
                  size="lg"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-glow-red-strong min-h-12"
                  disabled={cart.length === 0 || total < 0.5}
                  onClick={() => setCardOpen(true)}
                  data-testid="button-charge-card"
                >
                  <CreditCard className="h-5 w-5 mr-2" /> Charge card {formatCurrency(total)}
                </Button>
                {total > 0 && total < 0.5 && (
                  <p className="text-xs text-muted-foreground">Card payments need a $0.50 minimum.</p>
                )}
                <Button
                  variant="ghost"
                  className="w-full text-xs text-muted-foreground"
                  disabled={cart.length === 0 || chargeMutation.isPending}
                  onClick={() => chargeMutation.mutate()}
                  data-testid="button-charge"
                >
                  {chargeMutation.isPending ? "Recording…" : "Already paid on a card reader — just record the sale"}
                </Button>
                <CardChargeDialog
                  open={cardOpen}
                  onOpenChange={setCardOpen}
                  payload={cardOpen ? {
                    items: cart.map((c) => ({ itemId: c.item.id, soldPrice: c.soldPrice })),
                    counterparty: counterparty || null,
                    customerEmail: customerEmail || null,
                    discount,
                    tax,
                    notes: notes || null,
                  } : null}
                  onPaid={onCardPaid}
                />
              </>
            ) : (
              <Button
                size="lg"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-glow-red-strong min-h-12"
                disabled={cart.length === 0 || chargeMutation.isPending}
                onClick={() => chargeMutation.mutate()}
                data-testid="button-charge"
              >
                {chargeMutation.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Recording…
                  </>
                ) : (
                  <>
                    <Banknote className="h-5 w-5 mr-2" /> Charge{" "}
                    {formatCurrency(total)}
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ===================================================================
// Trade tab — two-sided calculator
// ===================================================================

type TheirItem = {
  uid: string;
  franchise: string;
  category: string;
  setName: string;
  name: string;
  rarity: string;
  condition: string;
  marketValue: number;
};

function makeUid() {
  return Math.random().toString(36).slice(2, 10);
}

function TradeTab() {
  const { toast } = useToast();
  const { data: inventory = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory"],
  });
  const available = useMemo(
    () =>
      inventory.filter(
        (i) => i.status === "In Inventory" || i.status === "Listed"
      ),
    [inventory]
  );

  const [counterparty, setCounterparty] = useState("");
  const [bootMethod, setBootMethod] = useState<PaymentMethod>("Cash");
  const [theirItems, setTheirItems] = useState<TheirItem[]>([]);
  const [ourIds, setOurIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [notes, setNotes] = useState("");
  const [showScanner, setShowScanner] = useState(false);

  // Trade-in scan handler: append identified card to their side as a populated row.
  const handleScanDraft = (d: ScanDraft) => {
    setTheirItems((arr) => [
      ...arr,
      {
        uid: makeUid(),
        franchise: d.franchise || "Pokémon",
        category: d.category || "Raw",
        setName: d.setName,
        name: d.name,
        rarity: d.rarity,
        condition: d.condition || "NM",
        marketValue: d.marketValue || 0,
      },
    ]);
  };

  const ourItems = useMemo(
    () =>
      ourIds
        .map((id) => available.find((i) => i.id === id))
        .filter(Boolean) as Inventory[],
    [available, ourIds]
  );

  const filtered = useMemo(() => {
    const inSet = new Set(ourIds);
    if (!query.trim()) {
      return available.filter((i) => !inSet.has(i.id)).slice(0, 25);
    }
    const q = query.toLowerCase();
    return available
      .filter(
        (i) =>
          !inSet.has(i.id) &&
          (i.name.toLowerCase().includes(q) ||
            i.id.toLowerCase().includes(q) ||
            i.setName.toLowerCase().includes(q))
      )
      .slice(0, 25);
  }, [available, query, ourIds]);

  const theirValue = theirItems.reduce((s, i) => s + (i.marketValue || 0), 0);
  const ourValue = ourItems.reduce(
    (s, i) => s + (i.marketValue ?? i.asking ?? 0),
    0
  );
  const diff = Math.round((ourValue - theirValue) * 100) / 100;
  // diff > 0  → they owe us cash (boot "in")
  // diff < 0  → we owe them cash (boot "out")
  const bootDirection: "in" | "out" | "none" =
    diff > 0 ? "in" : diff < 0 ? "out" : "none";
  const cashBoot = Math.abs(diff);

  const addBlankTheirItem = () =>
    setTheirItems((arr) => [
      ...arr,
      {
        uid: makeUid(),
        franchise: "Pokémon",
        category: "Raw",
        setName: "",
        name: "",
        rarity: "",
        condition: "NM",
        marketValue: 0,
      },
    ]);

  const updateTheir = (uid: string, patch: Partial<TheirItem>) =>
    setTheirItems((arr) =>
      arr.map((x) => (x.uid === uid ? { ...x, ...patch } : x))
    );
  const removeTheir = (uid: string) =>
    setTheirItems((arr) => arr.filter((x) => x.uid !== uid));

  const addOur = (id: string) => {
    setOurIds((a) => (a.includes(id) ? a : [...a, id]));
    setShowSearch(false);
    setQuery("");
  };
  const removeOur = (id: string) => setOurIds((a) => a.filter((x) => x !== id));

  const commitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payments/trade", {
        theirItems: theirItems
          .filter((t) => t.name.trim())
          .map((t) => ({
            franchise: t.franchise,
            category: t.category,
            setName: t.setName,
            name: t.name,
            rarity: t.rarity,
            condition: t.condition,
            marketValue: t.marketValue,
          })),
        ourItemIds: ourIds,
        counterparty: counterparty || null,
        cashBoot,
        bootDirection,
        bootMethod,
        notes: notes || null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop/listings"] });
      toast({
        title: "Trade committed",
        description: `In: ${formatCurrency(data.theirValue)} · Out: ${formatCurrency(data.ourValue)}${
          data.bootDirection !== "none"
            ? ` · ${data.bootDirection === "in" ? "Received" : "Paid"} ${formatCurrency(data.cashBoot)}`
            : ""
        }`,
      });
      setTheirItems([]);
      setOurIds([]);
      setCounterparty("");
      setNotes("");
    },
    onError: (err: any) => {
      toast({
        title: "Trade failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  const canCommit =
    (theirItems.length > 0 || ourIds.length > 0) && !commitMutation.isPending;

  return (
    <div className="space-y-4">
      <Card className="manga-panel">
        <CardContent className="p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Counterparty
              </Label>
              <Input
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                placeholder="Customer name or handle"
                data-testid="input-trade-counterparty"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Cash boot payment method
              </Label>
              <Select
                value={bootMethod}
                onValueChange={(v) => setBootMethod(v as PaymentMethod)}
              >
                <SelectTrigger data-testid="select-boot-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Their side */}
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
                  They give you
                </div>
                <h3 className="serif text-xl font-medium tracking-tight">
                  Trade-in side
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowScanner(true)}
                  data-testid="button-scan-their-item"
                >
                  <Camera className="h-4 w-4 mr-1.5" /> Scan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addBlankTheirItem}
                  data-testid="button-add-their-item"
                >
                  <Plus className="h-4 w-4 mr-1.5" /> Add item
                </Button>
              </div>
            </div>

            {theirItems.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-border rounded-md">
                <p className="text-sm text-muted-foreground">
                  Add cards the customer is offering.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {theirItems.map((t) => (
                  <li
                    key={t.uid}
                    className="border border-border rounded-md p-3 space-y-2"
                    data-testid={`their-item-${t.uid}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Input
                        value={t.name}
                        onChange={(e) =>
                          updateTheir(t.uid, { name: e.target.value })
                        }
                        placeholder="Card name"
                        className="flex-1"
                        data-testid={`input-their-name-${t.uid}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTheir(t.uid)}
                        data-testid={`button-remove-their-${t.uid}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Select
                        value={t.franchise}
                        onValueChange={(v) =>
                          updateTheir(t.uid, { franchise: v })
                        }
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FRANCHISES.map((f) => (
                            <SelectItem key={f} value={f}>
                              {f}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={t.category}
                        onValueChange={(v) =>
                          updateTheir(t.uid, { category: v })
                        }
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={t.condition}
                        onValueChange={(v) =>
                          updateTheir(t.uid, { condition: v })
                        }
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONDITIONS.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                      <Input
                        value={t.setName}
                        onChange={(e) =>
                          updateTheir(t.uid, { setName: e.target.value })
                        }
                        placeholder="Set"
                        data-testid={`input-their-set-${t.uid}`}
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={t.marketValue}
                          onChange={(e) =>
                            updateTheir(t.uid, {
                              marketValue: Number(e.target.value),
                            })
                          }
                          className="w-24 text-right"
                          data-testid={`input-their-value-${t.uid}`}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Their total
              </span>
              <span className="serif text-xl font-bold tabular-nums">
                {formatCurrency(theirValue)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Our side */}
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
                  You give them
                </div>
                <h3 className="serif text-xl font-medium tracking-tight">
                  Trade-out side
                </h3>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSearch((x) => !x)}
                data-testid="button-add-our-item"
              >
                <Plus className="h-4 w-4 mr-1.5" /> Add from inventory
              </Button>
            </div>

            {showSearch && (
              <div className="mb-3 border border-border rounded-md">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search inventory..."
                    className="pl-9 border-0 focus-visible:ring-0"
                    data-testid="input-trade-search"
                  />
                </div>
                <ul className="max-h-72 overflow-y-auto border-t border-border divide-y divide-border">
                  {filtered.length === 0 ? (
                    <li className="p-3 text-xs text-muted-foreground">
                      No matching items.
                    </li>
                  ) : (
                    filtered.map((item) => (
                      <li
                        key={item.id}
                        className="p-2.5 flex items-center gap-3 hover:bg-accent cursor-pointer"
                        onClick={() => addOur(item.id)}
                        data-testid={`trade-search-${item.id}`}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="h-12 w-9 object-cover rounded border border-border"
                          />
                        ) : (
                          <div className="h-12 w-9 rounded border border-border bg-muted" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {item.name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.id} · {item.setName}
                          </div>
                        </div>
                        <div className="text-sm font-bold tabular-nums">
                          {formatCurrency(
                            item.marketValue ?? item.asking ?? 0
                          )}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}

            {ourItems.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-border rounded-md">
                <p className="text-sm text-muted-foreground">
                  Add cards from your inventory to give in trade.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {ourItems.map((item) => (
                  <li
                    key={item.id}
                    className="py-2.5 flex items-center gap-3"
                    data-testid={`our-item-${item.id}`}
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="h-12 w-9 object-cover rounded border border-border"
                      />
                    ) : (
                      <div className="h-12 w-9 rounded border border-border bg-muted" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {item.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {item.id} · {item.setName}
                      </div>
                    </div>
                    <div className="text-sm font-bold tabular-nums">
                      {formatCurrency(item.marketValue ?? item.asking ?? 0)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOur(item.id)}
                      data-testid={`button-remove-our-${item.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Your total
              </span>
              <span className="serif text-xl font-bold tabular-nums">
                {formatCurrency(ourValue)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Difference + commit */}
      <Card className="manga-panel">
        <CardContent className="p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Balance
              </div>
              {bootDirection === "none" ? (
                <div className="text-2xl serif font-bold">
                  Even trade
                </div>
              ) : (
                <div className="text-2xl serif font-bold">
                  <span
                    className={cn(
                      bootDirection === "in"
                        ? "text-emerald-500"
                        : "text-primary"
                    )}
                  >
                    {bootDirection === "in" ? "Customer pays" : "You pay"}{" "}
                    {formatCurrency(cashBoot)}
                  </span>
                  <span className="text-sm text-muted-foreground ml-2 font-normal">
                    via {bootMethod}
                  </span>
                </div>
              )}
              <div className="mt-2">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  rows={2}
                  data-testid="input-trade-notes"
                />
              </div>
            </div>
            <Button
              size="lg"
              className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-glow-red-strong min-h-14 px-8"
              disabled={!canCommit}
              onClick={() => commitMutation.mutate()}
              data-testid="button-commit-trade"
            >
              {commitMutation.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />{" "}
                  Committing…
                </>
              ) : (
                <>
                  <Check className="h-5 w-5 mr-2" /> Commit trade
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <RegisterScanner
        open={showScanner}
        onClose={() => setShowScanner(false)}
        onDraftReady={handleScanDraft}
        inventory={inventory}
        draftOnly
        title="Scan trade-in card"
      />
    </div>
  );
}
