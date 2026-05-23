import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Radio, ExternalLink } from "lucide-react";
import { SiTiktok, SiTwitch, SiYoutube, SiInstagram } from "react-icons/si";
import { useState } from "react";

type LiveStatus = {
  isLive: boolean;
  platform: string; // "tiktok" | "twitch" | "youtube" | "instagram"
  handle: string;
  url: string;
  title: string;
};

function getPlatformIcon(p: string) {
  switch (p) {
    case "twitch":
      return SiTwitch;
    case "youtube":
      return SiYoutube;
    case "instagram":
      return SiInstagram;
    default:
      return SiTiktok;
  }
}

function getEmbedUrl(s: LiveStatus): string | null {
  if (s.url) {
    // Twitch parent param required for embedding
    if (s.platform === "twitch") {
      const channel = s.handle || s.url.split("/").pop() || "";
      const parent = typeof window !== "undefined" ? window.location.hostname : "localhost";
      return `https://player.twitch.tv/?channel=${channel}&parent=${parent}&autoplay=true&muted=false`;
    }
    if (s.platform === "youtube") {
      // Accept either a full watch URL or a channel ID
      try {
        const u = new URL(s.url);
        const v = u.searchParams.get("v");
        if (v) return `https://www.youtube.com/embed/${v}?autoplay=1`;
      } catch {}
      return s.url;
    }
  }
  return null;
}

export function LiveStreamBanner() {
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery<LiveStatus>({
    queryKey: ["/api/live"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/live");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const Icon = getPlatformIcon(data.platform);
  const platformLabel = data.platform.charAt(0).toUpperCase() + data.platform.slice(1);
  const channelUrl =
    data.url ||
    (data.platform === "tiktok"
      ? `https://www.tiktok.com/@${data.handle.replace(/^@/, "")}/live`
      : data.platform === "twitch"
        ? `https://www.twitch.tv/${data.handle}`
        : "#");

  // OFFLINE: subtle pill teasing the live shows
  if (!data.isLive) {
    return (
      <a
        href={channelUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="link-live-offline"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover-elevate"
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-muted-foreground">
          Follow on {platformLabel} for live pulls
        </span>
      </a>
    );
  }

  // LIVE: prominent red glowing banner
  const embedUrl = getEmbedUrl(data);
  return (
    <div
      className="relative overflow-hidden rounded-2xl border-2 border-primary bg-gradient-to-r from-black via-zinc-900 to-black text-white shadow-[0_0_40px_-8px_hsl(var(--primary)/0.6)]"
      data-testid="live-banner"
    >
      <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, hsl(var(--primary)) 0 1px, transparent 1px 14px)",
        }}
      />
      <div className="relative flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="live-pulse-dot inline-flex h-3 w-3 rounded-full bg-primary shrink-0"
              aria-hidden
            />
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary">
                  Live now
                </span>
                <Icon className="h-3.5 w-3.5 text-white/70" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-white/60">
                  {platformLabel}
                </span>
              </div>
              <span className="text-base sm:text-lg font-bold text-white truncate">
                {data.title}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {embedUrl && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                data-testid="button-toggle-live-embed"
              >
                <Radio className="h-3.5 w-3.5" />
                {expanded ? "Hide player" : "Watch here"}
              </button>
            )}
            <a
              href={channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-live-channel"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              Open in {platformLabel}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {expanded && embedUrl && (
          <div className="overflow-hidden rounded-lg border border-white/10 bg-black aspect-video">
            <iframe
              src={embedUrl}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="h-full w-full"
              title="Live stream"
            />
          </div>
        )}

        {expanded && !embedUrl && (
          <div className="rounded-lg border border-white/10 bg-black/50 p-4 text-sm text-white/80">
            {data.platform === "tiktok"
              ? "TikTok Live can't be embedded — tap \u201cOpen in TikTok\u201d to watch live pulls."
              : "This platform can't be embedded here. Use the Open button to watch live."}
          </div>
        )}
      </div>
    </div>
  );
}
