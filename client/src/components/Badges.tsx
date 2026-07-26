import { cn } from "@/lib/utils";

/**
 * All badges below are calibrated for WCAG AA (4.5:1 body / 3:1 large text)
 * on both the aubergine dark theme and the cream light theme.
 *
 * Dark theme rule of thumb:
 *   • Background: color-500/25   (heavier tint so the pill reads on aubergine)
 *   • Text:       color-100      (very light so it clears 4.5:1 over the tint)
 *   • Border:     color-500/50   (crisper edge)
 */

export function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, string> = {
    Sealed:
      "bg-teal-500/20 text-teal-800 dark:bg-teal-400/25 dark:text-teal-100 border border-teal-500/40",
    Raw:
      "bg-slate-500/20 text-slate-800 dark:bg-slate-400/25 dark:text-slate-100 border border-slate-500/40",
    Slab:
      "bg-primary/20 text-[hsl(var(--brand-aubergine))] dark:bg-[hsl(var(--brand-gold)/0.28)] dark:text-[hsl(var(--brand-gold-bright))] border border-[hsl(var(--brand-gold)/0.5)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        map[category] || "bg-muted text-muted-foreground border border-border"
      )}
      data-testid={`badge-category-${category}`}
    >
      {category}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "In Inventory": "bg-foreground/10 text-foreground",
    Sold:
      "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-400/25 dark:text-emerald-100",
    Listed:
      "bg-primary/20 text-[hsl(var(--brand-aubergine))] dark:bg-[hsl(var(--brand-gold)/0.28)] dark:text-[hsl(var(--brand-gold-bright))]",
    Traded:
      "bg-violet-500/20 text-violet-800 dark:bg-violet-400/25 dark:text-violet-100",
    Pending:
      "bg-amber-500/20 text-amber-800 dark:bg-amber-400/25 dark:text-amber-100",
    Accepted:
      "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-400/25 dark:text-emerald-100",
    Declined:
      "bg-rose-500/20 text-rose-800 dark:bg-rose-400/25 dark:text-rose-100",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        map[status] || "bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  );
}

export function FranchiseBadge({ franchise }: { franchise: string }) {
  // Short code + color dot
  const map: Record<string, { code: string; color: string }> = {
    Pokémon: { code: "PK", color: "bg-yellow-500" },
    "One Piece": { code: "OP", color: "bg-red-500" },
    "Magic The Gathering": { code: "MTG", color: "bg-orange-500" },
    DBZ: { code: "DBZ", color: "bg-blue-500" },
    "League of Legends": { code: "LOL", color: "bg-cyan-500" },
    "Union Arena": { code: "UA", color: "bg-fuchsia-500" },
  };
  const info = map[franchise] ?? { code: franchise.slice(0, 3).toUpperCase(), color: "bg-muted" };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", info.color)} />
      <span className="truncate">{franchise}</span>
    </span>
  );
}
