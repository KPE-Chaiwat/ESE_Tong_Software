// How a poll view is hosted and closed (DES-002 2.5, 2.10.7, 2.11, FE-002 task 20). One store per
// webview: W1 shows polls, pops them out and docks native polls dropped from the list; a native
// window docks its own poll and answers the handoff request. Both ask before closing (S6) and
// before deleting (S7).
//
// Rust owns where a poll lives. These actions only send the user's request and show what went
// wrong; the result arrives as `PollListChanged`, `RevealPoll` and `ViewDetached`. A pop out keeps
// the sub-window mounted until the command resolves (the control shows a spinner), and a failure
// leaves everything where it was (Rust puts the host back, the sub-window remounts).
import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type {
  PollHostKind,
  PollId,
  PopOutAnchor,
  ShowPollPlacement,
  WorkspaceRect,
} from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import {
  type CloseSnapshot,
  closeSnapshot,
  dockFailedToast,
  handoffRefusedToast,
  popOutFailedToast,
  poppedOutAnnouncement,
} from "./poll-host.logic";

export type PollHostPending = "close" | "delete" | "show" | "popOut" | "dock";

export interface PollHostState {
  /** The poll whose Close poll dialog (S6) is open. */
  closing: PollId | null;
  /**
   * What S6 says, read when it opened and kept until it closes (DES-002 2.11, revision 9): a state
   * change of the poll meanwhile does not change the text. null while S6 is closed.
   */
  closeBody: CloseSnapshot | null;
  /** The poll whose Delete poll confirm (S7) is open. */
  deleting: PollId | null;
  pending: Record<PollId, PollHostPending | null>;
  /** The last pop out command that was rejected, and when (ms): its host change back is no dock. */
  lastPopOutFailure: { id: PollId; at: number } | null;
}

export interface DockOptions {
  /**
   * W1 docks a native poll on its behalf (a list drag, the list menu): Rust asks that window for
   * its handoff and refuses when a dialog is open there. Without it the caller is the native
   * window and sends its own handoff.
   */
  requestHandoff?: boolean;
  workspaceRect?: WorkspaceRect | null;
}

export interface PollHostActions {
  /**
   * Close (`✕`, Ctrl+F4, menus, the OS close of a native window): opens S6, or keeps the poll at
   * once when "Don't ask again" was chosen for this connection window.
   */
  requestClose(id: PollId): void;
  /** S6 answer. `dontAskAgain` keeps later closes without asking (W1 lifetime). */
  confirmClose(choice: "keep" | "delete", dontAskAgain: boolean): Promise<void>;
  cancelClose(): void;
  requestDelete(id: PollId): void;
  confirmDelete(): Promise<void>;
  cancelDelete(): void;

  /** Show (H12-H14), optionally at a drop rectangle (H15). */
  show(id: PollId, placement?: ShowPollPlacement | null): Promise<boolean>;
  /** Pop out (H4): button, menu, Ctrl+Shift+O. Returns true when the native window opened. */
  popOut(id: PollId, anchor: PopOutAnchor): Promise<boolean>;
  /** Dock (H5, H15): button, Ctrl+Shift+D, the list menu, a list drag. Returns true when docked. */
  dock(id: PollId, options?: DockOptions): Promise<boolean>;
  /** The answer of a native window to `HandoffRequested`: its handoff, or null when a dialog is open. */
  answerHandoffRequest(id: PollId): Promise<void>;
}

export type PollHostStore = PollHostState & PollHostActions;
export type PollHostStoreApi = StoreApi<PollHostStore>;

export interface PollHostStoreDeps {
  ipc: Pick<
    ModbusMasterIpc,
    "closePollView" | "removePoll" | "showPoll" | "popOutPoll" | "dockPoll" | "provideHandoff"
  >;
  toasts: ToastStoreApi;
  /**
   * The poll's name, where it lives and what S6 says about it (unapplied setup edits; whether its
   * state is running), or null when it does not exist (any more).
   */
  describe(id: PollId): {
    name: string;
    host: PollHostKind;
    open: boolean;
    hasUnappliedEdits: boolean;
    polling: boolean;
  } | null;
  askOnPollClose(): boolean;
  setAskOnPollClose(enabled: boolean): Promise<void> | void;
  /** Reports the workspace layout before the view goes away, so Rust keeps its rectangle. W1 only. */
  flushLayout?(): Promise<void> | void;
  /** The handoff of the poll's view (`PollViewHandoffV1` JSON), or null when no view holds one. */
  getHandoff?(id: PollId): string | null;
  /** Commits or reverts the inline editor that has the focus (DES-002 2.5.4). */
  blurEditors?(): void;
  /** Shows the spinner of the pop out or dock control of the view. */
  markViewPending?(id: PollId, kind: "popOut" | "dock" | null): void;
  /** A modal is open in this window: pop out and dock are unavailable (DES-002 2.5.4). */
  isModalOpen?(): boolean;
  announce?(text: string): void;
}

