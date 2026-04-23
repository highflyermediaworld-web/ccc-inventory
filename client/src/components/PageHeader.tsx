interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-border pb-5 mb-6">
      <div className="space-y-1 min-w-0">
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.2em] text-primary font-semibold">
            {eyebrow}
          </div>
        )}
        <h1 className="text-xl font-bold tracking-tight" data-testid="page-title">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
