import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { Loader2, AlertCircle, ArrowLeft, Crown, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

type Door = "owner" | "it";
const DOORS: { id: Door; label: string; hint: string; Icon: typeof Crown }[] = [
  { id: "owner", label: "Owner", hint: "Shop owners · full access", Icon: Crown },
  { id: "it", label: "IT", hint: "Technical staff · full access", Icon: Wrench },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [door, setDoor] = useState<Door>(() => {
    try { return (localStorage.getItem("ccc_login_door") as Door) === "it" ? "it" : "owner"; } catch { return "owner"; }
  });
  function pickDoor(d: Door) {
    setDoor(d);
    setError(null);
    try { localStorage.setItem("ccc_login_door", d); } catch { /* ignore */ }
  }

  const { data: status } = useQuery<{ userCount: number; signupEnabled: boolean }>({
    queryKey: ["/api/auth/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/status");
      return res.json();
    },
  });

  // Pull `next` out of the hash query string (e.g. /#/login?next=/admin/inventory)
  const nextPath = (() => {
    if (typeof window === "undefined") return "/admin";
    const hash = window.location.hash.slice(1); // strip leading "#"
    const q = hash.indexOf("?");
    if (q === -1) return "/admin";
    const params = new URLSearchParams(hash.slice(q + 1));
    const n = params.get("next");
    return n && n.startsWith("/admin") ? n : "/admin";
  })();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier.trim(), password, door);
      setLocation(nextPath);
    } catch (err: any) {
      const msg = (err?.message ?? "").replace(/^\d+:\s*/, "");
      try {
        const parsed = JSON.parse(msg);
        setError(parsed.message ?? "Invalid credentials");
      } catch {
        setError(msg || "Invalid credentials");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Ambient gold glow behind the card */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(600px 400px at 50% 40%, hsl(var(--brand-gold) / 0.08), transparent 70%)",
        }}
      />
      <div className="w-full max-w-sm relative">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-gold-bright font-semibold mb-6"
          data-testid="link-back-to-shop"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to shop
        </Link>

        <div
          className="border border-border bg-card p-6 sm:p-8"
          style={{
            borderTop: "1px solid hsl(var(--brand-gold) / 0.6)",
            boxShadow:
              "0 1px 0 hsl(var(--brand-gold) / 0.25), 0 24px 48px -20px hsl(var(--brand-aubergine) / 0.6)",
          }}
        >
          <div className="flex items-center justify-center mb-5">
            <Logo size={36} />
          </div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-gold font-semibold text-center mb-1">
            Admin Portal
          </div>
          <h1
            className="serif text-3xl font-medium tracking-tight text-center leading-none mb-2"
            data-testid="heading-login"
          >
            Sign in
          </h1>
          <p className="text-xs text-muted-foreground text-center mb-5">
            CPulls Cards back office
          </p>

          <div className="grid grid-cols-2 gap-1.5 mb-5" role="tablist" aria-label="Login type">
            {DOORS.map(({ id, label, hint, Icon }) => {
              const active = door === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => pickDoor(id)}
                  data-testid={`door-${id}`}
                  className={cn(
                    "flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-[hsl(var(--brand-gold)/0.7)] bg-[hsl(var(--brand-gold)/0.1)] text-foreground"
                      : "border-border bg-background/40 text-muted-foreground hover:border-[hsl(var(--brand-gold)/0.4)] hover:text-foreground"
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Icon className={cn("h-3.5 w-3.5", active ? "text-gold-bright" : "")} /> {label}
                  </span>
                  <span className="text-[10px] leading-tight">{hint}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier">Username or email</Label>
              <Input
                id="identifier"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                data-testid="input-identifier"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password"
              />
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                data-testid="error-login"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting}
              data-testid="button-sign-in"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Signing in…
                </>
              ) : (
                `Sign in as ${door === "it" ? "IT" : "Owner"}`
              )}
            </Button>
          </form>

          {status?.signupEnabled && (
            <p className="mt-5 text-center text-xs text-muted-foreground">
              Need an account?{" "}
              <Link
                href="/signup"
                className="font-semibold text-primary hover:underline"
                data-testid="link-signup"
              >
                Sign up
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
