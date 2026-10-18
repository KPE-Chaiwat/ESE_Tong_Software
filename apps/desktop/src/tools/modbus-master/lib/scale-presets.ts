// Scale presets, their defaults and the summary texts (DES-003 2 and 3.1, FE-003 task 01). Pure.
import type {
  ScaleOutOfRange,
  ScaleOverride,
  ScalePreset,
  ScaleSettings,
} from "@/shared/ipc/modbus-master.types";
import { isLinear, plainNumber } from "./scale-math";

export const SCALE_PRESETS: readonly ScalePreset[] = [
  "none",
  "current4to20",
  "voltage0to10",
  "divide",
  "linear",
];

/** The labels of the preset select (DES-003 2). */
export const SCALE_PRESET_LABELS: Record<ScalePreset, string> = {
  none: "None (raw)",
  current4to20: "4-20 mA",
  voltage0to10: "0-10 V",
  divide: "Divide",
  linear: "Custom linear",
};

/** Raw range limits of an unsigned or signed register. */
export function rawLimits(signed: boolean): { min: number; max: number } {
  return signed ? { min: -32768, max: 32767 } : { min: 0, max: 65535 };
}

/** The raw range a new scale starts with (Q-003-02); a signed one cannot use 65535. */
export function defaultRawRange(signed: boolean): { xMin: number; xMax: number } {
  return signed ? { xMin: 0, xMax: 32767 } : { xMin: 0, xMax: 65535 };
}

/** The quick-pick buttons under the raw fields (DES-003 2). */
export const RAW_QUICK_PICKS: ReadonlyArray<{ label: string; xMin: number; xMax: number }> = [
  { label: "0-4095", xMin: 0, xMax: 4095 },
  { label: "0-27648", xMin: 0, xMax: 27648 },
  { label: "0-32767", xMin: 0, xMax: 32767 },
  { label: "0-65535", xMin: 0, xMax: 65535 },
  { label: "4000-20000", xMin: 4000, xMax: 20000 },
];

export const DIVISOR_CHOICES = [10, 100, 1000] as const;
export type DivisorChoice = (typeof DIVISOR_CHOICES)[number] | "custom";

/** Decimals of a divisor choice: 10 gives 1, 100 gives 2, 1000 gives 3, a custom divisor 2. */
export function divisorDecimals(choice: DivisorChoice): number {
  return choice === 10 ? 1 : choice === 100 ? 2 : choice === 1000 ? 3 : 2;
}

/** Which divisor button an applied divisor matches. */
export function divisorChoiceOf(divisor: number): DivisorChoice {
  return divisor === 10 || divisor === 100 || divisor === 1000 ? divisor : "custom";
}

/** The fixed engineering range and unit of the two current and voltage presets. */
const FIXED: Partial<Record<ScalePreset, { yMin: number; yMax: number; unit: string }>> = {
  current4to20: { yMin: 4, yMax: 20, unit: "mA" },
  voltage0to10: { yMin: 0, yMax: 10, unit: "V" },
};

/** True for 4-20 mA and 0-10 V, whose engineering range cannot be edited. */
export function hasFixedEngineeringRange(preset: ScalePreset): boolean {
  return FIXED[preset] !== undefined;
}

/**
 * The settings of a preset with its defaults (DES-003 2). Changing preset resets unit and decimals,
 * and keeps the raw range, the raw signedness and the out-of-range choice of `current`; Custom
 * linear starts from the engineering range of the preset it replaces.
 */
export function presetDefaults(preset: ScalePreset, current?: ScaleSettings | null): ScaleSettings {
  const rawSigned = current?.rawSigned ?? false;
  const range = defaultRawRange(rawSigned);
  const fixed = FIXED[preset];
  const keepsY = preset === "linear" && current && isLinear(current.preset) ? current : null;
  return {
    preset,
    rawSigned,
    xMin: current?.xMin ?? range.xMin,
    xMax: current?.xMax ?? range.xMax,
    yMin: fixed?.yMin ?? keepsY?.yMin ?? 0,
    yMax: fixed?.yMax ?? keepsY?.yMax ?? 100,
    divisor: 10,
    decimals: preset === "divide" ? divisorDecimals(10) : 2,
    unit: fixed?.unit ?? "",
    outOfRange: current?.outOfRange ?? "flag",
  };
}

/** The same settings as the preset's defaults but with the divisor choice applied. */
export function withDivisor(s: ScaleSettings, choice: DivisorChoice): ScaleSettings {
  return {
    ...s,
    divisor: choice === "custom" ? s.divisor : choice,
    decimals: divisorDecimals(choice),
  };
}

/**
 * The summary of a scale (DES-003 3.1): "Raw (no scale)", "4-20 mA (raw 0-65535)", "Divide by 10",
 * "Linear 4000-20000 to 0-100". The full form appends ", {n} dp", ", {unit}" and ", signed".
 */
export function scaleSummary(s: ScaleSettings | null, full: boolean): string {
  if (s === null || s.preset === "none") return "Raw (no scale)";
  let text: string;
  switch (s.preset) {
    case "current4to20":
      text = `4-20 mA (raw ${s.xMin}-${s.xMax})`;
      break;
    case "voltage0to10":
      text = `0-10 V (raw ${s.xMin}-${s.xMax})`;
      break;
    case "divide":
      text = `Divide by ${plainNumber(s.divisor)}`;
      break;
    case "linear":
      text = `Linear ${s.xMin}-${s.xMax} to ${plainNumber(s.yMin)}-${plainNumber(s.yMax)}`;
      break;
  }
  if (!full) return text;
  text += `, ${s.decimals} dp`;
  if (s.unit !== "") text += `, ${s.unit}`;
  if (s.rawSigned) text += ", signed";
  return text;
}

/** "0-3" or "5": a range of protocol addresses in the display base. */
export function rangeLabel(start: number, end: number, base: 0 | 1): string {
  return start === end ? String(start + base) : `${start + base}-${end + base}`;
}

/** The title and accessible name of an override marker (DES-003 3.2). */
export function overrideMarkerText(o: ScaleOverride, base: 0 | 1): string {
  return `Scale override ${rangeLabel(o.start, o.end, base)}: ${scaleSummary(o.scale, true)}`;
}

export const OUT_OF_RANGE_LABELS: Record<ScaleOutOfRange, string> = {
  flag: "Flag",
  clamp: "Clamp",
};

// ---- fixed texts (DES-003 1.5, 2, 3.1, 3.2) ----
export const SCALE_REGISTERS_ONLY = "Scaling applies to registers (FC03 and FC04) only.";
export const SCALE_KEPT_NOTE = "The scale is kept and applies again with FC03 or FC04.";
export const FIXED_ENGINEERING_HINT = "Choose Custom linear to change the engineering range.";
export const OVERRIDE_OUTSIDE_POLL = "Not in the current poll range";
export const OVERRIDES_WIN = "Overrides win over the poll scale.";
