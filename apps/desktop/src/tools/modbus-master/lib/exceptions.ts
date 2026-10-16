import type { BadResponseDetail, BadResponseKind } from "@/shared/ipc/modbus-master.types";

const EXCEPTION_NAMES: Readonly<Record<number, string>> = {
  1: "Illegal function",
  2: "Illegal data address",
  3: "Illegal data value",
  4: "Server device failure",
  5: "Acknowledge",
  6: "Server device busy",
  8: "Memory parity error",
  10: "Gateway path unavailable",
  11: "Gateway target device failed to respond",
};

/** Exception names from the public Modbus specification (DES-001 3.4). */
export function exceptionName(code: number): string {
  return EXCEPTION_NAMES[code] ?? "Unknown exception";
}

/** Two uppercase hex digits. */
export function formatExceptionCode(code: number): string {
  return code.toString(16).toUpperCase().padStart(2, "0");
}

/** `Exception 02 (Illegal data address)`. */
export function describeException(code: number): string {
  return `Exception ${formatExceptionCode(code)} (${exceptionName(code)})`;
}

const fc2 = (n: number) => String(n).padStart(2, "0");

/**
 * The `{kindText}` part of the bad response messages (DES-001 3.4), from `BadResponseKind` and
 * `BadResponseDetail`. Missing numbers fall back to the kind's leading words.
 */
export function badResponseText(
  kind: BadResponseKind,
  detail: BadResponseDetail | null = null,
): string {
  const got = detail?.got ?? null;
  const expected = detail?.expected ?? null;
  const both = got !== null && expected !== null;
  switch (kind) {
    case "crc":
      return "CRC mismatch";
    case "wrongSlave":
      return both ? `reply from slave ${got}, expected ${expected}` : "reply from unexpected slave";
    case "wrongFunction":
      return both
        ? `reply for FC${fc2(got)}, expected FC${fc2(expected)}`
        : "reply for unexpected function";
    case "transactionMismatch":
      return both
        ? `transaction ID mismatch (got ${got}, expected ${expected})`
        : "transaction ID mismatch";
    case "malformed":
      return detail?.message ? `malformed frame (${detail.message})` : "malformed frame";
    case "shortFrame":
      return both ? `short frame (${got} of ${expected} bytes)` : "short frame";
  }
}
