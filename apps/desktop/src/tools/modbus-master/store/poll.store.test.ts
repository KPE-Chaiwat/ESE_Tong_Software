import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type {
  PollHostKind,
  PollId,
  PollState,
  PollStateChangedEvent,
  PollViewEvent,
  PollViewSnapshot,
} from "@/shared/ipc/modbus-master.types";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { createPollStore } from "./poll.store";

let ipc: FakeModbusMasterIpc;
let toasts: ToastStoreApi;
let warnings: string[];

function makeStore(pollId: PollId, host: PollHostKind = "workspace", others: string[] = []) {
  const forwarded: PollViewEvent[] = [];
  const snapshots: PollViewSnapshot[] = [];
  const order: string[] = [];
  const store = createPollStore({
    ipc,
    pollId,
    host,
    toasts,
    getOtherNames: () => others,
    warn: (m) => warnings.push(m),
    onEvent: (e) => {
      forwarded.push(e);
      order.push(`event:${e.type}`);
    },
    onSnapshot: (s) => {
      snapshots.push(s);
      order.push("snapshot");
    },
  });
  return { store, forwarded, snapshots, order };
}

const stateEvt = (
  pollId: PollId,
  state: PollState,
  patch: Partial<PollStateChangedEvent> = {},
): PollStateChangedEvent => ({
  type: "PollStateChanged",
  pollId,
  state,
  consecutiveFailures: 0,
  exceptionCode: null,
  badResponseKind: null,
  badResponseDetail: null,
  at: 100,
  ...patch,
});

async function setup() {
  ipc = createFakeModbusMasterIpc();
  toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  warnings = [];
  await ipc.openSession(() => {});
  const a = await ipc.addPoll(pollConfigInput({ name: "A" }), "workspace");
  const b = await ipc.addPoll(pollConfigInput({ name: "B" }), "workspace");
  ipc.calls.length = 0;
  return { a, b };
}

function snapshotOf(pollId: PollId, viewToken: number): PollViewSnapshot {
  return {
    viewToken,
    host: "workspace",
    poll: ipc.pollSummary(pollId),
    connection: { state: "idle", reason: null, config: null, at: 0 },
    profileName: null,
    compact: false,
    askOnPollClose: true,
    lastUpdate: null,
    handoff: null,
  };
}

const toastTexts = () => toasts.getState().items.map((t) => t.text);

describe("initial state", () => {
  it("is attaching with no config, offline, nothing pending", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    expect(store.getState()).toMatchObject({
      pollId: a,
      host: "workspace",
      viewToken: null,
      attach: "attaching",
      detachReason: null,
      attachError: null,
      config: null,
      state: "offline",
      consecutiveFailures: 0,
      exceptionCode: null,
      badResponse: null,
      lastOkAt: null,
      counters: { requests: 0, responses: 0, errors: 0, timeouts: 0 },
      effectiveScanMs: null,
      hasUnappliedEdits: false,
      profileName: null,
      pending: null,
      removed: false,
      commandError: null,
    });
  });
});

