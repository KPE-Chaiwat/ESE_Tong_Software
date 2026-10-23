// Per-row format overrides in the fake (REQ-009, BE-009 contract): storage, validation messages,
// atomic rejects, copies and the schema 5 migration.
import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
import { type LegacyProfile, legacyFormatOverrides } from "./fake-profile-migration";
import { createFakeModbusMasterIpc, pollConfigInput } from "./modbus-master.fake";
import type {
  ConnectionConfig,
  FormatOverride,
  PollId,
  PollViewEvent,
  Profile,
} from "./modbus-master.types";

const tcp: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const f32 = (start: number, end: number, extra: Partial<FormatOverride> = {}): FormatOverride => ({
  start,
  end,
  format: "float32",
  swapBytes: false,
  reverseWords: false,
  ...extra,
});

async function setup() {
  const ipc = createFakeModbusMasterIpc({ mode: "manual" });
  await ipc.openSession(() => {});
  const id = await ipc.addPoll(pollConfigInput({ name: "A" }), "workspace");
  const events: PollViewEvent[] = [];
  await ipc.attachPollView(id, "workspace", (e) => events.push(e));
  return { ipc, id, events };
}
const rule = (patch: Partial<ValueColorRule> = {}): ValueColorRule => ({
  name: "Flow",
  enabled: true,
  range: null,
  source: "raw",
  comparison: "greaterThan",
  threshold: "10",
  upperThreshold: null,
  highlight: "lime",
  ...patch,
});

