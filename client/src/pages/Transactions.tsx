import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Download } from "lucide-react";

export default function TransactionsPage() {
  const { data: txs = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
  });

  const [type, setType] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

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
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-foreground text-sm">
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
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : t.type === "Sell"
                          ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                          : "bg-violet-500/15 text-violet-700 dark:text-violet-300"
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
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">
                    {t.notes ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
