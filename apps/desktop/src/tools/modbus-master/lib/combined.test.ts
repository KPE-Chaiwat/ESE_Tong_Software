import { describe, expect, it } from "vitest";
import {
  type CombinedFormat,
  combinedRows,
  combinedText,
  decodeCombined,
  orderedBytes,
  orderLabel,
} from "./combined";

const normal = { swapBytes: false, reverseWords: false };
describe("combined register interpretation", () => {
  it.each([
    [false, false, "ABCD", "305419896"],
    [true, false, "BADC", "873625686"],
    [false, true, "CDAB", "1450709556"],
    [true, true, "DCBA", "2018915346"],
  ] as const)("decodes order %s/%s", (swapBytes, reverseWords, label, expected) => {
    const order = { swapBytes, reverseWords };
    expect(orderLabel(2, order)).toBe(label);
    expect(combinedText(decodeCombined([0x1234, 0x5678], "unsigned32", order))).toBe(expected);
  });
  it.each([
    [false, false, "0123456789abcdef"],
    [true, false, "23016745ab89efcd"],
    [false, true, "cdef89ab45670123"],
    [true, true, "efcdab8967452301"],
  ] as const)("transforms all 64-bit orders %s/%s", (swapBytes, reverseWords, expected) => {
    const words = Object.freeze([0x0123, 0x4567, 0x89ab, 0xcdef]);
    expect(
      orderedBytes(words, { swapBytes, reverseWords })
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    ).toBe(expected);
    expect(words).toEqual([0x0123, 0x4567, 0x89ab, 0xcdef]);
  });
  it.each([
    ["signed32", [0xffff, 0xfffe], "-2"],
    ["unsigned32", [0xffff, 0xfffe], "4294967294"],
    ["unsigned32", [0xffff, 0xffff], "4294967295"],
    ["signed32", [0x8000, 0], "-2147483648"],
    ["signed32", [0x7fff, 0xffff], "2147483647"],
    ["unsigned64", [0xffff, 0xffff, 0xffff, 0xffff], "18446744073709551615"],
    ["signed64", [0xffff, 0xffff, 0xffff, 0xffff], "-1"],
    ["signed64", [0x8000, 0, 0, 0], "-9223372036854775808"],
    ["signed64", [0x7fff, 0xffff, 0xffff, 0xffff], "9223372036854775807"],
    ["unsigned64", [0x20, 0, 0, 0], "9007199254740992"],
    ["unsigned64", [0x20, 0, 0, 1], "9007199254740993"],
    ["float32", [0x3f80, 0], "1"],
    ["float32", [0x3fc0, 0], "1.5"],
    ["float32", [0, 0], "0"],
    ["float32", [0x3dcc, 0xcccd], "0.10000000149011612"],
    ["float32", [0xbfc0, 0], "-1.5"],
    ["float32", [0, 1], "1.401298464324817e-45"],
    ["float32", [0x8000, 0], "0"],
    ["float32", [0x7fc0, 0], "NaN"],
    ["float32", [0x7f80, 0], "+Infinity"],
    ["float32", [0xff80, 0], "-Infinity"],
    ["float64", [0x3ff0, 0, 0, 0], "1"],
    ["float64", [0x3ff8, 0, 0, 0], "1.5"],
    ["float64", [0xbff8, 0, 0, 0], "-1.5"],
    ["float64", [0, 0, 0, 0], "0"],
    ["float64", [0x3fb9, 0x9999, 0x9999, 0x999a], "0.1"],
    ["float64", [0, 0, 0, 1], "5e-324"],
    ["float64", [0x8000, 0, 0, 0], "0"],
    ["float64", [0x7ff8, 0, 0, 0], "NaN"],
    ["float64", [0x7ff0, 0, 0, 0], "+Infinity"],
    ["float64", [0xfff0, 0, 0, 0], "-Infinity"],
  ] as [CombinedFormat, number[], string][])("formats %s %j exactly", (format, words, expected) =>
    expect(combinedText(decodeCombined(words, format, normal))).toBe(expected),
  );
  it("groups odd addresses and trailing words without accumulating incompatible snapshots", () => {
    const rows = combinedRows(1, 5, [1, 2, 3, 4, 5], "unsigned32", normal);
    expect(rows.map((row) => [row.address, row.endAddress, combinedText(row.value)])).toEqual([
      [1, 2, "65538"],
      [3, 4, "196612"],
      [5, 5, "Incomplete"],
    ]);
    expect(
      combinedRows(1, 5, [1, 2], "unsigned32", normal).every((row) => row.value.kind === "missing"),
    ).toBe(true);
    expect(combinedRows(65535, 1, [1], "float64", normal)[0]?.endAddress).toBe(65535);
  });
});
