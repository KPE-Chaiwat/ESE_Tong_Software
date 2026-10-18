// The applied scale of a poll: how a change becomes a `mm_set_poll_view` patch (DES-003 1.1, 1.5,
// 3.2, FE-003 task 03). Pure: the store calls these and sends what they return.
import type {
  PollConfig,
  PollViewSettings,
  ScaleOverride,
  ScaleSettings,
  ValueColumns,
} from "@/shared/ipc/modbus-master.types";
import type { AddressRange } from "../lib/address-ranges";
import { hasAnyScale } from "../lib/scaled";

type ScaleConfig = Pick<PollConfig, "scale" | "scaleOverrides" | "valueColumns">;

/** Raw, then Scaled, then Both (`Ctrl+Shift+V`). Raw only while there is no scale. */
export function nextValueColumns(current: ValueColumns, hasScale: boolean): ValueColumns {
  if (!hasScale) return "raw";
  return current === "raw" ? "scaled" : current === "scaled" ? "both" : "raw";
}

/**
 * The value columns after the scale or the overrides changed (DES-003 1.5): the first scale of a
 * poll switches the table to Both, and removing the last one goes back to Raw. Otherwise the
 * user's choice stays (undefined: nothing to change).
 */
export function valueColumnsAfter(
  before: ScaleConfig,
  after: Pick<PollConfig, "scale" | "scaleOverrides">,
): ValueColumns | undefined {
  const had = hasAnyScale(before);
  const has = hasAnyScale(after);
  if (!had && has) return "both";
  if (had && !has) return "raw";
  return undefined;
}

export function sortOverrides(overrides: readonly ScaleOverride[]): ScaleOverride[] {
  return [...overrides].sort((a, b) => a.start - b.start);
}

/** The settings that apply, or null for None: a stored None is no scale. */
export function normalizedScale(s: ScaleSettings | null): ScaleSettings | null {
  return s === null || s.preset === "none" ? null : s;
}

/** Field by field, so the order of the keys of either object does not matter. */
export function sameScale(a: ScaleSettings | null, b: ScaleSettings | null): boolean {
  const x = normalizedScale(a);
  const y = normalizedScale(b);
  if (x === null || y === null) return x === y;
  return (
    x.preset === y.preset &&
    x.rawSigned === y.rawSigned &&
    x.xMin === y.xMin &&
    x.xMax === y.xMax &&
    x.yMin === y.yMin &&
    x.yMax === y.yMax &&
    x.divisor === y.divisor &&
    x.decimals === y.decimals &&
    x.unit === y.unit &&
    x.outOfRange === y.outOfRange
  );
}

/** The patch of applying `scale` (null removes it). */
export function patchForScale(
  config: ScaleConfig,
  scale: ScaleSettings | null,
): Partial<PollViewSettings> {
  const next = normalizedScale(scale);
  const columns = valueColumnsAfter(config, { scale: next, scaleOverrides: config.scaleOverrides });
  return { scale: next, ...(columns === undefined ? {} : { valueColumns: columns }) };
}

/** The patch of a new override list. */
export function patchForOverrides(
  config: ScaleConfig,
  overrides: readonly ScaleOverride[],
): Partial<PollViewSettings> {
  const sorted = sortOverrides(overrides);
  const columns = valueColumnsAfter(config, { scale: config.scale, scaleOverrides: sorted });
  return { scaleOverrides: sorted, ...(columns === undefined ? {} : { valueColumns: columns }) };
}

/** One override per range, each with its own copy of the scale. */
export function overridesForRanges(
  ranges: readonly AddressRange[],
  scale: ScaleSettings,
): ScaleOverride[] {
  return ranges.map((r) => ({ start: r.start, end: r.end, scale: { ...scale } }));
}

/** The overrides left after `ranges` are removed: every override that touches any of them goes. */
export function withoutOverridesIn(
  overrides: readonly ScaleOverride[],
  ranges: readonly AddressRange[],
): ScaleOverride[] {
  return overrides.filter((o) => !ranges.some((r) => r.start <= o.end && r.end >= o.start));
}

/** True when an override touches the ranges (the "Remove scale override" entry is offered). */
export function overridesTouching(
  overrides: readonly ScaleOverride[],
  ranges: readonly AddressRange[],
): ScaleOverride[] {
  return overrides.filter((o) => ranges.some((r) => r.start <= o.end && r.end >= o.start));
}

/** An override lies outside the poll's current range (it is kept, listed and idle). */
export function overrideOutsidePoll(
  o: Pick<ScaleOverride, "start" | "end">,
  start: number,
  quantity: number,
): boolean {
  return o.end < start || o.start > start + quantity - 1;
}
