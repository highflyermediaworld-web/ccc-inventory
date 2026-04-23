import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      await login(identifier.trim(), password);
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
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6"
          data-testid="link-back-to-shop"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to shop
        </Link>

        <div className="rounded-xl border border-border bg-card p-6 sm:p-8 shadow-sm">
          <div className="flex items-center justify-center mb-4">
            <Logo size={32} />
          </div>
          <h1 className="text-xl font-bold text-center mb-1" data-testid="heading-login">
            Sign in
          </h1>
          <p className="text-xs text-muted-foreground text-center mb-6">
            Admin access for CPulls Cards
          </p>

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
                "Sign in"
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
