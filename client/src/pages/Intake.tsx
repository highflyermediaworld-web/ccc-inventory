import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Camera,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Sparkles,
  ArrowLeftRight,
  HandCoins,
  ScanLine,
  RefreshCcw,
  Plus,
  Package,
  CreditCard as CardIcon,
  Barcode,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import type { Inventory } from "@shared/schema";

// ===================================================================
// Types
// ===================================================================

type IntakeType = "Buy" | "Trade";

type OpenDeal = {
  kind: "trade" | "request";
  id: number;
  label: string;
  counterparty?: string | null;
};

type Identified = {
  name?: string;
  set?: string;
  number?: string;
  rarity?: string;
  franchise?: string;
  confidence?: number;
  suggestedCondition?: string;
  category?: string; // sealed mode: "Booster Box", "ETB", etc.
};

type ScanMode = "card" | "sealed";

type PendingScan = {
  uid: string; // local id (random)
  thumbnail: string; // data: url for preview
  ided: Identified;
  marketValue: number | null;
  category: "Sealed" | "Raw" | "Slab";
  condition: string;
  costPerUnit: number | null;
  status: "pending-review" | "saved" | "failed";
  savedSku?: string;
  errorMessage?: string;
};

const FRANCHISES = [
  "Pokémon",
  "One Piece",
  "Magic The Gathering",
  "DBZ",
  "League of Legends",
  "Union Arena",
  "Other",
];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG", "Sealed", "Graded"];
const CATEGORIES = ["Sealed", "Raw", "Slab"] as const;

// ===================================================================
// API helpers
// ===================================================================

async function callIdentify(
  imageBase64: string,
  mediaType: string,
  mode: ScanMode = "card"
): Promise<Identified> {
  const res = await apiRequest("POST", "/api/scan/identify", {
    imageBase64,
    mediaType,
    mode,
  });
  return res.json();
}

async function callBarcode(code: string): Promise<{
  kind?: string;
  productName?: string;
  setName?: string;
  franchise?: string;
  category?: string;
  confidence?: number;
}> {
  const res = await apiRequest(
    "GET",
    `/api/scan/barcode?code=${encodeURIComponent(code)}&type=upc`
  );
  return res.json();
}

async function callPriceEstimate(d: {
  name: string;
  set: string;
  franchise: string;
  rarity: string;
  condition: string;
}): Promise<{ marketValue: number; disclaimer: string }> {
  const res = await apiRequest("POST", "/api/scan/price", d);
  return res.json();
}

// ===================================================================
// Page
// ===================================================================

