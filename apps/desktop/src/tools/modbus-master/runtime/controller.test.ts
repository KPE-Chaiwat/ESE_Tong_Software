import { IpcError } from "@/shared/ipc/modbus-master";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  idleSnapshot,
  sessionReason,
} from "@/shared/ipc/modbus-master.fake";
import type { PollUpdate, Profile, TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { createFakeWindowIpc, type FakeWindowIpc } from "@/shared/ipc/window";
import { createModbusMasterRuntime, type ModbusMasterRuntime } from ".";

let ipc: FakeModbusMasterIpc;
let win: FakeWindowIpc;
let rt: ModbusMasterRuntime;
let copied: string[];

const syncScheduler = (cb: () => void) => {
  cb();
  return () => {};
};

const s = () => rt.stores;
const state = () => s().session.getState().state;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A valid TCP setup, as if the user filled the form. */
function fillForm(host = "192.168.1.10") {
  s().config.getState().setConnection({ mode: "tcp", host, port: 502, timeoutMs: 1000 });
}

async function connectAndPoll() {
  await rt.controller.connect();
  ipc.emitState("connecting");
  ipc.emitState("connected");
  await flush();
  ipc.emitState("polling");
}

async function setup(prepare?: () => void) {
  ipc = createFakeModbusMasterIpc();
  win = createFakeWindowIpc();
  copied = [];
  prepare?.();
  rt = createModbusMasterRuntime(ipc, win, {
    scheduler: syncScheduler,
    clipboard: {
      writeText: async (t) => {
        copied.push(t);
      },
    },
    toastDurationMs: 100000,
    warn: () => {},
  });
  await rt.init();
}

beforeEach(async () => {
  await setup();
});

afterEach(() => {
  rt.dispose();
});

function profile(name: string, over: Partial<Profile> = {}): Profile {
  return {
    schemaVersion: 1,
    name,
    connection: { mode: "tcp", host: "10.0.0.5", port: 1502, timeoutMs: 500 },
    poll: { slaveId: 2, function: 4, startAddress: 5, quantity: 3, scanRateMs: 250 },
    display: { format: "hex", addressBase: 1 },
    autoStartPoll: false,
    ...over,
  };
}

describe("connect (T1)", () => {
  it("sends nothing when the connection is invalid and reveals the setup panel", async () => {
    s().layout.getState().toggleSetup();
    await rt.controller.connect();
    expect(ipc.callsOf("connect")).toHaveLength(0);
    expect(s().layout.getState().setupOpen).toBe(true);
  });

  it("sends the validated connection", async () => {
    fillForm();
    await rt.controller.connect();
    expect(ipc.callsOf("connect")).toEqual([
      [{ mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 }],
    ]);
    expect(s().session.getState().pending).toBe("connect");
  });

  it("is ignored while connected", async () => {
    fillForm();
    await rt.controller.connect();
    ipc.emitState("connecting");
    ipc.emitState("connected");
    await rt.controller.connect();
    expect(ipc.callsOf("connect")).toHaveLength(1);
  });
});

describe("toggleConnection (Ctrl+L)", () => {
  it("connects, cancels, disconnects and reconnects by state", async () => {
    fillForm();
    await rt.controller.toggleConnection();
    expect(ipc.callsOf("connect")).toHaveLength(1);
    ipc.emitState("connecting");
    await rt.controller.toggleConnection();
    expect(ipc.callsOf("cancelConnect")).toHaveLength(1);
    ipc.emitState("idle");
    await rt.controller.toggleConnection();
    ipc.emitState("connecting");
    ipc.emitState("connected");
    await rt.controller.toggleConnection();
    expect(ipc.callsOf("disconnect")).toHaveLength(1);
    ipc.emitState("idle");
    ipc.emitState("connecting");
    ipc.emitState("disconnected", { reason: sessionReason("refused", "x") });
    await rt.controller.toggleConnection();
    expect(ipc.callsOf("connect")).toHaveLength(3);
  });
});

describe("auto start (T2)", () => {
  it("starts polling when the link comes up and the poll is valid", async () => {
    fillForm();
    await rt.controller.connect();
    ipc.emitState("connecting");
    ipc.emitState("connected");
    expect(ipc.callsOf("startPoll")).toEqual([
      [{ slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 }],
    ]);
  });

  it("does not start when the option is off", async () => {
    fillForm();
    s().config.getState().setAutoStart(false);
    await rt.controller.connect();
    ipc.emitState("connecting");
    ipc.emitState("connected");
    expect(ipc.callsOf("startPoll")).toHaveLength(0);
  });

  it("does not start when the poll is invalid", async () => {
    fillForm();
    s().config.getState().setPoll({
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 126,
      scanRateMs: 1000,
    });
    await rt.controller.connect();
    ipc.emitState("connecting");
    ipc.emitState("connected");
    expect(ipc.callsOf("startPoll")).toHaveLength(0);
  });
});

describe("start / pause / resume (Ctrl+P)", () => {
  beforeEach(async () => {
    fillForm();
    s().config.getState().setAutoStart(false);
    await rt.controller.connect();
    ipc.emitState("connecting");
    ipc.emitState("connected");
  });

  it("Ctrl+P starts from connected, pauses while polling, resumes from paused", async () => {
    await rt.controller.togglePoll();
    expect(ipc.callsOf("startPoll")).toHaveLength(1);
    ipc.emitState("polling");
    await rt.controller.togglePoll();
    expect(ipc.callsOf("stopPoll")).toHaveLength(1);
    ipc.emitState("paused");
    await rt.controller.togglePoll();
    expect(ipc.callsOf("startPoll")).toHaveLength(2);
  });

  it("does not start with an invalid poll", async () => {
    s().config.getState().setPoll({
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 126,
      scanRateMs: 1000,
    });
    await rt.controller.startOrResume();
    expect(ipc.callsOf("startPoll")).toHaveLength(0);
  });

  it("does nothing when there is no link", async () => {
    ipc.emitState("idle");
    await rt.controller.togglePoll();
    expect(ipc.callsOf("startPoll")).toHaveLength(0);
  });
});

describe("apply (DES-001 2.2)", () => {
  const changed = {
    slaveId: 1,
    function: 3 as const,
    startAddress: 0,
    quantity: 20,
    scanRateMs: 1000,
  };

  beforeEach(async () => {
    fillForm();
    s().config.getState().setAutoStart(false);
    await rt.controller.connect();
    ipc.emitState("connecting");
    ipc.emitState("connected");
  });

  it("restarts a running poll and the data view goes back to loading", async () => {
    await rt.controller.startOrResume();
    ipc.emitState("polling");
    ipc.emitPollUpdate({ values: Array.from({ length: 10 }, (_, i) => i) });
    expect(s().pollData.getState().status).toBe("live");
    s().config.getState().setPoll(changed);
    await rt.controller.applyPoll();
    expect(ipc.callsOf("startPoll").at(-1)).toEqual([changed]);
    ipc.emitState("polling");
    expect(s().pollData.getState()).toMatchObject({ status: "loading", values: null });
    expect(s().pollData.getState().definition?.quantity).toBe(20);
  });

  it("only stores the definition when connected", async () => {
    s().config.getState().setPoll(changed);
    await rt.controller.applyPoll();
    expect(ipc.callsOf("startPoll")).toHaveLength(0);
    expect(s().config.getState().poll.quantity).toBe(20);
  });

  it("in paused with a changed definition calls nothing and clears the stale values", async () => {
    await rt.controller.startOrResume();
    ipc.emitState("polling");
    ipc.emitPollUpdate({ values: Array.from({ length: 10 }, (_, i) => i) });
    ipc.emitState("paused");
    expect(s().pollData.getState().status).toBe("stale");
    const before = ipc.callsOf("startPoll").length;
    s().config.getState().setPoll(changed);
    await rt.controller.applyPoll();
    expect(ipc.callsOf("startPoll")).toHaveLength(before);
    expect(s().pollData.getState()).toMatchObject({
      status: "none",
      values: null,
      clearedBecause: "settingsChanged",
    });
  });

  it("in paused with the same definition keeps the stale values", async () => {
    await rt.controller.startOrResume();
    ipc.emitState("polling");
    ipc.emitPollUpdate({ values: Array.from({ length: 10 }, (_, i) => i) });
    ipc.emitState("paused");
    await rt.controller.applyPoll();
    expect(s().pollData.getState().status).toBe("stale");
  });

  it("sends nothing for an invalid definition", async () => {
    await rt.controller.startOrResume();
    ipc.emitState("polling");
    s()
      .config.getState()
      .setPoll({ ...changed, quantity: 0 });
    await rt.controller.applyPoll();
    expect(ipc.callsOf("startPoll")).toHaveLength(1);
  });
});

describe("session -> poll data wiring", () => {
  it("is loading on start, live on update, stale on timeout and paused, cleared on idle", async () => {
    fillForm();
    await connectAndPoll();
    expect(s().pollData.getState().status).toBe("loading");
    ipc.emitPollUpdate({ values: Array.from({ length: 10 }, () => 7) });
    expect(s().pollData.getState().status).toBe("live");
    expect(s().selection.getState().rowCount).toBe(10);
    ipc.emitState("timeout");
    expect(s().pollData.getState().status).toBe("stale");
    ipc.emitState("polling");
    expect(s().pollData.getState().status).toBe("stale");
    ipc.emitPollUpdate({ values: Array.from({ length: 10 }, () => 8) });
    expect(s().pollData.getState().status).toBe("live");
    ipc.emitState("paused");
    expect(s().pollData.getState().status).toBe("stale");
    ipc.emitState("idle");
    expect(s().pollData.getState().status).toBe("none");
    expect(s().selection.getState().rowCount).toBe(0);
  });

  it("keeps stale values after the link is lost and drops them on Dismiss", async () => {
    fillForm();
    await connectAndPoll();
    ipc.emitPollUpdate({ values: Array.from({ length: 10 }, () => 7) });
    ipc.emitState("disconnected", { reason: sessionReason("closedByPeer", "x") });
    expect(s().pollData.getState().status).toBe("stale");
    await rt.controller.dismiss();
    expect(ipc.callsOf("disconnect")).toHaveLength(1);
    ipc.emitState("idle");
    expect(state()).toBe("idle");
    expect(s().pollData.getState().status).toBe("none");
  });
});

describe("a reloaded window (snapshot from mm_open_session)", () => {
  async function reopen(snapshot: Partial<ReturnType<typeof idleSnapshot>>) {
    rt.dispose();
    ipc = createFakeModbusMasterIpc();
    ipc.snapshot = { ...idleSnapshot(), ...snapshot };
    rt = createModbusMasterRuntime(ipc, win, { scheduler: syncScheduler, warn: () => {} });
    await rt.init();
  }

  const config = { mode: "tcp", host: "10.1.1.1", port: 1502, timeoutMs: 700 } as const;
  const poll = { slaveId: 4, function: 3, startAddress: 10, quantity: 3, scanRateMs: 500 } as const;
  const lastUpdate: PollUpdate = {
    seq: 9,
    at: 5000,
    slaveId: 4,
    function: 3,
    startAddress: 10,
    values: [1, 2, 3],
    roundTripMs: 8,
  };

  it("restores the connection and poll settings and the counters", async () => {
    await reopen({
      state: "connected",
      config,
      poll,
      counters: { requests: 5, responses: 4, errors: 1, timeouts: 0 },
    });
    expect(state()).toBe("connected");
    expect(s().config.getState().connection).toEqual(config);
    expect(s().config.getState().poll).toEqual(poll);
    expect(s().traffic.getState().counters.requests).toBe(5);
  });

  it("shows the last values live when the poll is running", async () => {
    await reopen({ state: "polling", config, poll, lastUpdate });
    expect(s().pollData.getState()).toMatchObject({ status: "live", values: [1, 2, 3], seq: 9 });
  });

  it("shows the last values as stale when paused or failing", async () => {
    await reopen({ state: "paused", config, poll, lastUpdate });
    expect(s().pollData.getState()).toMatchObject({ status: "stale", values: [1, 2, 3] });
    await reopen({
      state: "exception",
      exceptionCode: 2,
      consecutiveFailures: 3,
      config,
      poll,
      lastUpdate,
    });
    expect(s().pollData.getState().status).toBe("stale");
    expect(s().session.getState()).toMatchObject({ exceptionCode: 2, consecutiveFailures: 3 });
  });

  it("restores the disconnected reason and the failure details", async () => {
    await reopen({
      state: "disconnected",
      reason: sessionReason("closedByPeer", "x", "linkLost"),
      at: 777,
    });
    expect(s().session.getState()).toMatchObject({ state: "disconnected", since: 777 });
    expect(s().session.getState().reason?.kind).toBe("closedByPeer");
    await reopen({
      state: "badResponse",
      badResponseKind: "crc",
      badResponseDetail: { expected: 1, got: 2, message: "m" },
      consecutiveFailures: 2,
    });
    expect(s().session.getState().badResponse).toEqual({
      kind: "crc",
      detail: { expected: 1, got: 2, message: "m" },
    });
  });

  it("an idle snapshot leaves the defaults alone", async () => {
    await reopen({});
    expect(s().config.getState().connection).toEqual({
      mode: "tcp",
      host: "",
      port: 502,
      timeoutMs: 1000,
    });
    expect(s().pollData.getState().status).toBe("none");
  });
});

describe("events routing", () => {
  it("batches traffic frames and applies counters", async () => {
    const frame: TrafficFrame = {
      seq: 1,
      at: 0,
      direction: "tx",
      bytes: [1],
      slaveId: 1,
      function: 3,
      exceptionCode: null,
      note: null,
    };
    ipc.emitFrames([frame]);
    ipc.emitCounters({ requests: 4, responses: 3, errors: 1, timeouts: 0 });
    expect(s().traffic.getState().frames.size).toBe(1);
    expect(s().traffic.getState().counters.requests).toBe(4);
  });
});

describe("write", () => {
  async function livePoll(fn: 1 | 3 | 4 = 3) {
    fillForm();
    s().config.getState().setPoll({
      slaveId: 1,
      function: fn,
      startAddress: 100,
      quantity: 3,
      scanRateMs: 1000,
    });
    await connectAndPoll();
    ipc.emitPollUpdate({ function: fn, startAddress: 100, values: [1234, 65535, 0] });
  }

  it("does nothing without a link", () => {
    rt.controller.openWrite();
    expect(s().write.getState().open).toBe(false);
  });

  it("opens prefilled from the focused row", async () => {
    await livePoll();
    s().selection.getState().click(1);
    rt.controller.openWrite();
    expect(s().write.getState().draft).toMatchObject({
      function: "6",
      address: "101",
      valueText: "65535",
    });
  });

  it("Enter on an FC04 row shows the read-only toast and does not open", async () => {
    await livePoll(4);
    rt.controller.openWriteForRow(0);
    expect(s().write.getState().open).toBe(false);
    expect(
      s()
        .toasts.getState()
        .items.map((t) => t.text),
    ).toEqual(["Discrete inputs and input registers are read-only."]);
  });

  it("Ctrl+E still opens on an FC04 poll with function 06", async () => {
    await livePoll(4);
    rt.controller.openWrite();
    expect(s().write.getState().open).toBe(true);
    expect(s().write.getState().draft.function).toBe("6");
  });

  it("an FC01 row opens function 05", async () => {
    await livePoll(1);
    ipc.emitPollUpdate({ function: 1, startAddress: 100, values: [1, 0, 1] });
    rt.controller.openWriteForRow(0);
    expect(s().write.getState().draft).toMatchObject({ function: "5", coil: true });
  });
});

describe("copy", () => {
  it("copies selected rows as address and value in the table format (Hex)", async () => {
    fillForm();
    await connectAndPoll();
    s().config.getState().setFormat("hex");
    ipc.emitPollUpdate({ values: [1234, 65535, 0, 0, 0, 0, 0, 0, 0, 0] });
    s().selection.getState().click(0);
    s().selection.getState().click(1, { shift: true });
    await rt.controller.copyRows();
    expect(copied).toEqual(["0\t0x04D2\n1\t0xFFFF"]);
    expect(
      s()
        .toasts.getState()
        .items.map((t) => t.text),
    ).toEqual(["Copied 2 rows."]);
  });

  it("uses the display base and 0/1 for bits", async () => {
    fillForm();
    s().config.getState().setBase(1);
    s().config.getState().setPoll({
      slaveId: 1,
      function: 1,
      startAddress: 0,
      quantity: 2,
      scanRateMs: 1000,
    });
    await connectAndPoll();
    ipc.emitPollUpdate({ function: 1, values: [1, 0] });
    s().selection.getState().selectAll();
    await rt.controller.copyRows();
    expect(copied).toEqual(["1\t1\n2\t0"]);
  });

  it("copies nothing when no row is selected", async () => {
    await rt.controller.copyRows();
    expect(copied).toEqual([]);
  });

  it("copies the one selected frame as TSV, and nothing without a selection", async () => {
    const at = new Date(2026, 9, 12, 14, 2, 11, 532).getTime();
    const mk = (seq: number): TrafficFrame => ({
      seq,
      at,
      direction: seq % 2 === 1 ? "tx" : "rx",
      bytes: [0, seq],
      slaveId: 1,
      function: 3,
      exceptionCode: null,
      note: null,
    });
    ipc.emitFrames([mk(1), mk(2)]);
    // No frame selected: nothing is copied and no toast appears (DES-001 5.2).
    await rt.controller.copyFrames();
    expect(copied).toEqual([]);
    expect(s().toasts.getState().items).toEqual([]);
    s().traffic.getState().select(2);
    await rt.controller.copyFrames();
    expect(copied).toEqual(["14:02:11.532\tRX\t00 02\tFC03 slave 1"]);
    expect(
      s()
        .toasts.getState()
        .items.map((x) => x.text),
    ).toEqual(["Copied 1 frame."]);
  });
});

describe("copy bytes", () => {
  it("copies the selected frame as space-separated hex", async () => {
    const frame: TrafficFrame = {
      seq: 7,
      at: 0,
      direction: "rx",
      bytes: [0, 1, 0xab, 0xff],
      slaveId: 1,
      function: 3,
      exceptionCode: null,
      note: null,
    };
    ipc.emitFrames([frame]);
    await rt.controller.copyFrameBytes();
    expect(copied).toEqual([]);
    s().traffic.getState().select(7);
    await rt.controller.copyFrameBytes();
    expect(copied).toEqual(["00 01 AB FF"]);
    expect(s().toasts.getState().items.at(-1)?.text).toBe("Copied 4 bytes.");
  });
});

describe("profiles", () => {
  it("Ctrl+S on an untitled setup asks for a name (Save as)", async () => {
    fillForm();
    const result = rt.controller.saveProfile();
    await vi.waitFor(() => expect(s().dialogs.getState().saveAsVisible).toBe(true));
    s().dialogs.getState().resolveSaveAs(false);
    await expect(result).resolves.toBe(false);
  });

  it("Save and Save as are blocked while the form is invalid: a 4 s error toast, no dialog", async () => {
    // The default setup has no host, so the connection form is invalid.
    await expect(rt.controller.saveProfile()).resolves.toBe(false);
    await expect(rt.controller.openSaveAs()).resolves.toBe(false);
    expect(s().dialogs.getState().saveAsVisible).toBe(false);
    expect(ipc.callsOf("profilesSave")).toHaveLength(0);
    const toasts = s().toasts.getState().items;
    expect(toasts.map((x) => x.text)).toEqual([
      "Fix the highlighted fields before saving.",
      "Fix the highlighted fields before saving.",
    ]);
    expect(toasts[0]?.tone).toBe("error");
  });

  it("a named profile with an invalid form is not saved either", async () => {
    s()
      .config.getState()
      .applyProfile(
        profile("Named", {
          poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 126, scanRateMs: 1000 },
        }),
      );
    s().config.getState().setFormat("hex");
    await expect(rt.controller.saveProfile()).resolves.toBe(false);
    expect(ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("Save as writes the profile and marks the window saved", async () => {
    fillForm();
    await expect(rt.controller.saveProfileAs("Boiler-PLC")).resolves.toEqual({ ok: true });
    expect(s().config.getState().profileName).toBe("Boiler-PLC");
    expect(ipc.callsOf("profilesSave")).toHaveLength(1);
    expect((await ipc.profilesList()).map((p) => p.name)).toEqual(["Boiler-PLC"]);
  });

  it("Save as with an invalid name saves nothing", async () => {
    fillForm();
    await expect(rt.controller.saveProfileAs("a/b")).resolves.toEqual({
      ok: false,
      message: 'Profile name cannot contain \\ / : * ? " < > |',
    });
    expect(ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("Save as with invalid forms saves nothing and tells the user", async () => {
    await expect(rt.controller.saveProfileAs("X")).resolves.toMatchObject({ ok: false });
    expect(ipc.callsOf("profilesSave")).toHaveLength(0);
    expect(s().toasts.getState().items.at(-1)?.text).toBe(
      "Fix the highlighted fields before saving.",
    );
  });

  it("Save as over an existing name asks Replace and honours Cancel", async () => {
    fillForm();
    ipc.seedProfiles([profile("Boiler-PLC")]);
    const pending = rt.controller.saveProfileAs("boiler-plc");
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    expect(s().confirm.getState().current).toMatchObject({
      title: "Replace profile?",
      body: 'A profile named "boiler-plc" already exists. Replace it?',
      defaultId: "cancel",
    });
    expect(
      s()
        .confirm.getState()
        .current?.buttons.map((b) => b.label),
    ).toEqual(["Cancel", "Replace"]);
    s().confirm.getState().resolve("cancel");
    await expect(pending).resolves.toMatchObject({ ok: false });
    // The first save asked for no overwrite and was refused; nothing was replaced.
    expect(ipc.callsOf("profilesSave").map((c) => c[1])).toEqual([false]);
  });

  it("REV-002 m2: a profile that appears right before saving is never overwritten silently", async () => {
    fillForm();
    // The list in this window is stale (nothing listed), but the name exists on disk.
    ipc.seedProfiles([profile("Taken")]);
    const pending = rt.controller.saveProfileAs("Taken");
    await vi.waitFor(() => expect(s().confirm.getState().current?.title).toBe("Replace profile?"));
    expect(ipc.callsOf("profilesList")).toHaveLength(0);
    s().confirm.getState().resolve("cancel");
    await pending;
    expect((await ipc.profilesGet("Taken")).connection).toMatchObject({ host: "10.0.0.5" });
  });

  it("REV-002 m2: a failing profile list does not hide the Replace prompt", async () => {
    fillForm();
    ipc.seedProfiles([profile("Taken")]);
    ipc.failNext("profilesList", "Disk unavailable");
    const pending = rt.controller.saveProfileAs("Taken");
    await vi.waitFor(() => expect(s().confirm.getState().current?.title).toBe("Replace profile?"));
    s().confirm.getState().resolve("cancel");
    await pending;
  });

  it("Save as with a new name saves without overwrite and without a prompt", async () => {
    fillForm();
    await expect(rt.controller.saveProfileAs("Brand new")).resolves.toEqual({ ok: true });
    expect(ipc.callsOf("profilesSave").map((c) => c[1])).toEqual([false]);
    expect(s().confirm.getState().current).toBeNull();
  });

  it("Save as keeps the name exactly as typed (no silent trim)", async () => {
    fillForm();
    await expect(rt.controller.saveProfileAs(" padded")).resolves.toEqual({
      ok: false,
      message: "Profile name cannot start or end with a space.",
    });
    expect(ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("a backend invalidProfileName message is returned for the name field", async () => {
    fillForm();
    ipc.failNext(
      "profilesSave",
      new IpcError("Profile name is not allowed.", "invalidProfileName"),
    );
    await expect(rt.controller.saveProfileAs("Odd")).resolves.toEqual({
      ok: false,
      message: "Profile name is not allowed.",
    });
  });

  it("Save as over an existing name replaces it after the confirm", async () => {
    fillForm();
    ipc.seedProfiles([profile("Boiler-PLC")]);
    const pending = rt.controller.saveProfileAs("Boiler-PLC");
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("replace");
    await expect(pending).resolves.toEqual({ ok: true });
    expect(ipc.callsOf("profilesSave").map((c) => c[1])).toEqual([false, true]);
    const saved = await ipc.profilesGet("Boiler-PLC");
    expect(saved.connection).toMatchObject({ host: "192.168.1.10" });
  });

  it("Ctrl+S on a named profile saves under that name, even if it was deleted elsewhere", async () => {
    fillForm();
    s().config.getState().applyProfile(profile("Gone"));
    s().config.getState().setFormat("signed");
    await expect(rt.controller.saveProfile()).resolves.toBe(true);
    expect((await ipc.profilesList()).map((p) => p.name)).toEqual(["Gone"]);
    expect(s().config.getState().savedSnapshot).not.toBeNull();
  });

  it("reports a failed save", async () => {
    s().config.getState().applyProfile(profile("P"));
    ipc.failNext("profilesSave", "Disk full");
    await expect(rt.controller.saveProfile()).resolves.toBe(false);
    expect(s().toasts.getState().items.at(-1)?.text).toBe("Could not save profile: Disk full");
  });

  it("loading applies the profile and never connects", async () => {
    ipc.seedProfiles([profile("Pump")]);
    await expect(rt.controller.loadProfile("Pump")).resolves.toBe(true);
    expect(s().config.getState()).toMatchObject({
      profileName: "Pump",
      autoStartPoll: false,
      display: { format: "hex", addressBase: 1 },
    });
    expect(ipc.callsOf("connect")).toHaveLength(0);
  });

  it("loading a missing profile keeps the setup and shows a toast", async () => {
    await expect(rt.controller.loadProfile("nope")).resolves.toBe(false);
    expect(s().config.getState().profileName).toBeNull();
    expect(s().toasts.getState().items.at(-1)?.text).toContain("Could not open profile");
  });

  it("loading while polling asks Disconnect and load?, disconnects, then applies", async () => {
    fillForm();
    ipc.seedProfiles([profile("Pump")]);
    s().config.getState().markSaved("Current");
    await connectAndPoll();
    const pending = rt.controller.loadProfile("Pump");
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    expect(s().confirm.getState().current).toMatchObject({
      title: "Disconnect and load?",
      body: 'Loading "Pump" will disconnect from TCP 192.168.1.10:502.',
    });
    s().confirm.getState().resolve("disconnect");
    await vi.waitFor(() => expect(ipc.callsOf("disconnect")).toHaveLength(1));
    expect(s().config.getState().profileName).toBe("Current");
    ipc.emitState("idle");
    await expect(pending).resolves.toBe(true);
    expect(s().config.getState().profileName).toBe("Pump");
  });

  it("Cancel on Disconnect and load? keeps everything", async () => {
    fillForm();
    ipc.seedProfiles([profile("Pump")]);
    s().config.getState().markSaved("Current");
    await connectAndPoll();
    const pending = rt.controller.loadProfile("Pump");
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("cancel");
    await expect(pending).resolves.toBe(false);
    expect(ipc.callsOf("disconnect")).toHaveLength(0);
    expect(s().config.getState().profileName).toBe("Current");
  });

  it("gives up when the backend never reports idle", async () => {
    await setup();
    rt.dispose();
    ipc = createFakeModbusMasterIpc();
    rt = createModbusMasterRuntime(ipc, win, {
      scheduler: syncScheduler,
      disconnectTimeoutMs: 10,
      warn: () => {},
    });
    await rt.init();
    fillForm();
    ipc.seedProfiles([profile("Pump")]);
    s().config.getState().markSaved("Current");
    await connectAndPoll();
    const pending = rt.controller.loadProfile("Pump");
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("disconnect");
    await expect(pending).resolves.toBe(false);
    expect(s().config.getState().profileName).toBe("Current");
  });

  it("asks Save changes? before loading over unsaved changes (Don't save)", async () => {
    ipc.seedProfiles([profile("Pump")]);
    s().config.getState().applyProfile(profile("Current"));
    s().config.getState().setFormat("binary");
    const pending = rt.controller.loadProfile("Pump");
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    expect(s().confirm.getState().current).toMatchObject({
      title: "Save changes?",
      body: 'Save changes to "Current" before closing?',
      defaultId: "save",
    });
    expect(
      s()
        .confirm.getState()
        .current?.buttons.map((b) => b.label),
    ).toEqual(["Save", "Don't save", "Cancel"]);
    s().confirm.getState().resolve("discard");
    await expect(pending).resolves.toBe(true);
    expect(s().config.getState().profileName).toBe("Pump");
  });

  it("Cancel on Save changes? stops the load", async () => {
    ipc.seedProfiles([profile("Pump")]);
    s().config.getState().applyProfile(profile("Current"));
    s().config.getState().setFormat("binary");
    const pending = rt.controller.loadProfile("Pump");
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("cancel");
    await expect(pending).resolves.toBe(false);
    expect(s().config.getState().profileName).toBe("Current");
  });
});

describe("closing (task 17)", () => {
  it("closes immediately when nothing changed", async () => {
    await expect(rt.controller.requestClose()).resolves.toBe("close");
  });

  it("asks Save changes? for an unnamed dirty setup with the unnamed wording", async () => {
    s().config.getState().setFormat("hex");
    const pending = rt.controller.requestClose();
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    expect(s().confirm.getState().current?.body).toBe(
      "Save this setup as a profile before closing?",
    );
    s().confirm.getState().resolve("cancel");
    await expect(pending).resolves.toBe("cancel");
  });

  it("Don't save closes", async () => {
    s().config.getState().applyProfile(profile("P"));
    s().config.getState().setFormat("signed");
    const pending = rt.controller.requestClose();
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("discard");
    await expect(pending).resolves.toBe("close");
  });

  it("Save on a named profile saves and closes", async () => {
    fillForm();
    s()
      .config.getState()
      .applyProfile(
        profile("P", { connection: { mode: "tcp", host: "h", port: 1, timeoutMs: 500 } }),
      );
    s().config.getState().setFormat("signed");
    const pending = rt.controller.requestClose();
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("save");
    await expect(pending).resolves.toBe("close");
    expect((await ipc.profilesList()).map((p) => p.name)).toEqual(["P"]);
  });

  it("Save on an untitled setup opens Save as and closes after it saved", async () => {
    fillForm();
    s().config.getState().setFormat("hex");
    const pending = rt.controller.requestClose();
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("save");
    await vi.waitFor(() => expect(s().dialogs.getState().saveAsVisible).toBe(true));
    await rt.controller.saveProfileAs("Fresh");
    await expect(pending).resolves.toBe("close");
  });

  it("Save in Save changes? with an invalid form is blocked: toast, window stays open", async () => {
    s().config.getState().applyProfile(profile("Named"));
    s()
      .config.getState()
      .setPoll({ slaveId: 1, function: 3, startAddress: 0, quantity: 126, scanRateMs: 1000 });
    const pending = rt.controller.requestClose();
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("save");
    await expect(pending).resolves.toBe("cancel");
    expect(ipc.callsOf("profilesSave")).toHaveLength(0);
    expect(s().toasts.getState().items.at(-1)?.text).toBe(
      "Fix the highlighted fields before saving.",
    );
  });

  it("Cancel in Save as keeps the window open", async () => {
    fillForm();
    s().config.getState().setFormat("hex");
    const pending = rt.controller.requestClose();
    await vi.waitFor(() => expect(s().confirm.getState().current).not.toBeNull());
    s().confirm.getState().resolve("save");
    await vi.waitFor(() => expect(s().dialogs.getState().saveAsVisible).toBe(true));
    s().dialogs.getState().resolveSaveAs(false);
    await expect(pending).resolves.toBe("cancel");
  });

  it("opens a new window of the tool", async () => {
    await rt.controller.newWindow();
    expect(win.openedTools).toEqual(["modbus-master"]);
  });
});
