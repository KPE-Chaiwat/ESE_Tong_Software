import type { FormatRow } from "./format-overrides";

/** The visible register lines of logical format rows. A combined value has one head and continuations. */
export interface RegisterLine {
  address: number;
  row: FormatRow;
  continuation: boolean;
}

export function registerLines(rows: readonly FormatRow[]): RegisterLine[] {
  return rows.flatMap((row) =>
    Array.from({ length: row.endAddress - row.address + 1 }, (_, offset) => ({
      address: row.address + offset,
      row,
      continuation: offset > 0,
    })),
  );
}
