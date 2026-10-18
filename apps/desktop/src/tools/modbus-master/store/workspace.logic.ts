// Pure logic of the workspace (DES-002 2.3, 2.4, 2.8, 2.10.1, FE-002 tasks 13 and 14): sub-window
// items, z-order, maximize and minimize rules, tiling, cascading, clamping and the conversion to and
// from `WorkspaceLayout`. No React, no IPC, no store: the store calls these functions.
//
// All rectangles are in workspace coordinates (the inner area of the workspace, origin top-left).
// Every function returns the items it was given when nothing changed, so an unchanged sub-window
// keeps its object identity and its frame does not re-render.
import type {
  GridRect,
  PollId,
  PollSummary,
  SubWindowState,
  WorkspaceLayout,
  WorkspaceRect,
} from "@/shared/ipc/modbus-master.types";
import {
  cascadeRects,
  clampMin,
  clampRect,
  nextSlot,
  type Rect,
  rectsEqual,
  type Size,
  tileRects,
  WORKSPACE_ARRANGE,
  WORKSPACE_PADDING,
} from "@/shared/lib/layout-math";

/** Height of the minimized bar (DES-002 2.2.4). */
export const MINIMIZED_BAR_HEIGHT = 44;
/** The tile area leaves the bar's height plus the 8 px gap free (DES-002 2.4, 2.8). */
export const MINIMIZED_BAR_RESERVE = MINIMIZED_BAR_HEIGHT + WORKSPACE_PADDING;
/** Height of a sub-window title bar (DES-002 2.3.1). */
export const TITLE_BAR_HEIGHT = 30;

export const SIDEBAR_WIDTH_RANGE = { min: 220, max: 400, default: 280 } as const;
/** The traffic panel is at least this high (px) and at most 70% of the window (DES-001 5.3). */
export const TRAFFIC_MIN_HEIGHT = 120;
export const TRAFFIC_MAX_FRACTION = 0.7;
export const TRAFFIC_DEFAULT_FRACTION = 0.35;

export interface SubWindowItem {
  /** The current rectangle. A maximized item has the tile area here. */
  rect: Rect;
  /** Integer, higher = in front. Unique among the items. */
  z: number;
  state: SubWindowState;
  /** The normal rectangle while maximized, else null. */
  restore: Rect | null;
  grid?: GridRect | null;
}

export type SubWindowItems = Record<PollId, SubWindowItem>;

const MIN = WORKSPACE_ARRANGE.min;

// ---------------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------------

/**
 * The tile area: the workspace inner size minus the 8 px padding on every side, minus the minimized
 * bar and a gap when the bar is shown (DES-002 2.2.4, 2.8).
 */
export function tileAreaOf(size: Size, minimizedBarVisible: boolean): Rect {
  const pad = WORKSPACE_PADDING;
  return {
    x: pad,
    y: pad,
    width: Math.max(0, size.width - 2 * pad),
    height: Math.max(0, size.height - 2 * pad - (minimizedBarVisible ? MINIMIZED_BAR_RESERVE : 0)),
  };
}

