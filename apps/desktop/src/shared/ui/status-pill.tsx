import { cn } from "@/shared/lib/utils";
import { Icon, type IconName } from "./icon";

/**
 * One variant per connection state (idle, connecting, connected, disconnected) and per poll state
 * (polling, paused, timeout, exception, badResponse, offline), plus `waiting`: a poll that is
 * polling and has no data yet (DES-001 2.3, DES-002 1.2 and 2.3.2).
 */
export type StatusVariant =
  | "idle"
  | "connecting"
  | "connected"
  | "polling"
  | "paused"
  | "timeout"
  | "exception"
  | "badResponse"
  | "disconnected"
  | "offline"
  | "waiting";

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
  offline: "border border-dark/25 text-text-muted",
  waiting: "border border-dark/25 text-foreground",
};

/** Error-colored icons on the tinted pills; every other icon takes the text color. */
const ERROR_ICON: ReadonlySet<StatusVariant> = new Set(["exception", "disconnected"]);

interface StatusPillProps {
  variant: StatusVariant;
  /** `null`: no icon (the poll summary chip with no polls, DES-002 1.5). */
  icon: IconName | null;
  label: string;
  /** `sm` is the compact chip of the poll status line and the sidebar. */
  size?: "default" | "sm";
  className?: string;
  /** Tooltip, for example the full banner text of the state. */
  title?: string | undefined;
  /**
   * The full label when `label` is a short form (a compact chip): it is the accessible name, and
   * the short text is hidden from assistive technology.
   */
  fullLabel?: string | undefined;
  /**
   * The pill may shrink below its text: the label is cut with an ellipsis (a toolbar that must never
   * clip a control, REPORT-008 D12). The caller gives the full text in `title` or `fullLabel`. The icon never shrinks.
   */
  truncate?: boolean;
}

/** Pill with an icon and a text label. The text is always present: status is never color only. */
export function StatusPill({
  variant,
  icon,
  label,
  size = "default",
  className,
  title,
  fullLabel,
  truncate = false,
}: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      data-variant={variant}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill font-semibold",
        size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-sm",
        truncate && "min-w-0",
        STYLES[variant],
        className,
      )}
    >
      {icon ? <Icon name={icon} tone={ERROR_ICON.has(variant) ? "error" : "default"} /> : null}
      {fullLabel ? (
        <>
          <span aria-hidden="true" className={truncate ? "min-w-0 truncate" : undefined}>
            {label}
          </span>
          <span className="sr-only">{fullLabel}</span>
        </>
      ) : (
        <span className={truncate ? "min-w-0 truncate" : undefined}>{label}</span>
      )}
    </span>
  );
}
