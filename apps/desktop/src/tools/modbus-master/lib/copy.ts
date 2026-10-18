// Copying data rows (DES-003 3.4, DES-002 2.3.4): one line per row, fields separated by tabs, with
// the alias as the first field when "Include alias in copy" is on. Pure.
import type { AddressBase, ValueColumns, ValueFormat } from "@/shared/ipc/modbus-master.types";
import { toDisplayAddress } from "./address";
import { formatBit, formatValue, VALUE_FORMAT_LABELS } from "./format";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

export interface CopyRow {
  /** Protocol address. */
  address: number;
  /** The raw value; undefined while there is none (loading). */
  raw: number | undefined;
  alias: string | undefined;
  /** The scaled number as shown ("4.00"), "" when the row has no scale. */
  scaled: string;
}

export interface CopyOptions {
  format: ValueFormat;
  base: AddressBase;
  /** Which value columns to copy (the poll's `valueColumns`, or an explicit menu choice). */
  columns: ValueColumns;
  /** FC01/02: raw values are 0 or 1. */
  bits: boolean;
  includeAlias: boolean;
  /** Adds a header line with the names of the columns that are present. */
  header: boolean;
}

function rawText(raw: number | undefined, opts: Pick<CopyOptions, "format" | "bits">): string {
  if (raw === undefined) return "";
  return opts.bits ? formatBit(raw) : formatValue(raw, opts.format);
}

/** The header line: `Alias`, `Address (0-based)`, `Raw (Hex)`, `Scaled`; only the columns present. */
export function copyHeader(opts: CopyOptions): string {
  const fields: string[] = [];
  if (opts.includeAlias) fields.push("Alias");
  fields.push(`Address (${opts.base}-based)`);
  if (opts.columns !== "scaled") fields.push(`Raw (${VALUE_FORMAT_LABELS[opts.format]})`);
  if (opts.columns !== "raw") fields.push("Scaled");
  return fields.join(TAB);
}

/**
 * The text of the selected rows: `{alias}\t{address}\t{raw}\t{scaled}`, left out per `columns`.
 * A row without an alias gives an empty first field; a row without a scale an empty last one.
 */
export function copyRowsText(rows: readonly CopyRow[], opts: CopyOptions): string {
  const lines = rows.map((row) => {
    const fields: string[] = [];
    if (opts.includeAlias) fields.push(row.alias ?? "");
    fields.push(String(toDisplayAddress(row.address, opts.base)));
    if (opts.columns !== "scaled") fields.push(rawText(row.raw, opts));
    if (opts.columns !== "raw") fields.push(row.scaled);
    return fields.join(TAB);
  });
  return (opts.header ? [copyHeader(opts), ...lines] : lines).join(LF);
}

/** "Copy aliases": only the alias of each row, one per line, empty lines for rows without one. */
export function copyAliasesText(rows: ReadonlyArray<Pick<CopyRow, "alias">>): string {
  return rows.map((row) => row.alias ?? "").join(LF);
}

/** The toast after a copy: "Copied 1 row." or "Copied {n} rows." */
export function copiedToast(n: number): string {
  return n === 1 ? "Copied 1 row." : `Copied ${n} rows.`;
}

export const CLIPBOARD_ERROR = "Could not copy to the clipboard.";
