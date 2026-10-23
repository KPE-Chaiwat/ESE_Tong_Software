// What the Format dialog D1 and the row menu G2 say and count (DES-010 sections 4, 5, 7 and 10, FE-010
// task 01). Pure: every text and number is computed here, so the components only render them and the
// tests table-drive them with the REQ-010 edge matrix. No React; addresses are shown in the display base.
import type {
  AddressBase,
  ConnectionState,
  FormatOverride,
  PollState,
  ValueFormat,
} from "@/shared/ipc/modbus-master.types";
import type { IconName } from "@/shared/ui/icon";
import type { PollDataStatus } from "../store/poll-data.logic";
import { type AddressRange, countAddresses, normalizeRanges } from "./address-ranges";
import { type CombinedFormat, combinedText, decodeCombined } from "./combined";
import { formatValue, VALUE_FORMAT_LABELS } from "./format";
import { STALE_PREVIEW } from "./format-messages";
import {
  flagsOf,
  formatCode,
  formatWidth,
  ORDER_NAMES,
  type OrderId,
  orderPattern,
  planCoverage,
  scopeFormats,
} from "./format-overrides";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The 16-bit formats the row menu sets directly (Ctrl+1..4). */
export type QuickFormat = "unsigned" | "signed" | "hex" | "binary";
export const QUICK_FORMATS: readonly QuickFormat[] = ["unsigned", "signed", "hex", "binary"];

/** At most this many runs are listed in the summary (DES-010 4). */
export const SUMMARY_MAX_RUNS = 4;
/** At most this many preview lines are shown (DES-010 7.2). */
export const PREVIEW_LIMIT = 8;

// ---- selection summary (DES-010 4) ----

/** The runs of consecutive selected registers, sorted and merged. */
export function selectionRuns(scope: readonly AddressRange[]): AddressRange[] {
  return normalizeRanges(scope);
}

/** `a-b`, or `a` for a run of one register, in the display base. */
function runText(r: AddressRange, base: AddressBase): string {
  return r.start === r.end ? `${r.start + base}` : `${r.start + base}-${r.end + base}`;
}

/** `Selected 5 registers (0-1, 4-6)`, `Selected 1 register (7)`, with ` · mixed formats` when mixed. */
export function selectionSummaryParts(input: {
  scope: readonly AddressRange[];
  base: AddressBase;
  mixed: boolean;
}): { lead: string; runs: string; tail: string } {
  const runs = selectionRuns(input.scope);
  const n = countAddresses(runs);
  const listed = runs.slice(0, SUMMARY_MAX_RUNS).map((r) => runText(r, input.base));
  const rest = runs.length - listed.length;
  const more = rest > 0 ? ` and ${rest} more ${plural(rest, "block", "blocks")}` : "";
  return {
    lead: `Selected ${n} ${plural(n, "register", "registers")} (`,
    runs: `${listed.join(", ")}${more}`,
    tail: input.mixed ? ") · mixed formats" : ")",
  };
}

export function selectionSummary(input: Parameters<typeof selectionSummaryParts>[0]): string {
  const { lead, runs, tail } = selectionSummaryParts(input);
  return `${lead}${runs}${tail}`;
}

// ---- width availability (DES-010 5) ----

export interface WidthAvailability {
  width: 1 | 2 | 4;
  available: true;
  values: number;
  added: AddressRange[];
  tails: AddressRange[];
}

/**
 * Values produced when selected runs are completed with following poll registers.
 */
export function widthAvailability(input: {
  scope: readonly AddressRange[];
  width: 1 | 2 | 4;
  base: AddressBase;
  pollEnd?: number;
}): WidthAvailability {
  const { width } = input;
  const runs = selectionRuns(input.scope);
  const coverage = planCoverage(runs, width, {
    start: runs[0]?.start ?? 0,
    end: input.pollEnd ?? 65535,
  });
  return {
    width,
    available: true,
    values: coverage.groups.length,
    added: coverage.added,
    tails: coverage.tails,
  };
}

/** `32-bit · 5 values (2 registers each)`. */
export function widthHeading(a: WidthAvailability): string {
  const bits = a.width * 16;
  const each = `${a.width} ${plural(a.width, "register", "registers")} each`;
  return `${bits}-bit · ${a.values} ${plural(a.values, "value", "values")} (${each})`;
}

// ---- preview (DES-010 7) ----

export interface PreviewLine {
  /** The first register of the value (protocol address). */
  address: number;
  /** `a` (16-bit) or `a-b` (32/64-bit) in the display base. */
  text: string;
  value: string;
}

export interface PreviewResult {
  summary: string;
  lines: PreviewLine[];
  /** Values beyond the limit. */
  more: number;
  moreText: string | null;
}

/** The text the grid's Raw column shows for the registers `address…` of the snapshot, or `—`. */
function valueText(
  format: ValueFormat,
  order: OrderId,
  snapshot: readonly number[] | null,
  offset: number,
): string {
  if (snapshot === null) return "—";
  const width = formatWidth(format);
  const words = snapshot.slice(offset, offset + width);
  if (offset < 0 || words.length < width) return "—";
  if (width === 1) return formatValue(words[0] as number, format);
  return combinedText(decodeCombined(words, format as CombinedFormat, flagsOf(order)));
}

