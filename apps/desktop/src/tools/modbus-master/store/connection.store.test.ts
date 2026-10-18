import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  sessionReason,
} from "@/shared/ipc/modbus-master.fake";
import type { ConnectionConfig, ConnectionState } from "@/shared/ipc/modbus-master.types";
import { type ConnectionStoreApi, createConnectionStore } from "./connection.store";

const tcp: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const other: ConnectionConfig = { ...tcp, host: "10.0.0.2" };

let ipc: FakeModbusMasterIpc;
let warnings: string[];
let store: ConnectionStoreApi;

function make(role?: "window" | "poll", ready = true) {
  ipc = createFakeModbusMasterIpc();
  warnings = [];
  store = createConnectionStore({
    ipc,
    ...(role ? { role } : {}),
    warn: (m) => warnings.push(m),
  });
  if (ready) {
    store.getState().applySnapshot({
      connection: { state: "idle", reason: null, config: null, at: 0 },
    });
  }
}

let clock = 0;
const event = (
  state: ConnectionState,
  reason = state === "disconnected" ? sessionReason("refused") : null,
) => {
  clock += 1;
  return { state, reason, at: clock };
};

/** Applies a backend transition path from the current state. */
function go(...states: ConnectionState[]) {
  for (const s of states) store.getState().applyConnectionStateChanged(event(s));
}

beforeEach(() => {
  clock = 0;
  make();
});

describe("initial state", () => {
  it("is idle, not ready, nothing pending", () => {
    make("window", false);
    expect(store.getState()).toMatchObject({
      state: "idle",
      reason: null,
      since: 0,
      pending: null,
      pendingResolved: false,
      commandError: null,
      commandErrorField: null,
      connection: null,
      autoStartPoll: true,
      ready: false,
      revision: 0,
      lastUnexpected: null,
    });
  });
});

describe("applySnapshot", () => {
  it("takes the state, config and auto start and marks the store ready", () => {
    make("window", false);
    const reason = sessionReason("refused");
    store.getState().applySnapshot({
      connection: { state: "disconnected", reason, config: tcp, at: 42 },
      autoStartPoll: false,
    });
    expect(store.getState()).toMatchObject({
      state: "disconnected",
      reason,
      since: 42,
      connection: tcp,
      autoStartPoll: false,
      ready: true,
    });
  });

  it("keeps the reason only in disconnected and keeps autoStartPoll when it is not given", () => {
    make("window", false);
    store.getState().applySnapshot({
      connection: { state: "connected", reason: sessionReason("refused"), config: tcp, at: 1 },
    });
    expect(store.getState()).toMatchObject({
      state: "connected",
      reason: null,
      autoStartPoll: true,
    });
  });
});