export function sizeKnown(size: Size): boolean {
  return size.width > 0 && size.height > 0;
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

export function idsByZ(items: SubWindowItems): PollId[] {
  return Object.keys(items)
    .map(Number)
    .sort((a, b) => (items[a] as SubWindowItem).z - (items[b] as SubWindowItem).z || a - b);
}

/** Non-minimized sub-windows from back to front. */
export function visibleIds(items: SubWindowItems): PollId[] {
  return idsByZ(items).filter((id) => (items[id] as SubWindowItem).state !== "minimized");
}

export function maximizedIdOf(items: SubWindowItems): PollId | null {
  for (const id of idsByZ(items)) {
    if ((items[id] as SubWindowItem).state === "maximized") return id;
  }
  return null;
}

/** The frontmost non-minimized sub-window, optionally leaving one out. */
export function topVisibleId(items: SubWindowItems, except: PollId | null = null): PollId | null {
  const ids = visibleIds(items).filter((id) => id !== except);
  return ids.length > 0 ? (ids[ids.length - 1] as PollId) : null;
}

/** List order of the polls that are in `items` and not minimized. */
export function tiledIds(items: SubWindowItems, listOrder: readonly PollId[]): PollId[] {
  return listOrder.filter((id) => items[id] !== undefined && items[id]?.state !== "minimized");
}

// ---------------------------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------------------------

/** The next free z above every item. */
export function topZ(items: SubWindowItems): number {
  let max = 0;
  for (const item of Object.values(items)) max = Math.max(max, item.z);
  return max + 1;
}

/** Renumbers z to 1..n in the current z-order (duplicates are broken by poll id). */
export function renumberZ(items: SubWindowItems): SubWindowItems {
  const ids = idsByZ(items);
  const next: SubWindowItems = { ...items };
  let changed = false;
  ids.forEach((id, i) => {
    const item = items[id] as SubWindowItem;
    if (item.z !== i + 1) {
      next[id] = { ...item, z: i + 1 };
      changed = true;
    }
  });
  return changed ? next : items;
}

/**
 * The z values stay below this: the overlay layers (guides, ghost, drop previews) sit at fixed
 * z-indexes above 100000, and frames must never reach them (REV-006 n-6).
 */
export const MAX_Z = 10000;

/** Brings a sub-window to the front. */
export function raise(items: SubWindowItems, id: PollId): SubWindowItems {
  const item = items[id];
  if (!item || idsByZ(items).at(-1) === id) return items;
  const base = topZ(items) > MAX_Z ? renumberZ(items) : items;
  return { ...base, [id]: { ...(base[id] as SubWindowItem), z: topZ(base) } };
}

// ---------------------------------------------------------------------------------------------
// State changes of one sub-window
// ---------------------------------------------------------------------------------------------

/** Back to the normal rectangle (from maximized or minimized). */
export function restoreItem(item: SubWindowItem): SubWindowItem {
  if (item.state === "maximized") {
    return { ...item, rect: item.restore ?? item.rect, state: "normal", restore: null };
  }
  if (item.state === "minimized") return { ...item, state: "normal" };
  return item;
}

export function maximizeItem(item: SubWindowItem, area: Rect): SubWindowItem {
  if (item.state === "maximized") return item;
  return { ...item, restore: item.rect, rect: { ...area }, state: "maximized" };
}

export function minimizeItem(item: SubWindowItem): SubWindowItem {
  if (item.state === "minimized") return item;
  // A maximized window goes back to its normal rectangle first, so restoring it later is plain.
  const normal = restoreItem(item);
  return { ...normal, state: "minimized" };
}

/** Maximized items follow the tile area. */
export function fitMaximized(items: SubWindowItems, area: Rect): SubWindowItems {
  let next: SubWindowItems | null = null;
  for (const [key, item] of Object.entries(items)) {
    if (item.state === "maximized" && !rectsEqual(item.rect, area)) {
      next ??= { ...items };
      next[Number(key)] = { ...item, rect: { ...area } };
    }
  }
  return next ?? items;
}

/**
 * Clamps every rectangle after a size change or a load (DES-002 2.10.1): at least 80 x 30 px of the
 * title bar stays inside, and the size is at least 320 x 180. Rectangles that are still valid are
 * not touched. `size` unknown (not measured yet) leaves the items alone.
 */
export function clampItems(items: SubWindowItems, size: Size, area: Rect): SubWindowItems {
  if (!sizeKnown(size)) return items;
  let next: SubWindowItems | null = null;
  for (const [key, item] of Object.entries(items)) {
    let updated = item;
    if (item.state === "maximized") {
      const restore = item.restore ? clampRect(clampMin(item.restore, MIN), size) : null;
      if (!rectsEqual(item.rect, area) || restore !== item.restore) {
        updated = { ...item, rect: { ...area }, restore };
      }
    } else {
      const rect = clampRect(clampMin(item.rect, MIN), size);
      if (rect !== item.rect) updated = { ...item, rect };
    }
    if (updated !== item) {
      next ??= { ...items };
      next[Number(key)] = updated;
    }
  }
  return next ?? items;
}

/**
 * Exchanges the rectangles of two visible sub-windows (DES-002 2.10.4). A maximized one is restored
 * first, so both end up normal.
 */
export function swapItems(items: SubWindowItems, a: PollId, b: PollId): SubWindowItems {
  const first = items[a];
  const second = items[b];
  if (!first || !second || a === b) return items;
  const left = restoreMaximized(first);
  const right = restoreMaximized(second);
  return {
    ...items,
    [a]: { ...left, rect: right.rect },
    [b]: { ...right, rect: left.rect },
  };
}

function restoreMaximized(item: SubWindowItem): SubWindowItem {
  return item.state === "maximized" ? restoreItem(item) : item;
}

/** True when both hold the very same item objects (nothing changed). */
export function itemsEqual(a: SubWindowItems, b: SubWindowItems): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[Number(k)] === b[Number(k)]);
}

