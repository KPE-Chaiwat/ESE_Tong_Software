import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type { ConnectionConfig, PollHostKind, PollId } from "@/shared/ipc/modbus-master.types";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { presetDefaults } from "../lib/scale-presets";
import { noScaleFactory, type ScaledProviderFactory } from "../lib/scaled";
import { type ConnectionStoreApi, createConnectionStore } from "../store/connection.store";
import {
  createPollViewRuntime,
  type PollViewDetachCause,
  type PollViewRuntime,
} from "./poll-view-runtime";

const tcp: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

let ipc: FakeModbusMasterIpc;
let connection: ConnectionStoreApi;
let toasts: ToastStoreApi;
let copied: string[];
let detached: PollViewDetachCause[];
let runtimes: PollViewRuntime[];

async function setup(mode: "manual" | "virtual" = "virtual") {
  ipc = createFakeModbusMasterIpc({ mode });
  toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  copied = [];
  detached = [];
  runtimes = [];
  connection = createConnectionStore({ ipc, warn: () => {} });
  const snapshot = await ipc.openSession((e) => {
    if (e.type === "ConnectionStateChanged") connection.getState().applyConnectionStateChanged(e);
  });
  connection.getState().applySnapshot({ connection: snapshot.connection });
}

async function addPoll(
  name: string,
  patch: Parameters<typeof pollConfigInput>[0] & { active?: boolean } = {},
  host: PollHostKind = "workspace",
) {
  const { active, ...input } = patch;
  const id = await ipc.addPoll(pollConfigInput({ name, ...input }), host);
  // A new poll's run intent is "Start polling when connected"; a test that wants it paused pauses it.
  if (active === false) await ipc.setPollActive(id, false);
  return id;
}

function runtimeFor(
  pollId: PollId,
  host: PollHostKind = "workspace",
  extra: Partial<Parameters<typeof createPollViewRuntime>[0]> = {},
) {
  const rt = createPollViewRuntime({
    ipc,
    pollId,
    host,
    connection,
    toasts,
    getOtherNames: () => [],
    clipboard: {
      writeText: async (t) => {
        copied.push(t);
      },
      readText: async () => ["A", "B"].join(LF),
    },
    onDetached: (c) => detached.push(c),
    warn: () => {},
    ...extra,
  });
  runtimes.push(rt);
  return rt;
}

async function started(pollId: PollId, host: PollHostKind = "workspace", extra = {}) {
  const rt = runtimeFor(pollId, host, extra);
  await rt.init();
  return rt;
}

afterEach(() => {
  for (const rt of runtimes) rt.dispose();
});

const def = (patch = {}) => ({
  slaveId: 1,
  function: 3 as const,
  startAddress: 0,
  quantity: 10,
  scanRateMs: 100,
  ...patch,
});
const toastTexts = () => toasts.getState().items.map((t) => t.text);
const polls = (id: PollId) => ({ state: ipc.pollSummary(id).status.state });

describe("init and the data view", () => {
  it("attaches, applies the snapshot and shows loading until the first update, then live", async () => {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A", { definition: def() });
    const rt = await started(a);
    expect(rt.stores.poll.getState()).toMatchObject({ attach: "attached", state: "polling" });
    expect(rt.stores.data.getState()).toMatchObject({ status: "loading", values: null });
    ipc.advance(100);
    expect(rt.stores.data.getState()).toMatchObject({ status: "live" });
    expect(rt.stores.data.getState().values).toHaveLength(10);
  });

  it("init twice attaches once", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = runtimeFor(a);
    await Promise.all([rt.init(), rt.init()]);
    expect(ipc.callsOf("attachPollView")).toHaveLength(1);
  });

  it("a native window learns the connection from its attach snapshot", async () => {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A", {}, "native");
    const own = createConnectionStore({ ipc, role: "poll", warn: () => {} });
    expect(own.getState().ready).toBe(false);
    const rt = await started(a, "native", { connection: own });
    expect(own.getState()).toMatchObject({ ready: true, state: "connected", connection: tcp });
    expect(rt.stores.connection).toBe(own);
  });

  it("the shared W1 connection store is not overwritten by a view snapshot", async () => {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A");
    const before = connection.getState().revision;
    await started(a);
    expect(connection.getState().revision).toBe(before);
  });

  it("a paused poll with no values has an empty data view", async () => {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A", { active: false });
    const rt = await started(a);
    expect(rt.stores.poll.getState().state).toBe("paused");
    expect(rt.stores.data.getState()).toMatchObject({ status: "none", values: null });
  });

  it("an offline poll with no values has an empty data view", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a);
    expect(rt.stores.data.getState().status).toBe("none");
  });
});

