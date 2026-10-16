import { IpcError } from "@/shared/ipc/modbus-master";
import {
  badResponseExtra as bad,
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  idleSnapshot,
  sessionReason,
} from "@/shared/ipc/modbus-master.fake";
import type {
  ConnectionConfig,
  PollDefinition,
  SessionEvent,
} from "@/shared/ipc/modbus-master.types";
import { answersPending } from "./session.logic";
import { createSessionStore, type SessionStoreApi } from "./session.store";

const config: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const def: PollDefinition = {
  slaveId: 1,
  function: 3,
  startAddress: 0,
  quantity: 10,
  scanRateMs: 1000,
};

let ipc: FakeModbusMasterIpc;
let store: SessionStoreApi;
let warnings: string[];
let forwarded: SessionEvent[];

async function setup(initial?: Parameters<typeof ipc.emitState>[0]) {
  ipc = createFakeModbusMasterIpc();
  warnings = [];
  forwarded = [];
  store = createSessionStore({
    ipc,
    warn: (m) => warnings.push(m),
    onEvent: (e) => forwarded.push(e),
  });
  await store.getState().init();
  if (initial) ipc.emitState(initial);
}

const get = () => store.getState();

/** Drives the session to a state through legal transitions. */
async function reach(target: "connected" | "polling" | "paused" | "timeout" | "disconnected") {
  ipc.emitState("connecting");
  if (target === "disconnected") {
    ipc.emitState("disconnected", { reason: sessionReason("refused", "refused") });
    return;
  }
  ipc.emitState("connected");
  if (target === "connected") return;
  ipc.emitState("polling");
  if (target === "paused") ipc.emitState("paused");
  if (target === "timeout") ipc.emitState("timeout");
}

beforeEach(async () => {
  await setup();
});

describe("initial state", () => {
  it("is idle with nothing pending", () => {
    expect(get()).toMatchObject({
      state: "idle",
      reason: null,
      exceptionCode: null,
      badResponse: null,
      consecutiveFailures: 0,
      pending: null,
      commandError: null,
      lastUnexpected: null,
    });
  });
});

describe("init", () => {
  it("applies the snapshot and routes events", async () => {
    ipc = createFakeModbusMasterIpc();
    ipc.snapshot = {
      ...ipc.snapshot,
      state: "paused",
      poll: def,
    };
    const onSnapshot = vi.fn();
    store = createSessionStore({ ipc, onEvent: (e) => forwarded.push(e), onSnapshot });
    forwarded = [];
    await get().init();
    expect(get().state).toBe("paused");
    expect(get().pollDefinition).toEqual(def);
    expect(get().ready).toBe(true);
    expect(onSnapshot).toHaveBeenCalledWith(ipc.snapshot);

    ipc.emitState("polling");
    ipc.emitPollUpdate({ values: [1] });
    ipc.emitCounters({ requests: 1, responses: 1, errors: 0, timeouts: 0 });
    expect(get().state).toBe("polling");
    expect(forwarded.map((e) => e.type)).toEqual(["PollUpdate", "Counters"]);
  });

  it("propagates an openSession failure", async () => {
    ipc = createFakeModbusMasterIpc();
    ipc.failNext("openSession", "no backend");
    store = createSessionStore({ ipc });
    await expect(get().init()).rejects.toThrow("no backend");
    expect(get().ready).toBe(false);
  });
});

describe("T1 connect", () => {
  it("sends the config, sets pending and clears it on the connecting event", async () => {
    await get().connect(config);
    expect(ipc.callsOf("connect")).toEqual([[config]]);
    expect(get().pending).toBe("connect");
    expect(get().state).toBe("idle");
    ipc.emitState("connecting");
    expect(get().state).toBe("connecting");
    expect(get().pending).toBeNull();
  });

  it("is ignored while a connect is pending, and outside idle/disconnected", async () => {
    await get().connect(config);
    await get().connect(config);
    expect(ipc.callsOf("connect")).toHaveLength(1);
    ipc.emitState("connecting");
    await get().connect(config);
    expect(ipc.callsOf("connect")).toHaveLength(1);
  });

  it("keeps the pending flag while the command is in flight", async () => {
    const held = ipc.hold("connect");
    const p = get().connect(config);
    expect(get().pending).toBe("connect");
    held.release();
    await p;
    expect(get().pending).toBe("connect");
  });

  it("clears pending and records the error when the command is rejected", async () => {
    ipc.failNext("connect", "Port 502 is invalid");
    await get().connect(config);
    expect(get().pending).toBeNull();
    expect(get().commandError).toBe("Port 502 is invalid");
    expect(get().state).toBe("idle");
    get().clearCommandError();
    expect(get().commandError).toBeNull();
  });

  it("a new command clears an old command error", async () => {
    ipc.failNext("connect", "first");
    await get().connect(config);
    await get().connect(config);
    expect(get().commandError).toBeNull();
  });
});

