// Pure drag math of DES-002 2.10: move, resize, snapping, snap zones, swap, tile slots, list
// reorder, keyboard neighbors and pop-out mode. No DOM access: the drag controller feeds in
// rectangles from the store and pointer positions, and applies what these functions return.
import { containsPoint, type Rect, type Size } from "@/shared/lib/layout-math";

export interface Point {
  x: number;
  y: number;
}

export type Direction = "left" | "right" | "up" | "down";

/** Which edges of a rectangle a resize handle moves. */
export interface Edges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

/** A pointer must move this far before a press becomes a drag (DES-002 2.10). */
export const DRAG_THRESHOLD_PX = 4;
export const SNAP_THRESHOLD_PX = 8;
export const SNAP_GAP_PX = 8;
export const ZONE_MARGIN_PX = 24;
export const POP_OUT_THRESHOLD_PX = 48;

export function exceedsDragThreshold(
  from: Point,
  to: Point,
  threshold = DRAG_THRESHOLD_PX,
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= threshold;
}

export function moveRect(start: Rect, delta: Point): Rect {
  return { ...start, x: start.x + delta.x, y: start.y + delta.y };
}

/**
 * Resizes by moving the flagged edges by `delta`. The opposite edge stays fixed and the size never
 * goes below `min`. With `top >= 0` (the workspace top edge) the top edge cannot leave the
 * workspace (the title bar must stay reachable, DES-002 2.10.1).
 */