describe("poll state -> data view", () => {
  async function running() {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A", { definition: def() });
    const rt = await started(a);
    ipc.advance(300);
    return { a, rt };
  }

  it("Pause keeps the values as stale, Resume drops them and shows loading, then live", async () => {
    const { a, rt } = await running();
    await ipc.setPollActive(a, false);
    expect(rt.stores.data.getState()).toMatchObject({ status: "stale" });
    expect(rt.stores.data.getState().values).not.toBeNull();
    await ipc.setPollActive(a, true);
    expect(rt.stores.data.getState()).toMatchObject({ status: "loading", values: null });
    ipc.advance(200);
    expect(rt.stores.data.getState().status).toBe("live");
  });

  it("a timeout keeps the last values as stale and the recovery makes them live again", async () => {
    const { a, rt } = await running();
    ipc.scriptFault(a, { kind: "timeout" });
    ipc.advance(3000);
    expect(rt.stores.poll.getState().state).toBe("timeout");
    expect(rt.stores.data.getState().status).toBe("stale");
    ipc.scriptFault(a, null);
    ipc.advance(3000);
    expect(rt.stores.poll.getState().state).toBe("polling");
    expect(rt.stores.data.getState().status).toBe("live");
  });

  it("an exception before any data leaves the view without values", async () => {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A");
    ipc.scriptFault(a, { kind: "exception", code: 2 });
    const rt = await started(a);
    ipc.advance(500);
    expect(rt.stores.poll.getState()).toMatchObject({ state: "exception", exceptionCode: 2 });
    expect(rt.stores.data.getState().values).toBeNull();
  });

  it("a lost link keeps the values as stale; Dismiss (idle) clears them", async () => {
    const { rt } = await running();
    ipc.dropLink();
    expect(rt.stores.poll.getState().state).toBe("offline");
    expect(rt.stores.data.getState().status).toBe("stale");
    await ipc.disconnect();
    expect(rt.stores.data.getState()).toMatchObject({ status: "none", values: null });
  });

  it("Disconnect clears the values too", async () => {
    const { rt } = await running();
    await ipc.disconnect();
    expect(rt.stores.data.getState().status).toBe("none");
  });

  it("PT6: Apply in P* restarts the poll: loading with the new definition, old updates dropped", async () => {
    const { a, rt } = await running();
    await ipc.updatePoll(a, def({ quantity: 20 }));
    expect(rt.stores.data.getState()).toMatchObject({ status: "loading", values: null });
    expect(rt.stores.data.getState().definition?.quantity).toBe(20);
    ipc.advance(100);
    expect(rt.stores.data.getState().values).toHaveLength(20);
  });

  it("PT6b: Apply in a paused poll clears the values with the settings-changed reason", async () => {
    const { a, rt } = await running();
    await ipc.setPollActive(a, false);
    await ipc.updatePoll(a, def({ startAddress: 5 }));
    expect(rt.stores.poll.getState().state).toBe("paused");
    expect(rt.stores.data.getState()).toMatchObject({
      status: "none",
      values: null,
      clearedBecause: "settingsChanged",
    });
  });

  it("two sub-windows in one connection window change independently", async () => {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A");
    const b = await addPoll("B");
    const one = await started(a);
    const two = await started(b);
    ipc.scriptFault(b, { kind: "timeout" });
    ipc.advance(3000);
    expect(one.stores.poll.getState().state).toBe("polling");
    expect(two.stores.poll.getState().state).toBe("timeout");
    expect(one.stores.data.getState().status).toBe("live");
    // the connection store is shared and saw each transition once
    expect(one.stores.connection).toBe(two.stores.connection);
  });

  it("one connection transition is counted once although every view receives it", async () => {
    await setup();
    const a = await addPoll("A");
    const b = await addPoll("B");
    await started(a);
    await started(b);
    const before = connection.getState().revision;
    await ipc.connect(tcp);
    // connecting + connected, each delivered on the session channel and on two views
    expect(connection.getState().revision - before).toBe(2);
    expect(connection.getState().state).toBe("connected");
  });
});

