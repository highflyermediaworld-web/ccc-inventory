interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between pb-5 mb-6">
      <div className="space-y-1.5 min-w-0">
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.24em] text-gold font-semibold">
            {eyebrow}
          </div>
        )}
        <h1
          className="serif text-3xl sm:text-4xl font-medium tracking-tight leading-[1.05] text-foreground"
          data-testid="page-title"
        >
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl pt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      {/* subtle gold-to-transparent underline separator */}
      <div
        aria-hidden
        className="absolute inset-x-0 -bottom-px h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(to right, hsl(var(--brand-gold) / 0.55), hsl(var(--border) / 0.6) 30%, hsl(var(--border) / 0.6))",
        }}
      />
    </div>
  );
}
