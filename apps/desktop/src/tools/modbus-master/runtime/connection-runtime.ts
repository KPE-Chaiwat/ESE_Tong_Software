// The runtime of the connection window W1 (DES-002 2.1, FE-002 ground rules): every store of the
// window, the wiring between them, the session channel, and one poll view runtime per workspace
// sub-window. Each Tauri window is its own JS context, so there is exactly one of these per window.
//
// Wiring:
//  - session events -> connection, poll list, traffic (batched), workspace, prefs;
//  - poll list changes -> workspace (mount, unmount, re-tile) and the traffic filter names;
//  - workspace changes -> poll views are disposed when their sub-window goes away; the sidebar
//    selection follows the active sub-window;
//  - connection transitions -> the CONNECTION section, the live region;
//  - poll failures -> the live region (once per poll, one message for a burst);
//  - command errors -> toasts, backend field messages -> the form.
// Events that arrive before the snapshot are held and replayed after it (REV-002 M3).
//
// Hosting (DES-002 2.5, FE-002 task 20): the poll host store shows, pops out and docks polls and
// closes their views; the window close store asks before W1 closes; the arrange store arranges the
// popped-out windows (task 21). Rust owns where a poll lives: these only send requests.

import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type {
  ArrangeLayout,
  PollConfig,
  PollHostKind,
  PollId,
  PollState,
  PollSummary,
  PopOutAnchor,
  SessionEvent,
  SessionSnapshot,
  TrafficFrame,
  WorkspaceRect,
} from "@/shared/ipc/modbus-master.types";
import type { WindowIpc } from "@/shared/ipc/window";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { CLIPBOARD_ERROR, copiedToast } from "../lib/copy";
import { insertAmongSubset, type Point, placeInSubset } from "../lib/drag-math";
import { focusedElementOrNull, restoreFocusAfterFailure } from "../lib/focus-after-failure";
import { formatHexBytes } from "../lib/format";
import { pollRowCopyText } from "../lib/poll-row";
import type { ScaledProviderFactory } from "../lib/scaled";
import {
  connectionAnnouncement,
  enteredFailure,
  FAILURE_WINDOW_MS,
  type FailureEntry,
  failureAnnouncement,
} from "../store/announcements.logic";
import { type AnnouncerStoreApi, createAnnouncerStore } from "../store/announcer.store";
import { type ArrangeStoreApi, createArrangeStore } from "../store/arrange.store";
import { type ConfirmStoreApi, createConfirmStore } from "../store/confirm.store";
import { type ConnectionStoreApi, createConnectionStore } from "../store/connection.store";
import {
  type ConnectionDraftStoreApi,
  createConnectionDraftStore,
} from "../store/connection-draft.store";
import {
  type ConnectionSectionStoreApi,
  createConnectionSectionStore,
} from "../store/connection-section.store";
import { createDialogsStore, type DialogsStoreApi } from "../store/dialogs.store";
import { announce as dragAnnounce, type ListPlacement } from "../store/drag.logic";
import { createDragStore, type DragStoreApi } from "../store/drag.store";
import { createLayoutStore, type LayoutStoreApi } from "../store/layout.store";
import { isPollRunning, pollPillFor } from "../store/poll.logic";
import {
  type CommandOrigin,
  focusTargetAfterFailure,
  hostChangeAnnouncement,
} from "../store/poll-host.logic";
import { createPollHostStore, type PollHostStoreApi } from "../store/poll-host.store";
import {
  createPollListStore,
  type PollListStoreApi,
  pollNames,
  selectNativeCount,
  unappliedNames,
} from "../store/poll-list.store";
import { createPrefsStore, type PrefsStoreApi } from "../store/prefs.store";
import { contentSignature, sameConfigs } from "../store/profile.logic";
import { createProfileInfoStore, type ProfileInfoStoreApi } from "../store/profile-info.store";
import { createProfilesStore, type ProfilesStoreApi } from "../store/profiles.store";
import { createSerialPortsStore, type SerialPortsStoreApi } from "../store/serial-ports.store";
import {
  createBatcher,
  type FrameScheduler,
  framesToTsvWithPoll,
  TRAFFIC_CAPACITY,
} from "../store/traffic.logic";
import { createTrafficStore, type TrafficStoreApi } from "../store/traffic.store";
import { createWindowCloseStore, type WindowCloseStoreApi } from "../store/window-close.store";
import { shownSignature, tiledIds, topZ } from "../store/workspace.logic";
import { createWorkspaceStore, type WorkspaceStoreApi } from "../store/workspace.store";
import { createWriteStore, type WriteStoreApi } from "../store/write.store";
import { blurActiveEditor, browserClipboard, type PollClipboard } from "./clipboard";
import { type ConnectionFormHolder, createConnectionFormHolder } from "./connection-form";
import { createPollViewRuntime, type PollViewRuntime } from "./poll-view-runtime";
import { createProfileFlow, type ProfileFlow } from "./profile-flow";
import { openWriteDialog, watchWriteLink } from "./write-flow";