describe("init: attach and snapshot", () => {
  it("attaches with the poll id and the host and applies the snapshot", async () => {
    const { a } = await setup();
    ipc.emitConnectionState("connected");
    ipc.emitPollState(a, "exception", { exceptionCode: 2, consecutiveFailures: 4 });
    await ipc.setProfileName("Boiler");
    const { store, snapshots } = makeStore(a);
    await store.getState().init();
    expect(ipc.callsOf("attachPollView").map(([id, host]) => [id, host])).toEqual([
      [a, "workspace"],
    ]);
    const s = store.getState();
    expect(s).toMatchObject({
      attach: "attached",
      state: "exception",
      exceptionCode: 2,
      consecutiveFailures: 4,
      profileName: "Boiler",
    });
    expect(s.viewToken).toBe(snapshots[0]?.viewToken);
    expect(s.config?.name).toBe("A");
    expect(s.config?.definition.quantity).toBe(10);
  });

  it("init twice attaches once", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await Promise.all([store.getState().init(), store.getState().init()]);
    await store.getState().init();
    expect(ipc.callsOf("attachPollView")).toHaveLength(1);
  });

  it("events that arrive before the snapshot are applied after it, in order", async () => {
    const { a } = await setup();
    const { store, order } = makeStore(a);
    const held = ipc.hold("attachPollView");
    const starting = store.getState().init();
    ipc.emitPollState(a, "paused");
    ipc.emitPollUpdate(a, { values: [1, 2, 3] });
    ipc.emitPollState(a, "polling");
    expect(store.getState().attach).toBe("attaching");
    expect(store.getState().state).toBe("offline");
    held.release(snapshotOf(a, 3));
    await starting;
    expect(store.getState()).toMatchObject({ attach: "attached", state: "polling", viewToken: 3 });
    expect(order).toEqual(["snapshot", "event:PollUpdate"]);
  });

  it("a held attach reply applies the snapshot before the held events", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    // The channel of this store is live at once; the snapshot says paused, a later event says polling.
    const held = ipc.hold("attachPollView");
    const starting = store.getState().init();
    ipc.emitPollState(a, "polling");
    const snapshot = ipc.pollSummary(a);
    held.release({
      viewToken: 9,
      host: "workspace",
      poll: { ...snapshot, status: { ...snapshot.status, state: "paused" } },
      connection: { state: "connected", reason: null, config: null, at: 1 },
      profileName: null,
      compact: false,
      askOnPollClose: true,
      lastUpdate: null,
      handoff: null,
    } satisfies PollViewSnapshot);
    await starting;
    // snapshot (paused) first, then the held event (polling)
    expect(store.getState()).toMatchObject({ state: "polling", viewToken: 9 });
  });

  it("a rejected attach leaves the store detached with the message and a toast", async () => {
    const { a } = await setup();
    const { store } = makeStore(a, "native");
    await store.getState().init();
    expect(store.getState()).toMatchObject({
      attach: "detached",
      attachError: expect.stringContaining("not in native"),
    });
    expect(toastTexts()).toHaveLength(1);
  });

  it("an unknown poll is a rejected attach", async () => {
    await setup();
    const { store } = makeStore(99);
    await store.getState().init();
    expect(store.getState()).toMatchObject({
      attach: "detached",
      attachError: "Poll 99 was not found.",
    });
  });
});

describe("two views", () => {
  it("two stores for two polls change independently", async () => {
    const { a, b } = await setup();
    const one = makeStore(a);
    const two = makeStore(b);
    await one.store.getState().init();
    await two.store.getState().init();
    ipc.emitConnectionState("connected");
    ipc.emitPollState(a, "polling");
    ipc.emitPollState(b, "timeout", { consecutiveFailures: 2 });
    expect(one.store.getState()).toMatchObject({ state: "polling", consecutiveFailures: 0 });
    expect(two.store.getState()).toMatchObject({ state: "timeout", consecutiveFailures: 2 });
    expect(one.forwarded.map((e) => e.type)).toEqual(["ConnectionStateChanged"]);
  });

  it("ignores events of another poll", async () => {
    const { a, b } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    store.getState().applyPollStateChanged(stateEvt(b, "timeout"));
    store.getState().applyPollConfigChanged({ ...ipc.pollSummary(b).config });
    store.getState().applyCounters({
      type: "PollCounters",
      pollId: b,
      counters: { requests: 9, responses: 9, errors: 0, timeouts: 0 },
      effectiveScanMs: null,
      lastOkAt: null,
    });
    expect(store.getState()).toMatchObject({ state: "offline" });
    expect(store.getState().config?.name).toBe("A");
    expect(store.getState().counters.requests).toBe(0);
  });
});

