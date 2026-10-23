// Revision 2 vectors of DES-009 section 11 (FE-009 R2-01): WR1-WR8 (widenToRows), S1-S20
// (initialChoice), P37-P52 (planFormatChange), L12 (formatRows), and the property checks of the
// preselection and of widenToRows. The SF1-SF21 fix suggestions went with D-010-01 (FE-010 task 02).
import { describe, expect, it } from "vitest";
import type { FormatOverride, ValueFormat } from "@/shared/ipc/modbus-master.types";
import { type AddressRange, normalizeRanges } from "./address-ranges";
import {
  type FormatRow,
  flagsOf,
  formatRows,
  formatWidth,
  type InitialChoice,
  initialChoice,
  type OrderId,
  type Plan,
  planFormatChange,
  widenToRows,
} from "./format-overrides";

const SHORT: Record<string, ValueFormat> = {
  U16: "unsigned",
  S16: "signed",
  HEX: "hex",
  BIN: "binary",
  U32: "unsigned32",
  S32: "signed32",
  F32: "float32",
  U64: "unsigned64",
  S64: "signed64",
  F64: "float64",
};
const ORDERS: Record<string, OrderId> = {
  BE: "big",
  LE: "little",
  BS: "bigByteSwap",
  LS: "littleByteSwap",
};

/** "0-1 F32 BE", "2-3 HEX" -> an override (DES-009 7.1 notation). */
function ov(text: string): FormatOverride {
  const [span = "", code = "", order = "BE"] = text.split(" ");
  const [a = "0", b = a] = span.split("-");
  const format = SHORT[code] as ValueFormat;
  const flags = formatWidth(format) === 1 ? flagsOf("big") : flagsOf(ORDERS[order] as OrderId);
  return { start: Number(a), end: Number(b), format, ...flags };
}
const list = (...items: string[]) => items.map(ov);
const range = (text: string): AddressRange => {
  const [a = "0", b = a] = text.split("-");
  return { start: Number(a), end: Number(b) };
};
const pollOf = (start: number, end: number) => ({ start, end });
const rowsFor = (start: number, end: number, overrides: FormatOverride[]) =>
  formatRows(start, end - start + 1, overrides);

describe("widenToRows vectors WR1-WR8 (DES-009 11.2)", () => {
  const widen = (start: number, end: number, overrides: FormatOverride[], scope: string[]) =>
    widenToRows(scope.map(range), rowsFor(start, end, overrides));

  it("WR1 the owner's screenshot: register 0 of [0-9 S32 BS] becomes row 0-1", () => {
    expect(widen(0, 9, list("0-9 S32 BS"), ["0"])).toEqual([range("0-1")]);
  });
  it("WR2 a register of a group becomes the whole group", () => {
    expect(widen(0, 9, list("2-5 F32 BE"), ["3"])).toEqual([range("2-3")]);
  });
  it("WR3 two groups", () => {
    expect(widen(0, 9, list("2-5 F32 BE"), ["3-4"])).toEqual([range("2-5")]);
  });
  it("WR4 a gap between two scope ranges is kept", () => {
    expect(widen(0, 9, list("2-5 F32 BE"), ["0", "3"])).toEqual([range("0"), range("2-3")]);
  });
  it("WR5 a group cut by the poll start keeps only its in-poll registers", () => {
    expect(widen(101, 104, list("100-101 F32 BE"), ["100-101"])).toEqual([range("101")]);
  });
  it("WR6 groups counted from the override start", () => {
    expect(widen(3, 6, list("0-7 F32 BE"), ["4"])).toEqual([range("4-5")]);
  });
  it("WR7 an incomplete row is its in-poll part", () => {
    expect(widen(3, 6, list("0-7 F32 BE"), ["6"])).toEqual([range("6")]);
  });
  it("WR8 an empty scope stays empty", () => {
    expect(widen(0, 9, [], [])).toEqual([]);
  });
  it("clips to the poll and merges touching rows", () => {
    expect(widen(0, 9, list("2-5 F32 BE"), ["2", "4", "12-14"])).toEqual([range("2-5")]);
  });
});

