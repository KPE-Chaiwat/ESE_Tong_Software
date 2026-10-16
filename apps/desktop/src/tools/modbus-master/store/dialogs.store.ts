import { createStore, type StoreApi } from "zustand/vanilla";

export interface DialogsData {
  /** S3 Open profile dialog. */
  openProfileVisible: boolean;
  /** S4 Save profile as dialog. */
  saveAsVisible: boolean;
}

export interface DialogsActions {
  showOpenProfile(): void;
  hideOpenProfile(): void;
  /**
   * Shows S4 and resolves with true once the profile was saved, or false when the user cancelled.
   * A second request while S4 is open resolves false.
   */
  requestSaveAs(): Promise<boolean>;
  /** Called by S4: true after a successful save, false on Cancel. */
  resolveSaveAs(saved: boolean): void;
}

export type DialogsStore = DialogsData & DialogsActions;
export type DialogsStoreApi = StoreApi<DialogsStore>;

export function createDialogsStore(): DialogsStoreApi {
  let pending: ((saved: boolean) => void) | null = null;

  return createStore<DialogsStore>()((set, get) => ({
    openProfileVisible: false,
    saveAsVisible: false,

    showOpenProfile: () => set({ openProfileVisible: true }),
    hideOpenProfile: () => set({ openProfileVisible: false }),

    requestSaveAs() {
      if (pending) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        pending = resolve;
        set({ saveAsVisible: true });
      });
    },

    resolveSaveAs(saved) {
      const resolve = pending;
      pending = null;
      if (get().saveAsVisible) set({ saveAsVisible: false });
      resolve?.(saved);
    },
  }));
}
