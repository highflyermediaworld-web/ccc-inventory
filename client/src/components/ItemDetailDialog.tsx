import { useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Inventory, PriceHistory } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CategoryBadge, FranchiseBadge, StatusBadge } from "@/components/Badges";
import { CardThumb } from "@/components/CardThumb";
import { SourceBadge } from "@/components/SourceBadge";
import { formatCurrency, formatDate, pnlClass } from "@/lib/format";
import { RefreshCw, Camera, X as XIcon, ImageIcon } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export function ItemDetailDialog({
  item,
  onClose,
}: {
  item: Inventory | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const itemId = item?.id;

  const { data: history = [] } = useQuery<PriceHistory[]>({
    queryKey: ["/api/inventory", itemId, "history"],
    queryFn: async () => {
      if (!itemId) return [];
      const res = await apiRequest("GET", `/api/inventory/${itemId}/history`);
      return res.json();
    },
    enabled: !!itemId,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!itemId) return null;
      // Convert file → base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const match = result.match(/^data:(.+?);base64,(.*)$/);
          if (!match) return reject(new Error("Invalid file"));
          resolve(JSON.stringify({ mediaType: match[1], imageBase64: match[2] }));
        };
        reader.onerror = () => reject(new Error("Read failed"));
        reader.readAsDataURL(file);
      });
      const { mediaType, imageBase64 } = JSON.parse(base64);
      const upRes = await apiRequest("POST", "/api/uploads/image", {
        imageBase64,
        mediaType,
      });
      const { url } = await upRes.json();
      const patchRes = await apiRequest("PATCH", `/api/inventory/${itemId}`, {
        imageUrl: url,
      });
      return patchRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop/listings"] });
      toast({ title: "Photo updated" });
    },
    onError: (err: any) => {
      toast({
        title: "Upload failed",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  const findImageMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) return null;
      const res = await apiRequest("POST", `/api/inventory/${itemId}/fetch-image`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop/listings"] });
      if (data?.found) {
        toast({ title: "Image found", description: "Pulled from TCG source." });
      } else {
        toast({
          title: "No image found",
          description: "Try uploading one manually.",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: "Image lookup failed",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  const removePhotoMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) return null;
      const res = await apiRequest("PATCH", `/api/inventory/${itemId}`, {
        imageUrl: null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop/listings"] });
      toast({ title: "Photo removed" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) return null;
      const res = await apiRequest("POST", `/api/pricing/refresh/${itemId}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory", itemId, "history"],
      });
      if (data?.marketValue != null) {
        toast({
          title: "Price updated",
          description: `${formatCurrency(data.marketValue)} · ${data.source}`,
        });
      } else {
        toast({
          title: "No price found",
          description: "No live price available for this item right now.",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: "Refresh failed",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  const chartData = useMemo(
    () =>
      history.map((h) => ({
        t: h.recordedAt * 1000,
        date: formatDate(h.recordedAt),
        price: h.price,
        source: h.source,
      })),
    [history]
  );

  const latestSource = history.length > 0 ? history[history.length - 1].source : null;
  const gl =
    item && item.marketValue != null && item.totalCost != null
      ? item.marketValue - item.totalCost
      : null;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {!item ? null : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">{item.id}</span>
                <span>{item.name}</span>
              </DialogTitle>
              <DialogDescription>
                {item.setName} · {item.franchise}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
              {/* Left: image */}
              <div>
                <CardThumb
                  imageUrl={item.imageUrl}
                  franchise={item.franchise}
                  size="lg"
                  alt={item.name}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) photoMutation.mutate(f);
                    e.target.value = "";
                  }}
                  data-testid={`input-photo-${item.id}`}
                />
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={photoMutation.isPending}
                    data-testid={`button-upload-photo-${item.id}`}
                    className="flex-1"
                  >
                    <Camera className="h-3.5 w-3.5 mr-1.5" />
                    {photoMutation.isPending
                      ? "Uploading\u2026"
                      : item.imageUrl
                        ? "Change photo"
                        : "Add photo"}
                  </Button>
                  {item.imageUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removePhotoMutation.mutate()}
                      disabled={removePhotoMutation.isPending}
                      data-testid={`button-remove-photo-${item.id}`}
                      title="Remove photo"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {!item.imageUrl && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => findImageMutation.mutate()}
                    disabled={findImageMutation.isPending}
                    data-testid={`button-find-image-${item.id}`}
                    className="w-full mt-2"
                  >
                    <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                    {findImageMutation.isPending ? "Searching\u2026" : "Find image online"}
                  </Button>
                )}
                <p className="text-[10px] text-muted-foreground mt-2">
                  Visible to customers in the shop.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <FranchiseBadge franchise={item.franchise} />
                  <CategoryBadge category={item.category} />
                  <StatusBadge status={item.status} />
                </div>
              </div>

              {/* Right: metadata + stats */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Meta label="Condition" value={item.condition ?? "\u2014"} />
                  <Meta label="Rarity" value={item.rarity ?? "\u2014"} />
                  <Meta label="Qty" value={String(item.qty)} />
                  <Meta label="Source" value={item.source ?? "\u2014"} />
                </div>

                <div className="rounded-md border border-border p-3 bg-muted/30">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <Stat label="Cost" value={formatCurrency(item.totalCost)} />
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Market
                      </div>
                      <div className="tnum text-base font-bold">
                        {formatCurrency(item.marketValue)}
                      </div>
                      {latestSource && (
                        <SourceBadge source={latestSource as any} className="mt-1" />
                      )}
                    </div>
                    <Stat
                      label="G/L"
                      value={
                        gl == null
                          ? "\u2014"
                          : (gl >= 0 ? "+" : "") + formatCurrency(gl)
                      }
                      valueClass={gl == null ? "" : pnlClass(gl)}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending}
                    data-testid={`button-refresh-detail-${item.id}`}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 mr-1.5 ${
                        refreshMutation.isPending ? "animate-spin" : ""
                      }`}
                    />
                    {refreshMutation.isPending ? "Refreshing\u2026" : "Refresh price now"}
                  </Button>
                </div>

                {/* Price history chart */}
                <div>
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <h3 className="text-sm font-semibold">Price history</h3>
                      <p className="text-[11px] text-muted-foreground">
                        {history.length} data point{history.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  {history.length < 2 ? (
                    <div className="h-40 flex flex-col items-center justify-center rounded-md border border-dashed border-border text-center px-4">
                      <p className="text-xs text-muted-foreground mb-2">
                        Refresh price to start tracking history.
                      </p>
                      {history.length === 1 && (
                        <p className="text-[10px] text-muted-foreground">
                          First data point recorded on {history[0].source}.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={chartData}
                          margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="t"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            scale="time"
                            tickFormatter={(v) =>
                              new Date(v).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })
                            }
                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          />
                          <YAxis
                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                            tickFormatter={(v) => "$" + v}
                            width={44}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                            formatter={(v: any, _k: any, p: any) => [
                              formatCurrency(Number(v)),
                              p?.payload?.source ?? "Price",
                            ]}
                            labelFormatter={(v) =>
                              new Date(Number(v)).toLocaleString()
                            }
                          />
                          <Line
                            type="monotone"
                            dataKey="price"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {item.notes && (
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap rounded-md border border-border p-3 bg-muted/20">
                    {item.notes}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`tnum text-base font-bold ${valueClass}`}>{value}</div>
    </div>
  );
}