describe("initialChoice vectors S1-S20 (DES-009 11.3)", () => {
  function choice(
    poll: [number, number],
    overrides: FormatOverride[],
    scope: string[],
  ): InitialChoice {
    return initialChoice({
      overrides,
      scope: scope.map(range),
      pollRange: pollOf(poll[0], poll[1]),
    });
  }
  function expectChoice(
    got: InitialChoice,
    format: ValueFormat,
    order: OrderId,
    mixed: boolean,
    source: InitialChoice["source"],
  ) {
    expect(got).toEqual({ format, order, mixed, source });
  }
  /** The plan of the choice for the same input: the dialog state at open. */
  function planOf(
    poll: [number, number],
    overrides: FormatOverride[],
    scope: string[],
    c: InitialChoice,
  ): Plan {
    return planFormatChange({
      overrides,
      scope: scope.map(range),
      choice: { format: c.format, order: c.order },
      pollRange: pollOf(poll[0], poll[1]),
    });
  }

  it("S1 the owner scenario after the fix: row 0-1 of [0-9 S32 BS] is unchanged", () => {
    const o = list("0-9 S32 BS");
    const c = choice([0, 9], o, ["0-1"]);
    expectChoice(c, "signed32", "bigByteSwap", false, "current");
    const p = planOf([0, 9], o, ["0-1"], c);
    expect(p.kind === "ok" && p.unchanged).toBe(true);
  });
  it("S2 one register of a combined value keeps its current choice", () => {
    const o = list("0-9 S32 BS");
    const c = choice([0, 9], o, ["0"]);
    expectChoice(c, "signed32", "bigByteSwap", false, "current");
    const p = planOf([0, 9], o, ["0"], c);
    expect(p.kind).toBe("ok");
    if (p.kind !== "ok") return;
    expect(p.overrides).toEqual(o);
    expect(p.cuts).toEqual([]);
  });
  it("S3, S4 the default poll", () => {
    expectChoice(choice([0, 9], [], ["0"]), "unsigned", "big", false, "current");
    expectChoice(choice([0, 9], [], ["0-9"]), "unsigned", "big", false, "current");
  });
  it("S5, S6 one 32/64-bit format that fits", () => {
    expectChoice(choice([0, 9], list("2-5 F32 BE"), ["2-5"]), "float32", "big", false, "current");
    expectChoice(
      choice([0, 9], list("0-3 U64 LS"), ["0-3"]),
      "unsigned64",
      "littleByteSwap",
      false,
      "current",
    );
  });
  it("S7 a group and a default register: mixed rows open on Unsigned (D-009-05)", () => {
    const o = list("2-3 F32 BE");
    const c = choice([0, 9], o, ["1-3"]);
    expectChoice(c, "unsigned", "big", true, "unsigned");
    expect(planOf([0, 9], o, ["1-3"], c).kind).toBe("ok");
  });
  it("S8 a group and a Hex register: mixed rows open on Unsigned, not Hex (D-009-05)", () => {
    const o = list("0-1 F32 LE", "2-2 HEX");
    const c = choice([0, 9], o, ["0-2"]);
    expectChoice(c, "unsigned", "big", true, "unsigned");
    const p = planOf([0, 9], o, ["0-2"], c);
    expect(p.kind === "ok" && p.overrides).toEqual([]);
  });
  it("S9 several 16-bit formats: Unsigned", () => {
    expectChoice(
      choice([0, 9], list("0-0 HEX", "1-1 BIN", "2-3 F32 BE"), ["0-3"]),
      "unsigned",
      "big",
      true,
      "unsigned",
    );
  });
  it("S10 one 16-bit format", () => {
    expectChoice(choice([0, 9], list("0-1 S16"), ["0-1"]), "signed", "big", false, "current");
  });
  it("S11 an edge-cut group row keeps Float32 and lists the cut", () => {
    const o = list("100-101 F32 BE");
    const c = choice([101, 104], o, ["101"]);
    expectChoice(c, "float32", "big", false, "current");
    const p = planOf([101, 104], o, ["101"], c);
    expect(p.kind === "ok" && p.cuts).toEqual([
      {
        cut: range("100"),
        group: range("100-101"),
        format: "float32",
        outsidePoll: [range("100")],
      },
    ]);
  });
  it("S12 both edges cut a 64-bit group", () => {
    const o = list("100-103 U64 BE");
    const c = choice([101, 102], o, ["101-102"]);
    expectChoice(c, "unsigned64", "big", false, "current");
    const p = planOf([101, 102], o, ["101-102"], c);
    expect(p.kind === "ok" && p.cuts.map((x) => x.cut)).toEqual([range("100"), range("103")]);
  });
  it("S13 two blocks, group and default registers", () => {
    expectChoice(
      choice([0, 9], list("2-5 F32 BE"), ["2-5", "8-9"]),
      "unsigned",
      "big",
      true,
      "unsigned",
    );
  });
  it("S14 select all of 125", () => {
    expectChoice(choice([0, 124], [], ["0-124"]), "unsigned", "big", false, "current");
  });
  it("S15 every candidate over 256 overrides: Unsigned, the cap blocks", () => {
    const many = Array.from({ length: 127 }, (_, i) => ov(`${1000 + 4 * i}-${1000 + 4 * i} HEX`));
    const more = Array.from({ length: 127 }, (_, i) => ov(`${1002 + 4 * i}-${1002 + 4 * i} HEX`));
    const o = [...many, ...more, ...list("0-4 HEX", "5-9 BIN")].sort((a, b) => a.start - b.start);
    expect(o).toHaveLength(256);
    const c = choice([0, 9], o, ["2", "7"]);
    expectChoice(c, "unsigned", "big", true, "unsigned");
    expect(planOf([0, 9], o, ["2", "7"], c)).toEqual({ kind: "tooMany", count: 258 });
  });
  it("S16 the first of two groups", () => {
    expectChoice(
      choice([0, 9], list("0-1 F32 BE", "2-9 S32 BS"), ["0-1"]),
      "float32",
      "big",
      false,
      "current",
    );
  });
  it("S17 a group and a default register", () => {
    expectChoice(choice([0, 9], list("0-1 F32 BE"), ["0-2"]), "unsigned", "big", true, "unsigned");
  });
  it("S18 16-bit formats Unsigned and Hex among groups: Unsigned", () => {
    expectChoice(
      choice([0, 9], list("0-1 F32 BE", "4-5 S32 BS", "6-7 HEX", "8-9 S32 BS"), ["3-6"]),
      "unsigned",
      "big",
      true,
      "unsigned",
    );
  });
  it("S19 Hex and a group: Unsigned (D-009-05); the 16-bit rows return to the default", () => {
    const o = list("0-1 F32 BE", "3-6 S32 BE", "7-7 HEX", "8-9 S32 BS");
    const c = choice([0, 9], o, ["7-9"]);
    expectChoice(c, "unsigned", "big", true, "unsigned");
    const p = planOf([0, 9], o, ["7-9"], c);
    expect(p.kind === "ok" && p.overrides).toEqual(list("0-1 F32 BE", "3-6 S32 BE"));
  });
  it("S20 the poll edges cut a 64-bit override that spans it", () => {
    const o = list("98-105 F64 BE");
    const c = choice([100, 103], o, ["100-103"]);
    expectChoice(c, "float64", "big", false, "current");
    const p = planOf([100, 103], o, ["100-103"], c);
    expect(p.kind === "ok" && p.overrides).toEqual(list("100-103 F64 BE"));
    expect(p.kind === "ok" && p.cuts.map((x) => [x.cut, x.group, x.outsidePoll])).toEqual([
      [range("98-99"), range("98-101"), [range("98-99")]],
      [range("104-105"), range("102-105"), [range("104-105")]],
    ]);
  });
});

