// A scriptable fake of the multi-poll Modbus Master IPC facade (DES-002 section 8). It is the only
// backend that unit tests, Testing Library tests and (with VITE_FAKE_IPC) the dev server and
// Playwright talk to.
//
// The fake keeps a real model of the backend: polls with their two state machines, the per-view
// routing table with view tokens (at most one view per poll), the host model H1-H17, one-shot
// handoff storage, reorder validation and the native window arrange (the pure layout math of the
// frontend over a scripted monitor list). Events about that model (`PollListChanged`,
// `PollConfigChanged`, `ViewDetached`, `RevealPoll`, `PrefsChanged`, ...) are always delivered.
//
// Time-driven behavior depends on the mode:
//  - "manual" (default): nothing happens by itself. Commands are recorded and update the model;
//    the connection and the poll cycles are driven by hand (`emitConnectionState`,
//    `emitPollState`, `emitPollUpdate`). Writes answer at once.
//  - "virtual": a full backend in virtual time. Connect, the DES-002 section 7 scheduler (one
//    request in flight, writes first, earliest deadline), counters and traffic run when the test
//    calls `advance(ms)`. Writes wait in the queue until the scheduler serves them.
//  - "realtime" (`simulate: true`): "virtual" driven by a timer, for the dev mode.

import { arrangeNative } from "@/shared/lib/layout-math";
import { restorePlacement } from "@/shared/lib/placement";
import { IpcError } from "./errors";
import { type LegacyProfile, migrateLegacyProfile } from "./fake-profile-migration";
import { RequestScheduler } from "./fake-scheduler";
import {
  checkAliasText,
  checkDefinition,
  checkDisplayShape,
  checkFormatOverrides,
  checkFormatOverridesShape,
  checkPollName,
  checkScale,
  checkScaleOverrides,
  firstIntegerThresholdProblem,
  MAX_ALIASES,
  MAX_POLLS,
  MAX_POLLS_MESSAGE,
  nextCopyName,
} from "./fake-validation";
import type { ModbusMasterIpc } from "./modbus-master";
import type {
  AliasEntry,
  ArrangeLayout,
  ArrangeResult,
  ArrangeTarget,
  BadResponseDetail,
  BadResponseKind,
  ConnectionConfig,
  ConnectionCounters,
  ConnectionState,
  ConnectionStatus,
  Counters,
  MonitorInfo,
  PollBulkAction,
  PollBulkPlan,
  PollBulkResult,
  PollConfig,
  PollConfigInput,
  PollCounters,
  PollDefinition,
  PollHostKind,
  PollId,
  PollState,
  PollStateChangedEvent,
  PollStatus,
  PollSummary,
  PollUpdate,
  PollViewEvent,
  PollViewSettings,
  PollViewSnapshot,
  PopOutAnchor,
  Profile,
  ProfileSummary,
  SerialPortInfo,
  SessionEvent,
  SessionReason,
  SessionSnapshot,
  TrafficFrame,
  ViewToken,
  WindowPlacement,
  WorkspaceLayout,
  WorkspaceRect,
  WriteRequest,
  WriteResult,
} from "./modbus-master.types";

export type CommandName = keyof ModbusMasterIpc;

export interface FakeCall {
  method: CommandName;
  args: unknown[];
}

export interface HeldCommand {
  /** Lets the held command succeed, optionally with a result. */
  release(value?: unknown): void;
  /** Lets the held command reject. */
  fail(error: string | IpcError): void;
}

export type FakeMode = "manual" | "virtual" | "realtime";

export interface FakeOptions {
  /** `true` is the same as `mode: "realtime"` (the dev mode). */
  simulate?: boolean;
  mode?: FakeMode;
  ports?: SerialPortInfo[];
  monitors?: MonitorInfo[];
  /** Virtual time only: the clock starts here (ms since the epoch). */
  startTime?: number;
  /** How long a request takes when the poll answers (default 8 ms). */
  roundTripMs?: number;
  /** How long `connect` takes before the link is up (default 0 virtual, 200 realtime). */
  connectDelayMs?: number;
  /** How long `dockPoll` with `requestHandoff` waits for the native window (default 1000 ms). */
  handoffTimeoutMs?: number;
  /**
   * Keeps the stored part of the model (polls with their configuration, host and rectangles, the
   * layout, the preferences, the profiles) in `storage`, so a reloaded page finds it again as an
   * app restarted on the same data: the connection is idle, no view is attached, the counters and
   * the values start empty. `key` defaults to "esefact-fake-ipc". A `reset()` clears the stored copy.
   */
  persist?: { storage: Pick<Storage, "getItem" | "setItem" | "removeItem">; key?: string };
}

/** What a poll answers while a fault is scripted. */
export type PollFault =
  | { kind: "timeout" }
  | { kind: "exception"; code: number }
  | { kind: "badResponse"; badKind: BadResponseKind; detail?: BadResponseDetail };

export interface RequestLogEntry {
  kind: "poll" | "write";
  pollId: PollId | null;
  slaveId: number;
  start: number;
  end: number;
  outcome: "ok" | "timeout" | "exception" | "badResponse" | "write";
}

export interface AttachedView {
  pollId: PollId;
  token: ViewToken;
  host: PollHostKind;
}

export const EMPTY_COUNTER_SET: Counters = { requests: 0, responses: 0, errors: 0, timeouts: 0 };

export function emptyCounterSet(): Counters {
  return { ...EMPTY_COUNTER_SET };
}

export function emptyCounters(): ConnectionCounters {
  return { total: emptyCounterSet(), writes: emptyCounterSet(), linkLoadPct: 0, polls: [] };
}

export function defaultLayout(): WorkspaceLayout {
  return {
    items: [],
    minimizedOrder: [],
    tileMode: false,
    compact: false,
    sidebarWidth: 280,
    sidebarCollapsed: false,
    trafficExpanded: false,
    trafficHeight: null,
  };
}

/** A poll definition as the New poll button creates it: slave 1, FC03, start 0, 10 registers, 1 s. */
export function defaultDefinition(): PollDefinition {
  return { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 };
}

export function pollConfigInput(patch: Partial<PollConfigInput> = {}): PollConfigInput {
  return {
    name: "Poll 1",
    definition: defaultDefinition(),
    display: {
      addressBase: 0,
      showAlias: true,
      copyAlias: false,
    },
    formatOverrides: [],
    colorRules: [],
    scale: null,
    scaleOverrides: [],
    valueColumns: "raw",
    aliases: [],
    ...patch,
  };
}

/** A session that has not done anything yet. */
export function idleSnapshot(): SessionSnapshot {
  return {
    connection: { state: "idle", reason: null, config: null, at: 0 },
    autoStartPoll: true,
    polls: [],
    counters: emptyCounters(),
    workspaceLayout: defaultLayout(),
    compact: false,
    askOnPollClose: true,
    profileName: null,
  };
}

/** A `SessionReason` for tests and the fake. */
export function sessionReason(
  kind: SessionReason["kind"],
  message: string = kind,
  phase: SessionReason["phase"] = "connectFailed",
): SessionReason {
  return { kind, phase, message };
}

export function defaultMonitor(patch: Partial<MonitorInfo> = {}): MonitorInfo {
  return {
    id: "\\\\.\\DISPLAY1",
    label: "Display 1",
    name: "\\\\.\\DISPLAY1",
    primary: true,
    workArea: { x: 0, y: 0, width: 1920, height: 1032 },
    scaleFactor: 1,
    ...patch,
  };
}

interface PollRecord {
  config: PollConfig;
  state: PollState;
  consecutiveFailures: number;
  exceptionCode: number | null;
  badResponseKind: BadResponseKind | null;
  badResponseDetail: BadResponseDetail | null;
  lastOkAt: number | null;
  host: PollHostKind;
  open: boolean;
  workspace: WorkspaceRect | null;
  native: WindowPlacement | null;
  hasUnappliedEdits: boolean;
  counters: Counters;
  /** `freezePollCounters`: the polls keep running but this poll's counters do not advance. */
  countersFrozen: boolean;
  effectiveScanMs: number | null;
  /** When the state last changed. */
  stateAt: number;
  lastUpdate: PollUpdate | null;
  handoff: { json: string; at: number } | null;
  view: { token: ViewToken; host: PollHostKind; onEvent: (e: PollViewEvent) => void } | null;
  cycle: number;
  updateTimes: number[];
  seq: number;
}

/** What `options.persist` keeps: the stored part of the model, not the live state. */
interface StoredModel {
  v: 1;
  nextPollId: number;
  order: PollId[];
  polls: Array<{
    config: PollConfig;
    host: PollHostKind;
    open: boolean;
    workspace: WorkspaceRect | null;
    native: WindowPlacement | null;
  }>;
  layout: WorkspaceLayout;
  compact: boolean;
  askOnPollClose: boolean;
  autoStartPoll: boolean;
  profileName: string | null;
  connectionConfig: ConnectionConfig | null;
  profiles: Array<{ profile: Profile; modifiedAt: number }>;
}

interface QueuedWrite {
  request: WriteRequest;
  pollId: PollId | null;
  resolve: (result: WriteResult) => void;
}

interface FaultEntry {
  fault: PollFault;
  remaining: number;
}

/** A handoff older than this is dropped (DES-002 2.5.4). */
export const HANDOFF_MAX_AGE_MS = 10_000;

/**
 * Mean interval of the last cycles, null with fewer than two. Rust sends the raw mean; the 1.5 x
 * rule of DES-002 2.3.2 is applied by the UI (`effectiveScanShown`).
 */
function effectiveRate(times: readonly number[]): number | null {
  if (times.length < 2) return null;
  const mean = ((times[times.length - 1] as number) - (times[0] as number)) / (times.length - 1);
  return Math.round(mean);
}

const FRAME_TX_BYTES = [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10];

