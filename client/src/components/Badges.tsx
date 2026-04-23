import { cn } from "@/lib/utils";

export function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, string> = {
    Sealed: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30",
    Raw: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/30",
    Slab: "bg-primary/15 text-primary border border-primary/30",
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
    Sold: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    Listed: "bg-primary/15 text-primary",
    Traded: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    Pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    Accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    Declined: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
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
