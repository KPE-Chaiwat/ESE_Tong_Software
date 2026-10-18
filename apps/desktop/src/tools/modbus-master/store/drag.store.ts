// Drag state of the workspace (DES-002 2.10, FE-002 tasks 15, 16 and 18): a separate store that only
// the dragged frame and the overlay layer subscribe to, so a drag never re-renders the other
// sub-windows or their tables (2.10.10). The committed rectangle is written to the workspace store
// once, on release; the layout is reported once, at the end of the action.
//
// Pointer positions of a sub-window drag are in workspace coordinates. A drag of a sidebar row is
// measured in client coordinates by the sidebar gesture (the list and the workspace are different
// elements). `update` and `updateList` are coalesced to one computation per animation frame. The pure
// rules are in `drag.logic.ts` and `lib/drag-math.ts`.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { containsPoint, type Rect } from "@/shared/lib/layout-math";
import {
  adjacentSlot,
  type Direction,
  type Edges,
  type Guide,
  gapToIndex,
  insertAmongSubset,
  listDropZone,
  listInsertIndex,
  neighborInDirection,
  type Point,
  reorder,
  restoreFromMaximizedForDrag,
  type SnapZone,
  swapInOrder,
  ZONE_LABELS,
  zoneRect,
} from "../lib/drag-math";
import {
  announce,
  buildDragContext,
  computeListPlacement,
  computeMove,
  computeResize,
  type DragContext,
  type DragFrame,
  keyboardMove,
  keyboardSize,
  type ListPlacement,
  type Modifiers,
  zonesArmedAfter,
} from "./drag.logic";
import { animationFrameScheduler, type FrameScheduler } from "./traffic.logic";
import {
  hasMinimized,
  type SubWindowItem,
  type SubWindowItems,
  tileAreaOf,
  tileSlots,
  visibleIds,
} from "./workspace.logic";
import type { WorkspaceStoreApi } from "./workspace.store";

export type DragKind =
  | "none"
  | "move"
  | "resize"
  | "keyboardMove"
  | "keyboardSize"
  | "tileReorder"
  /** A poll list row dragged inside the list (the pointer is over the list). */
  | "listReorder"
  /** A poll list row over the workspace: a placement preview. */
  | "listToWorkspace";

export function isListDrag(kind: DragKind): boolean {
  return kind === "listReorder" || kind === "listToWorkspace";
}

/** What the sidebar gesture measures for each list drag update (client coordinates). */
export interface ListDragUpdate {
  pointer: Point;
  /** The rows in list order. */
  rows: readonly Rect[];
  /** The list's own rectangle. */
  list: Rect;
  /** The workspace, null when it is not on screen. */
  workspace: Rect | null;
  modifiers: Modifiers;
}

export interface DragState {
  kind: DragKind;
  pollId: PollId | null;
  startRect: Rect | null;
  /** The rectangle under the pointer: drives the live transform. Null when nothing is dragged. */
  currentRect: Rect | null;
  pointerStart: Point | null;
  edges: Edges | null;
  modifiers: Modifiers;
  guides: Guide[];
  zone: SnapZone | null;
  zoneRect: Rect | null;
  swapTargetId: PollId | null;
  slotIndex: number | null;
  slotRect: Rect | null;
  /** The drag started on a maximized window: it is restored when the drag commits. */
  fromMaximized: boolean;
  /**
   * Snap zones are active only after the pointer left the 24 px band of the tile area once during
   * the drag (Q-FE2-04). False at a press inside the band.
   */
  zonesArmed: boolean;
  /** "Snap while moving" (W1 lifetime, on by default). */
  snapEnabled: boolean;

  // ---- a poll list row (DES-002 2.10.6, 2.10.7) ----
  /** The index of the dragged row when the drag began. */
  listFromIndex: number | null;
  /** The insertion gap under the pointer (0 = before the first row), null outside the list. */
  listGapIndex: number | null;
  /** The pointer in client coordinates: the ghost follows it. */
  listPointer: Point | null;
  /** Over the workspace: where the drop would put the sub-window. */
  listPlace: ListPlacement | null;
}

