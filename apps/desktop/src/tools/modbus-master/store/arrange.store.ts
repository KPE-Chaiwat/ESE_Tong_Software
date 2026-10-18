// Arranging the popped-out poll windows (DES-002 2.8, 2.8.5, FE-002 task 21): Tile, Side by side,
// Stacked and Cascade, on each monitor in place or on one chosen display. The layout math runs in
// Rust (`mm_arrange_poll_windows`); this store keeps the monitor list and the chosen target (for the
// life of the window, not saved) and turns the result into the toasts of DES-002 4.
import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type { ArrangeLayout, ArrangeTarget, MonitorInfo } from "@/shared/ipc/modbus-master.types";
import type { WindowIpc } from "@/shared/ipc/window";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import { EACH_MONITOR } from "../lib/arrange-menu";
import { overflowToast } from "./workspace.logic";

export const MONITOR_GONE_TOAST = "That display is no longer connected.";
export const NO_NATIVE_TOAST = "No poll is open in its own window.";

export interface ArrangeState {
  monitors: MonitorInfo[];
  /** "Arrange on:" (default each monitor in place). Remembered for the life of the window. */
  target: ArrangeTarget;
  /** An arrange command is running. */
  pending: boolean;
  /** `listMonitors` answered at least once. */
  loaded: boolean;
}

export interface ArrangeActions {
  /** Reads the displays (when a menu opens, and when the chosen one disappeared). */
  loadMonitors(): Promise<void>;
  setTarget(target: ArrangeTarget): void;
  /** Arranges the connection's native windows on the target; the result becomes a toast. */
  arrange(layout: ArrangeLayout): Promise<void>;
}

export type ArrangeStore = ArrangeState & ArrangeActions;
export type ArrangeStoreApi = StoreApi<ArrangeStore>;

export interface ArrangeStoreDeps {
  ipc: Pick<ModbusMasterIpc, "arrangePollWindows">;
  windowIpc: Pick<WindowIpc, "listMonitors">;
  toasts: ToastStoreApi;
}

export function createArrangeStore(deps: ArrangeStoreDeps): ArrangeStoreApi {
  return createStore<ArrangeStore>()((set, get) => ({
    monitors: [],
    target: EACH_MONITOR,
    pending: false,
    loaded: false,

    async loadMonitors() {
      try {
        set({ monitors: await deps.windowIpc.listMonitors(), loaded: true });
      } catch {
        // The menu still offers "Each monitor (in place)"; a failed list is not worth a toast.
        set({ loaded: true });
      }
    },

    setTarget(target) {
      set({ target });
    },

    async arrange(layout) {
      if (get().pending) return;
      set({ pending: true });
      try {
        const result = await deps.ipc.arrangePollWindows(layout, get().target);
        if (result.arranged === 0) {
          deps.toasts.getState().show(NO_NATIVE_TOAST, { durationMs: 2000 });
        } else if (result.overflow > 0) {
          deps.toasts.getState().show(overflowToast(result.overflow), { durationMs: 3000 });
        }
      } catch (e) {
        const error = toIpcError(e);
        if (error.field === "monitor") {
          // The display went away: back to each monitor, and the list is read again.
          set({ target: EACH_MONITOR });
          deps.toasts.getState().show(MONITOR_GONE_TOAST, { tone: "error", durationMs: 4000 });
          void get().loadMonitors();
        } else {
          deps.toasts.getState().show(error.message, { tone: "error", durationMs: 4000 });
        }
      } finally {
        set({ pending: false });
      }
    },
  }));
}

export const selectArrangeTarget = (s: ArrangeStore) => s.target;
export const selectMonitors = (s: ArrangeStore) => s.monitors;
