// Validation of the scale editor and of the override range (DES-003 4, FE-003 task 02). The editor
// works on texts; the schemas turn them into `ScaleSettings` with the exact messages of DES-003 4.
import { z } from "zod";
import type {
  AddressBase,
  ScaleOutOfRange,
  ScaleOverride,
  ScalePreset,
  ScaleSettings,
} from "@/shared/ipc/modbus-master.types";
import { type FieldErrors, validate, wholeNumber } from "../validation/schemas";
import { displayAddressRange, toProtocolAddress } from "./address";
import { MAX_DECIMALS, plainNumber } from "./scale-math";
import {
  defaultRawRange,
  divisorChoiceOf,
  hasFixedEngineeringRange,
  presetDefaults,
  rangeLabel,
  rawLimits,
} from "./scale-presets";

/** The scale editor's texts (what the user typed), one per field. */
export interface ScaleForm {
  preset: ScalePreset;
  rawSigned: boolean;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  /** Which Divide button is on; "custom" shows the divisor field. */
  divisorMode: DivisorMode;
  divisor: string;
  decimals: string;
  unit: string;
  outOfRange: ScaleOutOfRange;
}

export type DivisorMode = "10" | "100" | "1000" | "custom";

export type ScaleFieldName = "xMin" | "xMax" | "yMin" | "yMax" | "divisor" | "decimals" | "unit";
export const SCALE_FIELDS: readonly ScaleFieldName[] = [
  "xMin",
  "xMax",
  "yMin",
  "yMax",
  "divisor",
  "decimals",
  "unit",
];
export type ScaleErrors = Partial<Record<ScaleFieldName, string>>;

// ---- the messages of DES-003 4, word for word ----
export const rawMinMessage = (signed: boolean) =>
  `Raw min must be a whole number from ${rawLimits(signed).min} to ${rawLimits(signed).max}.`;
export const rawMaxMessage = (signed: boolean) =>
  `Raw max must be a whole number from ${rawLimits(signed).min} to ${rawLimits(signed).max}.`;
export const RAW_EQUAL_MESSAGE = "Raw min and raw max must be different.";
export const ENG_MIN_MESSAGE = "Engineering min must be a number, for example 4 or -12.5.";
export const ENG_MAX_MESSAGE = "Engineering max must be a number, for example 20 or 100.5.";
export const ENG_COMMA_MESSAGE = "Use a dot as the decimal separator.";
export const ENG_EQUAL_MESSAGE = "Engineering min and max must be different.";
export const DIVISOR_MESSAGE = "Divisor must be a number other than 0.";
export const DECIMALS_MESSAGE = "Decimals must be a whole number from 0 to 6.";
export const UNIT_LENGTH_MESSAGE = "Unit must be at most 12 characters.";
export const UNIT_CONTROL_MESSAGE = "Unit cannot contain control characters.";
export const SCALE_NOT_APPLIED = "Scale not applied. Fix the highlighted fields.";
export const OVERRIDE_LIMIT_MESSAGE = "A poll can have at most 64 scale overrides.";
export const MAX_OVERRIDES = 64;
export const MAX_UNIT_CHARS = 12;
export const MAX_SIGNIFICANT_DIGITS = 15;

export const startMessage = (base: AddressBase) =>
  `Start address must be a whole number from ${displayAddressRange(base).min} to ${displayAddressRange(base).max}.`;
export const endMessage = (base: AddressBase) =>
  `End address must be a whole number from ${displayAddressRange(base).min} to ${displayAddressRange(base).max}.`;
export const END_BEFORE_START_MESSAGE = "End address must not be before the start address.";
export const overlapMessage = (a: number, b: number, base: AddressBase) =>
  `This range overlaps the override for ${rangeLabel(a, b, base)}.`;

// ---- number texts ----

const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

/** Digits that carry value: leading zeros do not count ("0.00125" has 3). */
function significantDigits(text: string): number {
  return text.replace(/^-/, "").replace(".", "").replace(/^0+/, "").length;
}

/**
 * A typed number: optional minus, digits, optional dot and digits, at most 15 significant digits.
 * No exponent, no comma, no spaces inside. Returns null when the text is not one.
 */
