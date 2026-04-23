interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 28, showText = true, className = "" }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`} data-testid="logo">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-label="CCC logo"
        className="shrink-0"
      >
        {/* Three stacked cards, offset, gold-accented front card */}
        <rect
          x="4.5"
          y="8"
          width="13"
          height="18"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.35"
        />
        <rect
          x="8.5"
          y="6"
          width="13"
          height="18"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.6"
        />
        <rect
          x="12.5"
          y="4"
          width="14"
          height="20"
          rx="2"
          fill="hsl(var(--primary))"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
        />
        <text
          x="19.5"
          y="17"
          textAnchor="middle"
          fontSize="10"
          fontWeight="800"
          fill="hsl(var(--primary-foreground))"
          fontFamily="Inter, sans-serif"
          letterSpacing="-0.5"
        >
          C
        </text>
      </svg>
      {showText && (
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-bold tracking-tight">CCC</span>
          <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
            Card Command
          </span>
        </div>
      )}
    </div>
  );
}