describe("detach and dispose", () => {
  it("dispose detaches with the view's own token", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    const token = store.getState().viewToken;
    store.getState().dispose();
    expect(ipc.callsOf("detachPollView")).toEqual([[a, token]]);
    expect(store.getState().attach).toBe("detached");
  });

  it("ViewDetached stops applying events, and dispose does not detach with a foreign token", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    // another view replaces this one
    await ipc.attachPollView(a, "workspace", () => {});
    expect(store.getState()).toMatchObject({ attach: "detached", detachReason: "replaced" });
    store.getState().applyPollStateChanged(stateEvt(a, "paused"));
    ipc.emitPollState(a, "polling");
    expect(store.getState().state).not.toBe("polling");
    store.getState().dispose();
    expect(ipc.callsOf("detachPollView")).toHaveLength(0);
  });

  it.each(["poppedOut", "docked", "closed"] as const)(
    "ViewDetached %s is recorded",
    async (reason) => {
      const { a } = await setup();
      const { store } = makeStore(a);
      await store.getState().init();
      store.getState().applyViewDetached(reason);
      expect(store.getState()).toMatchObject({ attach: "detached", detachReason: reason });
    },
  );

  it("a pop out detaches the sub-window view", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    await ipc.popOutPoll(a, { kind: "rect", rect: { x: 0, y: 0, width: 800, height: 600 } }, null);
    expect(store.getState()).toMatchObject({ attach: "detached", detachReason: "poppedOut" });
  });

  it("dispose while attaching detaches as soon as the snapshot arrives", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    const held = ipc.hold("attachPollView");
    const starting = store.getState().init();
    store.getState().dispose();
    expect(ipc.callsOf("detachPollView")).toHaveLength(0);
    held.release({
      viewToken: 5,
      host: "workspace",
      poll: ipc.pollSummary(a),
      connection: { state: "idle", reason: null, config: null, at: 0 },
      profileName: null,
      compact: false,
      askOnPollClose: true,
      lastUpdate: null,
      handoff: null,
    } satisfies PollViewSnapshot);
    await starting;
    expect(ipc.callsOf("detachPollView")).toEqual([[a, 5]]);
    expect(store.getState().attach).toBe("detached");
    expect(store.getState().config).toBeNull();
  });

  it("a detach that is rejected does not throw", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    ipc.failNext("detachPollView", "gone");
    expect(() => store.getState().dispose()).not.toThrow();
    await Promise.resolve();
  });
});

