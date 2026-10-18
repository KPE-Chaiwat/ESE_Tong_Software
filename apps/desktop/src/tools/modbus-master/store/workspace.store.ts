// The workspace of the connection window (DES-002 2.2.4, 2.3.1, 2.4, 2.8, 2.10.5, FE-002 tasks 13
// and 14): the sub-window rectangles, z-order and states, the active window, the minimized bar,
// tile mode, the size of the workspace, and the sidebar and traffic panel layout. W1 owns these
// numbers while it runs; Rust stores them (`mm_set_workspace_layout`) for the profile and for a
// reload. They are reported only at the end of an action (`flush`), never while a drag runs.
//
// Which polls are sub-windows is decided by Rust (`host` and `open` in the poll list): `syncFromList`
// mounts and unmounts. Drag state lives in `drag.store.ts`, so a drag never changes this store until
// it commits.
import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type { PollId, PollSummary, WorkspaceLayout } from "@/shared/ipc/modbus-master.types";
import { clampRect, type Rect, rectsEqual, type Size } from "@/shared/lib/layout-math";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import {
  cascadeItems,
  clampItems,
  clampSidebarWidth,
  clampTrafficHeight,
  cycleId,
  fitMaximized,
  hasMinimized,
  isShownInWorkspace,
  itemFromWorkspaceRect,
  itemsEqual,
  itemsFromLayout,
  maximizedIdOf,
  maximizeItem,
  minimizeItem,
  nextSlotRect,
  overflowToast,
  planSync,
  raise,
  restoreItem,
  SIDEBAR_WIDTH_RANGE,
  type SubWindowItem,
  type SubWindowItems,
  sizeKnown,
  swapItems,
  tileAreaOf,
  tileItems,
  toLayout,
  topVisibleId,
  topZ,
} from "./workspace.logic";

export interface WorkspaceState {
  items: SubWindowItems;
  /** The sub-window with focus or the one that was last focused. */
  activeId: PollId | null;
  /** Order of the minimized bar: minimize order until "Arrange minimized". */
  minimizedOrder: PollId[];
  tileMode: boolean;
  /** The workspace inner size in px (0 x 0 until it is measured). */
  size: Size;
  sidebar: { width: number; collapsed: boolean };
  traffic: { expanded: boolean; height: number | null };
  /** The poll that was just created: its setup opens with the focus in Name. */
  freshId: PollId | null;
  /** Moves the keyboard focus into this sub-window (sidebar click, menu, Ctrl+F6). */
  focusRequest: { id: PollId; seq: number } | null;
  /** The sub-window whose title is being renamed (F2 on the title bar, Rename in the menu). */
  titleRenameId: PollId | null;
  /** Reveals that arrived before their poll was mounted. */
  pendingReveal: Record<PollId, Rect | null>;
  /** True once the snapshot layout was applied: polls that appear later become active. */
  loaded: boolean;
}

export interface WorkspaceActions {
  /**
   * The workspace Rust stored (`SessionSnapshot.workspaceLayout`), then mounts the polls that
   * have no rectangle yet.
   */
  applyLayout(layout: WorkspaceLayout, polls: readonly PollSummary[]): void;
  /** `PollListChanged`: mounts and unmounts sub-windows, and re-tiles in tile mode. */
  syncFromList(polls: readonly PollSummary[]): void;
  /** A view went away (detached by Rust, deleted): its sub-window goes too. Does not report. */
  unmount(id: PollId): void;
  /** `RevealPoll`: restore, place (with `rect`), activate and focus the sub-window. */
  reveal(id: PollId, rect: Rect | null): void;

  /** Brings the sub-window to the front and makes it active. Does not report. */
  activate(id: PollId): void;
  /** Sidebar click, menu entry, Ctrl+F6: activate, move the focus into it and report. */
  show(id: PollId): boolean;
  /**
   * Asks the sub-window to take the keyboard focus (its grid, once the view has attached) without
   * raising, activating or reporting it: a failed pop out gives the focus back this way (D9).
   */
  requestFocus(id: PollId): void;
  /** Commits a rectangle after a drag or a key. A maximized window becomes normal. Does not report. */
  setRect(id: PollId, rect: Rect): void;
  swap(a: PollId, b: PollId): void;
  minimize(id: PollId): void;
  maximize(id: PollId): void;
  restore(id: PollId): void;
  toggleMaximize(id: PollId): void;
  minimizeAll(): void;
  restoreAll(): void;
  arrangeMinimized(listOrder: readonly PollId[]): void;
  /** Ctrl+F6 (1) and Ctrl+Shift+F6 (-1): the next sub-window in list order. */
  cycle(dir: 1 | -1): void;