export interface FakeModbusMasterIpc extends ModbusMasterIpc {
  readonly calls: FakeCall[];
  callsOf(method: CommandName): unknown[][];
  ports: SerialPortInfo[];
  monitors: MonitorInfo[];

  /** Replaces the result of a command (a value, or a function of the call arguments). */
  setResult(method: CommandName, value: unknown): void;
  /** Makes the next `times` calls of a command reject. */
  failNext(method: CommandName, error: string | IpcError, times?: number): void;
  /** Makes every call of a command reject until `clearFailures`. */
  failAlways(method: CommandName, error: string | IpcError): void;
  clearFailures(): void;
  /** The next call of a command stays pending until released. Its effects do not happen. */
  hold(method: CommandName): HeldCommand;
  /**
   * The next call of a command runs its effects at once (events, model changes) and only the reply
   * is held, as with the real backend, where the events of a command reach the window before the
   * command answers. `release()` lets the command return what it computed (or reject with what it
   * failed with); `fail(error)` rejects instead.
   */
  holdReply(method: CommandName): HeldCommand;

  // ---- the model (read only) ----
  /** The snapshot `openSession` returns, from the current model. */
  snapshot(): SessionSnapshot;
  pollIds(): PollId[];
  pollSummary(pollId: PollId): PollSummary;
  /** Which poll has a view attached, with which token and host. */
  attachedViews(): AttachedView[];
  /** Polls that are open in a native window (host native, open), in list order. */
  nativePolls(): PollId[];
  /** The placement Rust holds for the native window of a poll (a copy), or null when it has none. */
  nativePlacement(pollId: PollId): WindowPlacement | null;
  connection(): ConnectionStatus;
  /** Native windows that were shown or focused (by `showPoll`), newest last. */
  readonly focused: PollId[];
  readonly profileName: string | null;
  readonly compact: boolean;
  readonly askOnPollClose: boolean;
  readonly requestLog: readonly RequestLogEntry[];
  /** Current virtual (or real) time in ms. */
  now(): number;

  // ---- raw events (also update the model) ----
  emitSession(event: SessionEvent): void;
  emitView(pollId: PollId, event: PollViewEvent): void;
  /** Sends `ConnectionStateChanged` to the session and every attached view. */
  emitConnectionState(
    state: ConnectionState,
    extra?: { reason?: SessionReason | null; at?: number },
  ): void;
  emitPollState(
    pollId: PollId,
    state: PollState,
    extra?: {
      consecutiveFailures?: number;
      exceptionCode?: number | null;
      badResponseKind?: BadResponseKind | null;
      badResponseDetail?: BadResponseDetail | null;
      at?: number;
    },
  ): void;
  emitPollUpdate(
    pollId: PollId,
    update: Partial<Omit<PollUpdate, "pollId">> & { values: number[] },
  ): void;
  emitPollList(): void;
  emitFrames(frames: TrafficFrame[]): void;
  emitCounters(counters: Partial<ConnectionCounters>): void;
  /**
   * Sets this poll's `Tx` (requests), `Err` (errors) and `Timeouts` and keeps them from advancing
   * while it keeps polling (a status line with fixed counters, `Tx 1234 · Err 3`); `null` lets them
   * run again. A view that is attached gets the new counters at once.
   */
  freezePollCounters(
    pollId: PollId,
    counters: { requests: number; errors: number; timeouts?: number } | null,
  ): void;

  // ---- scripting ----
  seedProfiles(profiles: Array<Profile | LegacyProfile>): void;
  /** The next `connect` ends in `disconnected` with this reason (C3). */
  scriptConnectFailure(reason: SessionReason): void;
  /**
   * The next pop out fails the way the backend does (BE-002 REV-004): the view is detached and the
   * list says "native" first, then the window cannot be created, the list returns the poll to the
   * workspace and the command rejects with `internal`.
   */
  scriptPopOutFailure(message: string | null): void;
  /** Scripts what a poll answers. `times` limits it to the next requests. */
  scriptFault(pollId: PollId, fault: PollFault | null, times?: number): void;
  /** Same, for every poll with this slave id. */
  scriptSlaveFault(slaveId: number, fault: PollFault | null, times?: number): void;
  /** The link drops while connected (C6): every poll goes offline, queued writes fail. */
  dropLink(reason?: SessionReason): void;
  /** Runs the backend for `ms` (virtual time only). */
  advance(ms: number): void;
  setMode(mode: FakeMode): void;
  /** Drops recorded calls, scripted results/failures, held commands, profiles, polls and timers. */
  reset(): void;
}

