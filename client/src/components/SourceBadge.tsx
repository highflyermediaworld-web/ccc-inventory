// Tiny text badge indicating the origin of a market value (Scryfall, TCGdex, AI est, Manual).
type Source = "Scryfall" | "TCGdex" | "AI est" | "Manual" | "Seed";

const COLORS: Record<string, string> = {
  Scryfall: "text-amber-600 dark:text-amber-400",
  TCGdex: "text-emerald-600 dark:text-emerald-400",
  "AI est": "text-violet-600 dark:text-violet-400",
  Manual: "text-muted-foreground",
  Seed: "text-muted-foreground",
};

export function SourceBadge({
  source,
  className = "",
}: {
  source?: Source | string | null;
  className?: string;
}) {
  if (!source) return null;
  const color = COLORS[source] ?? "text-muted-foreground";
  return (
    <span
      className={`inline-block text-[9px] uppercase tracking-wider font-semibold ${color} ${className}`}
      data-testid={`source-badge-${source}`}
    >
      {source}
    </span>
  );
}
