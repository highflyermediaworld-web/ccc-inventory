import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, X, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Inventory } from "@shared/schema";
import { formatCurrency } from "@/lib/format";

type Identified = {
  name?: string;
  set?: string;
  number?: string;
  rarity?: string;
  franchise?: string;
  confidence?: number;
  suggestedCondition?: string;
  category?: string; // sealed mode: "Blister" | "Booster Box" | "ETB" | …
};

type ScanMode = "card" | "sealed";

export type ScanDraft = {
  franchise: string;
  category: string; // "Raw" | "Sealed" | "Slab"
  setName: string;
  name: string;
  rarity: string;
  condition: string;
  marketValue: number;
  imageDataUrl: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Sell mode: called once an inventory item is identified/created and ready to add to cart. */
  onItemReady?: (item: Inventory) => void;
  /** Trade mode: called with identified+priced data; caller decides what to do (no inventory row created). */
  onDraftReady?: (draft: ScanDraft) => void;
  /** Existing inventory used to match without creating duplicates (sell mode only). */
  inventory: Inventory[];
  /** When true, scanner skips inventory match/create and returns a ScanDraft via onDraftReady. */
  draftOnly?: boolean;
  /** Optional title override (e.g. "Scan trade-in card"). */
  title?: string;
};

// Normalize names for fuzzy matching against existing inventory.
function norm(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Try to find an existing inventory row that matches the identified card.
// Matches on franchise + name + set name, falling back to name only.
function findExistingMatch(
  ided: Identified,
  inventory: Inventory[],
  scanMode: ScanMode = "card"
): Inventory | null {
  if (!ided.name) return null;
  const nName = norm(ided.name);
  const nSet = norm(ided.set);
  const nFr = norm(ided.franchise);

  const eligible = inventory.filter(
    (i) =>
      (i.status === "In Inventory" || i.status === "Listed") &&
      (scanMode === "sealed"
        ? i.category === "Sealed"
        : i.category !== "Sealed")
  );

  // 1. Strongest match: same franchise + name + set.
  if (nFr && nSet) {
    const exact = eligible.find(
      (i) =>
        norm(i.franchise) === nFr &&
        norm(i.name) === nName &&
        norm(i.setName) === nSet
    );
    if (exact) return exact;
  }

  // 2. Same franchise + name (any condition/set).
  if (nFr) {
    const byFranchise = eligible.find(
      (i) => norm(i.franchise) === nFr && norm(i.name) === nName
    );
    if (byFranchise) return byFranchise;
  }

  // 3. Name-only fallback (still requires exact normalized match).
  const byName = eligible.find((i) => norm(i.name) === nName);
  return byName ?? null;
}

export function RegisterScanner({
  open,
  onClose,
  onItemReady,
  onDraftReady,
  inventory,
  draftOnly = false,
  title,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  const [cameraState, setCameraState] = useState<
    "idle" | "starting" | "ready" | "denied" | "unavailable"
  >("idle");
  const [cameraError, setCameraError] = useState("");
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "identifying" | "matching" | "creating" | "done"
  >("idle");
  const [lastResult, setLastResult] = useState<{
    item: Inventory;
    isNew: boolean;
  } | null>(null);
  const [mode, setMode] = useState<ScanMode>("card");

  const attachStream = useCallback(async () => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    if (v.srcObject !== s) v.srcObject = s;
    try {
      await v.play();
    } catch {
      // Some browsers reject autoplay; ignore — user click below will retry.
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraState("starting");
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("unavailable");
        setCameraError("Camera not available in this browser.");
        return;
      }
      // Try back camera first; fall back to any camera if it fails.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      streamRef.current = stream;
      setCameraState("ready");
      // attachStream runs via the effect below once the <video> is in the DOM.
    } catch (err: any) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setCameraState("denied");
        setCameraError("Camera permission denied.");
      } else {
        setCameraState("unavailable");
        setCameraError(err?.message || "Could not start camera.");
      }
    }
  }, []);

  // Once the <video> element exists and we have a stream, attach it.
  useEffect(() => {
    if (cameraState === "ready") {
      attachStream();
    }
  }, [cameraState, attachStream]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState("idle");
  }, []);

  // Auto-start camera when dialog opens; stop when it closes.
  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
      setLastResult(null);
      setPhase("idle");
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const captureFrame = (): { base64: string; mediaType: string } | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const base64 = dataUrl.split(",")[1] || "";
    return { base64, mediaType: "image/jpeg" };
  };

  const handleCapture = async () => {
    if (working || cameraState !== "ready") return;
    const frame = captureFrame();
    if (!frame) {
      toast({
        title: "Capture failed",
        description: "Try again in a second.",
        variant: "destructive",
      });
      return;
    }

    setWorking(true);
    setPhase("identifying");
    try {
      const identifyRes = await apiRequest("POST", "/api/scan/identify", {
        imageBase64: frame.base64,
        mediaType: frame.mediaType,
        mode,
      });
      const ided: Identified = await identifyRes.json();
      if (!ided?.name) {
        toast({
          title: "Couldn't read that card",
          description: "Try a clearer shot in good light.",
          variant: "destructive",
        });
        setPhase("idle");
        setWorking(false);
        return;
      }

      // Compute shared fields (used by both draft and inventory paths).
      const isSealed = mode === "sealed";
      const condition = isSealed ? "Sealed" : (ided.suggestedCondition || "NM");
      const category = isSealed ? "Sealed" : "Raw";
      const rarity = isSealed ? (ided.category || "") : (ided.rarity || "");

      // Always price the item so the caller has a number to work with.
      setPhase("creating");
      let marketValue = 0;
      try {
        const priceRes = await apiRequest("POST", "/api/scan/price", {
          name: ided.name,
          set: ided.set || "",
          franchise: ided.franchise || "Other",
          rarity,
          condition,
        });
        const priceData = await priceRes.json();
        if (typeof priceData?.marketValue === "number") {
          marketValue = priceData.marketValue;
        }
      } catch {
        // non-fatal
      }

      const imageDataUrl = `data:${frame.mediaType};base64,${frame.base64}`;

      // DRAFT-ONLY MODE (e.g. trade-in side): return identified+priced data; do not touch inventory.
      if (draftOnly) {
        setPhase("done");
        onDraftReady?.({
          franchise: ided.franchise || "Other",
          category,
          setName: ided.set || "",
          name: ided.name,
          rarity,
          condition,
          marketValue,
          imageDataUrl,
        });
        toast({
          title: "Card identified",
          description: `${ided.name}${marketValue ? ` · ${formatCurrency(marketValue)}` : ""}`,
        });
        setWorking(false);
        return;
      }

      // SELL MODE: match existing inventory first.
      setPhase("matching");
      const existing = findExistingMatch(ided, inventory, mode);
      if (existing) {
        setLastResult({ item: existing, isNew: false });
        setPhase("done");
        onItemReady?.(existing);
        toast({
          title: "Added to cart",
          description: `${existing.name} · ${formatCurrency(
            existing.asking ?? existing.marketValue ?? 0
          )}`,
        });
        setWorking(false);
        return;
      }

      // Not in inventory — create a new row via the intake endpoint, then add.
      const createRes = await apiRequest("POST", "/api/intake/scan-add", {
        franchise: ided.franchise || "Other",
        category,
        setName: ided.set || "",
        name: ided.name,
        rarity,
        condition,
        qty: 1,
        costPerUnit: null,
        marketValue: marketValue || null,
        imageUrl: imageDataUrl,
        counterparty: null,
        intakeType: "Buy",
        attachTo: null,
      });
      const createData = await createRes.json();
      if (!createData?.ok || !createData?.item) {
        throw new Error(createData?.message || "Could not create item");
      }
      setLastResult({ item: createData.item, isNew: true });
      setPhase("done");
      onItemReady?.(createData.item);
      toast({
        title: "New item added",
        description: `${createData.item.id} · ${createData.item.name}`,
      });
    } catch (err: any) {
      toast({
        title: "Scan failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
      setPhase("idle");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="max-w-md p-0 overflow-hidden flex flex-col gap-0"
        style={{ maxHeight: "100dvh", height: "min(100dvh, 720px)" }}
      >
        <DialogTitle className="sr-only">Scan card to register</DialogTitle>
        <div className="shrink-0 p-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            <h3 className="font-anime-alt text-base font-bold">
              {title || "Scan to register"}
            </h3>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={onClose}
            data-testid="button-close-scanner"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Card / Sealed toggle */}
        <div className="shrink-0 px-4 pt-2 pb-2 flex items-center gap-2">
          <Button
            size="sm"
            variant={mode === "card" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setMode("card")}
            disabled={working}
            data-testid="button-mode-card"
          >
            Card
          </Button>
          <Button
            size="sm"
            variant={mode === "sealed" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setMode("sealed")}
            disabled={working}
            data-testid="button-mode-sealed"
          >
            Sealed
          </Button>
        </div>

        <div className="relative bg-black flex-1 min-h-0 flex items-center justify-center">
          {/* Video is always mounted so ref is valid; hidden until ready. */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            onCanPlay={() => {
              // Defensive: ensure playback starts on iOS Safari.
              videoRef.current?.play().catch(() => {});
            }}
            className={
              cameraState === "ready"
                ? "w-full h-full object-cover"
                : "hidden"
            }
          />
          {cameraState === "starting" || cameraState === "idle" ? (
            <div className="text-white text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting camera…
            </div>
          ) : cameraState !== "ready" ? (
            <div className="text-white p-6 text-center">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-yellow-400" />
              <p className="text-sm">{cameraError || "Camera unavailable"}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={startCamera}
              >
                Try again
              </Button>
            </div>
          ) : null}

          {working && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <div className="text-white text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p className="text-sm">
                  {phase === "identifying" && "Reading card…"}
                  {phase === "matching" && "Matching inventory…"}
                  {phase === "creating" && "Adding new item…"}
                </p>
              </div>
            </div>
          )}
        </div>

        {lastResult && (
          <Card className="shrink-0 m-3 border-primary/40">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Check className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  {lastResult.isNew ? "New item created" : "Found in inventory"}
                </div>
                <div className="text-sm font-medium truncate">
                  {lastResult.item.name}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {lastResult.item.id} · {lastResult.item.setName} ·{" "}
                  {formatCurrency(
                    lastResult.item.asking ??
                      lastResult.item.marketValue ??
                      0
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div
          className="shrink-0 p-3 border-t border-border flex items-center gap-2"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <Button
            className="flex-1"
            disabled={cameraState !== "ready" || working}
            onClick={handleCapture}
            data-testid="button-capture-card"
          >
            {working ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Working…
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-1.5" /> Capture
              </>
            )}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={working}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
