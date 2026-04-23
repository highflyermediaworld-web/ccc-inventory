export function formatCurrency(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (opts.compact && Math.abs(n) >= 1000) {
    return "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" }).format(n);
  }
  return "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function formatDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function daysBetween(a: number, b: number): number {
  return Math.floor((a - b) / 86400);
}

export function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "text-muted-foreground";
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "text-muted-foreground";
}
