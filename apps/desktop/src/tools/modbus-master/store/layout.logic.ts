// Pure layout helpers: clamping rules from DES-001 5.3.

export const DEFAULT_TRAFFIC_HEIGHT_PCT = 35;
export const MAX_TRAFFIC_HEIGHT_PCT = 70;
export const MIN_TRAFFIC_HEIGHT_PX = 120;
export const DEFAULT_VIEWPORT_HEIGHT_PX = 800;
/** Keyboard step of the splitter. */
export const SPLITTER_STEP_PX = 16;

/** Minimum widths in px (DES-001 5.3). Keys are `<table>.<column>`. */
export const COLUMN_MIN_WIDTHS: Readonly<Record<string, number>> = {
  "data.address": 72,
  "data.value": 96,
  "traffic.seq": 48,
  "traffic.time": 104,
  "traffic.dir": 56,
  "traffic.len": 40,
  "traffic.bytes": 160,
  "traffic.info": 120,
};

export const FALLBACK_MIN_COLUMN_WIDTH = 24;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Smallest traffic height as a percentage of the window: 120px. */
export function minTrafficHeightPct(viewportHeightPx: number): number {
  return Math.min((MIN_TRAFFIC_HEIGHT_PX / viewportHeightPx) * 100, MAX_TRAFFIC_HEIGHT_PCT);
}

/** Clamps a height in percent between 120px and 70% of the window. */
export function clampTrafficHeightPct(pct: number, viewportHeightPx: number): number {
  return clamp(pct, minTrafficHeightPct(viewportHeightPx), MAX_TRAFFIC_HEIGHT_PCT);
}

export function pxToPct(px: number, viewportHeightPx: number): number {
  return (px / viewportHeightPx) * 100;
}

export function pctToPx(pct: number, viewportHeightPx: number): number {
  return (pct / 100) * viewportHeightPx;
}

export function clampColumnWidth(id: string, px: number): number {
  return Math.max(COLUMN_MIN_WIDTHS[id] ?? FALLBACK_MIN_COLUMN_WIDTH, px);
}
