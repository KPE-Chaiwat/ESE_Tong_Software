import type {
  AddressBase,
  ReadFunction,
  ValueFormat,
  WriteFunction,
  WriteRequest,
  WriteResult,
} from "@/shared/ipc/modbus-master.types";
import type { IconName } from "@/shared/ui/icon";
import { toDisplayAddress } from "../lib/address";
import { badResponseText, exceptionName, formatExceptionCode } from "../lib/exceptions";
import { formatValue } from "../lib/format";
import type { ScaledMarker, ScaledProvider } from "../lib/scaled";
import {
  type FieldErrors,
  type ValidationResult,
  validate,
  type WriteFormValues,
  writeSchema,
} from "../validation/schemas";

export type WriteDraft = WriteFormValues;

export interface WritePrefill {
  /** Protocol address of the selected row (or the poll start). */
  address: number;
  pollFunction: ReadFunction;
  slaveId: number;
  /** Current raw value of the row, when a row is selected. */
  raw?: number;
}

export const DEFAULT_WRITE_FUNCTION: WriteFunction = 6;

export function emptyDraft(): WriteDraft {
  return {
    function: String(DEFAULT_WRITE_FUNCTION),
    slaveId: "1",
    address: "0",
    valueFormat: "unsigned",
    coil: true,
    valueText: "0",
    valuesText: "",
  };
}

/** DES-001 S2: function 05 for a coil poll, 06 for holding registers, else the last used one. */
export function prefillFunction(
  pollFunction: ReadFunction,
  lastFunction: WriteFunction,
): WriteFunction {
  if (pollFunction === 1) return 5;
  if (pollFunction === 3) return 6;
  return lastFunction;
}

export function buildDraft(
  prefill: WritePrefill | undefined,
  ctx: {
    base: AddressBase;
    format: ValueFormat;
    lastFunction: WriteFunction;
    defaultSlaveId: number;
  },
): WriteDraft {
  const draft = emptyDraft();
  draft.valueFormat = ctx.format;
  draft.slaveId = String(prefill?.slaveId ?? ctx.defaultSlaveId);
  if (!prefill) {
    draft.function = String(ctx.lastFunction);
    return draft;
  }
  draft.function = String(prefillFunction(prefill.pollFunction, ctx.lastFunction));
  draft.address = String(toDisplayAddress(prefill.address, ctx.base));
  if (prefill.raw !== undefined) {
    if (prefill.pollFunction === 1 || prefill.pollFunction === 2) {
      draft.coil = prefill.raw !== 0;
      draft.valueText = prefill.raw !== 0 ? "1" : "0";
      draft.valuesText = draft.valueText;
    } else {
      draft.valueText = formatValue(prefill.raw, ctx.format);
      // A list is split at spaces, so the nibble spaces of a binary value would become four
      // values (REV-002 m6). The single value keeps its nibbles; the list gets them closed up.
      draft.valuesText = draft.valueText.replace(/\s+/g, "");
    }
  }
  return draft;
}

export function validateDraft(
  draft: WriteDraft,
  base: AddressBase,
): ValidationResult<WriteRequest> {
  return validate(writeSchema(base), draft);
}

/** Field names each function shows, so errors for hidden fields are not reported. */
const FIELDS_BY_FUNCTION: Record<number, readonly string[]> = {
  5: ["slaveId", "address"],
  6: ["slaveId", "address", "valueText"],
  15: ["slaveId", "address", "valuesText"],
  16: ["slaveId", "address", "valuesText"],
};

export function visibleErrors(errors: FieldErrors, fn: number): FieldErrors {
  const shown = FIELDS_BY_FUNCTION[fn] ?? [];
  return Object.fromEntries(Object.entries(errors).filter(([k]) => shown.includes(k)));
}

// ---------------------------------------------------------------------------------------------
// Result area (DES-001 2.5)
// ---------------------------------------------------------------------------------------------

export type WriteResultTone = "sending" | "success" | "outline" | "error" | "warning";

export interface WriteResultView {
  tone: WriteResultTone;
  /** lucide icon name. */
  icon: IconName;
  text: string;
}

export const SENDING_VIEW: WriteResultView = { tone: "sending", icon: "loader", text: "Writing…" };
export const NOT_CONNECTED_VIEW: WriteResultView = {
  tone: "error",
  icon: "unplug",
  text: "Not connected. Connect before writing.",
};

/** The write was in flight when the link dropped; the device may or may not have applied it. */
export const LINK_LOST_VIEW: WriteResultView = {
  tone: "error",
  icon: "unplug",
  text: "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.",
};