export type DragResult =
  | { kind: "none" }
  | { kind: "unchanged" }
  | { kind: "moved"; rect: Rect }
  | { kind: "resized"; rect: Rect }
  | { kind: "zone"; zone: SnapZone; rect: Rect }
  | { kind: "swap"; with: PollId }
  | { kind: "slot"; index: number }
  | { kind: "listReordered"; index: number }
  | { kind: "listPlaced"; place: ListPlacement }
  | { kind: "cancelled" };

export interface DragActions {
  /** Starts a pointer drag. Returns false when the sub-window does not exist. */
  begin(
    kind: "move" | "resize",
    pollId: PollId,
    pointer: Point,
    extra?: { edges?: Edges; modifiers?: Modifiers },
  ): boolean;
  /** Title bar menu "Move" and "Size": a keyboard mode with an outline until Enter. */
  beginKeyboard(kind: "keyboardMove" | "keyboardSize", pollId: PollId): boolean;
  /** A sidebar row is dragged (after the 4 px threshold). False for a poll that is not in the list. */
  beginList(pollId: PollId): boolean;
  /** Coalesced to one computation per animation frame. */
  update(pointer: Point, modifiers: Modifiers): void;
  /** The pointer of a list drag, with what the gesture measured. Coalesced like `update`. */
  updateList(update: ListDragUpdate): void;
  /** Arrow key in a keyboard mode. */
  keyboardStep(dir: Direction, fine: boolean): void;
  /** Release (or Enter): commits. */
  end(): DragResult;
  /** Esc, a lost pointer capture: back to the rectangle at the press. */
  cancel(): void;
  /** The dragged poll is gone (deleted, popped out, a profile was applied): drop the drag, silently. */
  abort(pollId: PollId): void;
  toggleSnap(): void;

  /** `Alt+Arrow` and `Ctrl+Alt+Arrow`: one committed step. */
  nudge(pollId: PollId, kind: "move" | "size", dir: Direction, fine: boolean): void;
  /** `Ctrl+Shift+Arrow`: swap with the neighbor in that direction (the adjacent slot in tile mode). */
  swapDirection(pollId: PollId, dir: Direction): void;
  /** Title bar menu "Move to": a snap zone rectangle. */
  moveToZone(pollId: PollId, zone: SnapZone): void;
  /** Tile mode: title bar menu "Slot n" (0-based index). */
  moveToSlot(pollId: PollId, index: number): void;
}

export type DragStore = DragState & DragActions;
export type DragStoreApi = StoreApi<DragStore>;

export interface DragStoreDeps {
  workspace: WorkspaceStoreApi;
  getName(id: PollId): string;
  getListOrder(): readonly PollId[];
  /**
   * Sets the list order (tile mode reorder, list reorder). A result of `false` (or a promise of
   * it) means it was not applied; anything else is success.
   */
  setOrder(order: PollId[]): unknown;
  /**
   * A poll dropped from the list into the workspace: show, move or dock it there. `false` = it was
   * refused or failed, so nothing is announced.
   */
  placeFromList?(pollId: PollId, place: ListPlacement): unknown;
  /**
   * True when a drop announces itself another way (a native poll that is docked says "docked in the
   * workspace"), so the drop text is left out.
   */
  announcesItself?(pollId: PollId): boolean;
  announce(text: string): void;
  schedule?: FrameScheduler;
}

const IDLE: Omit<DragState, "snapEnabled"> = {
  kind: "none",
  pollId: null,
  startRect: null,
  currentRect: null,
  pointerStart: null,
  edges: null,
  modifiers: { alt: false, ctrl: false },
  guides: [],
  zone: null,
  zoneRect: null,
  swapTargetId: null,
  slotIndex: null,
  slotRect: null,
  fromMaximized: false,
  zonesArmed: true,
  listFromIndex: null,
  listGapIndex: null,
  listPointer: null,
  listPlace: null,
};