describe("planFormatChange vectors P37-P52 (DES-009 11.5)", () => {
  function run(
    poll: [number, number],
    overrides: FormatOverride[],
    scope: string[],
    code: string,
    order: OrderId = "big",
  ): Plan {
    return planFormatChange({
      overrides,
      scope: scope.map(range),
      choice: { format: SHORT[code] as ValueFormat, order },
      pollRange: pollOf(poll[0], poll[1]),
    });
  }
  const ok = (p: Plan) => {
    if (p.kind !== "ok") throw new Error(`expected ok, got ${p.kind}`);
    return p;
  };

  it("P37 the owner's step 1: row 0-1 gets Float32, the other groups keep S32 BADC", () => {
    const p = ok(run([0, 9], list("0-9 S32 BS"), ["0-1"], "F32"));
    expect(p.overrides).toEqual(list("0-1 F32 BE", "2-9 S32 BS"));
    expect(p.cuts).toEqual([]);
  });
  it("P38 a partial scope resets the other half of the group", () => {
    const p = ok(run([0, 9], list("0-9 S32 BS"), ["0"], "HEX"));
    expect(p.overrides).toEqual(list("0-0 HEX", "2-9 S32 BS"));
    expect(p.cuts.map((c) => [c.cut, c.group, c.format])).toEqual([
      [range("1"), range("0-1"), "signed32"],
    ]);
  });
  it("P39", () => {
    const p = ok(run([0, 9], list("0-9 S32 BS"), ["0"], "U16"));
    expect(p.overrides).toEqual(list("2-9 S32 BS"));
    expect(p.cuts.map((c) => c.cut)).toEqual([range("1")]);
  });
  it("P40 one register completes Signed32 with the following register", () => {
    const p = ok(run([0, 9], list("0-9 S32 BS"), ["0"], "S32", "bigByteSwap"));
    expect(p.groups).toEqual([range("0-1")]);
    expect(p.added).toEqual([range("1")]);
  });
  it("P41 two cuts of one 64-bit group", () => {
    const p = ok(run([0, 9], list("0-7 U64 BE"), ["1-2"], "HEX"));
    expect(p.overrides).toEqual(list("1-2 HEX", "4-7 U64 BE"));
    expect(p.cuts.map((c) => [c.cut, c.group])).toEqual([
      [range("0"), range("0-3")],
      [range("3"), range("0-3")],
    ]);
  });
  it("P42-P45 the mixed acceptance, step by step", () => {
    let o = ok(run([0, 9], [], ["0-1"], "F32")).overrides;
    expect(o).toEqual(list("0-1 F32 BE"));
    const same = ok(run([0, 9], o, ["2"], "U16"));
    expect(same.unchanged).toBe(true);
    o = ok(run([0, 9], o, ["3-6"], "S32")).overrides;
    expect(o).toEqual(list("0-1 F32 BE", "3-6 S32 BE"));
    o = ok(run([0, 9], o, ["7-9"], "HEX")).overrides;
    expect(o).toEqual(list("0-1 F32 BE", "3-6 S32 BE", "7-9 HEX"));
  });
  it("P46 the other order of steps gives the same list, not merged", () => {
    const p = ok(run([0, 9], list("7-9 HEX"), ["3-6"], "S32"));
    expect(p.overrides).toEqual(list("3-6 S32 BE", "7-9 HEX"));
  });
  it("P47 Unsigned on one group of a block removes it", () => {
    const p = ok(run([0, 9], list("0-1 F32 BE", "2-9 S32 BS"), ["2-3"], "U16"));
    expect(p.overrides).toEqual(list("0-1 F32 BE", "4-9 S32 BS"));
    expect(p.cuts).toEqual([]);
  });
  it("P48 Hex on a whole group inside a block splits it at group boundaries", () => {
    const p = ok(run([0, 9], list("0-1 F32 BE", "4-9 S32 BS"), ["6-7"], "HEX"));
    expect(p.overrides).toEqual(list("0-1 F32 BE", "4-5 S32 BS", "6-7 HEX", "8-9 S32 BS"));
    expect(p.cuts).toEqual([]);
  });
  it("P49 a block over a group boundary replaces what it covers", () => {
    const p = ok(
      run([0, 9], list("0-1 F32 BE", "4-5 S32 BS", "6-7 HEX", "8-9 S32 BS"), ["3-6"], "S32"),
    );
    expect(p.overrides).toEqual(list("0-1 F32 BE", "3-6 S32 BE", "7-7 HEX", "8-9 S32 BS"));
    expect(p.cuts).toEqual([]);
  });
  it("P50 Hex over the rest merges into one block (same result as P45)", () => {
    const p = ok(
      run([0, 9], list("0-1 F32 BE", "3-6 S32 BE", "7-7 HEX", "8-9 S32 BS"), ["7-9"], "HEX"),
    );
    expect(p.overrides).toEqual(list("0-1 F32 BE", "3-6 S32 BE", "7-9 HEX"));
  });
  it("P51 Unsigned on everything resets all", () => {
    expect(ok(run([0, 9], list("0-9 S32 BS"), ["0-9"], "U16")).overrides).toEqual([]);
  });
  it("P52 both edges cut one 64-bit group", () => {
    const p = ok(run([101, 102], list("100-103 U64 BE"), ["101-102"], "HEX"));
    expect(p.overrides).toEqual(list("101-102 HEX"));
    expect(p.cuts).toEqual([
      {
        cut: range("100"),
        group: range("100-103"),
        format: "unsigned64",
        outsidePoll: [range("100")],
      },
      {
        cut: range("103"),
        group: range("100-103"),
        format: "unsigned64",
        outsidePoll: [range("103")],
      },
    ]);
  });
});

