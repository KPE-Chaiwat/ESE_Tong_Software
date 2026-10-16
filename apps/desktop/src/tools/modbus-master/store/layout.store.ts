import { createStore, type StoreApi } from "zustand/vanilla";
import {
  clampColumnWidth,
  clampTrafficHeightPct,
  DEFAULT_TRAFFIC_HEIGHT_PCT,
  DEFAULT_VIEWPORT_HEIGHT_PX,
  pctToPx,
  pxToPct,
} from "./layout.logic";

export interface LayoutData {
  setupOpen: boolean;
  trafficCollapsed: boolean;
  /** Traffic panel height as a percentage of the window height. */
  trafficHeightPct: number;
  /** Window height in px, needed to apply the 120px minimum. */
  viewportHeight: number;
  columnWidths: Record<string, number>;
  /** True while at least one modal holds a lock. */
  modalOpen: boolean;
  /** Number of open modals (for tests and diagnostics). */
  modalCount: number;
}

export interface LayoutActions {
  toggleSetup(): void;
  toggleTraffic(): void;
  setViewportHeight(px: number): void;
  /** Clamped to 120px .. 70%. */
  setTrafficHeight(pct: number): void;
  setTrafficHeightPx(px: number): void;
  /** Moves the splitter by `deltaPx` (positive grows the traffic panel). */
  nudgeTrafficHeight(deltaPx: number): void;
  resetTrafficHeight(): void;
  /** Clamped to the DES-001 5.3 minimum of the column. */
  setColumnWidth(id: string, px: number): void;
  /**
   * A modal opened: returns the function that releases its lock. Every modal has its own lock,
   * so a confirm on top of a dialog cannot unlock the shortcuts when it closes (REV-002 m3).
   * Releasing twice is harmless.
   */
  lockModal(): () => void;
}

export type LayoutStore = LayoutData & LayoutActions;
export type LayoutStoreApi = StoreApi<LayoutStore>;

export function createLayoutStore(): LayoutStoreApi {
  const locks = new Set<symbol>();
  return createStore<LayoutStore>()((set, get) => ({
    setupOpen: true,
    trafficCollapsed: false,
    trafficHeightPct: DEFAULT_TRAFFIC_HEIGHT_PCT,
    viewportHeight: DEFAULT_VIEWPORT_HEIGHT_PX,
    columnWidths: {},
    modalOpen: false,
    modalCount: 0,

    toggleSetup: () => set((s) => ({ setupOpen: !s.setupOpen })),
    toggleTraffic: () => set((s) => ({ trafficCollapsed: !s.trafficCollapsed })),
    setViewportHeight: (px) =>
      set((s) => ({
        viewportHeight: px,
        trafficHeightPct: clampTrafficHeightPct(s.trafficHeightPct, px),
      })),
    setTrafficHeight: (pct) =>
      set((s) => ({ trafficHeightPct: clampTrafficHeightPct(pct, s.viewportHeight) })),
    setTrafficHeightPx: (px) => get().setTrafficHeight(pxToPct(px, get().viewportHeight)),
    nudgeTrafficHeight: (deltaPx) => {
      const { trafficHeightPct, viewportHeight } = get();
      get().setTrafficHeightPx(pctToPx(trafficHeightPct, viewportHeight) + deltaPx);
    },
    resetTrafficHeight: () =>
      set((s) => ({
        trafficHeightPct: clampTrafficHeightPct(DEFAULT_TRAFFIC_HEIGHT_PCT, s.viewportHeight),
      })),
    setColumnWidth: (id, px) =>
      set((s) => ({ columnWidths: { ...s.columnWidths, [id]: clampColumnWidth(id, px) } })),
    lockModal() {
      const token = Symbol("modal");
      locks.add(token);
      set({ modalOpen: true, modalCount: locks.size });
      return () => {
        if (!locks.delete(token)) return;
        set({ modalOpen: locks.size > 0, modalCount: locks.size });
      };
    },
  }));
}

export const selectSetupOpen = (s: LayoutStore) => s.setupOpen;
export const selectTrafficCollapsed = (s: LayoutStore) => s.trafficCollapsed;
export const selectTrafficHeightPct = (s: LayoutStore) => s.trafficHeightPct;
export const selectModalOpen = (s: LayoutStore) => s.modalOpen;
export const selectColumnWidths = (s: LayoutStore) => s.columnWidths;
