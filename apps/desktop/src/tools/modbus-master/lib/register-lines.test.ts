import { expect, it } from "vitest";
import { formatRows } from "./format-overrides";
import { registerLines } from "./register-lines";

it("keeps every register address and marks only combined followers as continuations", () => {
  const rows = formatRows(10, 7, [
    { start: 11, end: 12, format: "unsigned32", swapBytes: false, reverseWords: false },
    { start: 13, end: 16, format: "float64", swapBytes: false, reverseWords: false },
  ]);
  expect(
    registerLines(rows).map(({ address, row, continuation }) => [
      address,
      row.address,
      continuation,
    ]),
  ).toEqual([
    [10, 10, false],
    [11, 11, false],
    [12, 11, true],
    [13, 13, false],
    [14, 13, true],
    [15, 13, true],
    [16, 13, true],
  ]);
});
