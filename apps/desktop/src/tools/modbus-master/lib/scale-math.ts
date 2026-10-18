// Value scaling, the pure math (DES-003 1, FE-003 task 01). No React, no IPC, no store.
//
//   linear:  Y = (X - Xmin) / (Xmax - Xmin) x (Ymax - Ymin) + Ymin   (float64)
//   divide:  Y = X / divisor                                          (exact for an integer divisor)
//
// X is the raw register read unsigned or signed (`rawSigned`). The raw value never changes; this is
// only what is shown, copied and previewed.
import type { ScaleOverride, ScaleSettings } from "@/shared/ipc/modbus-master.types";

/** What a value of 1e15 or more shows instead of a number (DES-003 1.3). */
export const TOO_LARGE = "too large";
export const TOO_LARGE_LIMIT = 1e15;

/** The most decimals a scale shows (DES-003 1.1). */
export const MAX_DECIMALS = 6;

/**
 * Relative tolerance of the float tie rule (DES-003 1.3): `|s| - floor(|s|)` within
 * `1e-9 x max(1, |s|)` of 0.5 is a tie. Taken literally the band exceeds 0.5 once |s| passes 5e8
 * and every value would round up, so the band is capped at `TIE_CAP`. Below |s| = 1000 the cap is
 * not reached and the rule is exactly the design's (REPORTED to the designer, Q-FE3-01).
 */
const TIE_RELATIVE = 1e-9;
export const TIE_CAP = 1e-6;

export type OutOfRangeSide = "below" | "above";

/** An exact quotient `numerator / denominator` (integers), for Divide with an integer divisor. */
export interface ExactRatio {
  numerator: number;
  denominator: number;
}

export interface ScaleResult {
  /** The scaled value as a float (clamped for `outOfRange: "clamp"`). */
  y: number;
  /** The raw value as the scale reads it (signed when `rawSigned`). */
  x: number;
  /** The raw value lies outside the raw range (linear presets only). */
  outOfRange: OutOfRangeSide | null;
  /** Set for Divide by an integer: formatting uses integer arithmetic so ties are exact. */
  exact: ExactRatio | null;
}

/** The register as a number: unsigned 0..65535, or signed -32768..32767 with `signed`. */
export function rawToX(raw: number, signed: boolean): number {
  const u16 = raw & 0xffff;
  return signed && u16 > 0x7fff ? u16 - 0x10000 : u16;
}

/** True for the presets that use the linear formula. */
export function isLinear(preset: ScaleSettings["preset"]): boolean {
  return preset === "current4to20" || preset === "voltage0to10" || preset === "linear";
}

/**
 * The scaled value of one raw register, or null when the scale is None or cannot be computed
 * (equal raw ends, divisor 0: the editor never lets these through, a hand-edited profile might).
 */
export function scaleValue(raw: number, s: ScaleSettings): ScaleResult | null {
  if (s.preset === "none") return null;
  const x = rawToX(raw, s.rawSigned);

  if (s.preset === "divide") {
    const d = s.divisor;
    if (!Number.isFinite(d) || d === 0) return null;
    return {
      x,
      y: x / d,
      outOfRange: null,
      exact: Number.isSafeInteger(d) ? { numerator: x, denominator: d } : null,
    };
  }

  const span = s.xMax - s.xMin;
  if (!Number.isFinite(span) || span === 0) return null;
  const lo = Math.min(s.xMin, s.xMax);
  const hi = Math.max(s.xMin, s.xMax);
  const outOfRange: OutOfRangeSide | null = x < lo ? "below" : x > hi ? "above" : null;

  if (outOfRange !== null && s.outOfRange === "clamp") {
    // The Y of the nearest raw end, which also covers reversed raw and engineering ranges. The
    // end is taken from the settings, not recomputed, so it is exact.
    const forward = s.xMin <= s.xMax;
    const y = outOfRange === "below" ? (forward ? s.yMin : s.yMax) : forward ? s.yMax : s.yMin;
    return { x, y, outOfRange, exact: null };
  }
  const y = ((x - s.xMin) / span) * (s.yMax - s.yMin) + s.yMin;
  return { x, y, outOfRange, exact: null };
}

function plainDigits(magnitude: bigint, decimals: number, negative: boolean): string {
  const digits = magnitude.toString().padStart(decimals + 1, "0");
  const whole = decimals === 0 ? digits : digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : `.${digits.slice(digits.length - decimals)}`;
  // A result that rounds to zero has no minus sign (DES-003 1.3).
  return `${negative && magnitude !== 0n ? "-" : ""}${whole}${fraction}`;
}

