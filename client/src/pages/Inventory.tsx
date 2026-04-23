import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Inventory } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CategoryBadge, StatusBadge, FranchiseBadge } from "@/components/Badges";
import { AddItemDialog } from "@/components/AddItemDialog";
import { CardThumb } from "@/components/CardThumb";
import { SourceBadge } from "@/components/SourceBadge";
import { ItemDetailDialog } from "@/components/ItemDetailDialog";
import { EditableCell } from "@/components/EditableCell";
import { formatCurrency, formatNumber, pnlClass } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { exportEbayCsv, exportTcgPlayerCsv } from "@/lib/exportListings";
import {
  Plus,
  Download,
  Upload,
  Search,
  ArrowUpDown,
  Pencil,
  Trash2,
  DollarSign,
  Tag,
  ArrowLeftRight,
  X,
  RefreshCw,
  ChevronDown,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import * as XLSX from "xlsx";

const STATUSES = ["In Inventory", "Sold", "Listed", "Traded"];
const CATEGORIES = ["Sealed", "Raw", "Slab"];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG", "PSA 10", "PSA 9", "PSA 8", "CGC 9.5", "CGC 9", "BGS 7"];
const RARITIES = ["Common", "Uncommon", "Rare", "Holo Rare", "Ultra Rare", "Secret Rare", "Promo", "Other"];

type SortKey = "name" | "setName" | "marketValue" | "totalCost" | "gl" | "qty";
type SortDir = "asc" | "desc";

export default function InventoryPage() {
  const { toast } = useToast();
  const { data: items = [], isLoading } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory"],
  });

  const [search, setSearch] = useState("");
  const [franchiseFilter, setFranchiseFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [conditionFilter, setConditionFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("marketValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [editItem, setEditItem] = useState<Inventory | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [sellItem, setSellItem] = useState<Inventory | null>(null);
  const [listItem, setListItem] = useState<Inventory | null>(null);
  const [tradeItem, setTradeItem] = useState<Inventory | null>(null);
  const [detailItem, setDetailItem] = useState<Inventory | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [itemSources, setItemSources] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allFranchises = useMemo(
    () => Array.from(new Set(items.map((i) => i.franchise))).sort(),
    [items]
  );

  const filtered = useMemo(() => {
    let r = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.setName.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q)
      );
    }
    if (franchiseFilter.length > 0) {
      r = r.filter((i) => franchiseFilter.includes(i.franchise));
    }
    if (categoryFilter !== "all") r = r.filter((i) => i.category === categoryFilter);
    if (statusFilter !== "all") r = r.filter((i) => i.status === statusFilter);
    if (conditionFilter !== "all") r = r.filter((i) => i.condition === conditionFilter);

    const sorted = [...r].sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === "gl") {
        av = (a.marketValue ?? 0) - (a.totalCost ?? 0);
        bv = (b.marketValue ?? 0) - (b.totalCost ?? 0);
      } else {
        av = (a as any)[sortKey] ?? 0;
        bv = (b as any)[sortKey] ?? 0;
      }
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [items, search, franchiseFilter, categoryFilter, statusFilter, conditionFilter, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/inventory/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Item deleted" });
    },
  });

  const refreshOneMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/pricing/refresh/${id}`);
      return { id, ...(await res.json()) };
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory", data.id, "history"],
      });
      setItemSources((s) => ({ ...s, [data.id]: data.source }));
      if (data?.marketValue != null) {
        toast({
          title: `Updated from ${data.source}`,
          description: `${data.id} · ${formatCurrency(data.marketValue)}`,
        });
      } else {
        toast({
          title: "No price found",
          description: "Live sources returned nothing. Try again later.",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: "Refresh failed",
        description: err?.message,
        variant: "destructive",
      });
    },
  });

  const refreshAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pricing/refresh-all");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({
        title: "All prices refreshed",
        description: `${data.updated} updated · ${data.skipped} skipped · ${data.failed} failed`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Bulk refresh failed",
        description: err?.message,
        variant: "destructive",
      });
    },
  });

  // Which rows to export? Selected if any; otherwise all currently filtered.
  const itemsForExport = useMemo(() => {
    if (selectedIds.size > 0) {
      return filtered.filter((i) => selectedIds.has(i.id));
    }
    return filtered;
  }, [filtered, selectedIds]);

  // Export to Excel
  const handleExport = () => {
    const rows = items.map((i) => ({
      id: i.id,
      franchise: i.franchise,
      category: i.category,
      set: i.setName,
      name: i.name,
      rarity: i.rarity,
      condition: i.condition,
      qty: i.qty,
      source: i.source,
      costPerUnit: i.costPerUnit,
      totalCost: i.totalCost,
      marketValue: i.marketValue,
      asking: i.asking,
      soldPrice: i.soldPrice,
      status: i.status,
      notes: i.notes,
      imageUrl: i.imageUrl,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `ccc-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: "Exported", description: `${rows.length} items saved to Excel` });
  };

  const handleExportEbay = () => {
    const count = exportEbayCsv(itemsForExport);
    toast({
      title: "eBay CSV exported",
      description: `${count} item${count === 1 ? "" : "s"} ready for File Exchange.`,
    });
  };
  const handleExportTcgPlayer = () => {
    const count = exportTcgPlayerCsv(itemsForExport);
    toast({
      title: "TCGPlayer CSV exported",
      description: `${count} item${count === 1 ? "" : "s"} ready for Pricing Tool.`,
    });
  };

  const allFilteredSelected =
    filtered.length > 0 &&
    filtered.every((i) => selectedIds.has(i.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      for (const i of filtered) next.delete(i.id);
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      for (const i of filtered) next.add(i.id);
      setSelectedIds(next);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importMutation = useMutation({
    mutationFn: async ({
      items,
      mode,
    }: {
      items: any[];
      mode: "replace" | "merge";
    }) => {
      const res = await apiRequest("POST", "/api/inventory/import", { items, mode });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Imported", description: `${data.count} items processed` });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const handleImport = async (file: File, mode: "replace" | "merge") => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any>(sheet);
    const mapped = rows.map((r) => ({
      id: String(r.id ?? r.ID ?? r.sku ?? ""),
      franchise: String(r.franchise ?? ""),
      category: String(r.category ?? "Raw"),
      setName: String(r.set ?? r.setName ?? r.set_name ?? ""),
      name: String(r.name ?? ""),
      rarity: r.rarity ?? null,
      condition: r.condition ?? null,
      qty: Number(r.qty ?? 1),
      source: r.source ?? null,
      costPerUnit: r.costPerUnit != null && r.costPerUnit !== "" ? Number(r.costPerUnit) : null,
      totalCost: r.totalCost != null && r.totalCost !== "" ? Number(r.totalCost) : null,
      marketValue: r.marketValue != null && r.marketValue !== "" ? Number(r.marketValue) : null,
      asking: r.asking != null && r.asking !== "" ? Number(r.asking) : null,
      soldPrice: r.soldPrice != null && r.soldPrice !== "" ? Number(r.soldPrice) : null,
      status: String(r.status ?? "In Inventory"),
      notes: r.notes ?? null,
    })).filter((x) => x.id);
    importMutation.mutate({ items: mapped, mode });
  };

  // Inline save: optimistic cache update then PATCH; rollback on error.
  const saveField = async (id: string, field: string, newValue: any) => {
    const prevList = queryClient.getQueryData<Inventory[]>(["/api/inventory"]);
    const prevItem = prevList?.find((x) => x.id === id);
    if (!prevItem) throw new Error("Item not found");
    // Optimistic: compute next item including totalCost recompute for qty/costPerUnit.
    const next: any = { ...prevItem, [field]: newValue };
    if (field === "qty" || field === "costPerUnit") {
      const q = Number(field === "qty" ? newValue : prevItem.qty) || 0;
      const c = Number(field === "costPerUnit" ? newValue : prevItem.costPerUnit ?? 0) || 0;
      next.totalCost = Math.round(q * c * 100) / 100;
    }
    queryClient.setQueryData<Inventory[] | undefined>(["/api/inventory"], (old) =>
      old ? old.map((x) => (x.id === id ? (next as Inventory) : x)) : old
    );
    queryClient.setQueryData<Inventory | undefined>(["/api/inventory", id], next as Inventory);
    try {
      const res = await apiRequest("PATCH", `/api/inventory/${id}`, { [field]: newValue });
      const saved = await res.json();
      queryClient.setQueryData<Inventory[] | undefined>(["/api/inventory"], (old) =>
        old ? old.map((x) => (x.id === id ? saved : x)) : old
      );
      queryClient.setQueryData<Inventory | undefined>(["/api/inventory", id], saved);
    } catch (err: any) {
      // Rollback
      queryClient.setQueryData<Inventory[] | undefined>(["/api/inventory"], (old) =>
        old ? old.map((x) => (x.id === id ? prevItem : x)) : old
      );
      queryClient.setQueryData<Inventory | undefined>(["/api/inventory", id], prevItem);
      toast({
        title: "Save failed",
        description: err?.message || "Could not save change",
        variant: "destructive",
      });
      throw err;
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px]">
      <PageHeader
        eyebrow="Holdings"
        title="Inventory"
        description={`${items.length} total items · ${formatNumber(filtered.length)} shown`}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const mode = confirm(
                    "Merge with existing inventory? OK = merge/upsert, Cancel = REPLACE everything."
                  )
                    ? "merge"
                    : "replace";
                  handleImport(f, mode as "merge" | "replace");
                }
                e.target.value = "";
              }}
              data-testid="input-file-import"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshAllMutation.mutate()}
              disabled={refreshAllMutation.isPending}
              data-testid="button-refresh-all"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1.5 ${
                  refreshAllMutation.isPending ? "animate-spin" : ""
                }`}
              />
              {refreshAllMutation.isPending ? "Refreshing…" : "Refresh prices"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-import"
            >
              <Upload className="h-4 w-4 mr-1.5" /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-export">
              <Download className="h-4 w-4 mr-1.5" /> Export
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-export-listings"
                >
                  <FileText className="h-4 w-4 mr-1.5" />
                  Export Listings
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `${filtered.length} filtered`}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={handleExportEbay}
                  data-testid="menu-export-ebay"
                >
                  eBay File Exchange (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={handleExportTcgPlayer}
                  data-testid="menu-export-tcgplayer"
                >
                  TCGPlayer Pricing Tool (CSV)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              onClick={() => setIsAdding(true)}
              data-testid="button-add-item"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Add item
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, set, or SKU…"
                className="pl-8 h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 w-[130px]" data-testid="select-category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[140px]" data-testid="select-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={conditionFilter} onValueChange={setConditionFilter}>
              <SelectTrigger className="h-9 w-[130px]" data-testid="select-condition">
                <SelectValue placeholder="Condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any condition</SelectItem>
                {CONDITIONS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-1">
              {allFranchises.map((f) => {
                const active = franchiseFilter.includes(f);
                return (
                  <button
                    key={f}
                    onClick={() =>
                      setFranchiseFilter((prev) =>
                        prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
                      )
                    }
                    data-testid={`filter-franchise-${f}`}
                    className={`text-[11px] px-2 py-1 rounded-md border ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {f}
                  </button>
                );
              })}
              {(franchiseFilter.length > 0 ||
                categoryFilter !== "all" ||
                statusFilter !== "all" ||
                conditionFilter !== "all" ||
                search) && (
                <button
                  onClick={() => {
                    setFranchiseFilter([]);
                    setCategoryFilter("all");
                    setStatusFilter("all");
                    setConditionFilter("all");
                    setSearch("");
                  }}
                  className="text-[11px] px-2 py-1 rounded-md text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-filters"
                >
                  <X className="h-3 w-3 inline mr-1" />Clear
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm numeric">
            <thead className="border-b border-border">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 w-8">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all filtered"
                    data-testid="checkbox-select-all"
                  />
                </th>
                <th className="px-3 py-2.5 w-14"></th>
                <th className="text-left font-semibold px-3 py-2.5">SKU</th>
                <th className="text-left font-semibold px-3 py-2.5">Franchise</th>
                <th className="text-left font-semibold px-3 py-2.5">Cat</th>
                <SortableHeader label="Set" k="setName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="text-left font-semibold px-3 py-2.5">Cond.</th>
                <SortableHeader label="Qty" k="qty" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Cost" k="totalCost" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Market" k="marketValue" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="G/L" k="gl" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-muted-foreground">Loading…</td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-10 text-center text-muted-foreground">
                    No items match these filters.
                  </td>
                </tr>
              )}
              {filtered.map((i) => {
                const gl = (i.marketValue ?? 0) - (i.totalCost ?? 0);
                const sourceLabel = itemSources[i.id];
                return (
                  <tr
                    key={i.id}
                    className="border-b border-border last:border-0 hover:bg-accent/40 group cursor-pointer"
                    data-testid={`row-item-${i.id}`}
                    onClick={(e) => {
                      // Don't trigger detail when clicking inside interactive cells
                      const target = e.target as HTMLElement;
                      if (target.closest("button, input, [role='menuitem'], [role='checkbox'], a")) return;
                      setDetailItem(i);
                    }}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(i.id)}
                        onCheckedChange={() => toggleSelect(i.id)}
                        aria-label={`Select ${i.id}`}
                        data-testid={`checkbox-select-${i.id}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CardThumb
                        imageUrl={i.imageUrl}
                        franchise={i.franchise}
                        size="sm"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono whitespace-nowrap">{i.id}</td>
                    <td className="px-3 py-2.5 max-w-[140px]">
                      <FranchiseBadge franchise={i.franchise} />
                    </td>
                    <td className="px-3 py-2.5"><CategoryBadge category={i.category} /></td>
                    <td className="px-3 py-2 max-w-[180px] text-muted-foreground" onClick={(e) => e.stopPropagation()} title={i.setName}>
                      <EditableCell
                        rowId={i.id}
                        field="setName"
                        value={i.setName}
                        type="text"
                        onSave={(v) => saveField(i.id, "setName", v)}
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[220px] font-medium" onClick={(e) => e.stopPropagation()} title={i.name} data-testid={`text-name-${i.id}`}>
                      <EditableCell
                        rowId={i.id}
                        field="name"
                        value={i.name}
                        type="text"
                        onSave={(v) => saveField(i.id, "name", v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      <EditableCell
                        rowId={i.id}
                        field="condition"
                        value={i.condition ?? ""}
                        type="select"
                        options={CONDITIONS}
                        allowFreeEntry
                        onSave={(v) => saveField(i.id, "condition", v || null)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tnum" onClick={(e) => e.stopPropagation()}>
                      <EditableCell
                        rowId={i.id}
                        field="qty"
                        value={i.qty}
                        type="number"
                        integer
                        numberMin={0}
                        align="right"
                        onSave={(v) => saveField(i.id, "qty", Number(v) || 0)}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tnum text-muted-foreground">{formatCurrency(i.totalCost)}</td>
                    <td className="px-3 py-2 text-right tnum font-semibold" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col items-end">
                        <EditableCell
                          rowId={i.id}
                          field="marketValue"
                          value={i.marketValue}
                          type="number"
                          align="right"
                          display={(v) => <span>{formatCurrency(v)}</span>}
                          onSave={(v) => saveField(i.id, "marketValue", v === null ? null : Number(v))}
                        />
                        {sourceLabel && <SourceBadge source={sourceLabel} />}
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 text-right tnum font-semibold ${pnlClass(gl)}`}>
                      {i.marketValue != null && i.totalCost != null ? (gl >= 0 ? "+" : "") + formatCurrency(gl) : "—"}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <EditableCell
                        rowId={i.id}
                        field="status"
                        value={i.status}
                        type="select"
                        options={STATUSES}
                        display={(v) => <StatusBadge status={v} />}
                        onSave={(v) => saveField(i.id, "status", v)}
                      />
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100">
                        <button
                          onClick={() => refreshOneMutation.mutate(i.id)}
                          disabled={refreshOneMutation.isPending}
                          className="p-1.5 rounded hover:bg-accent"
                          title="Refresh price"
                          data-testid={`button-refresh-${i.id}`}
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${
                              refreshOneMutation.isPending &&
                              refreshOneMutation.variables === i.id
                                ? "animate-spin"
                                : ""
                            }`}
                          />
                        </button>
                        <button
                          onClick={() => setEditItem(i)}
                          className="p-1.5 rounded hover:bg-accent"
                          title="Edit"
                          data-testid={`button-edit-${i.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {i.status !== "Sold" && (
                          <button
                            onClick={() => setSellItem(i)}
                            className="p-1.5 rounded hover:bg-accent"
                            title="Mark as sold"
                            data-testid={`button-sell-${i.id}`}
                          >
                            <DollarSign className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {i.status === "In Inventory" && (
                          <button
                            onClick={() => setListItem(i)}
                            className="p-1.5 rounded hover:bg-accent"
                            title="List for sale"
                            data-testid={`button-list-${i.id}`}
                          >
                            <Tag className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {i.status === "In Inventory" && (
                          <button
                            onClick={() => setTradeItem(i)}
                            className="p-1.5 rounded hover:bg-accent"
                            title="Propose trade"
                            data-testid={`button-trade-${i.id}`}
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm(`Delete ${i.id} — ${i.name}?`))
                              deleteMutation.mutate(i.id);
                          }}
                          className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                          title="Delete"
                          data-testid={`button-delete-${i.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Add dialog (shared with Scan flow) */}
      <AddItemDialog
        open={isAdding}
        existingIds={items.map((i) => i.id)}
        onClose={() => setIsAdding(false)}
      />
      {/* Edit dialog (existing, supports full in-place editing) */}
      <ItemDialog
        open={!!editItem}
        item={editItem}
        onClose={() => setEditItem(null)}
      />
      <SellDialog item={sellItem} onClose={() => setSellItem(null)} />
      <ListDialog item={listItem} onClose={() => setListItem(null)} />
      <TradeDialog item={tradeItem} onClose={() => setTradeItem(null)} />
      <ItemDetailDialog item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}

function SortableHeader({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th
      className={`font-semibold px-3 py-2.5 text-${align} cursor-pointer select-none hover:text-foreground`}
      onClick={() => onSort(k)}
    >
      <span className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""}`}>
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-30"}`} />
        {active && <span className="text-[9px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </span>
    </th>
  );
}

// =========== DIALOGS ===========

function ItemDialog({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: Inventory | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!item;

  const [form, setForm] = useState(() => ({
    id: item?.id ?? "",
    franchise: item?.franchise ?? "Pokémon",
    category: item?.category ?? "Raw",
    setName: item?.setName ?? "",
    name: item?.name ?? "",
    rarity: item?.rarity ?? "",
    condition: item?.condition ?? "NM",
    qty: item?.qty ?? 1,
    source: item?.source ?? "",
    costPerUnit: item?.costPerUnit ?? 0,
    totalCost: item?.totalCost ?? 0,
    marketValue: item?.marketValue ?? 0,
    asking: item?.asking ?? 0,
    status: item?.status ?? "In Inventory",
    notes: item?.notes ?? "",
  }));

  // Reset when item changes
  useMemoReset(() => {
    setForm({
      id: item?.id ?? "",
      franchise: item?.franchise ?? "Pokémon",
      category: item?.category ?? "Raw",
      setName: item?.setName ?? "",
      name: item?.name ?? "",
      rarity: item?.rarity ?? "",
      condition: item?.condition ?? "NM",
      qty: item?.qty ?? 1,
      source: item?.source ?? "",
      costPerUnit: item?.costPerUnit ?? 0,
      totalCost: item?.totalCost ?? 0,
      marketValue: item?.marketValue ?? 0,
      asking: item?.asking ?? 0,
      status: item?.status ?? "In Inventory",
      notes: item?.notes ?? "",
    });
  }, [item?.id, open]);

  const mutation = useMutation({
    mutationFn: async () => {
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
      };
      if (isEdit && item) {
        const res = await apiRequest("PATCH", `/api/inventory/${item.id}`, payload);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/inventory", payload);
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: isEdit ? "Item updated" : "Item created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${item?.id}` : "Add inventory item"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the fields below and save." : "Create a new card or sealed product."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <Label>SKU *</Label>
            <Input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              disabled={isEdit}
              placeholder="e.g. PK-245"
              data-testid="input-sku"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label>Franchise</Label>
            <Select value={form.franchise} onValueChange={(v) => setForm({ ...form, franchise: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Pokémon", "One Piece", "Magic The Gathering", "DBZ", "League of Legends", "Union Arena"].map((x) => (
                  <SelectItem key={x} value={x}>{x}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Condition</Label>
            <Input
              value={form.condition ?? ""}
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
              placeholder="NM, PSA 10, etc."
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
            <Input value={form.rarity ?? ""} onChange={(e) => setForm({ ...form, rarity: e.target.value })} />
          </div>
          <div>
            <Label>Source</Label>
            <Input value={form.source ?? ""} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </div>
          <div>
            <Label>Qty</Label>
            <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Cost per unit</Label>
            <Input type="number" step="0.01" value={form.costPerUnit ?? ""} onChange={(e) => setForm({ ...form, costPerUnit: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Total cost</Label>
            <Input type="number" step="0.01" value={form.totalCost ?? ""} onChange={(e) => setForm({ ...form, totalCost: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Market value</Label>
            <Input type="number" step="0.01" value={form.marketValue ?? ""} onChange={(e) => setForm({ ...form, marketValue: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Asking</Label>
            <Input type="number" step="0.01" value={form.asking ?? ""} onChange={(e) => setForm({ ...form, asking: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.id || !form.name}
            data-testid="button-save-item"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Small util hook: run effect on key change
function useMemoReset(fn: () => void, deps: any[]) {
  useEffect(fn, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function SellDialog({ item, onClose }: { item: Inventory | null; onClose: () => void }) {
  const { toast } = useToast();
  const [price, setPrice] = useState("");
  const [counterparty, setCounterparty] = useState("");
  useEffect(() => {
    setPrice(item?.asking?.toString() ?? item?.marketValue?.toString() ?? "");
    setCounterparty("");
  }, [item?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const res = await apiRequest("POST", `/api/inventory/${item.id}/sell`, {
        soldPrice: Number(price),
        counterparty: counterparty || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Marked as sold" });
      onClose();
    },
  });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as sold</DialogTitle>
          <DialogDescription>{item && `${item.id} · ${item.name}`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Sold price *</Label>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="input-sold-price" />
          </div>
          <div>
            <Label>Buyer (optional)</Label>
            <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="eBay, Card Show, etc." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!price || mutation.isPending}
            data-testid="button-confirm-sell"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Confirm sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListDialog({ item, onClose }: { item: Inventory | null; onClose: () => void }) {
  const { toast } = useToast();
  const [price, setPrice] = useState("");
  useEffect(() => {
    setPrice(item?.asking?.toString() ?? item?.marketValue?.toString() ?? "");
  }, [item?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const res = await apiRequest("POST", "/api/listings", {
        itemId: item.id,
        askingPrice: Number(price),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Listed for sale" });
      onClose();
    },
  });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>List for sale</DialogTitle>
          <DialogDescription>{item && `${item.id} · ${item.name}`}</DialogDescription>
        </DialogHeader>
        <div>
          <Label>Asking price *</Label>
          <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="input-asking-price" />
          <p className="text-xs text-muted-foreground mt-1">
            Market estimate: {formatCurrency(item?.marketValue)}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!price || mutation.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="button-confirm-list"
          >
            Create listing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TradeDialog({ item, onClose }: { item: Inventory | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: marketListings = [] } = useQuery<any[]>({
    queryKey: ["/api/listings", { scope: "market" }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/listings?scope=market");
      return res.json();
    },
  });
  const [listingId, setListingId] = useState<string>("");

  useEffect(() => {
    setListingId("");
  }, [item?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const res = await apiRequest("POST", "/api/trades", {
        offeredItemId: item.id,
        requestedListingId: Number(listingId),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      toast({ title: "Trade proposed" });
      onClose();
    },
  });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propose trade</DialogTitle>
          <DialogDescription>
            Offering {item && `${item.id} · ${item.name}`}. Choose a marketplace listing to request.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label>Request from marketplace</Label>
          <Select value={listingId} onValueChange={setListingId}>
            <SelectTrigger data-testid="select-trade-target"><SelectValue placeholder="Pick a marketplace item…" /></SelectTrigger>
            <SelectContent className="max-h-80">
              {marketListings.map((l) => {
                const snap = l.itemSnapshot ? JSON.parse(l.itemSnapshot) : {};
                return (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {snap.franchise} · {snap.name} — {formatCurrency(l.askingPrice)} ({l.sellerName})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!listingId || mutation.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="button-confirm-trade"
          >
            Send offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