export interface ConnectionStores {
  toasts: ToastStoreApi;
  connection: ConnectionStoreApi;
  /** The connection settings typed in the CONNECTION section. */
  draft: ConnectionDraftStoreApi;
  section: ConnectionSectionStoreApi;
  pollList: PollListStoreApi;
  traffic: TrafficStoreApi;
  workspace: WorkspaceStoreApi;
  drag: DragStoreApi;
  prefs: PrefsStoreApi;
  host: PollHostStoreApi;
  windowClose: WindowCloseStoreApi;
  arrange: ArrangeStoreApi;
  /** The Write dialog (S2): one per window, opened from any sub-window. */
  write: WriteStoreApi;
  announcer: AnnouncerStoreApi;
  profile: ProfileInfoStoreApi;
  /** The saved profiles of the Open profile dialog (S3). */
  profiles: ProfilesStoreApi;
  /** S3 and S4 are open. */
  dialogs: DialogsStoreApi;
  /** The confirm dialogs of the profile flow (S5). */
  confirm: ConfirmStoreApi;
  serialPorts: SerialPortsStoreApi;
  layout: LayoutStoreApi;
}

/** One poll view runtime per workspace sub-window, created when the frame first asks for it. */
export interface ViewRegistry {
  get(pollId: PollId): PollViewRuntime;
  peek(pollId: PollId): PollViewRuntime | undefined;
  /** Detaches and forgets the view of a sub-window that went away. */
  dispose(pollId: PollId): void;
  ids(): PollId[];
  /**
   * Replaces the view of a sub-window that stays (a pop out that failed): the old runtime is
   * disposed, `get` creates a new one that attaches again, and the frame is told to render it.
   */
  refresh(pollId: PollId): void;
  /** Changes whenever `refresh` replaced the view of this poll (for `useSyncExternalStore`). */
  epoch(pollId: PollId): number;
  subscribe(listener: () => void): () => void;
}

export interface ConnectionActions {
  /** Ctrl+L: connect, cancel, disconnect or reconnect, by state. */
  toggleConnection(): Promise<void>;
  /** Validates the form, then connects (also Reconnect). */
  connect(): Promise<void>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<void>;
  dismiss(): Promise<void>;
  /** New poll in the workspace; its setup opens with the focus in Name. */
  newPoll(): Promise<void>;
  /** Pause all when any poll runs, else Resume all. */
  togglePauseAll(): Promise<void>;
  /** Pause or resume one poll. */
  togglePoll(id: PollId): Promise<void>;
  /** Click, Enter, menu entry (H12-H14): shows the poll in whichever host it is. */
  showPoll(id: PollId): Promise<void>;
  /**
   * Expands the traffic panel with the filter on this poll. `focusFilter` also moves the keyboard
   * focus to the Filter select (the request came from a native window; DES-002 2.2.5).
   */
  showTrafficFor(id: PollId, opts?: { focusFilter?: boolean }): void;
  toggleTraffic(): void;
  clearTraffic(): void;
  /** Copies the selected traffic frame as a tab separated line ("Copied 1 frame."). */
  copyFrame(): Promise<void>;
  /** Copies the bytes of the selected traffic frame as hex. */
  copyFrameBytes(): Promise<void>;
  /** Connection > Reset all counters: the total, the writes and every poll. */
  resetAllCounters(): Promise<void>;
  /** Brings every popped-out window to the front. */
  showPollWindows(): Promise<void>;
  newWindow(): Promise<void>;
  /** Window > Arrange minimized. */
  arrangeMinimized(): void;
  /** Pop out (button, menu, Ctrl+Shift+O): the sub-window stays until Rust has opened the window. */
  popOutPoll(id: PollId, origin?: CommandOrigin): Promise<void>;
  /** Dock a poll that is in its own window (list menu): Rust asks that window for its handoff. */
  dockPoll(id: PollId): Promise<void>;
  /** A row of the poll list dropped into the workspace (DES-002 2.10.7). */
  /** True when the poll was placed (a refused dock or a failed show is false). */
  placePollFromList(id: PollId, place: ListPlacement): Promise<boolean>;
  /** Alt+Up, Alt+Down and the row menu: one place up or down, announced. */
  movePoll(id: PollId, dir: "up" | "down"): Promise<void>;
  /** Ctrl+C on a row: name, slave, function, range, scan rate and state, tab separated. */
  copyPollRow(id: PollId): Promise<void>;
  /** File > Close window: the same answer as the OS close request. */
  closeWindow(): Promise<void>;
  /** Ctrl+O, File > Open profile…: the Open profile dialog (S3). */
  openProfile(): void;
  /** Ctrl+S, File > Save: saves, or opens Save as for an unnamed profile. True when saved. */
  saveProfile(): Promise<boolean>;
  /** Ctrl+Shift+S, File > Save as…. True when saved. */
  saveProfileAs(): Promise<boolean>;
  /** Window > Popped-out windows: Tile, Side by side, Stacked, Cascade. */
  arrangeNatives(layout: ArrangeLayout): Promise<void>;
  /** Ctrl+\: the sidebar rail or the full sidebar (compact mode: a temporary peek). */
  toggleSidebar(): void;
}

export interface ConnectionRuntime {
  ipc: ModbusMasterIpc;
  windowIpc: WindowIpc;
  stores: ConnectionStores;
  views: ViewRegistry;
  form: ConnectionFormHolder;
  /** Save, Save as, Open and Load (the flow behind the File menu and the profile dialogs). */
  profileFlow: ProfileFlow;
  /** The saved content now, as the string "Modified" compares (tests make it the baseline). */
  contentSignature(): string;
  actions: ConnectionActions;
  /** Opens the session (`mm_open_session`) and starts routing events. Safe to call twice. */
  init(): Promise<void>;
  dispose(): void;
}

