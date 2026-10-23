// Per-row value formats (REQ-009, DES-009 sections 1, 3.1, 6.6 and 7). Pure: the grouping of a poll's
// registers into 16-bit rows and group rows, and the planner that turns "set this format on these
// rows" into a new list of format overrides. Rust validates the list again (BE-009); the planner
// already returns only lists that pass that check.
import type { FormatOverride, PollConfig, ValueFormat } from "@/shared/ipc/modbus-master.types";
import { type AddressRange, normalizeRanges } from "./address-ranges";
import { orderLabel } from "./combined";
import { VALUE_FORMAT_LABELS } from "./format";
import { isBitFunction } from "./functions";

export type OrderId = "big" | "little" | "bigByteSwap" | "littleByteSwap";
export interface RegisterFlags {
  swapBytes: boolean;
  reverseWords: boolean;
}

/** Most overrides a poll can hold (BE-009 `MAX_FORMAT_OVERRIDES`). */
export const MAX_FORMAT_OVERRIDES = 256;

export const DEFAULT_FORMAT: ValueFormat = "unsigned";
export const DEFAULT_ORDER: OrderId = "big";

export const ORDER_IDS: readonly OrderId[] = ["big", "little", "bigByteSwap", "littleByteSwap"];

/** The four named orders and the two persisted flags they stand for (DES-009 section 1). */
export const ORDER_NAMES: Record<OrderId, string> = {
  big: "Big-endian",
  little: "Little-endian",
  bigByteSwap: "Big-endian byte swap",
  littleByteSwap: "Little-endian byte swap",
};

const ORDER_FLAGS: Record<OrderId, RegisterFlags> = {
  big: { swapBytes: false, reverseWords: false },
  little: { swapBytes: true, reverseWords: true },
  bigByteSwap: { swapBytes: true, reverseWords: false },
  littleByteSwap: { swapBytes: false, reverseWords: true },
};

/** The formats in the order of the dialog's radio group (DES-009 4.2 item 5). */
export const FORMATS_16: readonly ValueFormat[] = ["unsigned", "signed", "hex", "binary"];
export const FORMATS_32: readonly ValueFormat[] = ["signed32", "unsigned32", "float32"];
export const FORMATS_64: readonly ValueFormat[] = ["signed64", "unsigned64", "float64"];
export const ALL_FORMATS: readonly ValueFormat[] = [...FORMATS_16, ...FORMATS_32, ...FORMATS_64];

/** Registers per value: 1 for the 16-bit formats, 2 for 32-bit, 4 for 64-bit. */
export function formatWidth(format: ValueFormat): 1 | 2 | 4 {
  if (format.endsWith("64")) return 4;
  if (format.endsWith("32")) return 2;
  return 1;
}

export function flagsOf(order: OrderId): RegisterFlags {
  return { ...ORDER_FLAGS[order] };
}

export function orderOf(flags: RegisterFlags): OrderId {
  for (const id of ORDER_IDS) {
    const f = ORDER_FLAGS[id];
    if (f.swapBytes === flags.swapBytes && f.reverseWords === flags.reverseWords) return id;
  }
  return "big";
}

/** The byte pattern of an order for a width in registers: ABCD, DCBA, BADC, CDAB (and the 64-bit forms). */
export function orderPattern(width: 2 | 4, order: OrderId): string {
  return orderLabel(width, ORDER_FLAGS[order]);
}

const SHORT_CODES: Record<ValueFormat, string> = {
  unsigned: "U16",
  signed: "S16",
  hex: "HEX",
  binary: "BIN",
  unsigned32: "U32",
  signed32: "S32",
  float32: "F32",
  unsigned64: "U64",
  signed64: "S64",
  float64: "F64",
};

/** The Format column text: `U16`, `HEX`, `F32 CDAB`, `U64 GHEFCDAB` (DES-009 section 1). */
export function formatCode(format: ValueFormat, order: OrderId): string {
  const width = formatWidth(format);
  return width === 1 ? SHORT_CODES[format] : `${SHORT_CODES[format]} ${orderPattern(width, order)}`;
}