export function createDragStore(deps: DragStoreDeps): DragStoreApi {
  const schedule = deps.schedule ?? animationFrameScheduler;
  let ctx: DragContext | null = null;
  let pending: { pointer: Point; modifiers: Modifiers } | null = null;
  let pendingList: ListDragUpdate | null = null;
  let cancelFrame: (() => void) | null = null;

  const workspace = () => deps.workspace.getState();

  function contextFor(pollId: PollId): DragContext {
    const w = workspace();
    const ids = visibleIds(w.items);
    const area = areaFrom(w);
    return buildDragContext({
      area,
      size: w.size,
      tileMode: w.tileMode,
      others: ids
        .filter((id) => id !== pollId)
        .map((id) => ({
          id,
          rect: (w.items[id] as SubWindowItem).rect,
          z: (w.items[id] as SubWindowItem).z,
        })),
      slots: tileSlots(w.items, deps.getListOrder(), area),
    });
  }

  return createStore<DragStore>()((set, get) => {
    function clearPending() {
      cancelFrame?.();
      cancelFrame = null;
      pending = null;
      pendingList = null;
    }

    function applyFrame(frame: DragFrame, extra: Partial<DragState> = {}) {
      set({
        currentRect: frame.rect,
        guides: frame.guides,
        zone: frame.zone,
        zoneRect: frame.zoneRect,
        swapTargetId: frame.swapTargetId,
        slotIndex: frame.slotIndex,
        slotRect: frame.slotRect,
        ...extra,
      });
    }

    /** The list drag update of this frame: over the workspace a preview, over the list a gap. */
    function computeList(job: ListDragUpdate) {
      const s = get();
      if (!ctx || s.pollId === null || !isListDrag(s.kind)) return;
      if (job.workspace !== null && containsPoint(job.workspace, job.pointer)) {
        const place = computeListPlacement({
          ctx,
          pointer: { x: job.pointer.x - job.workspace.x, y: job.pointer.y - job.workspace.y },
          modifiers: job.modifiers,
          snapEnabled: s.snapEnabled,
          tiled: ctx.slots.ids.includes(s.pollId),
        });
        set({
          kind: "listToWorkspace",
          listPointer: job.pointer,
          listGapIndex: null,
          listPlace: place,
          modifiers: job.modifiers,
        });
        return;
      }
      // Over the list the gap is under the pointer; outside both there is no target.
      set({
        kind: "listReorder",
        listPointer: job.pointer,
        listGapIndex: containsPoint(listDropZone(job.list), job.pointer)
          ? listInsertIndex(job.pointer.y, job.rows)
          : null,
        listPlace: null,
        modifiers: job.modifiers,
      });
    }

    /** Runs the one computation of this animation frame. */
    function compute() {
      cancelFrame = null;
      const listJob = pendingList;
      pendingList = null;
      if (listJob) {
        pending = null;
        computeList(listJob);
        return;
      }
      const job = pending;
      pending = null;
      const s = get();
      if (!job || !ctx || s.kind === "none" || s.pollId === null) return;
      if (!s.startRect || !s.pointerStart) return;
      if (s.kind === "move" || s.kind === "tileReorder") {
        const armed = zonesArmedAfter(s.zonesArmed, job.pointer, ctx.area);
        applyFrame(
          computeMove({
            ctx,
            startRect: s.startRect,
            pointerStart: s.pointerStart,
            pointer: job.pointer,
            modifiers: job.modifiers,
            snapEnabled: s.snapEnabled,
            selfId: s.pollId,
            zonesArmed: armed,
          }),
          { modifiers: job.modifiers, zonesArmed: armed },
        );
      } else if (s.kind === "resize" && s.edges) {
        applyFrame(
          computeResize({
            ctx,
            startRect: s.startRect,
            pointerStart: s.pointerStart,
            pointer: job.pointer,
            edges: s.edges,
            modifiers: job.modifiers,
            snapEnabled: s.snapEnabled,
          }),
          { modifiers: job.modifiers },
        );
      }
    }

    /** One computation per animation frame, whatever the number of pointer events. */
    function requestFrame() {
      if (cancelFrame !== null) return;
      let ranSync = false;
      const handle = schedule(() => {
        ranSync = true;
        compute();
      });
      // A scheduler that runs the callback at once has already computed.
      if (!ranSync) cancelFrame = handle;
    }

    /** Runs `then` when a command is done and did not report failure; at once for a plain value. */
    function whenDone(result: unknown, then: () => void): void {
      if (result !== null && typeof result === "object" && "then" in result) {
        (result as Promise<unknown>).then(
          (ok) => {
            if (ok !== false) then();
          },
          () => {},
        );
      } else if (result !== false) {
        then();
      }
    }

    function reset() {
      clearPending();
      ctx = null;
      set({ ...IDLE, snapEnabled: get().snapEnabled });
    }

    /** Release of a list row: a new place in the list, or a placement in the workspace. */
    function endList(s: DragState, id: PollId): DragResult {
      const name = deps.getName(id);
      const order = deps.getListOrder();
      let result: DragResult = { kind: "unchanged" };
      if (s.kind === "listReorder" && s.listGapIndex !== null) {
        // The poll is found by its id: the list may have changed during the drag (REV-006 m-3).
        const from = order.indexOf(id);
        if (from !== -1) {
          const to = gapToIndex(from, Math.min(s.listGapIndex, order.length));
          if (to !== from) {
            whenDone(deps.setOrder(reorder(order, from, to)), () =>
              deps.announce(announce.listPosition(name, to + 1, order.length)),
            );
            result = { kind: "listReordered", index: to };
          }
        }
      } else if (s.kind === "listToWorkspace" && s.listPlace) {
        const place = s.listPlace;
        const slots = ctx?.slots.ids ?? [];
        const text =
          place.kind === "zone"
            ? announce.zone(name, ZONE_LABELS[place.zone])
            : place.kind === "slot"
              ? announce.slot(name, place.index + 1, slots.length + (slots.includes(id) ? 0 : 1))
              : announce.shown(name);
        // Said when the drop has worked, not before (REV-006 m-4).
        whenDone(deps.placeFromList?.(id, place), () => {
          if (!deps.announcesItself?.(id)) deps.announce(text);
        });
        result = { kind: "listPlaced", place };
      }
      reset();
      return result;
    }

    function commitSlot(id: PollId, index: number): DragResult {
      const slots = tileSlots(workspace().items, deps.getListOrder(), areaFrom(workspace()));
      const from = slots.ids.indexOf(id);
      if (from === -1 || index === from || index < 0 || index >= slots.ids.length) {
        return { kind: "unchanged" };
      }
      whenDone(deps.setOrder(insertAmongSubset(deps.getListOrder(), slots.ids, id, index)), () =>
        deps.announce(announce.slot(deps.getName(id), index + 1, slots.ids.length)),
      );
      return { kind: "slot", index };
    }

    function commitSwap(id: PollId, other: PollId, tileMode: boolean): DragResult {
      const said = () => deps.announce(announce.swapped(deps.getName(id), deps.getName(other)));
      if (tileMode) {
        whenDone(deps.setOrder(swapInOrder(deps.getListOrder(), id, other)), said);
      } else {
        workspace().swap(id, other);
        said();
      }
      return { kind: "swap", with: other };
    }

    return {
      ...IDLE,
      snapEnabled: true,

      begin(kind, pollId, pointer, extra = {}) {
        const w = workspace();
        const item = w.items[pollId];
        if (!item) return false;
        reset();
        ctx = contextFor(pollId);
        const fromMaximized = item.state === "maximized";
        const startRect =
          fromMaximized && kind === "move"
            ? restoreFromMaximizedForDrag(item.restore ?? item.rect, pointer, item.rect)
            : item.rect;
        set({
          kind: kind === "move" && w.tileMode ? "tileReorder" : kind,
          pollId,
          startRect,
          currentRect: startRect,
          pointerStart: pointer,
          edges: extra.edges ?? null,
          modifiers: extra.modifiers ?? { alt: false, ctrl: false },
          fromMaximized: fromMaximized && kind === "move",
          // A press inside the band at the border does not show the full-area zone at once.
          zonesArmed: zonesArmedAfter(false, pointer, ctx.area),
        });
        // The first update right away, so the frame shows the restored size of a maximized drag.
        if (fromMaximized && kind === "move") {
          applyFrame({
            rect: startRect,
            guides: [],
            zone: null,
            zoneRect: null,
            swapTargetId: null,
            slotIndex: null,
            slotRect: null,
          });
        }
        return true;
      },

      beginKeyboard(kind, pollId) {
        const w = workspace();
        const item = w.items[pollId];
        if (!item || w.tileMode || item.state !== "normal") return false;
        reset();
        ctx = contextFor(pollId);
        set({ kind, pollId, startRect: item.rect, currentRect: item.rect });
        return true;
      },

      beginList(pollId) {
        const index = deps.getListOrder().indexOf(pollId);
        if (index === -1) return false;
        reset();
        ctx = contextFor(pollId);
        set({ kind: "listReorder", pollId, listFromIndex: index });
        return true;
      },

      update(pointer, modifiers) {
        const kind = get().kind;
        if (kind === "none" || isListDrag(kind)) return;
        pending = { pointer, modifiers };
        requestFrame();
      },

      updateList(update) {
        if (!isListDrag(get().kind)) return;
        pendingList = update;
        requestFrame();
      },

      keyboardStep(dir, fine) {
        const s = get();
        if (!ctx || !s.currentRect || (s.kind !== "keyboardMove" && s.kind !== "keyboardSize")) {
          return;
        }
        const frame =
          s.kind === "keyboardMove"
            ? keyboardMove({
                ctx,
                rect: s.currentRect,
                dir,
                fine,
                snapEnabled: s.snapEnabled,
              })
            : keyboardSize({ ctx, rect: s.currentRect, dir, fine, snapEnabled: s.snapEnabled });
        applyFrame(frame);
      },

      end() {
        // The last pointer position counts even when its animation frame has not run yet.
        if (pending || pendingList) {
          cancelFrame?.();
          compute();
        }
        const s = get();
        const id = s.pollId;
        if (id !== null && isListDrag(s.kind)) return endList(s, id);
        if (s.kind === "none" || id === null || !s.currentRect || !s.startRect) {
          reset();
          return { kind: "none" };
        }
        const name = deps.getName(id);
        const tileMode = workspace().tileMode;
        let result: DragResult;

        if (s.kind === "tileReorder") {
          if (s.swapTargetId !== null) result = commitSwap(id, s.swapTargetId, true);
          else if (s.slotIndex !== null) result = commitSlot(id, s.slotIndex);
          else result = { kind: "unchanged" };
        } else if (s.kind === "move" && s.swapTargetId !== null) {
          result = commitSwap(id, s.swapTargetId, tileMode);
        } else if (s.kind === "move" && s.zone !== null && s.zoneRect !== null) {
          workspace().setRect(id, s.zoneRect);
          deps.announce(announce.zone(name, ZONE_LABELS[s.zone]));
          result = { kind: "zone", zone: s.zone, rect: s.zoneRect };
        } else {
          const rect = s.currentRect;
          const item = workspace().items[id];
          const unchanged =
            item !== undefined &&
            item.state === "normal" &&
            sameRect(item.rect, rect) &&
            !s.fromMaximized;
          if (unchanged) {
            result = { kind: "unchanged" };
          } else {
            workspace().setRect(id, rect);
            const resized = s.kind === "resize" || s.kind === "keyboardSize";
            deps.announce(resized ? announce.resized(name, rect) : announce.moved(name));
            result = resized ? { kind: "resized", rect } : { kind: "moved", rect };
          }
        }

        // The drag state is cleared after the commit, so the frame reads the committed rectangle.
        reset();
        void workspace().flush();
        return result;
      },

      cancel() {
        if (get().kind === "none") return;
        reset();
        deps.announce(announce.cancelled);
      },

      abort(pollId) {
        if (get().kind === "none" || get().pollId !== pollId) return;
        reset();
      },

      toggleSnap() {
        set((s) => ({ snapEnabled: !s.snapEnabled }));
      },

      nudge(pollId, kind, dir, fine) {
        const w = workspace();
        const item = w.items[pollId];
        if (item?.state !== "normal" || w.tileMode) return;
        const local = contextFor(pollId);
        const frame =
          kind === "move"
            ? keyboardMove({
                ctx: local,
                rect: item.rect,
                dir,
                fine,
                snapEnabled: get().snapEnabled,
              })
            : keyboardSize({
                ctx: local,
                rect: item.rect,
                dir,
                fine,
                snapEnabled: get().snapEnabled,
              });
        if (sameRect(frame.rect, item.rect)) return;
        w.setRect(pollId, frame.rect);
        const name = deps.getName(pollId);
        deps.announce(kind === "move" ? announce.moved(name) : announce.resized(name, frame.rect));
        void workspace().flush();
      },

      swapDirection(pollId, dir) {
        const w = workspace();
        if (!w.items[pollId] || w.items[pollId]?.state === "minimized") return;
        if (w.tileMode) {
          const slots = tileSlots(w.items, deps.getListOrder(), areaFrom(w));
          const index = slots.ids.indexOf(pollId);
          const target = adjacentSlot(index, slots.cols, slots.ids.length, dir);
          if (target === null) return;
          commitSwap(pollId, slots.ids[target] as PollId, true);
          return;
        }
        const others = visibleIds(w.items)
          .filter((id) => id !== pollId)
          .map((id) => ({ id, rect: (w.items[id] as SubWindowItem).rect }));
        const neighbor = neighborInDirection((w.items[pollId] as SubWindowItem).rect, others, dir);
        if (neighbor === null) return;
        commitSwap(pollId, neighbor, false);
        void workspace().flush();
      },

      moveToZone(pollId, zone) {
        const w = workspace();
        if (!w.items[pollId] || w.tileMode) return;
        w.setRect(pollId, zoneRect(zone, areaFrom(w)));
        deps.announce(announce.zone(deps.getName(pollId), ZONE_LABELS[zone]));
        void workspace().flush();
      },

      moveToSlot(pollId, index) {
        commitSlot(pollId, index);
      },
    };
  });
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function areaFrom(w: { size: { width: number; height: number }; items: SubWindowItems }) {
  return tileAreaOf(w.size, hasMinimized(w.items));
}

// ---- typed selectors ----
export const selectDragKind = (s: DragStore) => s.kind;
export const selectDragPollId = (s: DragStore) => s.pollId;
export const selectSnapEnabled = (s: DragStore) => s.snapEnabled;
export const selectDragZoneRect = (s: DragStore) => s.zoneRect;
/** A frame subscribes to its own live rectangle: other frames always select null. */
export const selectLiveRect = (id: PollId) => (s: DragStore) =>
  s.pollId === id && s.kind !== "keyboardMove" && s.kind !== "keyboardSize" ? s.currentRect : null;
export const selectIsSwapTarget = (id: PollId) => (s: DragStore) => s.swapTargetId === id;
/** A sidebar row subscribes to this: it dims while it is the one dragged. */
export const selectIsListDragged = (id: PollId) => (s: DragStore) =>
  s.pollId === id && isListDrag(s.kind);
export const selectListGapIndex = (s: DragStore) => s.listGapIndex;
export const selectListPlace = (s: DragStore) => s.listPlace;