function clampDecimals(decimals: number): number {
  return Math.min(MAX_DECIMALS, Math.max(0, Math.trunc(Number.isFinite(decimals) ? decimals : 0)));
}

/**
 * A float with `decimals` places: dot, no thousands separator, trailing zeros kept, no exponent,
 * rounded half away from zero with the tie rule of DES-003 1.3 (0.15 shows 0.2 at 1 place, although
 * it is stored as 0.1499999...). A magnitude of 1e15 or more, after rounding, is "too large".
 */
export function formatScaled(y: number, decimals: number): string {
  if (!Number.isFinite(y) || Math.abs(y) >= TOO_LARGE_LIMIT) return TOO_LARGE;
  const places = clampDecimals(decimals);
  const abs = Math.abs(y);
  // The whole part and the fraction are rounded apart: `abs x 10^places` would lose digits above
  // 2^53 (999999999999999.00 would print as ...999.04), while `abs - floor(abs)` is exact.
  const whole = Math.floor(abs);
  const scaledFraction = (abs - whole) * 10 ** places;
  const fractionFloor = Math.floor(scaledFraction);
  const tolerance = Math.min(TIE_RELATIVE * Math.max(1, abs * 10 ** places), TIE_CAP);
  const isTie = Math.abs(scaledFraction - fractionFloor - 0.5) <= tolerance;
  const fraction = isTie ? fractionFloor + 1 : Math.round(scaledFraction);
  const magnitude = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction);
  // The limit applies to the rounded magnitude: 999999999999999.5 at 0 places rounds up to 1e15.
  if (magnitude >= BigInt(TOO_LARGE_LIMIT) * 10n ** BigInt(places)) return TOO_LARGE;
  return plainDigits(magnitude, places, y < 0);
}

/**
 * `numerator / denominator` with `decimals` places in integer arithmetic, half away from zero:
 * ties are exact (25 / 10 at 0 places is 3, -25 / 10 is -3).
 */
export function formatRatio(ratio: ExactRatio, decimals: number): string {
  const places = clampDecimals(decimals);
  const negative = ratio.numerator < 0 !== ratio.denominator < 0;
  const n = BigInt(Math.abs(ratio.numerator)) * 10n ** BigInt(places);
  const d = BigInt(Math.abs(ratio.denominator));
  let q = n / d;
  if (2n * (n % d) >= d) q += 1n;
  if (q >= BigInt(TOO_LARGE_LIMIT) * 10n ** BigInt(places)) return TOO_LARGE;
  return plainDigits(q, places, negative);
}

/** The text of a result: exact for Divide by an integer, the float rule for everything else. */
export function formatResult(result: ScaleResult, decimals: number): string {
  return result.exact ? formatRatio(result.exact, decimals) : formatScaled(result.y, decimals);
}

/** The scaled text of one raw register, or null when the scale gives no value. */
export function scaleText(raw: number, s: ScaleSettings): string | null {
  const result = scaleValue(raw, s);
  return result ? formatResult(result, s.decimals) : null;
}

/** Which scale applies to an address, and the override that supplies it (DES-003 1.1, 3.2). */
export interface EffectiveScale {
  scale: ScaleSettings | null;
  override: ScaleOverride | null;
}

/** The override that covers the address wins over the poll scale. */
export function effectiveScale(
  address: number,
  pollScale: ScaleSettings | null,
  overrides: readonly ScaleOverride[],
): EffectiveScale {
  for (const override of overrides) {
    if (address >= override.start && address <= override.end) {
      return { scale: override.scale, override };
    }
  }
  return { scale: pollScale, override: null };
}

/** A string that changes exactly when the scale's result for a raw value can change. */
export function scaleKey(s: ScaleSettings | null): string {
  if (s === null || s.preset === "none") return "none";
  return [
    s.preset,
    s.rawSigned ? 1 : 0,
    s.xMin,
    s.xMax,
    s.yMin,
    s.yMax,
    s.divisor,
    s.decimals,
    s.unit,
    s.outOfRange,
  ].join("|");
}

/** A number as plain decimal text without exponent ("1e-7" becomes "0.0000001"). */
export function plainNumber(n: number): string {
  const text = String(n);
  if (!text.includes("e")) return text;
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}