/** The accessible name of a format: `Unsigned`, `Float 32-bit, Little-endian byte swap (CDAB)`. */
export function formatName(format: ValueFormat, order: OrderId): string {
  const width = formatWidth(format);
  return width === 1
    ? VALUE_FORMAT_LABELS[format]
    : `${VALUE_FORMAT_LABELS[format]}, ${ORDER_NAMES[order]} (${orderPattern(width, order)})`;
}

export function isDefaultFormat(o: Pick<FormatOverride, "format" | "swapBytes" | "reverseWords">) {
  return o.format === DEFAULT_FORMAT && !o.swapBytes && !o.reverseWords;
}

export interface FormatAt {
  format: ValueFormat;
  order: OrderId;
  override: FormatOverride | null;
}

const DEFAULT_AT: FormatAt = { format: DEFAULT_FORMAT, order: DEFAULT_ORDER, override: null };

/** The format of one register: the covering override, or the default (Unsigned, big-endian, 16-bit). */
export function formatAt(overrides: readonly FormatOverride[], address: number): FormatAt {
  let low = 0;
  let high = overrides.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const o = overrides[mid] as FormatOverride;
    if (address < o.start) high = mid - 1;
    else if (address > o.end) low = mid + 1;
    else {
      return {
        format: o.format,
        order: formatWidth(o.format) === 1 ? DEFAULT_ORDER : orderOf(o),
        override: o,
      };
    }
  }
  return DEFAULT_AT;
}

/** One grid row (DES-009 section 3.1). */
export interface FormatRow {
  /** The first register of the row inside the poll: the row identity. */
  address: number;
  /** The last register of the row inside the poll. */
  endAddress: number;
  /** The whole group (equal to `address`/`endAddress` for a 16-bit row). */
  groupStart: number;
  groupEnd: number;
  format: ValueFormat;
  order: OrderId;
  /** Registers per value: 1, 2 or 4. */
  width: 1 | 2 | 4;
  /** The whole group lies inside the poll range. */
  complete: boolean;
}

/**
 * The rows of a poll, in address order (DES-009 3.1): one row per register for the default and the
 * 16-bit overrides, one row per group (or per in-poll part of a group) for a 32/64-bit override.
 * `overrides` must be sorted and non-overlapping, as Rust stores them.
 */
export function formatRows(
  start: number,
  quantity: number,
  overrides: readonly FormatOverride[],
): FormatRow[] {
  const last = start + quantity - 1;
  const rows: FormatRow[] = [];
  let index = 0;
  let a = start;
  while (a <= last) {
    while (index < overrides.length && (overrides[index] as FormatOverride).end < a) index += 1;
    const o = overrides[index];
    if (!o || o.start > a) {
      rows.push({
        address: a,
        endAddress: a,
        groupStart: a,
        groupEnd: a,
        format: DEFAULT_FORMAT,
        order: DEFAULT_ORDER,
        width: 1,
        complete: true,
      });
      a += 1;
      continue;
    }
    const width = formatWidth(o.format);
    if (width === 1) {
      rows.push({
        address: a,
        endAddress: a,
        groupStart: a,
        groupEnd: a,
        format: o.format,
        order: DEFAULT_ORDER,
        width: 1,
        complete: true,
      });
      a += 1;
      continue;
    }
    const groupStart = o.start + Math.floor((a - o.start) / width) * width;
    const groupEnd = groupStart + width - 1;
    const endAddress = Math.min(groupEnd, last);
    rows.push({
      address: a,
      endAddress,
      groupStart,
      groupEnd,
      format: o.format,
      order: orderOf(o),
      width,
      complete: groupStart >= start && groupEnd <= last,
    });
    a = endAddress + 1;
  }
  return rows;
}

/** The rows of a config as the grid shows them: a coil or discrete poll has plain rows only. */
export function rowsOfConfig(
  config: Pick<PollConfig, "definition" | "formatOverrides"> | null,
): readonly FormatRow[] {
  if (!config) return [];
  const { startAddress, quantity, function: fn } = config.definition;
  return formatRows(startAddress, quantity, isBitFunction(fn) ? [] : config.formatOverrides);
}