describe("a shared connection store (W1, REV-005 m-1)", () => {
  it("a view copy of a connection event that was held until the snapshot does not move the store back", async () => {
    await setup("manual");
    const a = await addPoll("A");
    const held = ipc.hold("attachPollView");
    const rt = runtimeFor(a, "workspace", { sharedConnection: true });
    const starting = rt.init();
    // The session channel applies connecting and connected while the view still waits.
    ipc.emitConnectionState("connecting");
    ipc.emitConnectionState("connected");
    expect(connection.getState().state).toBe("connected");
    const revision = connection.getState().revision;
    held.release({
      viewToken: 1,
      host: "workspace",
      connection: ipc.connection(),
      poll: ipc.pollSummary(a),
      lastUpdate: null,
      handoff: null,
      compact: false,
      askOnPollClose: true,
      profileName: null,
    });
    await starting;
    expect(connection.getState().state).toBe("connected");
    expect(connection.getState().revision).toBe(revision);
  });

  it("a native window still learns every transition from its own channel", async () => {
    await setup("manual");
    const a = await addPoll("A", {}, "native");
    const own = createConnectionStore({ ipc, role: "poll", warn: () => {} });
    await started(a, "native", { connection: own });
    ipc.emitConnectionState("connecting");
    expect(own.getState().state).toBe("connecting");
  });
});

describe("pop out and dock keep the view (DES-002 2.5.4)", () => {
  async function prepared() {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A", { definition: def() });
    const sw = await started(a, "workspace");
    ipc.advance(300);
    sw.stores.ui.getState().click(3);
    sw.stores.ui.getState().click(5, { shift: true });
    sw.stores.ui.getState().setTopAddress(2);
    sw.stores.ui.getState().setSetupOpen(true);
    sw.stores.ui.getState().patchPollDraft("quantity", "200");
    sw.stores.ui.getState().checkPollDraftField("quantity", {
      mode: "tcp",
      base: 0,
      others: [],
    });
    return { a, sw };
  }

  it("the native window shows the same selection, top row, draft and message, with live values at once", async () => {
    const { a, sw } = await prepared();
    const handoff = sw.stores.ui.getState().toHandoff();
    await ipc.popOutPoll(
      a,
      { kind: "rect", rect: { x: 10, y: 10, width: 640, height: 368 } },
      handoff,
    );
    expect(detached).toEqual(["poppedOut"]);
    const phases: string[] = [];
    const w2 = runtimeFor(a, "native");
    w2.stores.data.subscribe((s) => phases.push(s.status));
    await w2.init();
    const ui = w2.stores.ui.getState();
    expect(ui.selection).toEqual([{ start: 3, end: 5 }]);
    expect(ui.focusAddress).toBe(5);
    expect(ui.topAddress).toBe(2);
    expect(ui.setupOpen).toBe(true);
    expect(ui.pollDraft).toMatchObject({
      quantity: "200",
      errors: { quantity: "Quantity for FC03 must be from 1 to 125." },
    });
    // live values at once: never "loading"
    expect(phases).toEqual(["live"]);
    expect(w2.stores.data.getState().values).toHaveLength(10);
    expect(w2.stores.poll.getState().state).toBe("polling");
  });

  it("dock back gives the same in the sub-window", async () => {
    const { a, sw } = await prepared();
    await ipc.popOutPoll(
      a,
      { kind: "rect", rect: { x: 10, y: 10, width: 640, height: 368 } },
      sw.stores.ui.getState().toHandoff(),
    );
    const w2 = await started(a, "native");
    w2.stores.ui.getState().click(7);
    await ipc.dockPoll(a, w2.stores.ui.getState().toHandoff(), false, null);
    const back = await started(a, "workspace");
    expect(back.stores.ui.getState().selection).toEqual([{ start: 7, end: 7 }]);
    expect(back.stores.ui.getState().pollDraft?.quantity).toBe("200");
    expect(back.stores.data.getState().status).toBe("live");
  });

  it("an invalid or missing handoff is ignored without a message", async () => {
    await setup();
    const a = await addPoll("A", {}, "native");
    await ipc.dockPoll(a, "not json", false, null);
    const rt = await started(a, "workspace");
    expect(rt.stores.ui.getState().selection).toEqual([]);
    expect(toastTexts()).toEqual([]);
  });

  it("state, active and counters are untouched across pop out and dock", async () => {
    const { a, sw } = await prepared();
    const before = ipc.pollSummary(a);
    for (let i = 0; i < 3; i += 1) {
      await ipc.popOutPoll(
        a,
        { kind: "rect", rect: { x: 0, y: 0, width: 640, height: 368 } },
        null,
      );
      await ipc.dockPoll(a, null, false, null);
    }
    const after = ipc.pollSummary(a);
    expect(after.status.state).toBe(before.status.state);
    expect(after.config.active).toBe(before.config.active);
    expect(after.counters).toEqual(before.counters);
    expect(sw.stores.poll.getState().attach).toBe("detached");
  });
});

