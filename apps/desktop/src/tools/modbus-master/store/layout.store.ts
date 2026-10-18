// Window-level UI state that is not part of the workspace layout: the modal lock that switches the
// shortcuts off (DES-001 5.1) and the widths of the traffic table columns (DES-001 5.3). The
// sidebar, traffic panel and sub-window layout live in the workspace store.
import { createStore, type StoreApi } from "zustand/vanilla";
import { clampColumnWidth } from "./layout.logic";

export interface LayoutData {
  columnWidths: Record<string, number>;
  /**
   * Compact mode turns the sidebar into a rail (DES-002 2.9); the user can still open it for as
   * long as compact mode stays as it is. Ends when compact mode is toggled.
   */
  sidebarPeek: boolean;
  /** True while at least one modal holds a lock. */
  modalOpen: boolean;
  /** Number of open modals (for tests and diagnostics). */
  modalCount: number;
}

export interface LayoutActions {
  /** Clamped to the DES-001 5.3 minimum of the column. */
  setColumnWidth(id: string, px: number): void;
  setSidebarPeek(peek: boolean): void;
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
  return createStore<LayoutStore>()((set) => ({
    columnWidths: {},
    sidebarPeek: false,
    modalOpen: false,
    modalCount: 0,

    setColumnWidth: (id, px) =>
      set((s) => ({ columnWidths: { ...s.columnWidths, [id]: clampColumnWidth(id, px) } })),
    setSidebarPeek: (sidebarPeek) => set({ sidebarPeek }),
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

export const selectModalOpen = (s: LayoutStore) => s.modalOpen;
export const selectColumnWidths = (s: LayoutStore) => s.columnWidths;