export function resizeRect(
  start: Rect,
  edges: Edges,
  delta: Point,
  min: Size,
  options: { minTop?: number } = {},
): Rect {
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;

  if (edges.left) left = Math.min(start.x + delta.x, right - min.width);
  if (edges.right) right = Math.max(start.x + start.width + delta.x, left + min.width);
  if (edges.top) {
    top = Math.min(start.y + delta.y, bottom - min.height);
    if (options.minTop !== undefined)
      top = Math.max(top, Math.min(options.minTop, bottom - min.height));
  }
  if (edges.bottom) bottom = Math.max(start.y + start.height + delta.y, top + min.height);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

// ---------------------------------------------------------------------------------------------
// Snapping (2.10.3)
// ---------------------------------------------------------------------------------------------

export interface SnapLine {
  at: number;
  source: "workspace" | "window";
  /** z-order of the window the line belongs to (workspace lines use 0). */
  z: number;
  /** A line at the 8 px tile gap from a window edge (not the edge itself, where windows touch). */
  gap?: boolean;
}

export interface SnapCandidates {
  /** Vertical lines (x positions). */
  x: SnapLine[];
  /** Horizontal lines (y positions). */
  y: SnapLine[];
}

/** A dashed guide drawn along the full length of the workspace. */
export interface Guide {
  /** `x`: a vertical line at `at`. `y`: a horizontal line at `at`. */
  axis: "x" | "y";
  at: number;
}

export interface SnapOther {
  rect: Rect;
  z: number;
}

/**
 * Candidate lines: the tile-area edges, and for every other visible sub-window its left, right,
 * top and bottom edges plus the same edges offset by the tile gap on both sides.
 */
export function buildSnapCandidates(
  area: Rect,
  others: readonly SnapOther[],
  gap = SNAP_GAP_PX,
): SnapCandidates {
  const x: SnapLine[] = [
    { at: area.x, source: "workspace", z: 0 },
    { at: area.x + area.width, source: "workspace", z: 0 },
  ];
  const y: SnapLine[] = [
    { at: area.y, source: "workspace", z: 0 },
    { at: area.y + area.height, source: "workspace", z: 0 },
  ];
  for (const { rect, z } of others) {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;
    for (const at of [left, right]) x.push({ at, source: "window", z });
    for (const at of [left - gap, left + gap, right - gap, right + gap]) {
      x.push({ at, source: "window", z, gap: true });
    }
    for (const at of [top, bottom]) y.push({ at, source: "window", z });
    for (const at of [top - gap, top + gap, bottom - gap, bottom + gap]) {
      y.push({ at, source: "window", z, gap: true });
    }
  }
  return { x, y };
}

interface AxisEdge<K extends string> {
  kind: K;
  position: number;
}

interface AxisSnap<K extends string> {
  kind: K;
  /** Distance the edge has to move to sit on the line. */
  shift: number;
  line: SnapLine;
}

/**
 * Tie order at equal distance (DES-002 2.10.3, D-002-10): the tile-area edge, then an edge where the
 * windows touch (offset 0) before a line at the 8 px gap, then the window higher in z-order.
 */
function tieRank(line: SnapLine): [number, number, number] {
  return [line.source === "workspace" ? 0 : 1, line.gap ? 1 : 0, -line.z];
}

function ranksBefore(a: SnapLine, b: SnapLine): boolean {
  const ra = tieRank(a);
  const rb = tieRank(b);
  for (let i = 0; i < ra.length; i += 1) {
    if ((ra[i] as number) !== (rb[i] as number)) return (ra[i] as number) < (rb[i] as number);
  }
  return false;
}

/** The nearest line within the threshold for the given edges; ties as in `tieRank`. */
function bestSnap<K extends string>(
  edges: ReadonlyArray<AxisEdge<K>>,
  lines: readonly SnapLine[],
  threshold: number,
): AxisSnap<K> | null {
  let best: (AxisSnap<K> & { distance: number }) | null = null;
  for (const edge of edges) {
    for (const line of lines) {
      const distance = Math.abs(line.at - edge.position);
      if (distance > threshold) continue;
      const better =
        best === null ||
        distance < best.distance ||
        (distance === best.distance && ranksBefore(line, best.line));
      if (better) best = { kind: edge.kind, shift: line.at - edge.position, line, distance };
    }
  }
  return best;
}

/** All four edges: a move. */
export const MOVE_EDGES: Edges = { left: true, right: true, top: true, bottom: true };

/**
 * Snaps a rectangle that is moving (all four edges) or being resized (only the flagged edges) to the
 * candidate lines. For a move the whole rectangle shifts; for a resize only the snapped edge moves,
 * so the opposite edge stays fixed (and `min` keeps the size from collapsing). At most one vertical
 * and one horizontal guide are returned.
 */
export function snapRect(
  rect: Rect,
  movingEdges: Edges,
  candidates: SnapCandidates,
  threshold = SNAP_THRESHOLD_PX,
  min: Size = { width: 1, height: 1 },
): { rect: Rect; guides: Guide[] } {
  const isMove = movingEdges.left && movingEdges.right && movingEdges.top && movingEdges.bottom;
  const xEdges: Array<AxisEdge<"left" | "right">> = [];
  if (movingEdges.left) xEdges.push({ kind: "left", position: rect.x });
  if (movingEdges.right) xEdges.push({ kind: "right", position: rect.x + rect.width });
  const yEdges: Array<AxisEdge<"top" | "bottom">> = [];
  if (movingEdges.top) yEdges.push({ kind: "top", position: rect.y });
  if (movingEdges.bottom) yEdges.push({ kind: "bottom", position: rect.y + rect.height });

  const snapX = bestSnap(xEdges, candidates.x, threshold);
  const snapY = bestSnap(yEdges, candidates.y, threshold);
  const guides: Guide[] = [];
  let { x, y, width, height } = rect;

  if (snapX) {
    guides.push({ axis: "x", at: snapX.line.at });
    if (isMove) x += snapX.shift;
    else if (snapX.kind === "left") {
      const right = x + width;
      x = Math.min(x + snapX.shift, right - min.width);
      width = right - x;
    } else {
      width = Math.max(min.width, width + snapX.shift);
    }
  }
  if (snapY) {
    guides.push({ axis: "y", at: snapY.line.at });
    if (isMove) y += snapY.shift;
    else if (snapY.kind === "top") {
      const bottom = y + height;
      y = Math.min(y + snapY.shift, bottom - min.height);
      height = bottom - y;
    } else {
      height = Math.max(min.height, height + snapY.shift);
    }
  }
  return { rect: { x, y, width, height }, guides };
}

// ---------------------------------------------------------------------------------------------
// Snap zones (2.10.3)
// ---------------------------------------------------------------------------------------------

export type SnapZone =
  | "left"
  | "right"
  | "full"
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight";

/** The zone under the pointer when it is within `margin` of the tile-area border, else null. */
export function snapZoneAt(pointer: Point, area: Rect, margin = ZONE_MARGIN_PX): SnapZone | null {
  if (
    pointer.x < area.x - margin ||
    pointer.x > area.x + area.width + margin ||
    pointer.y < area.y - margin ||
    pointer.y > area.y + area.height + margin
  ) {
    return null;
  }
  const nearLeft = pointer.x <= area.x + margin;
  const nearRight = pointer.x >= area.x + area.width - margin;
  const nearTop = pointer.y <= area.y + margin;
  const nearBottom = pointer.y >= area.y + area.height - margin;
  const horizontal = nearLeft || nearRight;
  const vertical = nearTop || nearBottom;
  if (horizontal && vertical) {
    if (nearTop) return nearLeft ? "topLeft" : "topRight";
    return nearLeft ? "bottomLeft" : "bottomRight";
  }
  if (nearLeft) return "left";
  if (nearRight) return "right";
  if (nearTop) return "full";
  return null;
}

/** The target rectangle of a zone (2.10.3 table). Halves and quarters leave `gap` between them. */
export function zoneRect(zone: SnapZone, area: Rect, gap = SNAP_GAP_PX): Rect {
  const halfW = Math.floor((area.width - gap) / 2);
  const halfH = Math.floor((area.height - gap) / 2);
  const rightX = area.x + Math.ceil((area.width + gap) / 2);
  const bottomY = area.y + Math.ceil((area.height + gap) / 2);
  switch (zone) {
    case "full":
      return { ...area };
    case "left":
      return { x: area.x, y: area.y, width: halfW, height: area.height };
    case "right":
      return { x: rightX, y: area.y, width: halfW, height: area.height };
    case "topLeft":
      return { x: area.x, y: area.y, width: halfW, height: halfH };
    case "topRight":
      return { x: rightX, y: area.y, width: halfW, height: halfH };
    case "bottomLeft":
      return { x: area.x, y: bottomY, width: halfW, height: halfH };
    case "bottomRight":
      return { x: rightX, y: bottomY, width: halfW, height: halfH };
  }
}

/** Announcement text of a zone drop (DES-002 2.10.8): "{name} moved to the {zone}." */
export const ZONE_LABELS: Record<SnapZone, string> = {
  left: "left half",
  right: "right half",
  full: "full workspace",
  topLeft: "top-left quarter",
  topRight: "top-right quarter",
  bottomLeft: "bottom-left quarter",
  bottomRight: "bottom-right quarter",
};

// ---------------------------------------------------------------------------------------------
// Swap, tile slots, list reorder (2.10.4 - 2.10.6)
// ---------------------------------------------------------------------------------------------

export interface TitleBarHit<Id> {
  id: Id;
  rect: Rect;
  z: number;
}

/** The sub-window whose title bar is under the pointer (highest z wins), excluding `selfId`. */
export function swapTargetAt<Id>(
  pointer: Point,
  titleBars: readonly TitleBarHit<Id>[],
  selfId: Id,
): Id | null {
  let best: TitleBarHit<Id> | null = null;
  for (const bar of titleBars) {
    if (bar.id === selfId || !containsPoint(bar.rect, pointer)) continue;
    if (best === null || bar.z > best.z) best = bar;
  }
  return best ? best.id : null;
}

/** The slot under the pointer; outside every slot, the slot with the nearest center. */
export function tileSlotAt(pointer: Point, slotRects: readonly Rect[]): number {
  const hit = slotRects.findIndex((r) => containsPoint(r, pointer));
  if (hit !== -1) return hit;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [i, r] of slotRects.entries()) {
    const d = Math.hypot(pointer.x - (r.x + r.width / 2), pointer.y - (r.y + r.height / 2));
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/** `order` without `id`, then `id` inserted so that it ends up at `index`. */
export function insertAt<T>(order: readonly T[], id: T, index: number): T[] {
  const without = order.filter((x) => x !== id);
  const at = Math.max(0, Math.min(without.length, index));
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/**
 * Tile mode reorder (2.10.5): `id` moves to slot `index` among the tiled windows `subset`.
 * The tiled windows keep the places they have in the full list order; only their order among
 * themselves changes, so windows that are not tiled (minimized, closed, native) stay where they are.
 */
export function insertAmongSubset<T>(
  order: readonly T[],
  subset: readonly T[],
  id: T,
  index: number,
): T[] {
  const inSubset = new Set(subset);
  const nextSubset = insertAt(subset, id, index);
  let k = 0;
  return order.map((item) => (inSubset.has(item) ? (nextSubset[k++] as T) : item));
}

/**
 * A poll that is not tiled yet (closed, in its own window, minimized) is dropped on slot `index`
 * of the tile grid it joins (DES-002 2.10.7, tile mode): it ends up right before the window that
 * has that slot now, or after the last tiled window. With nobody tiled the order is unchanged.
 * `subset` are the tiled windows, in order; `id` may or may not be one of them.
 */
export function placeInSubset<T>(
  order: readonly T[],
  subset: readonly T[],
  id: T,
  index: number,
): T[] {
  const members = subset.filter((x) => x !== id);
  if (members.length === 0) return [...order];
  const without = order.filter((x) => x !== id);
  const at = Math.max(0, Math.min(members.length, index));
  const before = at < members.length ? without.indexOf(members[at] as T) : -1;
  const position = before === -1 ? without.indexOf(members[members.length - 1] as T) + 1 : before;
  return [...without.slice(0, position), id, ...without.slice(position)];
}

/** Exchanges the places of `a` and `b` in `order`. */
export function swapInOrder<T>(order: readonly T[], a: T, b: T): T[] {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia === -1 || ib === -1 || ia === ib) return [...order];
  const out = [...order];
  out[ia] = b;
  out[ib] = a;
  return out;
}

/** A release this close above the first row or below the last row still targets the list (PM, Q-FE2-13). */
export const LIST_DROP_TOLERANCE = 16;

/** The list rectangle grown by `px` above and below: where a release still lands in the list. */
export function listDropZone(list: Rect, px: number = LIST_DROP_TOLERANCE): Rect {
  return { x: list.x, y: list.y - px, width: list.width, height: list.height + 2 * px };
}

/**
 * The insertion gap nearest to the pointer's y. Gap `i` is the boundary before row `i`; gap `n` is
 * the boundary after the last row. Rows are in list order, top to bottom.
 */
export function listInsertIndex(pointerY: number, rowRects: readonly Rect[]): number {
  const n = rowRects.length;
  if (n === 0) return 0;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let gap = 0; gap <= n; gap += 1) {
    const before = rowRects[gap - 1];
    const after = rowRects[gap];
    const y =
      before && after
        ? (before.y + before.height + after.y) / 2
        : after
          ? after.y
          : (before as Rect).y + (before as Rect).height;
    const d = Math.abs(pointerY - y);
    if (d < bestDistance) {
      bestDistance = d;
      best = gap;
    }
  }
  return best;
}

export const AUTO_SCROLL_BAND_PX = 24;
export const AUTO_SCROLL_STEP_PX = 8;

/**
 * How far the poll list scrolls in one animation frame while a row is dragged (DES-002 2.10.6):
 * 8 px up when the pointer is within 24 px of the top edge, 8 px down within 24 px of the bottom
 * edge, else 0. The pointer must be over the list's column; the band reaches 24 px beyond the edge.
 */
export function autoScrollDelta(
  pointer: Point,
  list: Rect,
  band = AUTO_SCROLL_BAND_PX,
  step = AUTO_SCROLL_STEP_PX,
): number {
  if (pointer.x < list.x || pointer.x > list.x + list.width) return 0;
  const top = list.y;
  const bottom = list.y + list.height;
  if (pointer.y >= top - band && pointer.y <= top + band) return -step;
  if (pointer.y >= bottom - band && pointer.y <= bottom + band) return step;
  return 0;
}

/** The final index of an item dragged from `from` to the insertion gap `gap`. */
export function gapToIndex(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

/** Moves the item at `from` so that it ends up at index `to`. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item as T);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Keyboard: neighbors (2.10.8)
// ---------------------------------------------------------------------------------------------

const DIRECTION_VECTOR: Record<Direction, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

/**
 * The neighbor in a direction for `Ctrl+Shift+Arrow`: among the windows whose center lies within a
 * 90 degree cone around the direction, the one with the smallest center distance.
 */
export function neighborInDirection<Id>(
  activeRect: Rect,
  others: ReadonlyArray<{ id: Id; rect: Rect }>,
  dir: Direction,
): Id | null {
  const v = DIRECTION_VECTOR[dir];
  const from = { x: activeRect.x + activeRect.width / 2, y: activeRect.y + activeRect.height / 2 };
  let best: Id | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const other of others) {
    const dx = other.rect.x + other.rect.width / 2 - from.x;
    const dy = other.rect.y + other.rect.height / 2 - from.y;
    const along = dx * v.x + dy * v.y;
    const across = Math.abs(dx * v.y - dy * v.x);
    if (along <= 0 || across > along) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = other.id;
    }
  }
  return best;
}

