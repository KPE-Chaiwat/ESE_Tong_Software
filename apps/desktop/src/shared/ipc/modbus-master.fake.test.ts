import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { vi } from "vitest";
import { IpcError, toIpcError } from "./errors";
import {
  createFakeModbusMasterIpc,
  defaultMonitor,
  type FakeModbusMasterIpc,
  type FakeOptions,
  pollConfigInput,
  sessionReason,
} from "./modbus-master.fake";
import type {
  ConnectionConfig,
  PollId,
  PollViewEvent,
  Profile,
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

const def = (patch: Partial<ReturnType<typeof pollConfigInput>["definition"]> = {}) => ({
  slaveId: 1,
  function: 3 as const,
  startAddress: 0,
  quantity: 10,
  scanRateMs: 100,
  ...patch,
});

async function setup(options: FakeOptions = {}) {
  const fake = createFakeModbusMasterIpc(options);
  const session: SessionEvent[] = [];
  await fake.openSession((e) => session.push(e));
  return { fake, session };
}

async function addPoll(
  fake: FakeModbusMasterIpc,
  name: string,
  patch: Partial<ReturnType<typeof pollConfigInput>> & { active?: boolean } = {},
  host: "workspace" | "native" = "workspace",
): Promise<PollId> {
  const { active, ...input } = patch;
  const id = await fake.addPoll(pollConfigInput({ name, definition: def(), ...input }), host);
  // The run intent of a new poll is "Start polling when connected"; a test that wants a paused
  // poll pauses it.
  if (active === false) await fake.setPollActive(id, false);
  return id;
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

const types = (events: ReadonlyArray<{ type: string }>) => events.map((e) => e.type);
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

describe("session channel", () => {
  it("delivers events in order to the openSession callback", async () => {
    const { fake, session } = await setup();
    fake.emitConnectionState("connecting");
    fake.emitConnectionState("connected");
    fake.emitCounters({ linkLoadPct: 5 });
    fake.emitFrames([]);
    expect(types(session)).toEqual([
      "ConnectionStateChanged",
      "ConnectionStateChanged",
      "Counters",
      "TrafficFrames",
    ]);
    expect(session.filter((e) => e.type === "ConnectionStateChanged").map((e) => e.state)).toEqual([
      "connecting",
      "connected",
    ]);
  });

  it("drops events emitted before openSession, like the real channel", () => {
    const fake = createFakeModbusMasterIpc();
    expect(() => fake.emitConnectionState("connecting")).not.toThrow();
  });

  it("snapshot reflects the model", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await addPoll(fake, "B");
    await fake.setProfileName("Boiler");
    const snap = await fake.openSession(() => {});
    expect(snap.polls.map((p) => p.config.name)).toEqual(["A", "B"]);
    expect(snap.polls[0]?.config.pollId).toBe(a);
    expect(snap.profileName).toBe("Boiler");
    expect(snap.connection.state).toBe("idle");
    expect(snap.polls.every((p) => p.status.state === "offline")).toBe(true);
  });

  it("a held openSession lets events arrive before the snapshot reply", async () => {
    const fake = createFakeModbusMasterIpc();
    const seen: string[] = [];
    const held = fake.hold("openSession");
    const pending = fake.openSession((e) => seen.push(e.type));
    fake.emitConnectionState("connecting");
    expect(seen).toEqual(["ConnectionStateChanged"]);
    held.release(fake.snapshot());
    await pending;
  });
});

describe("recording, scripting and holding", () => {
  it("records calls with their arguments", async () => {
    const { fake } = await setup();
    await fake.setAutoStartPoll(false);
    await fake.connect(tcp);
    expect(fake.callsOf("connect")).toEqual([[tcp]]);
    expect(fake.callsOf("setAutoStartPoll")).toEqual([[false]]);
  });

  it("failNext rejects the next call only", async () => {
    const { fake } = await setup();
    fake.failNext("connect", "boom");
    await expect(fake.connect(tcp)).rejects.toThrow("boom");
    await expect(fake.connect(tcp)).resolves.toBeUndefined();
  });

  it("failAlways and clearFailures", async () => {
    const { fake } = await setup();
    fake.failAlways("addPoll", new IpcError("nope", "validation", "polls"));
    await expect(addPoll(fake, "A")).rejects.toMatchObject({ code: "validation", field: "polls" });
    await expect(addPoll(fake, "A")).rejects.toThrow("nope");
    fake.clearFailures();
    await expect(addPoll(fake, "A")).resolves.toBeTypeOf("number");
  });

  it("setResult overrides a command (a value or a function of the arguments)", async () => {
    const { fake } = await setup();
    fake.setResult("write", { status: "timeout" });
    await expect(
      fake.write({ slaveId: 1, function: 6, address: 0, values: [1] }, null),
    ).resolves.toEqual({
      status: "timeout",
    });
    fake.setResult("write", (req: { slaveId: number }) => ({
      status: "exception",
      code: req.slaveId,
    }));
    await expect(
      fake.write({ slaveId: 3, function: 6, address: 0, values: [1] }, null),
    ).resolves.toEqual({
      status: "exception",
      code: 3,
    });
  });

  it("hold keeps a command pending until released or failed", async () => {
    const { fake } = await setup();
    const held = fake.hold("renamePoll");
    const id = await addPoll(fake, "A");
    let done = false;
    const pending = fake.renamePoll(id, "B").then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    held.release();
    await pending;
    expect(done).toBe(true);

    const failing = fake.hold("renamePoll");
    const second = fake.renamePoll(id, "C");
    failing.fail("late failure");
    await expect(second).rejects.toThrow("late failure");
  });

  it("reset drops everything", async () => {
    const { fake } = await setup();
    await addPoll(fake, "A");
    fake.failAlways("connect", "x");
    fake.reset();
    expect(fake.calls).toHaveLength(0);
    expect(fake.pollIds()).toEqual([]);
    await fake.openSession(() => {});
    await expect(fake.connect(tcp)).resolves.toBeUndefined();
  });
});

describe("polls: add, duplicate, remove, rename, reorder", () => {
  it("addPoll stores the poll and tells W1 in list order", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B");
    expect(a).not.toBe(b);
    const last = session.filter((e) => e.type === "PollListChanged").at(-1);
    expect(last?.type === "PollListChanged" && last.polls.map((p) => p.config.name)).toEqual([
      "A",
      "B",
    ]);
  });

  it("poll ids are never reused", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await fake.removePoll(a);
    const b = await addPoll(fake, "B");
    expect(b).toBeGreaterThan(a);
  });

  it("the 17th poll is a validation error on field polls", async () => {
    const { fake } = await setup();
    for (let i = 1; i <= 16; i += 1) await addPoll(fake, `Poll ${i}`);
    await expect(addPoll(fake, "Poll 17")).rejects.toMatchObject({
      code: "validation",
      field: "polls",
      message: "A connection can have at most 16 polls.",
    });
  });

  it("rejects a bad or duplicate name with field name", async () => {
    const { fake } = await setup();
    await addPoll(fake, "Tank");
    await expect(addPoll(fake, "tank")).rejects.toMatchObject({
      code: "validation",
      field: "name",
      message: 'A poll named "tank" already exists on this connection.',
    });
    await expect(addPoll(fake, " x")).rejects.toMatchObject({ code: "validation", field: "name" });
    await expect(addPoll(fake, "")).rejects.toMatchObject({ code: "validation", field: "name" });
  });

  it("duplicatePoll inserts the copy right after the source", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await addPoll(fake, "B");
    const copy = await fake.duplicatePoll(a);
    expect(fake.pollIds().map((id) => fake.pollSummary(id).config.name)).toEqual([
      "A",
      "A copy",
      "B",
    ]);
    // the run intent of a copy is "Start polling when connected" (BE-002 Q-BE2-02)
    expect(fake.pollSummary(copy).config.active).toBe(true);
    const again = await fake.duplicatePoll(a);
    expect(fake.pollSummary(again).config.name).toBe("A copy 2");
  });

  it("duplicate of a closed poll opens in the workspace; of a native poll in its own window", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    const nativeCopy = await fake.duplicatePoll(a);
    expect(fake.pollSummary(nativeCopy).host).toBe("native");
    await fake.closePollView(a, true);
    const closedCopy = await fake.duplicatePoll(a);
    expect(fake.pollSummary(closedCopy)).toMatchObject({ host: "workspace", open: true });
  });

  it("renamePoll validates and informs the view", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await addPoll(fake, "B");
    const { events } = await attach(fake, a);
    await fake.renamePoll(a, "Tank 1");
    expect(events.at(-1)).toMatchObject({ type: "PollConfigChanged", name: "Tank 1", pollId: a });
    await expect(fake.renamePoll(a, "b")).rejects.toMatchObject({
      code: "validation",
      field: "name",
    });
    // its own name in another case is fine
    await expect(fake.renamePoll(a, "TANK 1")).resolves.toBeUndefined();
  });

  it("removePoll tells the view and W1", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    const { events } = await attach(fake, a);
    await fake.removePoll(a);
    expect(types(events)).toContain("PollRemoved");
    expect(fake.pollIds()).toEqual([]);
    expect(fake.attachedViews()).toEqual([]);
    expect(session.at(-1)).toMatchObject({ type: "PollListChanged", polls: [] });
    await expect(fake.removePoll(a)).rejects.toMatchObject({ code: "pollNotFound" });
  });

  it("reorderPolls accepts a permutation and emits PollListChanged in the new order", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B");
    const c = await addPoll(fake, "C");
    await fake.reorderPolls([b, c, a]);
    expect(fake.pollIds()).toEqual([b, c, a]);
    const last = session.at(-1);
    expect(last?.type === "PollListChanged" && last.polls.map((p) => p.config.name)).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  it.each([
    ["too few", (ids: number[]) => ids.slice(1)],
    ["too many", (ids: number[]) => [...ids, 999]],
    ["duplicates", (ids: number[]) => [ids[0] as number, ids[0] as number, ids[2] as number]],
    ["unknown id", (ids: number[]) => [ids[0] as number, ids[1] as number, 999]],
  ])("reorderPolls rejects %s with field order", async (_name, make) => {
    const { fake } = await setup();
    const ids = [await addPoll(fake, "A"), await addPoll(fake, "B"), await addPoll(fake, "C")];
    await expect(fake.reorderPolls(make(ids))).rejects.toMatchObject({
      code: "validation",
      field: "order",
    });
    expect(fake.pollIds()).toEqual(ids);
  });

  it("an unknown poll id is pollNotFound", async () => {
    const { fake } = await setup();
    await expect(fake.renamePoll(42, "x")).rejects.toMatchObject({ code: "pollNotFound" });
    await expect(fake.attachPollView(42, "workspace", () => {})).rejects.toMatchObject({
      code: "pollNotFound",
    });
  });
});

