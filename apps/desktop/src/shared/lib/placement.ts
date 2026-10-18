// Window placement restore rule (DES-002 2.13). Pure.
import type { LogicalRect, MonitorInfo, WindowPlacement } from "@/shared/ipc/modbus-master.types";

/** A saved rectangle must overlap its monitor's work area by at least this much. */
export const MIN_VISIBLE = { width: 100, height: 60 } as const;
const CASCADE_STEP = 24;

export function intersection(a: LogicalRect, b: LogicalRect): LogicalRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * Cascade fallback: 24 px steps from the connection window's top-left, wrapping to the work area's
 * top-left + 24 px when the step would leave the work area. `n` counts the windows already placed.
 */
export function cascadePlacement(
  anchor: LogicalRect,
  n: number,
  size: { width: number; height: number },
  workArea: LogicalRect,
  monitor: string,
): WindowPlacement {
  let x = anchor.x + CASCADE_STEP * n;
  let y = anchor.y + CASCADE_STEP * n;
  const fitsRight = x + MIN_VISIBLE.width <= workArea.x + workArea.width;
  const fitsBottom = y + MIN_VISIBLE.height <= workArea.y + workArea.height;
  if (!fitsRight || !fitsBottom) {
    const wrapped = (n % 10) + 1;
    x = workArea.x + CASCADE_STEP * wrapped;
    y = workArea.y + CASCADE_STEP * wrapped;
  }
  return { x, y, width: size.width, height: size.height, maximized: false, monitor };
}

export interface RestoredPlacement {
  placement: WindowPlacement;
  /** False when the saved placement could not be used and `fallback` was returned. */
  restored: boolean;
}

/**
 * The saved monitor must exist (matched by id or name) and the rectangle must intersect its work
 * area by at least 100 x 60 px; otherwise `fallback` (the cascade placement on the connection
 * window's monitor) is used. A maximized placement restores maximized.
 */
export function restorePlacement(
  saved: WindowPlacement | null,
  monitors: readonly MonitorInfo[],
  fallback: WindowPlacement,
): RestoredPlacement {
  if (saved === null) return { placement: fallback, restored: false };
  const monitor = monitors.find((m) => m.id === saved.monitor || m.name === saved.monitor);
  if (!monitor) return { placement: fallback, restored: false };
  const overlap = intersection(saved, monitor.workArea);
  if (!overlap || overlap.width < MIN_VISIBLE.width || overlap.height < MIN_VISIBLE.height) {
    return { placement: fallback, restored: false };
  }
  return { placement: { ...saved }, restored: true };
}
