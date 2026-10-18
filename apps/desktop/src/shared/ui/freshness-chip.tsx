import { cn } from "@/shared/lib/utils";
import { Icon, type IconName } from "./icon";

export type Freshness = "live" | "loading" | "stale";

const ICONS: Record<Freshness, IconName> = {
  live: "circle-check",
  loading: "loader",
  stale: "clock",
};

const STYLES: Record<Freshness, string> = {
  live: "border border-dark/15 bg-success text-dark",
  loading: "border border-dark/25 text-foreground",
  stale: "border border-dark/25 text-foreground",
};

interface FreshnessChipProps {
  kind: Freshness;
  /** For example "Updated 14:02:11.540" or "No response - values from 14:02:11.540". */
  children: string;
  /** Full date-time shown as a tooltip. */
  title?: string;
  /**
   * Only the icon shows (a narrow status line). The text stays for assistive technology and becomes
   * the tooltip.
   */
  iconOnly?: boolean;
  className?: string;
}

/** How fresh the data on screen is: an icon and a text, never color only. */
export function FreshnessChip({
  kind,
  children,
  title,
  iconOnly = false,
  className,
}: FreshnessChipProps) {
  return (
    <span
      data-slot="freshness-chip"
      data-kind={kind}
      data-icon-only={iconOnly ? "true" : undefined}
      title={iconOnly ? (title === undefined ? children : `${children} (${title})`) : title}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-xs font-semibold",
        STYLES[kind],
        className,
      )}
    >
      <Icon name={ICONS[kind]} className="size-3.5" />
      <span className={iconOnly ? "sr-only" : undefined}>{children}</span>
    </span>
  );
}
