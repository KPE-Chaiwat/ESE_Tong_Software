// The checks the real backend makes at the command boundary (DES-002 section 4, BE-002), as far as
// the fake needs them. They are written out here on purpose: the frontend validates the same rules
// in the tool folder, and a fake that reused that code could not catch a frontend that skips a
// check.

export const MAX_POLLS = 16;
export const MAX_ALIASES = 2000;
export const MAX_SCALE_OVERRIDES = 64;
export const MAX_SCALE_UNIT_CHARS = 16;
export const MAX_SCALE_DECIMALS = 6;
export const MAX_POLLS_MESSAGE = "A connection can have at most 16 polls.";

const length = (text: string) => Array.from(text).length;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what these rules reject.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The first failing rule for a poll name, or null. `others` are the other polls' names. */
export function checkPollName(name: string, others: readonly string[]): string | null {
  if (name.trim() === "") return "Enter a poll name.";
  if (length(name) > 48) return "Poll name must be at most 48 characters.";
  if (/^\s|\s$/.test(name)) return "Poll name cannot start or end with a space.";
  if (CONTROL.test(name)) return "Poll name cannot contain control characters.";
  const lower = name.toLowerCase();
  if (others.some((n) => n.toLowerCase() === lower)) {
    return `A poll named "${name}" already exists on this connection.`;
  }
  return null;
}

/** The first failing rule for a stored alias (stored aliases are never empty), or null. */
export function checkAliasText(alias: string): string | null {
  if (alias.trim() === "") return "Alias must not be empty.";
  if (length(alias) > 32) return "Alias must be at most 32 characters.";
  if (/^\s|\s$/.test(alias)) return "Alias cannot start or end with a space.";
  if (CONTROL.test(alias)) return "Alias cannot contain control characters.";
  return null;
}

