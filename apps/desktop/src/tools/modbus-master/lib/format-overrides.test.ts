import { describe, expect, it } from "vitest";
import type { FormatOverride, ValueFormat } from "@/shared/ipc/modbus-master.types";
import { checkFormatOverrides } from "../../../shared/ipc/fake-validation";
import {
  type Cut,
  cutGroups,
  type FormatRow,
  flagsOf,
  formatAt,
  formatCode,
  formatName,
  formatRows,
  formatWidth,
  normalizeOverrides,
  type OrderId,
  orderOf,
  type Plan,
  planFormatChange,
  rowAt,
  scopeFormats,
  snapRangesToRows,
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

/** "0-1 F32 BE", "2-3 HEX", "4 S16" -> an override (DES-009 7.1 notation). */
function ov(text: string): FormatOverride {
  const [span = "", code = "", order = "BE"] = text.split(" ");
  const [a = "0", b = a] = span.split("-");
  const format = SHORT[code] as ValueFormat;
  const flags = formatWidth(format) === 1 ? flagsOf("big") : flagsOf(ORDERS[order] as OrderId);
  return { start: Number(a), end: Number(b), format, ...flags };
}
const list = (...items: string[]) => items.map(ov);
const range = (text: string) => {
  const [a = "0", b = a] = text.split("-");
  return { start: Number(a), end: Number(b) };
};
const POLL_0_9 = { start: 0, end: 9 };

function plan(
  overrides: FormatOverride[],
  scope: string[],
  choice: [string, OrderId?],
  pollRange = POLL_0_9,
): Plan {
  return planFormatChange({
    overrides,
    scope: scope.map(range),
    choice: { format: SHORT[choice[0]] as ValueFormat, order: choice[1] ?? "big" },
    pollRange,
  });
}
function ok(p: Plan) {
  if (p.kind !== "ok") throw new Error(`expected ok, got ${p.kind}`);
  return p;
}

describe("helpers", () => {
  it("knows the width of every format", () => {
    expect(
      (
        [
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
        ] as ValueFormat[]
      ).map(formatWidth),
    ).toEqual([1, 1, 1, 1, 2, 2, 2, 4, 4, 4]);
  });

  it("maps the four named orders to the two flags and back", () => {
    expect(flagsOf("big")).toEqual({ swapBytes: false, reverseWords: false });
    expect(flagsOf("little")).toEqual({ swapBytes: true, reverseWords: true });
    expect(flagsOf("bigByteSwap")).toEqual({ swapBytes: true, reverseWords: false });
    expect(flagsOf("littleByteSwap")).toEqual({ swapBytes: false, reverseWords: true });
    for (const id of ["big", "little", "bigByteSwap", "littleByteSwap"] as const) {
      expect(orderOf(flagsOf(id))).toBe(id);
    }
  });

  it("builds the short code and the full name (DES-009 section 1)", () => {
    expect(formatCode("unsigned", "big")).toBe("U16");
    expect(formatCode("hex", "little")).toBe("HEX");
    expect(formatCode("float32", "big")).toBe("F32 ABCD");
    expect(formatCode("float32", "littleByteSwap")).toBe("F32 CDAB");
    expect(formatCode("unsigned64", "littleByteSwap")).toBe("U64 GHEFCDAB");
    expect(formatCode("signed64", "little")).toBe("S64 HGFEDCBA");
    expect(formatCode("signed32", "bigByteSwap")).toBe("S32 BADC");
    expect(formatName("unsigned", "big")).toBe("Unsigned");
    expect(formatName("float32", "littleByteSwap")).toBe(
      "Float 32-bit, Little-endian byte swap (CDAB)",
    );
    expect(formatName("float64", "bigByteSwap")).toBe(
      "Float 64-bit (Double), Big-endian byte swap (BADCFEHG)",
    );
  });

  it("formatAt returns the default for an uncovered address", () => {
    const o = list("2-5 F32 LS");
    expect(formatAt(o, 1)).toEqual({ format: "unsigned", order: "big", override: null });
    expect(formatAt(o, 3)).toMatchObject({ format: "float32", order: "littleByteSwap" });
    expect(formatAt(o, 3).override).toBe(o[0]);
    expect(formatAt(o, 6).override).toBeNull();
    expect(formatAt([], 0).format).toBe("unsigned");
  });

  it("normalizeOverrides drops defaults, sorts and merges neighbours", () => {
    expect(normalizeOverrides([ov("4-5 HEX"), ov("0-1 U16"), ov("2-3 HEX"), ov("7 BIN")])).toEqual(
      list("2-5 HEX", "7 BIN"),
    );
  });
});

describe("planFormatChange vectors P1-P36 (DES-009 7.1)", () => {
  it("P1 Float32 BE on 2-5", () => {
    const p = ok(plan([], ["2-5"], ["F32"]));
    expect(p.overrides).toEqual(list("2-5 F32 BE"));
    expect(p.groups).toEqual([range("2-3"), range("4-5")]);
    expect(p.cuts).toEqual([]);
    expect(p.unchanged).toBe(false);
  });
  it("P2 three registers complete the second 32-bit value", () => {
    const p = ok(plan([], ["2-4"], ["F32"]));
    expect(p.groups).toEqual([range("2-3"), range("4-5")]);
    expect(p.added).toEqual([range("5")]);
  });
  it("P3 three registers complete one 64-bit value", () => {
    const p = ok(plan([], ["2-4"], ["U64"]));
    expect(p.groups).toEqual([range("2-5")]);
    expect(p.added).toEqual([range("5")]);
  });
  it("P4 Unsigned64 on 2-5", () => {
    const p = ok(plan([], ["2-5"], ["U64"]));
    expect(p.overrides).toEqual(list("2-5 U64 BE"));
    expect(p.groups).toEqual([range("2-5")]);
  });
  it("P5 Hex on every row", () => {
    expect(ok(plan([], ["0-9"], ["HEX"])).overrides).toEqual(list("0-9 HEX"));
  });
  it("P6 Unsigned removes the override", () => {
    expect(ok(plan(list("0-9 HEX"), ["0-9"], ["U16"])).overrides).toEqual([]);
  });
  it("P7 Hex inside a Float32 override splits it at group boundaries", () => {
    const p = ok(plan(list("0-7 F32 BE"), ["2-3"], ["HEX"]));
    expect(p.overrides).toEqual(list("0-1 F32 BE", "2-3 HEX", "4-7 F32 BE"));
    expect(p.cuts).toEqual([]);
  });
  it("P8 Unsigned inside a Float32 override", () => {
    expect(ok(plan(list("0-7 F32 BE"), ["2-3"], ["U16"])).overrides).toEqual(
      list("0-1 F32 BE", "4-7 F32 BE"),
    );
  });
  it("P9 equal neighbours merge", () => {
    expect(ok(plan(list("0-1 F32 BE", "4-5 F32 BE"), ["2-3"], ["F32"])).overrides).toEqual(
      list("0-5 F32 BE"),
    );
  });
  it("P10 different flags do not merge", () => {
    expect(
      ok(plan(list("0-1 F32 BE", "4-5 F32 BE"), ["2-3"], ["F32", "little"])).overrides,
    ).toEqual(list("0-1 F32 BE", "2-3 F32 LE", "4-5 F32 BE"));
  });
  it("P11 blocks with a gap never merge", () => {
    const p = ok(plan([], ["2-3", "6-9"], ["F32"]));
    expect(p.overrides).toEqual(list("2-3 F32 BE", "6-9 F32 BE"));
    expect(p.groups).toEqual([range("2-3"), range("6-7"), range("8-9")]);
  });
  it("P12 completes one block of several", () => {
    const p = ok(plan([], ["2-3", "6-8"], ["F32"]));
    expect(p.groups).toEqual([range("2-3"), range("6-7"), range("8-9")]);
    expect(p.added).toEqual([range("9")]);
  });
  it("P13 completes each separate block", () => {
    const p = ok(plan([], ["1-3", "6-8"], ["F32"]));
    expect(p.groups).toEqual([range("1-2"), range("3-4"), range("6-7"), range("8-9")]);
    expect(p.added).toEqual([range("4"), range("9")]);
  });
  it("P14 touching ranges are one block", () => {
    const p = ok(plan([], ["2-2", "3-3"], ["F32"]));
    expect(p.overrides).toEqual(list("2-3 F32 BE"));
  });
  it("P15 Binary inside Hex", () => {
    expect(ok(plan(list("0-9 HEX"), ["3-4"], ["BIN"])).overrides).toEqual(
      list("0-2 HEX", "3-4 BIN", "5-9 HEX"),
    );
  });
  it("P16 Hex next to Hex merges", () => {
    expect(ok(plan(list("0-2 HEX"), ["3-5"], ["HEX"])).overrides).toEqual(list("0-5 HEX"));
  });
  it("P17 the same format again is unchanged", () => {
    const p = ok(plan(list("2-5 F32 BE"), ["2-5"], ["F32"]));
    expect(p.unchanged).toBe(true);
    expect(p.overrides).toEqual(list("2-5 F32 BE"));
  });
  it("P18 Float32 to Float64", () => {
    const p = ok(plan(list("0-3 F32 BE"), ["0-3"], ["F64"]));
    expect(p.overrides).toEqual(list("0-3 F64 BE"));
    expect(p.groups).toEqual([range("0-3")]);
  });
  it("P19 Float32 LE on a larger block", () => {
    const p = ok(plan(list("0-3 F32 LE"), ["0-5"], ["F32", "little"]));
    expect(p.overrides).toEqual(list("0-5 F32 LE"));
    expect(p.groups).toEqual([range("0-1"), range("2-3"), range("4-5")]);
  });
  it("P20 a 16-bit format drops the order flags", () => {
    const p = ok(plan([], ["0-0"], ["HEX", "little"]));
    expect(p.overrides).toEqual([
      { start: 0, end: 0, format: "hex", swapBytes: false, reverseWords: false },
    ]);
  });
  it("P21 Unsigned next to a Hex override leaves the Hex one", () => {
    expect(ok(plan(list("0-3 F32 BE", "4-4 HEX"), ["0-3"], ["U16"])).overrides).toEqual(
      list("4-4 HEX"),
    );
  });
  it("P22 a cut at the poll start reports the register outside the poll", () => {
    const p = ok(plan(list("100-101 F32 BE"), ["101"], ["HEX"], { start: 101, end: 104 }));
    expect(p.overrides).toEqual(list("101-101 HEX"));
    expect(p.cuts).toEqual<Cut[]>([
      {
        cut: range("100"),
        group: range("100-101"),
        format: "float32",
        outsidePoll: [range("100")],
      },
    ]);
  });
  it("P23 Unsigned (Ctrl+1) on the same cut", () => {
    const p = ok(plan(list("100-101 F32 BE"), ["101"], ["U16"], { start: 101, end: 104 }));
    expect(p.overrides).toEqual([]);
    expect(p.cuts).toHaveLength(1);
    expect(p.cuts[0]?.cut).toEqual(range("100"));
  });
  it("P24 a 64-bit group cut on both sides of the poll", () => {
    const p = ok(plan(list("98-105 F64 BE"), ["100-103"], ["S16"], { start: 100, end: 103 }));
    expect(p.overrides).toEqual(list("100-103 S16"));
    expect(p.cuts).toEqual<Cut[]>([
      {
        cut: range("98-99"),
        group: range("98-101"),
        format: "float64",
        outsidePoll: [range("98-99")],
      },
      {
        cut: range("104-105"),
        group: range("102-105"),
        format: "float64",
        outsidePoll: [range("104-105")],
      },
    ]);
  });
  it("P25 a partial selection resets the rest of the cut groups", () => {
    const p = ok(plan(list("0-7 F32 BE"), ["3-4"], ["HEX"]));
    expect(p.overrides).toEqual(list("0-1 F32 BE", "3-4 HEX", "6-7 F32 BE"));
    expect(p.cuts.map((c) => [c.cut, c.group])).toEqual([
      [range("2"), range("2-3")],
      [range("5"), range("4-5")],
    ]);
    expect(p.cuts.every((c) => c.outsidePoll.length === 0)).toBe(true);
  });
  it("P26 the last two registers take a 32-bit group", () => {
    const p = ok(plan([], ["65534-65535"], ["F32"], { start: 65534, end: 65535 }));
    expect(p.overrides).toEqual(list("65534-65535 F32 BE"));
  });
  it("P27 the last four registers take a 64-bit group", () => {
    const p = ok(plan([], ["65532-65535"], ["F64"], { start: 65532, end: 65535 }));
    expect(p.overrides).toEqual(list("65532-65535 F64 BE"));
  });
  it("P28 one register at the address limit stays 16-bit", () => {
    const p = ok(plan([], ["65535"], ["F32"], { start: 65535, end: 65535 }));
    expect(p.groups).toEqual([]);
    expect(p.tails).toEqual([range("65535")]);
    expect(p.overrides).toEqual([]);
  });
  it("P29 a one-register poll takes Signed", () => {
    expect(ok(plan([], ["0"], ["S16"], { start: 0, end: 0 })).overrides).toEqual(list("0-0 S16"));
  });
  const many = Array.from({ length: 255 }, (_, i) => `${1000 + 2 * i} HEX`);
  it("P30 more than 256 overrides is refused", () => {
    expect(plan(list(...many), ["0-0", "2-2"], ["HEX"])).toEqual({ kind: "tooMany", count: 257 });
  });
  it("P31 removing never fails the cap", () => {
    const p = ok(plan(list("0-0 HEX", ...many), ["0-0"], ["U16"]));
    expect(p.overrides).toHaveLength(255);
  });
  it("P32 an empty scope", () => {
    expect(plan([], [], ["HEX"])).toEqual({ kind: "empty" });
  });
  it("P33 select all of 125 registers leaves the last register 16-bit", () => {
    const p = ok(plan([], ["0-124"], ["F32"], { start: 0, end: 124 }));
    expect(p.groups).toHaveLength(62);
    expect(p.tails).toEqual([range("124")]);
  });
  it("P34 124 registers make 62 groups", () => {
    const p = ok(plan([], ["0-123"], ["F32"], { start: 0, end: 124 }));
    expect(p.overrides).toEqual(list("0-123 F32 BE"));
    expect(p.groups).toHaveLength(62);
  });
  it("P35 byte-swap orders keep their own flags", () => {
    expect(ok(plan(list("0-5 F32 BS"), ["2-3"], ["F32", "littleByteSwap"])).overrides).toEqual(
      list("0-1 F32 BS", "2-3 F32 LS", "4-5 F32 BS"),
    );
  });
  it("P36 an override outside the poll is kept and not merged", () => {
    expect(ok(plan(list("10-13 U64 BE"), ["0-9"], ["HEX"])).overrides).toEqual(
      list("0-9 HEX", "10-13 U64 BE"),
    );
  });
});

describe("formatRows vectors L1-L11 (DES-009 7.2)", () => {
  /** `address-endAddress CODE` plus "!" for an incomplete row, "address" alone for a single register. */
  const text = (rows: FormatRow[]) =>
    rows.map((r) => {
      const span = r.address === r.endAddress ? `${r.address}` : `${r.address}-${r.endAddress}`;
      const code =
        r.width === 1
          ? r.format === "unsigned"
            ? "U16"
            : r.format === "hex"
              ? "HEX"
              : r.format
          : `${r.format === "float32" ? "F32" : r.format === "float64" ? "F64" : "U64"}`;
      return `${span} ${code}${r.complete ? "" : " incomplete"}`;
    });

  it("L1", () => {
    const rows = formatRows(0, 10, list("2-5 F32 BE"));
    expect(text(rows)).toEqual([
      "0 U16",
      "1 U16",
      "2-3 F32",
      "4-5 F32",
      "6 U16",
      "7 U16",
      "8 U16",
      "9 U16",
    ]);
    expect(rows).toHaveLength(8);
    expect(rows[2]).toMatchObject({ groupStart: 2, groupEnd: 3, width: 2, complete: true });
  });
  it("L2 migrated Float32 LE with a trailing incomplete group", () => {
    const rows = formatRows(100, 5, list("100-105 F32 LE"));
    expect(text(rows)).toEqual(["100-101 F32", "102-103 F32", "104 F32 incomplete"]);
    expect(rows[2]).toMatchObject({ groupStart: 104, groupEnd: 105, order: "little" });
  });
  it("L3 a group cut at the poll start", () => {
    const rows = formatRows(101, 4, list("100-101 F32 BE"));
    expect(text(rows)).toEqual(["101 F32 incomplete", "102 U16", "103 U16", "104 U16"]);
    expect(rows[0]).toMatchObject({ groupStart: 100, groupEnd: 101 });
  });
  it("L4", () => {
    const rows = formatRows(0, 1, list("0-3 F64 BE"));
    expect(text(rows)).toEqual(["0 F64 incomplete"]);
    expect(rows[0]).toMatchObject({ groupStart: 0, groupEnd: 3 });
  });
  it("L5", () => {
    expect(text(formatRows(65535, 1, []))).toEqual(["65535 U16"]);
  });
  it("L6", () => {
    expect(text(formatRows(0, 3, list("1-1 HEX")))).toEqual(["0 U16", "1 HEX", "2 U16"]);
  });
  it("L7 an override outside the poll is ignored", () => {
    expect(text(formatRows(0, 4, list("10-13 U64 BE")))).toEqual([
      "0 U16",
      "1 U16",
      "2 U16",
      "3 U16",
    ]);
  });
  it("L8", () => {
    expect(text(formatRows(1, 5, list("1-4 F32 BE", "5-5 HEX")))).toEqual([
      "1-2 F32",
      "3-4 F32",
      "5 HEX",
    ]);
  });
  it("L9", () => {
    const rows = formatRows(0, 3, list("0-3 U64 BE"));
    expect(text(rows)).toEqual(["0-2 U64 incomplete"]);
  });
  it("L10 groups are counted from the override start, not the poll start", () => {
    expect(text(formatRows(2, 6, list("0-7 F32 BE")))).toEqual(["2-3 F32", "4-5 F32", "6-7 F32"]);
  });
  it("L11", () => {
    expect(text(formatRows(3, 4, list("0-7 F32 BE")))).toEqual([
      "3 F32 incomplete",
      "4-5 F32",
      "6 F32 incomplete",
    ]);
  });
});

describe("row helpers", () => {
  const rows = formatRows(0, 10, list("2-5 F32 BE"));
  it("rowAt finds the row that contains an address", () => {
    expect(rowAt(rows, 0)).toBe(0);
    expect(rowAt(rows, 2)).toBe(2);
    expect(rowAt(rows, 3)).toBe(2);
    expect(rowAt(rows, 5)).toBe(3);
    expect(rowAt(rows, 9)).toBe(7);
    expect(rowAt(rows, 10)).toBe(-1);
    expect(rowAt(rows, -1)).toBe(-1);
    expect(rowAt([], 0)).toBe(-1);
  });
  it("snapRangesToRows widens to whole rows and clips to the poll", () => {
    expect(snapRangesToRows(rows, [range("3-3")])).toEqual([range("2-3")]);
    expect(snapRangesToRows(rows, [range("1-3"), range("5-6")])).toEqual([range("1-6")]);
    expect(snapRangesToRows(rows, [range("8-20")])).toEqual([range("8-9")]);
    expect(snapRangesToRows(rows, [range("20-30")])).toEqual([]);
    expect(snapRangesToRows([], [range("1-2")])).toEqual([]);
  });
  it("formatRows covers the range once, in order, inside the poll", () => {
    for (const [start, quantity, overrides] of [
      [0, 10, list("2-5 F32 BE")],
      [101, 4, list("100-101 F32 BE")],
      [3, 4, list("0-7 F32 BE")],
      [0, 125, list("0-123 F32 LE", "124-124 HEX")],
      [65532, 4, list("65532-65535 F64 LS")],
    ] as const) {
      const out = formatRows(start, quantity, overrides);
      expect(out[0]?.address).toBe(start);
      expect(out[out.length - 1]?.endAddress).toBe(start + quantity - 1);
      out.forEach((row, i) => {
        expect(row.address).toBeGreaterThanOrEqual(start);
        expect(row.endAddress).toBeLessThanOrEqual(start + quantity - 1);
        if (i > 0) expect(row.address).toBe((out[i - 1] as FormatRow).endAddress + 1);
      });
    }
  });
});

describe("scopeFormats", () => {
  it("lists the distinct formats of the scope in address order", () => {
    const o = list("2-3 F32 LE", "6-6 HEX");
    expect(scopeFormats([range("0-9")], o)).toEqual([
      { format: "unsigned", order: "big" },
      { format: "float32", order: "little" },
      { format: "hex", order: "big" },
    ]);
    expect(scopeFormats([range("2-3")], o)).toEqual([{ format: "float32", order: "little" }]);
    expect(scopeFormats([range("4-5")], o)).toEqual([{ format: "unsigned", order: "big" }]);
    expect(scopeFormats([range("2-3"), range("6-6")], o)).toHaveLength(2);
    expect(scopeFormats([], o)).toEqual([]);
  });
});

describe("cutGroups (DES-009 6.6)", () => {
  it("finds the groups the poll range cuts", () => {
    expect(cutGroups(101, 4, list("100-101 F32 BE"))).toEqual([
      { group: range("100-101"), format: "float32" },
    ]);
    expect(cutGroups(100, 5, list("100-105 F32 LE"))).toEqual([
      { group: range("104-105"), format: "float32" },
    ]);
    expect(cutGroups(0, 10, list("2-5 F32 BE"))).toEqual([]);
    expect(cutGroups(1, 1, list("0-3 F64 BE"))).toEqual([
      { group: range("0-3"), format: "float64" },
    ]);
    expect(cutGroups(0, 10, list("4-4 HEX"))).toEqual([]);
  });
  it("orders several cut groups by address", () => {
    expect(cutGroups(3, 4, list("0-7 F32 BE"))).toEqual([
      { group: range("2-3"), format: "float32" },
      { group: range("6-7"), format: "float32" },
    ]);
  });
});

describe("planFormatChange is always valid (property check)", () => {
  // A small deterministic generator, so a failure repeats.
  let seed = 12345;
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
    let cursor = base + rand(6);
    for (let i = 0, n = rand(8); i < n; i += 1) {
      const format = FORMATS[rand(FORMATS.length)] as ValueFormat;
      const width = formatWidth(format);
      const len = width * (1 + rand(4));
      if (cursor + len > 65535) break;
      const flags = width === 1 ? flagsOf("big") : flagsOf(ORDER_LIST[rand(4)] as OrderId);
      out.push({ start: cursor, end: cursor + len - 1, format, ...flags });
      cursor += len + rand(4);
    }
    return out;
  }

  it("an ok plan passes check_format_overrides, has no default or mergeable entries", () => {
    for (let round = 0; round < 3000; round += 1) {
      const base = rand(3) === 0 ? 65500 : rand(40);
      const overrides = randomOverrides(base);
      const choiceFormat = FORMATS[rand(FORMATS.length)] as ValueFormat;
      const scope = Array.from({ length: 1 + rand(3) }, () => {
        const start = base + rand(30);
        return { start, end: Math.min(65535, start + rand(9)) };
      });
      const result = planFormatChange({
        overrides,
        scope,
        choice: { format: choiceFormat, order: ORDER_LIST[rand(4)] as OrderId },
        pollRange: { start: base, end: Math.min(65535, base + 40) },
      });
      if (result.kind !== "ok") continue;
      expect(checkFormatOverrides(result.overrides)).toBeNull();
      expect(result.overrides.length).toBeLessThanOrEqual(256);
      for (const [i, o] of result.overrides.entries()) {
        expect(o.format === "unsigned" && !o.swapBytes && !o.reverseWords).toBe(false);
        const next = result.overrides[i + 1];
        if (next && o.end + 1 === next.start) {
          expect(
            o.format === next.format &&
              o.swapBytes === next.swapBytes &&
              o.reverseWords === next.reverseWords,
          ).toBe(false);
        }
      }
      // Completed groups have the chosen format; an end-of-poll tail remains Unsigned.
      for (const group of result.groups)
        for (let a = group.start; a <= group.end; a += 1) {
          expect(formatAt(result.overrides, a).format).toBe(choiceFormat);
        }
    }
  });
});
