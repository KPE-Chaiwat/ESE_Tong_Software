// A scriptable fake of the Modbus Master IPC facade. It is the only backend that unit tests, Testing
// Library tests and (with VITE_FAKE_IPC=1) the dev server and Playwright talk to.
//
// By default every command is recorded and succeeds without emitting any event, so a test drives the
// session by hand: `fake.emitState("connected")`. With `simulate: true` the fake behaves like a tiny
// device: it walks the session states and streams poll data, for the dev mode.
import { IpcError, type ModbusMasterIpc } from "./modbus-master";
import type {
  BadResponseDetail,
  BadResponseKind,
  ConnectionConfig,
  Counters,
  PollDefinition,
  PollUpdateEvent,
  Profile,
  ProfileSummary,
  ReasonKind,
  ReasonPhase,
  SerialPortInfo,
  SessionEvent,
  SessionReason,
  SessionSnapshot,
  SessionState,
  StateChanged,
  TrafficFrame,
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

export interface FakeOptions {
  simulate?: boolean;
  ports?: SerialPortInfo[];
}

export interface StreamOptions {
  intervalMs?: number;
  quantity?: number;
  framesPerTick?: number;
}

export const EMPTY_COUNTERS: Counters = { requests: 0, responses: 0, errors: 0, timeouts: 0 };

/** A snapshot of a session that has not done anything yet. */
export function idleSnapshot(): SessionSnapshot {
  return {
    state: "idle",
    reason: null,
    consecutiveFailures: 0,
    exceptionCode: null,
    badResponseKind: null,
    badResponseDetail: null,
    at: 0,
    config: null,
    poll: null,
    counters: EMPTY_COUNTERS,
    lastUpdate: null,
  };
}

/** The bad-response fields of a `StateChanged` event, for tests. */
export function badResponseExtra(
  kind: BadResponseKind,
  detail: BadResponseDetail = { expected: null, got: null, message: "" },
): Pick<StateChanged, "badResponseKind" | "badResponseDetail"> {
  return { badResponseKind: kind, badResponseDetail: detail };
}

/** A `SessionReason` for tests and the fake. */
export function sessionReason(
  kind: ReasonKind,
  message: string = kind,
  phase: ReasonPhase = "connectFailed",
): SessionReason {
  return { kind, phase, message };
}

export interface FakeModbusMasterIpc extends ModbusMasterIpc {
  readonly calls: FakeCall[];
  callsOf(method: CommandName): unknown[][];
  /** Returned by `openSession`. Mutable so a test can start from any state. */
  snapshot: SessionSnapshot;
  ports: SerialPortInfo[];

  /** Replaces the result of a command (a value, or a function of the call arguments). */
  setResult(method: CommandName, value: unknown): void;
  /** Makes the next `times` calls of a command reject. */
  failNext(method: CommandName, error: string | IpcError, times?: number): void;
  /** Makes every call of a command reject until `clearFailures`. */
  failAlways(method: CommandName, error: string | IpcError): void;
  clearFailures(): void;
  /** The next call of a command stays pending until released. */
  hold(method: CommandName): HeldCommand;

  emit(event: SessionEvent): void;
  emitState(state: SessionState, extra?: Partial<Omit<StateChanged, "state">>): void;
  emitPollUpdate(update: Partial<Omit<PollUpdateEvent, "type">> & { values: number[] }): void;
  emitFrames(frames: TrafficFrame[]): void;
  emitCounters(counters: Counters): void;

  seedProfiles(profiles: Profile[]): void;
  startStream(options?: StreamOptions): void;
  stopStream(): void;
  /**
   * Switches the simulation on or off. Off ("manual") is the default of the plain fake: commands
   * only record and succeed, and the test emits every event itself.
   */
  setSimulate(on: boolean): void;
  /** Drops recorded calls, scripted results/failures, held commands, profiles and the stream. */
  reset(): void;
}

export function createFakeModbusMasterIpc(options: FakeOptions = {}): FakeModbusMasterIpc {
  let simulate = options.simulate ?? false;
  const calls: FakeCall[] = [];
  const results = new Map<CommandName, unknown>();
  const failures = new Map<CommandName, { error: IpcError; remaining: number }>();
  const holds = new Map<CommandName, { promise: Promise<unknown> }>();
  const profiles = new Map<string, { profile: Profile; modifiedAt: number }>();
  let handler: ((event: SessionEvent) => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let streamSeq = 0;
  let frameSeq = 0;
  let counters: Counters = { ...EMPTY_COUNTERS };
  let activePoll: PollDefinition | null = null;

  const asError = (e: string | IpcError) => (typeof e === "string" ? new IpcError(e) : e);

  const fake: FakeModbusMasterIpc = {
    calls,
    snapshot: idleSnapshot(),
    ports: options.ports ?? [
      { name: "COM3", description: "USB Serial Device" },
      { name: "COM4", description: null },
    ],

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

    emit(event) {
      // Events emitted before openSession are dropped, like on the real channel.
      handler?.(event);
    },
    emitState(state, extra = {}) {
      fake.emit({
        type: "StateChanged",
        state,
        reason: null,
        consecutiveFailures: 0,
        exceptionCode: null,
        badResponseKind: null,
        badResponseDetail: null,
        at: Date.now(),
        ...extra,
      });
    },
    emitPollUpdate(update) {
      streamSeq += 1;
      fake.emit({
        type: "PollUpdate",
        seq: streamSeq,
        at: Date.now(),
        slaveId: 1,
        function: 3,
        startAddress: 0,
        roundTripMs: 8,
        ...update,
      });
    },
    emitFrames: (frames) => fake.emit({ type: "TrafficFrames", frames }),
    emitCounters: (c) => fake.emit({ type: "Counters", ...c }),

    seedProfiles(list) {
      for (const profile of list) {
        profiles.set(profile.name.toLowerCase(), { profile, modifiedAt: Date.now() });
      }
    },

    startStream({ intervalMs = 100, quantity = 125, framesPerTick = 2 } = {}) {
      fake.stopStream();
      timer = setInterval(() => {
        const def = activePoll;
        const qty = def?.quantity ?? quantity;
        const at = Date.now();
        streamSeq += 1;
        fake.emit({
          type: "PollUpdate",
          seq: streamSeq,
          at,
          slaveId: def?.slaveId ?? 1,
          function: def?.function ?? 3,
          startAddress: def?.startAddress ?? 0,
          roundTripMs: 8,
          values: Array.from({ length: qty }, (_, i) => (i * 7 + streamSeq) & 0xffff),
        });
        const frames: TrafficFrame[] = [];
        for (let i = 0; i < framesPerTick; i += 1) {
          frameSeq += 1;
          const tx = i % 2 === 0;
          frames.push({
            seq: frameSeq,
            at,
            direction: tx ? "tx" : "rx",
            bytes: tx
              ? [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, qty & 0xff]
              : [0, 1, 0, 0, 0, qty * 2 + 3, 1, 3, (qty * 2) & 0xff],
            slaveId: def?.slaveId ?? 1,
            function: 3,
            exceptionCode: null,
            note: null,
          });
        }
        counters = {
          ...counters,
          requests: counters.requests + 1,
          responses: counters.responses + 1,
        };
        fake.emit({ type: "TrafficFrames", frames });
        fake.emit({ type: "Counters", ...counters });
      }, intervalMs);
    },
    stopStream() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    setSimulate(on) {
      simulate = on;
      if (!on) fake.stopStream();
    },

    reset() {
      fake.stopStream();
      calls.length = 0;
      results.clear();
      failures.clear();
      holds.clear();
      profiles.clear();
      handler = null;
      streamSeq = 0;
      frameSeq = 0;
      counters = { ...EMPTY_COUNTERS };
      activePoll = null;
      fake.snapshot = idleSnapshot();
    },

    // ---- commands ----
    openSession: (onEvent) => {
      // The channel is live as soon as the command is sent, so events can arrive before the
      // snapshot reply (a held `openSession` reproduces that order).
      handler = onEvent;
      return run("openSession", [onEvent], async () => fake.snapshot);
    },
    listSerialPorts: () => run("listSerialPorts", [], async () => [...fake.ports]),
    connect: (config) =>
      run("connect", [config], async () => {
        fake.snapshot = { ...fake.snapshot, config };
        if (simulate) {
          fake.emitState("connecting");
          setTimeout(() => fake.emitState("connected"), 200);
        }
      }),
    cancelConnect: () =>
      run("cancelConnect", [], async () => {
        if (simulate) fake.emitState("idle");
      }),
    disconnect: () =>
      run("disconnect", [], async () => {
        fake.stopStream();
        activePoll = null;
        if (simulate) fake.emitState("idle");
      }),
    startPoll: (definition) =>
      run("startPoll", [definition], async () => {
        activePoll = definition;
        if (simulate) {
          fake.emitState("polling");
          fake.startStream({ intervalMs: definition.scanRateMs });
        }
      }),
    stopPoll: () =>
      run("stopPoll", [], async () => {
        fake.stopStream();
        if (simulate) fake.emitState("paused");
      }),
    write: (request: WriteRequest) =>
      run<WriteResult>("write", [request], async () =>
        // Only RTU broadcasts: on TCP, unit 0 is a normal unit and gets a normal reply.
        request.slaveId === 0 && fake.snapshot.config?.mode === "rtu"
          ? { status: "broadcastSent" }
          : { status: "ok" },
      ),
    resetCounters: () =>
      run("resetCounters", [], async () => {
        counters = { ...EMPTY_COUNTERS };
        if (simulate) fake.emitCounters(counters);
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
        return entry.profile;
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

  async function run<T>(method: CommandName, args: unknown[], impl: () => Promise<T>): Promise<T> {
    calls.push({ method, args });
    const held = holds.get(method);
    if (held) {
      holds.delete(method);
      return (await held.promise) as T;
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

  return fake;
}

function summarize(connection: ConnectionConfig): string {
  return connection.mode === "tcp"
    ? `TCP ${connection.host}:${connection.port}`
    : `RTU ${connection.port} ${connection.baud} ${connection.dataBits}${connection.parity === "none" ? "N" : connection.parity === "even" ? "E" : "O"}${connection.stopBits}`;
}