describe("detaching", () => {
  it("reports why the view has to go away", async () => {
    await setup();
    const a = await addPoll("A");
    const b = await addPoll("B");
    await started(a);
    await started(b);
    await ipc.popOutPoll(a, { kind: "rect", rect: { x: 0, y: 0, width: 640, height: 368 } }, null);
    await ipc.removePoll(b);
    expect(detached).toEqual(["poppedOut", "removed"]);
  });

  it("a Keep close reports closed; a replaced view reports replaced", async () => {
    await setup();
    const a = await addPoll("A");
    await started(a);
    await ipc.closePollView(a, true);
    expect(detached).toEqual(["closed"]);
    await ipc.showPoll(a, null);
    await started(a);
    await ipc.attachPollView(a, "workspace", () => {});
    expect(detached).toEqual(["closed", "replaced"]);
  });

  it("a rejected attach reports attachFailed", async () => {
    await setup();
    const a = await addPoll("A");
    await started(a, "native");
    expect(detached).toEqual(["attachFailed"]);
  });

  it("dispose detaches once with its own token and stops reacting", async () => {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A");
    const rt = await started(a);
    const token = rt.stores.poll.getState().viewToken;
    rt.dispose();
    expect(ipc.callsOf("detachPollView")).toEqual([[a, token]]);
    expect(detached).toEqual([]);
    ipc.advance(500);
    expect(rt.stores.data.getState().values).toBeNull();
  });

  it("forwards prefs and the handoff request to the host", async () => {
    await setup();
    const a = await addPoll("A", {}, "native");
    const prefs: boolean[] = [];
    let requested = 0;
    const rt = await started(a, "native", {
      onPrefsChanged: (e: { compact: boolean }) => prefs.push(e.compact),
      onHandoffRequested: () => {
        requested += 1;
      },
    });
    await ipc.setCompactMode(true);
    expect(rt.stores.ui.getState().compact).toBe(true);
    expect(prefs).toEqual([true]);
    ipc.emitView(a, { type: "HandoffRequested", pollId: a });
    expect(requested).toBe(1);
  });

  it("a view that starts in compact mode closes its setup", async () => {
    await setup();
    await ipc.setCompactMode(true);
    const a = await addPoll("A");
    const rt = await started(a);
    expect(rt.stores.ui.getState()).toMatchObject({ compact: true, setupOpen: false });
  });
});

