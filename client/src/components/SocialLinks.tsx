import { SiTiktok, SiInstagram } from "react-icons/si";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const BRAND_HANDLE = "@cpulls.cards";
export const TIKTOK_URL = "https://www.tiktok.com/@cpulls.cards";
export const INSTAGRAM_URL = "https://www.instagram.com/cpulls.cards";

interface SocialLinksProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  variant?: "icon" | "ghost" | "solid";
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-11 w-11",
};

const iconSize = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

export function SocialLinks({
  size = "sm",
  className = "",
  variant = "icon",
}: SocialLinksProps) {
  const base =
    variant === "solid"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : variant === "ghost"
        ? "bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
        : "bg-muted/40 text-foreground hover:bg-muted hover:text-primary";

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={TIKTOK_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Follow ${BRAND_HANDLE} on TikTok`}
            data-testid="link-social-tiktok"
            className={cn(
              "flex items-center justify-center rounded-md transition-colors",
              sizeClasses[size],
              base
            )}
          >
            <SiTiktok className={iconSize[size]} />
          </a>
        </TooltipTrigger>
        <TooltipContent side="top">Follow {BRAND_HANDLE} on TikTok</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Follow ${BRAND_HANDLE} on Instagram`}
            data-testid="link-social-instagram"
            className={cn(
              "flex items-center justify-center rounded-md transition-colors",
              sizeClasses[size],
              base
            )}
          >
            <SiInstagram className={iconSize[size]} />
          </a>
        </TooltipTrigger>
        <TooltipContent side="top">Follow {BRAND_HANDLE} on Instagram</TooltipContent>
      </Tooltip>
    </div>
  );
}
