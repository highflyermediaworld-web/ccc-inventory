interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 32, showText = true, className = "" }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`} data-testid="logo">
      <img
        src="/logo.jpeg"
        alt="Chris Collects Co logo"
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-1 ring-border"
        style={{ width: size, height: size }}
      />
      {showText && (
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-bold tracking-tight">Chris Collects Co</span>
          <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
            CPulls Cards
          </span>
        </div>
      )}
    </div>
  );
}
