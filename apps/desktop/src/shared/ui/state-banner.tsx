import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";

export type BannerVariant = "neutral" | "warning" | "error";

export interface BannerAction {
  id: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** Disables the button (for example while another command is pending). */
  disabled?: boolean;
  /** Shows a spinner and disables the button until the backend answers. */
  pending?: boolean;
}

const STYLES: Record<BannerVariant, string> = {
  neutral: "bg-neutral-tint text-foreground",
  // Orange fill with dark text (5.2:1).
  warning: "bg-warning text-dark",
  // Tinted background with a 4px error border; the text stays dark.
  error: "border-l-4 border-error bg-error-tint text-foreground",
};

interface StateBannerProps {
  variant: BannerVariant;
  icon: IconName;
  children: ReactNode;
  /** At most two actions. */
  actions?: readonly BannerAction[];
  className?: string;
}

/** The one fixed place for abnormal or transient states: icon, text and up to two actions. */
export function StateBanner({
  variant,
  icon,
  children,
  actions = [],
  className,
}: StateBannerProps) {
  return (
    <div
      data-slot="state-banner"
      data-variant={variant}
      className={cn(
        "flex min-h-10 items-center gap-2 px-4 py-1.5 text-sm",
        STYLES[variant],
        className,
      )}
    >
      <Icon name={icon} tone={variant === "error" ? "error" : "default"} />
      <p className="min-w-0 flex-1">{children}</p>
      {actions.slice(0, 2).map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.primary ? "default" : "outline"}
          disabled={action.pending || action.disabled}
          onClick={action.onClick}
        >
          {action.pending ? <Icon name="loader" /> : null}
          {action.label}
        </Button>
      ))}
    </div>
  );
}