describe("T2 connecting -> connected", () => {
  it("applies the link-up event", async () => {
    ipc.emitState("connecting");
    ipc.emitState("connected", { at: 5000 });
    expect(get().state).toBe("connected");
    expect(get().since).toBe(5000);
    expect(warnings).toEqual([]);
  });
});

describe("T3 connect failed", () => {
  it("moves to disconnected with the reason", () => {
    ipc.emitState("connecting");
    ipc.emitState("disconnected", { reason: sessionReason("refused", "refused") });
    expect(get().state).toBe("disconnected");
    expect(get().reason).toEqual(sessionReason("refused", "refused"));
    expect(warnings).toEqual([]);
  });
});

describe("T4 cancel", () => {
  it("sends cancel while connecting and ends in idle", async () => {
    ipc.emitState("connecting");
    await get().cancelConnect();
    expect(ipc.callsOf("cancelConnect")).toHaveLength(1);
    expect(get().pending).toBe("cancel");
    ipc.emitState("idle");
    expect(get().state).toBe("idle");
    expect(get().pending).toBeNull();
  });

  it("does nothing outside connecting", async () => {
    await get().cancelConnect();
    expect(ipc.callsOf("cancelConnect")).toHaveLength(0);
  });

  it("reports a rejected cancel", async () => {
    ipc.emitState("connecting");
    ipc.failNext("cancelConnect", "too late");
    await get().cancelConnect();
    expect(get().commandError).toBe("too late");
    expect(get().pending).toBeNull();
  });
});

describe("T5 start poll", () => {
  it("starts from connected and from paused", async () => {
    await reach("connected");
    await get().startPoll(def);
    expect(ipc.callsOf("startPoll")).toEqual([[def]]);
    expect(get().pending).toBe("startPoll");
    expect(get().pollDefinition).toEqual(def);
    ipc.emitState("polling");
    expect(get().state).toBe("polling");
    expect(get().pending).toBeNull();

    ipc.emitState("paused");
    await get().startPoll(def);
    ipc.emitState("polling");
    expect(ipc.callsOf("startPoll")).toHaveLength(2);
    expect(get().state).toBe("polling");
  });

  it("is ignored when there is no link", async () => {
    await get().startPoll(def);
    expect(ipc.callsOf("startPoll")).toHaveLength(0);
    expect(get().pending).toBeNull();
  });

  it("clears pending when rejected", async () => {
    await reach("connected");
    ipc.failNext("startPoll", "invalid poll");
    await get().startPoll(def);
    expect(get().commandError).toBe("invalid poll");
    expect(get().pending).toBeNull();
    expect(get().state).toBe("connected");
  });
});

describe("T6-T9 poll cycle results", () => {
  beforeEach(async () => {
    await reach("connected");
    ipc.emitState("polling");
  });

  it("T7 timeouts count up: 3 in a row give 3", () => {
    ipc.emitState("timeout");
    ipc.emitState("timeout");
    ipc.emitState("timeout");
    expect(get().state).toBe("timeout");
    expect(get().consecutiveFailures).toBe(3);
  });

  it("T8 switching from timeout to exception resets the counter to 1", () => {
    ipc.emitState("timeout");
    ipc.emitState("timeout");
    ipc.emitState("exception", { exceptionCode: 2 });
    expect(get().state).toBe("exception");
    expect(get().exceptionCode).toBe(2);
    expect(get().consecutiveFailures).toBe(1);
    ipc.emitState("exception", { exceptionCode: 2 });
    expect(get().consecutiveFailures).toBe(2);
  });

  it("T9 bad response keeps its kind", () => {
    ipc.emitState("badResponse", bad("crc"));
    expect(get().state).toBe("badResponse");
    expect(get().badResponse).toEqual({
      kind: "crc",
      detail: { expected: null, got: null, message: "" },
    });
    expect(get().consecutiveFailures).toBe(1);
  });

  it("T6 a good cycle returns to polling and clears the failure details", () => {
    ipc.emitState("exception", { exceptionCode: 2 });
    ipc.emitState("polling");
    expect(get()).toMatchObject({
      state: "polling",
      consecutiveFailures: 0,
      exceptionCode: null,
      badResponse: null,
    });
    expect(warnings).toEqual([]);
  });
});

