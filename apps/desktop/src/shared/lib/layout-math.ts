// Pure layout math of DES-002 2.8 (tile, side by side, stacked, cascade), 2.4 (new sub-window slot)
// and 2.10.1 (clamping). No DOM, no store, no IPC: the workspace and the fake backend (arrange of
// native windows) share these functions, and the Rust backend implements the same rules.
import type { LogicalRect, MonitorInfo } from "@/shared/ipc/modbus-master.types";

export type Rect = LogicalRect;
export interface Size {
  width: number;
  height: number;
}

/** DES-002 2.8: the numbers that differ between the workspace and native windows. */
export const WORKSPACE_ARRANGE = {
  gap: 8,
  min: { width: 320, height: 180 },
  defaultSize: { width: 640, height: 368 },
} as const;
export const NATIVE_ARRANGE = {
  gap: 0,
  min: { width: 480, height: 320 },
  defaultSize: { width: 900, height: 640 },
} as const;

/** Cascade step in px (2.8.4). */
export const CASCADE_STEP = 24;
/** A cascade wraps after this many windows and shifts right by `CASCADE_COLUMN_SHIFT`. */
export const CASCADE_WRAP = 10;
export const CASCADE_COLUMN_SHIFT = 240;
/** Part of a sub-window title bar that must stay inside the workspace (2.10.1). */
export const TITLE_BAR_VISIBLE = { width: 80, height: 30 } as const;
export const WORKSPACE_PADDING = 8;

export interface GridResult {
  /** One rectangle per window, in input order (tiled windows first, then the cascaded overflow). */
  rects: Rect[];
  /** How many windows did not fit and were cascaded. */
  overflow: number;
  /** How many windows got a grid cell. */
  tiled: number;
  cols: number;
  rows: number;
}

const EMPTY: GridResult = { rects: [], overflow: 0, tiled: 0, cols: 0, rows: 0 };

function maxColsFor(area: Rect, gap: number, min: Size): number {
  return Math.max(1, Math.floor((area.width + gap) / (min.width + gap)));
}
function maxRowsFor(area: Rect, gap: number, min: Size): number {
  return Math.max(1, Math.floor((area.height + gap) / (min.height + gap)));
}

/** Steps 4 to 8 of DES-002 2.8.1, shared by tile, side by side and stacked. */
function gridRects(n: number, area: Rect, gap: number, cols: number, rows: number): GridResult {
  const tiled = Math.min(n, cols * rows);
  const cellW = Math.floor((area.width - (cols - 1) * gap) / cols);
  const cellH = Math.floor((area.height - (rows - 1) * gap) / rows);
  const remainderW = area.width - (cols * cellW + (cols - 1) * gap);
  const remainderH = area.height - (rows * cellH + (rows - 1) * gap);
  const lastRow = Math.ceil(tiled / cols) - 1;
  const rects: Rect[] = [];

  for (let i = 0; i < tiled; i += 1) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // The last row shares the full width when it is not full (step 6); remainder pixels go to
    // its last window (step 7).
    const inRow = r === lastRow ? tiled - lastRow * cols : cols;
    const full = inRow === cols;
    const w = full ? cellW : Math.floor((area.width - (inRow - 1) * gap) / inRow);
    const remainder = full ? remainderW : area.width - (inRow * w + (inRow - 1) * gap);
    rects.push({
      x: area.x + c * (w + gap),
      y: area.y + r * (cellH + gap),
      width: w + (c === inRow - 1 ? remainder : 0),
      height: cellH + (r === rows - 1 ? remainderH : 0),
    });
  }

  // Step 8: what did not fit is cascaded from the top-left corner, on top of the tiles.
  const overflow = n - tiled;
  for (let j = 0; j < overflow; j += 1) {
    rects.push({
      x:
        area.x +
        CASCADE_STEP * (j % CASCADE_WRAP) +
        CASCADE_COLUMN_SHIFT * Math.floor(j / CASCADE_WRAP),
      y: area.y + CASCADE_STEP * (j % CASCADE_WRAP),
      width: cellW,
      height: cellH,
    });
  }
  return { rects, overflow, tiled, cols, rows };
}

/** DES-002 2.8.1 (WT, NT). `n` windows in `area` with `gap`, each at least `min`. */
export function tileRects(n: number, area: Rect, gap: number, min: Size): GridResult {
  if (n <= 0) return EMPTY;
  const maxCols = maxColsFor(area, gap, min);
  const maxRows = maxRowsFor(area, gap, min);
  let cols = Math.min(maxCols, Math.ceil(Math.sqrt(n)));
  let rows = Math.ceil(n / cols);
  if (rows > maxRows) {
    cols = maxCols;
    rows = Math.min(maxRows, Math.ceil(n / cols));
  }
  return gridRects(n, area, gap, cols, rows);
}

/** DES-002 2.8.2 (NS): one row of columns. */
export function sideBySideRects(n: number, area: Rect, gap: number, min: Size): GridResult {
  if (n <= 0) return EMPTY;
  const cols = Math.min(n, maxColsFor(area, gap, min));
  return gridRects(n, area, gap, cols, 1);
}

/** DES-002 2.8.3 (NK): one column of rows. */
export function stackedRects(n: number, area: Rect, gap: number, min: Size): GridResult {
  if (n <= 0) return EMPTY;
  const rows = Math.min(n, maxRowsFor(area, gap, min));
  return gridRects(n, area, gap, 1, rows);
}

