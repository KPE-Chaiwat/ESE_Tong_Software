// The runtime of a native poll window W2 (DES-002 2.6, FE-002 task 19): one poll in its own window.
// Each Tauri window is its own JS context, so this creates the stores of the window and exactly one
// poll view runtime (`host: "native"`) that attaches its own channel. It knows nothing of the
// connection window: the link, the other polls and the workspace are Rust's and W1's.
//
// What it does besides the view:
//  - the window title (`{poll name} - {profile or "Untitled"} - {pill label}`);
//  - the OS close request: the Close poll dialog (S6), Keep or Delete, then Rust destroys the window;
//  - the handoff request of a list drag in W1: its handoff, or a refusal while a dialog is open;
//  - the preferences (compact mode, "Don't ask again") from the snapshot and `PrefsChanged`;
//  - its own live region: the connection and this poll's failures (DES-001 7).

import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type { ArrangeLayout, PollId } from "@/shared/ipc/modbus-master.types";
import type { WindowIpc } from "@/shared/ipc/window";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { focusedElementOrNull, restoreFocusAfterFailure } from "../lib/focus-after-failure";
import { MAX_POLLS } from "../lib/poll-names";
import type { ScaledProviderFactory } from "../lib/scaled";
import { nativePollTitle } from "../lib/titles";
import { connectionAnnouncement, enteredFailure } from "../store/announcements.logic";
import { type AnnouncerStoreApi, createAnnouncerStore } from "../store/announcer.store";
import { type ArrangeStoreApi, createArrangeStore } from "../store/arrange.store";
import { type ConnectionStoreApi, createConnectionStore } from "../store/connection.store";
import { createLayoutStore, type LayoutStoreApi } from "../store/layout.store";
import { nativeTitleState } from "../store/native-poll.logic";
import { createNativeReadyStore, type NativeReadyStoreApi } from "../store/native-ready.store";
import { isPollRunning, pollPillFor } from "../store/poll.logic";
import { type CommandOrigin, focusTargetAfterFailure } from "../store/poll-host.logic";
import { createPollHostStore, type PollHostStoreApi } from "../store/poll-host.store";
import { defaultPollInput } from "../store/poll-list.logic";
import { createPrefsStore, type PrefsStoreApi } from "../store/prefs.store";
import { createWriteStore, type WriteStoreApi } from "../store/write.store";
import { blurActiveEditor, type PollClipboard } from "./clipboard";
import { createPollViewRuntime, type PollViewRuntime } from "./poll-view-runtime";
import { openWriteDialog, watchWriteLink } from "./write-flow";

export interface NativePollStores {
  toasts: ToastStoreApi;
  /** This window's own view of the connection (role "poll": it cannot cancel or disconnect). */
  connection: ConnectionStoreApi;
  host: PollHostStoreApi;
  prefs: PrefsStoreApi;
  arrange: ArrangeStoreApi;
  /** The Write dialog (S2) of this window's poll. */
  write: WriteStoreApi;
  announcer: AnnouncerStoreApi;
  layout: LayoutStoreApi;
  /** Close handler registered and view attached (`data-ready` of the window element). */
  ready: NativeReadyStoreApi;
}

export interface NativePollActions {
  /** The toolbar Pause or Resume (Ctrl+P). */
  toggleActive(): Promise<void>;
  /** Ctrl+L: connect again when the link is down (idle or disconnected), nothing otherwise. */
  connectOrReconnect(): Promise<void>;
  /** "Connection window", Ctrl+Shift+M. */
  focusConnectionWindow(): Promise<void>;
  /** Dock to workspace (Ctrl+Shift+D). */
  dock(origin?: CommandOrigin): Promise<void>;
  /** "Show traffic for this poll": W1 comes to the front with the panel expanded. */
  showTraffic(): Promise<void>;
  /** Duplicate: the copy opens in its own window next to this one. */
  duplicate(): Promise<void>;
  /** Tile (Ctrl+Shift+T), Side by side, Stacked, Cascade for the popped-out windows. */
  arrange(layout: ArrangeLayout): Promise<void>;
  /** Compact mode (Ctrl+Shift+\). */
  toggleCompact(): Promise<void>;
  /** Write… (toolbar, Ctrl+E): opens the Write dialog prefilled from the focused row. */
  openWrite(): void;
  /** Ctrl+Shift+N: a new poll in its own window next to this one (H2). */
  newPoll(): Promise<void>;
  /** Ctrl+N: a new connection window. */
  newWindow(): Promise<void>;
  /** Ctrl+S and Ctrl+Shift+S: the whole profile is saved by the connection window. */
  requestSave(saveAs: boolean): Promise<void>;
}

