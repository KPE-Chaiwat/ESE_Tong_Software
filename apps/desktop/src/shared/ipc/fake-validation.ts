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
