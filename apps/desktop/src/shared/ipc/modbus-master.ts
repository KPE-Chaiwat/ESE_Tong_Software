// The Modbus Master IPC facade (multi-poll contract, DES-002 section 8). Together with `window.ts`
// and `index.ts` this is the only code that touches Tauri `invoke` / `Channel`. Stores take a
// `ModbusMasterIpc` as a dependency; tests and the dev mode replace it with the fake in
// `modbus-master.fake.ts`.
import { Channel, invoke } from "@tauri-apps/api/core";
import { IpcError, toIpcError, type Unsubscribe } from "./errors";
import type {
  ArrangeLayout,
  ArrangeResult,
  ArrangeTarget,
  ConnectionConfig,
  PollBulkAction,
  PollBulkPlan,
  PollBulkResult,
  PollConfigInput,
  PollDefinition,
  PollHostKind,
  PollId,
  PollViewEvent,
  PollViewSettings,
  PollViewSnapshot,
  PopOutAnchor,
  Profile,
  ProfileSummary,
  SerialPortInfo,
  SessionEvent,
  SessionSnapshot,
  ShowPollPlacement,
  ViewToken,
  WorkspaceLayout,
  WorkspaceRect,
  WriteRequest,
  WriteResult,
} from "./modbus-master.types";

export const MODBUS_MASTER_TOOL_ID = "modbus-master";

export { IpcError, toIpcError, type Unsubscribe };

export interface ModbusMasterIpc {
  // ---- session and connection ----
  /** Attaches this window's ordered event channel and returns the current snapshot. */
  openSession(onEvent: (event: SessionEvent) => void): Promise<SessionSnapshot>;
  listSerialPorts(): Promise<SerialPortInfo[]>;
  connect(config: ConnectionConfig): Promise<void>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<void>;
  setAutoStartPoll(enabled: boolean): Promise<void>;

  // ---- polls ----
  addPoll(input: PollConfigInput, host: PollHostKind): Promise<PollId>;
  duplicatePoll(pollId: PollId): Promise<PollId>;
  preparePollBulk(action: PollBulkAction, pollIds: PollId[]): Promise<PollBulkPlan>;
  duplicatePolls(planToken: string): Promise<PollBulkResult>;
  removePolls(planToken: string): Promise<PollBulkResult>;
  ackPollBulkReady(
    operationToken: string,
    pollId: PollId,
    viewToken: ViewToken,
    ready: boolean,
  ): Promise<void>;
  recoverPollBulkWindows(operationToken: string): Promise<PollBulkResult>;
  removePoll(pollId: PollId): Promise<void>;
  /** Applies a changed definition (PT6, PT6b). */
  updatePoll(pollId: PollId, definition: PollDefinition): Promise<void>;
  renamePoll(pollId: PollId, name: string): Promise<void>;
  /** `order` must be a permutation of the current poll ids (`validation`, field `order`). */
  reorderPolls(order: PollId[]): Promise<void>;
  setPollActive(pollId: PollId, active: boolean): Promise<void>;
  setAllPollsActive(active: boolean): Promise<void>;
  /**
   * Display, scale, value columns, aliases and the unapplied-edits flag of one poll. A patch: keys
   * that are left out stay as they are, `scale: null` removes the scale.
   */
  setPollView(pollId: PollId, view: PollViewSettings): Promise<void>;
  /** `pollId` is the view the write was made from (traffic shows "Write: {poll name}"). */
  write(request: WriteRequest, pollId: PollId | null): Promise<WriteResult>;
  /** One poll, or the whole connection when `pollId` is null. */
  resetCounters(pollId: PollId | null): Promise<void>;

  // ---- poll views and hosts ----
  /** Attaches the event channel of one poll view. At most one view per poll. */
  attachPollView(
    pollId: PollId,
    host: PollHostKind,
    onEvent: (event: PollViewEvent) => void,
  ): Promise<PollViewSnapshot>;
  /** A no-op when `viewToken` is not the current one. */
  detachPollView(pollId: PollId, viewToken: ViewToken): Promise<void>;
  showPoll(pollId: PollId, placement: ShowPollPlacement | null): Promise<void>;
  popOutPoll(pollId: PollId, anchor: PopOutAnchor, handoff: string | null): Promise<void>;
  dockPoll(
    pollId: PollId,
    handoff: string | null,
    requestHandoff: boolean,
    workspaceRect: WorkspaceRect | null,
  ): Promise<void>;
  /** The answer of a W2 to `HandoffRequested` (`null` = refuse). */
  provideHandoff(pollId: PollId, handoff: string | null): Promise<void>;
  /** After the Close poll dialog: keep (`true`) or delete (`false`). */
  closePollView(pollId: PollId, keep: boolean): Promise<void>;
  showPollWindows(): Promise<void>;
  focusConnectionWindow(): Promise<void>;

  // ---- layout and preferences ----
  setWorkspaceLayout(layout: WorkspaceLayout): Promise<void>;
  setCompactMode(enabled: boolean): Promise<void>;
  setAskOnPollClose(enabled: boolean): Promise<void>;
  arrangePollWindows(layout: ArrangeLayout, target: ArrangeTarget): Promise<ArrangeResult>;

