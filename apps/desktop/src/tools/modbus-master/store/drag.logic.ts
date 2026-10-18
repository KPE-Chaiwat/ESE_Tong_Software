// Pure computation of a sub-window drag (DES-002 2.10, FE-002 tasks 15 and 16): what a pointer
// position or a key press turns into. It only calls the drag math (`lib/drag-math.ts`) and the layout
// math; nothing here reads the DOM or a store. The drag store freezes a `DragContext` at the start of
// a drag, so no layout of other frames is read while the pointer moves (DES-002 2.10.10).
import type { PollId } from "@/shared/ipc/modbus-master.types";
import {
  clampRect,
  type Rect,
  type Size,
  tileRects,
  WORKSPACE_ARRANGE,
} from "@/shared/lib/layout-math";
import {
  buildSnapCandidates,
  type Direction,
  type Edges,
  type Guide,
  MOVE_EDGES,
  moveRect,
  type Point,
  resizeRect,
  type SnapCandidates,
  type SnapOther,
  type SnapZone,
  snapRect,
  snapZoneAt,
  swapTargetAt,
  type TitleBarHit,
  tileSlotAt,
  zoneRect,
} from "../lib/drag-math";
import { dropRect, sizeKnown, TITLE_BAR_HEIGHT } from "./workspace.logic";

export const KEY_STEP = 16;
export const KEY_STEP_FINE = 1;

export interface Modifiers {
  alt: boolean;
  ctrl: boolean;
}

/** Everything a drag needs to know about the workspace, frozen when the drag starts. */
export interface DragContext {
  /** The tile area (the workspace minus padding and the minimized bar). */
  area: Rect;
  /** The workspace inner size (the 80 x 30 px rule). */
  size: Size;
  tileMode: boolean;
  /** Snap lines: the area edges and every other visible window's edges. */
  candidates: SnapCandidates;
  /** The other visible windows' title bars, for the swap target. */
  titleBars: TitleBarHit<PollId>[];
  /** Tile mode: the slots in list order. */
  slots: { ids: PollId[]; rects: Rect[]; cols: number };
  min: Size;
}

export function buildDragContext(input: {
  area: Rect;
  size: Size;
  tileMode: boolean;
  others: ReadonlyArray<{ id: PollId; rect: Rect; z: number }>;
  slots: { ids: PollId[]; rects: Rect[]; cols: number };
}): DragContext {
  const snapOthers: SnapOther[] = input.others.map((o) => ({ rect: o.rect, z: o.z }));
  return {
    area: input.area,
    size: input.size,
    tileMode: input.tileMode,
    candidates: buildSnapCandidates(input.area, snapOthers),
    titleBars: input.others.map((o) => ({
      id: o.id,
      rect: { x: o.rect.x, y: o.rect.y, width: o.rect.width, height: TITLE_BAR_HEIGHT },
      z: o.z,
    })),
    slots: input.slots,
    min: WORKSPACE_ARRANGE.min,
  };
}

/** What one update of a drag produced. */
export interface DragFrame {
  rect: Rect;
  guides: Guide[];
  zone: SnapZone | null;
  zoneRect: Rect | null;
  swapTargetId: PollId | null;
  slotIndex: number | null;
  slotRect: Rect | null;
}

const NONE: Omit<DragFrame, "rect"> = {
  guides: [],
  zone: null,
  zoneRect: null,
  swapTargetId: null,
  slotIndex: null,
  slotRect: null,
};

/** The constraint of DES-002 2.10.1 (a no-op while the workspace has no size yet). */
function constrain(rect: Rect, size: Size): Rect {
  return size.width > 0 && size.height > 0 ? clampRect(rect, size) : rect;
}

/**
 * Snap zones become active only after the pointer has left the 24 px band of the tile area once
 * during the drag (Q-FE2-04): a window that rests near the border does not show the full-area zone
 * at the press. `armed` is false at the press when the pointer is inside the band; it turns true on
 * the first position outside it and stays true for the rest of that drag.
 */
export function zonesArmedAfter(armed: boolean, pointer: Point, area: Rect): boolean {
  return armed || snapZoneAt(pointer, area) === null;
}

