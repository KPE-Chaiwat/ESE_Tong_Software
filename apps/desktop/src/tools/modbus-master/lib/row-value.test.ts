import { describe, expect, it } from "vitest";
import type { FormatOverride } from "@/shared/ipc/modbus-master.types";
import { combinedText } from "./combined";
import { flagsOf, formatRows, type OrderId } from "./format-overrides";
import { groupRowValue } from "./row-value";

const ov = (
  start: number,
  end: number,
  format: FormatOverride["format"],
  order: OrderId = "big",
): FormatOverride => ({ start, end, format, ...flagsOf(order) });

const at = <T>(list: readonly T[], index: number): T => {
  const item = list[index];
  if (item === undefined) throw new Error(`no row ${index}`);
  return item;
};
const text = (v: ReturnType<typeof groupRowValue>) => combinedText(v.value);

describe("groupRowValue", () => {
  it("decodes a complete group from one complete snapshot (DES-006 vectors per group)", () => {
    const rows = formatRows(0, 4, [ov(0, 3, "unsigned32")]);
    const snapshot = [0x1234, 0x5678, 0xffff, 0xfffe];
    expect(text(groupRowValue(at(rows, 0), snapshot, 0, 4))).toBe("305419896");
    expect(text(groupRowValue(at(rows, 1), snapshot, 0, 4))).toBe("4294967294");
    expect(groupRowValue(at(rows, 0), snapshot, 0, 4).words).toEqual([0x1234, 0x5678]);
  });

  it("applies the order of the group", () => {
    const snapshot = [0x1234, 0x5678];
    const expected: Record<OrderId, string> = {
      big: "305419896",
      bigByteSwap: "873625686",
      littleByteSwap: "1450709556",
      little: "2018915346",
    };
    for (const order of Object.keys(expected) as OrderId[]) {
      const rows = formatRows(0, 2, [ov(0, 1, "unsigned32", order)]);
      expect(text(groupRowValue(at(rows, 0), snapshot, 0, 2))).toBe(expected[order]);
    }
  });

  it("64-bit integers stay exact", () => {
    const rows = formatRows(0, 4, [ov(0, 3, "unsigned64")]);
    expect(text(groupRowValue(at(rows, 0), [0x20, 0, 0, 1], 0, 4))).toBe("9007199254740993");
    expect(text(groupRowValue(at(rows, 0), [0xffff, 0xffff, 0xffff, 0xffff], 0, 4))).toBe(
      "18446744073709551615",
    );
  });

  it("groups are counted from the override start, not from the poll start", () => {
    const rows = formatRows(3, 4, [ov(0, 7, "unsigned32")]);
    // rows: 3 (cut) | 4-5 | 6 (cut)
    const snapshot = [9, 1, 2, 7];
    expect(groupRowValue(at(rows, 1), snapshot, 3, 4).words).toEqual([1, 2]);
    expect(text(groupRowValue(at(rows, 1), snapshot, 3, 4))).toBe("65538");
  });

  it("a row the poll edge cuts is Incomplete, with the words it has, even with data", () => {
    const rows = formatRows(1, 6, [ov(0, 7, "unsigned32")]);
    // rows: 1 (cut) | 2-3 | 4-5 | 6 (cut)
    const snapshot = [1, 2, 3, 4, 5, 6];
    const first = groupRowValue(at(rows, 0), snapshot, 1, 6);
    expect(first.value).toEqual({ kind: "incomplete", required: 2, available: 1 });
    expect(first.words).toEqual([1]);
    expect(text(groupRowValue(at(rows, 1), snapshot, 1, 6))).toBe("131075");
    const last = groupRowValue(at(rows, 3), snapshot, 1, 6);
    expect(last.value).toEqual({ kind: "incomplete", required: 2, available: 1 });
    expect(last.words).toEqual([6]);
  });

  it("trailing words after migration: two values and an Incomplete row (L2)", () => {
    const rows = formatRows(100, 5, [ov(100, 105, "float32", "little")]);
    const snapshot = [0, 0x803f, 0, 0xc03f, 7];
    expect(text(groupRowValue(at(rows, 0), snapshot, 100, 5))).toBe("1");
    expect(text(groupRowValue(at(rows, 1), snapshot, 100, 5))).toBe("1.5");
    expect(groupRowValue(at(rows, 2), snapshot, 100, 5).value).toEqual({
      kind: "incomplete",
      required: 2,
      available: 1,
    });
  });

  it("a snapshot of another length, a missing one or none gives no value and never mixes snapshots", () => {
    const rows = formatRows(1, 5, [ov(1, 6, "unsigned32")]);
    // rows: 1 (cut) | 2-3 | 4-5
    for (const snapshot of [[1, 2], null, undefined]) {
      for (const row of rows) {
        const got = groupRowValue(row, snapshot, 1, 5);
        if (row.complete) expect(got).toEqual({ words: [], value: { kind: "missing" } });
        else expect(got.value.kind).toBe("incomplete");
      }
    }
  });

  it("REPORT-030 D1: an incomplete row is Incomplete with no snapshot (L2, L3), with the in-poll count", () => {
    const l2 = formatRows(100, 5, [ov(100, 105, "float32", "little")]);
    const trailing = at(l2, 2);
    expect(groupRowValue(trailing, null, 100, 5)).toEqual({
      words: [],
      value: { kind: "incomplete", required: 2, available: 1 },
    });
    expect(groupRowValue(trailing, undefined, 100, 5).value.kind).toBe("incomplete");
    expect(groupRowValue(trailing, [1, 2], 100, 5).value).toEqual({
      kind: "incomplete",
      required: 2,
      available: 1,
    });
    const l3 = formatRows(101, 4, [ov(100, 101, "float32")]);
    expect(groupRowValue(at(l3, 0), null, 101, 4).value).toEqual({
      kind: "incomplete",
      required: 2,
      available: 1,
    });
    // a 64-bit group cut on both sides counts only the registers inside the poll
    const l24 = formatRows(101, 2, [ov(100, 103, "unsigned64")]);
    expect(groupRowValue(at(l24, 0), null, 101, 2).value).toEqual({
      kind: "incomplete",
      required: 4,
      available: 2,
    });
  });

  it("a complete group row with no snapshot still has no value", () => {
    const rows = formatRows(0, 4, [ov(0, 3, "float32")]);
    expect(groupRowValue(at(rows, 0), null, 0, 4)).toEqual({
      words: [],
      value: { kind: "missing" },
    });
  });

  it("nonfinite floats keep their text", () => {
    const rows = formatRows(0, 4, [ov(0, 3, "float32")]);
    expect(text(groupRowValue(at(rows, 0), [0x7fc0, 0, 0x7f80, 0], 0, 4))).toBe("NaN");
    expect(text(groupRowValue(at(rows, 1), [0x7fc0, 0, 0x7f80, 0], 0, 4))).toBe("+Infinity");
  });
});