export function createPollHostStore(deps: PollHostStoreDeps): PollHostStoreApi {
  return createStore<PollHostStore>()((set, get) => {
    const setPending = (id: PollId, value: PollHostPending | null) =>
      set((s) => ({ pending: { ...s.pending, [id]: value } }));
    const toastError = (text: string) =>
      deps.toasts.getState().show(text, { tone: "error", durationMs: 4000 });

    async function run(id: PollId, kind: PollHostPending, command: () => Promise<void>) {
      setPending(id, kind);
      try {
        await command();
      } catch (e) {
        toastError(toIpcError(e).message);
      } finally {
        setPending(id, null);
      }
    }

    // `pending` is set before the first await, so a second trigger while the layout is being
    // reported (a double click, key repeat) is ignored (REV-006 m-1).
    const keep = (id: PollId) =>
      run(id, "close", async () => {
        await deps.flushLayout?.();
        await deps.ipc.closePollView(id, true);
      });

    const modalOpen = () => (deps.isModalOpen?.() ?? false) || get().closing !== null;

    return {
      closing: null,
      closeBody: null,
      deleting: null,
      pending: {},
      lastPopOutFailure: null,

      requestClose(id) {
        if (!deps.describe(id) || get().pending[id]) return;
        if (!deps.askOnPollClose()) {
          void keep(id);
          return;
        }
        const info = deps.describe(id);
        if (!info) return;
        set({ closing: id, closeBody: closeSnapshot(info.name, info) });
      },

      async confirmClose(choice, dontAskAgain) {
        const id = get().closing;
        if (id === null) return;
        set({ closing: null, closeBody: null });
        if (dontAskAgain) void deps.setAskOnPollClose(false);
        if (choice === "keep") await keep(id);
        else await run(id, "close", () => deps.ipc.closePollView(id, false));
      },

      cancelClose() {
        set({ closing: null, closeBody: null });
      },

      requestDelete(id) {
        if (deps.describe(id)) set({ deleting: id });
      },

      async confirmDelete() {
        const id = get().deleting;
        if (id === null) return;
        set({ deleting: null });
        await run(id, "delete", () => deps.ipc.removePoll(id));
      },

      cancelDelete() {
        set({ deleting: null });
      },

      async show(id, placement = null) {
        const info = deps.describe(id);
        if (!info || get().pending[id] === "show") return false;
        setPending(id, "show");
        try {
          await deps.ipc.showPoll(id, placement);
          return true;
        } catch (e) {
          const error = toIpcError(e);
          if (placement && info.host === "native" && info.open && error.field === "handoff") {
            deps.toasts.getState().show(handoffRefusedToast(info.name), { durationMs: 3000 });
          } else {
            toastError(info.host === "native" ? popOutFailedToast(error.message) : error.message);
          }
          return false;
        } finally {
          setPending(id, null);
        }
      },

      async popOut(id, anchor) {
        const info = deps.describe(id);
        if (!info || get().pending[id] || modalOpen()) return false;
        if (info.host !== "workspace" || !info.open) return false;
        // Busy first (REV-006 m-1): the layout report below is an await.
        setPending(id, "popOut");
        deps.markViewPending?.(id, "popOut");
        try {
          // An inline editor commits or reverts first, then the handoff is read.
          deps.blurEditors?.();
          await deps.flushLayout?.();
          const handoff = deps.getHandoff?.(id) ?? null;
          await deps.ipc.popOutPoll(id, anchor, handoff);
          deps.announce?.(poppedOutAnnouncement(info.name));
          return true;
        } catch (e) {
          set({ lastPopOutFailure: { id, at: Date.now() } });
          toastError(popOutFailedToast(toIpcError(e).message));
          return false;
        } finally {
          setPending(id, null);
          deps.markViewPending?.(id, null);
        }
      },

      async dock(id, options = {}) {
        const info = deps.describe(id);
        if (!info || get().pending[id]) return false;
        const requestHandoff = options.requestHandoff ?? false;
        if (!requestHandoff && modalOpen()) return false;
        if (!requestHandoff) deps.blurEditors?.();
        const handoff = requestHandoff ? null : (deps.getHandoff?.(id) ?? null);
        setPending(id, "dock");
        deps.markViewPending?.(id, "dock");
        try {
          await deps.ipc.dockPoll(id, handoff, requestHandoff, options.workspaceRect ?? null);
          return true;
        } catch (e) {
          const error = toIpcError(e);
          if (requestHandoff && error.field === "handoff") {
            deps.toasts.getState().show(handoffRefusedToast(info.name), { durationMs: 3000 });
          } else {
            toastError(dockFailedToast(error.message));
          }
          return false;
        } finally {
          setPending(id, null);
          deps.markViewPending?.(id, null);
        }
      },

      async answerHandoffRequest(id) {
        // A dialog in this window refuses: the dock would lose what the user is answering.
        let handoff: string | null = null;
        if (!modalOpen() && get().deleting === null) {
          deps.blurEditors?.();
          handoff = deps.getHandoff?.(id) ?? null;
        }
        try {
          await deps.ipc.provideHandoff(id, handoff);
        } catch {
          // A late answer is ignored by Rust; nothing to show.
        }
      },
    };
  });
}

export const selectClosing = (s: PollHostStore) => s.closing;
export const selectDeleting = (s: PollHostStore) => s.deleting;
export const selectCloseBody = (s: PollHostStore) => s.closeBody;