/**
 * A move. With Ctrl the pointer picks a swap target and nothing snaps. In tile mode the pointer
 * picks a slot. Otherwise: snap zones first (the pointer near the area border, once the drag has
 * armed them), else edge snapping; Alt (or the "Snap while moving" switch) turns both off.
 */
export function computeMove(input: {
  ctx: DragContext;
  startRect: Rect;
  pointerStart: Point;
  pointer: Point;
  modifiers: Modifiers;
  snapEnabled: boolean;
  selfId: PollId;
  /** False while the pointer has not left the starting band yet. Default true. */
  zonesArmed?: boolean;
}): DragFrame {
  const { ctx, startRect, pointerStart, pointer, modifiers, selfId } = input;
  const free = moveRect(startRect, {
    x: pointer.x - pointerStart.x,
    y: pointer.y - pointerStart.y,
  });

  if (modifiers.ctrl) {
    return {
      ...NONE,
      rect: constrain(free, ctx.size),
      swapTargetId: swapTargetAt(pointer, ctx.titleBars, selfId),
    };
  }
  if (ctx.tileMode) {
    const index = ctx.slots.rects.length > 0 ? tileSlotAt(pointer, ctx.slots.rects) : -1;
    return {
      ...NONE,
      rect: constrain(free, ctx.size),
      slotIndex: index === -1 ? null : index,
      slotRect: index === -1 ? null : (ctx.slots.rects[index] as Rect),
    };
  }
  if (!input.snapEnabled || modifiers.alt) return { ...NONE, rect: constrain(free, ctx.size) };

  // Zones are evaluated before edge snapping; a shown zone suspends it (2.10.3).
  const zone = input.zonesArmed === false ? null : snapZoneAt(pointer, ctx.area);
  if (zone) {
    return {
      ...NONE,
      rect: constrain(free, ctx.size),
      zone,
      zoneRect: zoneRect(zone, ctx.area),
    };
  }
  const snapped = snapRect(free, MOVE_EDGES, ctx.candidates);
  return { ...NONE, rect: constrain(snapped.rect, ctx.size), guides: snapped.guides };
}

/** A resize: the flagged edges follow the pointer, the opposite edges stay, edges snap (not zones). */
export function computeResize(input: {
  ctx: DragContext;
  startRect: Rect;
  pointerStart: Point;
  pointer: Point;
  edges: Edges;
  modifiers: Modifiers;
  snapEnabled: boolean;
}): DragFrame {
  const { ctx, startRect, pointerStart, pointer, edges, modifiers } = input;
  const resized = resizeRect(
    startRect,
    edges,
    { x: pointer.x - pointerStart.x, y: pointer.y - pointerStart.y },
    ctx.min,
    { minTop: 0 },
  );
  if (!input.snapEnabled || modifiers.alt) return { ...NONE, rect: resized };
  const snapped = snapRect(resized, edges, ctx.candidates, undefined, ctx.min);
  return { ...NONE, rect: snapped.rect, guides: snapped.guides };
}

// ---------------------------------------------------------------------------------------------
// A row dragged from the poll list into the workspace (DES-002 2.10.7)
// ---------------------------------------------------------------------------------------------

/** Where a poll dropped from the list would go: a free rectangle, a snap zone or a tile slot. */
export type ListPlacement =
  | { kind: "rect"; rect: Rect }
  | { kind: "zone"; zone: SnapZone; rect: Rect }
  | { kind: "slot"; index: number; rect: Rect };

/**
 * The placement preview while a list row is over the workspace (`pointer` is in workspace
 * coordinates). Tile mode: the slot the poll would take in the grid it joins (one window more
 * unless it is tiled already). Free layout: a snap zone when the pointer is in one (Alt or the
 * "Snap while moving" switch turn zones off), else the default size with the title bar centered
 * under the pointer, clamped by 2.10.1. A list drag starts outside the workspace, so zones need no
 * arming.
 */
