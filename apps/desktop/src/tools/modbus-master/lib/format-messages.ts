// The user-facing texts of the per-row format feature (DES-009 sections 4.2, 4.5, 5, 6.6, 8.1).
// Pure builders so the dialog, the shortcuts and the Poll setup say exactly the same thing. Every
// address is shown in the poll's display base.
import type { AddressBase, ValueFormat } from "@/shared/ipc/modbus-master.types";
import { type AddressRange, countAddresses, formatRanges } from "./address-ranges";
import { VALUE_FORMAT_LABELS } from "./format";
import { type Cut, formatWidth, ORDER_NAMES, type OrderId, orderPattern } from "./format-overrides";

/** `2-5` or `7` in the display base (the "formatRanges" style). */
function range(r: AddressRange, base: AddressBase): string {
  return formatRanges([r], base);
}

export const MIXED_NOTE =
  "The selected rows use different formats. The format you apply replaces all of them.";
export const UNCHANGED_NOTE = "The selected rows already use this format.";
export const ORDER_HELP = "A is the high byte of the first register.";
export const DIALOG_DESCRIPTION =
  "Applies to the selected rows and following registers needed to complete values. Changes the display; nothing is sent to the device.";
export const SCALED_ONLY_NOTE =
  "This poll shows Scaled values only. Combined values have no scaled value; choose Show Both or Raw to see them.";
export const STALE_PREVIEW = "Preview uses the last values received (stale).";
export const SELECT_ROWS_FIRST = "Select rows in the table first.";
export const NO_SCALING_FOR_COMBINED = "Scaling is unavailable for combined values.";
export const FORMAT_BUTTON_TITLE =
  "Set the format of the selected rows. Ctrl+1 to Ctrl+4 set a 16-bit format directly.";

/** M-T. */
export function tooManyMessage(count: number): string {
  return `A poll can have at most 256 format overrides. This change would create ${count}. Select fewer separate blocks.`;
}

/**
 * M-C1 and M-C2: one line per group the change splits (DES-009 11.5). A group that loses registers on
 * both sides is one line with the ranges joined by `, `.
 */
export function cutMessages(cuts: readonly Cut[], base: AddressBase): string[] {
  const merged: Array<{
    group: AddressRange;
    format: ValueFormat;
    cut: AddressRange[];
    outside: AddressRange[];
  }> = [];
  for (const c of cuts) {
    const same = merged.find(
      (m) =>
        m.group.start === c.group.start && m.group.end === c.group.end && m.format === c.format,
    );
    if (same) {
      same.cut.push(c.cut);
      same.outside.push(...c.outsidePoll);
    } else {
      merged.push({ group: c.group, format: c.format, cut: [c.cut], outside: [...c.outsidePoll] });
    }
  }
  return merged.map((m) => {
    const first = `Also resets ${formatRanges(m.cut, base)} to Unsigned: this change splits the ${VALUE_FORMAT_LABELS[m.format]} value ${range(m.group, base)}.`;
    if (m.outside.length === 0) return first;
    const verb = countAddresses(m.outside) === 1 ? "is" : "are";
    return `${first} ${formatRanges(m.outside, base)} ${verb} outside this poll.`;
  });
}

/** The cut lines shown in the dialog: at most four, then `… and {k} more split values.` (DES-010 8). */
export const MAX_CUT_LINES = 4;
export function limitCutLines(lines: readonly string[]): string[] {
  if (lines.length <= MAX_CUT_LINES) return [...lines];
  const rest = lines.length - MAX_CUT_LINES;
  return [
    ...lines.slice(0, MAX_CUT_LINES),
    `… and ${rest} more split ${rest === 1 ? "value" : "values"}.`,
  ];
}

/** M-R: a color rule does not fit the new formats. */
export function ruleConflictMessage(ruleName: string, message: string): string {
  return `Format not applied. Rule "${ruleName}": ${message}`;
}

const FORMAT_NOT_APPLIED = "Format not applied.";

/** M-F: the backend rejected the change. */
export function applyFailedMessage(message: string | null | undefined): string {
  // The backend's own "Format not applied. …" text is complete (DES-009 11.8).
  if (message?.startsWith(FORMAT_NOT_APPLIED)) return message;
  return `Could not apply the format. ${message && message.length > 0 ? message : "Try again."}`;
}

/** The polite announcement after Apply (DES-009 4.6 step 4 and section 5). */
export function appliedAnnouncement(
  format: ValueFormat,
  order: OrderId,
  scope: readonly AddressRange[],
  base: AddressBase,
): string {
  const width = formatWidth(format);
  const how =
    width === 1
      ? VALUE_FORMAT_LABELS[format]
      : `${VALUE_FORMAT_LABELS[format]}, ${ORDER_NAMES[order]} (${orderPattern(width, order)})`;
  return `Format applied: ${how} to ${formatRanges(scope, base)}.`;
}

/** The info toast of a quick 16-bit format that split a combined value (DES-009 section 5). */
export function quickCutToast(
  format: ValueFormat,
  scope: readonly AddressRange[],
  cuts: readonly Cut[],
  base: AddressBase,
): string {
  const cutRanges = formatRanges(
    cuts.map((c) => c.cut),
    base,
  );
  return `${VALUE_FORMAT_LABELS[format]} applied to ${formatRanges(scope, base)}. Also reset ${cutRanges} to Unsigned because a combined value was split.`;
}

/** The note under Quantity when the draft range cuts a group (DES-009 6.6). */
export function cutRangeInfo(
  cut: ReadonlyArray<{ group: AddressRange; format: ValueFormat }>,
  base: AddressBase,
): string | null {
  const first = cut[0];
  if (!first) return null;
  const head = `This range cuts the ${VALUE_FORMAT_LABELS[first.format]} value ${range(first.group, base)}; it will show as Incomplete.`;
  const more = cut.length - 1;
  if (more === 0) return head;
  return `${head} ${more === 1 ? "1 more value is cut." : `${more} more values are cut.`}`;
}

/** The note in the Scale section when the poll has combined values (DES-009 8.1). */
export function scaleCombinedNote(combined: number): string {
  return `Scaling applies to 16-bit rows. ${combined === 1 ? "1 combined value in this poll is" : `${combined} combined values in this poll are`} not scaled.`;
}

/** The inspector note for the registers of a group row that lie outside the poll (DES-009 6.6). */
export function outsidePollNote(
  outside: readonly AddressRange[],
  base: AddressBase,
): string | null {
  const n = countAddresses(outside);
  if (n === 0) return null;
  return n === 1
    ? `Register ${formatRanges(outside, base)} of this value is outside this poll.`
    : `Registers ${formatRanges(outside, base)} of this value are outside this poll.`;
}

export const INSPECTOR_SCALE_NOTE =
  "Saved scales apply again when these registers use a 16-bit format.";