  // ---- profile relays and profiles ----
  setProfileName(name: string | null): Promise<void>;
  /** Asks W1 to save (`saveAs`: always ask for a name). */
  requestSave(saveAs?: boolean): Promise<void>;
  /** Asks W1 to expand the traffic panel, filtered to `pollId` when it is not null. */
  showTraffic(pollId: PollId | null): Promise<void>;
  /** Only while idle or disconnected. Returns the new session snapshot. */
  applyProfile(profile: Profile): Promise<SessionSnapshot>;
  /** `name` and `connection` default to what Rust knows (profile name, last connection). */
  exportProfile(name?: string | null, connection?: ConnectionConfig | null): Promise<Profile>;
  profilesList(): Promise<ProfileSummary[]>;
  profilesGet(name: string): Promise<Profile>;
  profilesSave(profile: Profile, overwrite: boolean): Promise<void>;
  profilesRename(oldName: string, newName: string): Promise<void>;
  profilesDelete(name: string): Promise<void>;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toIpcError(e);
  }
}

// Argument keys match the Rust parameter names in src-tauri/src/commands (Tauri maps camelCase keys
// to snake_case). Names and keys are the BE-002 final contract.
export function createTauriModbusMasterIpc(): ModbusMasterIpc {
  const toolId = MODBUS_MASTER_TOOL_ID;
  return {
    openSession(onEvent) {
      const channel = new Channel<SessionEvent>();
      channel.onmessage = onEvent;
      return call<SessionSnapshot>("mm_open_session", { channel });
    },
    listSerialPorts: () => call<SerialPortInfo[]>("mm_list_serial_ports"),
    connect: (config) => call<void>("mm_connect", { config }),
    cancelConnect: () => call<void>("mm_cancel_connect"),
    disconnect: () => call<void>("mm_disconnect"),
    setAutoStartPoll: (enabled) => call<void>("mm_set_auto_start_poll", { enabled }),

    addPoll: (input, host) => call<PollId>("mm_add_poll", { input, host }),
    preparePollBulk: (action, pollIds) => call("mm_prepare_poll_bulk", { action, pollIds }),
    duplicatePolls: (planToken) => call("mm_duplicate_polls", { planToken }),
    removePolls: (planToken) => call("mm_remove_polls", { planToken }),
    ackPollBulkReady: (operationToken, pollId, viewToken, ready) =>
      call("mm_ack_poll_bulk_ready", { operationToken, pollId, viewToken, ready }),
    recoverPollBulkWindows: (operationToken) =>
      call("mm_recover_poll_bulk_windows", { operationToken }),
    duplicatePoll: (pollId) => call<PollId>("mm_duplicate_poll", { pollId }),
    removePoll: (pollId) => call<void>("mm_remove_poll", { pollId }),
    updatePoll: (pollId, definition) => call<void>("mm_update_poll", { pollId, definition }),
    renamePoll: (pollId, name) => call<void>("mm_rename_poll", { pollId, name }),
    reorderPolls: (order) => call<void>("mm_reorder_polls", { order }),
    setPollActive: (pollId, active) => call<void>("mm_set_poll_active", { pollId, active }),
    setAllPollsActive: (active) => call<void>("mm_set_all_polls_active", { active }),
    setPollView: (pollId, view) => call<void>("mm_set_poll_view", { pollId, view }),
    write: (request, pollId) => call<WriteResult>("mm_write", { request, pollId }),
    resetCounters: (pollId) => call<void>("mm_reset_counters", { pollId }),

    attachPollView(pollId, host, onEvent) {
      const channel = new Channel<PollViewEvent>();
      channel.onmessage = onEvent;
      return call<PollViewSnapshot>("mm_attach_poll_view", { pollId, host, channel });
    },
    detachPollView: (pollId, viewToken) => call<void>("mm_detach_poll_view", { pollId, viewToken }),
    showPoll: (pollId, placement) => call<void>("mm_show_poll", { pollId, placement }),
    popOutPoll: (pollId, anchor, handoff) =>
      call<void>("mm_pop_out_poll", { pollId, anchor, handoff }),
    dockPoll: (pollId, handoff, requestHandoff, workspaceRect) =>
      call<void>("mm_dock_poll", { pollId, handoff, requestHandoff, workspaceRect }),
    provideHandoff: (pollId, handoff) => call<void>("mm_provide_handoff", { pollId, handoff }),
    closePollView: (pollId, keep) => call<void>("mm_close_poll_view", { pollId, keep }),
    showPollWindows: () => call<void>("mm_show_poll_windows"),
    focusConnectionWindow: () => call<void>("mm_focus_connection_window"),

    setWorkspaceLayout: (layout) => call<void>("mm_set_workspace_layout", { layout }),
    setCompactMode: (enabled) => call<void>("mm_set_compact_mode", { enabled }),
    setAskOnPollClose: (enabled) => call<void>("mm_set_ask_on_poll_close", { enabled }),
    arrangePollWindows: (layout, target) =>
      call<ArrangeResult>("mm_arrange_poll_windows", { layout, target }),

    setProfileName: (name) => call<void>("mm_set_profile_name", { name }),
    requestSave: (saveAs = false) => call<void>("mm_request_save", { saveAs }),
    showTraffic: (pollId) => call<void>("mm_show_traffic", { pollId }),
    applyProfile: (profile) => call<SessionSnapshot>("mm_apply_profile", { profile }),
    exportProfile: (name = null, connection = null) =>
      call<Profile>("mm_export_profile", { name, connection }),
    profilesList: () => call<ProfileSummary[]>("profiles_list", { toolId }),
    profilesGet: (name) => call<Profile>("profiles_get", { toolId, name }),
    profilesSave: (profile, overwrite) =>
      call<void>("profiles_save", { toolId, profile, overwrite }),
    profilesRename: (oldName, newName) =>
      call<void>("profiles_rename", { toolId, oldName, newName }),
    profilesDelete: (name) => call<void>("profiles_delete", { toolId, name }),
  };
}
