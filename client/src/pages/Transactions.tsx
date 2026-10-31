import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Transaction } from "@shared/schema";
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
import { formatCurrency, formatDateTime, pnlClass } from "@/lib/format";
import { Download, Trash2 } from "lucide-react";

export default function TransactionsPage() {
  const { data: txs = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
  });

  const [type, setType] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { toast } = useToast();
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [restock, setRestock] = useState(true);
  const deleteMutation = useMutation({
    mutationFn: async ({ id, restock }: { id: number; restock: boolean }) => {
      const res = await apiRequest("DELETE", `/api/transactions/${id}?restock=${restock ? 1 : 0}`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop/listings"] });
      toast({
        title: "Transaction deleted",
        description: data?.restocked
          ? `${data.restocked.id} is back in inventory (qty ${data.restocked.qty}).`
          : "Removed from the ledger. Inventory was left as is.",
      });
      setPendingDelete(null);
    },
    onError: (err: any) => toast({ title: "Couldn't delete", description: err?.message || "Try again", variant: "destructive" }),
  });
  const canRestock = (t: Transaction | null) => !!t && t.type === "Sell" && !!t.itemId;

  const filtered = useMemo(() => {
    let r = txs;
    if (type !== "all") r = r.filter((t) => t.type === type);
    if (from) {
      const f = Math.floor(new Date(from).getTime() / 1000);
      r = r.filter((t) => t.date >= f);
    }
    if (to) {
      const e = Math.floor(new Date(to).getTime() / 1000) + 86400;
      r = r.filter((t) => t.date < e);
    }
    return r;
  }, [txs, type, from, to]);

  const totals = filtered.reduce(
    (acc, t) => {
      if (t.type === "Buy") acc.spent += t.price ?? 0;
      if (t.type === "Sell") {
        acc.received += t.price ?? 0;
        acc.realized += t.pnl ?? 0;
      }
      return acc;
    },
    { spent: 0, received: 0, realized: 0 }
  );

  const downloadCsv = () => {
    const header = ["Date", "Type", "ItemID", "Item", "Counterparty", "Price", "P/L", "Notes"];
    const rows = filtered.map((t) => [
      new Date(t.date * 1000).toISOString(),
      t.type,
      t.itemId ?? "",
      t.itemName ?? "",
      t.counterparty ?? "",
      t.price ?? "",
      t.pnl ?? "",
      t.notes ?? "",
    ]);
    const csv = [header, ...rows]
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ccc-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <PageHeader
        eyebrow="Ledger"
        title="Transactions"
        description={`${filtered.length} of ${txs.length} entries · realized ${formatCurrency(totals.realized)}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Spent</div>
            <div className="tnum text-lg font-bold mt-1">{formatCurrency(totals.spent)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Received</div>
            <div className="tnum text-lg font-bold mt-1">{formatCurrency(totals.received)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Realized P/L</div>
            <div className={`tnum text-lg font-bold mt-1 ${pnlClass(totals.realized)}`}>
              {formatCurrency(totals.realized)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 w-[140px]" data-testid="select-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="Buy">Buy</SelectItem>
              <SelectItem value="Sell">Sell</SelectItem>
              <SelectItem value="Trade">Trade</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              className="h-9 w-[160px]"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-from-date"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              className="h-9 w-[160px]"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-to-date"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm numeric">
            <thead className="border-b border-border">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold px-4 py-2.5">Date</th>
                <th className="text-left font-semibold px-4 py-2.5">Type</th>
                <th className="text-left font-semibold px-4 py-2.5">Item</th>
                <th className="text-left font-semibold px-4 py-2.5">Counterparty</th>
                <th className="text-right font-semibold px-4 py-2.5">Price</th>
                <th className="text-right font-semibold px-4 py-2.5">P/L</th>
                <th className="text-left font-semibold px-4 py-2.5">Notes</th>
                <th className="px-2 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-muted-foreground text-sm">
                    No transactions yet. Sell an item or buy from the marketplace to start the ledger.
                  </td>
                </tr>
              )}
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border last:border-0 hover:bg-accent/40"
                  data-testid={`row-tx-${t.id}`}
                >
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatDateTime(t.date)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider rounded-sm px-2 py-0.5 ${
                        t.type === "Buy"
                          ? "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-400/25 dark:text-emerald-100"
                          : t.type === "Sell"
                          ? "bg-rose-500/20 text-rose-800 dark:bg-rose-400/25 dark:text-rose-100"
                          : "bg-violet-500/20 text-violet-800 dark:bg-violet-400/25 dark:text-violet-100"
                      }`}
                    >
                      {t.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs max-w-[220px] truncate">
                    <div className="font-medium">{t.itemName ?? "—"}</div>
                    {t.itemId && <div className="text-[10px] text-muted-foreground font-mono">{t.itemId}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{t.counterparty ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tnum font-semibold">{formatCurrency(t.price)}</td>
                  <td className={`px-4 py-2.5 text-right tnum font-semibold ${pnlClass(t.pnl)}`}>
                    {t.pnl != null ? (t.pnl >= 0 ? "+" : "") + formatCurrency(t.pnl) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate" title={t.notes ?? undefined}>
                    {t.notes ?? "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => { setRestock(canRestock(t)); setPendingDelete(t); }}
                      className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-destructive"
                      aria-label={`Delete transaction ${t.id}`}
                      data-testid={`button-delete-tx-${t.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-tx">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  {pendingDelete.type} · {pendingDelete.itemName ?? pendingDelete.itemId ?? "—"} · {formatCurrency(pendingDelete.price)} on {formatDateTime(pendingDelete.date)}.
                  {" "}This removes it from the ledger and your totals. It can't be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {canRestock(pendingDelete) && (
            <label className="flex items-start gap-3 border border-border p-3 text-sm cursor-pointer">
              <Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} className="mt-0.5" data-testid="checkbox-restock" />
              <span>
                <span className="font-semibold">Put {pendingDelete?.itemId} back in inventory</span>
                <span className="block text-xs text-muted-foreground mt-0.5">Adds one back to quantity and clears Sold. Use this when the sale was a mistake or a test.</span>
              </span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (pendingDelete) deleteMutation.mutate({ id: pendingDelete.id, restock: canRestock(pendingDelete) && restock }); }}
              data-testid="button-confirm-delete-tx"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