export default function IntakePage() {
  const { toast } = useToast();

  const [intakeType, setIntakeType] = useState<IntakeType>("Buy");
  const [counterparty, setCounterparty] = useState<string>("");
  const [attachDealKey, setAttachDealKey] = useState<string>("none"); // "none" | "trade-12" | "request-5"

  const [pending, setPending] = useState<PendingScan[]>([]);
  const [reviewUid, setReviewUid] = useState<string | null>(null);

  // Pull open deals for the dropdown
  const { data: openDealsData } = useQuery<{ deals: OpenDeal[] }>({
    queryKey: ["/api/intake/open-deals"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/intake/open-deals");
      return res.json();
    },
  });
  const openDeals = openDealsData?.deals ?? [];

  // When a deal is selected, prefill counterparty
  useEffect(() => {
    if (attachDealKey === "none") return;
    const [kind, idStr] = attachDealKey.split("-");
    const id = Number(idStr);
    const match = openDeals.find((d) => d.kind === (kind as any) && d.id === id);
    if (match?.counterparty && !counterparty) {
      setCounterparty(match.counterparty);
    }
    // also if kind is "trade", default the intakeType
    if (kind === "trade") setIntakeType("Trade");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachDealKey, openDeals.length]);

  const totalMarketValue = useMemo(() => {
    return pending.reduce(
      (sum, p) => sum + (p.status === "saved" ? p.marketValue ?? 0 : 0),
      0
    );
  }, [pending]);
  const totalCost = useMemo(() => {
    return pending.reduce(
      (sum, p) =>
        sum + (p.status === "saved" ? (p.costPerUnit ?? 0) : 0),
      0
    );
  }, [pending]);
  const savedCount = pending.filter((p) => p.status === "saved").length;

  const handleNewScan = (entry: Omit<PendingScan, "uid" | "status">) => {
    const uid = Math.random().toString(36).slice(2, 10);
    setPending((arr) => [
      { ...entry, uid, status: "pending-review" },
      ...arr,
    ]);
    setReviewUid(uid);
  };

  const removeScan = (uid: string) => {
    setPending((arr) => arr.filter((p) => p.uid !== uid));
    if (reviewUid === uid) setReviewUid(null);
  };

  const updateScan = (uid: string, patch: Partial<PendingScan>) => {
    setPending((arr) =>
      arr.map((p) => (p.uid === uid ? { ...p, ...patch } : p))
    );
  };

  const saveMutation = useMutation({
    mutationFn: async (uid: string) => {
      const scan = pending.find((p) => p.uid === uid);
      if (!scan) throw new Error("Scan not found");
      const ided = scan.ided;
      const cleanName = ided.name
        ? ided.number
          ? `${ided.name} #${ided.number}`
          : ided.name
        : "";
      if (!cleanName) throw new Error("Card name is required");

      const attach =
        attachDealKey === "none"
          ? null
          : (() => {
              const [kind, idStr] = attachDealKey.split("-");
              return { kind: kind as "trade" | "request", id: Number(idStr) };
            })();

      const res = await apiRequest("POST", "/api/intake/scan-add", {
        franchise: ided.franchise || "Other",
        category: scan.category,
        setName: ided.set || "",
        name: cleanName,
        rarity: ided.rarity || "",
        condition: scan.condition,
        qty: 1,
        costPerUnit: scan.costPerUnit ?? null,
        marketValue: scan.marketValue ?? null,
        imageUrl: scan.thumbnail,
        counterparty: counterparty || null,
        intakeType,
        attachTo: attach,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Save failed");
      return data;
    },
    onSuccess: (data, uid) => {
      updateScan(uid, {
        status: "saved",
        savedSku: data.item?.id,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intake/open-deals"] });
      toast({
        title: "Added to inventory",
        description: `${data.item?.id} · ${data.item?.name}`,
      });
      setReviewUid(null);
    },
    onError: (err: any, uid) => {
      updateScan(uid, {
        status: "failed",
        errorMessage: err?.message || "Save failed",
      });
      toast({
        title: "Save failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  const reviewScan = pending.find((p) => p.uid === reviewUid) ?? null;

  return (
    <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        eyebrow="Walk-up intake"
        title="Buy / Trade In"
        description="Scan a card someone is selling or trading you, confirm, and it lands in inventory immediately."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={intakeType === "Buy" ? "default" : "outline"}
              size="sm"
              onClick={() => setIntakeType("Buy")}
              data-testid="button-intake-buy"
              className={
                intakeType === "Buy"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : ""
              }
            >
              <HandCoins className="h-4 w-4 mr-1.5" /> Buying
            </Button>
            <Button
              variant={intakeType === "Trade" ? "default" : "outline"}
              size="sm"
              onClick={() => setIntakeType("Trade")}
              data-testid="button-intake-trade"
              className={
                intakeType === "Trade"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : ""
              }
            >
              <ArrowLeftRight className="h-4 w-4 mr-1.5" /> Trading
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: scanner + deal context */}
        <div className="space-y-4">
          {/* Counterparty + deal selector */}
          <Card className="manga-panel">
            <CardContent className="p-4 md:p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Counterparty
                  </Label>
                  <Input
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    placeholder="Customer name or handle"
                    data-testid="input-counterparty"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Attach to open deal
                  </Label>
                  <Select
                    value={attachDealKey}
                    onValueChange={setAttachDealKey}
                  >
                    <SelectTrigger data-testid="select-deal">
                      <SelectValue placeholder="None — standalone intake" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        None — standalone intake
                      </SelectItem>
                      {openDeals.map((d) => (
                        <SelectItem
                          key={`${d.kind}-${d.id}`}
                          value={`${d.kind}-${d.id}`}
                        >
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {attachDealKey !== "none" && (
                <p className="text-xs text-muted-foreground">
                  Items scanned now will be linked to this deal on the
                  transaction ledger.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Scanner */}
          <IntakeScanner onScanned={handleNewScan} />
        </div>

        {/* Right: session list + totals */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 md:p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  This session
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {savedCount}/{pending.length} saved
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="rounded-md border border-border p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Market value
                  </div>
                  <div className="text-lg font-bold font-anime-alt text-primary tabular-nums">
                    {formatCurrency(totalMarketValue)}
                  </div>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {intakeType === "Trade" ? "Trade-in value" : "Paid out"}
                  </div>
                  <div className="text-lg font-bold tabular-nums">
                    {formatCurrency(totalCost)}
                  </div>
                </div>
              </div>
              {pending.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-3 text-xs"
                  onClick={() => setPending([])}
                  data-testid="button-clear-session"
                >
                  <RefreshCcw className="h-3 w-3 mr-1.5" /> Clear session
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {pending.length === 0 ? (
                <div className="p-8 text-center">
                  <ScanLine className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Scanned items will appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {pending.map((p) => (
                    <li
                      key={p.uid}
                      className="p-3 flex items-center gap-3 hover-elevate"
                      data-testid={`scan-item-${p.uid}`}
                    >
                      <img
                        src={p.thumbnail}
                        alt=""
                        className="h-14 w-10 object-cover rounded border border-border shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {p.ided.name || "Unknown card"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.ided.set || p.ided.franchise || "—"}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {p.status === "saved" && p.savedSku && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500"
                              data-testid={`badge-saved-${p.uid}`}
                            >
                              <CheckCircle2 className="h-3 w-3" /> {p.savedSku}
                            </span>
                          )}
                          {p.status === "pending-review" && (
                            <span className="text-[10px] font-bold text-primary">
                              Needs review
                            </span>
                          )}
                          {p.status === "failed" && (
                            <span className="text-[10px] font-bold text-destructive">
                              Failed
                            </span>
                          )}
                          {p.marketValue != null && (
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {formatCurrency(p.marketValue)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {p.status !== "saved" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setReviewUid(p.uid)}
                            data-testid={`button-review-${p.uid}`}
                          >
                            Review
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeScan(p.uid)}
                          data-testid={`button-remove-${p.uid}`}
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
      </div>

      {/* Review/Confirm sheet */}
      <Sheet
        open={!!reviewScan}
        onOpenChange={(open) => !open && setReviewUid(null)}
      >
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Confirm and add to inventory</SheetTitle>
            <SheetDescription>
              Review the scan, adjust if needed, then save.
            </SheetDescription>
          </SheetHeader>
          {reviewScan && (
            <div className="mt-4 space-y-4">
              <img
                src={reviewScan.thumbnail}
                alt=""
                className="w-full max-h-72 object-contain rounded border border-border bg-muted"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Franchise</Label>
                  <Select
                    value={reviewScan.ided.franchise || "Other"}
                    onValueChange={(v) =>
                      updateScan(reviewScan.uid, {
                        ided: { ...reviewScan.ided, franchise: v },
                      })
                    }
                  >
                    <SelectTrigger data-testid="select-review-franchise">
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
                </div>
                <div>
                  <Label className="text-xs">Category</Label>
                  <Select
                    value={reviewScan.category}
                    onValueChange={(v) =>
                      updateScan(reviewScan.uid, {
                        category: v as PendingScan["category"],
                      })
                    }
                  >
                    <SelectTrigger data-testid="select-review-category">
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
                </div>
              </div>
              <div>
                <Label className="text-xs">Card name</Label>
                <Input
                  value={reviewScan.ided.name || ""}
                  onChange={(e) =>
                    updateScan(reviewScan.uid, {
                      ided: { ...reviewScan.ided, name: e.target.value },
                    })
                  }
                  placeholder="e.g. Charizard"
                  data-testid="input-review-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Set</Label>
                  <Input
                    value={reviewScan.ided.set || ""}
                    onChange={(e) =>
                      updateScan(reviewScan.uid, {
                        ided: { ...reviewScan.ided, set: e.target.value },
                      })
                    }
                    data-testid="input-review-set"
                  />
                </div>
                <div>
                  <Label className="text-xs">Condition</Label>
                  <Select
                    value={reviewScan.condition}
                    onValueChange={(v) =>
                      updateScan(reviewScan.uid, { condition: v })
                    }
                  >
                    <SelectTrigger data-testid="select-review-condition">
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Market value (USD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={reviewScan.marketValue ?? ""}
                    onChange={(e) =>
                      updateScan(reviewScan.uid, {
                        marketValue:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    data-testid="input-review-market"
                  />
                  {reviewScan.marketValue != null && (
                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Auto-estimated
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs">
                    {intakeType === "Trade"
                      ? "Trade-in value"
                      : "Cost / paid"}{" "}
                    (USD)
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={reviewScan.costPerUnit ?? ""}
                    onChange={(e) =>
                      updateScan(reviewScan.uid, {
                        costPerUnit:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder={
                      reviewScan.marketValue != null
                        ? (reviewScan.marketValue * 0.6).toFixed(2)
                        : "0.00"
                    }
                    data-testid="input-review-cost"
                  />
                </div>
              </div>
              <Button
                size="lg"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => saveMutation.mutate(reviewScan.uid)}
                disabled={saveMutation.isPending}
                data-testid="button-save-scan"
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding…
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" /> Add to inventory
                  </>
                )}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ===================================================================
// Scanner widget
// ===================================================================

function IntakeScanner({
  onScanned,
}: {
  onScanned: (entry: Omit<PendingScan, "uid" | "status">) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeIntervalRef = useRef<number | null>(null);
  const lastDetectedCodeRef = useRef<string>("");
  const [cameraState, setCameraState] = useState<
    "idle" | "starting" | "ready" | "denied" | "unavailable"
  >("idle");
  const [cameraError, setCameraError] = useState<string>("");
  const [identifying, setIdentifying] = useState(false);
  const [mode, setMode] = useState<ScanMode>("card");
  // BarcodeDetector availability (Chrome desktop+Android, iOS Safari 17+)
  const barcodeSupported =
    typeof window !== "undefined" && "BarcodeDetector" in window;
  const [barcodeStatus, setBarcodeStatus] = useState<
    "idle" | "watching" | "detected"
  >("idle");
  const { toast } = useToast();

  const startCamera = useCallback(async () => {
    setCameraState("starting");
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("unavailable");
        setCameraError(
          "Camera is not available in this browser. Use file upload instead."
        );
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraState("ready");
    } catch (err: any) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setCameraState("denied");
        setCameraError(
          "Camera permission denied. Allow camera access in browser settings."
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setCameraState("unavailable");
        setCameraError(
          "No camera found. Use file upload to scan from a photo."
        );
      } else {
        setCameraState("unavailable");
        setCameraError(err?.message || "Could not start camera.");
      }
    }
  }, []);

  const stopBarcodeWatch = useCallback(() => {
    if (barcodeIntervalRef.current != null) {
      window.clearInterval(barcodeIntervalRef.current);
      barcodeIntervalRef.current = null;
    }
    setBarcodeStatus("idle");
  }, []);

  const stopCamera = useCallback(() => {
    stopBarcodeWatch();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState("idle");
  }, [stopBarcodeWatch]);

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function priceAndEmit(
    ided: Identified,
    dataUrl: string,
    forcedCondition?: string
  ) {
    let marketValue: number | null = null;
    try {
      const priceInfo = await callPriceEstimate({
        name: ided?.name || "",
        set: ided?.set || "",
        franchise: ided?.franchise || "",
        rarity: ided?.rarity || "",
        condition: forcedCondition || ided?.suggestedCondition || "NM",
      });
      marketValue = priceInfo?.marketValue ?? null;
    } catch {}
    const cond =
      forcedCondition ||
      (ided.suggestedCondition === "Sealed"
        ? "Sealed"
        : ided.suggestedCondition === "Graded"
          ? "Graded"
          : ided.suggestedCondition || "NM");
    const cat: PendingScan["category"] =
      cond === "Sealed" ? "Sealed" : cond === "Graded" ? "Slab" : "Raw";
    onScanned({
      thumbnail: dataUrl,
      ided,
      marketValue,
      category: cat,
      condition: cond,
      costPerUnit:
        marketValue != null ? Math.round(marketValue * 0.6 * 100) / 100 : null,
    });
  }

  async function identifyDataUrl(dataUrl: string) {
    const base64 = dataUrl.split(",")[1];
    setIdentifying(true);
    try {
      const ided = await callIdentify(base64, "image/jpeg", mode);
      await priceAndEmit(ided, dataUrl);
    } catch (err: any) {
      toast({
        title: "Identify failed",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIdentifying(false);
    }
  }

  // Take a snapshot of the live video for use as thumbnail when a barcode hits.
  function snapshotDataUrl(): string | null {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function handleBarcode(code: string) {
    if (!code || code === lastDetectedCodeRef.current) return;
    lastDetectedCodeRef.current = code;
    setBarcodeStatus("detected");
    setIdentifying(true);
    try {
      const lookup = await callBarcode(code);
      const conf = lookup?.confidence ?? 0;
      const thumbnail =
        snapshotDataUrl() ||
        // 1x1 transparent png placeholder if camera frame unavailable
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      // If barcode lookup is high-confidence, use it directly.
      if (conf >= 0.5 && lookup.productName) {
        const ided: Identified = {
          name: lookup.productName,
          set: lookup.setName || "",
          franchise: lookup.franchise || "Other",
          rarity: "",
          number: code,
          suggestedCondition: "Sealed",
          confidence: conf,
          category: lookup.category || "Sealed",
        };
        toast({
          title: "Barcode matched",
          description: `${lookup.productName} (${lookup.setName || "—"})`,
        });
        await priceAndEmit(ided, thumbnail, "Sealed");
      } else {
        // Fallback: capture the frame and run image identify on it.
        toast({
          title: "Barcode found, falling back to image",
          description: `Barcode ${code} didn't resolve. Trying photo identify…`,
        });
        await identifyDataUrl(thumbnail);
      }
    } catch (err: any) {
      toast({
        title: "Barcode lookup failed",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIdentifying(false);
      // Allow the same barcode to be scanned again after a short cooldown.
      window.setTimeout(() => {
        lastDetectedCodeRef.current = "";
        setBarcodeStatus((s) => (s === "detected" ? "watching" : s));
      }, 2500);
    }
  }

  // Start / stop barcode polling whenever camera ready + sealed mode + supported.
  useEffect(() => {
    stopBarcodeWatch();
    if (
      mode !== "sealed" ||
      cameraState !== "ready" ||
      !barcodeSupported ||
      !videoRef.current
    ) {
      return;
    }
    let detector: any = null;
    try {
      // @ts-ignore - BarcodeDetector is not in TS lib by default
      detector = new window.BarcodeDetector({
        formats: ["upc_a", "upc_e", "ean_13", "ean_8", "code_128", "qr_code"],
      });
    } catch (e) {
      return;
    }
    setBarcodeStatus("watching");
    barcodeIntervalRef.current = window.setInterval(async () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      if (identifying) return;
      try {
        const codes = await detector.detect(v);
        if (codes && codes.length > 0) {
          const raw = String(codes[0].rawValue || "").trim();
          if (raw) handleBarcode(raw);
        }
      } catch {}
    }, 600);
    return () => stopBarcodeWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cameraState, barcodeSupported]);

  const capture = async () => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    await identifyDataUrl(dataUrl);
  };

  const onFileChosen = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
    await identifyDataUrl(dataUrl);
  };

  return (
    <Card className="manga-panel">
      <CardContent className="p-4 md:p-5 space-y-4">
        {/* Card / Sealed mode toggle */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex rounded-md border border-border p-1">
            <Button
              variant={mode === "card" ? "default" : "ghost"}
              size="sm"
              onClick={() => setMode("card")}
              data-testid="button-mode-card"
              className={
                mode === "card"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : ""
              }
            >
              <CardIcon className="h-4 w-4 mr-1.5" /> Card
            </Button>
            <Button
              variant={mode === "sealed" ? "default" : "ghost"}
              size="sm"
              onClick={() => setMode("sealed")}
              data-testid="button-mode-sealed"
              className={
                mode === "sealed"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : ""
              }
            >
              <Package className="h-4 w-4 mr-1.5" /> Sealed / Box
            </Button>
          </div>
          {mode === "sealed" && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Barcode className="h-3.5 w-3.5" />
              {barcodeSupported
                ? barcodeStatus === "watching"
                  ? "Watching for barcode…"
                  : barcodeStatus === "detected"
                    ? "Barcode detected"
                    : "Barcode + AI fallback ready"
                : "Barcode not supported — AI image only"}
            </div>
          )}
        </div>

        <div className="relative aspect-[3/4] md:aspect-video w-full max-w-[640px] mx-auto bg-muted/50 rounded-lg overflow-hidden border border-border">
          <video
            ref={videoRef}
            className={`w-full h-full object-cover ${
              cameraState === "ready" ? "" : "hidden"
            }`}
            playsInline
            muted
            autoPlay
            data-testid="video-intake-camera"
          />
          {cameraState === "ready" && (
            <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent flex justify-center">
              <Button
                size="lg"
                onClick={capture}
                disabled={identifying}
                data-testid="button-intake-capture"
                className="min-h-14 px-8 bg-primary text-primary-foreground hover:bg-primary/90 shadow-glow-red-strong"
              >
                {identifying ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />{" "}
                    Identifying…
                  </>
                ) : (
                  <>
                    <ScanLine className="h-5 w-5 mr-2" />
                    {mode === "sealed" ? " Snap box photo" : " Scan card"}
                  </>
                )}
              </Button>
            </div>
          )}
          {cameraState !== "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
              {cameraState === "idle" && (
                <>
                  <Camera className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground mb-4 max-w-xs">
                    {mode === "sealed"
                      ? "Point your camera at the box. We'll try the barcode first, then identify by photo."
                      : "Point your camera at the card the customer is selling or trading. Tap below to start."}
                  </p>
                  <Button
                    onClick={startCamera}
                    data-testid="button-start-intake-camera"
                    size="lg"
                    className="min-h-12 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Camera className="h-4 w-4 mr-2" /> Start camera
                  </Button>
                </>
              )}
              {cameraState === "starting" && (
                <>
                  <Loader2 className="h-10 w-10 text-muted-foreground mb-3 animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Requesting camera access…
                  </p>
                </>
              )}
              {(cameraState === "denied" || cameraState === "unavailable") && (
                <>
                  <AlertCircle className="h-10 w-10 text-destructive mb-3" />
                  <p className="text-sm mb-2 font-medium">
                    {cameraState === "denied"
                      ? "Camera access denied"
                      : "Camera not available"}
                  </p>
                  <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                    {cameraError}
                  </p>
                  <Button
                    onClick={startCamera}
                    variant="outline"
                    size="sm"
                    data-testid="button-retry-intake-camera"
                  >
                    <RefreshCcw className="h-4 w-4 mr-2" /> Retry
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <label className="flex-1">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileChosen(f);
                e.target.value = "";
              }}
              data-testid="input-intake-file"
            />
            <span className="flex items-center justify-center gap-1.5 w-full h-10 rounded-md border border-border text-sm font-medium cursor-pointer hover:bg-accent">
              <Camera className="h-4 w-4" /> Upload photo
            </span>
          </label>
          {cameraState === "ready" && (
            <Button variant="outline" size="default" onClick={stopCamera}>
              Stop camera
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground text-center">
          {mode === "sealed"
            ? "Sealed mode: barcode is read automatically when possible; otherwise we identify the box from the photo."
            : "Each scan auto-identifies the card and fetches a market value. Review before saving."}
        </p>
      </CardContent>
    </Card>
  );
}
