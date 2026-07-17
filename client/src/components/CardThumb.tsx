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
  // If a wrapping className already sets h-*/w-*, we don't want CardThumb to
  // force its own aspect box (which introduces whitespace inside the frame).
  const callerControlsSize = /\b(h-full|w-full|h-\[|w-\[|aspect-)/.test(className);
  const dims = callerControlsSize
    ? ""
    : size === "sm"
      ? "w-10 h-14"
      : "w-full aspect-[5/7] max-w-[280px]";
  const resolved = resolveUploadUrl(imageUrl);

  if (resolved) {
    // sm (list thumbnails) — keep the crisp uniform look with object-cover.
    if (size === "sm") {
      return (
        <img
          src={resolved}
          alt={alt ?? "Card"}
          loading="lazy"
          className={`${dims} object-cover object-center block ${className}`}
        />
      );
    }
    // lg (product cards, detail views) — SHOW THE WHOLE PRODUCT (object-contain)
    // but eliminate visible negative space by filling padding with a blurred,
    // scaled-up copy of the same image. This is the Apple/Shopify/Bloomberg
    // "seamless frame" technique: the product is never cropped, yet the
    // container never shows an empty background color.
    return (
      <div
        className={`relative overflow-hidden ${dims} ${className}`}
        aria-label={alt ?? "Product"}
      >
        {/* Blurred backdrop — fills the frame edge-to-edge */}
        <img
          src={resolved}
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover scale-125 blur-2xl opacity-70"
        />
        {/* Subtle dark overlay so the sharp image on top stays readable */}
        <div className="absolute inset-0 bg-black/25" />
        {/* Sharp product photo — full item always visible, never cropped */}
        <img
          src={resolved}
          alt={alt ?? "Card"}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-contain object-center p-1"
        />
      </div>
    );
  }
  return (
    <div
      className={`${dims} bg-gradient-to-br ${gradientFor(
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