export function parseNumberText(text: string): number | null {
  const t = text.trim();
  if (!NUMBER_TEXT.test(t) || significantDigits(t) > MAX_SIGNIFICANT_DIGITS) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function rawInt(text: string, signed: boolean): number | null {
  const n = wholeNumber(text);
  const { min, max } = rawLimits(signed);
  return n !== null && n >= min && n <= max ? n : null;
}

function validUnit(text: string): "ok" | "length" | "control" {
  if (Array.from(text).length > MAX_UNIT_CHARS) return "length";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find control characters.
  return /[\u0000-\u001f\u007f-\u009f]/.test(text) ? "control" : "ok";
}

/** The fields each preset validates (the others keep whatever was typed and are not applied). */
export function fieldsOf(preset: ScalePreset): readonly ScaleFieldName[] {
  switch (preset) {
    case "none":
      return [];
    case "divide":
      return ["divisor", "decimals", "unit"];
    case "current4to20":
    case "voltage0to10":
      return ["xMin", "xMax", "decimals", "unit"];
    case "linear":
      return ["xMin", "xMax", "yMin", "yMax", "decimals", "unit"];
  }
}

const formSchema = z.object({
  preset: z.enum(["none", "current4to20", "voltage0to10", "divide", "linear"]),
  rawSigned: z.boolean(),
  xMin: z.string(),
  xMax: z.string(),
  yMin: z.string(),
  yMax: z.string(),
  divisorMode: z.enum(["10", "100", "1000", "custom"]),
  divisor: z.string(),
  decimals: z.string(),
  unit: z.string(),
  outOfRange: z.enum(["flag", "clamp"]),
});

/** The shape of the editor's texts, for reading a draft that came back from a handoff. */
export const scaleFormSchema = formSchema;

/**
 * The schema of the scale editor for a raw signedness. The output is the settings to apply, or null
 * for None (the poll then has no scale). Equal min/max messages are placed under the max field.
 */
export function scaleSchema(rawSigned: boolean) {
  return formSchema
    .superRefine((v, ctx) => {
      const add = (field: ScaleFieldName, message: string) =>
        ctx.addIssue({ code: "custom", message, path: [field] });
      const fields = fieldsOf(v.preset);

      if (fields.includes("xMin")) {
        const lo = rawInt(v.xMin, rawSigned);
        const hi = rawInt(v.xMax, rawSigned);
        if (lo === null) add("xMin", rawMinMessage(rawSigned));
        if (hi === null) add("xMax", rawMaxMessage(rawSigned));
        else if (lo !== null && lo === hi) add("xMax", RAW_EQUAL_MESSAGE);
      }
      if (fields.includes("yMin")) {
        const comma = (t: string) => t.includes(",");
        const lo = parseNumberText(v.yMin);
        const hi = parseNumberText(v.yMax);
        if (lo === null) add("yMin", comma(v.yMin) ? ENG_COMMA_MESSAGE : ENG_MIN_MESSAGE);
        if (hi === null) add("yMax", comma(v.yMax) ? ENG_COMMA_MESSAGE : ENG_MAX_MESSAGE);
        else if (lo !== null && lo === hi) add("yMax", ENG_EQUAL_MESSAGE);
      }
      if (fields.includes("divisor") && v.divisorMode === "custom") {
        const d = parseNumberText(v.divisor);
        if (d === null || d === 0) add("divisor", DIVISOR_MESSAGE);
      }
      if (fields.includes("decimals")) {
        const n = wholeNumber(v.decimals);
        if (n === null || n < 0 || n > MAX_DECIMALS) add("decimals", DECIMALS_MESSAGE);
      }
      if (fields.includes("unit")) {
        const unit = validUnit(v.unit);
        if (unit === "length") add("unit", UNIT_LENGTH_MESSAGE);
        else if (unit === "control") add("unit", UNIT_CONTROL_MESSAGE);
      }
    })
    .transform((v): ScaleSettings | null =>
      v.preset === "none" ? null : sanitizedSettings({ ...v, rawSigned }),
    );
}

/** "-0" typed by the user is stored as 0. */
function plusZero(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * The settings a form stands for: a field that is not valid (or not used by the preset) gets its
 * default, so the result is always something Rust accepts. Used for a valid form and to carry the
 * raw range over when the preset changes.
 */
export function sanitizedSettings(v: ScaleForm): ScaleSettings {
  const rawSigned = v.rawSigned;
  const defaults = presetDefaults(v.preset, null);
  const range = defaultRawRange(rawSigned);
  const xMin = rawInt(v.xMin, rawSigned);
  const xMax = rawInt(v.xMax, rawSigned);
  const fixed = hasFixedEngineeringRange(v.preset);
  const divisorValue =
    v.divisorMode === "custom" ? parseNumberText(v.divisor) : Number(v.divisorMode);
  const yMin = parseNumberText(v.yMin);
  const yMax = parseNumberText(v.yMax);
  const decimals = wholeNumber(v.decimals);
  return {
    preset: v.preset,
    rawSigned,
    xMin: plusZero(xMin ?? range.xMin),
    xMax: plusZero(xMax ?? range.xMax),
    yMin: plusZero(fixed || yMin === null ? defaults.yMin : yMin),
    yMax: plusZero(fixed || yMax === null ? defaults.yMax : yMax),
    divisor: divisorValue === null || divisorValue === 0 ? 10 : divisorValue,
    decimals: decimals === null || decimals < 0 || decimals > MAX_DECIMALS ? 2 : decimals,
    unit: validUnit(v.unit) === "ok" ? v.unit : defaults.unit,
    outOfRange: v.outOfRange,
  };
}

export type ScaleValidation =
  | { ok: true; settings: ScaleSettings | null }
  | { ok: false; errors: ScaleErrors };

/** Validates the editor's texts. The first message per field wins. */
export function validateScaleForm(form: ScaleForm): ScaleValidation {
  const result = validate(scaleSchema(form.rawSigned), form);
  return result.ok
    ? { ok: true, settings: result.value }
    : { ok: false, errors: result.errors as ScaleErrors };
}

// ---- forms from settings ----

/** A number as the text the editor shows. */
export function numberText(n: number): string {
  // A hand-edited profile may miss a field: the editor shows an empty text instead of failing.
  return typeof n === "number" && Number.isFinite(n) ? plainNumber(n) : "";
}

/** The editor's texts for applied settings; null is None, with the raw signedness a new scale gets. */
export function formFromSettings(s: ScaleSettings | null, newScaleRawSigned: boolean): ScaleForm {
  const settings = s ?? {
    ...presetDefaults("none", null),
    rawSigned: newScaleRawSigned,
    ...defaultRawRange(newScaleRawSigned),
  };
  return {
    preset: settings.preset,
    rawSigned: settings.rawSigned,
    xMin: numberText(settings.xMin),
    xMax: numberText(settings.xMax),
    yMin: numberText(settings.yMin),
    yMax: numberText(settings.yMax),
    divisorMode: String(divisorChoiceOf(settings.divisor)) as DivisorMode,
    divisor: numberText(settings.divisor),
    decimals: String(settings.decimals),
    unit: settings.unit,
    outOfRange: settings.outOfRange,
  };
}

// ---- overrides (DES-003 3.2, 4) ----

/**
 * The message for a set of new protocol ranges against the overrides a poll already has, or null.
 * `editingIndex` leaves that override out (it is being replaced). The count check comes first.
 */
export function overrideRangesMessage(
  ranges: ReadonlyArray<{ start: number; end: number }>,
  existing: readonly ScaleOverride[],
  base: AddressBase,
  editingIndex?: number | null,
): string | null {
  const others = existing.filter((_, i) => i !== editingIndex);
  if (others.length + ranges.length > MAX_OVERRIDES) return OVERRIDE_LIMIT_MESSAGE;
  for (const range of ranges) {
    const clash = others.find((o) => range.start <= o.end && range.end >= o.start);
    if (clash) return overlapMessage(clash.start, clash.end, base);
  }
  return null;
}

/** The Start and End fields of "Add override" (display base), validated against the other overrides. */
export function overrideSchema(
  base: AddressBase,
  existing: readonly ScaleOverride[],
  editingIndex?: number | null,
) {
  return z
    .object({ start: z.string(), end: z.string() })
    .superRefine((v, ctx) => {
      const add = (field: "start" | "end" | "range", message: string) =>
        ctx.addIssue({ code: "custom", message, path: [field] });
      const { min, max } = displayAddressRange(base);
      const inRange = (n: number | null): n is number => n !== null && n >= min && n <= max;
      const start = wholeNumber(v.start);
      const end = wholeNumber(v.end);
      if (!inRange(start)) add("start", startMessage(base));
      if (!inRange(end)) add("end", endMessage(base));
      else if (inRange(start) && end < start) add("end", END_BEFORE_START_MESSAGE);
      if (inRange(start) && inRange(end) && end >= start) {
        const message = overrideRangesMessage(
          [{ start: toProtocolAddress(start, base), end: toProtocolAddress(end, base) }],
          existing,
          base,
          editingIndex,
        );
        if (message) add("range", message);
      }
    })
    .transform((v) => ({
      start: toProtocolAddress(Number(v.start.trim()), base),
      end: toProtocolAddress(Number(v.end.trim()), base),
    }));
}

export type OverrideErrors = FieldErrors;
