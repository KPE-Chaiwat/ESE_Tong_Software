import { describe, expect, it } from "vitest";
import type { FormatOverride, ValueFormat } from "@/shared/ipc/modbus-master.types";
import type { AddressRange } from "./address-ranges";
import {
  firstValueText,
  previewLines,
  previewNotice,
  quickFormatState,
  selectionRuns,
  selectionSummary,
  widthAvailability,
  widthHeading,
} from "./format-dialog-model";
import { type OrderId, planFormatChange } from "./format-overrides";

const r = (start: number, end = start): AddressRange => ({ start, end });
const ov = (
  start: number,
  end: number,
  format: ValueFormat,
  swapBytes = false,
  reverseWords = false,
): FormatOverride => ({ start, end, format, swapBytes, reverseWords });

/** Fixture F10 of DES-010: registers 0-9. */
const F10 = [0x4148, 0, 0, 0, 0x4148, 0, 0x00a1, 0xfffe, 9, 10];

describe("selectionRuns", () => {
  it("sorts and merges", () => {
    expect(selectionRuns([r(4, 6), r(0, 1), r(2)])).toEqual([r(0, 2), r(4, 6)]);
    expect(selectionRuns([])).toEqual([]);
  });
});

describe("selectionSummary (SM1-SM12)", () => {
  const sum = (scope: AddressRange[], base: 0 | 1 = 0, mixed = false) =>
    selectionSummary({ scope, base, mixed });
  it.each([
    ["SM1", [r(0, 9)], 0, false, "Selected 10 registers (0-9)"],
    ["SM2", [r(0, 9)], 1, false, "Selected 10 registers (1-10)"],
    ["SM3", [r(0, 1), r(4, 6)], 0, false, "Selected 5 registers (0-1, 4-6)"],
    ["SM4", [r(2, 3)], 0, false, "Selected 2 registers (2-3)"],
    ["SM5", [r(7)], 0, false, "Selected 1 register (7)"],
    ["SM6", [r(0, 3)], 0, true, "Selected 4 registers (0-3) · mixed formats"],
    [
      "SM7",
      [r(0), r(2), r(4), r(6), r(8)],
      0,
      false,
      "Selected 5 registers (0, 2, 4, 6 and 1 more block)",
    ],
    ["SM8", [r(0), r(2), r(4), r(6)], 0, false, "Selected 4 registers (0, 2, 4, 6)"],
    ["SM9", [r(65535)], 1, false, "Selected 1 register (65536)"],
    ["SM10", [r(0, 124)], 0, false, "Selected 125 registers (0-124)"],
    ["SM11", [r(0, 1), r(4, 6)], 1, false, "Selected 5 registers (1-2, 5-7)"],
    [
      "SM12",
      [r(0), r(2), r(4), r(6), r(8), r(10)],
      0,
      false,
      "Selected 6 registers (0, 2, 4, 6 and 2 more blocks)",
    ],
  ] as const)("%s", (_id, scope, base, mixed, expected) => {
    expect(sum([...scope], base, mixed)).toBe(expected);
  });
  it("normalizes an unsorted scope", () => {
    expect(sum([r(4, 6), r(0, 1)])).toBe("Selected 5 registers (0-1, 4-6)");
  });
});