describe("setPollView, aliases and updatePoll", () => {
  const view = (pollId: PollId, fake: FakeModbusMasterIpc, patch = {}) => {
    const c = fake.pollSummary(pollId).config;
    return {
      display: c.display,
      scale: c.scale,
      scaleOverrides: c.scaleOverrides,
      valueColumns: c.valueColumns,
      aliases: c.aliases,
      hasUnappliedEdits: false,
      ...patch,
    };
  };

  it("stores display, aliases and the unapplied flag and tells the view", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    const { events } = await attach(fake, a);
    await fake.setPollView(
      a,
      view(a, fake, {
        aliases: [{ address: 0, alias: "Tank top" }],
        hasUnappliedEdits: true,
        valueColumns: "both",
      }),
    );
    expect(fake.pollSummary(a)).toMatchObject({
      hasUnappliedEdits: true,
      config: { valueColumns: "both", aliases: [{ address: 0, alias: "Tank top" }] },
    });
    expect(events.at(-1)).toMatchObject({ type: "PollConfigChanged" });
  });

  it.each([
    ["too long", [{ address: 0, alias: "x".repeat(33) }], "Alias must be at most 32 characters."],
    ["leading space", [{ address: 0, alias: " a" }], "Alias cannot start or end with a space."],
    ["control char", [{ address: 0, alias: "a\tb" }], "Alias cannot contain control characters."],
    [
      "duplicate address",
      [
        { address: 1, alias: "a" },
        { address: 1, alias: "b" },
      ],
      "Invalid alias address 1.",
    ],
  ])("rejects an invalid alias list: %s", async (_name, aliases, message) => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await expect(fake.setPollView(a, view(a, fake, { aliases }))).rejects.toMatchObject({
      code: "validation",
      field: "aliases",
      message,
    });
  });

  it("rejects more than 2000 aliases", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    const aliases = Array.from({ length: 2001 }, (_, i) => ({ address: i, alias: `a${i}` }));
    await expect(fake.setPollView(a, view(a, fake, { aliases }))).rejects.toMatchObject({
      field: "aliases",
      message: "A poll can have at most 2000 aliases.",
    });
  });

  describe("scale and override shape checks (as check_scale and check_scale_overrides in Rust)", () => {
    const good = {
      preset: "current4to20" as const,
      rawSigned: false,
      xMin: 0,
      xMax: 65535,
      yMin: 4,
      yMax: 20,
      divisor: 10,
      decimals: 2,
      unit: "mA",
      outOfRange: "flag" as const,
    };
    const override = (start: number, end: number, scale = good) => ({ start, end, scale });
    const rejected = async (patch: object, field: string, message: string) => {
      const { fake } = await setup();
      const a = await addPoll(fake, "A");
      const before = JSON.stringify(fake.pollSummary(a).config);
      await expect(fake.setPollView(a, view(a, fake, patch))).rejects.toMatchObject({
        code: "validation",
        field,
        message,
      });
      // nothing was stored
      expect(JSON.stringify(fake.pollSummary(a).config)).toBe(before);
    };

    it("accepts a valid scale, a null scale and the edges", async () => {
      const { fake } = await setup();
      const a = await addPoll(fake, "A");
      await fake.setPollView(
        a,
        view(a, fake, {
          scale: { ...good, xMin: -32768, xMax: 65535, decimals: 6, unit: "x".repeat(16) },
          scaleOverrides: Array.from({ length: 64 }, (_, i) => override(i, i)),
        }),
      );
      expect(fake.pollSummary(a).config.scaleOverrides).toHaveLength(64);
      await fake.setPollView(a, view(a, fake, { scale: null, scaleOverrides: [override(3, 3)] }));
      expect(fake.pollSummary(a).config.scale).toBeNull();
    });

    it.each([
      ["xMin below", { xMin: -32769 }, "Raw min and max must be from -32768 to 65535."],
      ["xMax above", { xMax: 65536 }, "Raw min and max must be from -32768 to 65535."],
      ["a fractional raw limit", { xMin: 1.5 }, "Raw min and max must be from -32768 to 65535."],
      ["yMax not finite", { yMax: Number.POSITIVE_INFINITY }, "Scale numbers must be finite."],
      ["divisor NaN", { divisor: Number.NaN }, "Scale numbers must be finite."],
      ["decimals 7", { decimals: 7 }, "Decimals must be a whole number from 0 to 6."],
      ["decimals -1", { decimals: -1 }, "Decimals must be a whole number from 0 to 6."],
      ["a 17 character unit", { unit: "x".repeat(17) }, "Unit must be at most 16 characters."],
      ["a control character", { unit: "m	A" }, "Unit cannot contain control characters."],
    ])("rejects a scale with %s (field scale)", async (_name, patch, message) => {
      await rejected({ scale: { ...good, ...patch } }, "scale", message);
    });

    it("rejects an override list with more than 64 entries", async () => {
      await rejected(
        { scaleOverrides: Array.from({ length: 65 }, (_, i) => override(i, i)) },
        "scaleOverrides",
        "A poll can have at most 64 scale overrides.",
      );
    });

    it("rejects an override whose end is before its start", async () => {
      await rejected(
        { scaleOverrides: [override(5, 4)] },
        "scaleOverrides",
        "Scale override 5-4: the end address must not be before the start address.",
      );
    });

    it("rejects an invalid scale inside an override, naming the range", async () => {
      await rejected(
        { scaleOverrides: [override(2, 3, { ...good, decimals: 9 })] },
        "scaleOverrides",
        "Scale override 2-3: Decimals must be a whole number from 0 to 6.",
      );
    });

    it("rejects an address base other than 0 or 1", async () => {
      const { fake } = await setup();
      const a = await addPoll(fake, "A");
      await expect(
        fake.setPollView(
          a,
          view(a, fake, { display: { ...fake.pollSummary(a).config.display, addressBase: 2 } }),
        ),
      ).rejects.toMatchObject({ code: "validation", field: "display" });
    });

    it("addPoll checks them too", async () => {
      const { fake } = await setup();
      await expect(
        fake.addPoll(
          pollConfigInput({ name: "B", definition: def(), scale: { ...good, decimals: 7 } }),
          "workspace",
        ),
      ).rejects.toMatchObject({ code: "validation", field: "scale" });
    });
  });

  it("PT6: updatePoll on a running poll restarts it and drops old values", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    const { events, snapshot } = await attach(fake, a);
    expect(snapshot.poll.status.state).toBe("polling");
    fake.advance(300);
    expect(types(events)).toContain("PollUpdate");
    events.length = 0;
    await fake.updatePoll(a, def({ quantity: 20 }));
    expect(events.map((e) => e.type)).toEqual(["PollStateChanged", "PollConfigChanged"]);
    fake.advance(100);
    const update = events.find((e) => e.type === "PollUpdate");
    expect(update?.type === "PollUpdate" && update.values).toHaveLength(20);
    const late = await attach(fake, a);
    expect(late.snapshot.lastUpdate?.values).toHaveLength(20);
  });

  it("PT6b: updatePoll on a paused poll keeps the state and clears the values", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A", { active: false });
    fake.advance(300);
    expect(fake.pollSummary(a).status.state).toBe("paused");
    await fake.updatePoll(a, def({ startAddress: 5 }));
    expect(fake.pollSummary(a).status.state).toBe("paused");
    const { snapshot } = await attach(fake, a);
    expect(snapshot.lastUpdate).toBeNull();
    expect(snapshot.poll.config.definition.startAddress).toBe(5);
  });
});

