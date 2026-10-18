// What the scale editor does with its texts (DES-003 2, 3.1, 4, FE-003 task 04): the same pure
// steps serve the SCALE section of the setup and the S8 override dialog. No store, no React.
import type { ScaleOutOfRange, ScalePreset } from "@/shared/ipc/modbus-master.types";
import {
  type DivisorChoice,
  divisorDecimals,
  presetDefaults,
  type RAW_QUICK_PICKS,
} from "../lib/scale-presets";
import {
  type DivisorMode,
  fieldsOf,
  formFromSettings,
  numberText,
  type ScaleErrors,
  type ScaleFieldName,
  type ScaleForm,
  sanitizedSettings,
  validateScaleForm,
} from "../lib/scale-validation";

/** The texts a form stands for when its preset is set to `preset` (DES-003 2: unit and decimals reset). */
export function withPreset(form: ScaleForm, preset: ScalePreset): ScaleForm {
  return formFromSettings(presetDefaults(preset, sanitizedSettings(form)), form.rawSigned);
}

/** A divisor button: sets the divisor and the decimals that go with it (DES-003 2). */
export function withDivisorMode(form: ScaleForm, mode: DivisorMode): ScaleForm {
  const choice: DivisorChoice = mode === "custom" ? "custom" : (Number(mode) as 10 | 100 | 1000);
  return {
    ...form,
    divisorMode: mode,
    divisor: mode === "custom" ? (form.divisorMode === "custom" ? form.divisor : "") : mode,
    decimals: String(divisorDecimals(choice)),
  };
}

/** A quick pick fills both raw fields. */
export function withQuickPick(form: ScaleForm, pick: (typeof RAW_QUICK_PICKS)[number]): ScaleForm {
  return { ...form, xMin: numberText(pick.xMin), xMax: numberText(pick.xMax) };
}

export function withField(form: ScaleForm, field: ScaleFieldName, value: string): ScaleForm {
  return { ...form, [field]: value };
}

export function withOutOfRange(form: ScaleForm, mode: ScaleOutOfRange): ScaleForm {
  return { ...form, outOfRange: mode };
}

/** The same texts, equal field by field (inactive fields count: they are part of what was typed). */
export function sameForm(a: ScaleForm, b: ScaleForm): boolean {
  return (
    a.preset === b.preset &&
    a.rawSigned === b.rawSigned &&
    a.xMin === b.xMin &&
    a.xMax === b.xMax &&
    a.yMin === b.yMin &&
    a.yMax === b.yMax &&
    a.divisorMode === b.divisorMode &&
    a.divisor === b.divisor &&
    a.decimals === b.decimals &&
    a.unit === b.unit &&
    a.outOfRange === b.outOfRange
  );
}

/**
 * The messages for some fields of a form (blur, signedness toggle). The equal-min/max messages
 * belong to the max field, so touching a min field also reports them when the max is already typed.
 */
export function errorsForFields(form: ScaleForm, fields: readonly ScaleFieldName[]): ScaleErrors {
  const result = validateScaleForm(form);
  if (result.ok) return {};
  const out: ScaleErrors = {};
  for (const field of fields) {
    const message = result.errors[field];
    if (message !== undefined) out[field] = message;
  }
  return out;
}

/** All messages of a form (Apply, Save). */
export function allErrors(form: ScaleForm): ScaleErrors {
  const result = validateScaleForm(form);
  return result.ok ? {} : result.errors;
}

/** The fields whose messages go away or appear together with `field` when it is left. */
export function relatedFields(field: ScaleFieldName): readonly ScaleFieldName[] {
  if (field === "xMin" || field === "xMax") return ["xMin", "xMax"];
  if (field === "yMin" || field === "yMax") return ["yMin", "yMax"];
  return [field];
}

/** Drops the messages of fields the preset does not use. */
export function activeErrors(form: ScaleForm, errors: ScaleErrors): ScaleErrors {
  const active = fieldsOf(form.preset);
  const out: ScaleErrors = {};
  for (const [field, message] of Object.entries(errors) as Array<[ScaleFieldName, string]>) {
    if (active.includes(field)) out[field] = message;
  }
  return out;
}
