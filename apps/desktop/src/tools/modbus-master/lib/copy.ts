// Copying visible register lines (DES-003 3.4, DES-009 8.3, DES-012): one line per register,
// fields separated by tabs, with the alias first when "Include alias in copy" is on. Pure.
import type { AddressBase, ValueColumns, ValueFormat } from "@/shared/ipc/modbus-master.types";
import { toDisplayAddress } from "./address";
import { type CombinedValue, combinedText } from "./combined";
import { formatBit, formatValue, VALUE_FORMAT_LABELS } from "./format";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

/** The constituent registers of a group row, for "Copy raw registers". */
export interface CopyRegister {
  address: number;
  raw: number | undefined;
  alias: string | undefined;
}

/** What a group row adds to a copy row. */
export interface CopyGroup {
  format: ValueFormat;
  value: CombinedValue;
  /** The registers of the row that lie inside the poll, in address order. */
  registers: readonly CopyRegister[];
}

export interface CopyRow {
  /** Protocol address of the row (the first register of a group). */
  address: number;
  /** The raw value; undefined while there is none (loading). */
  raw: number | undefined;
  alias: string | undefined;
  /** The scaled number as shown ("4.00"), "" when the row has no scale. */
  scaled: string;
  /** The 16-bit format of the row; the option's `format` when missing. */
  format?: ValueFormat;
  /** Set for a 32/64-bit group row: its value replaces `raw`, and it has no scaled value. */
  group?: CopyGroup;
  /** A visible register following the first register of a combined value. */
  continuation?: boolean;
}

export interface CopyOptions {
  /** The format of a row that has none of its own. */
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

function rowFormat(row: CopyRow, opts: Pick<CopyOptions, "format">): ValueFormat {
  return row.format ?? opts.format;
}

function rawText(row: CopyRow, opts: Pick<CopyOptions, "format" | "bits">): string {
  if (row.continuation) return "--";
  if (row.group) return combinedText(row.group.value, "");
  if (row.raw === undefined) return "";
  return opts.bits ? formatBit(row.raw) : formatValue(row.raw, rowFormat(row, opts));
}

/**
 * The name of the value column (DES-009 8.3): `Raw (Hex)` when every row is a 16-bit row of one
 * format, `Interpreted (Float 32-bit)` when every row is a group of one format, else `Raw (Mixed)`.
 */
function valueHeader(rows: readonly CopyRow[], opts: Pick<CopyOptions, "format">): string {
  if (rows.length === 0) return `Raw (${VALUE_FORMAT_LABELS[opts.format]})`;
  const formats = new Set(rows.map((r) => (r.group ? r.group.format : rowFormat(r, opts))));
  const groups = rows.filter((r) => r.group || r.continuation).length;
  if (formats.size === 1) {
    const label = VALUE_FORMAT_LABELS[[...formats][0] as ValueFormat];
    if (groups === 0) return `Raw (${label})`;
    if (groups === rows.length) return `Interpreted (${label})`;
  }
  return "Raw (Mixed)";
}

/** The header line: `Alias`, `Address (0-based)`, `Raw (Hex)`, `Scaled`; only the columns present. */
export function copyHeader(opts: CopyOptions, rows: readonly CopyRow[] = []): string {
  const fields: string[] = [];
  if (opts.includeAlias) fields.push("Alias");
  fields.push(`Address (${opts.base}-based)`);
  if (opts.columns !== "scaled") fields.push(valueHeader(rows, opts));
  if (opts.columns !== "raw") fields.push("Scaled");
  return fields.join(TAB);
}

/**
 * The text of the selected rows: `{alias}\t{address}\t{raw}\t{scaled}`, left out per `columns`.
 * A row without an alias gives an empty first field; a row without a scale (and every group row) an
 * empty last one.
 */
export function copyRowsText(rows: readonly CopyRow[], opts: CopyOptions): string {
  const lines = rows.map((row) => {
    const fields: string[] = [];
    if (opts.includeAlias) fields.push(row.alias ?? "");
    fields.push(String(toDisplayAddress(row.address, opts.base)));
    if (opts.columns !== "scaled") fields.push(rawText(row, opts));
    if (opts.columns !== "raw") fields.push(row.continuation ? "--" : row.group ? "" : row.scaled);
    return fields.join(TAB);
  });
  return (opts.header ? [copyHeader(opts, rows), ...lines] : lines).join(LF);
}

/**
 * "Copy raw registers": one line per register, `{alias of the register}\t{address}\t{unsigned}`,
 * whatever the format of the row (DES-009 8.3). A group row gives one line for each of its registers.
 */
export function copyRegistersText(
  rows: readonly CopyRow[],
  opts: Pick<CopyOptions, "base" | "includeAlias" | "header">,
): string {
  const lines: string[] = [];
  const line = (address: number, alias: string | undefined, raw: number | undefined) => {
    const fields: string[] = [];
    if (opts.includeAlias) fields.push(alias ?? "");
    fields.push(String(toDisplayAddress(address, opts.base)));
    fields.push(raw === undefined ? "" : String(raw & 0xffff));
    lines.push(fields.join(TAB));
  };
  for (const row of rows) {
    if (row.continuation) continue;
    if (row.group) for (const r of row.group.registers) line(r.address, r.alias, r.raw);
    else line(row.address, row.alias, row.raw);
  }
  if (opts.header) {
    const head: string[] = [];
    if (opts.includeAlias) head.push("Alias");
    head.push(`Address (${opts.base}-based)`, "Raw (Unsigned)");
    lines.unshift(head.join(TAB));
  }
  return lines.join(LF);
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
