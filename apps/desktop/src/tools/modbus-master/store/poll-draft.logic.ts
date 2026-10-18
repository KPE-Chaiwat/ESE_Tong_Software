// The poll setup draft (DES-002 2.3.3): what the user typed in the POLL section and has not applied
// yet. The draft lives in the poll view's UI store, so closing the dock or popover, switching to
// the native panel and moving the poll between hosts never loses an edit. Pure.
import type {
  AddressBase,
  ConnectionMode,
  PollConfig,
  PollDefinition,
} from "@/shared/ipc/modbus-master.types";
import { toDisplayAddress } from "../lib/address";
import { pollNameError } from "../lib/poll-names";
import { pollSchema, validate, wholeNumber } from "../validation/schemas";

export const POLL_DRAFT_FIELDS = [
  "name",
  "slaveId",
  "function",
  "startAddress",
  "quantity",
  "scanRateMs",
] as const;
export type PollDraftField = (typeof POLL_DRAFT_FIELDS)[number];

export interface PollSetupDraft {
  name: string;
  slaveId: string;
  function: string;
  /** In the display base. */
  startAddress: string;
  quantity: string;
  scanRateMs: string;
  /** Fields the user changed. A field that is not dirty follows the poll (a rename elsewhere). */
  dirty: PollDraftField[];
  /** Messages under the fields (shown after blur or Apply). */
  errors: Partial<Record<PollDraftField, string>>;
}

export function draftTexts(config: PollConfig): Record<PollDraftField, string> {
  const def = config.definition;
  return {
    name: config.name,
    slaveId: String(def.slaveId),
    function: String(def.function),
    startAddress: String(toDisplayAddress(def.startAddress, config.display.addressBase)),
    quantity: String(def.quantity),
    scanRateMs: String(def.scanRateMs),
  };
}

/** A draft that equals the applied poll (no field dirty). */
export function draftFromConfig(config: PollConfig): PollSetupDraft {
  return { ...draftTexts(config), dirty: [], errors: {} };
}

export function draftHasEdits(draft: PollSetupDraft | null): boolean {
  return draft !== null && draft.dirty.length > 0;
}

/** Sets one field. The field is dirty while its text differs from the applied poll. */
export function patchDraft(
  draft: PollSetupDraft | null,
  config: PollConfig,
  field: PollDraftField,
  text: string,
): PollSetupDraft {
  const base = draft ?? draftFromConfig(config);
  const differs = text !== draftTexts(config)[field];
  const dirty = differs
    ? base.dirty.includes(field)
      ? base.dirty
      : [...base.dirty, field]
    : base.dirty.filter((f) => f !== field);
  // An edit takes the old message away; the field is checked again on blur and on Apply.
  const { [field]: _removed, ...errors } = base.errors;
  return { ...base, [field]: text, dirty, errors };
}

/**
 * The applied poll changed (a rename elsewhere, an Apply, a change of the display base). Fields
 * that are not dirty follow it; dirty fields keep their text and message. No dirty field left
 * means no draft.
 */
export function reconcileDraft(
  draft: PollSetupDraft | null,
  config: PollConfig,
): PollSetupDraft | null {
  if (draft === null) return null;
  const texts = draftTexts(config);
  const next: PollSetupDraft = { ...draft };
  for (const field of POLL_DRAFT_FIELDS) {
    if (!draft.dirty.includes(field)) next[field] = texts[field];
    else if (draft[field] === texts[field]) {
      // The applied value caught up with what the user typed.
      next.dirty = next.dirty.filter((f) => f !== field);
    }
  }
  return next.dirty.length === 0 ? null : next;
}

/**
 * The display base changed: the start address text shows the same protocol address in the new
 * base. Only a valid number is converted.
 */
export function rebaseDraft(
  draft: PollSetupDraft | null,
  oldBase: AddressBase,
  newBase: AddressBase,
): PollSetupDraft | null {
  if (draft === null || oldBase === newBase) return draft;
  const n = wholeNumber(draft.startAddress);
  if (n === null) return draft;
  const { startAddress: _drop, ...errors } = draft.errors;
  return { ...draft, startAddress: String(n + (newBase - oldBase)), errors };
}

export interface DraftContext {
  mode: ConnectionMode;
  base: AddressBase;
  /** The other polls' names. */
  others: readonly string[];
}

export type DraftResult =
  | { ok: true; name: string; definition: PollDefinition }
  | { ok: false; errors: Partial<Record<PollDraftField, string>> };

/** Validates the whole draft: the poll definition (DES-001 3.2) and the name (DES-002 section 4). */
export function validateDraft(draft: PollSetupDraft, ctx: DraftContext): DraftResult {
  const errors: Partial<Record<PollDraftField, string>> = {};
  const nameMessage = pollNameError(draft.name, ctx.others);
  if (nameMessage) errors.name = nameMessage;
  const result = validate(pollSchema(ctx.mode, ctx.base), draft);
  if (!result.ok) {
    for (const field of POLL_DRAFT_FIELDS) {
      const message = result.errors[field];
      if (message && field !== "name") errors[field] = message;
    }
  }
  if (Object.keys(errors).length > 0 || !result.ok) return { ok: false, errors };
  return { ok: true, name: draft.name, definition: result.value };
}

/** Validates one field on blur: the messages of the other fields are not touched. */
export function validateDraftField(
  draft: PollSetupDraft,
  field: PollDraftField,
  ctx: DraftContext,
): PollSetupDraft {
  const result = validateDraft(draft, ctx);
  const message = result.ok ? undefined : result.errors[field];
  const { [field]: _old, ...rest } = draft.errors;
  return { ...draft, errors: message ? { ...rest, [field]: message } : rest };
}
