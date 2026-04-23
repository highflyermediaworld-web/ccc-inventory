// Small card thumbnail used across Inventory + detail views.
// Falls back to a gradient placeholder with franchise initials if imageUrl missing.
import { resolveUploadUrl } from "@/lib/uploads";

function initialsFor(franchise: string): string {
  const map: Record<string, string> = {
    Pokémon: "PK",
    "One Piece": "OP",
    "Magic The Gathering": "MTG",
    DBZ: "DBZ",
    "League of Legends": "LOL",
    "Union Arena": "UA",
  };
  return map[franchise] ?? (franchise.slice(0, 2) || "?").toUpperCase();
}

function gradientFor(franchise: string): string {
  const gradients: Record<string, string> = {
    Pokémon: "from-yellow-500/30 to-red-500/30",
    "One Piece": "from-red-500/30 to-amber-500/30",
    "Magic The Gathering": "from-purple-500/30 to-slate-700/40",
    DBZ: "from-orange-500/30 to-yellow-400/30",
    "League of Legends": "from-blue-500/30 to-teal-500/30",
    "Union Arena": "from-indigo-500/30 to-fuchsia-500/30",
  };
  return gradients[franchise] ?? "from-slate-400/30 to-slate-600/30";
}

export function CardThumb({
  imageUrl,
  franchise,
  size = "sm",
  className = "",
  alt,
}: {
  imageUrl?: string | null;
  franchise: string;
  size?: "sm" | "lg";
  className?: string;
  alt?: string;
}) {
  const dims =
    size === "sm"
      ? "w-10 h-14"
      : "w-full aspect-[5/7] max-w-[280px]";
  const resolved = resolveUploadUrl(imageUrl);
  if (resolved) {
    return (
      <img
        src={resolved}
        alt={alt ?? "Card"}
        loading="lazy"
        className={`${dims} object-cover rounded-md border border-border bg-muted ${className}`}
      />
    );
  }
  return (
    <div
      className={`${dims} rounded-md border border-border bg-gradient-to-br ${gradientFor(
        franchise
      )} flex items-center justify-center ${className}`}
      aria-label={`${franchise} placeholder`}
    >
      <span
        className={`font-bold text-foreground/70 ${
          size === "sm" ? "text-[9px]" : "text-2xl"
        }`}
      >
        {initialsFor(franchise)}
      </span>
    </div>
  );
}