/** Tile mode: the adjacent slot (row-major, `cols` columns, `n` slots) or null. */
export function adjacentSlot(
  index: number,
  cols: number,
  n: number,
  dir: Direction,
): number | null {
  if (cols < 1 || index < 0 || index >= n) return null;
  const col = index % cols;
  let target: number;
  switch (dir) {
    case "left":
      if (col === 0) return null;
      target = index - 1;
      break;
    case "right":
      if (col === cols - 1) return null;
      target = index + 1;
      break;
    case "up":
      target = index - cols;
      break;
    case "down":
      target = index + cols;
      break;
  }
  return target >= 0 && target < n ? target : null;
}

// ---------------------------------------------------------------------------------------------
// Pop-out mode and maximized drag (2.10.1, 2.10.7)
// ---------------------------------------------------------------------------------------------

/**
 * True when the pointer left the workspace rectangle by more than `threshold` px, or left the
 * window client area (the drag then pops the poll out).
 */
export function popOutModeFor(
  pointer: Point,
  workspaceRect: Rect,
  clientRect: Rect,
  threshold = POP_OUT_THRESHOLD_PX,
): boolean {
  const inside = (r: Rect) =>
    pointer.x >= r.x &&
    pointer.x <= r.x + r.width &&
    pointer.y >= r.y &&
    pointer.y <= r.y + r.height;
  if (!inside(clientRect)) return true;
  const dx = Math.max(
    workspaceRect.x - pointer.x,
    0,
    pointer.x - (workspaceRect.x + workspaceRect.width),
  );
  const dy = Math.max(
    workspaceRect.y - pointer.y,
    0,
    pointer.y - (workspaceRect.y + workspaceRect.height),
  );
  return Math.max(dx, dy) > threshold;
}

/**
 * Dragging a maximized sub-window restores it first, placed so that the pointer keeps the same
 * relative x position on the title bar (Windows behavior). `maximizedRect` is the rectangle it had
 * while maximized; the title bar stays at its top.
 */
export function restoreFromMaximizedForDrag(
  normalRect: Rect,
  pointer: Point,
  maximizedRect: Rect,
): Rect {
  const relative =
    maximizedRect.width > 0 ? (pointer.x - maximizedRect.x) / maximizedRect.width : 0.5;
  const clamped = Math.max(0, Math.min(1, relative));
  return {
    x: Math.round(pointer.x - clamped * normalRect.width),
    y: maximizedRect.y,
    width: normalRect.width,
    height: normalRect.height,
  };
}