export function describeWriteResult(
  result: WriteResult,
  ctx: { request: WriteRequest | null; base: AddressBase; timeoutMs: number },
): WriteResultView {
  switch (result.status) {
    case "ok": {
      const req = ctx.request;
      if (!req) return { tone: "success", icon: "circle-check", text: "Write confirmed." };
      const coils = req.function === 5 || req.function === 15;
      const n = req.values.length;
      const start = toDisplayAddress(req.address, ctx.base);
      const where = n === 1 ? `at ${start}` : `at ${start}-${start + n - 1}`;
      const noun = coils ? (n === 1 ? "coil" : "coils") : n === 1 ? "register" : "registers";
      return {
        tone: "success",
        icon: "circle-check",
        text: `Write confirmed by slave ${req.slaveId}: ${n === 1 ? "" : `${n} `}${noun} ${where}.`,
      };
    }
    case "broadcastSent":
      return {
        tone: "outline",
        icon: "circle-check",
        text: "Broadcast sent. Devices do not reply to slave ID 0, so the write cannot be confirmed.",
      };
    case "exception":
      return {
        tone: "error",
        icon: "octagon-x",
        text: `Exception ${formatExceptionCode(result.code)} (${exceptionName(result.code)}). Nothing was confirmed.`,
      };
    case "timeout":
      return {
        tone: "warning",
        icon: "timer-off",
        text: `No response within ${ctx.timeoutMs} ms. The write may or may not have been applied.`,
      };
    case "badResponse":
      return {
        tone: "warning",
        icon: "triangle-alert",
        text: `Bad response: ${badResponseText(result.kind, result.detail)}. The write may or may not have been applied.`,
      };
    case "notConnected":
      return NOT_CONNECTED_VIEW;
    case "linkLost":
      return LINK_LOST_VIEW;
  }
}

/** Just the text of a write result (FE-001 task 03). */
export function writeResultText(
  result: WriteResult,
  ctx: { request: WriteRequest | null; base: AddressBase; timeoutMs: number },
): string {
  return describeWriteResult(result, ctx).text;
}

// ---------------------------------------------------------------------------------------------
// Dialog context (DES-002 3.3, DES-003 3.5 revision 6)
// ---------------------------------------------------------------------------------------------

/** The toast of Enter or a double click on a row of a read-only poll (DES-001 S2). */
export const READ_ONLY_TOAST = "Discrete inputs and input registers are read-only.";

/** "Write · {poll name}" (mockup 4). */
export function writeDialogTitle(pollName: string): string {
  return `Write · ${pollName}`;
}

/**
 * The alias line under the Address field (DES-003 3.5, revision 6): "Alias: {alias}" for the target
 * address, plus " (+{n} more with aliases)" for FC15 and FC16 when other addresses of the written
 * range have aliases. `startAddress` is the protocol address, null while the field is invalid.
 * No line without an alias on the target address.
 */
export function aliasLineFor(
  fn: number,
  startAddress: number | null,
  count: number,
  aliases: ReadonlyMap<number, string>,
): string | null {
  if (startAddress === null) return null;
  const alias = aliases.get(startAddress);
  if (!alias) return null;
  let more = 0;
  if (fn === 15 || fn === 16) {
    for (let i = 1; i < count; i += 1) if (aliases.get(startAddress + i)) more += 1;
  }
  return `Alias: ${alias}${more > 0 ? ` (+${more} more with aliases)` : ""}`;
}

export interface WritePreview {
  /** "Scaled: 12.50 mA (out of range)". */
  text: string;
  /** `warning` has the warning tint and the `triangle-alert` icon; `neutral` the neutral tint. */
  tone: "neutral" | "warning";
  icon: IconName | null;
}

/** How many values of an FC16 write the preview lists (DES-003 3.5). */
export const PREVIEW_VALUES = 5;

/** " (out of range)" for a flagged value, " (clamped)" for a clamped one. */
function markerNote(marker: ScaledMarker): string {
  if (marker === "outOfRange") return " (out of range)";
  return marker === "clamped-low" || marker === "clamped-high" ? " (clamped)" : "";
}

/**
 * The scaled preview of a raw write (DES-003 3.5), or null when there is nothing to show: FC05 and
 * FC15 have none, and an address without a scale gives no line. The provider is the poll's own
 * (`createScaled`): the override that covers the address wins over the poll scale.
 */
export function writePreviewFor(
  fn: number,
  startAddress: number,
  values: readonly number[],
  scaled: ScaledProvider,
): WritePreview | null {
  if (fn === 6) {
    const raw = values[0];
    const cell = raw === undefined ? null : scaled(raw, startAddress);
    if (!cell) return null;
    const unit = cell.unit === "" ? "" : ` ${cell.unit}`;
    return {
      text: `Scaled: ${cell.text}${unit}${markerNote(cell.marker)}`,
      tone: cell.marker === "outOfRange" ? "warning" : "neutral",
      icon:
        cell.marker === "outOfRange"
          ? "triangle-alert"
          : cell.marker === "clamped-low"
            ? "arrow-down-to-line"
            : cell.marker === "clamped-high"
              ? "arrow-up-to-line"
              : null,
    };
  }
  if (fn === 16) {
    const cells = values.slice(0, PREVIEW_VALUES).map((raw, i) => scaled(raw, startAddress + i));
    const scaledCells = cells.filter((c) => c !== null);
    const first = scaledCells[0];
    if (!first) return null;
    // One unit for every listed item: printed once at the end. Otherwise after each value
    // (an empty unit counts as a unit of its own, DES-003 3.5).
    const sameUnit = scaledCells.every((c) => c.unit === first.unit);
    const items = cells.map((c) => {
      if (!c) return "—";
      const unit = !sameUnit && c.unit !== "" ? ` ${c.unit}` : "";
      return `${c.text}${unit}${markerNote(c.marker)}`;
    });
    const more = values.length > PREVIEW_VALUES ? " …" : "";
    const unit = sameUnit && first.unit !== "" ? ` ${first.unit}` : "";
    const flagged = scaledCells.some((c) => c.marker === "outOfRange");
    return {
      text: `Scaled: ${items.join(", ")}${more}${unit}`,
      tone: flagged ? "warning" : "neutral",
      icon: flagged ? "triangle-alert" : null,
    };
  }
  return null;
}