/** The rows that have a register in `ranges`, in address order. */
export function rowsInRanges(
  rows: readonly FormatRow[],
  ranges: readonly AddressRange[],
): FormatRow[] {
  return rows.filter((row) =>
    ranges.some((r) => r.start <= row.endAddress && r.end >= row.address),
  );
}

/**
 * True when there is at least one 16-bit row and every 16-bit row is Signed: the "Raw is signed"
 * pre-check of a new scale (DES-009 8.1, Q-003-05). Group rows have no scale and do not count.
 */
export function allSixteenBitRowsSigned(rows: readonly FormatRow[]): boolean {
  const words = rows.filter((row) => row.width === 1);
  return words.length > 0 && words.every((row) => row.format === "signed");
}

/** The index of the row that contains `address`, or -1. */
export function rowAt(rows: readonly FormatRow[], address: number): number {
  let low = 0;
  let high = rows.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const row = rows[mid] as FormatRow;
    if (address < row.address) high = mid - 1;
    else if (address > row.endAddress) low = mid + 1;
    else return mid;
  }
  return -1;
}

/** Widens ranges to whole rows and clips them to the rows (DES-009 3.3). */
export function snapRangesToRows(
  rows: readonly FormatRow[],
  ranges: readonly AddressRange[],
): AddressRange[] {
  if (rows.length === 0) return [];
  const first = (rows[0] as FormatRow).address;
  const last = (rows[rows.length - 1] as FormatRow).endAddress;
  const out: AddressRange[] = [];
  for (const r of ranges) {
    const s = Math.max(r.start, first);
    const e = Math.min(r.end, last);
    if (s > e) continue;
    const from = rows[rowAt(rows, s)] as FormatRow;
    const to = rows[rowAt(rows, e)] as FormatRow;
    out.push({ start: from.address, end: to.endAddress });
  }
  return normalizeRanges(out);
}

/**
 * The scope as whole rows (DES-009 11.2, REQ-009 item 13): each range becomes the union of the rows it
 * touches (a group row contributes all its in-poll registers), clipped to the poll and normalized.
 */
export function widenToRows(
  scope: readonly AddressRange[],
  rows: readonly FormatRow[],
): AddressRange[] {
  return snapRangesToRows(rows, scope);
}

export interface ScopeFormat {
  format: ValueFormat;
  order: OrderId;
}