/** "Tank copy", "Tank copy 2", ... within 48 characters. */
export function nextCopyName(source: string, names: readonly string[]): string {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  const build = (suffix: string) =>
    `${Array.from(source)
      .slice(0, 48 - length(suffix))
      .join("")
      .trimEnd()}${suffix}`;
  const first = build(" copy");
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; ; n += 1) {
    const candidate = build(` copy ${n}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

const MAX_QUANTITY = { 1: 2000, 2: 2000, 3: 125, 4: 125 } as const;

export interface DefinitionLike {
  slaveId: number;
  function: number;
  startAddress: number;
  quantity: number;
  scanRateMs: number;
}

/**
 * The checks of `validate_poll` (BE-002): the slave id, RTU slave 0 for reads, the function, the
 * quantity per function, the end of the address range and the scan rate. Returns the first failing
 * rule as `{ field, message }`, or null. Written out here on purpose (see the top of this file).
 */
export function checkDefinition(
  def: DefinitionLike,
  rtu: boolean,
): { field: string; message: string } | null {
  if (!Number.isInteger(def.slaveId) || def.slaveId < 0 || def.slaveId > 247) {
    return { field: "slaveId", message: "Slave ID must be a whole number from 0 to 247." };
  }
  if (rtu && def.slaveId === 0) {
    return {
      field: "slaveId",
      message: "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247.",
    };
  }
  const max = MAX_QUANTITY[def.function as 1 | 2 | 3 | 4];
  if (max === undefined) {
    return { field: "function", message: "Poll function must be 01, 02, 03 or 04." };
  }
  if (!Number.isInteger(def.quantity) || def.quantity < 1 || def.quantity > max) {
    return {
      field: "quantity",
      message: `Quantity for FC${String(def.function).padStart(2, "0")} must be from 1 to ${max}.`,
    };
  }
  const room = 0x10000 - def.startAddress;
  if (def.startAddress < 0 || def.startAddress > 0xffff || def.quantity > room) {
    return {
      field: "quantity",
      message: `This range ends after the last address (65535). The maximum quantity from ${def.startAddress} is ${room}.`,
    };
  }
  if (!Number.isInteger(def.scanRateMs) || def.scanRateMs < 20 || def.scanRateMs > 60000) {
    return {
      field: "scanRateMs",
      message: "Scan rate must be a whole number from 20 to 60000 ms.",
    };
  }
  return null;
}

/** The shape of a scale, as `check_scale` (crates/shared-types/src/view.rs). Null when it is fine. */
export function checkScale(scale: {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  divisor: number;
  decimals: number;
  unit: string;
}): string | null {
  const rawOk = (x: number) => Number.isInteger(x) && x >= -32768 && x <= 65535;
  if (!rawOk(scale.xMin) || !rawOk(scale.xMax)) {
    return "Raw min and max must be from -32768 to 65535.";
  }
  if (![scale.yMin, scale.yMax, scale.divisor].every(Number.isFinite)) {
    return "Scale numbers must be finite.";
  }
  if (
    !Number.isInteger(scale.decimals) ||
    scale.decimals < 0 ||
    scale.decimals > MAX_SCALE_DECIMALS
  ) {
    return "Decimals must be a whole number from 0 to 6.";
  }
  if (length(scale.unit) > MAX_SCALE_UNIT_CHARS) return "Unit must be at most 16 characters.";
  if (CONTROL.test(scale.unit)) return "Unit cannot contain control characters.";
  return null;
}

/** The checks of `check_scale_overrides`: at most 64, `start <= end`, valid scales. */
export function checkScaleOverrides(
  overrides: readonly { start: number; end: number; scale: Parameters<typeof checkScale>[0] }[],
): string | null {
  if (overrides.length > MAX_SCALE_OVERRIDES) return "A poll can have at most 64 scale overrides.";
  for (const o of overrides) {
    if (o.start > o.end) {
      return `Scale override ${o.start}-${o.end}: the end address must not be before the start address.`;
    }
    const problem = checkScale(o.scale);
    if (problem) return `Scale override ${o.start}-${o.end}: ${problem}`;
  }
  return null;
}

/** `check_display`: the address base is 0 or 1. */
export function checkDisplayShape(display: { addressBase: number }): string | null {
  return display.addressBase === 0 || display.addressBase === 1
    ? null
    : `display.addressBase must be 0 or 1 (found ${display.addressBase}).`;
}

export const MAX_FORMAT_OVERRIDES = 256;

const FORMAT_WIDTH: Record<string, number> = {
  unsigned: 1,
  signed: 1,
  hex: 1,
  binary: 1,
  signed32: 2,
  unsigned32: 2,
  float32: 2,
  signed64: 4,
  unsigned64: 4,
  float64: 4,
};

const FORMAT_LABEL: Record<string, string> = {
  signed32: "Signed 32-bit",
  unsigned32: "Unsigned 32-bit",
  float32: "Float 32-bit",
  signed64: "Signed 64-bit",
  unsigned64: "Unsigned 64-bit",
  float64: "Float 64-bit",
};

export interface FormatOverrideLike {
  start: number;
  end: number;
  format: string;
  swapBytes: boolean;
  reverseWords: boolean;
}

/**
 * `check_format_overrides` (crates/shared-types/src/view.rs, BE-009): at most 256, each range
 * ordered, a multiple of its width and without flags on a 16-bit format, then no overlap. The list is
 * checked sorted by `start`. Returns the exact message of the first failure, or null.
 */
export function checkFormatOverrides(overrides: readonly FormatOverrideLike[]): string | null {
  if (overrides.length > MAX_FORMAT_OVERRIDES) {
    return "A poll can have at most 256 format overrides.";
  }
  const sorted = [...overrides].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const o of sorted) {
    const { start, end } = o;
    if (start > end) {
      return `Format override ${start}-${end}: the end address must not be before the start address.`;
    }
    const width = FORMAT_WIDTH[o.format] ?? 1;
    if ((end - start + 1) % width !== 0) {
      return `Format override ${start}-${end}: ${FORMAT_LABEL[o.format] ?? o.format} needs a multiple of ${width} registers.`;
    }
    if (width === 1 && (o.swapBytes || o.reverseWords)) {
      return `Format override ${start}-${end}: byte and word order apply to 32-bit and 64-bit formats only.`;
    }
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1] as FormatOverrideLike;
    const b = sorted[i] as FormatOverrideLike;
    if (b.start <= a.end) {
      return `Format overrides ${a.start}-${a.end} and ${b.start}-${b.end} overlap.`;
    }
  }
  return null;
}

/** The message of the command boundary for a malformed `formatOverrides` value. */
export const FORMAT_OVERRIDES_SHAPE_MESSAGE = "Choose a supported format and byte/word order.";

const KNOWN_FORMATS = new Set(Object.keys(FORMAT_WIDTH));

/** The shape check at the command boundary (`value_inputs.rs`): every key present and typed. */
export function checkFormatOverridesShape(value: unknown): string | null {
  if (!Array.isArray(value)) return FORMAT_OVERRIDES_SHAPE_MESSAGE;
  const keys = ["start", "end", "format", "swapBytes", "reverseWords"];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return FORMAT_OVERRIDES_SHAPE_MESSAGE;
    const o = item as Record<string, unknown>;
    if (Object.keys(o).length !== keys.length || !keys.every((k) => k in o)) {
      return FORMAT_OVERRIDES_SHAPE_MESSAGE;
    }
    const u16 = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 65535;
    if (
      !u16(o.start) ||
      !u16(o.end) ||
      typeof o.format !== "string" ||
      !KNOWN_FORMATS.has(o.format) ||
      typeof o.swapBytes !== "boolean" ||
      typeof o.reverseWords !== "boolean"
    ) {
      return FORMAT_OVERRIDES_SHAPE_MESSAGE;
    }
  }
  return null;
}

interface RuleLike {
  name: string;
  range: { start: number; end: number } | null;
  source: string;
  comparison: string;
  threshold: string;
  upperThreshold: string | null;
}

/** `formats_met` (crates/shared-types/src/color_rules.rs): the formats a rule range can meet. */
function formatsMet(
  range: { start: number; end: number } | null,
  overrides: readonly FormatOverrideLike[],
): string[] {
  const lo = range ? range.start : 0;
  const hi = range ? range.end : 65535;
  const hits = overrides
    .filter((o) => o.start <= hi && o.end >= lo)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let next = lo;
  let uncovered = false;
  for (const o of hits) {
    if (o.start > next) uncovered = true;
    next = Math.max(next, o.end + 1);
  }
  if (next <= hi) uncovered = true;
  const formats: string[] = uncovered ? ["unsigned"] : [];
  for (const o of hits) if (!formats.includes(o.format)) formats.push(o.format);
  return formats;
}

const WHOLE_NUMBER = /^[+-]?[0-9]+$/;
export const INTEGER_THRESHOLD_SYNTAX =
  "Enter a whole decimal number for a 64-bit integer comparison.";

/**
 * The part of `check_color_rules` that depends on the formats (BE-009): a rule that can meet a
 * Signed or Unsigned 64-bit format with a source other than Scaled needs whole-number thresholds.
 * Returns the field path of the first rule that fails, or null. The fake does not repeat the other
 * rule checks: the frontend validates those before it sends.
 */
export function firstIntegerThresholdProblem(
  rules: readonly RuleLike[],
  overrides: readonly FormatOverrideLike[],
): { index: number; field: string; message: string } | null {
  for (const [index, rule] of rules.entries()) {
    if (rule.comparison === "always") continue;
    const integer = formatsMet(rule.range, overrides).some(
      (f) => (f === "signed64" || f === "unsigned64") && rule.source !== "scaled",
    );
    if (!integer) continue;
    if (!WHOLE_NUMBER.test(rule.threshold.trim())) {
      return { index, field: `colorRules[${index}].threshold`, message: INTEGER_THRESHOLD_SYNTAX };
    }
    if (
      rule.comparison === "between" &&
      rule.upperThreshold !== null &&
      !WHOLE_NUMBER.test(rule.upperThreshold.trim())
    ) {
      return {
        index,
        field: `colorRules[${index}].upperThreshold`,
        message: INTEGER_THRESHOLD_SYNTAX,
      };
    }
  }
  return null;
}
