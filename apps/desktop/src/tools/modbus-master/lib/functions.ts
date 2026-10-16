import type { ReadFunction, WriteFunction } from "@/shared/ipc/modbus-master.types";

export const READ_FUNCTIONS: readonly ReadFunction[] = [1, 2, 3, 4];
export const WRITE_FUNCTIONS: readonly WriteFunction[] = [5, 6, 15, 16];

/** Maximum quantity per function (REQ-001 / DES-001 3.2 and 3.3). */
export const QUANTITY_LIMITS = {
  1: 2000,
  2: 2000,
  3: 125,
  4: 125,
  5: 1,
  6: 1,
  15: 1968,
  16: 123,
} as const satisfies Record<ReadFunction | WriteFunction, number>;

export const READ_FUNCTION_LABELS: Record<ReadFunction, string> = {
  1: "01 Read coils",
  2: "02 Read discrete inputs",
  3: "03 Read holding registers",
  4: "04 Read input registers",
};

export const WRITE_FUNCTION_LABELS: Record<WriteFunction, string> = {
  5: "05 Write single coil",
  6: "06 Write single register",
  15: "15 Write multiple coils",
  16: "16 Write multiple registers",
};

/** Sentence fragment for the poll summary: "Read holding registers". */
export const READ_FUNCTION_NAMES: Record<ReadFunction, string> = {
  1: "Read coils",
  2: "Read discrete inputs",
  3: "Read holding registers",
  4: "Read input registers",
};

export const READ_ITEM_NAMES: Record<ReadFunction, string> = {
  1: "coils",
  2: "discrete inputs",
  3: "holding registers",
  4: "input registers",
};

/** FC01 and FC02 return bits, FC03 and FC04 return 16-bit registers. */
export function isBitFunction(fc: ReadFunction): boolean {
  return fc === 1 || fc === 2;
}

/** FC01 and FC03 can be written, FC02 and FC04 are read-only. */
export function isWritableRead(fc: ReadFunction): boolean {
  return fc === 1 || fc === 3;
}

export function padFunction(fc: number): string {
  return String(fc).padStart(2, "0");
}