/** DES-002 2.8.4 (WC, NC). Window i is at `area` top-left + 24 px steps, wrapping after 10. */
export function cascadeRects(n: number, area: Rect, min: Size, defaultSize: Size): Rect[] {
  if (n <= 0) return [];
  const m = Math.min(n, CASCADE_WRAP);
  const width = Math.max(
    min.width,
    Math.min(defaultSize.width, area.width - CASCADE_STEP * (m - 1)),
  );
  const height = Math.max(
    min.height,
    Math.min(defaultSize.height, area.height - CASCADE_STEP * (m - 1)),
  );
  return Array.from({ length: n }, (_, i) => ({
    x:
      area.x +
      CASCADE_STEP * (i % CASCADE_WRAP) +
      CASCADE_COLUMN_SHIFT * Math.floor(i / CASCADE_WRAP),
    y: area.y + CASCADE_STEP * (i % CASCADE_WRAP),
    width,
    height,
  }));
}

/**
 * DES-002 2.4 "New sub-window placement" in free mode: the next cascade slot. `k` is the number of
 * visible, non-minimized sub-windows; the default size is clamped to the tile area.
 */
export function nextSlot(k: number, area: Rect, defaultSize: Size): Rect {
  const step = CASCADE_STEP * (Math.max(0, k) % CASCADE_WRAP);
  return {
    x: area.x + step,
    y: area.y + step,
    width: Math.min(defaultSize.width, area.width),
    height: Math.min(defaultSize.height, area.height),
  };
}

/**
 * DES-002 2.10.1: at least 80 x 30 px of the title bar stays inside the workspace.
 * `x` in [80 - w, W - 80], `y` in [0, H - 30]. The size is not changed.
 */
export function clampRect(rect: Rect, workspace: Size): Rect {
  const minX = TITLE_BAR_VISIBLE.width - rect.width;
  const maxX = workspace.width - TITLE_BAR_VISIBLE.width;
  const maxY = workspace.height - TITLE_BAR_VISIBLE.height;
  const x = Math.max(minX, Math.min(maxX, rect.x));
  const y = Math.max(0, Math.min(maxY, rect.y));
  return x === rect.x && y === rect.y ? rect : { ...rect, x, y };
}

/** Raises a rectangle to the minimum size, keeping its top-left corner. */
export function clampMin(rect: Rect, min: Size): Rect {
  const width = Math.max(rect.width, min.width);
  const height = Math.max(rect.height, min.height);
  return width === rect.width && height === rect.height ? rect : { ...rect, width, height };
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function containsPoint(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}

// ---------------------------------------------------------------------------------------------
// Native windows: arrange targets (DES-002 2.8.5)
// ---------------------------------------------------------------------------------------------

export interface NativeWindow {
  id: number;
  rect: Rect;
}

export interface MonitorGroup {
  monitor: MonitorInfo;
  windows: NativeWindow[];
}

function distanceToRect(p: { x: number; y: number }, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/**
 * "Each monitor (in place)": groups windows by the monitor whose work area contains the window's
 * center. A center that is in no work area (for example over a taskbar) goes to the nearest one.
 * Groups follow the monitor order, windows keep their input order; monitors without windows are
 * left out.
 */
export function groupByMonitor(
  windows: readonly NativeWindow[],
  monitors: readonly MonitorInfo[],
): MonitorGroup[] {
  const groups = monitors.map((monitor) => ({ monitor, windows: [] as NativeWindow[] }));
  for (const w of windows) {
    const c = center(w.rect);
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [i, m] of monitors.entries()) {
      const d = distanceToRect(c, m.workArea);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    groups[best]?.windows.push(w);
  }
  return groups.filter((g) => g.windows.length > 0);
}

export type NativeLayout = "tile" | "sideBySide" | "stacked" | "cascade";
export interface NativePlacement {
  id: number;
  rect: Rect;
  monitorId: string;
}
export interface NativeArrangement {
  placements: NativePlacement[];
  /** Windows that got a grid cell (all windows for a cascade). */
  arranged: number;
  /** Windows that did not fit and were cascaded. */
  overflow: number;
}

/**
 * DES-002 2.8.5: arranges the native windows (already sorted by list order) either on each
 * monitor in place (`target = null`) or all on one monitor.
 */
export function arrangeNative(
  layout: NativeLayout,
  windows: readonly NativeWindow[],
  monitors: readonly MonitorInfo[],
  target: MonitorInfo | null,
): NativeArrangement {
  const groups: MonitorGroup[] =
    target === null
      ? groupByMonitor(windows, monitors)
      : windows.length > 0
        ? [{ monitor: target, windows: [...windows] }]
        : [];
  const { gap, min, defaultSize } = NATIVE_ARRANGE;
  const placements: NativePlacement[] = [];
  let arranged = 0;
  let overflow = 0;
  for (const { monitor, windows: group } of groups) {
    const area = monitor.workArea;
    const n = group.length;
    if (layout === "cascade") {
      const rects = cascadeRects(n, area, min, defaultSize);
      group.forEach((w, i) => {
        const rect = rects[i];
        if (rect) placements.push({ id: w.id, rect, monitorId: monitor.id });
      });
      arranged += n;
      continue;
    }
    const result =
      layout === "tile"
        ? tileRects(n, area, gap, min)
        : layout === "sideBySide"
          ? sideBySideRects(n, area, gap, min)
          : stackedRects(n, area, gap, min);
    group.forEach((w, i) => {
      const rect = result.rects[i];
      if (rect) placements.push({ id: w.id, rect, monitorId: monitor.id });
    });
    arranged += result.tiled;
    overflow += result.overflow;
  }
  return { placements, arranged, overflow };
}
