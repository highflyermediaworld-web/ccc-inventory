import { useEffect, useState } from "react";
import { Download, Share, Plus, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Cross-platform "Install app" prompt.
 *
 * • Chrome / Android / desktop Edge: uses the native `beforeinstallprompt`
 *   event — one-tap install.
 * • iOS Safari: no API for that, so we show a small how-to card
 *   ("Share → Add to Home Screen").
 *
 * The prompt auto-hides once installed or dismissed for 14 days.
 */

const DISMISS_KEY = "ccc:install:dismissed-at";
const DISMISS_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return ageDays < DISMISS_DAYS;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean })
    .standalone;
  return (
    iosStandalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    // Chrome / Android / desktop: capture the deferred prompt.
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    // iOS: no event — show a helper after a moment on first visit.
    if (isIOS()) {
      const t = setTimeout(() => {
        setShowIOS(true);
        setVisible(true);
      }, 3000);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBip);
      };
    }

    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* no-op */
    }
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "dismissed") dismiss();
      setDeferred(null);
      setVisible(false);
    } catch {
      dismiss();
    }
  };

  return (
    <div
      className="fixed z-50 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-sm"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0) + 12px)",
      }}
      role="dialog"
      aria-label="Install CPulls Cards"
      data-testid="install-prompt"
    >
      <div
        className="bg-card border border-border p-4 relative"
        style={{
          borderTop: "1px solid hsl(var(--brand-gold) / 0.6)",
          boxShadow:
            "0 1px 0 hsl(var(--brand-gold) / 0.25), 0 20px 40px -16px hsl(var(--brand-aubergine) / 0.6)",
        }}
      >
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground"
          data-testid="button-install-dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <div className="shrink-0 w-10 h-10 bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-gold" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold mb-0.5">
              Install
            </div>
            <div className="serif text-lg font-medium tracking-tight leading-none mb-1">
              Get the CPulls app
            </div>
            <p className="text-xs text-muted-foreground">
              Fullscreen, offline-ready, one-tap from your home screen.
            </p>
          </div>
        </div>

        {showIOS ? (
          <div className="mt-3 pt-3 border-t border-border">
            {expanded ? (
              <ol className="text-xs text-muted-foreground space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="text-gold font-semibold">1.</span>
                  <span>
                    Tap the{" "}
                    <Share className="inline h-3.5 w-3.5 mx-0.5 -mt-0.5" />{" "}
                    Share button in Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gold font-semibold">2.</span>
                  <span>
                    Scroll down and tap{" "}
                    <span className="whitespace-nowrap">
                      <Plus className="inline h-3.5 w-3.5 mx-0.5 -mt-0.5" />{" "}
                      Add to Home Screen
                    </span>
                    .
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gold font-semibold">3.</span>
                  <span>Tap Add — the icon lands on your home screen.</span>
                </li>
              </ol>
            ) : (
              <Button
                size="sm"
                className="w-full gap-2"
                onClick={() => setExpanded(true)}
                data-testid="button-install-ios"
              >
                <Download className="h-4 w-4" />
                Show me how
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-3 pt-3 border-t border-border flex gap-2">
            <Button
              size="sm"
              className="flex-1 gap-2"
              onClick={install}
              data-testid="button-install-native"
            >
              <Download className="h-4 w-4" />
              Install
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={dismiss}
              data-testid="button-install-later"
            >
              Later
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