describe("poll state transitions (PT1-PT5, PT7)", () => {
  async function started() {
    const { a } = await setup();
    const ctx = makeStore(a);
    await ctx.store.getState().init();
    return { a, ...ctx };
  }

  it("PT1: offline -> paused, PT2: paused -> polling", async () => {
    const { a, store } = await started();
    store.getState().applyPollStateChanged(stateEvt(a, "paused"));
    expect(store.getState().state).toBe("paused");
    store.getState().applyPollStateChanged(stateEvt(a, "polling"));
    expect(store.getState()).toMatchObject({ state: "polling", lastUnexpected: null });
    expect(warnings).toEqual([]);
  });

  it("PT3, PT4: resume and pause", async () => {
    const { a, store } = await started();
    for (const s of ["paused", "polling", "paused", "polling"] as const) {
      store.getState().applyPollStateChanged(stateEvt(a, s));
    }
    expect(store.getState().state).toBe("polling");
    expect(warnings).toEqual([]);
  });

  it("PT5: three timeouts in a row count 3, an exception resets the count to 1", async () => {
    const { a, store } = await started();
    store.getState().applyPollStateChanged(stateEvt(a, "paused"));
    store.getState().applyPollStateChanged(stateEvt(a, "polling"));
    for (let i = 0; i < 3; i += 1) store.getState().applyPollStateChanged(stateEvt(a, "timeout"));
    expect(store.getState().consecutiveFailures).toBe(3);
    store.getState().applyPollStateChanged(stateEvt(a, "exception", { exceptionCode: 2 }));
    expect(store.getState()).toMatchObject({ consecutiveFailures: 1, exceptionCode: 2 });
    store.getState().applyPollStateChanged(stateEvt(a, "polling"));
    expect(store.getState()).toMatchObject({ consecutiveFailures: 0, exceptionCode: null });
  });

  it("keeps the kind and detail of a bad response", async () => {
    const { a, store } = await started();
    store.getState().applyPollStateChanged(stateEvt(a, "polling"));
    const detail = { expected: 29, got: 20, message: "short" };
    store
      .getState()
      .applyPollStateChanged(
        stateEvt(a, "badResponse", { badResponseKind: "shortFrame", badResponseDetail: detail }),
      );
    expect(store.getState().badResponse).toEqual({ kind: "shortFrame", detail });
  });

  it("PT7: any state -> offline keeps the poll and clears the failure fields", async () => {
    const { a, store } = await started();
    store.getState().applyPollStateChanged(stateEvt(a, "polling"));
    store.getState().applyPollStateChanged(stateEvt(a, "timeout"));
    store.getState().applyPollStateChanged(stateEvt(a, "offline"));
    expect(store.getState()).toMatchObject({ state: "offline", consecutiveFailures: 0 });
    expect(store.getState().config?.name).toBe("A");
  });

  it("an unexpected pair (offline -> timeout) is applied and recorded with a warning", async () => {
    const { a, store } = await started();
    store.getState().applyPollStateChanged(stateEvt(a, "timeout"));
    expect(store.getState().state).toBe("timeout");
    expect(store.getState().lastUnexpected).toEqual({ from: "offline", to: "timeout" });
    expect(warnings).toEqual(["Unexpected poll transition offline -> timeout"]);
  });

  it("events through the channel reach the store", async () => {
    const { a, store } = await started();
    ipc.emitPollState(a, "paused");
    ipc.emitPollState(a, "polling");
    expect(store.getState().state).toBe("polling");
  });
});

describe("config, counters, removal, profile name", () => {
  it("a rename from elsewhere replaces the config", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    await ipc.renamePoll(a, "Tank 1");
    expect(store.getState().config?.name).toBe("Tank 1");
  });

  it("per-poll counters and the effective scan rate (shown only above 1.5 x the scan rate)", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init(); // scan rate 1000 ms
    const counters = { requests: 12, responses: 10, errors: 1, timeouts: 1 };
    store.getState().applyCounters({
      type: "PollCounters",
      pollId: a,
      counters,
      effectiveScanMs: 1400,
      lastOkAt: null,
    });
    expect(store.getState()).toMatchObject({ counters, effectiveScanMs: null, lastOkAt: null });
    store.getState().applyCounters({
      type: "PollCounters",
      pollId: a,
      counters,
      effectiveScanMs: 1600,
      lastOkAt: null,
    });
    expect(store.getState().effectiveScanMs).toBe(1600);
    store.getState().applyCounters({
      type: "PollCounters",
      pollId: a,
      counters,
      effectiveScanMs: null,
      lastOkAt: null,
    });
    expect(store.getState().effectiveScanMs).toBeNull();
  });

  it("counters arrive through the channel", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    await ipc.resetCounters(a);
    expect(store.getState().counters).toEqual({
      requests: 0,
      responses: 0,
      errors: 0,
      timeouts: 0,
    });
  });

  it("PollRemoved marks the poll removed", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    await ipc.removePoll(a);
    expect(store.getState().removed).toBe(true);
  });

  it("ProfileNameChanged updates the profile name", async () => {
    const { a } = await setup();
    const { store } = makeStore(a);
    await store.getState().init();
    await ipc.setProfileName("Boiler");
    expect(store.getState().profileName).toBe("Boiler");
    store.getState().setProfileName(null);
    expect(store.getState().profileName).toBeNull();
  });

  it("a poll update moves lastOkAt and is forwarded; another poll's update is not", async () => {
    const { a, b } = await setup();
    const { store, forwarded } = makeStore(a);
    await store.getState().init();
    ipc.emitPollUpdate(a, { values: [1], at: 555 });
    expect(store.getState().lastOkAt).toBe(555);
    expect(forwarded.map((e) => e.type)).toEqual(["PollUpdate"]);
    store.getState().applyPollStateChanged(stateEvt(b, "paused"));
    ipc.emitView(a, {
      type: "PollUpdate",
      pollId: b,
      seq: 1,
      at: 1,
      slaveId: 1,
      function: 3,
      startAddress: 0,
      values: [],
      roundTripMs: 1,
    });
    expect(forwarded).toHaveLength(1);
  });

  it("forwards connection, prefs and handoff events", async () => {
    const { a } = await setup();
    const { store, forwarded } = makeStore(a);
    await store.getState().init();
    ipc.emitConnectionState("connecting");
    await ipc.setCompactMode(true);
    ipc.emitView(a, { type: "HandoffRequested", pollId: a });
    expect(forwarded.map((e) => e.type)).toEqual([
      "ConnectionStateChanged",
      "PrefsChanged",
      "HandoffRequested",
    ]);
  });
});