export function computeListPlacement(input: {
  ctx: DragContext;
  pointer: Point;
  modifiers: Modifiers;
  snapEnabled: boolean;
  /** The poll is one of the tiled windows already. */
  tiled: boolean;
}): ListPlacement {
  const { ctx, pointer } = input;
  if (ctx.tileMode) {
    const count = ctx.slots.ids.length + (input.tiled ? 0 : 1);
    const grid = tileRects(count, ctx.area, WORKSPACE_ARRANGE.gap, ctx.min);
    const slots = grid.rects.slice(0, grid.tiled);
    const index = tileSlotAt(pointer, slots);
    return { kind: "slot", index: Math.max(0, index), rect: slots[index] ?? { ...ctx.area } };
  }
  if (input.snapEnabled && !input.modifiers.alt) {
    const zone = snapZoneAt(pointer, ctx.area);
    if (zone) return { kind: "zone", zone, rect: zoneRect(zone, ctx.area) };
  }
  const size = WORKSPACE_ARRANGE.defaultSize;
  const rect = sizeKnown(ctx.size)
    ? dropRect(pointer, ctx.size)
    : {
        x: Math.round(pointer.x - size.width / 2),
        y: Math.round(pointer.y - TITLE_BAR_HEIGHT / 2),
        width: size.width,
        height: size.height,
      };
  return { kind: "rect", rect };
}

// ---------------------------------------------------------------------------------------------
// Keyboard (DES-002 2.10.8)
// ---------------------------------------------------------------------------------------------

const VECTOR: Record<Direction, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

/** `Alt+Arrow`: 16 px, with Shift 1 px. Edge snapping only, when enabled. */
export function keyboardMove(input: {
  ctx: DragContext;
  rect: Rect;
  dir: Direction;
  fine: boolean;
  snapEnabled: boolean;
}): DragFrame {
  const step = input.fine ? KEY_STEP_FINE : KEY_STEP;
  const v = VECTOR[input.dir];
  const moved = moveRect(input.rect, { x: v.x * step, y: v.y * step });
  if (!input.snapEnabled) return { ...NONE, rect: constrain(moved, input.ctx.size) };
  const snapped = snapRect(moved, MOVE_EDGES, input.ctx.candidates);
  return { ...NONE, rect: constrain(snapped.rect, input.ctx.size), guides: snapped.guides };
}

/**
 * `Ctrl+Alt+Arrow`: Right and Down grow, Left and Up shrink (the right and bottom edges move).
 * Edge snapping applies to the moving edge when it is enabled (DES-002 2.10.8), and the rectangle
 * keeps the title bar inside the workspace like every other (2.10.1).
 */
export function keyboardSize(input: {
  ctx: DragContext;
  rect: Rect;
  dir: Direction;
  fine: boolean;
  snapEnabled?: boolean;
}): DragFrame {
  const step = input.fine ? KEY_STEP_FINE : KEY_STEP;
  const v = VECTOR[input.dir];
  const horizontal = v.x !== 0;
  const edges: Edges = {
    left: false,
    top: false,
    right: horizontal,
    bottom: !horizontal,
  };
  const rect = resizeRect(input.rect, edges, { x: v.x * step, y: v.y * step }, input.ctx.min, {
    minTop: 0,
  });
  if (!input.snapEnabled) return { ...NONE, rect: constrain(rect, input.ctx.size) };
  const snapped = snapRect(rect, edges, input.ctx.candidates, undefined, input.ctx.min);
  return { ...NONE, rect: constrain(snapped.rect, input.ctx.size), guides: snapped.guides };
}

// ---------------------------------------------------------------------------------------------
// Texts (DES-002 2.10.8 announcements)
// ---------------------------------------------------------------------------------------------

export const announce = {
  moved: (name: string) => `${name} moved.`,
  resized: (name: string, rect: Rect) => `${name} resized to ${rect.width} by ${rect.height}.`,
  zone: (name: string, label: string) => `${name} moved to the ${label}.`,
  swapped: (name: string, other: string) => `${name} swapped with ${other}.`,
  slot: (name: string, index: number, count: number) =>
    `${name} moved to slot ${index} of ${count}.`,
  listPosition: (name: string, index: number, count: number) =>
    `${name} moved to position ${index} of ${count}.`,
  /** A list row dropped into the workspace as a plain rectangle. */
  shown: (name: string) => `${name} shown in the workspace.`,
  cancelled: "Move cancelled.",
} as const;