export function createFakeModbusMasterIpc(options: FakeOptions = {}): FakeModbusMasterIpc {
  let mode: FakeMode = options.mode ?? (options.simulate ? "realtime" : "manual");
  const roundTripMs = options.roundTripMs ?? 8;
  const handoffTimeoutMs = options.handoffTimeoutMs ?? 1000;
  const calls: FakeCall[] = [];
  const results = new Map<CommandName, unknown>();
  const failures = new Map<CommandName, { error: IpcError; remaining: number }>();
  const holds = new Map<CommandName, { promise: Promise<unknown> }>();
  const replyHolds = new Map<CommandName, { promise: Promise<unknown> }>();
  const profiles = new Map<string, { profile: Profile; modifiedAt: number }>();
  const requestLog: RequestLogEntry[] = [];
  const focused: PollId[] = [];

  // ---- model ----
  const polls = new Map<PollId, PollRecord>();
  let order: PollId[] = [];
  let nextPollId = 1;
  let nextToken = 1;
  let sessionHandler: ((event: SessionEvent) => void) | null = null;
  let connection: ConnectionStatus = { state: "idle", reason: null, config: null, at: 0 };
  let connectionConfig: ConnectionConfig | null = null;
  let autoStartPoll = true;
  let compact = false;
  /** `setCompactMode` was called: from then on `setWorkspaceLayout` never changes `compact`. */
  let compactSetByCommand = false;
  let askOnPollClose = true;
  let profileName: string | null = null;
  let layout: WorkspaceLayout = defaultLayout();
  let connectFailure: SessionReason | null = null;
  let popOutFailure: string | null = null;
  const faults = new Map<PollId, FaultEntry>();
  const slaveFaults = new Map<number, FaultEntry>();
  const writeQueue: QueuedWrite[] = [];
  let totalCounters = emptyCounterSet();
  let writeCounters = emptyCounterSet();
  let frameSeq = 0;
  let linkBusyMs = 0;
  const handoffWaiters = new Map<PollId, (handoff: string | null) => void>();
  const pendingTimers: Array<{ due: number; fn: () => void }> = [];
  let ticker: ReturnType<typeof setInterval> | null = null;
  let lastRealTick = 0;
  const startTime = options.startTime ?? 1_700_000_000_000;
  let scheduler = new RequestScheduler<QueuedWrite>(mode === "virtual" ? startTime : Date.now());

  const asError = (e: string | IpcError) => (typeof e === "string" ? new IpcError(e) : e);
  const now = (): number => (mode === "manual" ? Date.now() : scheduler.now);
  const timeoutMs = (): number => connectionConfig?.timeoutMs ?? 1000;
  const active = (): boolean => mode !== "manual";

  // ---- delivery ----
  const toSession = (event: SessionEvent): void => {
    sessionHandler?.(event);
  };
  const toView = (rec: PollRecord, event: PollViewEvent): void => {
    rec.view?.onEvent(event);
  };
  const toAllViews = (event: PollViewEvent): void => {
    for (const rec of polls.values()) toView(rec, event);
  };

  // ---- model -> DTO ----
  const rec = (pollId: PollId): PollRecord => {
    const r = polls.get(pollId);
    if (!r) throw new IpcError(`Poll ${pollId} was not found.`, "pollNotFound");
    return r;
  };

  const statusOf = (r: PollRecord): PollStatus => ({
    pollId: r.config.pollId,
    state: r.state,
    consecutiveFailures: r.consecutiveFailures,
    exceptionCode: r.exceptionCode,
    badResponseKind: r.badResponseKind,
    badResponseDetail: r.badResponseDetail,
    at: r.stateAt,
  });

  const pollCountersOf = (r: PollRecord): PollCounters => ({
    pollId: r.config.pollId,
    counters: { ...r.counters },
    effectiveScanMs: r.effectiveScanMs,
    lastOkAt: r.lastOkAt,
  });

  const summaryOf = (r: PollRecord): PollSummary => ({
    config: structuredClone(r.config),
    status: statusOf(r),
    counters: pollCountersOf(r),
    host: r.host,
    open: r.open,
    workspace: r.workspace ? structuredClone(r.workspace) : null,
    hasUnappliedEdits: r.hasUnappliedEdits,
  });

  const countersNow = (): ConnectionCounters => ({
    total: { ...totalCounters },
    writes: { ...writeCounters },
    linkLoadPct: 0,
    polls: order.map((id) => pollCountersOf(rec(id))),
  });

  const layoutNow = (): WorkspaceLayout => ({
    ...layout,
    compact,
    items: order.flatMap((id) => {
      const r = rec(id);
      return r.workspace ? [{ pollId: id, rect: structuredClone(r.workspace) }] : [];
    }),
    minimizedOrder: layout.minimizedOrder.filter((id) => polls.has(id)),
  });

  const snapshotNow = (): SessionSnapshot => ({
    connection: { ...connection, config: connectionConfig },
    autoStartPoll,
    polls: order.map((id) => summaryOf(rec(id))),
    counters: countersNow(),
    workspaceLayout: layoutNow(),
    compact,
    askOnPollClose,
    profileName,
  });

  let bulkRevision = 0;
  let bulkSignature = "";
  let bulkPlan: { plan: PollBulkPlan; revision: number } | null = null;
  const bulkResults = new Map<string, PollBulkResult>();
  const bulkAcks = new Map<
    string,
    Map<PollId, { token: ViewToken; resolve: (ready: boolean) => void }>
  >();
  let bulkRunning = false;
  const bulkIdentity = () =>
    JSON.stringify(
      order.map((id) => {
        const r = rec(id);
        return [r.config, r.host, r.open, r.hasUnappliedEdits, r.view?.token ?? null];
      }),
    );
  const refreshBulkRevision = () => {
    const signature = bulkIdentity();
    if (signature !== bulkSignature) {
      bulkSignature = signature;
      bulkRevision += 1;
    }
  };
  const emitPollList = (): void => {
    refreshBulkRevision();
    toSession({ type: "PollListChanged", polls: order.map((id) => summaryOf(rec(id))) });
  };
  const emitConfig = (r: PollRecord): void => {
    toView(r, { type: "PollConfigChanged", ...structuredClone(r.config) });
  };

  // ---- poll states ----
  const setPollState = (
    r: PollRecord,
    state: PollState,
    extra: {
      consecutiveFailures?: number;
      exceptionCode?: number | null;
      badResponseKind?: BadResponseKind | null;
      badResponseDetail?: BadResponseDetail | null;
      at?: number;
      /** PT0 is reported only through `PollListChanged` (BE-002 Q-BE2-04). */
      silent?: boolean;
    } = {},
  ): void => {
    r.state = state;
    r.consecutiveFailures = extra.consecutiveFailures ?? 0;
    r.exceptionCode = state === "exception" ? (extra.exceptionCode ?? null) : null;
    r.badResponseKind = state === "badResponse" ? (extra.badResponseKind ?? null) : null;
    r.badResponseDetail = state === "badResponse" ? (extra.badResponseDetail ?? null) : null;
    r.stateAt = extra.at ?? now();
    if (extra.silent) return;
    const event: PollStateChangedEvent = { type: "PollStateChanged", ...statusOf(r) };
    toSession(event);
    toView(r, event);
  };

  const isRunning = (r: PollRecord): boolean =>
    r.state === "polling" ||
    r.state === "timeout" ||
    r.state === "exception" ||
    r.state === "badResponse";

  /** C2 and PT0: what a poll does when the link is up. */
  const startOrPause = (r: PollRecord, silent = false): void => {
    if (r.config.active && autoStartPoll) {
      setPollState(r, "polling", { silent });
      scheduler.rearm(r.config.pollId);
    } else {
      setPollState(r, "paused", { silent });
    }
  };

  const setConnection = (
    state: ConnectionState,
    reason: SessionReason | null,
    at: number = now(),
  ): void => {
    connection = {
      state,
      reason: state === "disconnected" ? reason : null,
      config: connectionConfig,
      at,
    };
    const event = { type: "ConnectionStateChanged" as const, ...connection };
    toSession(event);
    toAllViews(event);
  };

  const linkDown = (state: "idle" | "disconnected", reason: SessionReason | null): void => {
    // Queued writes never reached the link (C5, C6).
    for (const w of writeQueue.splice(0)) w.resolve({ status: "notConnected" });
    scheduler.reset();
    setConnection(state, reason);
    for (const id of order) {
      const r = rec(id);
      if (r.state !== "offline") setPollState(r, "offline");
    }
    if (state === "idle") {
      // C7: stale values are cleared when the user dismisses.
      for (const r of polls.values()) {
        r.lastUpdate = null;
        r.lastOkAt = null;
      }
    }
    emitPollList();
  };

  const linkUp = (): void => {
    setConnection("connected", null);
    for (const id of order) startOrPause(rec(id));
    emitPollList();
  };

  const after = (ms: number, fn: () => void): void => {
    if (ms <= 0) {
      fn();
      return;
    }
    if (mode === "realtime") {
      setTimeout(fn, ms);
      return;
    }
    pendingTimers.push({ due: scheduler.now + ms, fn });
    pendingTimers.sort((a, b) => a.due - b.due);
  };

  // ---- the scheduler ----
  const consume = (map: Map<number, FaultEntry>, key: number): PollFault | null => {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.remaining !== Number.POSITIVE_INFINITY) {
      entry.remaining -= 1;
      if (entry.remaining <= 0) map.delete(key);
    }
    return entry.fault;
  };
  const faultFor = (r: PollRecord): PollFault | null =>
    consume(faults, r.config.pollId) ?? consume(slaveFaults, r.config.definition.slaveId);

  const valuesFor = (r: PollRecord): number[] => {
    const def = r.config.definition;
    const bits = def.function === 1 || def.function === 2;
    return Array.from({ length: def.quantity }, (_, i) =>
      bits ? (def.startAddress + i + r.cycle) & 1 : (def.startAddress + i * 7 + r.cycle) & 0xffff,
    );
  };

  const pushFrames = (
    r: PollRecord | null,
    slaveId: number,
    fc: number,
    start: number,
    duration: number,
    reply: "ok" | "timeout" | "exception" | "badResponse",
    code: number | null,
    note: string | null,
    /** The poll a write was made from (BE-002: `origin.pollId` of a write frame). */
    writePollId: PollId | null = null,
  ): void => {
    const origin = r
      ? ({ kind: "poll", pollId: r.config.pollId } as const)
      : ({ kind: "write", pollId: writePollId } as const);
    const frames: TrafficFrame[] = [];
    frameSeq += 1;
    frames.push({
      seq: frameSeq,
      at: start,
      direction: "tx",
      bytes: FRAME_TX_BYTES,
      slaveId,
      function: fc,
      exceptionCode: null,
      note: null,
      origin,
    });
    if (reply !== "timeout") {
      frameSeq += 1;
      frames.push({
        seq: frameSeq,
        at: start + duration,
        direction: "rx",
        bytes: [0, 1, 0, 0, 0, 3, slaveId, reply === "exception" ? fc | 0x80 : fc, code ?? 0],
        slaveId,
        function: fc,
        exceptionCode: reply === "exception" ? code : null,
        note,
        origin,
      });
    }
    toSession({ type: "TrafficFrames", frames });
  };

  // A frozen poll (`freezePollCounters`) keeps its counters whatever it serves.
  const servePoll = (pollId: PollId, start: number): number => {
    const r = polls.get(pollId);
    if (!r?.countersFrozen) return servePollNow(pollId, start);
    const kept = { ...r.counters };
    const took = servePollNow(pollId, start);
    r.counters = kept;
    return took;
  };

  const servePollNow = (pollId: PollId, start: number): number => {
    const r = polls.get(pollId);
    if (!r) return 1;
    const def = r.config.definition;
    const fault = faultFor(r);
    r.counters.requests += 1;
    totalCounters.requests += 1;

    if (fault?.kind === "timeout") {
      const duration = timeoutMs();
      const end = start + duration;
      r.counters.timeouts += 1;
      totalCounters.timeouts += 1;
      requestLog.push({
        kind: "poll",
        pollId,
        slaveId: def.slaveId,
        start,
        end,
        outcome: "timeout",
      });
      pushFrames(r, def.slaveId, def.function, start, duration, "timeout", null, null);
      const failures = r.state === "timeout" ? r.consecutiveFailures + 1 : 1;
      setPollState(r, "timeout", { consecutiveFailures: failures, at: end });
      linkBusyMs += duration;
      return duration;
    }

    const duration = roundTripMs;
    const end = start + duration;
    linkBusyMs += duration;
    if (fault?.kind === "exception") {
      r.counters.responses += 1;
      r.counters.errors += 1;
      totalCounters.responses += 1;
      totalCounters.errors += 1;
      requestLog.push({
        kind: "poll",
        pollId,
        slaveId: def.slaveId,
        start,
        end,
        outcome: "exception",
      });
      pushFrames(r, def.slaveId, def.function, start, duration, "exception", fault.code, null);
      const failures =
        r.state === "exception" && r.exceptionCode === fault.code ? r.consecutiveFailures + 1 : 1;
      setPollState(r, "exception", {
        consecutiveFailures: failures,
        exceptionCode: fault.code,
        at: end,
      });
      return duration;
    }
    if (fault?.kind === "badResponse") {
      r.counters.errors += 1;
      totalCounters.errors += 1;
      requestLog.push({
        kind: "poll",
        pollId,
        slaveId: def.slaveId,
        start,
        end,
        outcome: "badResponse",
      });
      const detail = fault.detail ?? { expected: null, got: null, message: "" };
      pushFrames(
        r,
        def.slaveId,
        def.function,
        start,
        duration,
        "badResponse",
        null,
        detail.message || null,
      );
      const failures =
        r.state === "badResponse" && r.badResponseKind === fault.badKind
          ? r.consecutiveFailures + 1
          : 1;
      setPollState(r, "badResponse", {
        consecutiveFailures: failures,
        badResponseKind: fault.badKind,
        badResponseDetail: detail,
        at: end,
      });
      return duration;
    }

    // A good cycle.
    r.counters.responses += 1;
    totalCounters.responses += 1;
    r.cycle += 1;
    r.seq += 1;
    r.lastOkAt = end;
    requestLog.push({ kind: "poll", pollId, slaveId: def.slaveId, start, end, outcome: "ok" });
    pushFrames(r, def.slaveId, def.function, start, duration, "ok", null, null);
    r.updateTimes.push(end);
    if (r.updateTimes.length > 11) r.updateTimes.shift();
    r.effectiveScanMs = effectiveRate(r.updateTimes);
    const update: PollUpdate = {
      pollId,
      seq: r.seq,
      at: end,
      slaveId: def.slaveId,
      function: def.function,
      startAddress: def.startAddress,
      values: valuesFor(r),
      roundTripMs: duration,
    };
    r.lastUpdate = update;
    if (r.state !== "polling") setPollState(r, "polling", { at: end });
    toView(r, { type: "PollUpdate", ...update });
    return duration;
  };

  const serveWrite = (write: QueuedWrite, start: number): number => {
    const { request } = write;
    const duration = roundTripMs;
    requestLog.push({
      kind: "write",
      pollId: write.pollId,
      slaveId: request.slaveId,
      start,
      end: start + duration,
      outcome: "write",
    });
    totalCounters.requests += 1;
    writeCounters.requests += 1;
    linkBusyMs += duration;
    const broadcast = request.slaveId === 0 && connectionConfig?.mode === "rtu";
    if (!broadcast) {
      totalCounters.responses += 1;
      writeCounters.responses += 1;
    }
    pushFrames(
      null,
      request.slaveId,
      request.function,
      start,
      duration,
      "ok",
      null,
      null,
      write.pollId,
    );
    write.resolve(broadcast ? { status: "broadcastSent" } : { status: "ok" });
    return duration;
  };

  const runScheduler = (target: number): void => {
    scheduler.advanceTo(target, {
      running: () =>
        order.flatMap((id) => {
          const r = rec(id);
          return isRunning(r) && connection.state === "connected"
            ? [{ id, scanRateMs: r.config.definition.scanRateMs }]
            : [];
        }),
      takeWrite: () => (connection.state === "connected" ? writeQueue.shift() : undefined),
      serveWrite,
      servePoll,
    });
  };

  const flushMetrics = (elapsedMs: number): void => {
    if (connection.state !== "connected") return;
    const load = elapsedMs > 0 ? Math.min(100, Math.round((linkBusyMs / elapsedMs) * 100)) : 0;
    linkBusyMs = 0;
    toSession({ type: "Counters", ...countersNow(), linkLoadPct: load });
    for (const r of polls.values()) {
      toView(r, { type: "PollCounters", ...pollCountersOf(r) });
    }
  };

  const advance = (ms: number): void => {
    if (!active()) return;
    const target = scheduler.now + ms;
    // Timers and the link run in time order.
    while (pendingTimers.length > 0 && (pendingTimers[0] as { due: number }).due <= target) {
      const timer = pendingTimers.shift() as { due: number; fn: () => void };
      runScheduler(timer.due);
      timer.fn();
    }
    runScheduler(target);
    flushMetrics(ms);
  };

  const startTicker = (): void => {
    if (ticker || mode !== "realtime" || typeof setInterval === "undefined") return;
    lastRealTick = Date.now();
    ticker = setInterval(() => {
      const t = Date.now();
      const elapsed = t - lastRealTick;
      lastRealTick = t;
      if (elapsed > 0) advance(elapsed);
    }, 20);
  };
  const stopTicker = (): void => {
    if (ticker) clearInterval(ticker);
    ticker = null;
  };

  // ---- validation helpers ----
  const otherNames = (except: PollId | null): string[] =>
    order.filter((id) => id !== except).map((id) => rec(id).config.name);

  const checkName = (name: string, except: PollId | null): void => {
    const message = checkPollName(name, otherNames(except));
    if (message === null) return;
    throw new IpcError(message, "validation", "name");
  };

  /** `validate_poll`: a definition the backend would refuse is refused here too. */
  const checkDef = (def: PollDefinition): void => {
    const problem = checkDefinition(def, connectionConfig?.mode === "rtu");
    if (problem) throw new IpcError(problem.message, "validation", problem.field);
  };
  const checkAliases = (aliases: readonly AliasEntry[]): void => {
    if (aliases.length > MAX_ALIASES) {
      throw new IpcError("A poll can have at most 2000 aliases.", "validation", "aliases");
    }
    const seen = new Set<number>();
    for (const a of aliases) {
      const message = checkAliasText(a.alias);
      if (message) throw new IpcError(message, "validation", "aliases");
      if (
        !Number.isInteger(a.address) ||
        a.address < 0 ||
        a.address > 65535 ||
        seen.has(a.address)
      ) {
        throw new IpcError(`Invalid alias address ${a.address}.`, "validation", "aliases");
      }
      seen.add(a.address);
    }
  };

  /** A new poll: its run intent `active` is "Start polling when connected" (DES-002 1.2). */
  /** `validate_view_parts`: the first failing shape check of the display, scale, overrides or aliases. */
  const checkViewParts = (parts: {
    display?: PollConfigInput["display"] | undefined;
    formatOverrides?: PollConfigInput["formatOverrides"] | undefined;
    scale?: PollConfigInput["scale"] | undefined;
    scaleOverrides?: PollConfigInput["scaleOverrides"] | undefined;
    aliases?: readonly AliasEntry[] | undefined;
  }): { field: string; message: string } | null => {
    const display = parts.display ? checkDisplayShape(parts.display) : null;
    if (display) return { field: "display", message: display };
    if (parts.formatOverrides !== undefined) {
      const shape = checkFormatOverridesShape(parts.formatOverrides);
      if (shape) return { field: "formatOverrides", message: shape };
      const problem = checkFormatOverrides(parts.formatOverrides);
      if (problem) return { field: "formatOverrides", message: problem };
    }
    const scale = parts.scale ? checkScale(parts.scale) : null;
    if (scale) return { field: "scale", message: scale };
    const overrides = parts.scaleOverrides ? checkScaleOverrides(parts.scaleOverrides) : null;
    if (overrides) return { field: "scaleOverrides", message: overrides };
    try {
      if (parts.aliases) checkAliases(parts.aliases);
    } catch (e) {
      if (e instanceof IpcError) return { field: "aliases", message: e.message };
      throw e;
    }
    return null;
  };
  const checkView = (parts: Parameters<typeof checkViewParts>[0]): void => {
    const problem = checkViewParts(parts);
    if (problem) throw new IpcError(problem.message, "validation", problem.field);
  };

  /**
   * The format-dependent part of `check_color_rules` (BE-009): a rule that can meet a 64-bit integer
   * format needs whole-number thresholds. `rulesInPatch` tells whether the patch itself carries the
   * rules; when only the overrides change, the backend words it as a format problem (BE-009 revision 2).
   */
  const checkRules = (
    rules: PollConfig["colorRules"],
    overrides: PollConfig["formatOverrides"],
    rulesInPatch: boolean,
  ): void => {
    const problem = firstIntegerThresholdProblem(rules, overrides);
    if (!problem) return;
    if (rulesInPatch) throw new IpcError(problem.message, "validation", problem.field);
    const name = rules[problem.index]?.name ?? "";
    throw new IpcError(
      `Format not applied. Rule "${name}" requires whole-number thresholds for 64-bit integers.`,
      "validation",
      "colorRules",
    );
  };

  const blankRecord = (config: PollConfig, host: PollHostKind): PollRecord => ({
    config,
    stateAt: now(),
    state: "offline",
    consecutiveFailures: 0,
    exceptionCode: null,
    badResponseKind: null,
    badResponseDetail: null,
    lastOkAt: null,
    host,
    open: true,
    workspace: null,
    native: null,
    hasUnappliedEdits: false,
    counters: emptyCounterSet(),
    countersFrozen: false,
    effectiveScanMs: null,
    lastUpdate: null,
    handoff: null,
    view: null,
    cycle: 0,
    updateTimes: [],
    seq: 0,
  });

  const newRecord = (input: PollConfigInput, host: PollHostKind): PollRecord => {
    const id = nextPollId;
    nextPollId += 1;
    // Rust stores the format overrides sorted by start (BE-009).
    const formatOverrides = structuredClone(input.formatOverrides).sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
    const r = blankRecord(
      { ...structuredClone(input), formatOverrides, pollId: id, active: autoStartPoll },
      host,
    );
    polls.set(id, r);
    return r;
  };

  // ---- persistence (options.persist) ----
  const storageKey = options.persist?.key ?? "esefact-fake-ipc";
  const persistNow = (): void => {
    const store = options.persist?.storage;
    if (!store) return;
    const stored: StoredModel = {
      v: 1,
      nextPollId,
      order,
      polls: order.map((id) => {
        const r = rec(id);
        return {
          config: r.config,
          host: r.host,
          open: r.open,
          workspace: r.workspace,
          native: r.native,
        };
      }),
      layout,
      compact,
      askOnPollClose,
      autoStartPoll,
      profileName,
      connectionConfig,
      profiles: [...profiles.values()],
    };
    try {
      store.setItem(storageKey, JSON.stringify(stored));
    } catch {
      // A full or blocked storage only costs the persistence.
    }
  };
  const restoreModel = (): void => {
    const raw = options.persist?.storage.getItem(storageKey);
    if (!raw) return;
    let stored: StoredModel;
    try {
      stored = JSON.parse(raw) as StoredModel;
    } catch {
      return;
    }
    if (stored.v !== 1) return;
    nextPollId = stored.nextPollId;
    order = [...stored.order];
    for (const p of stored.polls) {
      const r = blankRecord(
        { ...p.config, formatOverrides: p.config.formatOverrides ?? [] },
        p.host,
      );
      r.open = p.open;
      r.workspace = p.workspace;
      r.native = p.native;
      polls.set(p.config.pollId, r);
    }
    layout = stored.layout;
    compact = stored.compact;
    askOnPollClose = stored.askOnPollClose;
    autoStartPoll = stored.autoStartPoll;
    profileName = stored.profileName;
    compactSetByCommand = true;
    connectionConfig = stored.connectionConfig;
    for (const entry of stored.profiles) profiles.set(entry.profile.name.toLowerCase(), entry);
  };

  const detach = (r: PollRecord, reason: "poppedOut" | "docked" | "replaced" | "closed"): void => {
    if (!r.view) return;
    const view = r.view;
    r.view = null;
    view.onEvent({ type: "ViewDetached", pollId: r.config.pollId, reason });
  };

  const removeRecord = (r: PollRecord, publish = true): void => {
    const id = r.config.pollId;
    toView(r, { type: "PollRemoved", pollId: id });
    r.view = null;
    polls.delete(id);
    order = order.filter((x) => x !== id);
    faults.delete(id);
    handoffWaiters.get(id)?.(null);
    handoffWaiters.delete(id);
    if (publish) emitPollList();
  };

  const defaultNative = (): WindowPlacement => ({
    x: 100,
    y: 100,
    width: 900,
    height: 640,
    maximized: false,
    monitor: fake.monitors[0]?.id ?? "\\\\.\\DISPLAY1",
  });

  const nativeFor = (r: PollRecord, anchor: PopOutAnchor): WindowPlacement => {
    const monitor = fake.monitors[0]?.id ?? "\\\\.\\DISPLAY1";
    const fallback: WindowPlacement =
      anchor.kind === "rect"
        ? {
            x: anchor.rect.x,
            y: anchor.rect.y,
            width: Math.max(480, anchor.rect.width),
            height: Math.max(320, anchor.rect.height),
            maximized: false,
            monitor,
          }
        : { ...defaultNative(), x: 100 - anchor.grabOffset.x, y: 100 - anchor.grabOffset.y };
    return restorePlacement(r.native, fake.monitors, fallback).placement;
  };

  const dockInternal = async (
    r: PollRecord,
    handoff: string | null,
    requestHandoff: boolean,
    rect: WorkspaceRect | null,
  ): Promise<void> => {
    const id = r.config.pollId;
    if (r.host !== "native" || !r.open) {
      throw new IpcError("The poll is not in its own window.", "validation", "host");
    }
    // One handoff request per poll at a time.
    if (handoffWaiters.has(id)) {
      throw new IpcError("This poll is already being docked.", "invalidState");
    }
    let json = handoff;
    // Without an attached native view there is nobody to ask: the dock goes on without a handoff.
    if (requestHandoff && r.view) {
      const answer = await new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (value: string | null) => {
          if (settled) return;
          settled = true;
          handoffWaiters.delete(id);
          resolve(value);
        };
        handoffWaiters.set(id, finish);
        toView(r, { type: "HandoffRequested", pollId: id });
        setTimeout(() => finish(null), handoffTimeoutMs);
      });
      if (answer === null) {
        throw new IpcError("The poll window did not hand over its state.", "validation", "handoff");
      }
      json = answer;
    }
    detach(r, "docked");
    r.host = "workspace";
    r.open = true;
    if (rect) r.workspace = structuredClone(rect);
    else if (r.workspace && r.workspace.state !== "normal") {
      r.workspace = { ...r.workspace, state: "normal" };
    }
    r.handoff = json === null ? null : { json, at: now() };
    toSession({
      type: "RevealPoll",
      pollId: id,
      workspaceRect: r.workspace ? structuredClone(r.workspace) : null,
    });
    emitPollList();
  };

  // ---- the facade ----
  const fake: FakeModbusMasterIpc = {
    calls,
    ports: options.ports ?? [
      { name: "COM3", description: "USB Serial Device" },
      { name: "COM4", description: null },
    ],
    monitors: options.monitors ?? [defaultMonitor()],
    focused,
    get profileName() {
      return profileName;
    },
    get compact() {
      return compact;
    },
    get askOnPollClose() {
      return askOnPollClose;
    },
    get requestLog() {
      return requestLog;
    },

    callsOf: (method) => calls.filter((c) => c.method === method).map((c) => c.args),

    setResult: (method, value) => {
      results.set(method, value);
    },
    failNext: (method, error, times = 1) => {
      failures.set(method, { error: asError(error), remaining: times });
    },
    failAlways: (method, error) => {
      failures.set(method, { error: asError(error), remaining: Number.POSITIVE_INFINITY });
    },
    clearFailures: () => {
      failures.clear();
    },
    hold: (method) => {
      let release!: (value: unknown) => void;
      let fail!: (error: IpcError) => void;
      const promise = new Promise<unknown>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      holds.set(method, { promise });
      return {
        release: (value) => release(value),
        fail: (error) => fail(asError(error)),
      };
    },

    holdReply: (method) => {
      let release!: (value: unknown) => void;
      let fail!: (error: IpcError) => void;
      const promise = new Promise<unknown>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      replyHolds.set(method, { promise });
      return {
        release: (value) => release(value),
        fail: (error) => fail(asError(error)),
      };
    },

    snapshot: snapshotNow,
    pollIds: () => [...order],
    pollSummary: (pollId) => summaryOf(rec(pollId)),
    attachedViews: () =>
      order.flatMap((id) => {
        const view = rec(id).view;
        return view ? [{ pollId: id, token: view.token, host: view.host }] : [];
      }),
    nativePolls: () =>
      order.filter((id) => {
        const r = rec(id);
        return r.host === "native" && r.open;
      }),
    nativePlacement: (pollId) => {
      const native = polls.get(pollId)?.native;
      return native ? { ...native } : null;
    },
    connection: () => ({ ...connection }),
    now,

    emitSession: (event) => toSession(event),
    emitView: (pollId, event) => {
      const r = polls.get(pollId);
      if (r) toView(r, event);
    },
    emitConnectionState(state, extra = {}) {
      const reason = extra.reason ?? (state === "disconnected" ? sessionReason("ioError") : null);
      setConnection(state, reason, extra.at ?? now());
    },
    emitPollState(pollId, state, extra = {}) {
      setPollState(rec(pollId), state, extra);
    },
    emitPollUpdate(pollId, update) {
      const r = rec(pollId);
      r.seq += 1;
      const def = r.config.definition;
      const full: PollUpdate = {
        pollId,
        seq: r.seq,
        at: now(),
        slaveId: def.slaveId,
        function: def.function,
        startAddress: def.startAddress,
        roundTripMs: 8,
        ...update,
      };
      r.lastUpdate = full;
      r.lastOkAt = full.at;
      toView(r, { type: "PollUpdate", ...full });
    },
    emitPollList,
    emitFrames: (frames) => toSession({ type: "TrafficFrames", frames }),
    emitCounters(counters) {
      toSession({ type: "Counters", ...countersNow(), ...counters });
    },
    freezePollCounters(pollId, counters) {
      const r = rec(pollId);
      r.countersFrozen = counters !== null;
      if (counters) {
        r.counters = {
          ...r.counters,
          requests: counters.requests,
          errors: counters.errors,
          timeouts: counters.timeouts ?? 0,
        };
      }
      toView(r, { type: "PollCounters", ...pollCountersOf(r) });
    },

    seedProfiles(list) {
      // A profile of an older schema is migrated the way the backend does on load (BE-009).
      for (const raw of list) {
        const profile = migrateLegacyProfile(raw);
        profiles.set(profile.name.toLowerCase(), { profile, modifiedAt: Date.now() });
      }
      persistNow();
    },
    scriptConnectFailure(reason) {
      connectFailure = reason;
    },
    scriptPopOutFailure(message) {
      popOutFailure = message;
    },
    scriptFault(pollId, fault, times = Number.POSITIVE_INFINITY) {
      if (fault === null) faults.delete(pollId);
      else faults.set(pollId, { fault, remaining: times });
    },
    scriptSlaveFault(slaveId, fault, times = Number.POSITIVE_INFINITY) {
      if (fault === null) slaveFaults.delete(slaveId);
      else slaveFaults.set(slaveId, { fault, remaining: times });
    },
    dropLink(reason = sessionReason("closedByPeer", "closed", "linkLost")) {
      if (connection.state !== "connected") return;
      linkDown("disconnected", reason);
    },
    advance,
    setMode(next) {
      if (next === mode) return;
      stopTicker();
      mode = next;
      scheduler = new RequestScheduler<QueuedWrite>(next === "virtual" ? startTime : Date.now());
      if (next === "realtime") startTicker();
    },

    reset() {
      stopTicker();
      calls.length = 0;
      results.clear();
      failures.clear();
      holds.clear();
      replyHolds.clear();
      profiles.clear();
      polls.clear();
      order = [];
      bulkPlan = null;
      bulkResults.clear();
      bulkAcks.clear();
      bulkRunning = false;
      nextPollId = 1;
      nextToken = 1;
      sessionHandler = null;
      connection = { state: "idle", reason: null, config: null, at: 0 };
      connectionConfig = null;
      autoStartPoll = true;
      compact = false;
      compactSetByCommand = false;
      askOnPollClose = true;
      profileName = null;
      layout = defaultLayout();
      connectFailure = null;
      popOutFailure = null;
      faults.clear();
      slaveFaults.clear();
      writeQueue.length = 0;
      totalCounters = emptyCounterSet();
      writeCounters = emptyCounterSet();
      frameSeq = 0;
      linkBusyMs = 0;
      handoffWaiters.clear();
      pendingTimers.length = 0;
      requestLog.length = 0;
      focused.length = 0;
      scheduler = new RequestScheduler<QueuedWrite>(mode === "virtual" ? startTime : Date.now());
      options.persist?.storage.removeItem(storageKey);
      if (mode === "realtime") startTicker();
    },

    // ---- session and connection ----
    openSession: (onEvent) => {
      // The channel is live as soon as the command is sent, so events can arrive before the
      // snapshot reply (a held `openSession` reproduces that order).
      sessionHandler = onEvent;
      if (mode === "realtime") startTicker();
      return run("openSession", [onEvent], async () => snapshotNow());
    },
    listSerialPorts: () => run("listSerialPorts", [], async () => [...fake.ports]),
    connect: (config) =>
      run("connect", [config], async () => {
        connectionConfig = config;
        if (!active()) return;
        setConnection("connecting", null);
        const failure = connectFailure;
        connectFailure = null;
        const delay = options.connectDelayMs ?? (mode === "realtime" ? 200 : 0);
        after(delay, () => {
          if (connection.state !== "connecting") return;
          if (failure) linkDown("disconnected", failure);
          else linkUp();
        });
      }),
    cancelConnect: () =>
      run("cancelConnect", [], async () => {
        if (active() && connection.state === "connecting") linkDown("idle", null);
      }),
    disconnect: () =>
      run("disconnect", [], async () => {
        if (!active()) return;
        if (connection.state === "connected" || connection.state === "disconnected") {
          linkDown("idle", null);
        }
      }),
    setAutoStartPoll: (enabled) =>
      run("setAutoStartPoll", [enabled], async () => {
        autoStartPoll = enabled;
      }),

    // ---- polls ----
    addPoll: (input, host) =>
      run("addPoll", [input, host], async () => {
        if (order.length >= MAX_POLLS) throw new IpcError(MAX_POLLS_MESSAGE, "validation", "polls");
        checkName(input.name, null);
        checkDef(input.definition);
        checkView({
          display: input.display,
          formatOverrides: input.formatOverrides,
          scale: input.scale,
          scaleOverrides: input.scaleOverrides,
          aliases: input.aliases,
        });
        // An input without `colorRules` (hand-written test and e2e inputs) has no rules.
        const colorRules = input.colorRules ?? [];
        checkRules(colorRules, input.formatOverrides, true);
        const r = newRecord({ ...input, colorRules }, host);
        order.push(r.config.pollId);
        // PT0 is reported through `PollListChanged` only.
        if (active() && connection.state === "connected") startOrPause(r, true);
        emitPollList();
        return r.config.pollId;
      }),
    preparePollBulk: (action, pollIds) =>
      run("preparePollBulk", [action, pollIds], async () => {
        if (bulkRunning) throw new IpcError("A bulk operation is running.", "invalidState");
        if (!pollIds.length || new Set(pollIds).size !== pollIds.length)
          throw new IpcError("Select each poll once.", "validation", "pollIds");
        for (const id of pollIds) rec(id);
        const targets = order.filter((id) => pollIds.includes(id)).map((id) => summaryOf(rec(id)));
        const available = MAX_POLLS - order.length;
        if (action === "duplicate" && targets.length > available)
          throw new IpcError(
            `Cannot duplicate ${targets.length} polls. This connection has room for ${available} more (maximum 16).`,
            "validation",
            "polls",
          );
        refreshBulkRevision();
        const plan = {
          planToken: `bulk-${nextToken++}`,
          action,
          targets: structuredClone(targets),
          available,
        };
        bulkPlan = { plan, revision: bulkRevision };
        return plan;
      }),
    duplicatePolls: (planToken) =>
      run("duplicatePolls", [planToken], () => executeBulk(planToken, "duplicate")),
    removePolls: (planToken) =>
      run("removePolls", [planToken], () => executeBulk(planToken, "delete")),
    ackPollBulkReady: (operationToken, pollId, viewToken, ready) =>
      run("ackPollBulkReady", [operationToken, pollId, viewToken, ready], async () => {
        const ack = bulkAcks.get(operationToken)?.get(pollId);
        if (ack?.token === viewToken && polls.get(pollId)?.view?.token === viewToken)
          ack.resolve(ready);
      }),
    recoverPollBulkWindows: (operationToken) =>
      run("recoverPollBulkWindows", [operationToken], async () => {
        const result = bulkResults.get(operationToken);
        if (!result) throw new IpcError("Unknown bulk operation.", "invalidState");
        const recovered = { ...result, polls: order.map((id) => summaryOf(rec(id))), issues: [] };
        bulkResults.set(operationToken, recovered);
        return recovered;
      }),
    duplicatePoll: (pollId) =>
      run("duplicatePoll", [pollId], async () => {
        const source = rec(pollId);
        if (order.length >= MAX_POLLS) throw new IpcError(MAX_POLLS_MESSAGE, "validation", "polls");
        const name = nextCopyName(
          source.config.name,
          order.map((id) => rec(id).config.name),
        );
        const copy = newRecord(
          { ...structuredClone(source.config), name },
          source.open ? source.host : "workspace",
        );
        order.splice(order.indexOf(pollId) + 1, 0, copy.config.pollId);
        if (active() && connection.state === "connected") startOrPause(copy, true);
        emitPollList();
        return copy.config.pollId;
      }),
    removePoll: (pollId) =>
      run("removePoll", [pollId], async () => {
        removeRecord(rec(pollId));
      }),
    updatePoll: (pollId, definition) =>
      run("updatePoll", [pollId, definition], async () => {
        const r = rec(pollId);
        checkDef(definition);
        const changed = JSON.stringify(r.config.definition) !== JSON.stringify(definition);
        // An identical definition is a no-op: no event of any kind (BE-002).
        if (!changed) return;
        r.config.definition = { ...definition };
        r.lastUpdate = null;
        r.lastOkAt = null;
        r.cycle = 0;
        r.updateTimes = [];
        // PT6: a running poll restarts. PT6b: paused or offline keeps its state.
        if (active() && isRunning(r)) {
          setPollState(r, "polling");
          scheduler.rearm(pollId);
        }
        emitConfig(r);
        emitPollList();
      }),
    renamePoll: (pollId, name) =>
      run("renamePoll", [pollId, name], async () => {
        const r = rec(pollId);
        checkName(name, pollId);
        r.config.name = name;
        emitConfig(r);
        emitPollList();
      }),
    reorderPolls: (next) =>
      run("reorderPolls", [next], async () => {
        const valid =
          next.length === order.length &&
          new Set(next).size === next.length &&
          next.every((id) => polls.has(id));
        if (!valid) {
          throw new IpcError("The order must list every poll once.", "validation", "order");
        }
        order = [...next];
        emitPollList();
      }),
    setPollActive: (pollId, isActive) =>
      run("setPollActive", [pollId, isActive], async () => {
        const r = rec(pollId);
        if (isActive) checkDef(r.config.definition);
        r.config.active = isActive;
        if (active() && connection.state === "connected") {
          if (isActive && r.state === "paused") {
            setPollState(r, "polling");
            scheduler.rearm(pollId);
          } else if (!isActive && isRunning(r)) setPollState(r, "paused");
        }
        emitConfig(r);
        emitPollList();
      }),
    setAllPollsActive: (isActive) =>
      run("setAllPollsActive", [isActive], async () => {
        for (const id of order) {
          const r = rec(id);
          r.config.active = isActive;
          if (active() && connection.state === "connected") {
            if (isActive && r.state === "paused") {
              setPollState(r, "polling");
              scheduler.rearm(id);
            } else if (!isActive && isRunning(r)) setPollState(r, "paused");
          }
          emitConfig(r);
        }
        emitPollList();
      }),
    // A patch: keys that are left out stay as they are, `scale: null` removes the scale.
    setPollView: (pollId, view: PollViewSettings) =>
      run("setPollView", [pollId, view], async () => {
        const r = rec(pollId);
        const configBefore = JSON.stringify(r.config);
        const editsBefore = r.hasUnappliedEdits;
        checkView({
          display: view.display,
          formatOverrides: view.formatOverrides,
          scale: view.scale,
          scaleOverrides: view.scaleOverrides,
          aliases: view.aliases,
        });
        // The prospective overrides and rules are validated together; nothing changes on a failure.
        const nextOverrides = view.formatOverrides ?? r.config.formatOverrides;
        const nextRules = view.colorRules ?? r.config.colorRules;
        checkRules(nextRules, nextOverrides, view.colorRules !== undefined);
        if (view.colorRules !== undefined) r.config.colorRules = structuredClone(view.colorRules);
        if (view.formatOverrides !== undefined) {
          r.config.formatOverrides = structuredClone(view.formatOverrides).sort(
            (a, b) => a.start - b.start || a.end - b.end,
          );
        }
        if (view.display !== undefined) r.config.display = { ...view.display };
        if (view.scale !== undefined) {
          r.config.scale = view.scale === null ? null : { ...view.scale };
        }
        if (view.scaleOverrides !== undefined) {
          r.config.scaleOverrides = structuredClone(view.scaleOverrides);
        }
        if (view.valueColumns !== undefined) r.config.valueColumns = view.valueColumns;
        // Aliases are stored sorted by address.
        if (view.aliases !== undefined) {
          r.config.aliases = structuredClone(view.aliases).sort((a, b) => a.address - b.address);
        }
        if (view.hasUnappliedEdits !== undefined) r.hasUnappliedEdits = view.hasUnappliedEdits;
        // Like Rust: only a real change is announced. A flag-only patch changes the list alone.
        if (JSON.stringify(r.config) !== configBefore) emitConfig(r);
        if (JSON.stringify(r.config) !== configBefore || r.hasUnappliedEdits !== editsBefore) {
          emitPollList();
        }
      }),
    write: (request, pollId) =>
      run<WriteResult>("write", [request, pollId], async () => {
        if (active() && connection.state !== "connected") return { status: "notConnected" };
        if (!active()) {
          // Only RTU broadcasts: on TCP, unit 0 is a normal unit and gets a normal reply.
          return request.slaveId === 0 && connectionConfig?.mode === "rtu"
            ? { status: "broadcastSent" }
            : { status: "ok" };
        }
        return new Promise<WriteResult>((resolve) => {
          writeQueue.push({ request, pollId, resolve });
        });
      }),
    resetCounters: (pollId) =>
      run("resetCounters", [pollId], async () => {
        if (pollId === null) {
          totalCounters = emptyCounterSet();
          writeCounters = emptyCounterSet();
          for (const r of polls.values()) r.counters = emptyCounterSet();
        } else {
          // That poll only: the connection totals keep counting.
          rec(pollId).counters = emptyCounterSet();
        }
        toSession({ type: "Counters", ...countersNow() });
        for (const r of polls.values()) toView(r, { type: "PollCounters", ...pollCountersOf(r) });
      }),

    // ---- poll views and hosts ----
    attachPollView(pollId, host, onEvent) {
      const r = polls.get(pollId);
      const problem = !r
        ? new IpcError(`Poll ${pollId} was not found.`, "pollNotFound")
        : !r.open || r.host !== host
          ? new IpcError(
              `The poll is ${r.open ? `hosted in ${r.host}` : "closed"}, not in ${host}.`,
              "validation",
              "host",
            )
          : null;
      if (problem || !r) {
        return run<PollViewSnapshot>("attachPollView", [pollId, host, onEvent], async () => {
          throw problem ?? new IpcError("The poll view could not be attached.", "internal");
        });
      }
      // The channel is live as soon as the command is sent, as in `openSession`.
      detach(r, "replaced");
      const token = nextToken;
      nextToken += 1;
      r.view = { token, host, onEvent };
      const registered = r.view;
      return run<PollViewSnapshot>("attachPollView", [pollId, host, onEvent], async () => {
        let handoff: string | null = null;
        if (r.handoff && now() - r.handoff.at <= HANDOFF_MAX_AGE_MS) handoff = r.handoff.json;
        r.handoff = null;
        return {
          viewToken: token,
          host,
          poll: summaryOf(r),
          connection: { ...connection, config: connectionConfig },
          profileName,
          compact,
          askOnPollClose,
          lastUpdate: r.lastUpdate ? structuredClone(r.lastUpdate) : null,
          handoff,
        };
      }).catch((e: unknown) => {
        if (r.view === registered) r.view = null;
        throw e;
      });
    },
    detachPollView: (pollId, viewToken) =>
      run("detachPollView", [pollId, viewToken], async () => {
        const r = polls.get(pollId);
        if (r?.view?.token === viewToken) r.view = null;
      }),
    showPoll: (pollId, placement) =>
      run("showPoll", [pollId, placement], async () => {
        const r = rec(pollId);
        if (placement) {
          // A list drag always shows the poll in the workspace (a native poll is docked).
          if (r.host === "native" && r.open) {
            await dockInternal(r, null, true, placement.workspaceRect);
          } else {
            r.host = "workspace";
            r.open = true;
            r.workspace = structuredClone(placement.workspaceRect);
            toSession({ type: "RevealPoll", pollId, workspaceRect: structuredClone(r.workspace) });
          }
          emitPollList();
          return;
        }
        r.open = true;
        if (r.host === "workspace") {
          if (r.workspace?.state === "minimized") r.workspace = { ...r.workspace, state: "normal" };
          toSession({
            type: "RevealPoll",
            pollId,
            workspaceRect: r.workspace ? structuredClone(r.workspace) : null,
          });
        } else {
          r.native ??= defaultNative();
          focused.push(pollId);
        }
        emitPollList();
      }),
    popOutPoll: (pollId, anchor, handoff) =>
      run("popOutPoll", [pollId, anchor, handoff], async () => {
        const r = rec(pollId);
        if (r.host !== "workspace" || !r.open) {
          throw new IpcError("The poll is not shown in the workspace.", "validation", "host");
        }
        const points =
          anchor.kind === "rect"
            ? [anchor.rect.x, anchor.rect.y, anchor.rect.width, anchor.rect.height]
            : [anchor.grabOffset.x, anchor.grabOffset.y];
        if (points.some((n) => !Number.isFinite(n) || Math.abs(n) > 1_000_000)) {
          throw new IpcError(
            "The anchor needs finite coordinates within 1,000,000 px.",
            "validation",
            "anchor",
          );
        }
        // The view is detached and the list says "native" before the window exists.
        const placement = nativeFor(r, anchor);
        detach(r, "poppedOut");
        r.host = "native";
        r.handoff = handoff === null ? null : { json: handoff, at: now() };
        emitPollList();
        if (popOutFailure !== null) {
          const message = popOutFailure;
          popOutFailure = null;
          // The window could not be created: the poll returns to the workspace, handoff kept.
          r.host = "workspace";
          emitPollList();
          throw new IpcError(message, "internal");
        }
        r.native = placement;
      }),
    dockPoll: (pollId, handoff, requestHandoff, workspaceRect) =>
      run("dockPoll", [pollId, handoff, requestHandoff, workspaceRect], async () => {
        await dockInternal(rec(pollId), handoff, requestHandoff, workspaceRect);
      }),
    provideHandoff: (pollId, handoff) =>
      run("provideHandoff", [pollId, handoff], async () => {
        handoffWaiters.get(pollId)?.(handoff);
      }),
    closePollView: (pollId, keep) =>
      run("closePollView", [pollId, keep], async () => {
        const r = rec(pollId);
        if (!keep) {
          removeRecord(r);
          return;
        }
        detach(r, "closed");
        r.open = false;
        r.hasUnappliedEdits = false;
        emitPollList();
      }),
    showPollWindows: () =>
      run("showPollWindows", [], async () => {
        for (const id of order) {
          const r = rec(id);
          if (r.host === "native" && r.open) focused.push(id);
        }
      }),
    focusConnectionWindow: () => run("focusConnectionWindow", [], async () => {}),

    // ---- layout and preferences ----
    setWorkspaceLayout: (next) =>
      run("setWorkspaceLayout", [next], async () => {
        layout = structuredClone(next);
        // Rust ignores `compact` here (it is owned by `mm_set_compact_mode`). Test seeding is the one
        // exception: before any window has opened its session, and before `setCompactMode` has ever
        // been called, a stored layout carries its compact flag (REPORT-003 section 5, item 3), so a
        // test seeds layout and compact in one call.
        if (sessionHandler === null && !compactSetByCommand && next.compact !== compact) {
          compact = next.compact;
        }
        let changed = false;
        for (const item of next.items) {
          const r = polls.get(item.pollId);
          if (!r) continue;
          if (JSON.stringify(r.workspace) !== JSON.stringify(item.rect)) changed = true;
          r.workspace = structuredClone(item.rect);
        }
        // Like Rust: the list follows when a rectangle changed.
        if (changed) emitPollList();
      }),
    setCompactMode: (enabled) =>
      run("setCompactMode", [enabled], async () => {
        compactSetByCommand = true;
        compact = enabled;
        const event = { type: "PrefsChanged" as const, askOnPollClose, compact };
        toSession(event);
        toAllViews(event);
      }),
    setAskOnPollClose: (enabled) =>
      run("setAskOnPollClose", [enabled], async () => {
        askOnPollClose = enabled;
        const event = { type: "PrefsChanged" as const, askOnPollClose, compact };
        toSession(event);
        toAllViews(event);
      }),
    arrangePollWindows: (arrangeLayout: ArrangeLayout, target: ArrangeTarget) =>
      run<ArrangeResult>("arrangePollWindows", [arrangeLayout, target], async () => {
        let targetMonitor: MonitorInfo | null = null;
        if (target.kind === "monitor") {
          targetMonitor = fake.monitors.find((m) => m.id === target.monitorId) ?? null;
          if (!targetMonitor) {
            throw new IpcError("That display is no longer connected.", "validation", "monitor");
          }
        }
        const natives = fake.nativePolls();
        if (natives.length === 0) return { arranged: 0, overflow: 0 };
        const windows = natives.map((id) => {
          const p = rec(id).native ?? defaultNative();
          return { id, rect: { x: p.x, y: p.y, width: p.width, height: p.height } };
        });
        const result = arrangeNative(arrangeLayout, windows, fake.monitors, targetMonitor);
        for (const placement of result.placements) {
          const r = rec(placement.id);
          r.native = { ...placement.rect, maximized: false, monitor: placement.monitorId };
        }
        return { arranged: result.arranged, overflow: result.overflow };
      }),

    // ---- profile relays and profiles ----
    setProfileName: (name) =>
      run("setProfileName", [name], async () => {
        profileName = name;
        toAllViews({ type: "ProfileNameChanged", name });
      }),
    requestSave: (saveAs) =>
      run("requestSave", [saveAs], async () => {
        toSession({ type: "SaveRequested", saveAs: saveAs ?? false });
      }),
    showTraffic: (pollId) =>
      run("showTraffic", [pollId], async () => {
        toSession({ type: "ShowTraffic", pollId });
      }),
    applyProfile: (profile) =>
      run<SessionSnapshot>("applyProfile", [profile], async () => {
        if (active() && (connection.state === "connected" || connection.state === "connecting")) {
          throw new IpcError("Disconnect before loading a profile.", "invalidState");
        }
        profile.polls.forEach((p, i) => {
          const message = checkPollName(
            p.name,
            profile.polls.slice(0, i).map((q) => q.name),
          );
          if (message) throw new IpcError(`Poll ${i + 1}: ${message}`, "validation", "polls");
          const view = checkViewParts(p);
          if (view) throw new IpcError(`Poll ${i + 1}: ${view.message}`, "validation", "polls");
        });
        // Old views are closed without S6, the polls are replaced (new ids, profile order).
        for (const id of [...order]) {
          const old = rec(id);
          detach(old, "closed");
          polls.delete(id);
          faults.delete(id);
        }
        order = [];
        connectionConfig = profile.connection;
        autoStartPoll = profile.autoStartPoll;
        profileName = profile.name === "" ? null : profile.name;
        compact = profile.workspace.compact;
        const created: PollRecord[] = [];
        for (const p of profile.polls) {
          const r = newRecord(
            {
              name: p.name,
              definition: p.definition,
              display: p.display,
              formatOverrides: p.formatOverrides,
              colorRules: p.colorRules,
              scale: p.scale,
              scaleOverrides: p.scaleOverrides,
              valueColumns: p.valueColumns,
              aliases: p.aliases,
            },
            p.view.host,
          );
          r.config.active = p.active;
          r.open = p.view.open;
          r.workspace = p.view.workspace ? structuredClone(p.view.workspace) : null;
          r.native = p.view.native ? structuredClone(p.view.native) : null;
          order.push(r.config.pollId);
          created.push(r);
        }
        layout = {
          ...defaultLayout(),
          tileMode: profile.workspace.tileMode,
          compact: profile.workspace.compact,
          sidebarWidth: profile.workspace.sidebarWidth,
          sidebarCollapsed: profile.workspace.sidebarCollapsed,
          trafficExpanded: profile.workspace.trafficExpanded,
          trafficHeight: profile.workspace.trafficHeight,
          minimizedOrder: profile.workspace.minimizedOrder.flatMap((i) => {
            const r = created[i];
            return r ? [r.config.pollId] : [];
          }),
        };
        // `disconnected` is dismissed to `idle`.
        if (active() && connection.state === "disconnected") setConnection("idle", null);
        emitPollList();
        return snapshotNow();
      }),
    exportProfile: (name, connectionOverride) =>
      run<Profile>("exportProfile", [name, connectionOverride], async () => {
        const layoutOut = layoutNow();
        const conn = connectionOverride ?? connectionConfig;
        if (!conn) {
          throw new IpcError("There is no connection to save.", "validation", "connection");
        }
        return {
          schemaVersion: 6,
          name: name ?? profileName ?? "",
          connection: conn,
          autoStartPoll,
          connectionWindow: null,
          workspace: {
            tileMode: layoutOut.tileMode,
            compact,
            sidebarWidth: layoutOut.sidebarWidth,
            sidebarCollapsed: layoutOut.sidebarCollapsed,
            trafficExpanded: layoutOut.trafficExpanded,
            trafficHeight: layoutOut.trafficHeight,
            minimizedOrder: layoutOut.minimizedOrder.flatMap((id) => {
              const i = order.indexOf(id);
              return i === -1 ? [] : [i];
            }),
          },
          polls: order.map((id) => {
            const r = rec(id);
            return {
              name: r.config.name,
              definition: { ...r.config.definition },
              active: r.config.active,
              display: { ...r.config.display },
              formatOverrides: structuredClone(r.config.formatOverrides),
              colorRules: structuredClone(r.config.colorRules),
              scale: r.config.scale ? { ...r.config.scale } : null,
              scaleOverrides: structuredClone(r.config.scaleOverrides),
              valueColumns: r.config.valueColumns,
              aliases: structuredClone(r.config.aliases),
              view: {
                host: r.host,
                open: r.open,
                workspace: r.workspace ? structuredClone(r.workspace) : null,
                native: r.native ? structuredClone(r.native) : null,
              },
            };
          }),
          migratedFrom: null,
        };
      }),
    profilesList: () =>
      run<ProfileSummary[]>("profilesList", [], async () =>
        [...profiles.values()]
          .map(({ profile, modifiedAt }) => ({
            name: profile.name,
            modifiedAt,
            connectionSummary: summarize(profile.connection),
            readable: true,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    profilesGet: (name) =>
      run<Profile>("profilesGet", [name], async () => {
        const entry = profiles.get(name.toLowerCase());
        if (!entry) throw new IpcError(`Profile "${name}" was not found.`, "profileNotFound");
        return structuredClone(entry.profile);
      }),
    profilesSave: (profile, overwrite) =>
      run("profilesSave", [profile, overwrite], async () => {
        const key = profile.name.toLowerCase();
        if (profiles.has(key) && !overwrite) {
          throw new IpcError(`A profile named "${profile.name}" already exists.`, "profileExists");
        }
        profiles.set(key, { profile, modifiedAt: Date.now() });
      }),
    profilesRename: (oldName, newName) =>
      run("profilesRename", [oldName, newName], async () => {
        const entry = profiles.get(oldName.toLowerCase());
        if (!entry) throw new IpcError(`Profile "${oldName}" was not found.`, "profileNotFound");
        const taken =
          profiles.has(newName.toLowerCase()) && oldName.toLowerCase() !== newName.toLowerCase();
        if (taken) {
          throw new IpcError(`A profile named "${newName}" already exists.`, "profileExists");
        }
        profiles.delete(oldName.toLowerCase());
        profiles.set(newName.toLowerCase(), {
          profile: { ...entry.profile, name: newName },
          modifiedAt: Date.now(),
        });
      }),
    profilesDelete: (name) =>
      run("profilesDelete", [name], async () => {
        if (!profiles.delete(name.toLowerCase())) {
          throw new IpcError(`Profile "${name}" was not found.`, "profileNotFound");
        }
      }),
  };

  async function executeBulk(planToken: string, action: PollBulkAction): Promise<PollBulkResult> {
    const recorded = bulkResults.get(planToken);
    if (recorded) {
      if (recorded.action !== action) throw new IpcError("Wrong bulk action.", "invalidState");
      return structuredClone(recorded);
    }
    if (
      bulkRunning ||
      !bulkPlan ||
      bulkPlan.plan.planToken !== planToken ||
      bulkPlan.plan.action !== action
    )
      throw new IpcError("Prepare the operation again.", "invalidState", "planToken");
    const { plan, revision } = bulkPlan;
    bulkPlan = null;
    refreshBulkRevision();
    const stale = () =>
      new IpcError(
        "The selected polls changed. Review your selection and try again.",
        "validation",
        "pollIds",
      );
    if (revision !== bulkRevision) throw stale();
    if (action === "duplicate" && order.length + plan.targets.length > MAX_POLLS)
      throw new IpcError(
        `Cannot duplicate ${plan.targets.length} polls. This connection has room for ${MAX_POLLS - order.length} more (maximum 16).`,
        "validation",
        "polls",
      );
    bulkRunning = true;
    const targets = plan.targets.map((target) => rec(target.config.pollId));
    const acks = new Map<PollId, { token: ViewToken; resolve: (ready: boolean) => void }>();
    bulkAcks.set(planToken, acks);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (targets.some((r) => r.open && r.host === "native" && !r.view))
        throw new IpcError(
          "Close dialogs in the selected poll windows and try again.",
          "validation",
          "lifecycle",
        );
      const waits = targets
        .filter((r) => r.view)
        .map(
          (r) =>
            new Promise<boolean>((resolve) => {
              acks.set(r.config.pollId, { token: r.view?.token ?? -1, resolve });
            }),
        );
      for (const r of targets)
        toView(r, { type: "BulkOperationPrepare", operationToken: planToken, action });
      const ready = await Promise.race([
        Promise.all(waits).then((values) => values.every(Boolean)),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]);
      if (!ready)
        throw new IpcError(
          "Close dialogs in the selected poll windows and try again.",
          "validation",
          "lifecycle",
        );
      refreshBulkRevision();
      if (revision !== bulkRevision) throw stale();
      const created: PollBulkResult["created"] = [];
      const removedIds: PollId[] = [];
      if (action === "duplicate") {
        const insertion = Math.max(...targets.map((r) => order.indexOf(r.config.pollId))) + 1;
        const names = order.map((id) => rec(id).config.name);
        for (const source of targets) {
          const name = nextCopyName(source.config.name, names);
          names.push(name);
          const copy = newRecord(
            { ...structuredClone(source.config), name },
            source.open ? source.host : "workspace",
          );
          if (copy.host === "native") {
            const placement = source.native ?? defaultNative();
            copy.native = { ...placement, x: placement.x + 24, y: placement.y + 24 };
          }
          created.push({ sourceId: source.config.pollId, pollId: copy.config.pollId });
          if (active() && connection.state === "connected") startOrPause(copy, true);
        }
        order.splice(insertion, 0, ...created.map((copy) => copy.pollId));
      } else {
        for (const r of targets) {
          removedIds.push(r.config.pollId);
          removeRecord(r, false);
        }
      }
      emitPollList();
      const result: PollBulkResult = {
        operationToken: planToken,
        action,
        definitionsCommitted: true,
        created,
        removedIds,
        polls: order.map((id) => summaryOf(rec(id))),
        issues: [],
      };
      bulkResults.set(planToken, result);
      if (bulkResults.size > 16) {
        const oldest = bulkResults.keys().next().value;
        if (oldest !== undefined) bulkResults.delete(oldest);
      }
      return structuredClone(result);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      for (const r of targets)
        toView(r, { type: "BulkOperationRelease", operationToken: planToken });
      bulkAcks.delete(planToken);
      bulkRunning = false;
    }
  }

  async function run<T>(method: CommandName, args: unknown[], impl: () => Promise<T>): Promise<T> {
    calls.push({ method, args });
    const held = holds.get(method);
    if (held) {
      holds.delete(method);
      return (await held.promise) as T;
    }
    // The effects run now; a held reply only delays the answer (and may replace it).
    const replyHold = replyHolds.get(method);
    replyHolds.delete(method);
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await compute(method, args, impl) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    persistNow();
    if (replyHold) await replyHold.promise;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  async function compute<T>(
    method: CommandName,
    args: unknown[],
    impl: () => Promise<T>,
  ): Promise<T> {
    if (
      bulkRunning &&
      (
        [
          "addPoll",
          "duplicatePoll",
          "removePoll",
          "updatePoll",
          "renamePoll",
          "reorderPolls",
          "setPollActive",
          "setAllPollsActive",
          "setPollView",
          "applyProfile",
          "showPoll",
          "popOutPoll",
          "dockPoll",
          "closePollView",
          "attachPollView",
        ] as CommandName[]
      ).includes(method)
    ) {
      throw new IpcError("A bulk operation is running.", "invalidState");
    }
    const failure = failures.get(method);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error;
    }
    if (results.has(method)) {
      const value = results.get(method);
      return (
        typeof value === "function" ? (value as (...a: unknown[]) => T)(...args) : value
      ) as T;
    }
    return impl();
  }

  restoreModel();
  if (mode === "realtime") startTicker();
  return fake;
}

function summarize(connection: ConnectionConfig): string {
  return connection.mode === "tcp"
    ? `TCP ${connection.host}:${connection.port}`
    : `RTU ${connection.port} ${connection.baud} ${connection.dataBits}${connection.parity === "none" ? "N" : connection.parity === "even" ? "E" : "O"}${connection.stopBits}`;
}