describe("transitions C1-C7", () => {
  it("C1: connect sets pending until the connecting event answers it", async () => {
    await store.getState().connect(tcp);
    expect(ipc.callsOf("connect")).toEqual([[tcp]]);
    expect(store.getState()).toMatchObject({
      pending: "connect",
      pendingResolved: true,
      connection: tcp,
    });
    go("connecting");
    expect(store.getState()).toMatchObject({
      state: "connecting",
      pending: null,
      pendingResolved: false,
    });
  });

  it("C2: connecting -> connected", () => {
    go("connecting", "connected");
    expect(store.getState()).toMatchObject({
      state: "connected",
      reason: null,
      lastUnexpected: null,
    });
  });

  it("C3: connecting -> disconnected keeps the reason (phase connectFailed)", () => {
    go("connecting");
    const reason = sessionReason("refused", "refused", "connectFailed");
    store.getState().applyConnectionStateChanged({ state: "disconnected", reason, at: 99 });
    expect(store.getState()).toMatchObject({ state: "disconnected", reason, since: 99 });
  });

  it("C4: cancel connecting -> idle", async () => {
    go("connecting");
    await store.getState().cancelConnect();
    expect(ipc.callsOf("cancelConnect")).toHaveLength(1);
    expect(store.getState().pending).toBe("cancel");
    go("idle");
    expect(store.getState()).toMatchObject({ state: "idle", pending: null });
  });

  it("C5: disconnect connected -> idle", async () => {
    go("connecting", "connected");
    await store.getState().disconnect();
    expect(ipc.callsOf("disconnect")).toHaveLength(1);
    expect(store.getState().pending).toBe("disconnect");
    go("idle");
    expect(store.getState()).toMatchObject({ state: "idle", pending: null });
  });

  it("C6: link lost connected -> disconnected with phase linkLost", () => {
    go("connecting", "connected");
    const reason = sessionReason("closedByPeer", "closed", "linkLost");
    store.getState().applyConnectionStateChanged({ state: "disconnected", reason, at: 50 });
    expect(store.getState()).toMatchObject({ state: "disconnected", reason });
    expect(store.getState().lastUnexpected).toBeNull();
  });

  it("C7: dismiss goes through disconnect and the state changes only on the idle event", async () => {
    go("connecting", "disconnected");
    await store.getState().dismiss();
    expect(ipc.callsOf("disconnect")).toHaveLength(1);
    expect(store.getState()).toMatchObject({ state: "disconnected", pending: "dismiss" });
    go("idle");
    expect(store.getState()).toMatchObject({ state: "idle", pending: null, reason: null });
  });

  it("disconnected -> connecting is a reconnect (C1)", () => {
    go("connecting", "disconnected", "connecting");
    expect(store.getState()).toMatchObject({
      state: "connecting",
      reason: null,
      lastUnexpected: null,
    });
  });

  it("an unexpected pair is applied and recorded, with a warning", () => {
    go("connected");
    expect(store.getState()).toMatchObject({
      state: "connected",
      lastUnexpected: { from: "idle", to: "connected" },
    });
    expect(warnings).toEqual(["Unexpected connection transition idle -> connected"]);
  });

  it("counts every applied transition in revision", () => {
    go("connecting", "connected", "idle");
    expect(store.getState().revision).toBe(3);
  });
});

describe("the same event from two channels", () => {
  it("applying the session event and the view event leaves one transition", () => {
    const evt = { state: "connected" as const, reason: null, at: 7 };
    go("connecting");
    const before = store.getState().revision;
    expect(store.getState().applyConnectionStateChanged(evt)).toBe(true);
    expect(store.getState().applyConnectionStateChanged(evt)).toBe(false);
    expect(store.getState().revision).toBe(before + 1);
    expect(warnings).toEqual([]);
  });

  it("a later event of the same state is a new transition (a retry after a failed connect)", () => {
    go("connecting");
    expect(
      store.getState().applyConnectionStateChanged({ state: "connecting", reason: null, at: 500 }),
    ).toBe(true);
  });
});

describe("commands in the wrong state or before the snapshot do nothing", () => {
  it("ignores every command before the snapshot", async () => {
    make("window", false);
    await store.getState().connect(tcp);
    await store.getState().cancelConnect();
    await store.getState().disconnect();
    await store.getState().dismiss();
    expect(ipc.calls).toHaveLength(0);
  });

  it.each([
    ["connect", "connected"],
    ["connect", "connecting"],
    ["cancelConnect", "idle"],
    ["cancelConnect", "connected"],
    ["disconnect", "idle"],
    ["disconnect", "disconnected"],
    ["dismiss", "idle"],
    ["dismiss", "connected"],
  ] as const)("%s in %s sends nothing", async (command, state) => {
    store.setState({ state });
    if (command === "connect") await store.getState().connect(tcp);
    else await store.getState()[command]();
    expect(ipc.calls).toHaveLength(0);
    expect(store.getState().pending).toBeNull();
  });

  it("a second connect while one is pending is ignored", async () => {
    const held = ipc.hold("connect");
    const first = store.getState().connect(tcp);
    await store.getState().connect(other);
    held.release();
    await first;
    expect(ipc.callsOf("connect")).toEqual([[tcp]]);
  });

  it("a second disconnect while one is pending is ignored", async () => {
    go("connecting", "connected");
    await store.getState().disconnect();
    await store.getState().disconnect();
    expect(ipc.callsOf("disconnect")).toHaveLength(1);
  });
});

