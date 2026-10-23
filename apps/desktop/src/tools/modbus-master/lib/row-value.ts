// The value of one grid row from the latest snapshot (DES-009 3.1, DES-006 section 2). A 16-bit row
// is its register; a group row decodes the registers of its group from ONE complete snapshot of the
// current definition, never from remembered words or padding.
import { type CombinedFormat, type CombinedValue, decodeCombined } from "./combined";
import { type FormatRow, flagsOf } from "./format-overrides";

export interface GroupRowValue {
  /** The registers of the row that lie inside the poll, from the snapshot (empty without one). */
  words: readonly number[];
  value: CombinedValue;
}

/**
 * The value of a group row from its own registers. `words` null means there is no snapshot of the
 * current definition. A row the poll edge cuts is always Incomplete, with or without a snapshot: the
 * cut belongs to the definition, not to the data (DES-009 11.9, REPORT-030 D1).
 */
export function groupValueOfWords(row: FormatRow, words: readonly number[] | null): GroupRowValue {
  if (!row.complete) {
    return {
      words: words ?? [],
      value: {
        kind: "incomplete",
        required: row.width,
        available: row.endAddress - row.address + 1,
      },
    };
  }
  if (words === null) return { words: [], value: { kind: "missing" } };
  return {
    words,
    value: decodeCombined(words, row.format as CombinedFormat, flagsOf(row.order)),
  };
}

/**
 * The value of a 32/64-bit group row from the poll's snapshot, in address order. The snapshot counts
 * only when it has exactly `quantity` words (a snapshot of an older definition does not).
 */
export function groupRowValue(
  row: FormatRow,
  snapshot: readonly number[] | null | undefined,
  start: number,
  quantity: number,
): GroupRowValue {
  if (!snapshot || snapshot.length !== quantity) return groupValueOfWords(row, null);
  return groupValueOfWords(row, snapshot.slice(row.address - start, row.endAddress - start + 1));
}