/** `next` when something changed, else `prev`, so unchanged results keep their identity. */
function reuse(prev: SubWindowItems, next: SubWindowItems): SubWindowItems {
  return itemsEqual(prev, next) ? prev : next;
}

// ---------------------------------------------------------------------------------------------
// Arrange: tile, cascade (DES-002 2.8)
// ---------------------------------------------------------------------------------------------

export interface ArrangeOutcome {
  items: SubWindowItems;
  /** Windows that did not fit and were cascaded (tile only). */
  overflow: number;
  /** Windows that got a grid cell. */
  tiled: number;
  /** Columns of the grid, for the keyboard neighbor in tile mode. */
  cols: number;
}

/**
 * Tile (DES-002 2.8.1). The non-minimized sub-windows in list order get the slots. A maximized one
 * keeps filling the area and gets its slot as its restore rectangle, unless `restoreMaximized`.
 * Z-order becomes list order (minimized windows behind), so the cascaded overflow lies on top.
 */
export function tileItems(
  items: SubWindowItems,
  listOrder: readonly PollId[],
  area: Rect,
  options: { restoreMaximized?: boolean } = {},
): ArrangeOutcome {
  const source = options.restoreMaximized ? restoreAllMaximized(items) : items;
  const ids = tiledIds(source, listOrder);
  if (ids.length === 0) return { items: source, overflow: 0, tiled: 0, cols: 0 };
  const grid = tileRects(ids.length, area, WORKSPACE_ARRANGE.gap, MIN);
  const next: SubWindowItems = { ...source };
  ids.forEach((id, i) => {
    const slot = grid.rects[i] as Rect;
    const item = source[id] as SubWindowItem;
    next[id] =
      item.state === "maximized"
        ? sameOrNew(item, { restore: slot })
        : sameOrNew(item, { rect: slot });
  });
  return {
    items: reuse(source, orderZ(next, ids)),
    overflow: grid.overflow,
    tiled: grid.tiled,
    cols: grid.cols,
  };
}

/** The slot rectangles tile mode would give, without changing anything (drag target, keys). */
export function tileSlots(
  items: SubWindowItems,
  listOrder: readonly PollId[],
  area: Rect,
): { ids: PollId[]; rects: Rect[]; cols: number } {
  const ids = tiledIds(items, listOrder);
  if (ids.length === 0) return { ids, rects: [], cols: 0 };
  const grid = tileRects(ids.length, area, WORKSPACE_ARRANGE.gap, MIN);
  return { ids, rects: grid.rects, cols: grid.cols };
}

/**
 * Cascade (DES-002 2.8.4): 24 px steps in list order, the last on top; maximized windows are
 * restored first. The active window is not raised by the caller.
 */
export function cascadeItems(
  items: SubWindowItems,
  listOrder: readonly PollId[],
  area: Rect,
): SubWindowItems {
  const source = restoreAllMaximized(items);
  const ids = tiledIds(source, listOrder);
  if (ids.length === 0) return source;
  const rects = cascadeRects(ids.length, area, MIN, WORKSPACE_ARRANGE.defaultSize);
  const next: SubWindowItems = { ...source };
  ids.forEach((id, i) => {
    next[id] = sameOrNew(source[id] as SubWindowItem, { rect: rects[i] as Rect });
  });
  return reuse(source, orderZ(next, ids));
}

