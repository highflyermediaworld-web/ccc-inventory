import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Inventory } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Camera,
  ScanLine,
  Images,
  Search as SearchIcon,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCcw,
  Upload,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AddItemDialog,
  type AddItemDefaults,
} from "@/components/AddItemDialog";
import { BrowserMultiFormatReader } from "@zxing/browser";

// ===================================================================
// Shared helpers
// ===================================================================

async function callIdentify(
  imageBase64: string,
  mediaType: string
): Promise<any> {
  const res = await apiRequest("POST", "/api/scan/identify", {
    imageBase64,
    mediaType,
  });
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

/** Convert a File to base64 (no data: prefix). */
function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = fr.result as string;
      const match = result.match(/^data:(.*?);base64,(.*)$/);
      if (match) resolve({ mediaType: match[1], base64: match[2] });
      else reject(new Error("Could not read image"));
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function mapIdentifiedToDefaults(
  ided: any,
  opts?: { marketValue?: number; category?: string }
): AddItemDefaults {
  const isSealed =
    ided?.suggestedCondition === "Sealed" || opts?.category === "Sealed";
  const isGraded = ided?.suggestedCondition === "Graded";
  return {
    franchise: ided?.franchise || "Pokémon",
    category: opts?.category || (isSealed ? "Sealed" : isGraded ? "Slab" : "Raw"),
    setName: ided?.set || "",
    name: ided?.name
      ? ided?.number
        ? `${ided.name} #${ided.number}`
        : ided.name
      : "",
    rarity: ided?.rarity || "",
    condition:
      ided?.suggestedCondition && ided.suggestedCondition !== "Sealed" && ided.suggestedCondition !== "Graded"
        ? ided.suggestedCondition
        : ided?.suggestedCondition === "Sealed"
        ? "Sealed"
        : "NM",
    qty: 1,
    marketValue: opts?.marketValue,
  };
}

// ===================================================================
// Page
// ===================================================================

export default function ScanPage() {
  const { data: items = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory"],
  });
  const existingIds = useMemo(() => items.map((i) => i.id), [items]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDefaults, setDialogDefaults] = useState<AddItemDefaults>({});
  const [dialogThumb, setDialogThumb] = useState<string | undefined>(undefined);
  const [dialogAiEstimate, setDialogAiEstimate] = useState(false);
  const [dialogContext, setDialogContext] = useState<string | undefined>();

  const openAdd = (
    defaults: AddItemDefaults,
    opts?: {
      thumbnail?: string;
      aiEstimate?: boolean;
      context?: string;
    }
  ) => {
    setDialogDefaults(defaults);
    setDialogThumb(opts?.thumbnail);
    setDialogAiEstimate(!!opts?.aiEstimate);
    setDialogContext(opts?.context);
    setDialogOpen(true);
  };

  return (
    <div className="p-4 md:p-8 max-w-[1000px] mx-auto">
      <PageHeader
        eyebrow="Capture"
        title="Scan"
        description="Add cards with camera, barcode, bulk photo upload, or smart search."
      />

      <Tabs defaultValue="camera" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto md:h-10">
          <TabsTrigger
            value="camera"
            data-testid="tab-camera"
            className="flex items-center gap-1.5 h-10"
          >
            <Camera className="h-4 w-4" />
            <span className="text-xs md:text-sm">Camera</span>
          </TabsTrigger>
          <TabsTrigger
            value="barcode"
            data-testid="tab-barcode"
            className="flex items-center gap-1.5 h-10"
          >
            <ScanLine className="h-4 w-4" />
            <span className="text-xs md:text-sm">Barcode / QR</span>
          </TabsTrigger>
          <TabsTrigger
            value="bulk"
            data-testid="tab-bulk"
            className="flex items-center gap-1.5 h-10"
          >
            <Images className="h-4 w-4" />
            <span className="text-xs md:text-sm">Bulk upload</span>
          </TabsTrigger>
          <TabsTrigger
            value="search"
            data-testid="tab-search"
            className="flex items-center gap-1.5 h-10"
          >
            <SearchIcon className="h-4 w-4" />
            <span className="text-xs md:text-sm">Search</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="camera" className="mt-4">
          <CameraTab onIdentified={openAdd} />
        </TabsContent>
        <TabsContent value="barcode" className="mt-4">
          <BarcodeTab onIdentified={openAdd} />
        </TabsContent>
        <TabsContent value="bulk" className="mt-4">
          <BulkTab onIdentified={openAdd} />
        </TabsContent>
        <TabsContent value="search" className="mt-4">
          <SearchTab onIdentified={openAdd} />
        </TabsContent>
      </Tabs>

      <AddItemDialog
        open={dialogOpen}
        defaults={dialogDefaults}
        existingIds={existingIds}
        thumbnailUrl={dialogThumb}
        marketValueIsEstimate={dialogAiEstimate}
        contextLabel={dialogContext}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

// ===================================================================
// Tab 1: Camera — AI identify
// ===================================================================

type OpenAddFn = (
  defaults: AddItemDefaults,
  opts?: { thumbnail?: string; aiEstimate?: boolean; context?: string }
) => void;

function CameraTab({ onIdentified }: { onIdentified: OpenAddFn }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<
    "idle" | "starting" | "ready" | "denied" | "unavailable"
  >("idle");
  const [cameraError, setCameraError] = useState<string>("");
  const [identifying, setIdentifying] = useState(false);
  const { toast } = useToast();

  const startCamera = useCallback(async () => {
    setCameraState("starting");
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("unavailable");
        setCameraError(
          "Camera is not available in this browser. Use the Bulk Upload tab to submit photos instead."
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
          "Camera permission was denied. Grant camera access in your browser settings and try again."
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setCameraState("unavailable");
        setCameraError(
          "No camera was found on this device. You can still use Bulk Upload to submit photos."
        );
      } else {
        setCameraState("unavailable");
        setCameraError(err?.message || "Could not start camera.");
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

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
    const base64 = dataUrl.split(",")[1];

    setIdentifying(true);
    try {
      const ided = await callIdentify(base64, "image/jpeg");
      // kick off price in parallel with UI open
      let priceInfo: { marketValue: number; disclaimer: string } | null = null;
      try {
        priceInfo = await callPriceEstimate({
          name: ided?.name || "",
          set: ided?.set || "",
          franchise: ided?.franchise || "",
          rarity: ided?.rarity || "",
          condition: ided?.suggestedCondition || "NM",
        });
      } catch {}
      onIdentified(
        mapIdentifiedToDefaults(ided, { marketValue: priceInfo?.marketValue }),
        {
          thumbnail: dataUrl,
          aiEstimate: !!priceInfo,
          context:
            ided?.confidence > 0.5
              ? `Identified with ${(ided.confidence * 100).toFixed(0)}% confidence · review before saving.`
              : "Low confidence — please fill or correct fields manually.",
        }
      );
    } catch (err: any) {
      toast({
        title: "Identify failed",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIdentifying(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="relative aspect-[3/4] md:aspect-video w-full max-w-[640px] mx-auto bg-muted/50 rounded-lg overflow-hidden border border-border">
          <video
            ref={videoRef}
            className={`w-full h-full object-cover ${
              cameraState === "ready" ? "" : "hidden"
            }`}
            playsInline
            muted
            autoPlay
            data-testid="video-camera"
          />
          {cameraState !== "ready" && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
              data-testid="state-camera-placeholder"
            >
              {cameraState === "idle" && (
                <>
                  <Camera className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground mb-4">
                    Point your camera at a card. Tap the button below to start.
                  </p>
                  <Button
                    onClick={startCamera}
                    data-testid="button-start-camera"
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
                  <p className="text-sm mb-2 font-medium" data-testid="text-camera-error">
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
                    data-testid="button-retry-camera"
                  >
                    <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Try again
                  </Button>
                </>
              )}
            </div>
          )}

          {identifying && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm"
              data-testid="state-identifying"
            >
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
                <p className="text-lg font-semibold">Identifying…</p>
                <p className="text-xs text-muted-foreground">
                  Sending to AI for card recognition
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          {cameraState === "ready" && (
            <>
              <Button
                onClick={capture}
                disabled={identifying}
                size="lg"
                className="min-h-14 min-w-[160px] bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg"
                data-testid="button-capture"
              >
                <Camera className="h-5 w-5 mr-2" /> Capture
              </Button>
              <Button
                onClick={() => {
                  stopCamera();
                  setCameraState("idle");
                }}
                variant="outline"
                size="lg"
                className="min-h-14"
                data-testid="button-stop-camera"
              >
                Stop
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ===================================================================
// Tab 2: Barcode / QR
// ===================================================================

function BarcodeTab({ onIdentified }: { onIdentified: OpenAddFn }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [scannerState, setScannerState] = useState<
    "idle" | "starting" | "scanning" | "paused" | "denied" | "unavailable"
  >("idle");
  const [scannerError, setScannerError] = useState<string>("");
  const [decoded, setDecoded] = useState<string>("");
  const [decoding, setDecoding] = useState(false);
  const { toast } = useToast();

  const stopScanner = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      const s = videoRef.current.srcObject as MediaStream;
      s.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    return () => stopScanner();
  }, [stopScanner]);

  const startScanner = useCallback(async () => {
    setScannerState("starting");
    setScannerError("");
    setDecoded("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerState("unavailable");
        setScannerError("Camera not available in this browser.");
        return;
      }
      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
      }
      const controls = await readerRef.current.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result, _err, ctrls) => {
          if (result) {
            const text = result.getText();
            setDecoded(text);
            setScannerState("paused");
            ctrls.stop();
            controlsRef.current = null;
          }
        }
      );
      controlsRef.current = controls;
      setScannerState("scanning");
    } catch (err: any) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setScannerState("denied");
        setScannerError("Camera permission was denied. Grant access to scan.");
      } else {
        setScannerState("unavailable");
        setScannerError(err?.message || "Could not start scanner.");
      }
    }
  }, []);

  const lookup = async () => {
    if (!decoded) return;
    setDecoding(true);
    try {
      const isUrl = /^https?:\/\//i.test(decoded);
      const res = await apiRequest(
        "GET",
        `/api/scan/barcode?code=${encodeURIComponent(decoded)}&type=${isUrl ? "qr" : "upc"}`
      );
      const data = await res.json();
      if (data.kind === "slab") {
        // graded slab
        const def: AddItemDefaults = {
          franchise: data.franchise || "Pokémon",
          category: "Slab",
          setName: data.setName || "",
          name:
            data.cardName ||
            (data.year ? `${data.year} ${data.cardName ?? ""}` : ""),
          condition: data.grade
            ? `${data.grader || "PSA"} ${data.grade}`
            : "Graded",
          qty: 1,
          notes: data.certNumber
            ? `${data.grader || "Grader"} cert #${data.certNumber} · ${data.sourceUrl}`
            : data.sourceUrl,
        };
        let price: { marketValue: number; disclaimer: string } | null = null;
        try {
          price = await callPriceEstimate({
            name: def.name || "",
            set: def.setName || "",
            franchise: def.franchise || "",
            rarity: "",
            condition: def.condition || "",
          });
        } catch {}
        onIdentified(
          { ...def, marketValue: price?.marketValue },
          {
            aiEstimate: !!price,
            context:
              data.confidence > 0.5
                ? `Slab info extracted from ${data.grader || "grader"} page.`
                : "Could not confirm slab details — review carefully.",
          }
        );
      } else {
        const def: AddItemDefaults = {
          franchise: data.franchise || "Pokémon",
          category: data.category || "Sealed",
          setName: data.setName || "",
          name: data.productName || "",
          condition: data.category === "Sealed" ? "Sealed" : "NM",
          qty: 1,
          notes: `Scanned barcode ${decoded}`,
        };
        let price: { marketValue: number; disclaimer: string } | null = null;
        try {
          price = await callPriceEstimate({
            name: def.name || "",
            set: def.setName || "",
            franchise: def.franchise || "",
            rarity: "",
            condition: def.condition || "",
          });
        } catch {}
        onIdentified(
          { ...def, marketValue: price?.marketValue },
          {
            aiEstimate: !!price,
            context:
              data.confidence > 0.5
                ? "Barcode matched a known product."
                : "Barcode unknown — fill fields manually.",
          }
        );
      }
    } catch (err: any) {
      toast({
        title: "Lookup failed",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setDecoding(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="relative aspect-[3/4] md:aspect-video w-full max-w-[640px] mx-auto bg-muted/50 rounded-lg overflow-hidden border border-border">
          <video
            ref={videoRef}
            className={`w-full h-full object-cover ${
              scannerState === "scanning" || scannerState === "paused" ? "" : "hidden"
            }`}
            playsInline
            muted
            data-testid="video-barcode"
          />
          {scannerState !== "scanning" && scannerState !== "paused" && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
              data-testid="state-barcode-placeholder"
            >
              {scannerState === "idle" && (
                <>
                  <ScanLine className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground mb-4">
                    Scan a UPC/EAN barcode (sealed product) or a QR code (slabbed card).
                  </p>
                  <Button
                    onClick={startScanner}
                    data-testid="button-start-scanner"
                    size="lg"
                    className="min-h-12 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <ScanLine className="h-4 w-4 mr-2" /> Start scanner
                  </Button>
                </>
              )}
              {scannerState === "starting" && (
                <>
                  <Loader2 className="h-10 w-10 text-muted-foreground mb-3 animate-spin" />
                  <p className="text-sm text-muted-foreground">Starting scanner…</p>
                </>
              )}
              {(scannerState === "denied" || scannerState === "unavailable") && (
                <>
                  <AlertCircle className="h-10 w-10 text-destructive mb-3" />
                  <p className="text-sm font-medium mb-2" data-testid="text-barcode-error">
                    {scannerState === "denied"
                      ? "Camera access denied"
                      : "Scanner unavailable"}
                  </p>
                  <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                    {scannerError}
                  </p>
                  <Button
                    onClick={startScanner}
                    variant="outline"
                    size="sm"
                    data-testid="button-retry-scanner"
                  >
                    <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Try again
                  </Button>
                </>
              )}
            </div>
          )}
          {scannerState === "scanning" && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-background/80 backdrop-blur px-3 py-1 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                Scanning…
              </span>
            </div>
          )}
        </div>

        {decoded && (
          <div
            className="rounded-lg border border-border bg-muted/40 p-3 space-y-3"
            data-testid="block-decoded"
          >
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                  Decoded
                </p>
                <p className="text-sm font-mono break-all" data-testid="text-decoded">
                  {decoded}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={lookup}
                disabled={decoding}
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                data-testid="button-lookup-decoded"
              >
                {decoding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Looking up…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1.5" /> Look up with AI
                  </>
                )}
              </Button>
              <Button
                onClick={() => {
                  setDecoded("");
                  startScanner();
                }}
                variant="outline"
                size="sm"
                data-testid="button-rescan"
              >
                <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Scan another
              </Button>
            </div>
          </div>
        )}

        {(scannerState === "scanning" || scannerState === "paused") && !decoded && (
          <div className="flex justify-center">
            <Button
              onClick={() => {
                stopScanner();
                setScannerState("idle");
              }}
              variant="outline"
              size="lg"
              className="min-h-12"
              data-testid="button-stop-scanner"
            >
              Stop
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===================================================================
// Tab 3: Bulk upload
// ===================================================================

type BulkRow = {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "identifying" | "done" | "error";
  result?: any;
  price?: { marketValue: number; disclaimer: string } | null;
  error?: string;
  qty: number;
  conditionOverride?: string;
};

function BulkTab({ onIdentified }: { onIdentified: OpenAddFn }) {
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const newRows: BulkRow[] = arr.map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      previewUrl: URL.createObjectURL(f),
      status: "pending",
      qty: 1,
    }));
    setRows((r) => [...r, ...newRows]);
  };

  useEffect(() => {
    return () => rows.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runIdentify = async () => {
    if (rows.length === 0) return;
    setRunning(true);
    // mark all as identifying initially (UI feedback), process concurrency 3
    setRows((r) => r.map((x) => (x.status === "pending" ? { ...x, status: "identifying" } : x)));

    const targets = rows.filter((r) => r.status !== "done");
    const queue = [...targets];
    const concurrency = 3;

    async function processOne(row: BulkRow) {
      try {
        const { base64, mediaType } = await fileToBase64(row.file);
        const ided = await callIdentify(base64, mediaType);
        let price: { marketValue: number; disclaimer: string } | null = null;
        try {
          price = await callPriceEstimate({
            name: ided?.name || "",
            set: ided?.set || "",
            franchise: ided?.franchise || "",
            rarity: ided?.rarity || "",
            condition: ided?.suggestedCondition || "NM",
          });
        } catch {}
        setRows((rs) =>
          rs.map((x) =>
            x.id === row.id
              ? { ...x, status: "done", result: ided, price }
              : x
          )
        );
      } catch (err: any) {
        setRows((rs) =>
          rs.map((x) =>
            x.id === row.id
              ? { ...x, status: "error", error: err?.message || "failed" }
              : x
          )
        );
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, queue.length) },
      async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          await processOne(next);
        }
      }
    );
    await Promise.all(workers);
    setRunning(false);
  };

  const addAll = () => {
    const completed = rows.filter((r) => r.status === "done" && r.result);
    if (completed.length === 0) return;
    // Open dialog for each sequentially — simpler UX: open first, user can cancel/continue via button
    let idx = 0;
    const next = () => {
      if (idx >= completed.length) return;
      const row = completed[idx++];
      const def = mapIdentifiedToDefaults(row.result, {
        marketValue: row.price?.marketValue,
      });
      def.qty = row.qty;
      if (row.conditionOverride) def.condition = row.conditionOverride;
      onIdentified(def, {
        thumbnail: row.previewUrl,
        aiEstimate: !!row.price,
        context: `Bulk item ${idx} of ${completed.length} · review & save to continue.`,
      });
      // Note: we can't automatically chain because the user must close dialog.
      // For MVP we just open the first; user repeats action for rest.
    };
    next();
    toast({
      title: `${completed.length} items queued`,
      description: "Save each prompt to add; re-click to advance to the next.",
    });
  };

  const addSingle = (row: BulkRow) => {
    if (!row.result) return;
    const def = mapIdentifiedToDefaults(row.result, {
      marketValue: row.price?.marketValue,
    });
    def.qty = row.qty;
    if (row.conditionOverride) def.condition = row.conditionOverride;
    onIdentified(def, {
      thumbnail: row.previewUrl,
      aiEstimate: !!row.price,
      context: "From bulk upload — review before saving.",
    });
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        <div
          className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:bg-accent/30 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
          }}
          data-testid="dropzone-bulk"
        >
          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm mb-1">Drop photos here or tap to choose</p>
          <p className="text-xs text-muted-foreground">
            Multiple cards at once — bulk upload uses AI to identify each
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            // @ts-ignore capture is valid on mobile
            capture="environment"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
            data-testid="input-bulk-files"
          />
        </div>

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={runIdentify}
              disabled={running}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="button-identify-all"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Identifying…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-1.5" /> Identify all
                </>
              )}
            </Button>
            <Button
              onClick={addAll}
              variant="outline"
              disabled={!rows.some((r) => r.status === "done")}
              data-testid="button-add-all"
            >
              Add all to inventory
            </Button>
            <Button
              variant="ghost"
              onClick={() => setRows([])}
              data-testid="button-clear-bulk"
            >
              Clear
            </Button>
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-2" data-testid="list-bulk-rows">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex items-start gap-3 p-3 rounded-md border border-border"
                data-testid={`bulk-row-${r.id}`}
              >
                <img
                  src={r.previewUrl}
                  alt="preview"
                  className="h-16 w-16 object-cover rounded shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <BulkStatus status={r.status} />
                    <span className="text-xs text-muted-foreground truncate">
                      {r.file.name}
                    </span>
                  </div>
                  {r.status === "done" && r.result && (
                    <div className="text-sm">
                      <p className="font-medium truncate" data-testid={`text-bulk-name-${r.id}`}>
                        {r.result.name || "Unknown card"}{" "}
                        {r.result.number ? `#${r.result.number}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.result.set} · {r.result.franchise} ·{" "}
                        {r.result.rarity || "—"}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Qty
                        </label>
                        <Input
                          type="number"
                          value={r.qty}
                          onChange={(e) =>
                            setRows((rs) =>
                              rs.map((x) =>
                                x.id === r.id
                                  ? { ...x, qty: Number(e.target.value) }
                                  : x
                              )
                            )
                          }
                          className="h-7 w-16 text-xs"
                          min={1}
                        />
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Cond
                        </label>
                        <Input
                          value={
                            r.conditionOverride ??
                            r.result.suggestedCondition ??
                            "NM"
                          }
                          onChange={(e) =>
                            setRows((rs) =>
                              rs.map((x) =>
                                x.id === r.id
                                  ? { ...x, conditionOverride: e.target.value }
                                  : x
                              )
                            )
                          }
                          className="h-7 w-20 text-xs"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs ml-auto"
                          onClick={() => addSingle(r)}
                          data-testid={`button-add-bulk-${r.id}`}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                  {r.status === "error" && (
                    <p className="text-xs text-destructive">
                      {r.error || "Failed to identify"}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BulkStatus({ status }: { status: BulkRow["status"] }) {
  if (status === "pending")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Pending
      </span>
    );
  if (status === "identifying")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary">
        <Loader2 className="h-3 w-3 animate-spin" /> Identifying
      </span>
    );
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary">
        <CheckCircle2 className="h-3 w-3" /> Done
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-destructive">
      <XCircle className="h-3 w-3" /> Error
    </span>
  );
}

// ===================================================================
// Tab 4: Autocomplete search
// ===================================================================

function SearchTab({ onIdentified }: { onIdentified: OpenAddFn }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiRequest(
          "GET",
          `/api/scan/search?q=${encodeURIComponent(q.trim())}`
        );
        const data = await res.json();
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch (err: any) {
        toast({
          title: "Search failed",
          description: err?.message || String(err),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q, toast]);

  const pick = async (s: any) => {
    let price: { marketValue: number; disclaimer: string } | null = null;
    try {
      price = await callPriceEstimate({
        name: s?.name || "",
        set: s?.set || "",
        franchise: s?.franchise || "",
        rarity: s?.rarity || "",
        condition: s?.category === "Sealed" ? "Sealed" : "NM",
      });
    } catch {}
    const def: AddItemDefaults = {
      name: s?.name || "",
      setName: s?.set || "",
      franchise: s?.franchise || "Pokémon",
      rarity: s?.rarity || "",
      category: s?.category || "Raw",
      condition: s?.category === "Sealed" ? "Sealed" : "NM",
      qty: 1,
      marketValue: price?.marketValue,
    };
    onIdentified(def, {
      aiEstimate: !!price,
      context: "Selected from AI suggestions — review before saving.",
    });
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">
            Search by name
          </label>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="e.g. charizard, black lotus, monkey d luffy…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-11 text-base"
              data-testid="input-search-query"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            AI-powered. Type 2+ characters. Results may vary — verify before saving.
          </p>
        </div>

        <div className="space-y-1.5" data-testid="list-suggestions">
          {!loading && q.trim().length >= 2 && suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground p-4 text-center" data-testid="text-no-suggestions">
              No suggestions yet. Keep typing or refine your query.
            </p>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.name}-${s.set}-${i}`}
              onClick={() => pick(s)}
              className="w-full text-left p-3 rounded-md border border-border hover:bg-accent/50 transition-colors"
              data-testid={`suggestion-${i}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {s.set} · {s.franchise}
                    {s.rarity ? ` · ${s.rarity}` : ""}
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                  {s.category || "Raw"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
