import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Ambient gold glow behind the panel */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(600px 400px at 50% 40%, hsl(var(--brand-gold) / 0.06), transparent 70%)",
        }}
      />

      <div className="w-full max-w-md relative">
        <div className="flex items-center justify-center mb-8">
          <Logo size={36} />
        </div>

        <div
          className="border border-border bg-card p-8 sm:p-10 text-center"
          style={{
            borderTop: "1px solid hsl(var(--brand-gold) / 0.6)",
            boxShadow:
              "0 1px 0 hsl(var(--brand-gold) / 0.25), 0 24px 48px -20px hsl(var(--brand-aubergine) / 0.6)",
          }}
        >
          <div className="text-[10px] uppercase tracking-[0.24em] text-gold font-semibold mb-2">
            Error · 404
          </div>
          <h1
            className="serif text-4xl sm:text-5xl font-medium tracking-tight leading-none mb-3"
            data-testid="heading-notfound"
          >
            Page not found
          </h1>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-8">
            The URL you followed doesn&apos;t match anything in the shop.
            It may have moved, or the link is out of date.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch justify-center gap-3">
            <Link href="/">
              <Button className="w-full sm:w-auto gap-2" data-testid="button-home">
                <Home className="h-4 w-4" />
                Back to shop
              </Button>
            </Link>
            <Button
              variant="ghost"
              className="w-full sm:w-auto gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => window.history.back()}
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4" />
              Go back
            </Button>
          </div>
        </div>

        <div className="mt-6 text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50 text-center">
          Chris Collects Co · Trading cards · Est. 2024
        </div>
      </div>
    </div>
  );
}
