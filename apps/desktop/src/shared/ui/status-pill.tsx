import { cn } from "@/shared/lib/utils";
import { Icon, type IconName } from "./icon";

/** One variant per session state (DES-001 2.3). */
export type StatusVariant =
  | "idle"
  | "connecting"
  | "connected"
  | "polling"
  | "paused"
  | "timeout"
  | "exception"
  | "badResponse"
  | "disconnected";

const STYLES: Record<StatusVariant, string> = {
  idle: "border border-dark/25 text-foreground",
  connecting: "border border-dark/25 text-foreground",
  connected: "border border-dark bg-dark text-light",
  polling: "border border-dark/15 bg-success text-dark",
  paused: "border border-dark text-foreground",
  timeout: "border border-dark/15 bg-warning text-dark",
  exception: "border-[1.5px] border-error bg-error-tint text-foreground",
  badResponse: "border border-dark/15 bg-warning text-dark",
  disconnected: "border-[1.5px] border-error bg-error-tint text-foreground",
};

/** Error-colored icons on the tinted pills; every other icon takes the text color. */
const ERROR_ICON: ReadonlySet<StatusVariant> = new Set(["exception", "disconnected"]);

interface StatusPillProps {
  variant: StatusVariant;
  icon: IconName;
  label: string;
  className?: string;
}

/** Pill with an icon and a text label. The text is always present: status is never color only. */
export function StatusPill({ variant, icon, label, className }: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      data-variant={variant}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-pill px-3 text-sm font-semibold",
        STYLES[variant],
        className,
      )}
    >
      <Icon name={icon} tone={ERROR_ICON.has(variant) ? "error" : "default"} />
      <span>{label}</span>
    </span>
  );
}