describe("connection lifecycle in virtual time (C1-C7, PT0-PT8)", () => {
  it("C1, C2: connect brings every active poll to polling and the others to paused", async () => {
    const { fake, session } = await setup({ mode: "virtual" });
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B", { active: false });
    expect(fake.pollSummary(a).status.state).toBe("offline");
    await fake.connect(tcp);
    expect(session.filter((e) => e.type === "ConnectionStateChanged").map((e) => e.state)).toEqual([
      "connecting",
      "connected",
    ]);
    expect(fake.pollSummary(a).status.state).toBe("polling");
    expect(fake.pollSummary(b).status.state).toBe("paused");
  });

  it("with Start polling when connected off, every poll comes up paused (active unchanged)", async () => {
    const { fake } = await setup({ mode: "virtual" });
    const a = await addPoll(fake, "A");
    await fake.setAutoStartPoll(false);
    await fake.connect(tcp);
    expect(fake.pollSummary(a)).toMatchObject({
      status: { state: "paused" },
      config: { active: true },
    });
  });

  it("a poll added while connected starts per active and autoStart (PT0)", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B", { active: false });
    expect(fake.pollSummary(a).status.state).toBe("polling");
    expect(fake.pollSummary(b).status.state).toBe("paused");
  });

  it("PT3, PT4: setPollActive and setAllPollsActive resume and pause", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B");
    await fake.setPollActive(a, false);
    expect(fake.pollSummary(a)).toMatchObject({
      status: { state: "paused" },
      config: { active: false },
    });
    expect(fake.pollSummary(b).status.state).toBe("polling");
    await fake.setAllPollsActive(false);
    expect(fake.pollSummary(b).status.state).toBe("paused");
    await fake.setAllPollsActive(true);
    expect(fake.pollSummary(a).status.state).toBe("polling");
    expect(fake.pollSummary(b).status.state).toBe("polling");
  });

  it("C3: a scripted connect failure ends in disconnected with the reason", async () => {
    const { fake, session } = await setup({ mode: "virtual" });
    const a = await addPoll(fake, "A");
    const reason = sessionReason("refused", "refused");
    fake.scriptConnectFailure(reason);
    await fake.connect(tcp);
    const last = session.filter((e) => e.type === "ConnectionStateChanged").at(-1);
    expect(last).toMatchObject({ state: "disconnected", reason });
    expect(fake.pollSummary(a).status.state).toBe("offline");
  });

  it("C4: cancelConnect returns to idle while connecting", async () => {
    const { fake } = await setup({ mode: "virtual", connectDelayMs: 500 });
    await fake.connect(tcp);
    expect(fake.connection().state).toBe("connecting");
    await fake.cancelConnect();
    expect(fake.connection().state).toBe("idle");
    fake.advance(1000);
    expect(fake.connection().state).toBe("idle");
  });

  it("a connect delay runs in virtual time", async () => {
    const { fake } = await setup({ mode: "virtual", connectDelayMs: 200 });
    await fake.connect(tcp);
    expect(fake.connection().state).toBe("connecting");
    fake.advance(199);
    expect(fake.connection().state).toBe("connecting");
    fake.advance(1);
    expect(fake.connection().state).toBe("connected");
  });

  it("C5: disconnect takes every poll offline; values stay until the dismiss is not needed (idle)", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    fake.advance(300);
    await fake.disconnect();
    expect(fake.connection().state).toBe("idle");
    expect(fake.pollSummary(a).status.state).toBe("offline");
  });

  it("C6, C7: link lost keeps the last values as stale, Dismiss clears them", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    fake.advance(300);
    fake.dropLink(sessionReason("closedByPeer", "closed", "linkLost"));
    expect(fake.connection()).toMatchObject({ state: "disconnected" });
    expect(fake.pollSummary(a).status.state).toBe("offline");
    expect((await attach(fake, a)).snapshot.lastUpdate).not.toBeNull();
    await fake.disconnect(); // C7 dismiss
    expect(fake.connection().state).toBe("idle");
    expect((await attach(fake, a)).snapshot.lastUpdate).toBeNull();
  });

  it("reconnect after a link loss resumes the polls with active", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    fake.dropLink();
    await fake.connect(tcp);
    expect(fake.pollSummary(a).status.state).toBe("polling");
  });

  it("the view channel gets the connection transitions too", async () => {
    const { fake } = await setup({ mode: "virtual" });
    const a = await addPoll(fake, "A");
    const { events } = await attach(fake, a);
    await fake.connect(tcp);
    expect(events.filter((e) => e.type === "ConnectionStateChanged").map((e) => e.state)).toEqual([
      "connecting",
      "connected",
    ]);
  });

  it("queued writes fail with notConnected when the link goes down; writes while down too", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const pending = fake.write({ slaveId: 1, function: 6, address: 0, values: [1] }, null);
    fake.dropLink();
    await expect(pending).resolves.toEqual({ status: "notConnected" });
    await expect(
      fake.write({ slaveId: 1, function: 6, address: 0, values: [1] }, null),
    ).resolves.toEqual({
      status: "notConnected",
    });
  });
});

