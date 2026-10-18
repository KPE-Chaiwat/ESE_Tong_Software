// Whether a native poll window is ready to be driven (REPORT-003 section 5, item 2): its close
// handler is registered with the window and its poll view has attached. A test (or a user script)
// reads it as `data-ready="true"` on the window element.
import { createStore, type StoreApi } from "zustand/vanilla";

export interface NativeReadyState {
  /** The OS close request is intercepted (S6) and the attach has finished, with or without an error. */
  ready: boolean;
}

export interface NativeReadyActions {
  markReady(): void;
  reset(): void;
}

export type NativeReadyStore = NativeReadyState & NativeReadyActions;
export type NativeReadyStoreApi = StoreApi<NativeReadyStore>;

export function createNativeReadyStore(): NativeReadyStoreApi {
  return createStore<NativeReadyStore>()((set) => ({
    ready: false,
    markReady: () => set({ ready: true }),
    reset: () => set({ ready: false }),
  }));
}
