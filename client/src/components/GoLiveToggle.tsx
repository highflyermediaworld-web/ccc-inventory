import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Radio } from "lucide-react";
import { SiTiktok, SiTwitch, SiYoutube, SiInstagram } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

type LiveStatus = {
  isLive: boolean;
  platform: string;
  handle: string;
  url: string;
  title: string;
};

function platformIcon(p: string) {
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

export function GoLiveToggle() {
  const { toast } = useToast();
  const { data } = useQuery<LiveStatus>({
    queryKey: ["/api/live"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/live");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await apiRequest("POST", "/api/live", { isLive: next });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/live"] });
      toast({
        title: variables ? "You\u2019re live" : "Live banner hidden",
        description: variables
          ? "The red banner just popped on the shop home."
          : "Banner is off. Shop is back to normal.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn\u2019t toggle live",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  if (!data) return null;

  const Icon = platformIcon(data.platform);
  const platformLabel = data.platform.charAt(0).toUpperCase() + data.platform.slice(1);
  const isLive = data.isLive;

  return (
    <div
      className={[
        "relative overflow-hidden rounded-2xl border-2 mb-6 transition-all",
        isLive
          ? "border-primary bg-gradient-to-r from-black via-zinc-900 to-black text-white shadow-[0_0_40px_-8px_hsl(var(--primary)/0.6)]"
          : "border-border bg-card",
      ].join(" ")}
      data-testid="go-live-card"
    >
      {isLive && (
        <div
          className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, hsl(var(--primary)) 0 1px, transparent 1px 14px)",
          }}
        />
      )}
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className={[
              "inline-flex h-3 w-3 rounded-full shrink-0",
              isLive ? "live-pulse-dot bg-primary" : "bg-muted-foreground/40",
            ].join(" ")}
            aria-hidden
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={[
                  "text-[10px] uppercase tracking-[0.3em] font-bold",
                  isLive ? "text-primary" : "text-muted-foreground",
                ].join(" ")}
              >
                {isLive ? "Live now" : "Offline"}
              </span>
              <Icon
                className={`h-3.5 w-3.5 ${isLive ? "text-white/70" : "text-muted-foreground"}`}
              />
              <span
                className={[
                  "text-[10px] uppercase tracking-[0.2em]",
                  isLive ? "text-white/60" : "text-muted-foreground",
                ].join(" ")}
              >
                {platformLabel} \u00b7 @{data.handle.replace(/^@/, "")}
              </span>
            </div>
            <span
              className={[
                "text-base sm:text-lg font-bold truncate mt-0.5",
                isLive ? "text-white" : "text-foreground",
              ].join(" ")}
            >
              {isLive ? data.title : "Ready when you are"}
            </span>
            <span
              className={[
                "text-xs mt-0.5",
                isLive ? "text-white/60" : "text-muted-foreground",
              ].join(" ")}
            >
              {isLive
                ? "Customers see the live banner on the shop home."
                : "Tap Go Live when you start your TikTok pulls."}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/admin/live"
            className={[
              "hidden sm:inline-flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
              isLive
                ? "border-white/20 bg-white/5 text-white hover:bg-white/10"
                : "border-border bg-background hover:bg-muted",
            ].join(" ")}
            data-testid="link-live-settings"
          >
            Settings
          </Link>
          <button
            onClick={() => toggleMutation.mutate(!isLive)}
            disabled={toggleMutation.isPending}
            data-testid="button-go-live"
            className={[
              "inline-flex items-center justify-center gap-2 rounded-xl px-6 py-4 sm:py-3 text-base font-bold uppercase tracking-wider transition-all min-w-[140px] active:scale-[0.97]",
              isLive
                ? "bg-white text-black hover:bg-white/90 shadow-lg"
                : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_4px_20px_-4px_hsl(var(--primary)/0.6)]",
              toggleMutation.isPending ? "opacity-70 cursor-wait" : "",
            ].join(" ")}
          >
            <Radio className={`h-5 w-5 ${isLive ? "" : "live-pulse-dot rounded-full"}`} />
            {toggleMutation.isPending
              ? "\u2026"
              : isLive
                ? "End live"
                : "Go live"}
          </button>
        </div>
      </div>
    </div>
  );
}
