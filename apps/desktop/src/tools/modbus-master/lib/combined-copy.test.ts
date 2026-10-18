import { expect, it } from "vitest";
import { combinedRows } from "./combined";
import { combinedCopyText } from "./combined-copy";

it("copies exact integers and constituent aliases with address base", () => {
  const rows = combinedRows(1, 5, [0xffff, 0xffff, 0xffff, 0xffff, 1], "unsigned64", {
    swapBytes: false,
    reverseWords: false,
  });
  const aliases = new Map([
    [1, "First"],
    [2, "Second"],
  ]);
  const options = { base: 1 as const, includeAlias: true, header: true, label: "Unsigned 64-bit" };
  expect(combinedCopyText(rows, aliases, options)).toBe(
    "Alias\tAddress (1-based)\tInterpreted (Unsigned 64-bit)\nFirst\t2\t18446744073709551615\n\t6\tIncomplete",
  );
  expect(combinedCopyText(rows, aliases, { ...options, header: false, rawRegisters: true })).toBe(
    "First\t2\t65535\nSecond\t3\t65535\n\t4\t65535\n\t5\t65535\n\t6\t1",
  );
});
