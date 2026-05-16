import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles } from "lucide-react";

const STATUSES = ["In Inventory", "Sold", "Listed", "Traded"];
const CATEGORIES = ["Sealed", "Raw", "Slab"];
const FRANCHISES = [
  "Pokémon",
  "One Piece",
  "Magic The Gathering",
  "DBZ",
  "League of Legends",
  "Union Arena",
  "Other",
];

export type AddItemDefaults = Partial<{
  id: string;
  franchise: string;
  category: string;
  setName: string;
  name: string;
  rarity: string;
  condition: string;
  qty: number;
  source: string;
  costPerUnit: number;
  totalCost: number;
  marketValue: number;
  asking: number;
  status: string;
  notes: string;
}>;

const PREFIX_MAP: Record<string, string> = {
  Pokémon: "PK",
  "One Piece": "OP",
  "Magic The Gathering": "MTG",
  DBZ: "DBZ",
  "League of Legends": "LOL",
  "Union Arena": "UA",
  Other: "X",
};

function suggestSku(franchise: string, existingIds: string[]): string {
  const prefix = PREFIX_MAP[franchise] ?? "X";
  const maxNum = existingIds
    .filter((id) => id.startsWith(prefix + "-"))
    .map((id) => parseInt(id.split("-")[1] || "0", 10))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
}