describe("commands", () => {
  async function started() {
    const { a } = await setup();
    const ctx = makeStore(a, "workspace", ["B"]);
    await ctx.store.getState().init();
    ipc.calls.length = 0;
    return { a, ...ctx };
  }

  it("apply sends updatePoll with a pending flag", async () => {
    const { a, store } = await started();
    const def = {
      slaveId: 2,
      function: 4 as const,
      startAddress: 5,
      quantity: 20,
      scanRateMs: 200,
    };
    const held = ipc.hold("updatePoll");
    const pending = store.getState().apply(def);
    expect(store.getState().pending).toBe("apply");
    held.release();
    expect(await pending).toBe(true);
    expect(store.getState().pending).toBeNull();
    expect(ipc.callsOf("updatePoll")).toEqual([[a, def]]);
  });

  it("a rejected apply keeps the error, the field and a toast", async () => {
    const { store } = await started();
    ipc.failNext("updatePoll", new IpcError("Quantity too big.", "validation", "quantity"));
    expect(
      await store
        .getState()
        .apply({ slaveId: 1, function: 3, startAddress: 0, quantity: 999, scanRateMs: 100 }),
    ).toBe(false);
    expect(store.getState()).toMatchObject({
      pending: null,
      commandError: "Quantity too big.",
      commandErrorField: "quantity",
    });
    expect(toastTexts()).toEqual(["Quantity too big."]);
    store.getState().clearCommandError();
    expect(store.getState().commandError).toBeNull();
  });

  it("setActive sends setPollActive", async () => {
    const { a, store } = await started();
    await store.getState().setActive(false);
    await store.getState().setActive(true);
    expect(ipc.callsOf("setPollActive")).toEqual([
      [a, false],
      [a, true],
    ]);
    expect(store.getState().pending).toBeNull();
  });

  it("setActive failure is a toast", async () => {
    const { store } = await started();
    ipc.failNext("setPollActive", "denied");
    await store.getState().setActive(false);
    expect(toastTexts()).toEqual(["denied"]);
    expect(store.getState().pending).toBeNull();
  });

  describe("rename", () => {
    it.each([
      ["", "Enter a poll name."],
      [" x", "Poll name cannot start or end with a space."],
      ["b", 'A poll named "b" already exists on this connection.'],
    ])("%j gives %j and sends nothing", async (name, message) => {
      const { store } = await started();
      expect(await store.getState().rename(name)).toBe(message);
      expect(ipc.callsOf("renamePoll")).toHaveLength(0);
    });

    it("a valid name is sent; the same name is not", async () => {
      const { a, store } = await started();
      expect(await store.getState().rename("A")).toBeNull();
      expect(ipc.callsOf("renamePoll")).toHaveLength(0);
      expect(await store.getState().rename("Tank")).toBeNull();
      expect(ipc.callsOf("renamePoll")).toEqual([[a, "Tank"]]);
    });

    it("a backend message about the name is returned, other errors are toasts", async () => {
      const { store } = await started();
      ipc.failNext("renamePoll", new IpcError("taken", "duplicatePollName", "name"));
      expect(await store.getState().rename("Tank")).toBe("taken");
      ipc.failNext("renamePoll", new IpcError("gone", "pollNotFound"));
      expect(await store.getState().rename("Tank2")).toBeNull();
      expect(toastTexts()).toEqual(["gone"]);
    });
  });

  describe("setView", () => {
    it("applies at once and sends only the changed keys in one command (a patch)", async () => {
      const { a, store } = await started();
      const held = ipc.hold("setPollView");
      const pending = store.getState().setView({ valueColumns: "both" });
      expect(store.getState().config?.valueColumns).toBe("both");
      held.release();
      expect(await pending).toBe(true);
      expect(ipc.callsOf("setPollView")).toEqual([[a, { valueColumns: "both" }]]);
    });

    it("sends aliases without touching the other fields", async () => {
      const { store } = await started();
      await store.getState().setView({ aliases: [{ address: 0, alias: "Tank top" }] });
      expect(store.getState().config?.aliases).toEqual([{ address: 0, alias: "Tank top" }]);
      await store.getState().setView({
        display: { addressBase: 1, showAlias: false, copyAlias: true },
      });
      expect(ipc.callsOf("setPollView").at(-1)?.[1]).toEqual({
        display: { addressBase: 1, showAlias: false, copyAlias: true },
      });
      // the optimistic config kept the aliases
      expect(store.getState().config?.aliases).toEqual([{ address: 0, alias: "Tank top" }]);
    });

    describe("formatOverrides", () => {
      const f32 = {
        start: 2,
        end: 5,
        format: "float32" as const,
        swapBytes: false,
        reverseWords: false,
      };

      it("is applied only after Rust acknowledged it, and sent alone", async () => {
        const { a, store } = await started();
        const held = ipc.hold("setPollView");
        const pending = store.getState().setView({ formatOverrides: [f32] });
        expect(store.getState().config?.formatOverrides).toEqual([]);
        held.release();
        expect(await pending).toBe(true);
        expect(store.getState().config?.formatOverrides).toEqual([f32]);
        expect(ipc.callsOf("setPollView")).toEqual([[a, { formatOverrides: [f32] }]]);
      });

      it("keeps the old list and the error when Rust rejects it", async () => {
        const { store } = await started();
        await store.getState().setView({ formatOverrides: [f32] });
        ipc.failNext(
          "setPollView",
          new IpcError(
            "Format override 0-2: Float 32-bit needs a multiple of 2 registers.",
            "validation",
            "formatOverrides",
          ),
        );
        expect(await store.getState().setView({ formatOverrides: [] })).toBe(false);
        expect(store.getState().config?.formatOverrides).toEqual([f32]);
        expect(store.getState()).toMatchObject({
          commandError: "Format override 0-2: Float 32-bit needs a multiple of 2 registers.",
          commandErrorField: "formatOverrides",
        });
        // No toast: the Format dialog shows the message itself.
        expect(toastTexts()).toEqual([]);
      });

      it("a newer config from the backend wins over the acknowledged copy", async () => {
        const { a, store } = await started();
        const held = ipc.hold("setPollView");
        const pending = store.getState().setView({ formatOverrides: [f32] });
        await ipc.renamePoll(a, "Newer");
        held.release();
        await pending;
        expect(store.getState().config?.name).toBe("Newer");
      });
    });

    it("a scale can be removed (null) and set", async () => {
      const { store } = await started();
      const scale = {
        preset: "divide" as const,
        rawSigned: false,
        xMin: 0,
        xMax: 65535,
        yMin: 0,
        yMax: 1,
        divisor: 10,
        decimals: 1,
        unit: "C",
        outOfRange: "flag" as const,
      };
      await store.getState().setView({ scale });
      expect(store.getState().config?.scale).toEqual(scale);
      await store.getState().setView({ scale: null });
      expect(store.getState().config?.scale).toBeNull();
    });

    it("rolls back when rejected and tells the user", async () => {
      const { store } = await started();
      ipc.failNext("setPollView", new IpcError("bad aliases", "validation", "aliases"));
      expect(
        await store
          .getState()
          .setView({ aliases: [{ address: 0, alias: "x" }], hasUnappliedEdits: true }),
      ).toBe(false);
      expect(store.getState().config?.aliases).toEqual([]);
      expect(store.getState().hasUnappliedEdits).toBe(false);
      expect(store.getState()).toMatchObject({
        commandError: "bad aliases",
        commandErrorField: "aliases",
      });
      expect(toastTexts()).toEqual(["bad aliases"]);
    });

    it("does not roll back over a newer config from the backend", async () => {
      const { a, store } = await started();
      const held = ipc.hold("setPollView");
      const pending = store.getState().setView({ valueColumns: "scaled" });
      await ipc.renamePoll(a, "Newer");
      held.fail("late");
      await pending;
      expect(store.getState().config?.name).toBe("Newer");
    });

    it("does nothing before the snapshot", async () => {
      await setup();
      const { store } = makeStore(1);
      expect(await store.getState().setView({ valueColumns: "both" })).toBe(false);
      expect(ipc.callsOf("setPollView")).toHaveLength(0);
    });
  });

  describe("reportUnappliedEdits", () => {
    it("sends the flag through setPollView, once per change", async () => {
      const { store } = await started();
      await store.getState().reportUnappliedEdits(true);
      await store.getState().reportUnappliedEdits(true);
      expect(ipc.callsOf("setPollView")).toHaveLength(1);
      expect(store.getState().hasUnappliedEdits).toBe(true);
      await store.getState().reportUnappliedEdits(false);
      expect(ipc.callsOf("setPollView")).toHaveLength(2);
      expect(store.getState().hasUnappliedEdits).toBe(false);
    });

    it("the flag comes back from the backend snapshot of a new view", async () => {
      const { a, store } = await started();
      await store.getState().reportUnappliedEdits(true);
      store.getState().dispose();
      const second = makeStore(a);
      await second.store.getState().init();
      expect(second.store.getState().hasUnappliedEdits).toBe(true);
    });
  });

  it("markPending shows the pop out and dock spinner and clears it", async () => {
    const { store } = await started();
    store.getState().markPending("popOut");
    expect(store.getState().pending).toBe("popOut");
    store.getState().markPending(null);
    expect(store.getState().pending).toBeNull();
  });
});

describe("lastOkAt (REV-005 n-1)", () => {
  it("a null from Rust (after Apply, Disconnect or Dismiss) clears it", async () => {
    const ipc2 = createFakeModbusMasterIpc({ mode: "manual" });
    await ipc2.openSession(() => {});
    const id = await ipc2.addPoll(pollConfigInput({ name: "A" }), "workspace");
    const store2 = createPollStore({ ipc: ipc2, pollId: id, host: "workspace", warn: () => {} });
    await store2.getState().init();
    const counters = {
      type: "PollCounters" as const,
      pollId: id,
      counters: { requests: 1, responses: 1, errors: 0, timeouts: 0 },
      effectiveScanMs: null,
    };
    store2.getState().applyCounters({ ...counters, lastOkAt: 500 });
    expect(store2.getState().lastOkAt).toBe(500);
    store2.getState().applyCounters({ ...counters, lastOkAt: null });
    expect(store2.getState().lastOkAt).toBeNull();
  });
});
