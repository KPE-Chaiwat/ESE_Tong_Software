// Preferences Rust owns for the whole connection (DES-002 2.9, 2.11, FE-002 task 21): compact mode
// ("Collapse setup panels") and "Don't ask again" of the Close poll dialog. Both reach W1 and every
// view in `PrefsChanged`; the user's change is applied at once and rolled back when rejected.
import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type { Prefs } from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";

export interface PrefsState {
  askOnPollClose: boolean;
  compact: boolean;
}

export interface PrefsActions {
  /** The session snapshot. */
  applySnapshot(prefs: PrefsState): void;
  /** `PrefsChanged`. */
  applyPrefs(evt: Pick<Prefs, "askOnPollClose" | "compact">): void;
  setAskOnPollClose(enabled: boolean): Promise<void>;
  setCompact(enabled: boolean): Promise<void>;
  toggleCompact(): Promise<void>;
}

export type PrefsStore = PrefsState & PrefsActions;
export type PrefsStoreApi = StoreApi<PrefsStore>;

export interface PrefsStoreDeps {
  ipc: Pick<ModbusMasterIpc, "setCompactMode" | "setAskOnPollClose">;
  toasts: ToastStoreApi;
}

export function createPrefsStore(deps: PrefsStoreDeps): PrefsStoreApi {
  return createStore<PrefsStore>()((set, get) => {
    async function change<K extends keyof PrefsState>(
      key: K,
      value: PrefsState[K],
      send: () => Promise<void>,
    ): Promise<void> {
      const before = get()[key];
      if (before === value) return;
      set({ [key]: value } as Pick<PrefsState, K>);
      try {
        await send();
      } catch (e) {
        if (get()[key] === value) set({ [key]: before } as Pick<PrefsState, K>);
        deps.toasts.getState().show(toIpcError(e).message, { tone: "error", durationMs: 4000 });
      }
    }

    return {
      askOnPollClose: true,
      compact: false,

      applySnapshot: (prefs) =>
        set({ askOnPollClose: prefs.askOnPollClose, compact: prefs.compact }),
      applyPrefs: (evt) => set({ askOnPollClose: evt.askOnPollClose, compact: evt.compact }),

      setAskOnPollClose: (enabled) =>
        change("askOnPollClose", enabled, () => deps.ipc.setAskOnPollClose(enabled)),
      setCompact: (enabled) => change("compact", enabled, () => deps.ipc.setCompactMode(enabled)),
      toggleCompact: () => get().setCompact(!get().compact),
    };
  });
}

export const selectCompact = (s: PrefsStore) => s.compact;
export const selectAskOnPollClose = (s: PrefsStore) => s.askOnPollClose;