export interface NativePollRuntime {
  pollId: PollId;
  ipc: ModbusMasterIpc;
  windowIpc: WindowIpc;
  stores: NativePollStores;
  /** The one poll view of this window (`host: "native"`). */
  view: PollViewRuntime;
  actions: NativePollActions;
  /** Attaches the view channel and registers the close handler. Safe to call twice. */
  init(): Promise<void>;
  dispose(): void;
}

export interface NativePollRuntimeOptions {
  pollId: PollId;
  clipboard?: PollClipboard;
  toastDurationMs?: number;
  warn?: (message: string) => void;
  /** Builds the scaled value provider of the poll (default: the real scale math). */
  createScaled?: ScaledProviderFactory;
  /** Commits or reverts the inline editor that has the focus, before a dock. */
  blurEditors?: () => void;
}

export function createNativePollRuntime(
  ipc: ModbusMasterIpc,
  windowIpc: WindowIpc,
  options: NativePollRuntimeOptions,
): NativePollRuntime {
  const { pollId } = options;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const toasts = createToastStore(
    options.toastDurationMs === undefined ? {} : { durationMs: options.toastDurationMs },
  );
  const announcer = createAnnouncerStore({
    onAnnounce: (text, assertive) => windowIpc.recordAnnouncement?.(text, assertive),
  });
  const layout = createLayoutStore();
  const ready = createNativeReadyStore();
  const connection = createConnectionStore({ ipc, role: "poll", warn });
  const prefs = createPrefsStore({ ipc, toasts });
  const arrange = createArrangeStore({ ipc, windowIpc, toasts });
  const blurEditors = options.blurEditors ?? blurActiveEditor;

  const view: PollViewRuntime = createPollViewRuntime({
    ipc,
    pollId,
    host: "native",
    connection,
    toasts,
    ...(options.clipboard ? { clipboard: options.clipboard } : {}),
    ...(options.createScaled ? { createScaled: options.createScaled } : {}),
    announce: (text) => announcer.getState().announce(text),
    lockModal: () => layout.getState().lockModal(),
    canPrepareBulk: () =>
      !layout.getState().modalOpen &&
      !host.getState().pending[pollId] &&
      host.getState().closing === null &&
      host.getState().deleting === null,
    warn,
    hostActions: {
      dock: (origin) => void actions.dock(origin),
      close: () => host.getState().requestClose(pollId),
      deletePoll: () => host.getState().requestDelete(pollId),
      showTraffic: () => void actions.showTraffic(),
      duplicate: () => void actions.duplicate(),
      write: (address) =>
        openWriteDialog(
          { write, connection, toasts, getView: (id) => (id === pollId ? view : undefined) },
          pollId,
          address,
        ),
      // The name is edited in the toolbar (the pencil there), not in the status line.
    },
    onSnapshot: (snapshot) =>
      prefs
        .getState()
        .applySnapshot({ compact: snapshot.compact, askOnPollClose: snapshot.askOnPollClose }),
    onPrefsChanged: (evt) => prefs.getState().applyPrefs(evt),
    onHandoffRequested: () => void host.getState().answerHandoffRequest(pollId),
  });

  const pollStore = view.stores.poll;
  const write = createWriteStore({
    ipc,
    getConfig: (id) => (id === pollId ? pollStore.getState().config : null),
    isLinkUp: () => connection.getState().state === "connected",
  });
  const host = createPollHostStore({
    ipc,
    toasts,
    describe: (id) => {
      const s = pollStore.getState();
      return id === pollId && s.config && !s.removed
        ? {
            name: s.config.name,
            host: "native",
            open: true,
            hasUnappliedEdits: s.hasUnappliedEdits,
            polling: isPollRunning(s.state),
          }
        : null;
    },
    askOnPollClose: () => prefs.getState().askOnPollClose,
    setAskOnPollClose: (enabled) => prefs.getState().setAskOnPollClose(enabled),
    getHandoff: () => view.stores.ui.getState().toHandoff(),
    blurEditors,
    markViewPending: (_id, kind) => pollStore.getState().markPending(kind),
    isModalOpen: () => layout.getState().modalOpen,
  });

  const disposers: Array<() => void> = [];
  // A link-lost write result is emptied once the link is back (DES-001 2.5).
  disposers.push(watchWriteLink(connection, write));

  // The live region of this window: the connection, and this poll when it starts to fail.
  disposers.push(
    connection.subscribe((s, prev) => {
      if (s.revision === prev.revision) return;
      announcer.getState().announce(connectionAnnouncement(s.state, s.reason, s.connection), {
        assertive: s.state === "disconnected",
      });
    }),
    pollStore.subscribe((s, prev) => {
      if (!s.config || !enteredFailure(prev.state, s.state)) return;
      const hasData = view.stores.data.getState().values !== null;
      announcer
        .getState()
        .announce(`${s.config.name}: ${pollPillFor(s.state, s.exceptionCode, hasData).label}.`);
    }),
  );

  // The title follows the poll name, the profile name and the state of the poll or the link.
  const syncTitle = () => {
    const s = pollStore.getState();
    if (!s.config) return;
    const state = nativeTitleState(connection.getState().state, s.state);
    const label = pollPillFor(state, s.exceptionCode);
    const title = nativePollTitle(s.config.name, s.profileName, label.label);
    if (globalThis.document) document.title = title;
    void windowIpc.setTitle(title).catch(() => {});
  };
  let lastTitle = "";
  const titleKey = () => {
    const s = pollStore.getState();
    return `${s.config?.name}|${s.profileName}|${s.state}|${s.exceptionCode}|${connection.getState().state}`;
  };
  const maybeSyncTitle = () => {
    const key = titleKey();
    if (key === lastTitle) return;
    lastTitle = key;
    syncTitle();
  };
  disposers.push(pollStore.subscribe(maybeSyncTitle), connection.subscribe(maybeSyncTitle));

  const fail = (e: unknown) =>
    toasts.getState().show(toIpcError(e).message, { tone: "error", durationMs: 4000 });

  const actions: NativePollActions = {
    toggleActive: () => view.actions.toggleActive(),
    async connectOrReconnect() {
      const state = connection.getState().state;
      if (state === "idle" || state === "disconnected") await connection.getState().reconnect();
    },
    async focusConnectionWindow() {
      try {
        await ipc.focusConnectionWindow();
      } catch (e) {
        fail(e);
      }
    },
    async dock(origin = "button") {
      const previous = focusedElementOrNull();
      const docked = await host.getState().dock(pollId);
      if (docked) return;
      // The window stays: the focus goes back to the control that started the dock (REPORT-007 D9).
      restoreFocusAfterFailure({
        target: focusTargetAfterFailure(origin, "native"),
        host: "native",
        pollId,
        previous,
        requestGridFocus: () => {},
      });
    },
    async showTraffic() {
      try {
        await ipc.showTraffic(pollId);
      } catch (e) {
        fail(e);
      }
    },
    async duplicate() {
      try {
        await ipc.duplicatePoll(pollId);
      } catch (e) {
        fail(e);
      }
    },
    arrange: (l) => arrange.getState().arrange(l),
    toggleCompact: () => prefs.getState().toggleCompact(),
    openWrite: () => view.hostActions.write?.(null),
    async newPoll() {
      // This window knows no other poll names: try "Poll 1", "Poll 2", ... until Rust accepts one.
      for (let n = 1; n <= MAX_POLLS + 1; n += 1) {
        try {
          await ipc.addPoll(defaultPollInput(`Poll ${n}`), "native");
          return;
        } catch (e) {
          const error = toIpcError(e);
          if (error.field === "name") continue;
          if (error.field === "polls") toasts.getState().show(error.message, { durationMs: 2000 });
          else fail(e);
          return;
        }
      }
    },
    async newWindow() {
      try {
        await windowIpc.openToolWindow("modbus-master");
      } catch (e) {
        toasts.getState().show(`Could not open a new window: ${toIpcError(e).message}`, {
          tone: "error",
          durationMs: 4000,
        });
      }
    },
    async requestSave(saveAs) {
      try {
        await ipc.requestSave(saveAs);
      } catch (e) {
        fail(e);
      }
    },
  };

  // Connection errors (a rejected Reconnect) are shown, never swallowed.
  disposers.push(
    connection.subscribe((s, prev) => {
      if (s.commandError === null || s.commandError === prev.commandError) return;
      toasts.getState().show(s.commandError, { tone: "error", durationMs: 4000 });
      connection.getState().clearCommandError();
    }),
  );

  let started: Promise<void> | null = null;
  let stopClosing: (() => void) | null = null;
  let disposed = false;

  return {
    pollId,
    ipc,
    windowIpc,
    stores: { toasts, connection, host, prefs, arrange, write, announcer, layout, ready },
    view,
    actions,
    init() {
      started ??= (async () => {
        // The OS close request and Alt+F4: S6 decides, Rust destroys the window afterwards.
        const closeHandlerRegistered = windowIpc
          .onCloseRequested(() => {
            // A window whose view never attached, was detached or whose poll is gone has nothing to
            // ask about: the user can always close it (REV-006 m-5).
            const s = pollStore.getState();
            if (s.config === null || s.removed || s.attach === "detached") return "close";
            host.getState().requestClose(pollId);
            return "cancel";
          })
          .then((off) => {
            if (disposed) off();
            else stopClosing = off;
          })
          .catch(() => {});
        await view.init();
        await closeHandlerRegistered;
        maybeSyncTitle();
        void arrange.getState().loadMonitors();
        if (!disposed) ready.getState().markReady();
      })();
      return started;
    },
    dispose() {
      disposed = true;
      stopClosing?.();
      stopClosing = null;
      for (const off of disposers.splice(0)) off();
      view.dispose();
      toasts.getState().clear();
    },
  };
}
