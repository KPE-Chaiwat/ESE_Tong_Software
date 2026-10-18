// An independent implementation of the DES-002 2.8 native arrange algorithms (NT, NS, NK, NC), written from the
// design text only (not from the product code), used as the oracle for the real windows. Logical px, g = 0.
export interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Layout = "tile" | "sideBySide" | "stacked" | "cascade";

const MIN = { w: 480, h: 320 };
const DEFAULT = { w: 900, h: 640 };

function cascade(area: R, count: number, startIndex: number, size?: { w: number; h: number }): R[] {
  const s = 24;
  const m = Math.min(count, 10);
  const w = size?.w ?? Math.max(MIN.w, Math.min(DEFAULT.w, area.w - s * (m - 1)));
  const h = size?.h ?? Math.max(MIN.h, Math.min(DEFAULT.h, area.h - s * (m - 1)));
  const out: R[] = [];
  for (let k = 0; k < count; k += 1) {
    const i = startIndex + k;
    out.push({ x: area.x + s * (i % 10) + 240 * Math.floor(i / 10), y: area.y + s * (i % 10), w, h });
  }
  return out;
}

/** The rectangles for n windows in list order on `area`; `overflow` windows are cascaded (on top of the tiles). */
export function arrange(layout: Layout, area: R, n: number): { rects: R[]; tiled: number; overflow: number } {
  if (n === 0) return { rects: [], tiled: 0, overflow: 0 };
  if (layout === "cascade") return { rects: cascade(area, n, 0), tiled: n, overflow: 0 };
  const maxCols = Math.max(1, Math.floor(area.w / MIN.w));
  const maxRows = Math.max(1, Math.floor(area.h / MIN.h));
  let cols: number;
  let rows: number;
  if (layout === "tile") {
    cols = Math.min(maxCols, Math.ceil(Math.sqrt(n)));
    rows = Math.ceil(n / cols);
    if (rows > maxRows) {
      cols = maxCols;
      rows = Math.min(maxRows, Math.ceil(n / cols));
    }
  } else if (layout === "sideBySide") {
    cols = Math.min(n, maxCols);
    rows = 1;
  } else {
    rows = Math.min(n, maxRows);
    cols = 1;
  }
  const tiled = Math.min(n, cols * rows);
  const cellW = Math.floor(area.w / cols);
  const cellH = Math.floor(area.h / rows);
  const rects: R[] = [];
  const lastRow = Math.floor((tiled - 1) / cols);
  const lastCount = tiled - lastRow * cols; // windows in the last row that holds windows
  for (let i = 0; i < tiled; i += 1) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    let x = area.x + c * cellW;
    let w = c === cols - 1 ? area.w - c * cellW : cellW;
    if (r === lastRow && lastCount < cols) {
      const share = Math.floor(area.w / lastCount);
      x = area.x + c * share;
      w = c === lastCount - 1 ? area.w - c * share : share;
    }
    const h = r === rows - 1 ? area.h - r * cellH : cellH;
    rects.push({ x, y: area.y + r * cellH, w, h });
  }
  const overflow = n - tiled;
  if (overflow > 0) rects.push(...cascade(area, overflow, 0, { w: cellW, h: cellH }));
  return { rects, tiled, overflow };
}

/** Logical rectangle to physical px by edges (REV-004: no 1 px gaps or overlaps at 125 % / 150 %). */
export function toPhysical(r: R, scale: number): R {
  const x0 = Math.round(r.x * scale);
  const y0 = Math.round(r.y * scale);
  const x1 = Math.round((r.x + r.w) * scale);
  const y1 = Math.round((r.y + r.h) * scale);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const overlaps = (a: R, b: R): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