describe("format overrides in the fake", () => {
  it("stores a Float32 override, announces it and returns it in the config", async () => {
    const { ipc, id, events } = await setup();
    await ipc.setPollView(id, { formatOverrides: [f32(2, 5)] });
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([f32(2, 5)]);
    const changed = events.filter((e) => e.type === "PollConfigChanged");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ formatOverrides: [f32(2, 5)] });
  });

  it("stores the list sorted by start", async () => {
    const { ipc, id } = await setup();
    await ipc.setPollView(id, {
      formatOverrides: [
        { ...f32(4, 4), format: "hex" },
        { ...f32(0, 1), reverseWords: true },
      ],
    });
    expect(ipc.pollSummary(id).config.formatOverrides.map((o) => o.start)).toEqual([0, 4]);
  });

  it.each([
    [[f32(0, 2)], "Format override 0-2: Float 32-bit needs a multiple of 2 registers."],
    [
      [{ ...f32(0, 3), format: "unsigned64" as const }, f32(5, 5)],
      "Format override 5-5: Float 32-bit needs a multiple of 2 registers.",
    ],
    [
      [{ ...f32(5, 4), format: "hex" as const }],
      "Format override 5-4: the end address must not be before the start address.",
    ],
    [
      [{ ...f32(0, 0), format: "hex" as const, swapBytes: true }],
      "Format override 0-0: byte and word order apply to 32-bit and 64-bit formats only.",
    ],
    [[f32(0, 3), f32(2, 5)], "Format overrides 0-3 and 2-5 overlap."],
    [
      Array.from({ length: 257 }, (_, i) => ({ ...f32(i * 2, i * 2), format: "hex" as const })),
      "A poll can have at most 256 format overrides.",
    ],
  ])("rejects an invalid list with the backend message (%#)", async (formatOverrides, message) => {
    const { ipc, id } = await setup();
    await expect(ipc.setPollView(id, { formatOverrides })).rejects.toMatchObject({
      code: "validation",
      field: "formatOverrides",
      message,
    });
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([]);
  });

  it("rejects a malformed value at the command boundary", async () => {
    const { ipc, id } = await setup();
    for (const bad of [
      null,
      "x",
      [{ start: 0 }],
      [{ ...f32(0, 1), extra: 1 }],
      [{ ...f32(0, 1), format: "nope" }],
    ]) {
      await expect(
        ipc.setPollView(id, { formatOverrides: bad as unknown as FormatOverride[] }),
      ).rejects.toMatchObject({
        field: "formatOverrides",
        message: "Choose a supported format and byte/word order.",
      });
    }
  });

  it("validates the rules against the prospective overrides, atomically", async () => {
    const { ipc, id } = await setup();
    await ipc.setPollView(id, { colorRules: [rule({ threshold: "1.5" })] });
    const u64: FormatOverride = { ...f32(0, 3), format: "unsigned64" };
    // Only the overrides change: the stored rule fails the 64-bit integer syntax.
    await expect(ipc.setPollView(id, { formatOverrides: [u64] })).rejects.toMatchObject({
      field: "colorRules",
      message:
        'Format not applied. Rule "Flow" requires whole-number thresholds for 64-bit integers.',
    });
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([]);
    // Both in one patch: the rules are the ones checked, with their own field path.
    await expect(
      ipc.setPollView(id, { formatOverrides: [u64], colorRules: [rule({ threshold: "1.5" })] }),
    ).rejects.toMatchObject({ field: "colorRules[0].threshold" });
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([]);
    // A fixed rule goes through together with the overrides.
    await ipc.setPollView(id, { formatOverrides: [u64], colorRules: [rule({ threshold: "2" })] });
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([u64]);
    // A range that does not meet the 64-bit override keeps its decimal threshold valid.
    await ipc.setPollView(id, {
      colorRules: [rule({ threshold: "1.5", range: { start: 6, end: 9 } })],
    });
  });

  it("a patch without the key leaves the overrides, and addPoll refuses a bad list", async () => {
    const { ipc, id } = await setup();
    await ipc.setPollView(id, { formatOverrides: [f32(0, 1)] });
    await ipc.setPollView(id, { valueColumns: "raw", aliases: [{ address: 1, alias: "x" }] });
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([f32(0, 1)]);
    await expect(
      ipc.addPoll(pollConfigInput({ name: "B", formatOverrides: [f32(0, 2)] }), "workspace"),
    ).rejects.toMatchObject({ field: "formatOverrides" });
  });

  it("a rejected set leaves the config and sends no event", async () => {
    const { ipc, id, events } = await setup();
    await expect(ipc.setPollView(id, { formatOverrides: [f32(0, 2)] })).rejects.toBeDefined();
    expect(events.filter((e) => e.type === "PollConfigChanged")).toHaveLength(0);
  });

  it("failNext makes the next setPollView reject (dialog state F)", async () => {
    const { ipc, id } = await setup();
    ipc.failNext("setPollView", "The poll is busy.");
    await expect(ipc.setPollView(id, { formatOverrides: [f32(0, 1)] })).rejects.toMatchObject({
      message: "The poll is busy.",
    });
    await ipc.setPollView(id, { formatOverrides: [f32(0, 1)] });
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([f32(0, 1)]);
  });

  it("copies the overrides on duplicate, single and bulk, and on profile export and apply", async () => {
    const { ipc, id } = await setup();
    await ipc.setPollView(id, { formatOverrides: [f32(2, 5, { reverseWords: true })] });
    const copyId = await ipc.duplicatePoll(id);
    expect(ipc.pollSummary(copyId).config.formatOverrides).toEqual([
      f32(2, 5, { reverseWords: true }),
    ]);
    // The bulk copy of a poll nobody has open.
    const quiet = await ipc.addPoll(
      pollConfigInput({ name: "Quiet", formatOverrides: [f32(2, 5, { reverseWords: true })] }),
      "workspace",
    );
    const plan = await ipc.preparePollBulk("duplicate", [quiet]);
    const result = await ipc.duplicatePolls(plan.planToken);
    expect(
      ipc.pollSummary((result.created[0] as { pollId: PollId }).pollId).config.formatOverrides,
    ).toEqual([f32(2, 5, { reverseWords: true })]);
    await ipc.connect(tcp);
    const profile = await ipc.exportProfile("P", null);
    expect(profile.schemaVersion).toBe(6);
    expect(profile.polls[0]?.formatOverrides).toEqual([f32(2, 5, { reverseWords: true })]);
    await ipc.disconnect();
    await ipc.applyProfile(profile);
    const first = ipc.pollIds()[0] as PollId;
    expect(ipc.pollSummary(first).config.formatOverrides).toEqual([
      f32(2, 5, { reverseWords: true }),
    ]);
  });

  it("a format change records no traffic and no request", async () => {
    const { ipc, id } = await setup();
    await ipc.connect(tcp);
    const before = ipc.requestLog.length;
    const frames: string[] = [];
    await ipc.openSession((e) => {
      if (e.type === "TrafficFrames") frames.push(e.type);
    });
    await ipc.setPollView(id, { formatOverrides: [f32(2, 5)] });
    expect(ipc.requestLog).toHaveLength(before);
    expect(frames).toEqual([]);
  });
});

