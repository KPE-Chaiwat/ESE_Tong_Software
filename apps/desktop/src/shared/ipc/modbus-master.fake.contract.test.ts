// The fake follows the BE-002 final contract (docs/tasks/backend/BE-002-multi-poll.md): flat
// events, nested summaries, patch semantics, the error codes. These tests pin the points where the
// final contract differs from the first design.
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  type FakeOptions,
  pollConfigInput,
} from "./modbus-master.fake";
import type {
  ConnectionConfig,
  PollId,
  PollViewEvent,
  SessionEvent,
  WorkspaceRect,
} from "./modbus-master.types";

const tcp: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const rtu: ConnectionConfig = {
  mode: "rtu",
  port: "COM3",
  baud: 9600,
  dataBits: 8,
  parity: "even",
  stopBits: 1,
  timeoutMs: 500,
};
const definition = {
  slaveId: 1,
  function: 3 as const,
  startAddress: 0,
  quantity: 10,
  scanRateMs: 100,
};

async function setup(options: FakeOptions = {}) {
  const fake = createFakeModbusMasterIpc(options);
  const session: SessionEvent[] = [];
  await fake.openSession((e) => session.push(e));
  return { fake, session };
}

async function addPoll(
  fake: FakeModbusMasterIpc,
  name: string,
  host: "workspace" | "native" = "workspace",
  patch: Partial<ReturnType<typeof pollConfigInput>> = {},
): Promise<PollId> {
  return fake.addPoll(pollConfigInput({ name, definition, ...patch }), host);
}

async function attach(
  fake: FakeModbusMasterIpc,
  pollId: PollId,
  host: "workspace" | "native" = "workspace",
) {
  const events: PollViewEvent[] = [];
  const snapshot = await fake.attachPollView(pollId, host, (e) => events.push(e));
  return { events, snapshot };
}

const rect = (patch: Partial<WorkspaceRect> = {}): WorkspaceRect => ({
  x: 8,
  y: 8,
  width: 640,
  height: 368,
  z: 1,
  state: "normal",
  restore: null,
  ...patch,
});