describe("scheduler in the fake (DES-002 section 7)", () => {
  async function eight() {
    const ctx = await setup({ mode: "virtual", startTime: 1_000_000 });
    await ctx.fake.connect(tcp);
    const ids: PollId[] = [];
    for (let i = 1; i <= 8; i += 1) ids.push(await addPoll(ctx.fake, `Poll ${i}`));
    return { ...ctx, ids };
  }

  it("never has two requests in flight", async () => {
    const { fake } = await eight();
    fake.advance(10_000);
    const log = fake.requestLog;
    expect(log.length).toBeGreaterThan(300);
    for (let i = 1; i < log.length; i += 1) {
      expect(log[i]?.start).toBeGreaterThanOrEqual(log[i - 1]?.end ?? 0);
    }
  });

  it("every poll is served (no starvation) with 16 polls at 20 ms", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const ids: PollId[] = [];
    for (let i = 1; i <= 16; i += 1) {
      ids.push(await addPoll(fake, `Poll ${i}`, { definition: def({ scanRateMs: 20 }) }));
    }
    fake.advance(10_000);
    const counts = ids.map((id) => fake.requestLog.filter((r) => r.pollId === id).length);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("a write goes before the next poll request", async () => {
    const { fake } = await eight();
    fake.advance(1);
    const write = fake.write({ slaveId: 1, function: 6, address: 40, values: [7] }, 1);
    fake.advance(100);
    await expect(write).resolves.toEqual({ status: "ok" });
    const log = fake.requestLog;
    const w = log.findIndex((r) => r.kind === "write");
    expect(w).toBeGreaterThan(0);
    // it follows the request that was in flight and precedes the next poll request
    expect(log[w]?.start).toBe(log[w - 1]?.end);
    expect(log[w + 1]?.kind).toBe("poll");
    expect(log[w + 1]?.start).toBe(log[w]?.end);
  });

  it("writes keep their FIFO order", async () => {
    const { fake } = await eight();
    const order: number[] = [];
    const pending = [1, 2, 3].map((address) =>
      fake
        .write({ slaveId: 1, function: 6, address, values: [address] }, null)
        .then(() => order.push(address)),
    );
    fake.advance(200);
    await Promise.all(pending);
    expect(order).toEqual([1, 2, 3]);
    const writes = fake.requestLog.filter((r) => r.kind === "write");
    expect(writes).toHaveLength(3);
    // back to back, before any poll request that was not already running
    expect(writes[1]?.start).toBe(writes[0]?.end);
    expect(writes[2]?.start).toBe(writes[1]?.end);
  });

  it("a timeout stays with its poll; the others keep running", async () => {
    const { fake, ids } = await eight();
    const [p1, p2] = ids as [number, number];
    fake.scriptFault(p2, { kind: "timeout" });
    fake.advance(6000);
    expect(fake.pollSummary(p2).status.state).toBe("timeout");
    expect(fake.pollSummary(p2).status.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(fake.pollSummary(p2).counters.counters.timeouts).toBeGreaterThanOrEqual(2);
    expect(fake.pollSummary(p1).status.state).toBe("polling");
    expect(fake.pollSummary(p1).counters.counters.timeouts).toBe(0);
    expect(fake.pollSummary(p1).counters.counters.responses).toBeGreaterThan(3);
    expect(fake.connection().state).toBe("connected");
    // when the fault stops, the poll recovers
    fake.scriptFault(p2, null);
    fake.advance(3000);
    expect(fake.pollSummary(p2).status.state).toBe("polling");
    expect(fake.pollSummary(p2).status.consecutiveFailures).toBe(0);
  });

  it("an exception reply is counted as response and error and keeps the code", async () => {
    const { fake, ids } = await eight();
    const p6 = ids[5] as number;
    fake.scriptFault(p6, { kind: "exception", code: 2 });
    fake.advance(1000);
    expect(fake.pollSummary(p6)).toMatchObject({
      status: { state: "exception", exceptionCode: 2 },
    });
    const { responses, errors } = fake.pollSummary(p6).counters.counters;
    expect(responses).toBeGreaterThan(0);
    expect(errors).toBe(responses);
  });

  it("a bad response keeps its kind and detail", async () => {
    const { fake, ids } = await eight();
    const p = ids[1] as number;
    const detail = { expected: 29, got: 20, message: "short" };
    fake.scriptFault(p, { kind: "badResponse", badKind: "shortFrame", detail });
    fake.advance(1000);
    expect(fake.pollSummary(p).status).toMatchObject({
      state: "badResponse",
      badResponseKind: "shortFrame",
      badResponseDetail: detail,
    });
  });

  it("a slave fault hits every poll of that slave; times limits it", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A", { definition: def({ slaveId: 2 }) });
    const b = await addPoll(fake, "B", { definition: def({ slaveId: 2 }) });
    const c = await addPoll(fake, "C", { definition: def({ slaveId: 1 }) });
    fake.scriptSlaveFault(2, { kind: "timeout" }, 2);
    fake.advance(2000);
    expect(fake.pollSummary(a).counters.counters.timeouts).toBe(1);
    expect(fake.pollSummary(b).counters.counters.timeouts).toBe(1);
    expect(fake.pollSummary(c).counters.counters.timeouts).toBe(0);
    fake.advance(3000);
    expect(fake.pollSummary(a).status.state).toBe("polling");
  });

  it("paused polls are not served", async () => {
    const { fake } = await eight();
    const p = (await fake.snapshot().polls)[2]?.config.pollId as number;
    await fake.setPollActive(p, false);
    const before = fake.requestLog.filter((r) => r.pollId === p).length;
    fake.advance(2000);
    expect(fake.requestLog.filter((r) => r.pollId === p).length).toBe(before);
  });

  it("the list order does not change how often a poll is served", async () => {
    const { fake, ids } = await eight();
    fake.advance(5000);
    const before = ids.map((id) => fake.requestLog.filter((r) => r.pollId === id).length);
    await fake.reorderPolls([...ids].reverse());
    fake.advance(5000);
    const after = ids.map((id) => fake.requestLog.filter((r) => r.pollId === id).length);
    for (const [i, n] of after.entries()) {
      expect(n - (before[i] as number)).toBeGreaterThanOrEqual(45);
      expect(n - (before[i] as number)).toBeLessThanOrEqual(55);
    }
  });

  it("the totals count every poll request and every write once", async () => {
    const { fake, ids } = await eight();
    fake.advance(1000);
    void fake.write({ slaveId: 1, function: 6, address: 1, values: [1] }, null);
    fake.advance(1000);
    const snap = fake.snapshot();
    const sum = ids.reduce((n, id) => n + fake.pollSummary(id).counters.counters.requests, 0);
    expect(snap.counters.total.requests).toBe(sum + snap.counters.writes.requests);
    expect(snap.counters.writes.requests).toBe(1);
  });

  it("resetCounters(pollId) resets that poll only (the totals keep counting); null resets everything", async () => {
    const { fake, ids } = await eight();
    fake.advance(1000);
    const p = ids[0] as number;
    const total = fake.snapshot().counters.total.requests;
    await fake.resetCounters(p);
    expect(fake.pollSummary(p).counters.counters.requests).toBe(0);
    expect(fake.snapshot().counters.total.requests).toBe(total);
    expect(fake.pollSummary(ids[1] as number).counters.counters.requests).toBeGreaterThan(0);
    await fake.resetCounters(null);
    expect(fake.snapshot().counters.total.requests).toBe(0);
    expect(fake.pollSummary(ids[3] as number).counters.counters.requests).toBe(0);
  });

  it("emits traffic frames tagged with their origin, and counters with the link load", async () => {
    const { fake, session } = await eight();
    fake.advance(500);
    const frames = session.flatMap((e) => (e.type === "TrafficFrames" ? e.frames : []));
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.every((f) => f.origin?.kind === "poll")).toBe(true);
    const counters = session.filter((e) => e.type === "Counters").at(-1);
    expect(counters?.type === "Counters" && counters.linkLoadPct).toBeGreaterThan(0);
  });

  it("a saturated link reports the effective scan rate of the poll", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const ids: PollId[] = [];
    for (let i = 1; i <= 16; i += 1) {
      ids.push(await addPoll(fake, `Poll ${i}`, { definition: def({ scanRateMs: 20 }) }));
    }
    fake.advance(5000);
    const summary = fake.pollSummary(ids[0] as number);
    expect(summary.counters.effectiveScanMs).toBeGreaterThan(30);
    const quiet = await setup({ mode: "virtual" });
    await quiet.fake.connect(tcp);
    const only = await addPoll(quiet.fake, "A");
    quiet.fake.advance(2000);
    // The raw mean is reported; the UI shows it only above 1.5 x the scan rate.
    expect(quiet.fake.pollSummary(only).counters.effectiveScanMs).toBe(100);
  });

  it("an RTU write to slave 0 is a broadcast; on TCP it is a normal write", async () => {
    const tcpCtx = await setup({ mode: "virtual" });
    await tcpCtx.fake.connect(tcp);
    const tcpWrite = tcpCtx.fake.write({ slaveId: 0, function: 6, address: 0, values: [1] }, null);
    tcpCtx.fake.advance(100);
    await expect(tcpWrite).resolves.toEqual({ status: "ok" });
    const rtuCtx = await setup({ mode: "virtual" });
    await rtuCtx.fake.connect(rtu);
    const rtuWrite = rtuCtx.fake.write({ slaveId: 0, function: 6, address: 0, values: [1] }, null);
    rtuCtx.fake.advance(100);
    await expect(rtuWrite).resolves.toEqual({ status: "broadcastSent" });
  });
});