describe("unapplied edits", () => {
  it("typing a draft tells Rust; clearing it tells Rust again; the flag survives a new view", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a);
    rt.stores.ui.getState().patchPollDraft("quantity", "20");
    await Promise.resolve();
    expect(ipc.pollSummary(a).hasUnappliedEdits).toBe(true);
    expect(rt.stores.poll.getState().hasUnappliedEdits).toBe(true);
    rt.stores.ui.getState().patchPollDraft("quantity", "10");
    await Promise.resolve();
    expect(ipc.pollSummary(a).hasUnappliedEdits).toBe(false);
  });

  it("an unapplied scale draft counts too", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a);
    rt.stores.ui.getState().setScaleDraft({ dirty: true, fields: {} });
    await Promise.resolve();
    expect(ipc.pollSummary(a).hasUnappliedEdits).toBe(true);
    rt.stores.ui.getState().setScaleDraft(null);
    await Promise.resolve();
    expect(ipc.pollSummary(a).hasUnappliedEdits).toBe(false);
  });

  it("a handoff with a draft does not send the flag again (it is unchanged)", async () => {
    await setup();
    const a = await addPoll("A");
    const first = await started(a);
    first.stores.ui.getState().patchPollDraft("quantity", "20");
    await Promise.resolve();
    const handoff = first.stores.ui.getState().toHandoff();
    await ipc.popOutPoll(
      a,
      { kind: "rect", rect: { x: 0, y: 0, width: 640, height: 368 } },
      handoff,
    );
    ipc.calls.length = 0;
    const second = await started(a, "native");
    expect(second.stores.ui.getState().pollDraft?.quantity).toBe("20");
    expect(ipc.callsOf("setPollView")).toHaveLength(0);
    expect(second.stores.poll.getState().hasUnappliedEdits).toBe(true);
  });

  it("a view that arrives without its handoff clears a flag that Rust still has (REV-005 m-2)", async () => {
    await setup();
    const a = await addPoll("A");
    const first = await started(a);
    first.stores.ui.getState().patchPollDraft("quantity", "20");
    await Promise.resolve();
    expect(ipc.pollSummary(a).hasUnappliedEdits).toBe(true);
    // A reload: the new view has no drafts and no handoff.
    first.dispose();
    const second = await started(a);
    await Promise.resolve();
    expect(second.stores.ui.getState().pollDraft).toBeNull();
    expect(ipc.pollSummary(a).hasUnappliedEdits).toBe(false);
    expect(second.stores.poll.getState().hasUnappliedEdits).toBe(false);
  });

  it("a rename from elsewhere keeps the draft", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a);
    rt.stores.ui.getState().patchPollDraft("quantity", "20");
    await ipc.renamePoll(a, "Tank 1");
    expect(rt.stores.ui.getState().pollDraft).toMatchObject({ name: "Tank 1", quantity: "20" });
  });

  it("a changed address base converts the draft's start address", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a);
    rt.stores.ui.getState().patchPollDraft("startAddress", "5");
    await rt.actions.setAddressBase(1);
    expect(rt.stores.ui.getState().pollDraft?.startAddress).toBe("6");
  });
});

describe("applySetup", () => {
  async function withDraft(patch: Record<string, string>) {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A", { definition: def() });
    await addPoll("B");
    const rt = await started(a, "workspace", { getOtherNames: () => ["B"] });
    for (const [field, text] of Object.entries(patch)) {
      rt.stores.ui.getState().patchPollDraft(field as "quantity", text);
    }
    ipc.calls.length = 0;
    return { a, rt };
  }

  it("without edits it sends nothing", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a);
    ipc.calls.length = 0;
    expect(await rt.actions.applySetup()).toEqual({ ok: true, applied: false, firstInvalid: null });
    expect(ipc.calls).toHaveLength(0);
  });

  it("an invalid draft sends nothing, shows every message and names the first invalid field", async () => {
    const { rt } = await withDraft({ quantity: "126", scanRateMs: "5", name: "b" });
    const result = await rt.actions.applySetup();
    expect(result).toEqual({ ok: false, applied: false, firstInvalid: "name" });
    expect(ipc.callsOf("updatePoll")).toHaveLength(0);
    expect(ipc.callsOf("renamePoll")).toHaveLength(0);
    expect(rt.stores.ui.getState().pollDraft?.errors).toEqual({
      name: 'A poll named "b" already exists on this connection.',
      quantity: "Quantity for FC03 must be from 1 to 125.",
      scanRateMs: "Scan rate must be a whole number from 20 to 60000 ms.",
    });
    expect(rt.stores.ui.getState().pollDraft?.quantity).toBe("126");
  });

  it("a valid definition is applied once and the draft ends", async () => {
    const { a, rt } = await withDraft({ quantity: "20" });
    const result = await rt.actions.applySetup();
    expect(result).toEqual({ ok: true, applied: true, firstInvalid: null });
    expect(ipc.callsOf("updatePoll")).toEqual([[a, def({ quantity: 20 })]]);
    expect(ipc.callsOf("renamePoll")).toHaveLength(0);
    expect(rt.stores.ui.getState().pollDraft).toBeNull();
    expect(rt.stores.poll.getState().config?.definition.quantity).toBe(20);
  });

  it("a changed name is sent as a rename, a changed definition as an update", async () => {
    const { a, rt } = await withDraft({ name: "Tank", quantity: "5" });
    await rt.actions.applySetup();
    expect(ipc.callsOf("renamePoll")).toEqual([[a, "Tank"]]);
    expect(ipc.callsOf("updatePoll")).toEqual([[a, def({ quantity: 5 })]]);
  });

  it("only a rename sends only a rename", async () => {
    const { a, rt } = await withDraft({ name: "Tank" });
    await rt.actions.applySetup();
    expect(ipc.callsOf("renamePoll")).toEqual([[a, "Tank"]]);
    expect(ipc.callsOf("updatePoll")).toHaveLength(0);
  });

  it("a backend message about a field is shown under that field", async () => {
    const { rt } = await withDraft({ quantity: "20" });
    ipc.failNext(
      "updatePoll",
      new IpcError("Quantity is too big for this device.", "validation", "quantity"),
    );
    const result = await rt.actions.applySetup();
    expect(result).toEqual({ ok: false, applied: false, firstInvalid: "quantity" });
    expect(rt.stores.ui.getState().pollDraft?.errors.quantity).toBe(
      "Quantity is too big for this device.",
    );
    expect(rt.stores.ui.getState().pollDraft?.quantity).toBe("20");
  });

  it("a backend name message is shown under the name", async () => {
    const { rt } = await withDraft({ name: "Tank" });
    ipc.failNext("renamePoll", new IpcError("taken", "duplicatePollName", "name"));
    const result = await rt.actions.applySetup();
    expect(result).toMatchObject({ ok: false, firstInvalid: "name" });
    expect(rt.stores.ui.getState().pollDraft?.errors.name).toBe("taken");
  });

  it("RTU: slave ID 0 is rejected for reads", async () => {
    await setup();
    await connection.getState().connect({
      mode: "rtu",
      port: "COM3",
      baud: 9600,
      dataBits: 8,
      parity: "even",
      stopBits: 1,
      timeoutMs: 1000,
    });
    const a = await addPoll("A");
    const rt = await started(a);
    rt.stores.ui.getState().patchPollDraft("slaveId", "0");
    const result = await rt.actions.applySetup();
    expect(result).toMatchObject({ ok: false, firstInvalid: "slaveId" });
  });
});