export function AddItemDialog({
  open,
  defaults,
  onClose,
  onCreated,
  /** Optional note to show below the title — e.g. "From camera scan". */
  contextLabel,
  /** If true, shows an "AI estimate" tag next to marketValue. */
  marketValueIsEstimate,
  /** If provided, shown as thumbnail at top of dialog. */
  thumbnailUrl,
  /** Existing inventory IDs so we can suggest a unique SKU. */
  existingIds,
}: {
  open: boolean;
  defaults?: AddItemDefaults;
  onClose: () => void;
  onCreated?: (id: string) => void;
  contextLabel?: string;
  marketValueIsEstimate?: boolean;
  thumbnailUrl?: string;
  existingIds?: string[];
}) {
  const { toast } = useToast();

  const [form, setForm] = useState(() => buildInitial(defaults, existingIds));

  // Reset form ONLY when the dialog transitions to open. Do NOT re-run on
  // inventory updates or defaults churn while open — that wipes the user's
  // in-progress edits.
  useEffect(() => {
    if (open) setForm(buildInitial(defaults, existingIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // when franchise changes and SKU was auto-suggested, re-suggest
  useEffect(() => {
    if (!open) return;
    if (!existingIds) return;
    // Only auto-rewrite SKU if it matches a prefix- pattern and is likely auto-suggested
    const suggested = suggestSku(form.franchise, existingIds);
    // Heuristic: if current id prefix differs from new franchise prefix, retarget
    const currentPrefix = form.id.split("-")[0];
    const newPrefix = PREFIX_MAP[form.franchise] ?? "X";
    if (currentPrefix !== newPrefix) {
      setForm((f) => ({ ...f, id: suggested }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.franchise]);

  const mutation = useMutation({
    mutationFn: async () => {
      let imageUrl: string | null = null;
      if (thumbnailUrl) {
        if (thumbnailUrl.startsWith("data:image/")) {
          // Upload base64 to backend
          try {
            const match = thumbnailUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
            if (match) {
              const mediaType = match[1];
              const imageBase64 = match[2];
              const res = await apiRequest("POST", "/api/uploads/image", {
                imageBase64,
                mediaType,
              });
              const data = await res.json();
              if (data?.url) imageUrl = data.url;
            }
          } catch (e) {
            // Non-fatal — proceed without imageUrl
            console.warn("Failed to upload thumbnail", e);
          }
        } else {
          // Already a URL path — pass through
          imageUrl = thumbnailUrl;
        }
      }
      const payload = {
        ...form,
        rarity: form.rarity || null,
        source: form.source || null,
        notes: form.notes || null,
        costPerUnit: Number(form.costPerUnit) || null,
        totalCost: Number(form.totalCost) || null,
        marketValue: Number(form.marketValue) || null,
        asking: Number(form.asking) || null,
        qty: Number(form.qty) || 1,
        imageUrl,
      };
      const res = await apiRequest("POST", "/api/inventory", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Added to inventory", description: data?.id });
      onCreated?.(data?.id);
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add inventory item</DialogTitle>
          <DialogDescription>
            {contextLabel ?? "Create a new card or sealed product."}
          </DialogDescription>
        </DialogHeader>

        {thumbnailUrl && (
          <div className="flex items-start gap-3 p-3 rounded-md bg-muted/40 border border-border">
            <img
              src={thumbnailUrl}
              alt="Scanned"
              className="h-20 w-20 object-cover rounded-md"
              data-testid="img-scan-thumbnail"
            />
            <div className="text-xs text-muted-foreground">
              Prefilled from scan. Review all fields before saving.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <Label>SKU *</Label>
            <Input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="e.g. PK-245"
              data-testid="input-sku"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label>Franchise</Label>
            <Select
              value={form.franchise}
              onValueChange={(v) => setForm({ ...form, franchise: v })}
            >
              <SelectTrigger data-testid="select-franchise">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FRANCHISES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setForm({ ...form, category: v })}
            >
              <SelectTrigger data-testid="select-category-add">
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
          <div>
            <Label>Condition</Label>
            <Input
              value={form.condition ?? ""}
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
              placeholder="NM, PSA 10, etc."
              data-testid="input-condition"
            />
          </div>
          <div className="col-span-2">
            <Label>Set</Label>
            <Input
              value={form.setName}
              onChange={(e) => setForm({ ...form, setName: e.target.value })}
              data-testid="input-set"
            />
          </div>
          <div className="col-span-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="input-name"
            />
          </div>
          <div>
            <Label>Rarity</Label>
            <Input
              value={form.rarity ?? ""}
              onChange={(e) => setForm({ ...form, rarity: e.target.value })}
              data-testid="input-rarity"
            />
          </div>
          <div>
            <Label>Source</Label>
            <Input
              value={form.source ?? ""}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </div>
          <div>
            <Label>Qty</Label>
            <Input
              type="number"
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })}
              data-testid="input-qty"
            />
          </div>
          <div>
            <Label>Cost per unit</Label>
            <Input
              type="number"
              step="0.01"
              value={form.costPerUnit ?? ""}
              onChange={(e) =>
                setForm({ ...form, costPerUnit: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label>Total cost</Label>
            <Input
              type="number"
              step="0.01"
              value={form.totalCost ?? ""}
              onChange={(e) =>
                setForm({ ...form, totalCost: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5">
              Market value
              {marketValueIsEstimate && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary"
                  data-testid="tag-ai-estimate"
                >
                  <Sparkles className="h-3 w-3" /> AI estimate
                </span>
              )}
            </Label>
            <Input
              type="number"
              step="0.01"
              value={form.marketValue ?? ""}
              onChange={(e) =>
                setForm({ ...form, marketValue: Number(e.target.value) })
              }
              data-testid="input-market-value"
            />
          </div>
          <div>
            <Label>Asking</Label>
            <Input
              type="number"
              step="0.01"
              value={form.asking ?? ""}
              onChange={(e) =>
                setForm({ ...form, asking: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.id || !form.name}
            data-testid="button-save-item"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {mutation.isPending ? "Saving…" : "Add to inventory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildInitial(defaults?: AddItemDefaults, existingIds?: string[]) {
  const franchise = defaults?.franchise || "Pokémon";
  const suggestedId =
    defaults?.id ||
    (existingIds ? suggestSku(franchise, existingIds) : "");
  return {
    id: suggestedId,
    franchise,
    category: defaults?.category || "Raw",
    setName: defaults?.setName || "",
    name: defaults?.name || "",
    rarity: defaults?.rarity || "",
    condition: defaults?.condition || "NM",
    qty: defaults?.qty ?? 1,
    source: defaults?.source || "",
    costPerUnit: defaults?.costPerUnit ?? 0,
    totalCost: defaults?.totalCost ?? 0,
    marketValue: defaults?.marketValue ?? 0,
    asking: defaults?.asking ?? 0,
    status: defaults?.status || "In Inventory",
    notes: defaults?.notes || "",
  };
}