describe("manual mode", () => {
  it("nothing happens by itself: connect only records, writes answer at once", async () => {
    const { fake, session } = await setup();
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    fake.advance(10_000);
    expect(fake.connection().state).toBe("idle");
    expect(fake.pollSummary(a).status.state).toBe("offline");
    expect(session.filter((e) => e.type === "ConnectionStateChanged")).toEqual([]);
    await expect(
      fake.write({ slaveId: 1, function: 6, address: 0, values: [1] }, a),
    ).resolves.toEqual({
      status: "ok",
    });
    await fake.connect(rtu);
    await expect(
      fake.write({ slaveId: 0, function: 6, address: 0, values: [1] }, a),
    ).resolves.toEqual({
      status: "broadcastSent",
    });
  });

  it("raw emit helpers update the model and reach the right channels", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B");
    const viewA = await attach(fake, a);
    const viewB = await attach(fake, b);
    fake.emitConnectionState("connected");
    fake.emitPollState(a, "polling");
    fake.emitPollState(b, "exception", { exceptionCode: 2 });
    fake.emitPollUpdate(a, { values: [1, 2, 3] });
    expect(fake.connection().state).toBe("connected");
    expect(fake.pollSummary(b)).toMatchObject({ status: { state: "exception", exceptionCode: 2 } });
    expect(types(viewA.events)).toEqual([
      "ConnectionStateChanged",
      "PollStateChanged",
      "PollUpdate",
    ]);
    expect(types(viewB.events)).toEqual(["ConnectionStateChanged", "PollStateChanged"]);
    // the session channel gets every poll's state change but not the updates
    expect(types(session).filter((t) => t === "PollStateChanged")).toHaveLength(2);
    expect(types(session)).not.toContain("PollUpdate");
  });
});

describe("poll views: routing and tokens", () => {
  it("two views on two polls receive only their own updates and state changes", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B");
    const viewA = await attach(fake, a);
    const viewB = await attach(fake, b);
    fake.scriptFault(b, { kind: "timeout" });
    fake.advance(3000);
    const own = (events: PollViewEvent[], id: number) =>
      events.every((e) => !("pollId" in e) || e.pollId === id);
    expect(own(viewA.events, a)).toBe(true);
    expect(own(viewB.events, b)).toBe(true);
    expect(types(viewA.events)).toContain("PollUpdate");
    expect(types(viewB.events)).not.toContain("PollUpdate");
    expect(viewB.events.some((e) => e.type === "PollStateChanged" && e.state === "timeout")).toBe(
      true,
    );
    expect(viewA.events.some((e) => e.type === "PollStateChanged" && e.state === "timeout")).toBe(
      false,
    );
  });

  it("the snapshot carries the token, the host, the poll and the last update", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    fake.advance(300);
    const { snapshot } = await attach(fake, a);
    expect(snapshot).toMatchObject({
      host: "workspace",
      connection: { state: "connected" },
      poll: { config: { name: "A" }, status: { state: "polling" } },
      handoff: null,
    });
    expect(snapshot.viewToken).toBeGreaterThan(0);
    expect(snapshot.lastUpdate?.values).toHaveLength(10);
  });

  it("a second view for the same poll replaces the first with ViewDetached replaced", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    const first = await attach(fake, a);
    const second = await attach(fake, a);
    expect(first.events).toEqual([{ type: "ViewDetached", pollId: a, reason: "replaced" }]);
    expect(second.snapshot.viewToken).not.toBe(first.snapshot.viewToken);
    expect(fake.attachedViews()).toEqual([
      { pollId: a, token: second.snapshot.viewToken, host: "workspace" },
    ]);
  });

  it("a late detach with the old token leaves the new view attached", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    const first = await attach(fake, a);
    const second = await attach(fake, a);
    await fake.detachPollView(a, first.snapshot.viewToken);
    expect(fake.attachedViews().map((v) => v.token)).toEqual([second.snapshot.viewToken]);
    fake.emitPollState(a, "paused");
    expect(types(second.events)).toContain("PollStateChanged");
    await fake.detachPollView(a, second.snapshot.viewToken);
    expect(fake.attachedViews()).toEqual([]);
  });

  it("attaching to a closed poll or with the wrong host rejects with validation, field host", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await expect(fake.attachPollView(a, "native", () => {})).rejects.toMatchObject({
      code: "validation",
      field: "host",
    });
    await fake.closePollView(a, true);
    await expect(fake.attachPollView(a, "workspace", () => {})).rejects.toMatchObject({
      code: "validation",
      field: "host",
    });
    expect(fake.attachedViews()).toEqual([]);
  });

  it("a held attach lets events arrive before the snapshot, and a failed attach leaves no view", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    const events: PollViewEvent[] = [];
    const held = fake.hold("attachPollView");
    const pending = fake.attachPollView(a, "workspace", (e) => events.push(e));
    fake.emitPollState(a, "paused");
    expect(types(events)).toEqual(["PollStateChanged"]);
    held.fail("slow and then gone");
    await expect(pending).rejects.toThrow("slow and then gone");
    expect(fake.attachedViews()).toEqual([]);
    fake.failNext("attachPollView", "boom");
    await expect(attach(fake, a)).rejects.toThrow("boom");
    expect(fake.attachedViews()).toEqual([]);
  });

  it("setCompactMode, setAskOnPollClose reach W1 and every view", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    const view = await attach(fake, a);
    await fake.setCompactMode(true);
    await fake.setAskOnPollClose(false);
    const expected = [
      { type: "PrefsChanged", askOnPollClose: true, compact: true },
      { type: "PrefsChanged", askOnPollClose: false, compact: true },
    ];
    expect(view.events).toEqual(expected);
    expect(session.filter((e) => e.type === "PrefsChanged")).toEqual(expected);
    expect(fake.compact).toBe(true);
    expect(fake.askOnPollClose).toBe(false);
    expect((await attach(fake, a)).snapshot).toMatchObject({
      compact: true,
      askOnPollClose: false,
    });
  });

  it("setProfileName reaches the views; requestSave and showTraffic reach W1", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    const view = await attach(fake, a);
    await fake.setProfileName("Boiler");
    await fake.requestSave();
    await fake.showTraffic(a);
    expect(view.events).toEqual([{ type: "ProfileNameChanged", name: "Boiler" }]);
    expect(session.filter((e) => e.type === "SaveRequested")).toHaveLength(1);
    expect(session.at(-1)).toEqual({ type: "ShowTraffic", pollId: a });
    expect(fake.profileName).toBe("Boiler");
  });
});