describe("T10 pause", () => {
  it("sends stop and moves to paused from a failure state too", async () => {
    await reach("timeout");
    await get().stopPoll();
    expect(ipc.callsOf("stopPoll")).toHaveLength(1);
    expect(get().pending).toBe("stopPoll");
    ipc.emitState("paused");
    expect(get().state).toBe("paused");
    expect(get().consecutiveFailures).toBe(0);
    expect(get().pending).toBeNull();
  });

  it("is ignored when no poll is running", async () => {
    await reach("connected");
    await get().stopPoll();
    expect(ipc.callsOf("stopPoll")).toHaveLength(0);
  });

  it("reports a rejected pause", async () => {
    await reach("polling");
    ipc.failNext("stopPoll", "nope");
    await get().stopPoll();
    expect(get().commandError).toBe("nope");
    expect(get().state).toBe("polling");
  });
});

describe("T11 apply while running", () => {
  it("restarts the poll: polling -> polling clears pending", async () => {
    await reach("polling");
    const next = { ...def, quantity: 20 };
    await get().startPoll(next);
    expect(get().pending).toBe("startPoll");
    expect(get().pollDefinition).toEqual(next);
    ipc.emitState("polling");
    expect(get().pending).toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe("T12 disconnect", () => {
  it.each(["connected", "polling", "paused", "timeout"] as const)(
    "from %s ends in idle",
    async (from) => {
      await reach(from);
      await get().disconnect();
      expect(ipc.callsOf("disconnect")).toHaveLength(1);
      expect(get().pending).toBe("disconnect");
      ipc.emitState("idle");
      expect(get().state).toBe("idle");
      expect(get().pending).toBeNull();
      expect(warnings).toEqual([]);
    },
  );

  it("is ignored when idle or already pending", async () => {
    await get().disconnect();
    expect(ipc.callsOf("disconnect")).toHaveLength(0);
    await reach("connected");
    await get().disconnect();
    await get().disconnect();
    expect(ipc.callsOf("disconnect")).toHaveLength(1);
  });

  it("reports a rejected disconnect", async () => {
    await reach("connected");
    ipc.failNext("disconnect", "busy");
    await get().disconnect();
    expect(get().commandError).toBe("busy");
    expect(get().pending).toBeNull();
  });
});

describe("T13 link lost", () => {
  it.each(["connected", "polling", "paused", "timeout"] as const)(
    "from %s ends in disconnected",
    async (from) => {
      await reach(from);
      ipc.emitState("disconnected", { reason: sessionReason("closedByPeer", "bye") });
      expect(get().state).toBe("disconnected");
      expect(get().reason?.kind).toBe("closedByPeer");
      expect(get().consecutiveFailures).toBe(0);
      expect(warnings).toEqual([]);
    },
  );
});

describe("T14 reconnect", () => {
  it("connects again from disconnected", async () => {
    await reach("disconnected");
    await get().connect(config);
    expect(ipc.callsOf("connect")).toEqual([[config]]);
    ipc.emitState("connecting");
    expect(get().state).toBe("connecting");
    expect(get().reason).toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe("T15 dismiss", () => {
  it("asks the backend (mm_disconnect dismisses) and ends in idle on its event", async () => {
    await reach("disconnected");
    await get().dismiss();
    expect(ipc.callsOf("disconnect")).toHaveLength(1);
    expect(get().pending).toBe("dismiss");
    expect(get().state).toBe("disconnected");
    ipc.emitState("idle");
    expect(get().state).toBe("idle");
    expect(get().reason).toBeNull();
    expect(get().pending).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("only works from disconnected", async () => {
    await reach("connected");
    await get().dismiss();
    expect(get().state).toBe("connected");
    expect(ipc.callsOf("disconnect")).toHaveLength(0);
  });

  it("is ignored while a dismiss is pending", async () => {
    await reach("disconnected");
    await get().dismiss();
    await get().dismiss();
    expect(ipc.callsOf("disconnect")).toHaveLength(1);
  });

  it("reports a rejected dismiss and keeps the disconnected state", async () => {
    await reach("disconnected");
    ipc.failNext("disconnect", "no session");
    await get().dismiss();
    expect(get().commandError).toBe("no session");
    expect(get().pending).toBeNull();
    expect(get().state).toBe("disconnected");
  });
});

describe("unexpected transitions", () => {
  it("applies idle -> polling, records it and warns", () => {
    ipc.emitState("polling");
    expect(get().state).toBe("polling");
    expect(get().lastUnexpected).toEqual({ from: "idle", to: "polling" });
    expect(warnings).toEqual(["Unexpected session transition idle -> polling"]);
  });

  it("does not warn again for an expected event afterwards", () => {
    ipc.emitState("polling");
    ipc.emitState("timeout");
    expect(warnings).toHaveLength(1);
  });
});

describe("selectors", () => {
  it("expose the minimum slices", async () => {
    const { selectSessionState, selectPending, selectConsecutiveFailures, selectExceptionCode } =
      await import("./session.store");
    await reach("polling");
    ipc.emitState("exception", { exceptionCode: 3 });
    expect(selectSessionState(get())).toBe("exception");
    expect(selectExceptionCode(get())).toBe(3);
    expect(selectConsecutiveFailures(get())).toBe(1);
    expect(selectPending(get())).toBeNull();
  });
});

describe("REV-002 M3: events that arrive before the snapshot reply", () => {
  async function reopen(snapshot: Partial<ReturnType<typeof idleSnapshot>>) {
    ipc = createFakeModbusMasterIpc();
    ipc.snapshot = { ...idleSnapshot(), ...snapshot };
    warnings = [];
    forwarded = [];
    store = createSessionStore({
      ipc,
      warn: (m) => warnings.push(m),
      onEvent: (e) => forwarded.push(e),
    });
    const held = ipc.hold("openSession");
    const opened = get().init();
    return { held, opened };
  }

  it("a newer state change delivered first is applied on top of the older snapshot", async () => {
    // Reproduction from the review: the snapshot says timeout (3 in a row, at 1000) and the
    // backend has already moved on to polling (at 1100) when the reply is delivered.
    const { held, opened } = await reopen({ state: "timeout", consecutiveFailures: 3, at: 1000 });
    ipc.emitState("polling", { at: 1100 });
    held.release(ipc.snapshot);
    await opened;
    expect(get().state).toBe("polling");
    expect(get().consecutiveFailures).toBe(0);
    expect(get().ready).toBe(true);
  });

  it("an early connected is not lost behind a connecting snapshot", async () => {
    const { held, opened } = await reopen({ state: "connecting", at: 2000 });
    ipc.emitState("connected", { at: 2100 });
    held.release(ipc.snapshot);
    await opened;
    expect(get().state).toBe("connected");
  });

  it("held events are replayed as they arrived, whatever their timestamps say (REV-003 n-1)", async () => {
    // A wall clock that stepped backwards must not make a real transition disappear.
    const { held, opened } = await reopen({ state: "paused", at: 5000 });
    ipc.emitState("polling", { at: 4000 });
    held.release(ipc.snapshot);
    await opened;
    expect(get().state).toBe("polling");
  });

  it("a later event after the replay is applied normally and nothing is replayed twice", async () => {
    const seen: string[] = [];
    ipc = createFakeModbusMasterIpc();
    ipc.snapshot = { ...idleSnapshot(), state: "polling", at: 10 };
    store = createSessionStore({ ipc, onEvent: (e) => seen.push(e.type) });
    const held = ipc.hold("openSession");
    const opened = get().init();
    ipc.emitCounters({ requests: 1, responses: 1, errors: 0, timeouts: 0 });
    held.release(ipc.snapshot);
    await opened;
    ipc.emitCounters({ requests: 2, responses: 2, errors: 0, timeouts: 0 });
    expect(seen).toEqual(["Counters", "Counters"]);
  });

  it("other events are held and forwarded after the snapshot, in order", async () => {
    const seen: string[] = [];
    ipc = createFakeModbusMasterIpc();
    ipc.snapshot = { ...idleSnapshot(), state: "polling", at: 10 };
    store = createSessionStore({
      ipc,
      onEvent: (e) => seen.push(`${e.type}:${get().ready}`),
      onSnapshot: () => seen.push("snapshot"),
    });
    const held = ipc.hold("openSession");
    const opened = get().init();
    ipc.emitPollUpdate({ values: [1] });
    ipc.emitCounters({ requests: 1, responses: 1, errors: 0, timeouts: 0 });
    expect(seen).toEqual([]);
    held.release(ipc.snapshot);
    await opened;
    expect(seen).toEqual(["snapshot", "PollUpdate:true", "Counters:true"]);
  });

  it("session commands are ignored until the snapshot is applied", async () => {
    const { held, opened } = await reopen({});
    await get().connect(config);
    expect(ipc.callsOf("connect")).toHaveLength(0);
    held.release(ipc.snapshot);
    await opened;
    await get().connect(config);
    expect(ipc.callsOf("connect")).toHaveLength(1);
  });
});

describe("REV-002 M2: the session remembers what it actually runs", () => {
  it("connect records the connection and a rejected connect restores the old one", async () => {
    await get().connect(config);
    expect(get().connection).toEqual(config);
    ipc.emitState("connecting");
    ipc.emitState("disconnected", { reason: sessionReason("refused", "x") });
    ipc.failNext("connect", "nope");
    await get().connect({ ...config, host: "10.0.0.9" });
    expect(get().connection).toEqual(config);
  });

  it("startPoll records the definition and a rejected one restores the old one", async () => {
    await reach("connected");
    await get().startPoll(def);
    expect(get().pollDefinition).toEqual(def);
    ipc.emitState("polling");
    ipc.failNext("startPoll", "invalid poll");
    await get().startPoll({ ...def, quantity: 99 });
    expect(get().pollDefinition).toEqual(def);
  });

  it("the snapshot provides both", async () => {
    ipc = createFakeModbusMasterIpc();
    ipc.snapshot = { ...idleSnapshot(), state: "polling", config, poll: def };
    store = createSessionStore({ ipc });
    await get().init();
    expect(get().connection).toEqual(config);
    expect(get().pollDefinition).toEqual(def);
  });
});

describe("REV-002 m9: pending is cleared by the event that answers it", () => {
  beforeEach(async () => {
    await reach("timeout");
  });

  it("a repeated timeout does not clear a pending Apply, the restart does", async () => {
    const held = ipc.hold("startPoll");
    const apply = get().startPoll({ ...def, quantity: 20 });
    expect(get().pending).toBe("startPoll");
    ipc.emitState("timeout");
    expect(get().pending).toBe("startPoll");
    ipc.emitState("polling");
    expect(get().pending).toBeNull();
    held.release();
    await apply;
  });

  it("after the command returned, the next event clears it (a backend that skips the restart)", async () => {
    await get().startPoll({ ...def, quantity: 20 });
    expect(get().pendingResolved).toBe(true);
    ipc.emitState("timeout");
    expect(get().pending).toBeNull();
    expect(get().pendingResolved).toBe(false);
  });

  it("a second Apply while the first is pending is sent, not dropped", async () => {
    const held = ipc.hold("startPoll");
    const first = get().startPoll({ ...def, quantity: 20 });
    await get().startPoll({ ...def, quantity: 30 });
    expect(ipc.callsOf("startPoll")).toHaveLength(2);
    expect(get().pollDefinition?.quantity).toBe(30);
    held.release();
    await first;
    // The first command returning must not mark the second one as answered.
    expect(get().pending).toBe("startPoll");
    expect(get().pendingResolved).toBe(true);
  });

  it("a failing older command does not clear the pending state of a newer one", async () => {
    const held = ipc.hold("startPoll");
    const first = get().startPoll({ ...def, quantity: 20 });
    await get().startPoll({ ...def, quantity: 30 });
    held.fail("old failure");
    await first;
    expect(get().commandError).toBe("old failure");
    expect(get().pending).toBe("startPoll");
  });
});

describe("pending answers (pure rule)", () => {
  it.each([
    ["connect", "idle", "connecting", true],
    ["connect", "disconnected", "disconnected", false],
    ["cancel", "connecting", "idle", true],
    ["cancel", "connecting", "connecting", false],
    ["disconnect", "polling", "idle", true],
    ["disconnect", "polling", "timeout", false],
    ["dismiss", "disconnected", "idle", true],
    ["dismiss", "disconnected", "connecting", false],
    ["startPoll", "connected", "polling", true],
    ["startPoll", "paused", "timeout", true],
    ["startPoll", "timeout", "timeout", false],
    ["startPoll", "polling", "exception", false],
    ["startPoll", "timeout", "disconnected", true],
    ["stopPoll", "polling", "paused", true],
    ["stopPoll", "polling", "timeout", false],
  ] as const)("%s from %s to %s answers=%s", (pending, prev, next, expected) => {
    expect(answersPending(pending, prev, next)).toBe(expected);
  });
});

describe("command error field (REV-002 M1 plumbing)", () => {
  it("keeps the AppError field next to the message and clears both", async () => {
    ipc.failNext("connect", new IpcError("Port must be 1-65535", "validation", "port"));
    await get().connect(config);
    expect(get()).toMatchObject({
      commandError: "Port must be 1-65535",
      commandErrorField: "port",
      pending: null,
    });
    get().clearCommandError();
    expect(get()).toMatchObject({ commandError: null, commandErrorField: null });
  });
});

describe("REV-003 m-1: rollback after overlapping Apply commands", () => {
  const d1 = { ...def, quantity: 20 };
  const d2 = { ...def, quantity: 30 };

  beforeEach(async () => {
    await reach("polling");
    await get().startPoll(def);
    ipc.emitState("polling");
  });

  it("an older Apply rejected while a newer one is accepted keeps the newer definition", async () => {
    const heldFirst = ipc.hold("startPoll");
    const first = get().startPoll(d1);
    await get().startPoll(d2);
    heldFirst.fail("rejected by the backend");
    await first;
    expect(get().commandError).toBe("rejected by the backend");
    expect(get().pollDefinition).toEqual(d2);
  });

  it("an older Apply rejected while the newer one is still in flight does not undo it", async () => {
    const heldFirst = ipc.hold("startPoll");
    const first = get().startPoll(d1);
    const heldSecond = ipc.hold("startPoll");
    const second = get().startPoll(d2);
    heldFirst.fail("first rejected");
    await first;
    // The newer command has not returned yet: it is still what the session is switching to.
    expect(get().pollDefinition).toEqual(d2);
    expect(get().pending).toBe("startPoll");
    heldSecond.release();
    await second;
    expect(get().pollDefinition).toEqual(d2);
  });

  it("when both are rejected the definition goes back to the last accepted one, not to D1", async () => {
    const heldFirst = ipc.hold("startPoll");
    const first = get().startPoll(d1);
    ipc.failNext("startPoll", "second rejected");
    await get().startPoll(d2);
    // The newest failed: back to what the backend accepted before (def), not the unrun D1.
    expect(get().pollDefinition).toEqual(def);
    heldFirst.fail("first rejected");
    await first;
    expect(get().pollDefinition).toEqual(def);
  });

  it("an older Apply accepted after a newer one does not become the accepted definition", async () => {
    const heldFirst = ipc.hold("startPoll");
    const first = get().startPoll(d1);
    await get().startPoll(d2);
    heldFirst.release();
    await first;
    // A later rejected Apply rolls back to d2, the newest accepted command.
    ipc.failNext("startPoll", "third rejected");
    await get().startPoll({ ...def, quantity: 40 });
    expect(get().pollDefinition).toEqual(d2);
  });

  it("a rejected connect after an accepted one goes back to the accepted connection", async () => {
    ipc.emitState("disconnected", { reason: sessionReason("closedByPeer", "x") });
    await get().connect(config);
    ipc.emitState("connecting");
    ipc.emitState("disconnected", { reason: sessionReason("refused", "x") });
    ipc.failNext("connect", "nope");
    await get().connect({ ...config, host: "10.9.9.9" });
    expect(get().connection).toEqual(config);
  });
});