function restoreAllMaximized(items: SubWindowItems): SubWindowItems {
  let next: SubWindowItems | null = null;
  for (const [key, item] of Object.entries(items)) {
    if (item.state === "maximized") {
      next ??= { ...items };
      next[Number(key)] = restoreItem(item);
    }
  }
  return next ?? items;
}

/** Minimized windows at the back, then `ids` in the given order (the last is on top). */
function orderZ(items: SubWindowItems, ids: readonly PollId[]): SubWindowItems {
  const inList = new Set(ids);
  const behind = idsByZ(items).filter((id) => !inList.has(id));
  const order = [...behind, ...ids];
  const next: SubWindowItems = { ...items };
  order.forEach((id, i) => {
    const item = items[id] as SubWindowItem;
    if (item.z !== i + 1) next[id] = { ...item, z: i + 1 };
  });
  return next;
}

function sameOrNew(item: SubWindowItem, patch: Partial<SubWindowItem>): SubWindowItem {
  const rect = patch.rect ?? item.rect;
  const restore = patch.restore === undefined ? item.restore : patch.restore;
  const sameRestore =
    restore === item.restore ||
    (restore !== null && item.restore !== null && rectsEqual(restore, item.restore));
  if (rectsEqual(rect, item.rect) && sameRestore) return item;
  return { ...item, rect, restore };
}

/** The toast of a tile that did not fit (DES-002 4): shared by the workspace and native arrange. */
export function overflowToast(count: number): string {
  return count === 1
    ? "1 window did not fit and was cascaded."
    : `${count} windows did not fit and were cascaded.`;
}

// ---------------------------------------------------------------------------------------------
// Placement of a new sub-window (DES-002 2.4)
// ---------------------------------------------------------------------------------------------

/** The next cascade slot: `(8 + 24k, 8 + 24k)` with k = visible sub-windows mod 10, default size clamped. */
export function nextSlotRect(items: SubWindowItems, area: Rect): Rect {
  return nextSlot(visibleIds(items).length, area, WORKSPACE_ARRANGE.defaultSize);
}

/** A rectangle of the default size with its title bar centered under the pointer (a list drop). */
export function dropRect(pointer: { x: number; y: number }, size: Size): Rect {
  const { width, height } = WORKSPACE_ARRANGE.defaultSize;
  return clampRect(
    {
      x: Math.round(pointer.x - width / 2),
      y: Math.round(pointer.y - TITLE_BAR_HEIGHT / 2),
      width,
      height,
    },
    size,
  );
}

// ---------------------------------------------------------------------------------------------
// Conversion to and from Rust's layout
// ---------------------------------------------------------------------------------------------

export function toWorkspaceRect(item: SubWindowItem): WorkspaceRect {
  return {
    x: item.rect.x,
    y: item.rect.y,
    width: item.rect.width,
    height: item.rect.height,
    z: item.z,
    state: item.state,
    restore: item.restore ? { ...item.restore } : null,
    ...(item.grid ? { grid: item.grid } : {}),
  };
}

/** A stored rectangle as an item. A maximized one fills the tile area. */
export function itemFromWorkspaceRect(r: WorkspaceRect, area: Rect, z: number): SubWindowItem {
  const rect: Rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  if (r.state === "maximized") {
    return {
      rect: { ...area },
      z,
      state: "maximized",
      restore: r.restore ?? rect,
      grid: r.grid ?? null,
    };
  }
  return { rect, z, state: r.state, restore: null, grid: r.grid ?? null };
}

/** Items from the layout Rust stores, for the polls that exist. z is kept (renumbered if duplicated). */
export function itemsFromLayout(
  layout: Pick<WorkspaceLayout, "items">,
  pollIds: ReadonlySet<PollId>,
  area: Rect,
): SubWindowItems {
  const items: SubWindowItems = {};
  for (const entry of layout.items) {
    if (!pollIds.has(entry.pollId)) continue;
    items[entry.pollId] = itemFromWorkspaceRect(entry.rect, area, entry.rect.z);
  }
  return renumberZ(items);
}

