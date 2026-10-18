import { useRef } from "react";
import { cn } from "@/shared/lib/utils";

interface ResizeSeparatorProps {
  /** `vertical` is a handle between left and right (drag horizontally), `horizontal` between top and bottom. */
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  /** Positive `delta` grows the panel the handle belongs to. Called while dragging and on keys. */
  onResize(valuePx: number): void;
  /** The action is over (pointer released, key pressed): report it. */
  onCommit(): void;
  /** px per key press (16, DES-002 2.2.3 and DES-001 5.3). */
  step?: number;
  onReset?(): void;
  /** Dragging towards the start (left or up) grows the panel (the traffic panel below the workspace). */
  growsTowardsStart?: boolean;
  className?: string;
}

/**
 * A focusable `separator` that resizes a panel by pointer or by arrow keys (16 px per press). Used
 * by the sidebar (6 px, `Left` and `Right`) and the traffic panel (`Up` and `Down`).
 */
export function ResizeSeparator({
  orientation,
  label,
  value,
  min,
  max,
  onResize,
  onCommit,
  step = 16,
  onReset,
  growsTowardsStart = false,
  className,
}: ResizeSeparatorProps) {
  const drag = useRef<{ start: number; startValue: number } | null>(null);
  const horizontal = orientation === "horizontal";
  const sign = growsTowardsStart ? -1 : 1;

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-testid={`separator-${label}`}
      className={cn(
        "shrink-0 touch-none rounded-pill bg-border outline-none hover:bg-dark/25 focus-ring",
        horizontal ? "h-1.5 cursor-row-resize" : "w-1.5 cursor-col-resize",
        className,
      )}
      onPointerDown={(e) => {
        drag.current = { start: horizontal ? e.clientY : e.clientX, startValue: value };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const now = horizontal ? e.clientY : e.clientX;
        onResize(d.startValue + sign * (now - d.start));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        onCommit();
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const grow = horizontal ? "ArrowUp" : "ArrowRight";
        const shrink = horizontal ? "ArrowDown" : "ArrowLeft";
        const dir = e.key === grow ? 1 : e.key === shrink ? -1 : 0;
        if (dir === 0) return;
        e.preventDefault();
        onResize(value + dir * step);
        onCommit();
      }}
    />
  );
}
