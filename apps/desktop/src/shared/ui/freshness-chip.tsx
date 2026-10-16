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
  className?: string;
}

/** How fresh the data on screen is: an icon and a text, never color only. */
export function FreshnessChip({ kind, children, title, className }: FreshnessChipProps) {
  return (
    <span
      data-slot="freshness-chip"
      data-kind={kind}
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-xs font-semibold",
        STYLES[kind],
        className,
      )}
    >
      <Icon name={ICONS[kind]} className="size-3.5" />
      <span>{children}</span>
    </span>
  );
}