describe("schema 5 migration (BE-009)", () => {
  const legacy = (
    name: string,
    display: Record<string, unknown>,
    start: number,
    quantity: number,
    version = 5,
  ): LegacyProfile =>
    ({
      schemaVersion: version,
      name,
      connection: tcp,
      autoStartPoll: true,
      connectionWindow: null,
      workspace: {
        tileMode: false,
        compact: false,
        sidebarWidth: 280,
        sidebarCollapsed: false,
        trafficExpanded: false,
        trafficHeight: null,
        minimizedOrder: [],
      },
      polls: [
        {
          name: "P",
          definition: { slaveId: 1, function: 3, startAddress: start, quantity, scanRateMs: 100 },
          active: true,
          display: { addressBase: 0, showAlias: true, copyAlias: false, ...display },
          colorRules: [],
          scale: null,
          scaleOverrides: [],
          valueColumns: "raw",
          aliases: [],
          view: { host: "workspace", open: true, workspace: null, native: null },
        },
      ],
      migratedFrom: null,
    }) as unknown as LegacyProfile;

  it("v5 Float32 little-endian, Start 100, Quantity 5 becomes one override 100-105", async () => {
    const ipc = createFakeModbusMasterIpc({ mode: "manual" });
    ipc.seedProfiles([
      legacy("Old", { format: "float32", swapBytes: true, reverseWords: true }, 100, 5),
    ]);
    const profile = (await ipc.profilesGet("Old")) as Profile;
    expect(profile.schemaVersion).toBe(6);
    expect(profile.migratedFrom).toBeNull();
    expect(profile.polls[0]?.formatOverrides).toEqual([
      f32(100, 105, { swapBytes: true, reverseWords: true }),
    ]);
    expect(profile.polls[0]?.display).toEqual({
      addressBase: 0,
      showAlias: true,
      copyAlias: false,
    });
  });

  it("v5 default becomes no override; a v6 profile is untouched", async () => {
    const ipc = createFakeModbusMasterIpc({ mode: "manual" });
    ipc.seedProfiles([
      legacy("Plain", { format: "unsigned", swapBytes: false, reverseWords: false }, 0, 10),
    ]);
    expect(((await ipc.profilesGet("Plain")) as Profile).polls[0]?.formatOverrides).toEqual([]);
    const v6 = legacy("New", {}, 0, 10, 6) as unknown as Profile;
    ipc.seedProfiles([v6]);
    expect(await ipc.profilesGet("New")).toEqual(v6);
  });

  it("follows the BE-009 edge cases", () => {
    expect(legacyFormatOverrides("hex", true, true, 3, 4)).toEqual([
      { start: 3, end: 6, format: "hex", swapBytes: false, reverseWords: false },
    ]);
    expect(legacyFormatOverrides("float64", false, false, 65533, 3)).toEqual([]);
    expect(legacyFormatOverrides("signed64", false, false, 0, 8)).toEqual([
      { start: 0, end: 7, format: "signed64", swapBytes: false, reverseWords: false },
    ]);
    expect(legacyFormatOverrides("float32", false, false, 65534, 2)).toEqual([f32(65534, 65535)]);
    expect(legacyFormatOverrides("float64", false, false, 65530, 5)).toEqual([
      { start: 65530, end: 65533, format: "float64", swapBytes: false, reverseWords: false },
    ]);
  });
});

describe("revision 2 (D-009-04, REV-014 m-2)", () => {
  const HIGH =
    'Format not applied. Rule "High" requires whole-number thresholds for 64-bit integers.';

  it("CHK9-111: a formatOverrides-only patch that breaks a stored 64-bit rule says Format not applied", async () => {
    const { ipc, id } = await setup();
    await ipc.setPollView(id, { colorRules: [rule({ name: "High", threshold: "1.5" })] });
    const u64: FormatOverride = { ...f32(0, 3), format: "unsigned64" };
    let message = "";
    try {
      await ipc.setPollView(id, { formatOverrides: [u64] });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(HIGH);
    expect(message).not.toContain("Interpretation not applied");
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([]);
  });

  it("the other BE-009 messages are unchanged", async () => {
    const { ipc, id } = await setup();
    await expect(ipc.setPollView(id, { formatOverrides: [f32(0, 2)] })).rejects.toMatchObject({
      field: "formatOverrides",
    });
    await expect(
      ipc.setPollView(id, { formatOverrides: [f32(0, 3), f32(2, 5)] }),
    ).rejects.toMatchObject({ field: "formatOverrides" });
    await ipc.setPollView(id, { colorRules: [rule({ threshold: "1.5" })] });
    await expect(
      ipc.setPollView(id, {
        formatOverrides: [{ ...f32(0, 3), format: "unsigned64" }],
        colorRules: [rule({ threshold: "1.5" })],
      }),
    ).rejects.toMatchObject({ field: "colorRules[0].threshold" });
  });

  it("CHK9-114: addPoll without colorRules creates the poll with an empty list", async () => {
    const ipc = createFakeModbusMasterIpc({ mode: "manual" });
    await ipc.openSession(() => {});
    const input = pollConfigInput({ name: "Bare" }) as Partial<ReturnType<typeof pollConfigInput>>;
    delete input.colorRules;
    const id = await ipc.addPoll(input as ReturnType<typeof pollConfigInput>, "workspace");
    expect(ipc.pollSummary(id).config.colorRules).toEqual([]);
    expect(ipc.pollSummary(id).config.formatOverrides).toEqual([]);
  });

  it("CHK9-114: a present but invalid colorRules is still validated", async () => {
    const ipc = createFakeModbusMasterIpc({ mode: "manual" });
    await ipc.openSession(() => {});
    await expect(
      ipc.addPoll(
        pollConfigInput({
          name: "Bad",
          formatOverrides: [{ ...f32(0, 3), format: "unsigned64" }],
          colorRules: [rule({ threshold: "1.5" })],
        }),
        "workspace",
      ),
    ).rejects.toMatchObject({ field: "colorRules[0].threshold" });
  });

  it("failNext with the backend text reaches the caller unchanged", async () => {
    const { ipc, id } = await setup();
    ipc.failNext("setPollView", HIGH);
    await expect(ipc.setPollView(id, { formatOverrides: [f32(0, 1)] })).rejects.toThrow(HIGH);
  });
});
