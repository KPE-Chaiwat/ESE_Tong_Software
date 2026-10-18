// The example line of the S8 override dialog (DES-003 3.2, revision 6): what the draft scale makes
// of a raw value, or just the reminder when the draft cannot be applied yet. Pure.
import { scaleText } from "./scale-math";
import { OVERRIDES_WIN } from "./scale-presets";
import { type ScaleForm, validateScaleForm } from "./scale-validation";

/** The raw value the example uses when the first address has no value yet. */
export const EXAMPLE_RAW = 1000;

/**
 * "Example: raw 253 shows 25.3 °C. Overrides win over the poll scale." For an invalid draft the
 * line is only "Overrides win over the poll scale.".
 */
export function overrideExampleText(form: ScaleForm, raw: number | undefined): string {
  const x = raw ?? EXAMPLE_RAW;
  const result = validateScaleForm(form);
  if (!result.ok || result.settings === null) return OVERRIDES_WIN;
  const scaled = scaleText(x, result.settings);
  if (scaled === null) return OVERRIDES_WIN;
  const unit = result.settings.unit === "" ? "" : ` ${result.settings.unit}`;
  return `Example: raw ${x} shows ${scaled}${unit}. ${OVERRIDES_WIN}`;
}