describe("host model (H1-H17)", () => {
  it("pop out, then attaching native returns the handoff once", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    const sw = await attach(fake, a, "workspace");
    await fake.popOutPoll(
      a,
      { kind: "rect", rect: { x: 50, y: 60, width: 640, height: 368 } },
      '{"v":1}',
    );
    expect(sw.events).toEqual([{ type: "ViewDetached", pollId: a, reason: "poppedOut" }]);
    expect(fake.attachedViews()).toEqual([]);
    expect(fake.pollSummary(a)).toMatchObject({ host: "native", open: true });
    const w2 = await attach(fake, a, "native");
    expect(w2.snapshot.handoff).toBe('{"v":1}');
    const again = await attach(fake, a, "native");
    expect(again.snapshot.handoff).toBeNull();
  });

  it("a handoff older than 10 seconds is dropped", async () => {
    vi.useFakeTimers();
    try {
      const { fake } = await setup();
      const a = await addPoll(fake, "A");
      await fake.popOutPoll(
        a,
        { kind: "rect", rect: { x: 0, y: 0, width: 800, height: 600 } },
        "{}",
      );
      vi.advanceTimersByTime(10_001);
      expect((await attach(fake, a, "native")).snapshot.handoff).toBeNull();
      await fake.dockPoll(a, "{}", false, null);
      await fake.popOutPoll(
        a,
        { kind: "rect", rect: { x: 0, y: 0, width: 800, height: 600 } },
        "{}",
      );
      vi.advanceTimersByTime(9_000);
      expect((await attach(fake, a, "native")).snapshot.handoff).toBe("{}");
    } finally {
      vi.useRealTimers();
    }
  });

  it("attachPollView(workspace) for a native poll rejects with validation, field host", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await expect(fake.attachPollView(a, "workspace", () => {})).rejects.toMatchObject({
      code: "validation",
      field: "host",
    });
  });

  it("pop out takes a native placement from the anchor, at least 480 x 320", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await fake.popOutPoll(
      a,
      { kind: "rect", rect: { x: 50, y: 60, width: 300, height: 200 } },
      null,
    );
    const exported = await fake.exportProfile(undefined, tcp);
    expect(exported.polls[0]?.view.native).toMatchObject({ x: 50, y: 60, width: 480, height: 320 });
  });

  it("pop out of a poll that is not in the workspace is a validation error", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await expect(
      fake.popOutPoll(a, { kind: "rect", rect: { x: 0, y: 0, width: 800, height: 600 } }, null),
    ).rejects.toMatchObject({ field: "host" });
    // nothing changed
    expect(fake.pollSummary(a).host).toBe("native");
  });

  it("a pop out whose window cannot be created: detached and listed as native first, then back in the workspace (REV-004)", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    const sw = await attach(fake, a);
    fake.scriptPopOutFailure("no window");
    await expect(
      fake.popOutPoll(a, { kind: "cursor", grabOffset: { x: 10, y: 10 } }, '{"v":1}'),
    ).rejects.toMatchObject({ code: "internal", message: "no window" });
    expect(types(sw.events)).toEqual(["ViewDetached"]);
    const lists = session.flatMap((e) => (e.type === "PollListChanged" ? [e.polls[0]?.host] : []));
    expect(lists.slice(-2)).toEqual(["native", "workspace"]);
    expect(fake.pollSummary(a)).toMatchObject({ host: "workspace", open: true });
    // The sub-window remounts and gets its handoff back.
    const again = await attach(fake, a, "workspace");
    expect(again.snapshot.handoff).toBe('{"v":1}');
    // The failure was one-shot.
    await fake.popOutPoll(a, { kind: "cursor", grabOffset: { x: 10, y: 10 } }, null);
    expect(fake.pollSummary(a).host).toBe("native");
  });

  it("a pop out anchor must be finite and within 1,000,000 px (validation, field anchor)", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await expect(
      fake.popOutPoll(
        a,
        { kind: "rect", rect: { x: 2_000_000, y: 0, width: 800, height: 600 } },
        null,
      ),
    ).rejects.toMatchObject({ code: "validation", field: "anchor" });
    await expect(
      fake.popOutPoll(a, { kind: "cursor", grabOffset: { x: Number.NaN, y: 0 } }, null),
    ).rejects.toMatchObject({ field: "anchor" });
    expect(fake.pollSummary(a).host).toBe("workspace");
  });

  it("a second dock while the handoff is requested is invalidState; no answer is validation, field handoff", async () => {
    vi.useFakeTimers();
    try {
      const { fake } = await setup({ handoffTimeoutMs: 1000 });
      const a = await addPoll(fake, "A", {}, "native");
      await attach(fake, a, "native");
      const first = fake.dockPoll(a, null, true, null);
      first.catch(() => {});
      await expect(fake.dockPoll(a, null, true, null)).rejects.toMatchObject({
        code: "invalidState",
        message: "This poll is already being docked.",
      });
      vi.advanceTimersByTime(1001);
      await expect(first).rejects.toMatchObject({ code: "validation", field: "handoff" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed pop out changes nothing", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    const sw = await attach(fake, a);
    fake.failNext("popOutPoll", "boom");
    await expect(
      fake.popOutPoll(a, { kind: "cursor", grabOffset: { x: 10, y: 10 } }, "{}"),
    ).rejects.toThrow("boom");
    expect(sw.events).toEqual([]);
    expect(fake.pollSummary(a).host).toBe("workspace");
    expect(fake.attachedViews()).toHaveLength(1);
  });

  it("H5: dock sends ViewDetached docked, RevealPoll to W1 and keeps the workspace rect", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    await fake.setWorkspaceLayout({
      ...fake.snapshot().workspaceLayout,
      items: [{ pollId: a, rect: rect({ x: 100, y: 50 }) }],
    });
    await fake.popOutPoll(a, { kind: "rect", rect: { x: 0, y: 0, width: 800, height: 600 } }, null);
    const w2 = await attach(fake, a, "native");
    await fake.dockPoll(a, '{"d":1}', false, null);
    expect(w2.events.at(-1)).toEqual({ type: "ViewDetached", pollId: a, reason: "docked" });
    expect(fake.pollSummary(a)).toMatchObject({ host: "workspace", open: true });
    const reveal = session.filter((e) => e.type === "RevealPoll").at(-1);
    expect(reveal).toMatchObject({
      type: "RevealPoll",
      pollId: a,
      workspaceRect: { x: 100, y: 50 },
    });
    expect((await attach(fake, a, "workspace")).snapshot.handoff).toBe('{"d":1}');
  });

  it("dock uses the drop rectangle when given", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await fake.dockPoll(a, null, false, rect({ x: 300, y: 120 }));
    expect(session.filter((e) => e.type === "RevealPoll").at(-1)).toMatchObject({
      workspaceRect: { x: 300, y: 120 },
    });
  });

  it("dock of a poll in the workspace is a validation error", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await expect(fake.dockPoll(a, null, false, null)).rejects.toMatchObject({ field: "host" });
  });

  it("dock with requestHandoff asks the native window and uses its answer", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    const w2 = await attach(fake, a, "native");
    const docking = fake.dockPoll(a, null, true, null);
    await Promise.resolve();
    expect(w2.events.at(-1)).toEqual({ type: "HandoffRequested", pollId: a });
    await fake.provideHandoff(a, '{"answer":true}');
    await docking;
    expect(fake.pollSummary(a).host).toBe("workspace");
    expect((await attach(fake, a, "workspace")).snapshot.handoff).toBe('{"answer":true}');
  });

  it("dock with requestHandoff is refused when the window answers null (a modal is open)", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await attach(fake, a, "native");
    const docking = fake.dockPoll(a, null, true, null);
    const outcome = expect(docking).rejects.toMatchObject({ code: "validation", field: "handoff" });
    await Promise.resolve();
    await fake.provideHandoff(a, null);
    await outcome;
    expect(fake.pollSummary(a).host).toBe("native");
  });

  it("dock with requestHandoff is refused after 1 s without an answer", async () => {
    vi.useFakeTimers();
    try {
      const { fake } = await setup();
      const a = await addPoll(fake, "A", {}, "native");
      await attach(fake, a, "native");
      const docking = fake.dockPoll(a, null, true, null);
      const outcome = expect(docking).rejects.toMatchObject({ field: "handoff" });
      await vi.advanceTimersByTimeAsync(1001);
      await outcome;
      expect(fake.pollSummary(a).host).toBe("native");
    } finally {
      vi.useRealTimers();
    }
  });

  it("H10: closePollView(keep) closes the view and clears the unapplied flag; the poll keeps running", async () => {
    const { fake } = await setup({ mode: "virtual" });
    await fake.connect(tcp);
    const a = await addPoll(fake, "A");
    const view = await attach(fake, a);
    await fake.setPollView(a, { ...fakeView(fake, a), hasUnappliedEdits: true });
    await fake.closePollView(a, true);
    expect(view.events.at(-1)).toEqual({ type: "ViewDetached", pollId: a, reason: "closed" });
    expect(fake.pollSummary(a)).toMatchObject({
      open: false,
      hasUnappliedEdits: false,
      status: { state: "polling" },
    });
    const before = fake.pollSummary(a).counters.counters.requests;
    fake.advance(1000);
    expect(fake.pollSummary(a).counters.counters.requests).toBeGreaterThan(before);
  });

  it("H11: closePollView(delete) removes the poll", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await fake.closePollView(a, false);
    expect(fake.pollIds()).toEqual([]);
  });

  it("H12: showPoll reopens a closed poll in its last host", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A");
    const b = await addPoll(fake, "B", {}, "native");
    await fake.closePollView(a, true);
    await fake.closePollView(b, true);
    await fake.showPoll(a, null);
    await fake.showPoll(b, null);
    expect(fake.pollSummary(a)).toMatchObject({ host: "workspace", open: true });
    expect(fake.pollSummary(b)).toMatchObject({ host: "native", open: true });
    expect(session.filter((e) => e.type === "RevealPoll").map((e) => e.pollId)).toEqual([a]);
    expect(fake.focused).toEqual([b]);
  });

  it("H13: showPoll on a native poll focuses its window; H14: restores a minimized sub-window", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await fake.showPoll(a, null);
    expect(fake.focused).toEqual([a]);
    const b = await addPoll(fake, "B");
    await fake.setWorkspaceLayout({
      ...fake.snapshot().workspaceLayout,
      items: [{ pollId: b, rect: rect({ state: "minimized" }) }],
      minimizedOrder: [b],
    });
    await fake.showPoll(b, null);
    expect(fake.pollSummary(b).workspace?.state).toBe("normal");
    expect(session.filter((e) => e.type === "RevealPoll").at(-1)).toMatchObject({
      pollId: b,
      workspaceRect: { state: "normal" },
    });
  });

  it("H15: showPoll with a placement puts a closed poll in the workspace at the drop point", async () => {
    const { fake, session } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await fake.closePollView(a, true);
    await fake.showPoll(a, { workspaceRect: rect({ x: 700, y: 20 }) });
    expect(fake.pollSummary(a)).toMatchObject({ host: "workspace", open: true });
    expect(session.filter((e) => e.type === "RevealPoll").at(-1)).toMatchObject({
      workspaceRect: { x: 700, y: 20 },
    });
  });

  it("H15: showPoll with a placement docks a native poll through the handoff request", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    const w2 = await attach(fake, a, "native");
    const showing = fake.showPoll(a, { workspaceRect: rect({ x: 5, y: 6 }) });
    await Promise.resolve();
    expect(w2.events.at(-1)).toEqual({ type: "HandoffRequested", pollId: a });
    await fake.provideHandoff(a, "{}");
    await showing;
    expect(fake.pollSummary(a)).toMatchObject({ host: "workspace", workspace: { x: 5, y: 6 } });
  });

  it("H17: nativePolls lists the open native windows in list order", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await addPoll(fake, "B");
    const c = await addPoll(fake, "C", {}, "native");
    expect(fake.nativePolls()).toEqual([a, c]);
    await fake.closePollView(a, true);
    expect(fake.nativePolls()).toEqual([c]);
  });

  it("showPollWindows focuses every native window", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await addPoll(fake, "B");
    await fake.showPollWindows();
    expect(fake.focused).toEqual([a]);
  });

  it("setWorkspaceLayout stores the rectangles; the snapshot returns them", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A");
    await fake.setWorkspaceLayout({
      ...fake.snapshot().workspaceLayout,
      tileMode: true,
      sidebarWidth: 320,
      items: [{ pollId: a, rect: rect({ x: 40, z: 3 }) }],
    });
    const snap = fake.snapshot();
    expect(snap.workspaceLayout).toMatchObject({ tileMode: true, sidebarWidth: 320 });
    expect(snap.workspaceLayout.items).toEqual([{ pollId: a, rect: rect({ x: 40, z: 3 }) }]);
    expect(snap.polls[0]?.workspace).toMatchObject({ x: 40 });
  });
});