/**
 * The values a selection would show with a format and order (DES-010 7.2), from the latest snapshot
 * (`null` = none: the values read `—`). One line per resulting value in address order, at most `limit`
 * of them. The planner supplies following poll registers when a selected run is short.
 */
export function previewLines(input: {
  scope: readonly AddressRange[];
  format: ValueFormat;
  order: OrderId;
  snapshot: readonly number[] | null;
  pollStart: number;
  pollEnd?: number;
  base: AddressBase;
  limit?: number;
}): PreviewResult {
  const { scope, format, order, snapshot, pollStart, base } = input;
  const limit = input.limit ?? PREVIEW_LIMIT;
  const width = formatWidth(format);
  const coverage = planCoverage(scope, width, {
    start: pollStart,
    end: input.pollEnd ?? 65535,
  });
  const lines: PreviewLine[] = [];
  const total = coverage.groups.length;
  for (const group of coverage.groups.slice(0, limit)) {
    lines.push({
      address: group.start,
      text: runText(group, base),
      value: valueText(format, order, snapshot, group.start - pollStart),
    });
  }
  const label = VALUE_FORMAT_LABELS[format];
  const head = `${total} ${label} ${plural(total, "value", "values")}`;
  const summary =
    width === 1
      ? head
      : `${head}, ${ORDER_NAMES[order]} (${orderPattern(width === 4 ? 4 : 2, order)})`;
  const more = total - lines.length;
  return {
    summary,
    lines,
    more,
    moreText: more > 0 ? `… and ${more} more ${plural(more, "value", "values")}` : null,
  };
}

/** The first value a format gives for the selection, for the inline previews next to the radios. */
export function firstValueText(input: {
  scope: readonly AddressRange[];
  format: ValueFormat;
  order: OrderId;
  snapshot: readonly number[] | null;
  pollStart: number;
  pollEnd?: number;
  base: AddressBase;
}): string {
  return previewLines({ ...input, limit: 1 }).lines[0]?.value ?? "—";
}

// ---- preview notice (DES-010 7.3) ----

export type PreviewNoticeKind =
  | "stale"
  | "notConnected"
  | "connecting"
  | "waiting"
  | "paused"
  | "failed"
  | "connectionLost";

export interface PreviewNotice {
  kind: PreviewNoticeKind;
  icon: IconName;
  text: string;
}

const NOTICES: Record<PreviewNoticeKind, { icon: IconName; text: string }> = {
  stale: { icon: "clock", text: STALE_PREVIEW },
  notConnected: {
    icon: "plug",
    text: "No preview: not connected. Connect to read values. You can apply the format now.",
  },
  connecting: { icon: "loader", text: "No preview yet: connecting to the device." },
  waiting: { icon: "loader", text: "No preview yet: waiting for the first reply." },
  paused: {
    icon: "pause",
    text: "No preview: the poll is paused. Resume it (Ctrl+P) to read values.",
  },
  failed: {
    icon: "octagon-x",
    text: "No preview: the last request got no valid reply. Values appear after the next good reply.",
  },
  connectionLost: {
    icon: "unplug",
    text: "No preview: the connection was lost. Reconnect to read values.",
  },
};

/** Why the preview is stale or empty, or null when it shows live values (decision order of DES-010 7.3). */
export function previewNotice(input: {
  connectionState: ConnectionState;
  pollState: PollState;
  status: PollDataStatus;
  hasValues: boolean;
}): PreviewNotice | null {
  const { connectionState, pollState, status, hasValues } = input;
  const make = (kind: PreviewNoticeKind): PreviewNotice => ({ kind, ...NOTICES[kind] });
  if (hasValues) return status === "stale" ? make("stale") : null;
  if (connectionState === "idle") return make("notConnected");
  if (connectionState === "connecting") return make("connecting");
  if (connectionState === "disconnected") return make("connectionLost");
  if (pollState === "paused") return make("paused");
  if (pollState === "exception" || pollState === "timeout" || pollState === "badResponse") {
    return make("failed");
  }
  return make("waiting");
}

// ---- row menu quick formats (DES-010 10.2, 10.3) ----

/** Which quick item is checked for a target, and the heading that explains why none is. */
export function quickFormatState(input: {
  scope: readonly AddressRange[];
  overrides: readonly FormatOverride[];
}): { checked: QuickFormat | null; heading: string } {
  const found = scopeFormats(input.scope, input.overrides);
  const only = found.length === 1 ? found[0] : undefined;
  if (found.length > 1) return { checked: null, heading: "Value format: mixed" };
  if (!only) return { checked: null, heading: "Value format" };
  if (formatWidth(only.format) === 1) {
    return { checked: only.format as QuickFormat, heading: "Value format" };
  }
  return { checked: null, heading: `Value format: ${formatCode(only.format, only.order)}` };
}
