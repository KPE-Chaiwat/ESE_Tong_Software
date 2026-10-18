// Closing the connection window W1 (DES-002 2.11, FE-002 task 20). With nothing unsaved it closes at
// once, with all its poll windows (Rust). With unsaved changes (the profile is modified, or a poll
// has unapplied setup edits in any host) it asks "Save changes?" first. The OS close request, Alt+F4
// and File > Close window all come here, so the answer is the same whichever way the user asks.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CloseDecision } from "@/shared/ipc/window";
import { needsWindowCloseConfirm, type WindowCloseSummary } from "./poll-host.logic";

export interface WindowCloseState {
  /** The dialog is open, with what it says. Null when nothing is asked. */
  asking: WindowCloseSummary | null;
  /** Save is running. */
  saving: boolean;
  /** Save is possible (the profile store of FE-002 task 23 provides it). */
  canSave: boolean;
}

export interface WindowCloseActions {
  /**
   * The window was asked to close. Resolves with "close" at once when nothing is unsaved, else
   * after the user answered. A second request while the dialog is open is answered "cancel", so
   * only the first one can close the window.
   */
  request(): Promise<CloseDecision>;
  /** Save, then close. Stays open when the save fails (the profile store shows why). */
  save(): Promise<void>;
  /** Don't save: close. */
  discard(): void;
  /** Cancel: the window stays open. */
  cancel(): void;
}

export type WindowCloseStore = WindowCloseState & WindowCloseActions;
export type WindowCloseStoreApi = StoreApi<WindowCloseStore>;

export interface WindowCloseStoreDeps {
  summary(): WindowCloseSummary;
  /** Saves the profile (as Ctrl+S does). True when it was saved. Absent: Save is not available yet. */
  save?(): Promise<boolean>;
}

export function createWindowCloseStore(deps: WindowCloseStoreDeps): WindowCloseStoreApi {
  let waiting: Promise<CloseDecision> | null = null;
  let answer: ((decision: CloseDecision) => void) | null = null;

  return createStore<WindowCloseStore>()((set, get) => {
    function finish(decision: CloseDecision) {
      const resolve = answer;
      answer = null;
      waiting = null;
      set({ asking: null, saving: false });
      resolve?.(decision);
    }

    return {
      asking: null,
      saving: false,
      canSave: deps.save !== undefined,

      request() {
        // A second request while the question is open (Alt+F4 twice) must not destroy the window
        // as well when the first one answers "close": it is answered "cancel" (REV-006 n-8).
        if (waiting) return Promise.resolve("cancel");
        const summary = deps.summary();
        if (!needsWindowCloseConfirm(summary)) return Promise.resolve("close");
        waiting = new Promise<CloseDecision>((resolve) => {
          answer = resolve;
        });
        set({ asking: summary, saving: false });
        return waiting;
      },

      async save() {
        if (!deps.save || get().asking === null || get().saving) return;
        set({ saving: true });
        let saved = false;
        try {
          saved = await deps.save();
        } catch {
          saved = false;
        }
        if (saved) finish("close");
        else if (get().asking !== null) set({ saving: false });
      },

      discard() {
        if (get().asking !== null) finish("close");
      },

      cancel() {
        if (get().asking !== null) finish("cancel");
      },
    };
  });
}

export const selectWindowCloseAsking = (s: WindowCloseStore) => s.asking;