function fakeView(fake: FakeModbusMasterIpc, pollId: PollId) {
  const c = fake.pollSummary(pollId).config;
  return {
    display: c.display,
    scale: c.scale,
    scaleOverrides: c.scaleOverrides,
    valueColumns: c.valueColumns,
    aliases: c.aliases,
    hasUnappliedEdits: false,
  };
}

describe("arrange popped-out windows (DES-002 2.8, NT vectors)", () => {
  async function natives(n: number, monitors = [defaultMonitor()]) {
    const ctx = await setup({ monitors });
    const ids: PollId[] = [];
    for (let i = 1; i <= n; i += 1) ids.push(await addPoll(ctx.fake, `Poll ${i}`, {}, "native"));
    return { ...ctx, ids };
  }
  const placements = async (fake: FakeModbusMasterIpc) =>
    (await fake.exportProfile(undefined, tcp)).polls.map((p) => p.view.native);

  it("NT-1: tile 4 windows on a 1920 x 1032 work area", async () => {
    const { fake } = await natives(4);
    const result = await fake.arrangePollWindows("tile", { kind: "eachMonitor" });
    expect(result).toEqual({ arranged: 4, overflow: 0 });
    expect((await placements(fake)).map((p) => [p?.x, p?.y, p?.width, p?.height])).toEqual([
      [0, 0, 960, 516],
      [960, 0, 960, 516],
      [0, 516, 960, 516],
      [960, 516, 960, 516],
    ]);
  });

  it("NT-3: 13 windows give 12 tiled and 1 overflow", async () => {
    const { fake } = await natives(13);
    expect(await fake.arrangePollWindows("tile", { kind: "eachMonitor" })).toEqual({
      arranged: 12,
      overflow: 1,
    });
  });

  it("side by side, stacked and cascade", async () => {
    const { fake } = await natives(3);
    await fake.arrangePollWindows("sideBySide", { kind: "eachMonitor" });
    expect((await placements(fake)).map((p) => p?.width)).toEqual([640, 640, 640]);
    await fake.arrangePollWindows("stacked", { kind: "eachMonitor" });
    expect((await placements(fake)).map((p) => p?.height)).toEqual([344, 344, 344]);
    await fake.arrangePollWindows("cascade", { kind: "eachMonitor" });
    expect((await placements(fake)).map((p) => [p?.x, p?.y])).toEqual([
      [0, 0],
      [24, 24],
      [48, 48],
    ]);
  });

  it("a single native window fills the work area", async () => {
    const { fake } = await natives(1);
    await fake.arrangePollWindows("tile", { kind: "eachMonitor" });
    expect((await placements(fake))[0]).toMatchObject({ x: 0, y: 0, width: 1920, height: 1032 });
  });

  it("only native windows are arranged, in list order", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {}, "native");
    await addPoll(fake, "B");
    const c = await addPoll(fake, "C", {}, "native");
    await fake.reorderPolls([c, ...fake.pollIds().filter((id) => id !== c)]);
    const result = await fake.arrangePollWindows("tile", { kind: "eachMonitor" });
    expect(result.arranged).toBe(2);
    const exported = await fake.exportProfile(undefined, tcp);
    const byName = Object.fromEntries(exported.polls.map((p) => [p.name, p.view.native]));
    expect(byName.C?.x).toBe(0);
    expect(byName.A?.x).toBe(960);
    expect(a).toBeGreaterThan(0);
  });

  it("no native window: nothing to arrange", async () => {
    const { fake } = await setup();
    await addPoll(fake, "A");
    expect(await fake.arrangePollWindows("tile", { kind: "eachMonitor" })).toEqual({
      arranged: 0,
      overflow: 0,
    });
  });

  it("one chosen display moves every native window there", async () => {
    const second = defaultMonitor({
      id: "monitor-2",
      label: "Display 2",
      primary: false,
      workArea: { x: 1920, y: 0, width: 1920, height: 1032 },
    });
    const { fake } = await natives(4, [defaultMonitor(), second]);
    await fake.arrangePollWindows("tile", { kind: "monitor", monitorId: "monitor-2" });
    const out = await placements(fake);
    expect(out.every((p) => p?.monitor === "monitor-2")).toBe(true);
    expect(out.map((p) => [p?.x, p?.y])).toEqual([
      [1920, 0],
      [2880, 0],
      [1920, 516],
      [2880, 516],
    ]);
  });

  it("a missing display is a validation error on field monitor", async () => {
    const { fake } = await natives(2);
    await expect(
      fake.arrangePollWindows("tile", { kind: "monitor", monitorId: "gone" }),
    ).rejects.toMatchObject({ code: "validation", field: "monitor" });
  });
});