describe("command errors", () => {
  it("a rejected connect clears pending, keeps the error and field, and rolls the config back", async () => {
    await store.getState().connect(tcp);
    go("connecting", "connected", "idle");
    ipc.failNext(
      "connect",
      new IpcError("Timeout must be at least 50.", "validation", "timeoutMs"),
    );
    await store.getState().connect(other);
    expect(store.getState()).toMatchObject({
      pending: null,
      commandError: "Timeout must be at least 50.",
      commandErrorField: "timeoutMs",
      connection: tcp,
    });
    store.getState().clearCommandError();
    expect(store.getState()).toMatchObject({ commandError: null, commandErrorField: null });
  });

  it("a plain string rejection becomes the message", async () => {
    ipc.failNext("connect", "boom");
    await store.getState().connect(tcp);
    expect(store.getState()).toMatchObject({ commandError: "boom", commandErrorField: null });
  });

  it("a rejected disconnect clears pending", async () => {
    go("connecting", "connected");
    ipc.failNext("disconnect", "no");
    await store.getState().disconnect();
    expect(store.getState()).toMatchObject({
      pending: null,
      commandError: "no",
      state: "connected",
    });
  });

  it("a new command clears the previous error", async () => {
    ipc.failNext("connect", "first");
    await store.getState().connect(tcp);
    expect(store.getState().commandError).toBe("first");
    await store.getState().connect(tcp);
    expect(store.getState().commandError).toBeNull();
  });
});

describe("pending is cleared by the answering event, or by the next one once the command returned", () => {
  it("a command that returned is cleared by any later event", async () => {
    go("connecting", "connected");
    await store.getState().disconnect(); // resolved, waiting for idle
    expect(store.getState()).toMatchObject({ pending: "disconnect", pendingResolved: true });
    // an event that does not answer it, but arrives after the command returned
    go("disconnected");
    expect(store.getState().pending).toBeNull();
  });

  it("an event that does not answer a command still in flight leaves it pending", async () => {
    go("connecting", "connected");
    const held = ipc.hold("disconnect");
    const pending = store.getState().disconnect();
    store.getState().applyConnectionStateChanged({ state: "connected", reason: null, at: 999 });
    expect(store.getState().pending).toBe("disconnect");
    held.release();
    await pending;
  });
});

describe("reconnect", () => {
  it("connects again with the last accepted config", async () => {
    await store.getState().connect(tcp);
    go("connecting", "disconnected");
    await store.getState().reconnect();
    expect(ipc.callsOf("connect")).toEqual([[tcp], [tcp]]);
  });

  it("does nothing without a config", async () => {
    await store.getState().reconnect();
    expect(ipc.calls).toHaveLength(0);
  });

  it("uses the config of the snapshot after a reload", async () => {
    store.getState().applySnapshot({
      connection: {
        state: "disconnected",
        reason: sessionReason("closedByPeer"),
        config: other,
        at: 3,
      },
    });
    await store.getState().reconnect();
    expect(ipc.callsOf("connect")).toEqual([[other]]);
  });
});

describe("role poll (native poll window)", () => {
  beforeEach(() => make("poll"));

  it("can connect and reconnect when the link is down", async () => {
    await store.getState().connect(tcp);
    go("connecting", "disconnected");
    await store.getState().reconnect();
    expect(ipc.callsOf("connect")).toHaveLength(2);
  });

  it("never cancels, disconnects or dismisses", async () => {
    go("connecting");
    await store.getState().cancelConnect();
    go("connected");
    await store.getState().disconnect();
    go("disconnected");
    await store.getState().dismiss();
    expect(ipc.calls).toHaveLength(0);
  });
});

describe("setAutoStartPoll", () => {
  it("applies at once and sends the command", async () => {
    await store.getState().setAutoStartPoll(false);
    expect(store.getState().autoStartPoll).toBe(false);
    expect(ipc.callsOf("setAutoStartPoll")).toEqual([[false]]);
  });

  it("rolls back on a rejection and records the error", async () => {
    ipc.failNext("setAutoStartPoll", "no");
    await store.getState().setAutoStartPoll(false);
    expect(store.getState()).toMatchObject({ autoStartPoll: true, commandError: "no" });
  });
});