export interface ConnectionRuntimeOptions {
  /** Frame scheduler for coalescing traffic updates. Defaults to requestAnimationFrame. */
  scheduler?: FrameScheduler;
  clipboard?: PollClipboard;
  toastDurationMs?: number;
  warn?: (message: string) => void;
  /** Builds the scaled value provider of a poll (default: the real scale math). */
  createScaled?: ScaledProviderFactory;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  getWindowHeight?: () => number;
  /** Frame scheduler of the drag store (tests run it by hand). */
  dragScheduler?: FrameScheduler;
  /** The workspace's top-left corner in the window's client coordinates (the pop out anchor). */
  getWorkspaceOrigin?: () => Point;
  /** Commits or reverts the inline editor that has the focus, before a pop out. */
  blurEditors?: () => void;
  /** Replaces the save of the "Save changes?" question of the window close (tests). */
  saveProfile?: () => Promise<boolean>;
}

/** The workspace element's origin: pop out needs the sub-window's place in client coordinates. */
function domWorkspaceOrigin(): Point {
  const el = globalThis.document?.querySelector("[data-workspace]");
  const r = el?.getBoundingClientRect();
  return { x: r?.left ?? 0, y: r?.top ?? 0 };
}

export function createConnectionRuntime(
  ipc: ModbusMasterIpc,
  windowIpc: WindowIpc,
  options: ConnectionRuntimeOptions = {},
): ConnectionRuntime {
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer =
    options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const clipboard = options.clipboard ?? browserClipboard;
  const blurEditors = options.blurEditors ?? blurActiveEditor;
  const workspaceOrigin = options.getWorkspaceOrigin ?? domWorkspaceOrigin;

  const toasts = createToastStore(
    options.toastDurationMs === undefined ? {} : { durationMs: options.toastDurationMs },
  );
  const announcer = createAnnouncerStore({
    onAnnounce: (text, assertive) => windowIpc.recordAnnouncement?.(text, assertive),
  });
  const connection = createConnectionStore({ ipc, role: "window", warn });
  const draft = createConnectionDraftStore();
  const section = createConnectionSectionStore();
  const serialPorts = createSerialPortsStore({ ipc });
  const layout = createLayoutStore();
  const profile = createProfileInfoStore();
  const profiles = createProfilesStore({ ipc });
  const dialogs = createDialogsStore();
  const confirm = createConfirmStore();
  const prefs = createPrefsStore({ ipc, toasts });
  const pollList = createPollListStore({ ipc, toasts, warn });
  const traffic = createTrafficStore({ ipc });
  const listOrder = () => pollList.getState().order;
  const workspace = createWorkspaceStore({
    ipc,
    toasts,
    getListOrder: listOrder,
    getCompact: () => prefs.getState().compact,
    ...(options.getWindowHeight ? { getWindowHeight: options.getWindowHeight } : {}),
    setTimer,
    clearTimer,
  });
  const nameOf = (id: PollId) => pollList.getState().polls[id]?.config.name ?? `Poll ${id}`;
  const drag = createDragStore({
    workspace,
    getName: nameOf,
    getListOrder: listOrder,
    setOrder: (order) => pollList.getState().setOrder(order),
    placeFromList: (id, place) => actions.placePollFromList(id, place),
    // A native poll that is docked announces "docked in the workspace" itself.
    announcesItself: (id) => {
      const p = pollList.getState().polls[id];
      return p !== undefined && p.host === "native" && p.open;
    },
    announce: (text) => announcer.getState().announce(text),
    ...(options.dragScheduler ? { schedule: options.dragScheduler } : {}),
  });
  const arrange = createArrangeStore({ ipc, windowIpc, toasts });
  const write = createWriteStore({
    ipc,
    getConfig: (id) => pollList.getState().polls[id]?.config ?? null,
    isLinkUp: () => connection.getState().state === "connected",
  });
  const host = createPollHostStore({
    ipc,
    toasts,
    describe: (id) => {
      const p = pollList.getState().polls[id];
      return p
        ? {
            name: p.config.name,
            host: p.host,
            open: p.open,
            hasUnappliedEdits: p.hasUnappliedEdits,
            polling: isPollRunning(p.status.state),
          }
        : null;
    },
    askOnPollClose: () => prefs.getState().askOnPollClose,
    setAskOnPollClose: (enabled) => prefs.getState().setAskOnPollClose(enabled),
    flushLayout: () => workspace.getState().flush(),
    // The handoff is what the sub-window holds now; a minimized one that was never attached has none.
    getHandoff: (id) => {
      const view = views.peek(id);
      return view && view.stores.poll.getState().attach === "attached"
        ? view.stores.ui.getState().toHandoff()
        : null;
    },
    blurEditors,
    markViewPending: (id, kind) => views.peek(id)?.stores.poll.getState().markPending(kind),
    isModalOpen: () => layout.getState().modalOpen,
    announce: (text) => announcer.getState().announce(text),
  });
  const windowClose = createWindowCloseStore({
    summary: () => {
      const s = pollList.getState();
      return {
        profileName: profile.getState().name,
        modified: profile.getState().modified,
        nativeCount: selectNativeCount(s),
        unappliedNames: unappliedNames(s),
      };
    },
    save: options.saveProfile ?? (() => profileFlow.save()),
  });
  const form = createConnectionFormHolder(draft);

  // Traffic frames arrive in bursts: coalesce them into one store write per animation frame.
  const frameBatcher = createBatcher<TrafficFrame>(
    (frames) => traffic.getState().appendFrames(frames),
    options.scheduler,
    TRAFFIC_CAPACITY,
  );

  // ---- poll views ----
  const viewMap = new Map<PollId, PollViewRuntime>();
  const viewEpochs = new Map<PollId, number>();
  const viewListeners = new Set<() => void>();
  const views: ViewRegistry = {
    get(pollId) {
      const existing = viewMap.get(pollId);
      if (existing) return existing;
      const runtime = createPollViewRuntime({
        ipc,
        pollId,
        host: "workspace",
        connection,
        // The session channel is ordered and complete: the view copies of connection events
        // would only be replayed late (REV-005 m-1).
        sharedConnection: true,
        toasts,
        clipboard,
        ...(options.createScaled ? { createScaled: options.createScaled } : {}),
        lockModal: () => layout.getState().lockModal(),
        warn,
        getOtherNames: () => pollNames(pollList.getState()).filter((n) => n !== nameOf(pollId)),
        hostActions: {
          popOut: (origin) => void actions.popOutPoll(pollId, origin),
          close: () => host.getState().requestClose(pollId),
          deletePoll: () => host.getState().requestDelete(pollId),
          showTraffic: () => actions.showTrafficFor(pollId),
          duplicate: () => void pollList.getState().duplicate(pollId),
          rename: () => workspace.getState().startTitleRename(pollId),
          write: (address) =>
            openWriteDialog(
              { write, connection, toasts, getView: (id) => views.peek(id) },
              pollId,
              address,
            ),
        },
        onDetached: (cause) => {
          // Rust says this view must go away. The list event unmounts the sub-window as well; doing
          // it here too makes the two orders equivalent. A replacement keeps the sub-window.
          if (cause === "replaced") return;
          // Rust detaches the view before it creates the native window. The sub-window stays, with
          // its last values and the spinner, until the command answers (DES-002 2.5.2, REV-006 M-1).
          if (cause === "poppedOut" && host.getState().pending[pollId] === "popOut") return;
          workspace.getState().unmount(pollId);
        },
      });
      viewMap.set(pollId, runtime);
      return runtime;
    },
    peek: (pollId) => viewMap.get(pollId),
    refresh(pollId) {
      const runtime = viewMap.get(pollId);
      if (!runtime) return;
      viewMap.delete(pollId);
      runtime.dispose();
      viewEpochs.set(pollId, (viewEpochs.get(pollId) ?? 0) + 1);
      for (const listener of [...viewListeners]) listener();
    },
    epoch: (pollId) => viewEpochs.get(pollId) ?? 0,
    subscribe(listener) {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    dispose(pollId) {
      const runtime = viewMap.get(pollId);
      if (!runtime) return;
      viewMap.delete(pollId);
      runtime.dispose();
    },
    ids: () => [...viewMap.keys()],
  };

  // ---- the session channel ----
  let snapshotApplied = false;
  let holding = true;
  let held: SessionEvent[] = [];
  const disposers: Array<() => void> = [];

  const route = (event: SessionEvent): void => {
    switch (event.type) {
      case "ConnectionStateChanged":
        connection.getState().applyConnectionStateChanged(event);
        break;
      case "PollStateChanged":
        pollList.getState().applyPollStateChanged(event);
        break;
      case "PollListChanged":
        pollList.getState().applyPollListChanged(event);
        break;
      case "TrafficFrames":
        frameBatcher.push(event.frames);
        break;
      case "Counters":
        traffic.getState().setCounters(event);
        pollList.getState().applyCounters(event);
        break;
      case "RevealPoll":
        workspace.getState().reveal(
          event.pollId,
          event.workspaceRect
            ? {
                x: event.workspaceRect.x,
                y: event.workspaceRect.y,
                width: event.workspaceRect.width,
                height: event.workspaceRect.height,
              }
            : null,
        );
        break;
      case "PrefsChanged":
        prefs.getState().applyPrefs(event);
        break;
      case "ShowTraffic":
        // The backend raises W1. The payload has no origin: a request that arrives while this
        // document does not have the focus came from a native window, so the Filter select takes it.
        showTraffic(event.pollId, typeof document !== "undefined" && !document.hasFocus());
        break;
      case "SaveRequested":
        // Ctrl+S in a native window: the whole profile is saved here.
        void profileFlow.requestedByNative(event.saveAs);
        break;
      case "DockPreview":
        // Phase 2 (dock by drag): defined, never sent.
        break;
    }
  };

  const onEvent = (event: SessionEvent): void => {
    if (holding) held.push(event);
    else route(event);
  };

  function applySnapshot(snapshot: SessionSnapshot): void {
    connection
      .getState()
      .applySnapshot({ connection: snapshot.connection, autoStartPoll: snapshot.autoStartPoll });
    section.getState().applySnapshot(snapshot.connection.state);
    if (snapshot.connection.config) draft.getState().setConnection(snapshot.connection.config);
    prefs
      .getState()
      .applySnapshot({ compact: snapshot.compact, askOnPollClose: snapshot.askOnPollClose });
    profile.getState().setName(snapshot.profileName);
    pollList.getState().applySnapshot(snapshot.polls);
    traffic.getState().setCounters(snapshot.counters);
    pollList.getState().applyCounters(snapshot.counters);
    syncPollNames();
    workspace.getState().applyLayout(snapshot.workspaceLayout, snapshot.polls);
    snapshotApplied = true;
  }

  // ---- wiring ----
  let failures: FailureEntry[] = [];
  let failureTimer: unknown = null;
  let lastStates: Record<PollId, PollState> = {};
  // Where each poll lived at the last list change: a dock is announced when it moved from its own
  // window to the workspace (a failed pop out passes through the same change and is not).
  let lastHosts: Record<PollId, { host: PollHostKind; open: boolean }> = {};
  let lastNames = "";
  function syncPollNames(): void {
    const s = pollList.getState();
    traffic
      .getState()
      .setPollOrder(
        s.order,
        Object.fromEntries(s.order.map((id) => [id, s.polls[id]?.config.name ?? `Poll ${id}`])),
      );
    lastNames = s.order.map((id) => `${id}:${s.polls[id]?.config.name}`).join("|");
  }

  // A poll that is being popped out is still shown in the workspace until the command answers.
  const shownList = (list: readonly PollSummary[]): PollSummary[] =>
    list.map((p) =>
      p.host === "native" && host.getState().pending[p.config.pollId] === "popOut"
        ? { ...p, host: "workspace" }
        : p,
    );

  let lastShown = "";
  disposers.push(
    pollList.subscribe((s, prev) => {
      if (!snapshotApplied) return;
      if (s.order !== prev.order || s.polls !== prev.polls) {
        const list = shownList(s.order.flatMap((id) => s.polls[id] ?? []));
        const shown = shownSignature(list);
        if (shown !== lastShown) {
          lastShown = shown;
          workspace.getState().syncFromList(list);
        }
        const names = s.order.map((id) => `${id}:${s.polls[id]?.config.name}`).join("|");
        if (names !== lastNames) syncPollNames();
      }
    }),
  );
  // What the snapshot showed, so the first events are compared with it.
  const seedDerived = () => {
    const s = pollList.getState();
    lastShown = shownSignature(shownList(s.order.flatMap((id) => s.polls[id] ?? [])));
    lastStates = {};
    lastHosts = {};
    for (const id of s.order) {
      const entry = s.polls[id];
      if (!entry) continue;
      lastStates[id] = entry.status.state;
      lastHosts[id] = { host: entry.host, open: entry.open };
    }
  };

  // ---- profiles (DES-002 6, FE-002 task 23) ----
  /** What is saved, as a string: the connection, "Start polling when connected" and the polls. */
  const signatureNow = (): string => {
    const s = pollList.getState();
    return contentSignature({
      connection: draft.getState().connection,
      autoStartPoll: connection.getState().autoStartPoll,
      polls: s.order.flatMap((id) => s.polls[id]?.config ?? []),
    });
  };
  const profileFlow: ProfileFlow = createProfileFlow({
    ipc,
    toasts,
    profiles,
    dialogs,
    confirm,
    info: profile,
    connection,
    validateForm: () => form.current.validate(),
    showForm: () => section.getState().edit(),
    adoptConnection: (config) => form.current.adopt(config),
    flushLayout: () => workspace.getState().flush(),
    suspendSync() {
      snapshotApplied = false;
      return () => {
        snapshotApplied = true;
        seedDerived();
      };
    },
    applySnapshot(snapshot) {
      snapshotApplied = false;
      applySnapshot(snapshot);
      seedDerived();
    },
    signature: signatureNow,
    loadSummary: () => {
      const s = pollList.getState();
      return { nativeWindowCount: selectNativeCount(s), unappliedPollNames: unappliedNames(s) };
    },
  });

  // "Modified" follows the saved content only (DES-002 6.1): the connection, "Start polling when
  // connected" and the poll configs. Layout, hosts, order, Pause and the traffic filter are not in
  // the signature. The poll configs are compared by reference first, because the counters event
  // replaces the poll list ten times a second without touching a config.
  let lastConfigs: readonly PollConfig[] = [];
  const evaluateModified = () => profile.getState().evaluate(signatureNow());
  disposers.push(
    pollList.subscribe((s, prev) => {
      if (!snapshotApplied || s.polls === prev.polls) return;
      const configs = s.order.flatMap((id) => s.polls[id]?.config ?? []);
      if (sameConfigs(configs, lastConfigs)) return;
      lastConfigs = configs;
      evaluateModified();
    }),
    draft.subscribe((s, prev) => {
      if (snapshotApplied && s.connection !== prev.connection) evaluateModified();
    }),
    connection.subscribe((s, prev) => {
      if (snapshotApplied && s.autoStartPoll !== prev.autoStartPoll) evaluateModified();
    }),
  );

  // A drag whose poll is gone (deleted, a profile was applied) ends without a trace.
  disposers.push(
    pollList.subscribe((s) => {
      const id = drag.getState().pollId;
      if (id !== null && !(id in s.polls)) drag.getState().abort(id);
    }),
  );

  // A sub-window that took the keyboard focus with it (Keep, Delete, pop out) leaves the focus on
  // the page body. It goes to the next active sub-window, else to the poll list (REV-006 m-7).
  const restoreFocus = (): void => {
    const doc = globalThis.document;
    if (!doc || (doc.activeElement && doc.activeElement !== doc.body)) return;
    // The active sub-window, without activating anything (that would change the layout).
    const frame = doc.querySelector<HTMLElement>('[data-subwindow][data-active="true"]');
    const target =
      frame?.querySelector<HTMLElement>('[role="grid"]') ??
      frame?.querySelector<HTMLElement>('[data-slot="title-bar"]') ??
      doc.querySelector<HTMLElement>('[data-region="polls"] [role="option"][tabindex="0"]') ??
      doc.querySelector<HTMLElement>('[data-region="polls"] [role="option"]') ??
      doc.querySelector<HTMLElement>('[data-region="workspace"]');
    target?.focus();
  };

  // A sub-window that is gone takes its view with it; the sidebar selection follows the active one.
  disposers.push(
    workspace.subscribe((s, prev) => {
      if (s.items !== prev.items) {
        for (const id of views.ids()) if (!(id in s.items)) views.dispose(id);
        if (Object.keys(prev.items).some((id) => !(Number(id) in s.items))) {
          setTimer(restoreFocus, 0);
        }
      }
      if (s.activeId !== prev.activeId && s.activeId !== null) {
        pollList.getState().select(s.activeId);
      }
    }),
  );

  // Connection transitions: the CONNECTION section and the live region (once per transition).
  disposers.push(
    connection.subscribe((s, prev) => {
      if (s.revision === prev.revision) return;
      section.getState().applyTransition(prev.state, s.state, s.reason);
      announcer.getState().announce(connectionAnnouncement(s.state, s.reason, s.connection), {
        assertive: s.state === "disconnected",
      });
    }),
    // A connection that came from Rust (a reload) shows in the form.
    connection.subscribe((s, prev) => {
      if (s.connection === prev.connection || s.connection === null) return;
      if (JSON.stringify(s.connection) !== JSON.stringify(draft.getState().connection)) {
        form.current.adopt(s.connection);
      }
    }),
    // Command failures are shown, never swallowed (REV-002 M1); a backend field message also goes
    // under its input.
    connection.subscribe((s, prev) => {
      if (s.commandError === null || s.commandError === prev.commandError) return;
      toasts.getState().show(s.commandError, { tone: "error", durationMs: 4000 });
      if (s.commandErrorField) form.current.showFieldError(s.commandErrorField, s.commandError);
      connection.getState().clearCommandError();
    }),
    traffic.subscribe((s, prev) => {
      if (s.error === null || s.error === prev.error) return;
      toasts.getState().show(s.error, { tone: "error", durationMs: 4000 });
      traffic.getState().clearError();
    }),
  );

  // Toggling compact mode ends the sidebar peek.
  disposers.push(
    prefs.subscribe((s, prev) => {
      if (s.compact !== prev.compact) layout.getState().setSidebarPeek(false);
    }),
  );

  // A link-lost write result is replaced by an empty result area once the link is back (DES-001 2.5).
  disposers.push(watchWriteLink(connection, write));

  // Poll failures are announced once per poll; a burst becomes one message (DES-002 1.5 rule 5).
  disposers.push(
    pollList.subscribe((s) => {
      if (!snapshotApplied) return;
      const states: Record<PollId, PollState> = {};
      for (const id of s.order) {
        const entry = s.polls[id];
        if (!entry) continue;
        const state = entry.status.state;
        states[id] = state;
        const before = lastHosts[id];
        if (before?.host !== entry.host || before?.open !== entry.open) {
          lastHosts[id] = { host: entry.host, open: entry.open };
          // The rollback of a pop out that failed is not a dock, whichever of the command's answer
          // and the list event comes first (REV-006 m-8).
          const failure = host.getState().lastPopOutFailure;
          const rollback = failure?.id === id && Date.now() - failure.at < 2000;
          const text =
            before && host.getState().pending[id] !== "popOut" && !rollback
              ? hostChangeAnnouncement(entry.config.name, before, entry)
              : null;
          if (text) announcer.getState().announce(text);
        }
        if (enteredFailure(lastStates[id], state)) {
          failures.push({
            name: entry.config.name,
            label: pollPillFor(state, entry.status.exceptionCode, true).label,
          });
        }
      }
      lastStates = states;
      if (failures.length > 0 && failureTimer === null) {
        failureTimer = setTimer(() => {
          failureTimer = null;
          const text = failureAnnouncement(failures);
          failures = [];
          if (text) announcer.getState().announce(text);
        }, FAILURE_WINDOW_MS);
      }
    }),
  );

  // ---- actions ----
  function showTraffic(pollId: PollId | null, focusFilter: boolean): void {
    if (pollId !== null) traffic.getState().setFilter({ kind: "poll", pollId });
    workspace.getState().setTrafficExpanded(true);
    if (focusFilter) traffic.getState().requestFilterFocus();
  }

  /** Waits until the list says the poll is in the workspace again, then gives its frame a new view. */
  async function reattachView(id: PollId): Promise<void> {
    const inWorkspace = () => {
      const p = pollList.getState().polls[id];
      return p !== undefined && p.host === "workspace" && p.open;
    };
    if (!inWorkspace()) {
      await new Promise<void>((resolve) => {
        const timer = setTimer(() => {
          off();
          resolve();
        }, 1000);
        const off = pollList.subscribe(() => {
          if (!inWorkspace()) return;
          clearTimer(timer);
          off();
          resolve();
        });
      });
    }
    if (inWorkspace() && workspace.getState().items[id]) views.refresh(id);
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      toasts.getState().show(CLIPBOARD_ERROR, { tone: "error", durationMs: 4000 });
      return false;
    }
  }
  function selectedFrame(): TrafficFrame | undefined {
    const t = traffic.getState();
    if (t.selectedSeq === null) return undefined;
    return t.visible().get(t.indexOfSeq(t.selectedSeq));
  }
  const pollNamesMap = () => traffic.getState().pollNames;
  const actions: ConnectionActions = {
    async toggleConnection() {
      const state = connection.getState().state;
      if (state === "connecting") await actions.cancelConnect();
      else if (state === "connected") await actions.disconnect();
      else await actions.connect();
    },
    async connect() {
      const c = connection.getState();
      if (!c.ready || c.pending !== null) return;
      const config = await form.current.validate();
      if (!config) {
        section.getState().edit();
        return;
      }
      await connection.getState().connect(config);
    },
    cancelConnect: () => connection.getState().cancelConnect(),
    disconnect: () => connection.getState().disconnect(),
    dismiss: () => connection.getState().dismiss(),
    async newPoll() {
      const id = await pollList.getState().add();
      if (id !== null) workspace.getState().markFresh(id);
    },
    async togglePauseAll() {
      const s = pollList.getState();
      const anyRunning = s.order.some((id) => {
        const state = s.polls[id]?.status.state;
        return (
          state === "polling" ||
          state === "timeout" ||
          state === "exception" ||
          state === "badResponse"
        );
      });
      await s.setAllActive(!anyRunning);
    },
    async togglePoll(id) {
      const entry = pollList.getState().polls[id];
      if (!entry) return;
      const state = entry.status.state;
      const running =
        state === "polling" ||
        state === "timeout" ||
        state === "exception" ||
        state === "badResponse";
      await pollList.getState().setActive(id, !running);
    },
    async showPoll(id) {
      const list = pollList.getState();
      const entry = list.polls[id];
      if (!entry) return;
      list.select(id);
      // A sub-window that is already there needs no round trip.
      if (entry.host === "workspace" && entry.open) {
        if (!workspace.getState().items[id]) {
          workspace.getState().syncFromList(list.order.flatMap((x) => list.polls[x] ?? []));
        }
        if (workspace.getState().show(id)) return;
      }
      await host.getState().show(id);
    },
    showTrafficFor(id, opts) {
      showTraffic(id, opts?.focusFilter === true);
    },
    toggleTraffic() {
      const w = workspace.getState();
      w.setTrafficExpanded(!w.traffic.expanded);
    },
    clearTraffic: () => traffic.getState().clear(),
    async copyFrame() {
      const frame = selectedFrame();
      if (!frame) return;
      if (await copyText(framesToTsvWithPoll([frame], pollNamesMap()))) {
        toasts.getState().show("Copied 1 frame.");
      }
    },
    async copyFrameBytes() {
      const frame = selectedFrame();
      if (!frame) return;
      if (await copyText(formatHexBytes(frame.bytes))) {
        toasts.getState().show(`Copied ${frame.bytes.length} bytes.`);
      }
    },
    async resetAllCounters() {
      try {
        await ipc.resetCounters(null);
      } catch (e) {
        toasts.getState().show(toIpcError(e).message, { tone: "error", durationMs: 4000 });
      }
    },
    async showPollWindows() {
      try {
        await ipc.showPollWindows();
      } catch (e) {
        toasts.getState().show(toIpcError(e).message, { tone: "error", durationMs: 4000 });
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
    arrangeMinimized: () => workspace.getState().arrangeMinimized(listOrder()),

    async popOutPoll(id, commandOrigin = "button") {
      const ws = workspace.getState();
      const item = ws.items[id];
      const stored = pollList.getState().polls[id]?.workspace ?? null;
      // The sub-window's rectangle in client coordinates (a maximized one pops out at its normal
      // size, a minimized one at the rectangle it had).
      const rect = item
        ? item.state === "maximized"
          ? (item.restore ?? item.rect)
          : item.rect
        : stored;
      const origin = workspaceOrigin();
      const anchor: PopOutAnchor = {
        kind: "rect",
        rect: {
          x: origin.x + (rect?.x ?? 8),
          y: origin.y + (rect?.y ?? 8),
          width: rect?.width ?? 900,
          height: rect?.height ?? 640,
        },
      };
      // Where the focus was when the command started: a failure gives it back (D9).
      const previous = focusedElementOrNull();
      const opened = await host.getState().popOut(id, anchor);
      if (opened) {
        // The window exists: the sub-window goes now, and the list is applied as Rust says.
        workspace.getState().unmount(id);
        const list = pollList.getState();
        const entries = list.order.flatMap((x) => list.polls[x] ?? []);
        lastShown = shownSignature(shownList(entries));
        workspace.getState().syncFromList(entries);
        return;
      }
      // It did not open: Rust put the poll back in the workspace and detached the old view, so the
      // frame that stayed gets a new view that attaches again and receives its handoff (CHK2-F8).
      if (viewMap.get(id)?.stores.poll.getState().attach === "detached") await reattachView(id);
      // The focus goes back to the control that started the command (CHK2-F16, REPORT-007 D9). Done
      // now, and once more after the frame has rendered its new view (a menu button may be replaced).
      const restore = () =>
        restoreFocusAfterFailure({
          target: focusTargetAfterFailure(commandOrigin, "workspace"),
          host: "workspace",
          pollId: id,
          previous,
          requestGridFocus: () => workspace.getState().requestFocus(id),
        });
      restore();
      setTimer(restore, 0);
    },

    async dockPoll(id) {
      await host.getState().dock(id, { requestHandoff: true });
    },

    async placePollFromList(id, place) {
      const list = pollList.getState();
      const entry = list.polls[id];
      if (!entry) return false;
      list.select(id);
      const ws = workspace.getState();
      // Tile mode: the poll takes the slot it was dropped on, in the list order too. It does that
      // after the poll is placed, so a refused dock leaves the order alone (REV-006 m-4).
      const takeSlot = async () => {
        if (place.kind !== "slot") return;
        const now = pollList.getState();
        const tiled = tiledIds(workspace.getState().items, now.order);
        const next = tiled.includes(id)
          ? insertAmongSubset(now.order, tiled, id, place.index)
          : placeInSubset(now.order, tiled, id, place.index);
        await now.setOrder(next, id);
      };
      // A sub-window that is there is moved, restored and activated.
      if (entry.host === "workspace" && entry.open && ws.items[id]) {
        await takeSlot();
        workspace.getState().reveal(id, place.kind === "slot" ? null : place.rect);
        return true;
      }
      const workspaceRect: WorkspaceRect = {
        x: place.rect.x,
        y: place.rect.y,
        width: place.rect.width,
        height: place.rect.height,
        z: topZ(ws.items),
        state: "normal",
        restore: null,
      };
      // A poll in its own window is docked there (Rust asks that window for its handoff); a closed
      // one is reopened there.
      const placed =
        entry.host === "native" && entry.open
          ? await host.getState().dock(id, { requestHandoff: true, workspaceRect })
          : await host.getState().show(id, { workspaceRect });
      if (placed) await takeSlot();
      return placed;
    },

    async movePoll(id, dir) {
      const list = pollList.getState();
      const before = list.order.indexOf(id);
      if (before === -1) return;
      await (dir === "up" ? list.moveUp(id) : list.moveDown(id));
      const after = pollList.getState();
      const index = after.order.indexOf(id);
      if (index !== -1 && index !== before) {
        announcer
          .getState()
          .announce(dragAnnounce.listPosition(nameOf(id), index + 1, after.order.length));
      }
    },

    async copyPollRow(id) {
      const entry = pollList.getState().polls[id];
      if (!entry) return;
      const hasData = entry.counters.lastOkAt !== null;
      const pill = pollPillFor(entry.status.state, entry.status.exceptionCode, hasData);
      const text = pollRowCopyText({
        name: entry.config.name,
        definition: entry.config.definition,
        base: entry.config.display.addressBase,
        pillLabel: pill.label,
      });
      if (await copyText(text)) toasts.getState().show(copiedToast(1));
    },

    async closeWindow() {
      if ((await windowClose.getState().request()) === "close") {
        await windowIpc.closeWindow().catch(() => {});
      }
    },

    openProfile: () => profileFlow.openDialog(),
    saveProfile: () => profileFlow.save(),
    saveProfileAs: () => profileFlow.saveAs(),

    arrangeNatives: (layout) => arrange.getState().arrange(layout),

    toggleSidebar() {
      if (prefs.getState().compact)
        layout.getState().setSidebarPeek(!layout.getState().sidebarPeek);
      else workspace.getState().toggleSidebar();
    },
  };

  let started: Promise<void> | null = null;
  let stopClosing: (() => void) | null = null;
  let disposed = false;

  return {
    ipc,
    windowIpc,
    stores: {
      toasts,
      connection,
      draft,
      section,
      pollList,
      traffic,
      workspace,
      drag,
      prefs,
      host,
      windowClose,
      arrange,
      write,
      announcer,
      profile,
      profiles,
      dialogs,
      confirm,
      serialPorts,
      layout,
    },
    views,
    form,
    profileFlow,
    contentSignature: signatureNow,
    actions,
    init() {
      started ??= (async () => {
        const snapshot = await ipc.openSession(onEvent);
        applySnapshot(snapshot);
        seedDerived();
        // What the window starts with is the clean baseline of an untitled window, and of a reload.
        lastConfigs = pollList
          .getState()
          .order.flatMap((id) => pollList.getState().polls[id]?.config ?? []);
        profile.getState().setBaseline(signatureNow());
        holding = false;
        const replay = held;
        held = [];
        for (const event of replay) route(event);
        // The OS close request, Alt+F4 and File > Close window all ask the same question.
        void windowIpc
          .onCloseRequested(() => windowClose.getState().request())
          .then((off) => {
            if (disposed) off();
            else stopClosing = off;
          })
          .catch(() => {});
      })();
      return started;
    },
    dispose() {
      disposed = true;
      stopClosing?.();
      stopClosing = null;
      for (const off of disposers.splice(0)) off();
      if (failureTimer !== null) clearTimer(failureTimer);
      for (const id of views.ids()) views.dispose(id);
      frameBatcher.dispose();
      workspace.getState().dispose();
      toasts.getState().clear();
    },
  };
}