describe("widthAvailability and widthHeading (owner observation, 2026-10-23)", () => {
  it.each([
    [[r(0)], 2, 1, [r(1)]],
    [[r(0)], 4, 1, [r(1, 3)]],
    [[r(0, 2)], 2, 2, [r(3)]],
    [[r(4, 6)], 2, 2, [r(7)]],
    [[r(0, 1), r(4, 6)], 2, 3, [r(7)]],
  ] as const)("completes %j at width %i", (scope, width, values, added) => {
    const a = widthAvailability({ scope, width, base: 0, pollEnd: 9 });
    expect(a).toMatchObject({ available: true, values, added, tails: [] });
    expect(widthHeading(a)).toContain(`${values} ${values === 1 ? "value" : "values"}`);
  });

  it("keeps an incomplete end-of-poll tail as 16-bit", () => {
    expect(widthAvailability({ scope: [r(9)], width: 2, base: 0, pollEnd: 9 })).toMatchObject({
      available: true,
      values: 0,
      added: [],
      tails: [r(9)],
    });
  });

  it("agrees with the format plan for selected runs", () => {
    const scope = [r(0, 1), r(4, 6)];
    const a = widthAvailability({ scope, width: 2, base: 0, pollEnd: 9 });
    const plan = planFormatChange({
      overrides: [],
      scope,
      choice: { format: "signed32", order: "big" },
      pollRange: r(0, 9),
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind === "ok" && a.available) {
      expect(a.values).toBe(plan.groups.length);
      expect(a.added).toEqual(plan.added);
      expect(a.tails).toEqual(plan.tails);
    }
  });
});

describe("previewLines (PV1-PV13)", () => {
  const lines = (
    scope: AddressRange[],
    format: ValueFormat,
    order: OrderId = "big",
    snapshot: readonly number[] | null = F10,
    base: 0 | 1 = 0,
    pollStart = 0,
  ) => previewLines({ scope, format, order, snapshot, pollStart, base });
  const flat = (p: ReturnType<typeof previewLines>) => p.lines.map((l) => `${l.text} ${l.value}`);

  it("PV1 Float 32-bit big", () => {
    const p = lines([r(0, 3)], "float32");
    expect(flat(p)).toEqual(["0-1 12.5", "2-3 0"]);
    expect(p.more).toBe(0);
    expect(p.moreText).toBeNull();
    expect(p.summary).toBe("2 Float 32-bit values, Big-endian (ABCD)");
    expect(p.lines.map((l) => l.address)).toEqual([0, 2]);
  });
  it("PV2 Unsigned 32-bit big", () => {
    expect(flat(lines([r(0, 3)], "unsigned32"))).toEqual(["0-1 1095237632", "2-3 0"]);
  });
  it("PV3 Unsigned 32-bit littleByteSwap", () => {
    expect(flat(lines([r(0, 3)], "unsigned32", "littleByteSwap"))).toEqual(["0-1 16712", "2-3 0"]);
  });
  it("PV4 Unsigned 0-9: eight lines and two more", () => {
    const p = lines([r(0, 9)], "unsigned");
    expect(flat(p)).toEqual(["0 16712", "1 0", "2 0", "3 0", "4 16712", "5 0", "6 161", "7 65534"]);
    expect(p.more).toBe(2);
    expect(p.moreText).toBe("… and 2 more values");
    expect(p.summary).toBe("10 Unsigned values");
  });
  it("PV5 Hex", () => {
    const p = lines([r(0, 9)], "hex");
    expect(p.lines[0]?.value).toBe("0x4148");
    expect(p.lines[1]?.value).toBe("0x0000");
    expect(p.lines[7]?.value).toBe("0xFFFE");
    expect(p.more).toBe(2);
  });
  it("PV6 Signed 6-7", () => {
    const p = lines([r(6, 7)], "signed");
    expect(flat(p)).toEqual(["6 161", "7 -2"]);
    expect(p.summary).toBe("2 Signed values");
  });
  it("PV7 two blocks", () => {
    expect(flat(lines([r(0, 1), r(4, 5)], "float32"))).toEqual(["0-1 12.5", "4-5 12.5"]);
  });
  it("PV8 base 1", () => {
    expect(flat(lines([r(0, 3)], "float32", "big", F10, 1))).toEqual(["1-2 12.5", "3-4 0"]);
  });
  it("PV9 no snapshot", () => {
    expect(flat(lines([r(0, 3)], "float32", "big", null))).toEqual(["0-1 —", "2-3 —"]);
  });
  it("PV10 Float 64-bit", () => {
    const p = lines([r(0, 3)], "float64");
    expect(flat(p)).toEqual(["0-3 3145728"]);
    expect(p.summary).toBe("1 Float 64-bit (Double) value, Big-endian (ABCDEFGH)");
  });
  it("PV11 nine values: one more", () => {
    const p = lines([r(0, 8)], "unsigned");
    expect(p.lines).toHaveLength(8);
    expect(p.moreText).toBe("… and 1 more value");
  });
  it("PV12 125 registers", () => {
    const snapshot = Array.from({ length: 125 }, (_, i) => i);
    const p = lines([r(0, 124)], "unsigned", "big", snapshot);
    expect(p.lines).toHaveLength(8);
    expect(p.more).toBe(117);
    expect(p.moreText).toBe("… and 117 more values");
  });
  it("PV13 the same snapshot gives other values for another order (no new request)", () => {
    const big = lines([r(0, 3)], "unsigned32", "big");
    const swapped = lines([r(0, 3)], "unsigned32", "littleByteSwap");
    expect(big.lines[0]?.value).not.toBe(swapped.lines[0]?.value);
  });
  it("PV13b float 32-bit littleByteSwap is the DES-006 text of 0x00004148", () => {
    const p = lines([r(0, 3)], "float32", "littleByteSwap");
    expect(p.lines[0]?.value).toMatch(/e-41$/);
    expect(p.lines[1]?.value).toBe("0");
  });
  it("summary of one signed value", () => {
    expect(lines([r(7)], "signed").summary).toBe("1 Signed value");
  });
  it("reads from the poll start", () => {
    const p = lines([r(102, 103)], "float32", "big", [0, 0, 0x4148, 0, 0, 0], 0, 100);
    expect(flat(p)).toEqual(["102-103 12.5"]);
  });
  it("a snapshot that is too short gives a dash", () => {
    expect(flat(lines([r(8, 9)], "unsigned32", "big", [1, 2, 3]))).toEqual(["8-9 —"]);
  });
  it("NaN and infinities use the DES-006 text", () => {
    expect(lines([r(0, 1)], "float32", "big", [0x7fc0, 0]).lines[0]?.value).toBe("NaN");
    expect(lines([r(0, 1)], "float32", "big", [0x7f80, 0]).lines[0]?.value).toBe("+Infinity");
    expect(lines([r(0, 1)], "float32", "big", [0xff80, 0]).lines[0]?.value).toBe("-Infinity");
  });
  it("honours a custom limit", () => {
    const p = previewLines({
      scope: [r(0, 9)],
      format: "unsigned",
      order: "big",
      snapshot: F10,
      pollStart: 0,
      base: 0,
      limit: 3,
    });
    expect(p.lines).toHaveLength(3);
    expect(p.more).toBe(7);
  });
});

describe("firstValueText", () => {
  const base = { pollStart: 0, base: 0 as const, order: "big" as const };
  it("is the first value of the format", () => {
    expect(firstValueText({ ...base, scope: [r(0, 3)], format: "float32", snapshot: F10 })).toBe(
      "12.5",
    );
    expect(firstValueText({ ...base, scope: [r(0, 3)], format: "hex", snapshot: F10 })).toBe(
      "0x4148",
    );
    expect(firstValueText({ ...base, scope: [r(0, 3)], format: "float64", snapshot: F10 })).toBe(
      "3145728",
    );
  });
  it("is a dash without a snapshot", () => {
    expect(firstValueText({ ...base, scope: [r(0, 3)], format: "hex", snapshot: null })).toBe("—");
  });
});

describe("previewNotice (N1-N15)", () => {
  type Row = [
    string,
    "idle" | "connecting" | "connected" | "disconnected",
    "offline" | "polling" | "paused" | "timeout" | "exception" | "badResponse",
    "none" | "loading" | "live" | "stale",
    boolean,
    string | null,
  ];
  const rows: Row[] = [
    ["N1", "idle", "offline", "none", false, "notConnected"],
    ["N2", "connecting", "offline", "none", false, "connecting"],
    ["N3", "connected", "offline", "none", false, "waiting"],
    ["N4", "connected", "polling", "loading", false, "waiting"],
    ["N5", "connected", "polling", "live", true, null],
    ["N6", "connected", "paused", "stale", true, "stale"],
    ["N7", "connected", "timeout", "stale", true, "stale"],
    ["N8", "connected", "exception", "stale", true, "stale"],
    ["N9", "connected", "exception", "none", false, "failed"],
    ["N10", "connected", "timeout", "loading", false, "failed"],
    ["N11", "connected", "paused", "none", false, "paused"],
    ["N12", "disconnected", "offline", "stale", true, "stale"],
    ["N13", "disconnected", "offline", "none", false, "connectionLost"],
    ["N14", "idle", "offline", "none", false, "notConnected"],
    ["N15", "connected", "badResponse", "stale", true, "stale"],
  ];
  it.each(rows)("%s", (_id, connectionState, pollState, status, hasValues, kind) => {
    const n = previewNotice({ connectionState, pollState, status, hasValues });
    expect(n?.kind ?? null).toBe(kind);
  });
  it("has the icon and the exact text of each kind", () => {
    const get = (connectionState: Row[1], pollState: Row[2], status: Row[3], hasValues: boolean) =>
      previewNotice({ connectionState, pollState, status, hasValues });
    expect(get("idle", "offline", "none", false)).toEqual({
      kind: "notConnected",
      icon: "plug",
      text: "No preview: not connected. Connect to read values. You can apply the format now.",
    });
    expect(get("connecting", "offline", "none", false)).toEqual({
      kind: "connecting",
      icon: "loader",
      text: "No preview yet: connecting to the device.",
    });
    expect(get("connected", "polling", "loading", false)).toEqual({
      kind: "waiting",
      icon: "loader",
      text: "No preview yet: waiting for the first reply.",
    });
    expect(get("connected", "paused", "none", false)).toEqual({
      kind: "paused",
      icon: "pause",
      text: "No preview: the poll is paused. Resume it (Ctrl+P) to read values.",
    });
    expect(get("connected", "timeout", "none", false)).toEqual({
      kind: "failed",
      icon: "octagon-x",
      text: "No preview: the last request got no valid reply. Values appear after the next good reply.",
    });
    expect(get("disconnected", "offline", "none", false)).toEqual({
      kind: "connectionLost",
      icon: "unplug",
      text: "No preview: the connection was lost. Reconnect to read values.",
    });
    expect(get("connected", "paused", "stale", true)).toEqual({
      kind: "stale",
      icon: "clock",
      text: "Preview uses the last values received (stale).",
    });
  });
});

describe("quickFormatState (Q1-Q7)", () => {
  it("Q1 no overrides: Unsigned", () => {
    expect(quickFormatState({ scope: [r(0, 9)], overrides: [] })).toEqual({
      checked: "unsigned",
      heading: "Value format",
    });
  });
  it("Q2 Hex", () => {
    expect(quickFormatState({ scope: [r(2, 3)], overrides: [ov(0, 9, "hex")] })).toEqual({
      checked: "hex",
      heading: "Value format",
    });
  });
  it("Q3 a Float 32-bit group", () => {
    expect(quickFormatState({ scope: [r(2, 3)], overrides: [ov(2, 3, "float32")] })).toEqual({
      checked: null,
      heading: "Value format: F32 ABCD",
    });
  });
  it("Q4 mixed", () => {
    expect(
      quickFormatState({
        scope: [r(0, 3)],
        overrides: [ov(0, 1, "float32"), ov(2, 3, "hex")],
      }),
    ).toEqual({ checked: null, heading: "Value format: mixed" });
  });
  it("Q5 Signed next to Unsigned is mixed", () => {
    expect(quickFormatState({ scope: [r(6, 7)], overrides: [ov(6, 6, "signed")] })).toEqual({
      checked: null,
      heading: "Value format: mixed",
    });
  });
  it("Q6 Unsigned 64-bit little-endian", () => {
    expect(
      quickFormatState({ scope: [r(0, 3)], overrides: [ov(0, 3, "unsigned64", false, true)] }),
    ).toEqual({ checked: null, heading: "Value format: U64 GHEFCDAB" });
  });
  it("Q7 edge-cut group row", () => {
    expect(quickFormatState({ scope: [r(101)], overrides: [ov(100, 101, "float32")] })).toEqual({
      checked: null,
      heading: "Value format: F32 ABCD",
    });
  });
  it("an empty scope checks nothing", () => {
    expect(quickFormatState({ scope: [], overrides: [] })).toEqual({
      checked: null,
      heading: "Value format",
    });
  });
});