describe("pause and resume", () => {
  it("toggleActive pauses a running poll and resumes a paused or offline one", async () => {
    await setup();
    await ipc.connect(tcp);
    const a = await addPoll("A");
    const rt = await started(a);
    await rt.actions.toggleActive();
    expect(ipc.callsOf("setPollActive")).toEqual([[a, false]]);
    expect(polls(a).state).toBe("paused");
    await rt.actions.toggleActive();
    expect(ipc.callsOf("setPollActive").at(-1)).toEqual([a, true]);
    await rt.actions.pause();
    await rt.actions.resume();
    expect(ipc.callsOf("setPollActive").slice(-2)).toEqual([
      [a, false],
      [a, true],
    ]);
  });
});

describe("copy", () => {
  const scaled: ScaledProviderFactory = () => (raw) => ({
    text: (4 + (raw / 65535) * 16).toFixed(2),
    unit: "mA",
    marker: "none",
    tooltip: null,
    label: "",
    override: null,
  });

  async function twoRows(extra = {}) {
    await setup();
    const a = await addPoll("A", {
      definition: def({ quantity: 3 }),
      aliases: [{ address: 0, alias: "PT-201" }],
      scale: presetDefaults("current4to20"),
      valueColumns: "both",
      display: { addressBase: 0, showAlias: true, copyAlias: true },
    });
    const rt = await started(a, "workspace", { createScaled: scaled, ...extra });
    ipc.emitConnectionState("connected");
    ipc.emitPollState(a, "polling");
    ipc.emitPollUpdate(a, { values: [0, 65535, 32768] });
    return { a, rt };
  }

  it("Ctrl+C on rows 0-1 with Include alias in copy (Both, 4-20 mA): the acceptance text", async () => {
    const { rt } = await twoRows();
    rt.stores.ui.getState().click(0);
    rt.stores.ui.getState().click(1, { shift: true });
    await rt.actions.copyRows();
    expect(copied).toEqual([`PT-201${TAB}0${TAB}0${TAB}4.00${LF}${TAB}1${TAB}65535${TAB}20.00`]);
    expect(toastTexts()).toEqual(["Copied 2 rows."]);
  });

  it("without the alias option the alias field is left out", async () => {
    const { rt } = await twoRows();
    await rt.actions.setCopyAlias(false);
    rt.stores.ui.getState().click(0);
    await rt.actions.copyRows();
    expect(copied).toEqual([`0${TAB}0${TAB}4.00`]);
    expect(toastTexts()).toEqual(["Copied 1 row."]);
  });

  it("Copy raw, Copy scaled, Copy with header", async () => {
    const { rt } = await twoRows();
    await rt.actions.setCopyAlias(false);
    rt.stores.ui.getState().click(1);
    await rt.actions.copyRows({ columns: "raw" });
    await rt.actions.copyRows({ columns: "scaled" });
    await rt.actions.copyRows({ header: true });
    expect(copied).toEqual([
      `1${TAB}65535`,
      `1${TAB}20.00`,
      [`Address (0-based)${TAB}Raw (Unsigned)${TAB}Scaled`, `1${TAB}65535${TAB}20.00`].join(LF),
    ]);
  });

  it("copies hex values and a scaled field without a scale as empty", async () => {
    const { rt } = await twoRows({ createScaled: noScaleFactory });
    await rt.actions.setCopyAlias(false);
    rt.stores.ui.getState().click(1);
    await rt.actions.setSelectedFormat("hex");
    await rt.actions.copyRows();
    expect(copied).toEqual([`1${TAB}0xFFFF${TAB}`]);
  });

  it("Copy aliases copies only the aliases of the selected rows", async () => {
    const { rt } = await twoRows();
    rt.stores.ui.getState().click(0);
    rt.stores.ui.getState().click(2, { shift: true });
    await rt.actions.copyAliases();
    expect(copied).toEqual([["PT-201", "", ""].join(LF)]);
  });

  it("copies nothing without a selection", async () => {
    const { rt } = await twoRows();
    await rt.actions.copyRows();
    await rt.actions.copyAliases();
    expect(copied).toEqual([]);
    expect(toastTexts()).toEqual([]);
  });

  it("a refused clipboard shows the error toast", async () => {
    const { rt } = await twoRows({
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    rt.stores.ui.getState().click(0);
    await rt.actions.copyRows();
    expect(toasts.getState().items).toEqual([
      expect.objectContaining({ text: "Could not copy to the clipboard.", tone: "error" }),
    ]);
  });

  it("a row without a value yet copies an empty raw field", async () => {
    await setup();
    const a = await addPoll("A", { definition: def({ quantity: 2 }) });
    const rt = await started(a);
    rt.stores.ui.getState().click(1);
    await rt.actions.copyRows();
    expect(copied).toEqual([`1${TAB}`]);
  });
});

describe("aliases: paste, clear, edit", () => {
  async function withRows() {
    await setup();
    const a = await addPoll("A", { definition: def({ startAddress: 8, quantity: 2 }) });
    const rt = await started(a);
    return { a, rt };
  }

  it("pastes at the first selected row", async () => {
    const { a, rt } = await withRows();
    rt.stores.ui.getState().click(8);
    await rt.actions.pasteAliases(["A", "B"].join(LF));
    expect(ipc.pollSummary(a).config.aliases).toEqual([
      { address: 8, alias: "A" },
      { address: 9, alias: "B" },
    ]);
    expect(toastTexts()).toEqual(["Pasted 2 aliases."]);
  });

  it("pastes at the focused row, else at the start of the poll", async () => {
    const { a, rt } = await withRows();
    await rt.actions.pasteAliases("X");
    expect(ipc.pollSummary(a).config.aliases).toEqual([{ address: 8, alias: "X" }]);
    rt.stores.ui.getState().click(9);
    rt.stores.ui.getState().clearSelection();
    rt.stores.ui.getState().moveFocusTo(9);
    await rt.actions.pasteAliases("Y");
    expect(ipc.pollSummary(a).config.aliases).toContainEqual({ address: 9, alias: "Y" });
  });

  it("the toast mentions lines beyond the range", async () => {
    const { rt } = await withRows();
    rt.stores.ui.getState().click(9);
    await rt.actions.pasteAliases(["A", "B", "C"].join(LF));
    expect(toastTexts()).toEqual(["Pasted 1 aliases. 2 lines were beyond the poll range."]);
  });

  it("pasteAliasesFromClipboard reads the clipboard", async () => {
    const { a, rt } = await withRows();
    rt.stores.ui.getState().click(8);
    await rt.actions.pasteAliasesFromClipboard();
    expect(ipc.pollSummary(a).config.aliases).toHaveLength(2);
  });

  it("pasteAliasesFromClipboard without read access shows an error toast", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a, "workspace", { clipboard: { writeText: async () => {} } });
    await rt.actions.pasteAliasesFromClipboard();
    expect(toastTexts()).toEqual(["Could not read the clipboard."]);
  });

  it("a clipboard read that fails shows the same error toast", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a, "workspace", {
      clipboard: {
        writeText: async () => {},
        readText: async () => {
          throw new Error("no");
        },
      },
    });
    await rt.actions.pasteAliasesFromClipboard();
    expect(toastTexts()).toEqual(["Could not read the clipboard."]);
  });

  it("Clear alias removes the aliases of every selected row", async () => {
    await setup();
    const a = await addPoll("A", {
      aliases: [
        { address: 0, alias: "A" },
        { address: 1, alias: "B" },
        { address: 2, alias: "C" },
        { address: 3, alias: "D" },
      ],
    });
    const rt = await started(a);
    rt.stores.ui.getState().click(0);
    rt.stores.ui.getState().click(2, { shift: true });
    await rt.actions.clearSelectedAliases();
    expect(ipc.pollSummary(a).config.aliases).toEqual([{ address: 3, alias: "D" }]);
  });

  it("editAlias opens the editor of that row", async () => {
    const { rt } = await withRows();
    rt.actions.editAlias(9, "f2");
    expect(rt.stores.alias.getState().editing).toMatchObject({ address: 9, startedBy: "f2" });
  });

  it("a committed alias is stored and mirrored back", async () => {
    const { a, rt } = await withRows();
    rt.actions.editAlias(8, "dblclick");
    rt.stores.alias.getState().setText("Tank top");
    rt.stores.alias.getState().commit("tab");
    await Promise.resolve();
    await Promise.resolve();
    expect(ipc.pollSummary(a).config.aliases).toEqual([{ address: 8, alias: "Tank top" }]);
    expect(rt.stores.alias.getState().aliases.get(8)).toBe("Tank top");
  });

  it("a rejected alias is rolled back in the mirror", async () => {
    const { a, rt } = await withRows();
    ipc.failNext("setPollView", "no");
    rt.actions.editAlias(8, "dblclick");
    rt.stores.alias.getState().setText("Tank top");
    rt.stores.alias.getState().commit("tab");
    await new Promise((r) => setTimeout(r, 0));
    expect(rt.stores.alias.getState().aliases.get(8)).toBeUndefined();
    expect(ipc.pollSummary(a).config.aliases).toEqual([]);
  });

  it("aliases follow the address when Start changes", async () => {
    await setup();
    const a = await addPoll("A", { aliases: [{ address: 0, alias: "Tank top" }] });
    const rt = await started(a);
    await ipc.updatePoll(a, def({ startAddress: 5 }));
    expect(rt.stores.alias.getState().aliases.get(0)).toBe("Tank top");
  });
});