describe("profiles", () => {
  it("export then apply gives an equal export (round trip)", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "A", {
      aliases: [{ address: 0, alias: "PT-201" }],
      valueColumns: "both",
    });
    const b = await addPoll(fake, "B", {}, "native");
    await fake.connect(tcp);
    await fake.setProfileName("Boiler");
    await fake.setCompactMode(true);
    await fake.setWorkspaceLayout({
      ...fake.snapshot().workspaceLayout,
      tileMode: true,
      trafficExpanded: true,
      sidebarWidth: 300,
      items: [{ pollId: a, rect: rect({ x: 40, z: 2, state: "minimized" }) }],
      minimizedOrder: [a],
    });
    await fake.closePollView(b, true);
    await fake.reorderPolls([b, a]);
    const exported = await fake.exportProfile(undefined, tcp);
    expect(exported).toMatchObject({
      schemaVersion: 6,
      name: "Boiler",
      workspace: {
        tileMode: true,
        compact: true,
        trafficExpanded: true,
        sidebarWidth: 300,
        minimizedOrder: [1],
      },
    });
    expect(exported.polls.map((p) => p.name)).toEqual(["B", "A"]);
    expect(exported.polls[0]?.view).toMatchObject({ host: "native", open: false });

    const other = await setup();
    await other.fake.applyProfile(exported);
    expect(await other.fake.exportProfile(undefined, tcp)).toEqual(exported);
  });

  it("apply replaces the polls and closes their views", async () => {
    const { fake } = await setup();
    const a = await addPoll(fake, "Old");
    const view = await attach(fake, a);
    const exported = await fake.exportProfile(undefined, tcp);
    await fake.applyProfile({ ...exported, polls: [] });
    expect(fake.pollIds()).toEqual([]);
    expect(view.events).toEqual([{ type: "ViewDetached", pollId: a, reason: "closed" }]);
  });

  it("profile storage: save, list, get, rename, delete and the errors", async () => {
    const { fake } = await setup();
    const profile: Profile = {
      ...(await fake.exportProfile(undefined, tcp)),
      name: "P1",
      connection: tcp,
    };
    await fake.profilesSave(profile, false);
    await expect(fake.profilesSave(profile, false)).rejects.toMatchObject({
      code: "profileExists",
    });
    await expect(fake.profilesSave(profile, true)).resolves.toBeUndefined();
    expect(
      (await fake.profilesList()).map((p) => [p.name, p.connectionSummary, p.readable]),
    ).toEqual([["P1", "TCP 192.168.1.10:502", true]]);
    expect(await fake.profilesGet("p1")).toMatchObject({ name: "P1", migratedFrom: null });
    await fake.profilesRename("P1", "P2");
    await expect(fake.profilesGet("P1")).rejects.toMatchObject({ code: "profileNotFound" });
    await fake.profilesSave({ ...profile, name: "P3" }, false);
    await expect(fake.profilesRename("P2", "p3")).rejects.toMatchObject({ code: "profileExists" });
    await fake.profilesDelete("P2");
    await expect(fake.profilesDelete("P2")).rejects.toMatchObject({ code: "profileNotFound" });
  });

  it("seedProfiles and RTU summaries", async () => {
    const { fake } = await setup();
    const base = await fake.exportProfile(undefined, tcp);
    fake.seedProfiles([{ ...base, name: "Serial", connection: rtu }]);
    expect((await fake.profilesList())[0]?.connectionSummary).toBe("RTU COM3 9600 8E1");
  });
});

describe("misc facade commands", () => {
  it("listSerialPorts, focusConnectionWindow and the recorded no-ops", async () => {
    const { fake } = await setup();
    expect((await fake.listSerialPorts()).map((p) => p.name)).toEqual(["COM3", "COM4"]);
    await fake.focusConnectionWindow();
    expect(fake.callsOf("focusConnectionWindow")).toHaveLength(1);
  });
});

describe("realtime mode (dev server)", () => {
  it("connects, runs the polls and goes quiet when switched to manual", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeModbusMasterIpc({ simulate: true });
      const events: string[] = [];
      await fake.openSession((e) => events.push(e.type));
      const a = await addPoll(fake, "A");
      await fake.connect(tcp);
      await vi.advanceTimersByTimeAsync(250);
      expect(fake.connection().state).toBe("connected");
      await vi.advanceTimersByTimeAsync(1000);
      expect(fake.pollSummary(a).counters.counters.requests).toBeGreaterThan(5);
      fake.setMode("manual");
      const before = events.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(events).toHaveLength(before);
      fake.reset();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the plain fake can be switched to realtime", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeModbusMasterIpc();
      const states: string[] = [];
      await fake.openSession((e) => {
        if (e.type === "ConnectionStateChanged") states.push(e.state);
      });
      fake.setMode("realtime");
      await fake.connect(tcp);
      await vi.advanceTimersByTimeAsync(250);
      expect(states).toEqual(["connecting", "connected"]);
      fake.reset();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("errors", () => {
  it("toIpcError turns AppError objects, strings and errors into IpcError", () => {
    expect(toIpcError({ code: "validation", message: "bad", field: "name" })).toMatchObject({
      code: "validation",
      message: "bad",
      field: "name",
    });
    expect(toIpcError("plain")).toMatchObject({ message: "plain", code: "unknown", field: null });
    expect(toIpcError(new Error("e"))).toMatchObject({ message: "e" });
    expect(toIpcError(42)).toMatchObject({ message: "Unknown error" });
    const e = new IpcError("same", "io");
    expect(toIpcError(e)).toBe(e);
  });
});

describe("Tauri isolation", () => {
  it("no module outside shared/ipc imports @tauri-apps/api", () => {
    const srcDir = join(import.meta.dirname, "..", "..");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return files(full);
        return /\.(ts|tsx)$/.test(name) ? [full] : [];
      });
    const offenders = files(srcDir)
      .filter((f) => !relative(srcDir, f).replaceAll("\\", "/").startsWith("shared/ipc/"))
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("@tauri-apps/api"))
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });
});