describe("formatRows vector L12", () => {
  it("0-1 F32, 2 U16, 3-4 S32, 5-6 S32, 7 HEX, 8 HEX, 9 HEX", () => {
    const rows = formatRows(0, 10, list("0-1 F32 BE", "3-6 S32 BE", "7-9 HEX"));
    const text = rows.map((r) => {
      const code = r.width === 1 ? (r.format === "hex" ? "HEX" : "U16") : r.format;
      return `${r.address}${r.endAddress === r.address ? "" : `-${r.endAddress}`} ${code}${r.complete ? "" : "!"}`;
    });
    expect(text).toEqual([
      "0-1 float32",
      "2 U16",
      "3-4 signed32",
      "5-6 signed32",
      "7 HEX",
      "8 HEX",
      "9 HEX",
    ]);
  });
});

// ---- property checks (a small deterministic generator, so a failure repeats) ----
describe("property checks (R2-01)", () => {
  let seed = 424242;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const FORMATS: ValueFormat[] = [
    "unsigned",
    "signed",
    "hex",
    "binary",
    "signed32",
    "unsigned32",
    "float32",
    "signed64",
    "unsigned64",
    "float64",
  ];
  const ORDER_LIST: OrderId[] = ["big", "little", "bigByteSwap", "littleByteSwap"];

  function randomOverrides(base: number): FormatOverride[] {
    const out: FormatOverride[] = [];
    let cursor = Math.max(0, base - 3 + rand(8));
    for (let i = 0, n = rand(8); i < n; i += 1) {
      const format = FORMATS[rand(FORMATS.length)] as ValueFormat;
      const width = formatWidth(format);
      const len = width * (1 + rand(4));
      if (cursor + len > 65535) break;
      const flags = width === 1 ? flagsOf("big") : flagsOf(ORDER_LIST[rand(4)] as OrderId);
      out.push({ start: cursor, end: cursor + len - 1, format, ...flags });
      cursor += len + rand(3);
    }
    return out;
  }

  /** A random scope of whole rows inside the poll. */
  function randomScope(rows: readonly FormatRow[]): AddressRange[] {
    const picks: AddressRange[] = [];
    for (let i = 0, n = 1 + rand(3); i < n; i += 1) {
      const a = rows[rand(rows.length)] as FormatRow;
      const b = rows[Math.min(rows.length - 1, rows.indexOf(a) + rand(5))] as FormatRow;
      picks.push({ start: a.address, end: b.endAddress });
    }
    return normalizeRanges(picks);
  }

  function randomPoll() {
    const near = rand(4) === 0;
    const start = near ? 65520 + rand(10) : rand(30);
    const end = near ? 65535 : Math.min(65535, start + 1 + rand(24));
    return { start, end };
  }

  it("the preselection is ok unless every candidate is over the cap", () => {
    for (let round = 0; round < 3000; round += 1) {
      const poll = randomPoll();
      const overrides = randomOverrides(poll.start);
      const rows = formatRows(poll.start, poll.end - poll.start + 1, overrides);
      const scope = randomScope(rows);
      const c = initialChoice({ overrides, scope, pollRange: poll });
      const p = planFormatChange({
        overrides,
        scope,
        choice: { format: c.format, order: c.order },
        pollRange: poll,
      });
      if (p.kind === "ok") continue;
      // Only the cap may block, and then the Unsigned fallback was taken.
      expect(p.kind).toBe("tooMany");
      expect(c.source).toBe("unsigned");
    }
  });

  it("widenToRows covers whole rows only, stays in the poll and keeps the clipped input", () => {
    for (let round = 0; round < 3000; round += 1) {
      const poll = randomPoll();
      const overrides = randomOverrides(poll.start);
      const rows = formatRows(poll.start, poll.end - poll.start + 1, overrides);
      const raw = Array.from({ length: 1 + rand(3) }, () => {
        const s = poll.start - 2 + rand(poll.end - poll.start + 6);
        return { start: s, end: s + rand(5) };
      });
      const wide = widenToRows(raw, rows);
      for (const w of wide) {
        expect(w.start).toBeGreaterThanOrEqual(poll.start);
        expect(w.end).toBeLessThanOrEqual(poll.end);
        // starts at a row start and ends at a row end
        expect(rows.some((r) => r.address === w.start)).toBe(true);
        expect(rows.some((r) => r.endAddress === w.end)).toBe(true);
      }
      for (const r of raw)
        for (let a = Math.max(r.start, poll.start); a <= Math.min(r.end, poll.end); a += 1) {
          expect(wide.some((w) => w.start <= a && w.end >= a)).toBe(true);
        }
      // idempotent
      expect(widenToRows(wide, rows)).toEqual(wide);
    }
  });
});
