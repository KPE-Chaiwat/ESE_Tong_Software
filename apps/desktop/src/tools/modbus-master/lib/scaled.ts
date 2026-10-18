// The seam between the poll view and value scaling (DES-003, FE-003). The poll view knows nothing
// about scale math: it asks a provider for the display of one raw value and renders what comes
// back. `createScaled` is the real provider; tests and tools can pass their own factory through the
// runtime's `createScaled` dependency.
import type { PollConfig } from "@/shared/ipc/modbus-master.types";
import { isBitFunction } from "./functions";
import { effectiveScale, formatResult, type ScaleResult, scaleKey, scaleValue } from "./scale-math";
import { overrideMarkerText } from "./scale-presets";

/** How a scaled value is marked in its cell (DES-003 1.4). */
export type ScaledMarker = "none" | "outOfRange" | "clamped-low" | "clamped-high";

export interface ScaledCell {
  /** The number as shown and copied: dot, fixed decimals, no unit ("4.00"). */
  text: string;
  /** The unit shown after the number in muted text; "" for none. */
  unit: string;
  marker: ScaledMarker;
  /** Tooltip of the cell, for example "Raw 70000 is outside the raw range 0-65535." */
  tooltip: string | null;
  /** Accessible name, for example "12.50 mA, out of range". */
  label: string;
  /** The row is covered by an override (the `sliders-horizontal` marker after the address). */
  override: { tooltip: string } | null;
}

/**
 * The scaled display of one raw value at a protocol address, or null when it has no scale.
 * `override` tells whether an address is covered by an override even when no value is there yet.
 */
export interface ScaledProvider {
  (raw: number, address: number): ScaledCell | null;
  override?(address: number): { tooltip: string } | null;
}

export const NO_SCALE: ScaledProvider = () => null;

/** Builds the provider of a poll. */
export type ScaledProviderFactory = (config: PollConfig) => ScaledProvider;

export const noScaleFactory: ScaledProviderFactory = () => NO_SCALE;

/** True when the poll has a scale or any override (the Scaled column and "Show" depend on it). */
export function hasAnyScale(config: Pick<PollConfig, "scale" | "scaleOverrides">): boolean {
  return (
    (config.scale !== null && config.scale.preset !== "none") || config.scaleOverrides.length > 0
  );
}

/**
 * Scaling is active for registers only (FC03 and FC04). A scale saved on a coil or discrete poll is
 * kept and ignored (DES-003 1.5).
 */
export function scaleActive(config: Pick<PollConfig, "definition">): boolean {
  return !isBitFunction(config.definition.function);
}

/** The Scaled column and the Show control can be used: a scale exists and the poll reads registers. */
export function scaleAvailable(
  config: Pick<PollConfig, "scale" | "scaleOverrides" | "definition">,
): boolean {
  return scaleActive(config) && hasAnyScale(config);
}

/**
 * The value columns the table shows. Without a usable scale (none set, or a coil or discrete poll)
 * only Raw can show, whatever a hand-edited profile or an older file says: a "scaled" setting with
 * no scale would hide every value (REV-007 m-3). The stored setting is left as it is.
 */
export function effectiveValueColumns(
  config: Pick<PollConfig, "scale" | "scaleOverrides" | "definition" | "valueColumns">,
): PollConfig["valueColumns"] {
  return scaleAvailable(config) ? config.valueColumns : "raw";
}

type ProviderConfig = Pick<PollConfig, "scale" | "scaleOverrides" | "definition" | "display">;

function cellOf(
  result: ScaleResult,
  scale: NonNullable<PollConfig["scale"]>,
  override: { tooltip: string } | null,
): ScaledCell {
  const text = formatResult(result, scale.decimals);
  const side = result.outOfRange;
  const clamp = side !== null && scale.outOfRange === "clamp";
  const flag = side !== null && !clamp;
  const range = `${scale.xMin}-${scale.xMax}`;
  const tooltip =
    side === null
      ? null
      : clamp
        ? `Raw ${result.x} is outside the raw range ${range}; shown clamped.`
        : `Raw ${result.x} is outside the raw range ${range}.`;
  const suffix = flag ? ", out of range" : clamp ? ", clamped" : "";
  const value = scale.unit === "" ? text : `${text} ${scale.unit}`;
  return {
    text,
    unit: scale.unit,
    marker: flag
      ? "outOfRange"
      : clamp
        ? side === "below"
          ? "clamped-low"
          : "clamped-high"
        : "none",
    tooltip,
    label: `${value}${suffix}`,
    override,
  };
}

/** Largest number of cached rows of one provider (a poll has at most 125 registers). */
const CACHE_LIMIT = 4096;

/**
 * The provider of a poll's current scale and overrides (DES-003 1.2, 1.4). The override that covers
 * an address wins over the poll scale. Each row's cell is computed once per raw value: the provider
 * is rebuilt only when the scale changes (see `createScaledFactory`), so an unchanged row costs a
 * lookup. A scale on a coil or discrete poll is ignored.
 */
export function createScaled(config: ProviderConfig): ScaledProvider {
  const pollScale = config.scale !== null && config.scale.preset !== "none" ? config.scale : null;
  if (!scaleActive(config) || (pollScale === null && config.scaleOverrides.length === 0)) {
    return NO_SCALE;
  }
  const overrides = config.scaleOverrides;
  const base = config.display.addressBase;
  const markers = new Map<number, { tooltip: string } | null>();
  const cells = new Map<number, { raw: number; cell: ScaledCell | null }>();

  const markerAt = (address: number): { tooltip: string } | null => {
    const cached = markers.get(address);
    if (cached !== undefined) return cached;
    const { override } = effectiveScale(address, null, overrides);
    // An override that holds None (a hand-edited profile) gives no value, so it gets no marker.
    const marker =
      override && override.scale.preset !== "none"
        ? { tooltip: overrideMarkerText(override, base) }
        : null;
    if (markers.size < CACHE_LIMIT) markers.set(address, marker);
    return marker;
  };

  const provider: ScaledProvider = (raw, address) => {
    const hit = cells.get(address);
    if (hit && hit.raw === raw) return hit.cell;
    const { scale } = effectiveScale(address, pollScale, overrides);
    const result = scale ? scaleValue(raw, scale) : null;
    const cell = result && scale ? cellOf(result, scale, markerAt(address)) : null;
    if (cells.size >= CACHE_LIMIT) cells.clear();
    cells.set(address, { raw, cell });
    return cell;
  };
  provider.override = markerAt;
  return provider;
}

function providerKey(config: ProviderConfig): string {
  return JSON.stringify([
    scaleActive(config),
    config.display.addressBase,
    scaleKey(config.scale),
    config.scaleOverrides.map((o) => [o.start, o.end, scaleKey(o.scale)]),
  ]);
}

/**
 * A factory that returns the same provider while the scale, the overrides, the address base and the
 * function stay as they are, so a config event about something else (an alias, a counter) does not
 * make every row compute again. One per poll view.
 */
export function createScaledFactory(): ScaledProviderFactory {
  let last: { key: string; provider: ScaledProvider } | null = null;
  return (config) => {
    const key = providerKey(config);
    if (last?.key === key) return last.provider;
    const provider = createScaled(config);
    last = { key, provider };
    return provider;
  };
}