/** The distinct formats (with order) the registers of `scope` use now, in address order (DES-009 4.3). */
export function scopeFormats(
  scope: readonly AddressRange[],
  overrides: readonly FormatOverride[],
): ScopeFormat[] {
  const out: ScopeFormat[] = [];
  const seen = new Set<string>();
  const add = (format: ValueFormat, order: OrderId) => {
    const key = `${format}|${order}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ format, order });
  };
  for (const block of normalizeRanges(scope)) {
    let cursor = block.start;
    for (const o of overrides) {
      if (o.end < block.start) continue;
      if (o.start > block.end) break;
      if (o.start > cursor) add(DEFAULT_FORMAT, DEFAULT_ORDER);
      add(o.format, formatWidth(o.format) === 1 ? DEFAULT_ORDER : orderOf(o));
      cursor = Math.max(cursor, o.end + 1);
    }
    if (cursor <= block.end) add(DEFAULT_FORMAT, DEFAULT_ORDER);
  }
  return out;
}

/** What `planFormatChange` found for a group that the change splits. */
export interface Cut {
  /** The registers that fall back to the default. */
  cut: AddressRange;
  /** The whole old group they belonged to. */
  group: AddressRange;
  /** The old format of the group. */
  format: ValueFormat;
  /** The part of `cut` that lies outside the poll range. */
  outsidePoll: AddressRange[];
}

export type Plan =
  | { kind: "empty" }
  | { kind: "tooMany"; count: number }
  | {
      kind: "ok";
      overrides: FormatOverride[];
      groups: AddressRange[];
      added: AddressRange[];
      tails: AddressRange[];
      cuts: Cut[];
      unchanged: boolean;
    };

export interface PlanInput {
  overrides: readonly FormatOverride[];
  scope: readonly AddressRange[];
  choice: { format: ValueFormat; order: OrderId };
  pollRange: AddressRange;
}

function subtract(range: AddressRange, blocks: readonly AddressRange[]): AddressRange[] {
  const out: AddressRange[] = [];
  let cursor = range.start;
  for (const b of blocks) {
    if (b.end < cursor) continue;
    if (b.start > range.end) break;
    if (b.start > cursor) out.push({ start: cursor, end: b.start - 1 });
    cursor = Math.max(cursor, b.end + 1);
  }
  if (cursor <= range.end) out.push({ start: cursor, end: range.end });
  return out;
}

/** Complete selected runs with following poll registers, as observed in Modbus Poll's UI. */
export function planCoverage(
  scope: readonly AddressRange[],
  width: 1 | 2 | 4,
  pollRange: AddressRange,
): {
  blocks: AddressRange[];
  groups: AddressRange[];
  added: AddressRange[];
  tails: AddressRange[];
} {
  const selected = normalizeRanges(scope);
  const blocks: AddressRange[] = [];
  const groups: AddressRange[] = [];
  const tails: AddressRange[] = [];
  let i = 0;
  while (i < selected.length) {
    const first = selected[i] as AddressRange;
    const start = first.start;
    let end = first.end;
    i += 1;
    let wanted = end;
    while (true) {
      wanted = Math.min(start + Math.ceil((end - start + 1) / width) * width - 1, pollRange.end);
      const next = selected[i];
      if (!next || next.start > wanted + 1) break;
      end = Math.max(end, next.end);
      i += 1;
    }
    const fullEnd = start + Math.floor((wanted - start + 1) / width) * width - 1;
    if (fullEnd >= start) {
      blocks.push({ start, end: fullEnd });
      for (let a = start; a <= fullEnd; a += width) {
        groups.push({ start: a, end: a + width - 1 });
      }
    }
    if (end > fullEnd) tails.push({ start: Math.max(start, fullEnd + 1), end });
  }
  const added = blocks.flatMap((block) => subtract(block, selected));
  return { blocks, groups, added, tails };
}

export function sameOverride(a: FormatOverride, b: FormatOverride): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.format === b.format &&
    a.swapBytes === b.swapBytes &&
    a.reverseWords === b.reverseWords
  );
}

/** The same lists, entry by entry. */
export function sameOverrides(a: readonly FormatOverride[], b: readonly FormatOverride[]): boolean {
  return a.length === b.length && a.every((o, i) => sameOverride(o, b[i] as FormatOverride));
}

/** Drops default entries, sorts, and merges neighbours with the same format and flags (DES-009 7 step 6). */
export function normalizeOverrides(list: readonly FormatOverride[]): FormatOverride[] {
  const sorted = list.filter((o) => !isDefaultFormat(o)).sort((a, b) => a.start - b.start);
  const out: FormatOverride[] = [];
  for (const o of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.end + 1 === o.start &&
      last.format === o.format &&
      last.swapBytes === o.swapBytes &&
      last.reverseWords === o.reverseWords
    ) {
      last.end = o.end;
    } else out.push({ ...o });
  }
  return out;
}

/**
 * Sets a format on the registers of `scope` (DES-009 section 7). Each block of consecutive registers
 * is grouped from its first register and completed with following poll rows. Old groups the change
 * splits keep nothing of themselves outside the scope: those registers fall back to the default and
 * are reported as `cuts`.
 */
export function planFormatChange(input: PlanInput): Plan {
  if (normalizeRanges(input.scope).length === 0) return { kind: "empty" };
  const { format, order } = input.choice;
  const width = formatWidth(format);
  const coverage = planCoverage(input.scope, width, input.pollRange);
  const blocks = coverage.blocks;
  const touched = normalizeRanges([...blocks, ...coverage.tails]);
  const flags = width === 1 ? { swapBytes: false, reverseWords: false } : flagsOf(order);

  const kept: FormatOverride[] = [];
  const cuts: Cut[] = [];
  for (const o of input.overrides) {
    if (!touched.some((b) => b.start <= o.end && b.end >= o.start)) {
      kept.push({ ...o });
      continue;
    }
    const wo = formatWidth(o.format);
    for (const piece of subtract({ start: o.start, end: o.end }, touched)) {
      if (wo === 1) {
        kept.push({ ...o, start: piece.start, end: piece.end });
        continue;
      }
      // Whole groups of `o` inside the piece stay; a group that reaches into a block is cut.
      const firstGroup = o.start + Math.floor((piece.start - o.start) / wo) * wo;
      let run: AddressRange | null = null;
      for (let gs = firstGroup; gs <= piece.end; gs += wo) {
        const ge = gs + wo - 1;
        if (gs >= piece.start && ge <= piece.end) {
          if (run) run.end = ge;
          else run = { start: gs, end: ge };
          continue;
        }
        if (run) {
          kept.push({ ...o, start: run.start, end: run.end });
          run = null;
        }
        const cut = { start: Math.max(gs, piece.start), end: Math.min(ge, piece.end) };
        cuts.push({
          cut,
          group: { start: gs, end: ge },
          format: o.format,
          outsidePoll: subtract(cut, [input.pollRange]),
        });
      }
      if (run) kept.push({ ...o, start: run.start, end: run.end });
    }
  }
  for (const b of blocks) {
    kept.push({
      start: b.start,
      end: b.end,
      format,
      swapBytes: flags.swapBytes,
      reverseWords: flags.reverseWords,
    });
  }
  const overrides = normalizeOverrides(kept);
  if (overrides.length > MAX_FORMAT_OVERRIDES) return { kind: "tooMany", count: overrides.length };

  const unchanged = sameOverrides(overrides, input.overrides);
  return {
    kind: "ok",
    overrides,
    groups: coverage.groups,
    added: coverage.added,
    tails: coverage.tails,
    cuts,
    unchanged,
  };
}

/**
 * The groups that the range of a poll cuts at its start or end (DES-009 6.6), in address order. A cut
 * group shows as Incomplete.
 */
export function cutGroups(
  start: number,
  quantity: number,
  overrides: readonly FormatOverride[],
): Array<{ group: AddressRange; format: ValueFormat }> {
  const last = start + quantity - 1;
  const out: Array<{ group: AddressRange; format: ValueFormat }> = [];
  const seen = new Set<number>();
  for (const o of overrides) {
    const width = formatWidth(o.format);
    if (width === 1 || o.end < start || o.start > last) continue;
    const from = Math.max(o.start, start);
    const to = Math.min(o.end, last);
    const groupOf = (a: number) => o.start + Math.floor((a - o.start) / width) * width;
    for (const gs of new Set([groupOf(from), groupOf(to)])) {
      const ge = gs + width - 1;
      if ((gs < start || ge > last) && !seen.has(gs)) {
        seen.add(gs);
        out.push({ group: { start: gs, end: ge }, format: o.format });
      }
    }
  }
  return out.sort((a, b) => a.group.start - b.group.start);
}

/** Where a preselected choice came from (DES-009 11.3, D-009-05). */
export type ChoiceSource = "current" | "unsigned";

export interface InitialChoice {
  format: ValueFormat;
  order: OrderId;
  /** The scope uses more than one format or order now (the non-blocking mixed note). */
  mixed: boolean;
  source: ChoiceSource;
}

/**
 * The choice the Format dialog opens with (D-009-05): the scope's current format when every row of the
 * scope uses it, else Unsigned 16-bit. Every width can be chosen for a short selection, so a
 * combined format on one selected row can be preselected. Mixed formats open on Unsigned.
 */
export function initialChoice(input: {
  overrides: readonly FormatOverride[];
  scope: readonly AddressRange[];
  pollRange: AddressRange;
}): InitialChoice {
  const found = scopeFormats(input.scope, input.overrides);
  const mixed = found.length > 1;
  const current = found.length === 1 ? found[0] : undefined;
  if (current) {
    return { format: current.format, order: current.order, mixed, source: "current" };
  }
  return { format: DEFAULT_FORMAT, order: DEFAULT_ORDER, mixed, source: "unsigned" };
}