describe("display settings", () => {
  it("the Show, format, base and alias controls change the poll's view settings", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a);
    await rt.actions.setValueColumns("both");
    await rt.actions.applyFormatOverrides([
      { start: 0, end: 9, format: "hex", swapBytes: false, reverseWords: false },
    ]);
    await rt.actions.setAddressBase(1);
    await rt.actions.setShowAlias(false);
    await rt.actions.setCopyAlias(true);
    expect(ipc.pollSummary(a).config).toMatchObject({
      valueColumns: "both",
      formatOverrides: [{ start: 0, end: 9, format: "hex" }],
      display: { addressBase: 1, showAlias: false, copyAlias: true },
    });
  });

  it("resetCounters resets this poll only; a failure is a toast", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a);
    await rt.actions.resetCounters();
    expect(ipc.callsOf("resetCounters")).toEqual([[a]]);
    ipc.failNext("resetCounters", "no");
    await rt.actions.resetCounters();
    expect(toastTexts()).toEqual(["no"]);
  });

  it("scaled() gives the factory's provider for the current config", async () => {
    await setup();
    const a = await addPoll("A");
    const rt = await started(a, "workspace", {
      createScaled: () => () => ({
        text: "1.00",
        unit: "",
        marker: "none",
        tooltip: null,
        label: "",
        override: null,
      }),
    });
    expect(rt.scaled()(1, 0)?.text).toBe("1.00");
    const before = runtimeFor(a);
    expect(before.scaled()(1, 0)).toBeNull();
  });
});