  tile(): void;
  cascade(): void;
  setTileMode(on: boolean): void;

  /** The measured workspace size. Clamps every window; re-tiles in tile mode; reports after 300 ms. */
  setSize(size: Size): void;
  setSidebarWidth(px: number): void;
  toggleSidebar(): void;
  setTrafficHeight(px: number | null): void;
  setTrafficExpanded(expanded: boolean): void;

  markFresh(id: PollId | null): void;
  startTitleRename(id: PollId): void;
  endTitleRename(): void;
  /** Reports the layout to Rust: only when it differs from what Rust already has. */
  flush(): Promise<void>;
  toLayout(): WorkspaceLayout;
  dispose(): void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;
export type WorkspaceStoreApi = StoreApi<WorkspaceStore>;

export interface WorkspaceStoreDeps {
  ipc: Pick<ModbusMasterIpc, "setWorkspaceLayout">;
  toasts: ToastStoreApi;
  /** The list order of every poll (tile order). */
  getListOrder(): readonly PollId[];
  /** Compact mode, which Rust owns (it is output only in the layout). */
  getCompact?(): boolean;
  /** The window height, for the 70% limit of the traffic panel. Defaults to `window.innerHeight`. */
  getWindowHeight?(): number;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** Delay of the report after a W1 resize (DES-002 2.10.9). */
  resizeFlushMs?: number;
}

const initialState: WorkspaceState = {
  items: {},
  activeId: null,
  minimizedOrder: [],
  tileMode: false,
  size: { width: 0, height: 0 },
  sidebar: { width: SIDEBAR_WIDTH_RANGE.default, collapsed: false },
  traffic: { expanded: false, height: null },
  freshId: null,
  focusRequest: null,
  titleRenameId: null,
  pendingReveal: {},
  loaded: false,
};

export { overflowToast };

export function createWorkspaceStore(deps: WorkspaceStoreDeps): WorkspaceStoreApi {
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const resizeFlushMs = deps.resizeFlushMs ?? 300;
  const windowHeight = deps.getWindowHeight ?? (() => globalThis.window?.innerHeight ?? 800);
  let lastSent: string | null = null;
  let resizeTimer: unknown = null;
  let focusSeq = 0;
  let lastOverflow = 0;

  return createStore<WorkspaceStore>()((set, get) => {
    const areaOf = (items: SubWindowItems = get().items): Rect =>
      tileAreaOf(get().size, hasMinimized(items));

    /**
     * Brings items in line with the rules that follow every change: maximized windows fill the tile
     * area, tile mode keeps the slots, and the active window is in front.
     */
    function settle(items: SubWindowItems, activeId: PollId | null, raiseActive: boolean) {
      let next = items;
      if (sizeKnown(get().size)) {
        const area = areaOf(next);
        next = fitMaximized(next, area);
        if (get().tileMode) {
          const outcome = tileItems(next, deps.getListOrder(), area);
          next = outcome.items;
          if (outcome.overflow > 0 && outcome.overflow !== lastOverflow) {
            deps.toasts.getState().show(overflowToast(outcome.overflow), { durationMs: 3000 });
          }
          lastOverflow = outcome.overflow;
        }
      }
      if (raiseActive && activeId !== null && next[activeId]?.state !== undefined) {
        if (next[activeId]?.state !== "minimized") next = raise(next, activeId);
      }
      return next;
    }

    function pickActive(items: SubWindowItems, activeId: PollId | null): PollId | null {
      if (activeId !== null && items[activeId] && items[activeId]?.state !== "minimized") {
        return activeId;
      }
      return topVisibleId(items);
    }

    function commit(
      patch: Partial<Pick<WorkspaceState, "items" | "minimizedOrder" | "activeId" | "tileMode">>,
      raiseActive = true,
    ): void {
      const s = get();
      const items = patch.items ?? s.items;
      const activeId = pickActive(
        items,
        patch.activeId === undefined ? s.activeId : patch.activeId,
      );
      set({ ...patch, items: settle(items, activeId, raiseActive), activeId });
    }

    /** Activation rules of DES-002 2.3.1 and 2.5.1: restore a minimized window; follow a maximized one. */
    function activateNow(id: PollId, focus: boolean): boolean {
      const s = get();
      let items = s.items;
      const item = items[id];
      if (!item) return false;
      let minimizedOrder = s.minimizedOrder;
      if (item.state === "minimized") {
        items = { ...items, [id]: restoreItem(item) };
        minimizedOrder = minimizedOrder.filter((m) => m !== id);
      }
      const maxId = maximizedIdOf(items);
      if (maxId !== null && maxId !== id) {
        const area = tileAreaOf(s.size, hasMinimized(items));
        items = {
          ...items,
          [maxId]: restoreItem(items[maxId] as SubWindowItem),
          [id]: maximizeItem(items[id] as SubWindowItem, area),
        };
      }
      items = raise(items, id);
      set({
        minimizedOrder,
        ...(focus ? { focusRequest: { id, seq: ++focusSeq } } : {}),
      });
      commit({ items, activeId: id });
      return true;
    }

    function layoutNow(): WorkspaceLayout {
      const s = get();
      return toLayout({
        items: s.items,
        minimizedOrder: s.minimizedOrder,
        tileMode: s.tileMode,
        compact: deps.getCompact?.() ?? false,
        sidebar: s.sidebar,
        traffic: s.traffic,
      });
    }

    const keyOf = (layout: WorkspaceLayout) => JSON.stringify({ ...layout, compact: false });

    async function flush(): Promise<void> {
      if (resizeTimer !== null) {
        clearTimer(resizeTimer);
        resizeTimer = null;
      }
      const layout = layoutNow();
      const key = keyOf(layout);
      if (key === lastSent) return;
      const previous = lastSent;
      lastSent = key;
      try {
        await deps.ipc.setWorkspaceLayout(layout);
      } catch (e) {
        // Try again at the next action instead of believing Rust has it.
        lastSent = lastSent === key ? previous : lastSent;
        deps.toasts.getState().show(toIpcError(e).message, { tone: "error", durationMs: 4000 });
      }
    }

    const scheduleFlush = () => {
      if (resizeTimer !== null) clearTimer(resizeTimer);
      resizeTimer = setTimer(() => {
        resizeTimer = null;
        void flush();
      }, resizeFlushMs);
    };

    return {
      ...initialState,

      applyLayout(layout, polls) {
        const s = get();
        const area = tileAreaOf(
          s.size,
          layout.items.some((i) => i.rect.state === "minimized"),
        );
        const ids = new Set(polls.filter(isShownInWorkspace).map((p) => p.config.pollId));
        const items = clampItems(itemsFromLayout(layout, ids, area), s.size, area);
        const minimizedOrder = [
          ...layout.minimizedOrder.filter((id) => items[id]?.state === "minimized"),
          ...Object.keys(items)
            .map(Number)
            .filter(
              (id) => items[id]?.state === "minimized" && !layout.minimizedOrder.includes(id),
            ),
        ];
        lastSent = keyOf(layout);
        set({
          items,
          minimizedOrder,
          tileMode: layout.tileMode,
          sidebar: {
            width: clampSidebarWidth(layout.sidebarWidth),
            collapsed: layout.sidebarCollapsed,
          },
          traffic: { expanded: layout.trafficExpanded, height: layout.trafficHeight },
          activeId: topVisibleId(items),
          loaded: false,
        });
        get().syncFromList(polls);
        set({ loaded: true });
      },

      syncFromList(polls) {
        const s = get();
        const plan = planSync(s.items, polls);
        if (plan.mount.length === 0 && plan.unmount.length === 0) {
          // The list order may have changed: tile mode follows it.
          if (s.tileMode) {
            commit({});
            if (!itemsEqual(s.items, get().items)) void flush();
          }
          return;
        }
        let items = { ...s.items };
        let minimizedOrder = s.minimizedOrder;
        for (const id of plan.unmount) {
          delete items[id];
          minimizedOrder = minimizedOrder.filter((m) => m !== id);
        }
        const pendingReveal = { ...s.pendingReveal };
        let z = topZ(items);
        let lastMounted: PollId | null = null;
        let revealedId: PollId | null = null;
        for (const poll of plan.mount) {
          const id = poll.config.pollId;
          const reveal = pendingReveal[id];
          // A reveal that came before the mount asks for the focus too (REV-006 m-7).
          if (id in pendingReveal) revealedId = id;
          delete pendingReveal[id];
          const area = tileAreaOf(s.size, hasMinimized(items));
          let item: SubWindowItem;
          if (reveal) {
            item = { rect: reveal, z: z++, state: "normal", restore: null };
          } else if (poll.workspace) {
            item = itemFromWorkspaceRect(poll.workspace, area, z++);
            if (item.state === "minimized") minimizedOrder = [...minimizedOrder, id];
          } else {
            // Before the workspace is measured the default size is used as it is.
            const slotArea = sizeKnown(s.size) ? area : { ...area, width: 640, height: 368 };
            item = { rect: nextSlotRect(items, slotArea), z: z++, state: "normal", restore: null };
          }
          items = { ...items, [id]: item };
          if (item.state !== "minimized") lastMounted = id;
        }
        items = clampItems(items, s.size, tileAreaOf(s.size, hasMinimized(items)));
        const stillActive = s.activeId !== null && !plan.unmount.includes(s.activeId);
        // A poll that appears (New poll, Show, dock) becomes the active sub-window; the polls that
        // are there from the snapshot do not take the focus.
        const activeId =
          s.loaded && lastMounted !== null ? lastMounted : stillActive ? s.activeId : null;
        set({
          pendingReveal,
          ...(revealedId !== null ? { focusRequest: { id: revealedId, seq: ++focusSeq } } : {}),
        });
        commit({ items, minimizedOrder, activeId });
        if (s.loaded) void flush();
      },

      unmount(id) {
        const s = get();
        if (!s.items[id]) return;
        const items = { ...s.items };
        delete items[id];
        commit({
          items,
          minimizedOrder: s.minimizedOrder.filter((m) => m !== id),
          activeId: s.activeId === id ? null : s.activeId,
        });
        // Tile mode tiles the rest again: the new rectangles are reported, because the list event
        // that follows this one finds nothing left to change (REV-006 n-3).
        if (s.tileMode && !itemsEqual(get().items, items)) void flush();
      },

      reveal(id, rect) {
        const s = get();
        if (!s.items[id]) {
          set({ pendingReveal: { ...s.pendingReveal, [id]: rect } });
          return;
        }
        activateNow(id, true);
        const item = get().items[id];
        if (rect && item?.state === "normal") {
          get().setRect(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
        void flush();
      },

      activate(id) {
        activateNow(id, false);
      },

      requestFocus(id) {
        if (!get().items[id]) return;
        set({ focusRequest: { id, seq: ++focusSeq } });
      },

      show(id) {
        if (!activateNow(id, true)) return false;
        void flush();
        return true;
      },

      setRect(id, rect) {
        const s = get();
        const item = s.items[id];
        if (!item) return;
        const placed = sizeKnown(s.size) ? clampRect(rect, s.size) : rect;
        if (item.state === "normal" && rectsEqual(item.rect, placed)) return;
        commit({
          items: { ...s.items, [id]: { ...item, rect: placed, state: "normal", restore: null } },
        });
      },

      swap(a, b) {
        const items = swapItems(get().items, a, b);
        if (items !== get().items) commit({ items });
      },

      minimize(id) {
        const s = get();
        const item = s.items[id];
        if (!item || item.state === "minimized") return;
        commit({
          items: { ...s.items, [id]: minimizeItem(item) },
          minimizedOrder: [...s.minimizedOrder.filter((m) => m !== id), id],
          activeId: s.activeId === id ? null : s.activeId,
        });
        void flush();
      },

      maximize(id) {
        const s = get();
        const item = s.items[id];
        if (item?.state !== "normal") return;
        let items = s.items;
        const other = maximizedIdOf(items);
        if (other !== null && other !== id) {
          items = { ...items, [other]: restoreItem(items[other] as SubWindowItem) };
        }
        items = { ...items, [id]: maximizeItem(items[id] as SubWindowItem, areaOf(items)) };
        commit({ items, activeId: id });
        void flush();
      },

      restore(id) {
        const s = get();
        const item = s.items[id];
        if (!item || item.state === "normal") return;
        if (item.state === "minimized") {
          activateNow(id, false);
        } else {
          commit({ items: { ...s.items, [id]: restoreItem(item) } });
        }
        void flush();
      },

      toggleMaximize(id) {
        const item = get().items[id];
        if (!item) return;
        if (item.state === "maximized") get().restore(id);
        else get().maximize(id);
      },

      minimizeAll() {
        const s = get();
        const ids = [
          ...deps.getListOrder().filter((id) => s.items[id]),
          ...Object.keys(s.items)
            .map(Number)
            .filter((id) => !deps.getListOrder().includes(id)),
        ].filter((id) => s.items[id]?.state !== "minimized");
        if (ids.length === 0) return;
        const items = { ...s.items };
        for (const id of ids) items[id] = minimizeItem(items[id] as SubWindowItem);
        commit({ items, minimizedOrder: [...s.minimizedOrder, ...ids], activeId: null });
        void flush();
      },

      restoreAll() {
        const s = get();
        let changed = false;
        const items = { ...s.items };
        for (const [key, item] of Object.entries(items)) {
          if (item.state !== "normal") {
            items[Number(key)] = restoreItem(item);
            changed = true;
          }
        }
        if (!changed) return;
        commit({ items, minimizedOrder: [] });
        void flush();
      },

      arrangeMinimized(listOrder) {
        const s = get();
        const rank = (id: PollId) => {
          const i = listOrder.indexOf(id);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        const sorted = [...s.minimizedOrder].sort((a, b) => rank(a) - rank(b));
        if (sorted.every((id, i) => id === s.minimizedOrder[i])) return;
        set({ minimizedOrder: sorted });
        void flush();
      },

      cycle(dir) {
        const s = get();
        const ids = deps
          .getListOrder()
          .filter((id) => s.items[id] && s.items[id]?.state !== "minimized");
        if (ids.length < 2) return;
        const next = cycleId(ids, s.activeId, dir);
        if (next !== null) get().show(next);
      },

      tile() {
        const s = get();
        lastOverflow = 0;
        const outcome = tileItems(s.items, deps.getListOrder(), areaOf(), {
          restoreMaximized: true,
        });
        // Tile mode is on before the commit, so the commit keeps the slots (and shows the toast).
        set({ tileMode: true });
        commit({ items: outcome.items });
        void flush();
      },

      cascade() {
        const s = get();
        lastOverflow = 0;
        // Tile mode is off before the commit, so the commit does not tile again. The active window
        // keeps the focus but is not raised (DES-002 2.8.4).
        set({ tileMode: false });
        commit({ items: cascadeItems(s.items, deps.getListOrder(), areaOf()) }, false);
        void flush();
      },

      setTileMode(on) {
        if (on) get().tile();
        else if (get().tileMode) {
          set({ tileMode: false });
          void flush();
        }
      },

      setSize(size) {
        const s = get();
        if (size.width === s.size.width && size.height === s.size.height) return;
        set({ size });
        const before = get().items;
        const clamped = clampItems(before, size, tileAreaOf(size, hasMinimized(before)));
        commit({ items: clamped });
        if (!itemsEqual(before, get().items)) scheduleFlush();
      },

      setSidebarWidth(px) {
        const width = clampSidebarWidth(px);
        if (width === get().sidebar.width) return;
        set((s) => ({ sidebar: { ...s.sidebar, width } }));
      },

      toggleSidebar() {
        set((s) => ({ sidebar: { ...s.sidebar, collapsed: !s.sidebar.collapsed } }));
        void flush();
      },

      setTrafficHeight(px) {
        const height = px === null ? null : clampTrafficHeight(px, windowHeight());
        if (height === get().traffic.height) return;
        set((s) => ({ traffic: { ...s.traffic, height } }));
      },

      setTrafficExpanded(expanded) {
        if (expanded === get().traffic.expanded) return;
        set((s) => ({ traffic: { ...s.traffic, expanded } }));
        void flush();
      },

      markFresh(id) {
        set({ freshId: id });
      },

      startTitleRename(id) {
        if (get().items[id]) set({ titleRenameId: id });
      },

      endTitleRename() {
        set({ titleRenameId: null });
      },

      flush,
      toLayout: layoutNow,

      dispose() {
        if (resizeTimer !== null) clearTimer(resizeTimer);
        resizeTimer = null;
      },
    };
  });
}

// ---- typed selectors ----
export const selectWorkspaceItems = (s: WorkspaceStore) => s.items;
export const selectActiveId = (s: WorkspaceStore) => s.activeId;
export const selectTileMode = (s: WorkspaceStore) => s.tileMode;
export const selectWorkspaceSize = (s: WorkspaceStore) => s.size;
export const selectMinimizedOrder = (s: WorkspaceStore) => s.minimizedOrder;
export const selectSidebar = (s: WorkspaceStore) => s.sidebar;
export const selectTraffic = (s: WorkspaceStore) => s.traffic;
export const selectItem = (id: PollId) => (s: WorkspaceStore) => s.items[id];
export const selectIsActive = (id: PollId) => (s: WorkspaceStore) => s.activeId === id;
export const selectFreshId = (s: WorkspaceStore) => s.freshId;
