import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
import { pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import type { FormatOverride, PollConfig } from "@/shared/ipc/modbus-master.types";
import { rowsOfConfig } from "../lib/format-overrides";
import {
  createFormatDialogStore,
  type FormatDialogStatus,
  type FormatDialogStoreApi,
  selectPlan,
  selectWidthAvailability,
} from "./format-dialog.store";

const ov = (
  start: number,
  end: number,
  format: FormatOverride["format"],
  flags: Partial<FormatOverride> = {},
): FormatOverride => ({ start, end, format, swapBytes: false, reverseWords: false, ...flags });
const BS = { swapBytes: true } as const;
const r = (start: number, end = start) => ({ start, end });

const rawRule = (threshold: string, patch: Partial<ValueColorRule> = {}): ValueColorRule => ({
  name: "Flow",
  enabled: true,
  range: null,
  source: "raw",
  comparison: "greaterThan",
  threshold,
  upperThreshold: null,
  highlight: "lime",
  ...patch,
});

let config: PollConfig;
let store: FormatDialogStoreApi;
let sent: FormatOverride[][];
let announced: string[];
let result: { ok: boolean; hold: Promise<void> | null; release: () => void };
let commandError: string | null;

const makeConfig = (patch: Partial<PollConfig> = {}): PollConfig => ({
  ...pollConfigInput({
    name: "Tank",
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
  }),
  pollId: 1,
  active: true,
  ...patch,
});

/** A config for a poll `start`..`start+quantity-1` with these overrides. */
const pollWith = (start: number, quantity: number, overrides: FormatOverride[]) =>
  makeConfig({
    definition: { slaveId: 1, function: 3, startAddress: start, quantity, scanRateMs: 1000 },
    formatOverrides: overrides,
  });

const manyHex = (count: number) =>
  Array.from({ length: count }, (_, i) => ov(1000 + 2 * i, 1000 + 2 * i, "hex"));

beforeEach(() => {
  config = makeConfig();
  sent = [];
  announced = [];
  commandError = null;
  result = { ok: true, hold: null, release: () => {} };
  store = createFormatDialogStore({
    getConfig: () => config,
    getRows: () => rowsOfConfig(config),
    applyFormatOverrides: async (overrides) => {
      sent.push(overrides);
      if (result.hold) await result.hold;
      return result.ok;
    },
    getCommandError: () => commandError,
    announce: (text) => announced.push(text),
  });
});

/** Makes the next IPC call wait until `release()`. */
function holdIpc() {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  result.hold = hold;
  result.release = release;
}

const plan = () => selectPlan(store.getState(), config);

describe("initial state", () => {
  it("is closed with Unsigned checked, no mixed note and nothing pending (no state N)", () => {
    expect(store.getState()).toMatchObject({
      open: false,
      scope: [],
      origin: "grid",
      originAddress: null,
      format: "unsigned",
      order: "big",
      mixed: false,
      pending: false,
      error: null,
    });
  });
});

describe("openFor (DES-009 11.2, 11.3)", () => {
  it("the owner scenario: row 0 of [0-9 S32 BADC] opens as 0-1, Signed 32-bit, BADC, state U, Apply on", () => {
    config = pollWith(0, 10, [ov(0, 9, "signed32", BS)]);
    expect(store.getState().openFor([r(0)], "grid", 0)).toBe(true);
    expect(store.getState()).toMatchObject({
      open: true,
      scope: [r(0, 1)],
      origin: "grid",
      originAddress: 0,
      format: "signed32",
      order: "bigByteSwap",
      mixed: false,
      pending: false,
      error: null,
    });
    expect(plan()).toMatchObject({ status: "U", applyEnabled: true });
  });

  it("widens first, so [0] on [0-9 S32 BS] is S1, not the unwidened S2", () => {
    config = pollWith(0, 10, [ov(0, 9, "signed32", BS)]);
    store.getState().openFor([r(0)], "grid", 0);
    expect(store.getState().format).toBe("signed32");
    expect(plan().plan).toMatchObject({ kind: "ok", unchanged: true, cuts: [] });
  });

  it("a partial group is widened to the whole group (partial-group split at the source)", () => {
    config = pollWith(0, 10, [ov(2, 5, "float32")]);
    store.getState().openFor([r(3), r(4)], "grid", 3);
    expect(store.getState().scope).toEqual([r(2, 5)]);
    expect(store.getState()).toMatchObject({ format: "float32", order: "big", mixed: false });
  });

  it("one format in the scope: that format is checked (state U)", () => {
    config = makeConfig({ formatOverrides: [ov(2, 3, "hex")] });
    expect(store.getState().openFor([r(2, 3)], "grid", 2)).toBe(true);
    expect(store.getState()).toMatchObject({
      open: true,
      scope: [r(2, 3)],
      format: "hex",
      order: "big",
      mixed: false,
    });
    expect(plan().status).toBe("U");
  });

  it("the default format is checked on plain rows, and the order is Big-endian", () => {
    store.getState().openFor([r(0, 3)], "header", 0);
    expect(store.getState()).toMatchObject({ format: "unsigned", order: "big", origin: "header" });
  });

  it("clips the scope to the poll range and merges touching ranges", () => {
    store.getState().openFor([r(8, 20), r(-5, 1), r(2, 3)], "grid", 8);
    expect(store.getState().scope).toEqual([r(0, 3), r(8, 9)]);
  });

  it("does not open for an empty scope, outside the poll, or without a config", () => {
    expect(store.getState().openFor([], "grid", null)).toBe(false);
    expect(store.getState().openFor([r(50, 60)], "grid", 50)).toBe(false);
    expect(store.getState().open).toBe(false);
    const noConfig = createFormatDialogStore({
      getConfig: () => null,
      getRows: () => [],
      applyFormatOverrides: async () => true,
      getCommandError: () => null,
      announce: () => {},
    });
    expect(noConfig.getState().openFor([r(0)], "grid", 0)).toBe(false);
  });

  it("reopening starts from the current formats, not from the last choice", () => {
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("float64");
    store.getState().close();
    store.getState().openFor([r(0, 1)], "showMenu", 1);
    expect(store.getState()).toMatchObject({
      format: "unsigned",
      origin: "showMenu",
      originAddress: 1,
      error: null,
    });
  });

  describe("every S vector through openFor (S2 is the unwidened planner input, see above)", () => {
    interface Case {
      id: string;
      poll: [number, number];
      overrides: FormatOverride[];
      scope: Array<[number, number?]>;
      expected: { format: string; order: string; mixed: boolean; scope: Array<[number, number?]> };
      status: FormatDialogStatus;
      applyEnabled?: boolean;
    }
    const s15 = [
      ...Array.from({ length: 127 }, (_, i) => ov(1000 + 4 * i, 1000 + 4 * i, "hex")),
      ...Array.from({ length: 127 }, (_, i) => ov(1002 + 4 * i, 1002 + 4 * i, "hex")),
      ov(0, 4, "hex"),
      ov(5, 9, "binary"),
    ].sort((a, b) => a.start - b.start);
    const cases: Case[] = [
      {
        id: "S1",
        poll: [0, 10],
        overrides: [ov(0, 9, "signed32", BS)],
        scope: [[0, 1]],
        expected: { format: "signed32", order: "bigByteSwap", mixed: false, scope: [[0, 1]] },
        status: "U",
      },
      {
        id: "S3",
        poll: [0, 10],
        overrides: [],
        scope: [[0]],
        expected: { format: "unsigned", order: "big", mixed: false, scope: [[0]] },
        status: "U",
      },
      {
        id: "S4",
        poll: [0, 10],
        overrides: [],
        scope: [[0, 9]],
        expected: { format: "unsigned", order: "big", mixed: false, scope: [[0, 9]] },
        status: "U",
      },
      {
        id: "S5",
        poll: [0, 10],
        overrides: [ov(2, 5, "float32")],
        scope: [[2, 5]],
        expected: { format: "float32", order: "big", mixed: false, scope: [[2, 5]] },
        status: "U",
      },
      {
        id: "S6",
        poll: [0, 10],
        overrides: [ov(0, 3, "unsigned64", { reverseWords: true })],
        scope: [[0, 3]],
        expected: { format: "unsigned64", order: "littleByteSwap", mixed: false, scope: [[0, 3]] },
        status: "U",
      },
      {
        id: "S7",
        poll: [0, 10],
        overrides: [ov(2, 3, "float32")],
        scope: [[1, 3]],
        expected: { format: "unsigned", order: "big", mixed: true, scope: [[1, 3]] },
        status: "V",
      },
      {
        id: "S8",
        poll: [0, 10],
        overrides: [ov(0, 1, "float32", { swapBytes: true, reverseWords: true }), ov(2, 2, "hex")],
        scope: [[0, 2]],
        expected: { format: "unsigned", order: "big", mixed: true, scope: [[0, 2]] },
        status: "V",
      },
      {
        id: "S9",
        poll: [0, 10],
        overrides: [ov(0, 0, "hex"), ov(1, 1, "binary"), ov(2, 3, "float32")],
        scope: [[0, 3]],
        expected: { format: "unsigned", order: "big", mixed: true, scope: [[0, 3]] },
        status: "V",
      },
      {
        id: "S10",
        poll: [0, 10],
        overrides: [ov(0, 1, "signed")],
        scope: [[0, 1]],
        expected: { format: "signed", order: "big", mixed: false, scope: [[0, 1]] },
        status: "U",
      },
      {
        id: "S11",
        poll: [101, 4],
        overrides: [ov(100, 101, "float32")],
        scope: [[101]],
        expected: { format: "float32", order: "big", mixed: false, scope: [[101]] },
        status: "C",
      },
      {
        id: "S12",
        poll: [101, 2],
        overrides: [ov(100, 103, "unsigned64")],
        scope: [[101, 102]],
        expected: { format: "unsigned64", order: "big", mixed: false, scope: [[101, 102]] },
        status: "C",
      },
      {
        id: "S13",
        poll: [0, 10],
        overrides: [ov(2, 5, "float32")],
        scope: [
          [2, 5],
          [8, 9],
        ],
        expected: {
          format: "unsigned",
          order: "big",
          mixed: true,
          scope: [
            [2, 5],
            [8, 9],
          ],
        },
        status: "V",
      },
      {
        id: "S14",
        poll: [0, 125],
        overrides: [],
        scope: [[0, 124]],
        expected: { format: "unsigned", order: "big", mixed: false, scope: [[0, 124]] },
        status: "U",
      },
      {
        id: "S15",
        poll: [0, 10],
        overrides: s15,
        scope: [[2], [7]],
        expected: { format: "unsigned", order: "big", mixed: true, scope: [[2], [7]] },
        status: "T",
        applyEnabled: false,
      },
      {
        id: "S16",
        poll: [0, 10],
        overrides: [ov(0, 1, "float32"), ov(2, 9, "signed32", BS)],
        scope: [[0, 1]],
        expected: { format: "float32", order: "big", mixed: false, scope: [[0, 1]] },
        status: "U",
      },
      {
        id: "S17",
        poll: [0, 10],
        overrides: [ov(0, 1, "float32")],
        scope: [[0, 2]],
        expected: { format: "unsigned", order: "big", mixed: true, scope: [[0, 2]] },
        status: "V",
      },
      {
        id: "S18",
        poll: [0, 10],
        overrides: [
          ov(0, 1, "float32"),
          ov(4, 5, "signed32", BS),
          ov(6, 7, "hex"),
          ov(8, 9, "signed32", BS),
        ],
        scope: [[3, 6]],
        expected: { format: "unsigned", order: "big", mixed: true, scope: [[3, 6]] },
        status: "V",
      },
      {
        id: "S19",
        poll: [0, 10],
        overrides: [
          ov(0, 1, "float32"),
          ov(3, 6, "signed32"),
          ov(7, 7, "hex"),
          ov(8, 9, "signed32", BS),
        ],
        scope: [[7, 9]],
        expected: { format: "unsigned", order: "big", mixed: true, scope: [[7, 9]] },
        status: "V",
      },
      {
        id: "S20",
        poll: [100, 4],
        overrides: [ov(98, 105, "float64")],
        scope: [[100, 103]],
        expected: { format: "float64", order: "big", mixed: false, scope: [[100, 103]] },
        status: "C",
      },
    ];
    const toRanges = (list: Array<[number, number?]>) => list.map(([a, b]) => r(a, b ?? a));

    it.each(cases)("$id", (c) => {
      config = pollWith(c.poll[0], c.poll[1], c.overrides);
      expect(store.getState().openFor(toRanges(c.scope), "grid", c.scope[0]?.[0] ?? null)).toBe(
        true,
      );
      expect(store.getState()).toMatchObject({
        format: c.expected.format,
        order: c.expected.order,
        mixed: c.expected.mixed,
        scope: toRanges(c.expected.scope),
        pending: false,
        error: null,
      });
      expect(plan().status).toBe(c.status);
      // Never stuck: every vector but the cap (S15) opens with Apply enabled.
      expect(plan().applyEnabled).toBe(c.applyEnabled ?? true);
    });
  });

  it("an edge-cut group row opens Float32 with the cut listed and Apply on (S11)", () => {
    config = pollWith(101, 4, [ov(100, 101, "float32")]);
    store.getState().openFor([r(101)], "grid", 101);
    expect(plan().plan).toMatchObject({
      kind: "ok",
      overrides: [ov(101, 102, "float32")],
      cuts: [{ cut: r(100), group: r(100, 101), outsidePoll: [r(100)] }],
    });
  });
});

describe("mixed-format preselection (D-009-05)", () => {
  it("10 rows with a Float 64-bit group and 16-bit rows open on Unsigned with the mixed note, Apply on", () => {
    config = makeConfig({ formatOverrides: [ov(0, 3, "float64"), ov(4, 5, "hex")] });
    store.getState().openFor([r(0, 9)], "grid", 0);
    expect(store.getState()).toMatchObject({
      format: "unsigned",
      order: "big",
      mixed: true,
      scope: [r(0, 9)],
    });
    expect(plan()).toMatchObject({ status: "V", applyEnabled: true });
  });

  it("a scope with one 32-bit format preselects it, including an edge-cut row", () => {
    config = makeConfig({ formatOverrides: [ov(0, 3, "float32")] });
    // Row 2-3 is whole; the dialog opens on Float 32-bit only because the scope is exact.
    store.getState().openFor([r(2, 3)], "grid", 2);
    expect(store.getState().format).toBe("float32");
    config = pollWith(1, 9, [ov(0, 3, "float32")]);
    store.getState().close();
    store.getState().openFor([r(1)], "grid", 1);
    expect(store.getState().format).toBe("float32");
  });
});

describe("choosing a format (V, C, U, T; selected runs can use following registers)", () => {
  it("3 rows + Float 32-bit: the plan includes the next register", async () => {
    store.getState().openFor([r(2, 4)], "grid", 2);
    store.getState().setFormat("float32");
    expect(store.getState().format).toBe("float32");
    expect(plan().plan).toMatchObject({ kind: "ok", groups: [r(2, 3), r(4, 5)], added: [r(5)] });
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toEqual([[ov(2, 5, "float32")]]);
  });

  it("3 rows: every 32-bit and 64-bit choice can be selected", () => {
    store.getState().openFor([r(2, 4)], "grid", 2);
    for (const f of [
      "signed32",
      "unsigned32",
      "float32",
      "signed64",
      "unsigned64",
      "float64",
    ] as const) {
      store.getState().setFormat(f);
      expect(store.getState().format).toBe(f);
    }
    store.getState().setFormat("binary");
    expect(store.getState().format).toBe("binary");
    expect(plan()).toMatchObject({ status: "V", applyEnabled: true });
  });

  it("1 row [7]: Signed 64-bit can be chosen and leaves a poll-end tail", () => {
    store.getState().openFor([r(7)], "grid", 7);
    store.getState().setFormat("signed64");
    expect(store.getState().format).toBe("signed64");
    expect(plan().plan).toMatchObject({ kind: "ok", groups: [], tails: [r(7)] });
    store.getState().setFormat("signed");
    expect(store.getState().format).toBe("signed");
    expect(plan().plan).toMatchObject({ kind: "ok", overrides: [ov(7, 7, "signed")] });
  });

  it("a new choice clears an Apply error", async () => {
    result.ok = false;
    commandError = "boom";
    store.getState().openFor([r(0, 2)], "grid", 0);
    store.getState().setFormat("hex");
    await store.getState().apply();
    expect(store.getState().error?.kind).toBe("ipc");
    store.getState().setFormat("float32");
    expect(store.getState().error).toBeNull();
    store.getState().setFormat("signed");
    expect(store.getState().error).toBeNull();
  });

  it("order memory: the order survives a 16-bit choice and applies to the next 32/64-bit choice", async () => {
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("float32");
    store.getState().setOrder("littleByteSwap");
    store.getState().setFormat("hex");
    store.getState().setFormat("signed64");
    expect(store.getState().order).toBe("littleByteSwap");
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toEqual([[ov(0, 3, "signed64", { swapBytes: false, reverseWords: true })]]);
  });

  it("order memory ends with the session: reopening starts from the scope's own order", () => {
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("float32");
    store.getState().setOrder("littleByteSwap");
    store.getState().close();
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("float32");
    expect(store.getState().order).toBe("big");
  });

  it("mixed [0-1 F32 BE, 2-3 HEX] on [0-3] opens on Unsigned with the mixed flag, 32/64-bit available", () => {
    config = makeConfig({ formatOverrides: [ov(0, 1, "float32"), ov(2, 3, "hex")] });
    store.getState().openFor([r(0, 3)], "grid", 0);
    expect(store.getState()).toMatchObject({ format: "unsigned", mixed: true });
    store.getState().setFormat("float64");
    expect(store.getState().format).toBe("float64");
  });

  it("unchanged: [2-3 F32 BE] opens in U and Apply closes without IPC", async () => {
    config = makeConfig({ formatOverrides: [ov(2, 3, "float32")] });
    store.getState().openFor([r(2, 3)], "grid", 2);
    expect(plan().status).toBe("U");
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toEqual([]);
    expect(announced).toEqual([]);
  });

  it("non-contiguous blocks are completed independently", () => {
    store.getState().openFor([r(0, 1), r(4, 6)], "grid", 0);
    store.getState().setFormat("signed32");
    expect(store.getState().format).toBe("signed32");
    expect(plan().plan).toMatchObject({ kind: "ok", added: [r(7)] });
    store.getState().openFor([r(0, 1), r(4, 5)], "grid", 0);
    store.getState().setFormat("signed32");
    expect(store.getState().format).toBe("signed32");
    store.getState().setFormat("float64");
    expect(store.getState().format).toBe("float64");
    expect(plan().plan).toMatchObject({
      kind: "ok",
      overrides: [ov(0, 7, "float64")],
      groups: [r(0, 3), r(4, 7)],
    });
  });

  it("[0-3] + Float 32-bit big: plan ok [0-3 F32 BE], groups 0-1 and 2-3, state V", () => {
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("float32");
    expect(plan()).toMatchObject({
      status: "V",
      applyEnabled: true,
      plan: { kind: "ok", overrides: [ov(0, 3, "float32")], groups: [r(0, 1), r(2, 3)] },
    });
  });

  it("the announcement names the selection as it is", async () => {
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("signed32");
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toEqual([[ov(0, 1, "signed32")]]);
    expect(announced).toEqual(["Format applied: Signed 32-bit, Big-endian (ABCD) to 0-1."]);
  });

  it("selectWidthAvailability follows the scope (memo-free selector)", () => {
    store.getState().openFor([r(0, 4)], "grid", 0);
    const state = store.getState();
    expect(selectWidthAvailability(1)(state)).toMatchObject({ available: true, values: 5 });
    expect(selectWidthAvailability(2)(state)).toMatchObject({ available: true, values: 3 });
    expect(selectWidthAvailability(4)(state)).toMatchObject({ available: true, values: 2 });
    store.getState().openFor([r(0, 3)], "grid", 0);
    expect(selectWidthAvailability(4)(store.getState())).toMatchObject({
      available: true,
      values: 1,
    });
  });

  it("the plan of one short run includes the next register", () => {
    store.getState().openFor([r(0, 2)], "grid", 0);
    const derived = selectPlan({ scope: [r(0, 2)], format: "float32", order: "big" }, config);
    expect(derived).toMatchObject({
      status: "V",
      applyEnabled: true,
      plan: { kind: "ok", groups: [r(0, 1), r(2, 3)], added: [r(3)] },
    });
  });

  it("selectPlan of a closed dialog has nothing to apply", () => {
    expect(plan()).toMatchObject({ plan: { kind: "empty" }, applyEnabled: false });
  });

  it("V to C and back: the choice splits a group the poll's edge cut, or no longer does", () => {
    config = pollWith(1, 9, [ov(0, 3, "float32")]);
    store.getState().openFor([r(1)], "grid", 1);
    store.getState().setFormat("hex");
    expect(plan()).toMatchObject({ status: "C", applyEnabled: true });
    expect(plan().plan).toMatchObject({ cuts: [{ cut: r(0), outsidePoll: [r(0)] }] });
    store.getState().openFor([r(2, 3)], "grid", 2);
    store.getState().setFormat("hex");
    expect(plan().status).toBe("V");
  });

  it("V to U and back: the result equals the current overrides", () => {
    config = makeConfig({ formatOverrides: [ov(2, 5, "float32")] });
    store.getState().openFor([r(2, 5)], "grid", 2);
    expect(plan().status).toBe("U");
    store.getState().setFormat("hex");
    expect(plan().status).toBe("V");
    store.getState().setFormat("float32");
    expect(plan()).toMatchObject({ status: "U", applyEnabled: true });
  });

  it("V to T: more than 256 overrides is refused, another choice recovers", () => {
    config = makeConfig({ formatOverrides: manyHex(255) });
    store.getState().openFor([r(0), r(2)], "grid", 0);
    store.getState().setFormat("hex");
    expect(plan()).toMatchObject({ status: "T", applyEnabled: false, plan: { count: 257 } });
    store.getState().setFormat("unsigned");
    expect(plan().status).toBe("U");
  });

  it("the order is kept when switching 32-bit, 16-bit and 64-bit", () => {
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("float32");
    store.getState().setOrder("littleByteSwap");
    store.getState().setFormat("hex");
    expect(store.getState().order).toBe("littleByteSwap");
    store.getState().setFormat("float64");
    expect(store.getState().order).toBe("littleByteSwap");
    expect(plan().plan).toMatchObject({
      overrides: [ov(0, 3, "float64", { reverseWords: true })],
    });
  });

  it("a 16-bit format drops the order flags in the plan", () => {
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setOrder("little");
    store.getState().setFormat("hex");
    expect(plan().plan).toMatchObject({ overrides: [ov(0, 1, "hex")] });
  });
});

describe("Apply", () => {
  it("V to P to Closed: one setView with the planned overrides, then announce and close", async () => {
    store.getState().openFor([r(2, 5)], "grid", 2);
    store.getState().setFormat("float32");
    const done = store.getState().apply();
    expect(store.getState().pending).toBe(true);
    expect(await done).toBe("closed");
    expect(sent).toEqual([[ov(2, 5, "float32")]]);
    expect(store.getState()).toMatchObject({ open: false, pending: false, error: null });
    expect(announced).toEqual(["Format applied: Float 32-bit, Big-endian (ABCD) to 2-5."]);
  });

  it("the owner's first Apply: row 0-1 of [0-9 S32 BS] to Float 32-bit keeps the other groups (P37)", async () => {
    config = pollWith(0, 10, [ov(0, 9, "signed32", BS)]);
    store.getState().openFor([r(0)], "grid", 0);
    store.getState().setFormat("float32");
    store.getState().setOrder("big");
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toEqual([[ov(0, 1, "float32"), ov(2, 9, "signed32", BS)]]);
  });

  it("announces in the display base", async () => {
    config = makeConfig({ display: { addressBase: 1, showAlias: true, copyAlias: false } });
    store.getState().openFor([r(2, 3)], "grid", 2);
    store.getState().setFormat("hex");
    await store.getState().apply();
    expect(announced).toEqual(["Format applied: Hex to 3-4."]);
  });

  it("C to P: an Apply that splits an edge-cut group is allowed and resets the outside part", async () => {
    config = pollWith(1, 9, [ov(0, 3, "float32")]);
    store.getState().openFor([r(1)], "grid", 1);
    store.getState().setFormat("hex");
    expect(plan().status).toBe("C");
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toEqual([[ov(1, 1, "hex"), ov(2, 3, "float32")]]);
  });

  it("U to Closed: no IPC, no announcement (the mixed step 2 of DES-009 11.6)", async () => {
    config = makeConfig({ formatOverrides: [ov(0, 1, "float32")] });
    store.getState().openFor([r(2)], "grid", 2);
    expect(plan().status).toBe("U");
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toEqual([]);
    expect(announced).toEqual([]);
    expect(store.getState().open).toBe(false);
  });

  it("is blocked only in the state T and sends nothing", async () => {
    config = makeConfig({ formatOverrides: manyHex(255) });
    store.getState().openFor([r(0), r(2)], "grid", 0);
    store.getState().setFormat("hex");
    expect(await store.getState().apply()).toBe("blocked");
    expect(sent).toEqual([]);
  });

  it("is blocked when the dialog is closed", async () => {
    expect(await store.getState().apply()).toBe("blocked");
    expect(sent).toEqual([]);
  });

  it("V to R: a rule that does not fit the new formats blocks Apply with the rule's message", async () => {
    config = makeConfig({ colorRules: [rawRule("1.5", { range: { start: 0, end: 3 } })] });
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("unsigned64");
    expect(await store.getState().apply()).toBe("blocked");
    expect(sent).toEqual([]);
    expect(store.getState().open).toBe(true);
    expect(store.getState().pending).toBe(false);
    expect(store.getState().error).toEqual({
      kind: "rule",
      text: 'Format not applied. Rule "Flow": Enter a whole decimal number for a 64-bit integer comparison.',
    });
  });

  it("R to V: changing a radio clears the message, and a fitting choice then goes through", async () => {
    config = makeConfig({ colorRules: [rawRule("1.5", { range: { start: 0, end: 3 } })] });
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("unsigned64");
    await store.getState().apply();
    store.getState().setFormat("float64");
    expect(store.getState().error).toBeNull();
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toHaveLength(1);
  });

  it("a rule on 64-bit integers with a whole threshold passes (AC 6)", async () => {
    config = makeConfig({
      colorRules: [rawRule("18446744073709551615", { range: { start: 0, end: 3 } })],
    });
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("unsigned64");
    expect(await store.getState().apply()).toBe("closed");
  });

  it("P to F: Rust rejects, the choice is kept and the message says why", async () => {
    result.ok = false;
    commandError = "Format override 0-1: boom.";
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("float32");
    store.getState().setOrder("little");
    expect(await store.getState().apply()).toBe("failed");
    expect(store.getState()).toMatchObject({
      open: true,
      pending: false,
      format: "float32",
      order: "little",
      error: { kind: "ipc", text: "Could not apply the format. Format override 0-1: boom." },
    });
    expect(announced).toEqual([]);
  });

  it("passes the backend's Format not applied text through unchanged (DES-009 11.8, CHK9-111)", async () => {
    result.ok = false;
    commandError =
      'Format not applied. Rule "High" requires whole-number thresholds for 64-bit integers.';
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("unsigned64");
    await store.getState().apply();
    expect(store.getState().error).toEqual({
      kind: "ipc",
      text: 'Format not applied. Rule "High" requires whole-number thresholds for 64-bit integers.',
    });
    expect(store.getState().open).toBe(true);
  });

  it("any other backend message keeps the prefix", async () => {
    result.ok = false;
    commandError = "Rejected view";
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    await store.getState().apply();
    expect(store.getState().error?.text).toBe("Could not apply the format. Rejected view");
  });

  it("F says Try again when Rust gave no message", async () => {
    result.ok = false;
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    await store.getState().apply();
    expect(store.getState().error?.text).toBe("Could not apply the format. Try again.");
  });

  it("F to P: Apply again sends again and can succeed", async () => {
    result.ok = false;
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    await store.getState().apply();
    result.ok = true;
    expect(await store.getState().apply()).toBe("closed");
    expect(sent).toHaveLength(2);
    expect(announced).toHaveLength(1);
  });

  it("F to V: changing a radio clears the message", async () => {
    result.ok = false;
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    await store.getState().apply();
    store.getState().setOrder("little");
    expect(store.getState().error).toBeNull();
  });

  it("a second Apply while the first is on its way sends nothing", async () => {
    holdIpc();
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    const first = store.getState().apply();
    expect(await store.getState().apply()).toBe("blocked");
    expect(sent).toHaveLength(1);
    result.release();
    expect(await first).toBe("closed");
    expect(sent).toHaveLength(1);
  });

  it("radios and openFor are ignored while the change is on its way", async () => {
    holdIpc();
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    const pending = store.getState().apply();
    store.getState().setFormat("signed");
    store.getState().setOrder("little");
    expect(store.getState().openFor([r(5)], "grid", 5)).toBe(false);
    expect(store.getState()).toMatchObject({ format: "hex", order: "big", scope: [r(0, 1)] });
    result.release();
    await pending;
  });
});

describe("closing", () => {
  it.each([
    ["U", () => {}],
    ["U with an ignored 32-bit choice", () => store.getState().setFormat("float32")],
    ["V", () => store.getState().setFormat("hex")],
  ])("Cancel closes from %s without sending anything", (_name, prepare) => {
    store.getState().openFor([r(2, 4)], "grid", 2);
    prepare();
    store.getState().close();
    expect(store.getState().open).toBe(false);
    expect(sent).toEqual([]);
  });

  it("Cancel closes from C, T, R and F", async () => {
    // C
    config = pollWith(1, 9, [ov(0, 3, "float32")]);
    store.getState().openFor([r(1)], "grid", 1);
    store.getState().setFormat("hex");
    expect(plan().status).toBe("C");
    store.getState().close();
    expect(store.getState().open).toBe(false);
    // T
    config = makeConfig({ formatOverrides: manyHex(255) });
    store.getState().openFor([r(0), r(2)], "grid", 0);
    store.getState().setFormat("hex");
    expect(plan().status).toBe("T");
    store.getState().close();
    expect(store.getState().open).toBe(false);
    // R
    config = makeConfig({ colorRules: [rawRule("1.5")] });
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("unsigned64");
    await store.getState().apply();
    expect(store.getState().error?.kind).toBe("rule");
    store.getState().close();
    expect(store.getState()).toMatchObject({ open: false, error: null });
    // F
    config = makeConfig();
    result.ok = false;
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    await store.getState().apply();
    store.getState().close();
    expect(store.getState()).toMatchObject({ open: false, error: null });
    expect(sent).toHaveLength(1);
  });

  it("keeps the origin so the focus can go back", () => {
    store.getState().openFor([r(3, 4)], "showMenu", 3);
    store.getState().close();
    expect(store.getState()).toMatchObject({ originAddress: 3, origin: "showMenu" });
  });

  it("close during P is ignored until the reply", async () => {
    holdIpc();
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    const pending = store.getState().apply();
    store.getState().close();
    expect(store.getState()).toMatchObject({ open: true, pending: true });
    result.release();
    await pending;
    expect(store.getState().open).toBe(false);
  });

  it("close when already closed does nothing", () => {
    const before = store.getState();
    store.getState().close();
    expect(store.getState()).toBe(before);
    store.getState().closeForRemoval();
    expect(store.getState()).toBe(before);
  });
});

describe("closeForRemoval (the poll went away, DES-009 11.12)", () => {
  it("closes at once from any state without sending anything", () => {
    store.getState().openFor([r(0, 3)], "grid", 0);
    store.getState().setFormat("float32");
    store.getState().closeForRemoval();
    expect(store.getState()).toMatchObject({ open: false, pending: false, error: null });
    expect(sent).toEqual([]);
  });

  it("during P the late acknowledgment changes nothing: no announcement, no error, no reopen", async () => {
    holdIpc();
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    const pending = store.getState().apply();
    store.getState().closeForRemoval();
    expect(store.getState()).toMatchObject({ open: false, pending: false });
    result.release();
    expect(await pending).toBe("closed");
    expect(store.getState()).toMatchObject({ open: false, pending: false, error: null });
    expect(announced).toEqual([]);
  });

  it("during P the late rejection changes nothing: no error", async () => {
    holdIpc();
    result.ok = false;
    commandError = "boom";
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    const pending = store.getState().apply();
    store.getState().closeForRemoval();
    result.release();
    expect(await pending).toBe("failed");
    expect(store.getState()).toMatchObject({ open: false, pending: false, error: null });
  });

  it("a reply that arrives after the dialog was reopened does not touch the new state", async () => {
    holdIpc();
    store.getState().openFor([r(0, 1)], "grid", 0);
    store.getState().setFormat("hex");
    const pending = store.getState().apply();
    store.getState().closeForRemoval();
    store.getState().openFor([r(5, 6)], "grid", 5);
    result.release();
    await pending;
    expect(store.getState()).toMatchObject({ open: true, scope: [r(5, 6)], pending: false });
    expect(announced).toEqual([]);
  });
});

describe("the plan follows the config", () => {
  it("recomputes when the overrides change underneath the open dialog", () => {
    store.getState().openFor([r(2, 5)], "grid", 2);
    store.getState().setFormat("float32");
    expect(plan().status).toBe("V");
    config = makeConfig({ formatOverrides: [ov(2, 5, "float32")] });
    expect(plan().status).toBe("U");
  });
});
