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

export default function SignupPage() {
  const { signup } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: status, isLoading } = useQuery<{
    userCount: number;
    signupEnabled: boolean;
  }>({
    queryKey: ["/api/auth/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/status");
      return res.json();
    },
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await signup(username.trim(), email.trim(), password, inviteCode.trim());
      setLocation("/admin");
    } catch (err: any) {
      const raw = (err?.message ?? "").replace(/^\d+:\s*/, "");
      try {
        const parsed = JSON.parse(raw);
        setError(parsed.message ?? "Sign-up failed");
      } catch {
        setError(raw || "Sign-up failed");
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
          <h1 className="text-xl font-bold text-center mb-1" data-testid="heading-signup">
            Create admin account
          </h1>
          <p className="text-xs text-muted-foreground text-center mb-6">
            Invite-only · Chris Collects Co
          </p>

          {!isLoading && status && !status.signupEnabled ? (
            <div
              className="rounded-md border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground"
              data-testid="signup-disabled"
            >
              Sign-up is currently disabled. Contact the site owner.
              <div className="mt-4">
                <Link
                  href="/login"
                  className="text-xs font-semibold text-primary hover:underline"
                  data-testid="link-login"
                >
                  ← Back to sign in
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  minLength={2}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  data-testid="input-username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-password"
                />
                <p className="text-[11px] text-muted-foreground">At least 8 characters</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  data-testid="input-confirm-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite">Invite code</Label>
                <Input
                  id="invite"
                  type="text"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  data-testid="input-invite-code"
                />
              </div>

              {error && (
                <div
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                  data-testid="error-signup"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
                data-testid="button-sign-up"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating…
                  </>
                ) : (
                  "Create account"
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-semibold text-primary hover:underline"
                  data-testid="link-login"
                >
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