export interface LayoutParts {
  items: SubWindowItems;
  minimizedOrder: readonly PollId[];
  tileMode: boolean;
  compact: boolean;
  sidebar: { width: number; collapsed: boolean };
  traffic: { expanded: boolean; height: number | null };
}

/** What `mm_set_workspace_layout` receives (`compact` is output only on the Rust side). */
export function toLayout(parts: LayoutParts): WorkspaceLayout {
  const normalized = renumberZ(parts.items);
  return {
    items: idsByZ(normalized).map((pollId) => ({
      pollId,
      rect: toWorkspaceRect(normalized[pollId] as SubWindowItem),
    })),
    minimizedOrder: parts.minimizedOrder.filter((id) => normalized[id]?.state === "minimized"),
    tileMode: parts.tileMode,
    compact: parts.compact,
    sidebarWidth: clampSidebarWidth(parts.sidebar.width),
    sidebarCollapsed: parts.sidebar.collapsed,
    trafficExpanded: parts.traffic.expanded,
    trafficHeight:
      parts.traffic.height === null ? null : Math.max(0, Math.round(parts.traffic.height)),
  };
}

export function clampSidebarWidth(px: number): number {
  return Math.min(
    SIDEBAR_WIDTH_RANGE.max,
    Math.max(SIDEBAR_WIDTH_RANGE.min, Math.round(Number.isFinite(px) ? px : 280)),
  );
}

/** The traffic panel height in px: 120 px up to 70% of the window (DES-001 5.3). */
export function clampTrafficHeight(px: number, windowHeight: number): number {
  const max = Math.max(TRAFFIC_MIN_HEIGHT, Math.round(windowHeight * TRAFFIC_MAX_FRACTION));
  return Math.min(max, Math.max(TRAFFIC_MIN_HEIGHT, Math.round(px)));
}

export function defaultTrafficHeight(windowHeight: number): number {
  return clampTrafficHeight(windowHeight * TRAFFIC_DEFAULT_FRACTION, windowHeight);
}

// ---------------------------------------------------------------------------------------------
// Which polls the workspace shows
// ---------------------------------------------------------------------------------------------

/** A poll is a sub-window when its host is the workspace and its view is open. */
export function isShownInWorkspace(p: Pick<PollSummary, "host" | "open">): boolean {
  return p.host === "workspace" && p.open;
}

/** A change signature: the workspace only reacts when who is shown, or the list order, changed. */
export function shownSignature(
  polls: ReadonlyArray<Pick<PollSummary, "host" | "open" | "config">>,
): string {
  return polls.map((p) => `${p.config.pollId}${isShownInWorkspace(p) ? "w" : "-"}`).join(",");
}

export interface SyncPlan {
  /** Polls to mount, in list order. */
  mount: PollSummary[];
  /** Sub-windows whose poll is gone, closed or in its own window. */
  unmount: PollId[];
}

export function planSync(items: SubWindowItems, polls: readonly PollSummary[]): SyncPlan {
  const shown = new Set(polls.filter(isShownInWorkspace).map((p) => p.config.pollId));
  return {
    mount: polls.filter((p) => isShownInWorkspace(p) && items[p.config.pollId] === undefined),
    unmount: Object.keys(items)
      .map(Number)
      .filter((id) => !shown.has(id)),
  };
}

/** Text of the minimized-bar-driven rule: the bar shows when at least one sub-window is minimized. */
export function hasMinimized(items: SubWindowItems): boolean {
  return Object.values(items).some((i) => i.state === "minimized");
}

/** The id after (`dir` 1) or before (-1) `current` among `ids`, wrapping. */
export function cycleId(
  ids: readonly PollId[],
  current: PollId | null,
  dir: 1 | -1,
): PollId | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index === -1) return (dir === 1 ? ids[0] : ids[ids.length - 1]) as PollId;
  return ids[(index + dir + ids.length) % ids.length] as PollId;
}
