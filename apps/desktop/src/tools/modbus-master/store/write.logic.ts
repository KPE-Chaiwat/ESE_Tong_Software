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