describe("the BE-002 final contract in the fake", () => {
  it("a poll added while connected gets no PollStateChanged: its state is in PollListChanged (PT0)", async () => {
    const { fake, session } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    session.length = 0;
    const a = await addPoll(fake, "A");
    expect(session.map((e) => e.type)).toEqual(["PollListChanged"]);
    const list = session[0];
    expect(list?.type === "PollListChanged" && list.polls[0]?.status.state).toBe("polling");
    expect(fake.pollSummary(a).status.state).toBe("polling");
  });

  it("the run intent of a new poll is Start polling when connected", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await fake.setAutoStartPoll(false);
    const b = await addPoll(fake, "B");
    expect(fake.pollSummary(a).config.active).toBe(true);
    expect(fake.pollSummary(b).config.active).toBe(false);
  });

  it("ConnectionStateChanged and the snapshot carry the connection settings", async () => {
    const { fake, session } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const events = session.filter((e) => e.type === "ConnectionStateChanged");
    expect(events.map((e) => e.config)).toEqual([tcp, tcp]);
    expect(fake.snapshot().connection).toMatchObject({ state: "connected", config: tcp });
  });

  it("PollStatus events are flat: pollId, state, counts and at", async () => {
    const { fake, session } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    session.length = 0;
    fake.scriptFault(a, { kind: "timeout" });
    fake.advance(3000);
    const event = session.find((e) => e.type === "PollStateChanged");
    expect(event).toMatchObject({
      pollId: a,
      state: "timeout",
      consecutiveFailures: 1,
      exceptionCode: null,
      badResponseKind: null,
      badResponseDetail: null,
    });
    expect(event?.type === "PollStateChanged" && event.at).toBeGreaterThan(0);
  });

  it("an identical Apply is a no-op without events; a flag-only view patch does not send PollConfigChanged", async () => {
    const { fake, session } = await setup({ mode: "virtual" });
    const a = await addPoll(fake, "A");
    const view = await attach(fake, a);
    const before = { view: view.events.length, session: session.length };
    await fake.updatePoll(a, { ...definition });
    expect(view.events).toHaveLength(before.view);
    expect(session).toHaveLength(before.session);
    await fake.setPollView(a, { hasUnappliedEdits: true });
    expect(view.events.filter((e) => e.type === "PollConfigChanged")).toHaveLength(0);
    expect(session.length).toBeGreaterThan(before.session);
    await fake.setPollView(a, { valueColumns: "both" });
    expect(view.events.filter((e) => e.type === "PollConfigChanged")).toHaveLength(1);
    // The same value again is not a change.
    await fake.setPollView(a, { valueColumns: "both" });
    expect(view.events.filter((e) => e.type === "PollConfigChanged")).toHaveLength(1);
  });

  it("definitions the backend refuses are refused (validate_poll): RTU slave 0, quantity, range, scan rate", async () => {
    const { fake } = await setup({ mode: "manual" });
    const a = await addPoll(fake, "A");
    await expect(fake.updatePoll(a, { ...definition, quantity: 126 })).rejects.toMatchObject({
      code: "validation",
      field: "quantity",
    });
    await expect(
      fake.updatePoll(a, { ...definition, startAddress: 65530, quantity: 10 }),
    ).rejects.toMatchObject({ field: "quantity" });
    await expect(fake.updatePoll(a, { ...definition, scanRateMs: 5 })).rejects.toMatchObject({
      field: "scanRateMs",
    });
    await expect(fake.updatePoll(a, { ...definition, slaveId: 300 })).rejects.toMatchObject({
      field: "slaveId",
    });
    await fake.connect({
      mode: "rtu",
      port: "COM3",
      baud: 9600,
      dataBits: 8,
      parity: "even",
      stopBits: 1,
      timeoutMs: 500,
    });
    await expect(fake.updatePoll(a, { ...definition, slaveId: 0 })).rejects.toMatchObject({
      field: "slaveId",
      message: "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247.",
    });
    await expect(
      fake.addPoll(
        pollConfigInput({ name: "B", definition: { ...definition, slaveId: 0 } }),
        "workspace",
      ),
    ).rejects.toMatchObject({ field: "slaveId" });
    expect(fake.pollIds()).toEqual([a]);
  });

  it("the monitor id is the OS monitor name, as in Rust", async () => {
    const { fake } = await setup({ mode: "manual" });
    const monitors = fake.monitors;
    expect(monitors.every((m) => m.id === m.name)).toBe(true);
  });

  it("PollCounters carries the effective rate and the time of the last good reply", async () => {
    const { fake } = await setup({ mode: "virtual", startTime: 5_000_000 });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    const view = await attach(fake, a);
    fake.advance(1000);
    const event = view.events.filter((e) => e.type === "PollCounters").at(-1);
    // The raw mean interval, as Rust sends it: the 1.5 x rule is the UI's.
    expect(event).toMatchObject({ type: "PollCounters", pollId: a, effectiveScanMs: 100 });
    expect(event?.type === "PollCounters" && event.lastOkAt).toBeGreaterThan(5_000_000);
    expect(event?.type === "PollCounters" && event.counters.responses).toBeGreaterThan(5);
    // null after Apply, Disconnect and Dismiss
    await fake.updatePoll(a, { ...definition, quantity: 11 });
    expect(fake.pollSummary(a).counters.lastOkAt).toBeNull();
    fake.advance(300);
    expect(fake.pollSummary(a).counters.lastOkAt).not.toBeNull();
    await fake.disconnect();
    expect(fake.pollSummary(a).counters.lastOkAt).toBeNull();
  });

  it("the Counters event lists a PollCounters per poll in list order", async () => {
    const { fake, session } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B");
    await fake.reorderPolls([b, a]);
    fake.advance(500);
    const counters = session.filter((e) => e.type === "Counters").at(-1);
    expect(counters?.type === "Counters" && counters.polls.map((p) => p.pollId)).toEqual([b, a]);
  });

  it("mm_set_poll_view is a patch: left-out keys stay, scale null removes the scale", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", "workspace", {
      aliases: [
        { address: 0, alias: "A" },
        { address: 2, alias: "B" },
      ],
      valueColumns: "both",
    });
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
    await fake.setPollView(a, { scale });
    expect(fake.pollSummary(a).config).toMatchObject({ scale, valueColumns: "both" });
    expect(fake.pollSummary(a).config.aliases).toHaveLength(2);
    await fake.setPollView(a, { hasUnappliedEdits: true });
    expect(fake.pollSummary(a)).toMatchObject({ hasUnappliedEdits: true });
    expect(fake.pollSummary(a).config.scale).toEqual(scale);
    await fake.setPollView(a, { scale: null });
    expect(fake.pollSummary(a).config.scale).toBeNull();
    // aliases are stored sorted by address
    await fake.setPollView(a, {
      aliases: [
        { address: 9, alias: "Z" },
        { address: 1, alias: "Y" },
      ],
    });
    expect(fake.pollSummary(a).config.aliases.map((x) => x.address)).toEqual([1, 9]);
  });

  it("compact inside the workspace layout is ignored (mm_set_compact_mode owns it)", async () => {
    const { fake } = await setup();
    await fake.setWorkspaceLayout({ ...fake.snapshot().workspaceLayout, compact: true });
    expect(fake.compact).toBe(false);
    expect(fake.snapshot().workspaceLayout.compact).toBe(false);
    await fake.setCompactMode(true);
    expect(fake.snapshot().workspaceLayout.compact).toBe(true);
  });

  it("requestSave carries saveAs (default false)", async () => {
    const { fake, session } = await setup();
    await fake.requestSave();
    await fake.requestSave(true);
    expect(session.filter((e) => e.type === "SaveRequested")).toEqual([
      { type: "SaveRequested", saveAs: false },
      { type: "SaveRequested", saveAs: true },
    ]);
  });

  it("exportProfile takes an optional name and connection; with no connection at all it is a validation error", async () => {
    const { fake } = await setup();
    await expect(fake.exportProfile()).rejects.toMatchObject({
      code: "validation",
      field: "connection",
    });
    await fake.setProfileName("Boiler");
    expect(await fake.exportProfile(undefined, tcp)).toMatchObject({
      name: "Boiler",
      connection: tcp,
      migratedFrom: null,
    });
    expect(await fake.exportProfile("Other", rtu)).toMatchObject({
      name: "Other",
      connection: rtu,
    });
    await fake.connect(tcp);
    expect((await fake.exportProfile()).connection).toEqual(tcp);
  });

  it("applyProfile returns the new session snapshot", async () => {
    const { fake } = await setup();
    await addPoll(fake, "Old");
    const exported = await fake.exportProfile("P", tcp);
    const snapshot = await fake.applyProfile({
      ...exported,
      polls: exported.polls.map((p) => ({ ...p, name: "New" })),
    });
    expect(snapshot.polls.map((p) => p.config.name)).toEqual(["New"]);
    expect(snapshot.profileName).toBe("P");
    expect(snapshot.connection.config).toEqual(tcp);
  });

  it("applyProfile keeps the active flag of each poll", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await fake.setPollActive(a, false);
    const exported = await fake.exportProfile("P", tcp);
    const snapshot = await fake.applyProfile(exported);
    expect(snapshot.polls[0]?.config.active).toBe(false);
  });

  it("applyProfile is refused while connected, and dismisses a disconnected session", async () => {
    const { fake } = await setup({ mode: "virtual" });
    const exported = await fake.exportProfile("P", tcp);
    await fake.connect(tcp);
    await expect(fake.applyProfile(exported)).rejects.toMatchObject({
      code: "invalidState",
      message: "Disconnect before loading a profile.",
    });
    fake.dropLink();
    const snapshot = await fake.applyProfile(exported);
    expect(snapshot.connection.state).toBe("idle");
  });

  it("applyProfile validates every poll: 'Poll {i}: ...' on field polls, nothing changes", async () => {
    const { fake } = await setup();
    await addPoll(fake, "A");
    const exported = await fake.exportProfile("P", tcp);
    const bad = { ...exported, polls: [...exported.polls, ...exported.polls] };
    await expect(fake.applyProfile(bad)).rejects.toMatchObject({
      code: "validation",
      field: "polls",
      message: expect.stringContaining("Poll 2:"),
    });
    expect(fake.pollIds()).toHaveLength(1);
  });

  it("dock with a handoff request but no attached native view proceeds without a handoff", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", "native");
    await fake.dockPoll(a, null, true, null);
    expect(fake.pollSummary(a).host).toBe("workspace");
    expect((await attach(fake, a, "workspace")).snapshot.handoff).toBeNull();
  });

  it("docking a minimized poll shows it normal", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await fake.setWorkspaceLayout({
      ...fake.snapshot().workspaceLayout,
      items: [{ pollId: a, rect: rect({ state: "minimized" }) }],
    });
    await fake.popOutPoll(a, { kind: "rect", rect: { x: 0, y: 0, width: 800, height: 600 } }, null);
    await fake.dockPoll(a, null, false, null);
    expect(fake.pollSummary(a).workspace?.state).toBe("normal");
  });

  it("ViewDetached and HandoffRequested carry the poll id", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    const first = await attach(fake, a);
    await attach(fake, a);
    expect(first.events).toEqual([{ type: "ViewDetached", pollId: a, reason: "replaced" }]);
  });

  it("only pollNotFound is a code of its own; the rest are validation with a field", async () => {
    const { fake } = await setup();
    await expect(fake.removePoll(9)).rejects.toMatchObject({ code: "pollNotFound" });
    await expect(addPoll(fake, " ")).rejects.toMatchObject({ code: "validation", field: "name" });
    await expect(fake.reorderPolls([5])).rejects.toMatchObject({
      code: "validation",
      field: "order",
    });
  });
});
