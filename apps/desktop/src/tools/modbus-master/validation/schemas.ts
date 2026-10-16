import { z } from "zod";
import type {
  AddressBase,
  ConnectionConfig,
  ConnectionMode,
  Parity,
  PollDefinition,
  ReadFunction,
  ValueFormat,
  WriteFunction,
  WriteRequest,
} from "@/shared/ipc/modbus-master.types";
import {
  displayAddressRange,
  MAX_PROTOCOL_ADDRESS,
  maxQuantityFrom,
  toDisplayAddress,
  toProtocolAddress,
} from "../lib/address";
import { padFunction, QUANTITY_LIMITS } from "../lib/functions";
import { parseValue, splitValues } from "../lib/parse";

// ---------------------------------------------------------------------------------------------
// Form value types. Inputs are strings because that is what the user types; the schemas turn
// them into the typed IPC values. Messages are copied exactly from DES-001 sections 3.1 to 3.4.
// ---------------------------------------------------------------------------------------------

export interface ConnectionFormValues {
  mode: ConnectionMode;
  host: string;
  port: string;
  serialPort: string;
  baud: string;
  dataBits: string;
  /** A string, so a hand-edited profile with an unknown parity still reaches the form. */
  parity: string;
  stopBits: string;
  timeoutMs: string;
}

export interface PollFormValues {
  slaveId: string;
  function: string;
  /** Shown address, in the display base. */
  startAddress: string;
  quantity: string;
  scanRateMs: string;
}

export interface WriteFormValues {
  function: string;
  slaveId: string;
  /** Shown address, in the display base. */
  address: string;
  valueFormat: ValueFormat;
  coil: boolean;
  valueText: string;
  valuesText: string;
}

export type FieldErrors = Record<string, string>;
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/** Trimmed whole decimal number, or null when the text is not one. */
export function wholeNumber(text: string): number | null {
  const t = text.trim();
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

function inRange(n: number | null, min: number, max: number): n is number {
  return n !== null && n >= min && n <= max;
}

type Ctx = z.RefinementCtx;

function addError(ctx: Ctx, path: string, message: string): void {
  ctx.addIssue({ code: "custom", message, path: [path] });
}

/** Runs a schema and returns the first message per field. */
export function validate<S extends z.ZodType>(
  schema: S,
  values: unknown,
): ValidationResult<z.output<S>> {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in errors)) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------------------------
// 3.1 Connection
// ---------------------------------------------------------------------------------------------

export const HOST_REQUIRED = "Enter a host name or IPv4 address.";
export const HOST_INVALID = "Enter a valid host name or IPv4 address, for example 192.168.1.10.";
export const PORT_INVALID = "Port must be a whole number from 1 to 65535.";
export const TIMEOUT_INVALID = "Timeout must be a whole number from 50 to 10000 ms.";
export const SERIAL_PORT_REQUIRED = "Select a serial port.";
// RTU ranges (DES-001 3.1). They only show when a loaded profile holds a value outside the lists.
export const BAUD_INVALID = "Choose a baud rate from the list.";
export const DATA_BITS_INVALID = "Data bits must be 7 or 8.";
export const PARITY_INVALID = "Choose a parity from the list.";
export const STOP_BITS_INVALID = "Stop bits must be 1 or 2.";

export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;
export const DATA_BITS = [7, 8] as const;
export const PARITIES: readonly Parity[] = ["none", "even", "odd"];
export const STOP_BITS = [1, 2] as const;

/** True for a valid IPv4 dotted quad or host name (DES-001 3.1). IPv6 is out of scope. */
export function isValidHost(host: string): boolean {
  if (host.length > 253) return false;
  // Digits and dots only must be a whole IPv4 address (the backend rejects `192.168.1`).
  if (/^[\d.]+$/.test(host)) {
    return (
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.split(".").every((part) => Number(part) <= 255)
    );
  }
  return host
    .split(".")
    .every((label) => /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

function checkTimeout(ctx: Ctx, text: string): number | null {
  const n = wholeNumber(text);
  if (!inRange(n, 50, 10000)) {
    addError(ctx, "timeoutMs", TIMEOUT_INVALID);
    return null;
  }
  return n;
}

const tcpSchema = z
  .object({
    mode: z.literal("tcp"),
    host: z.string(),
    port: z.string(),
    timeoutMs: z.string(),
  })
  .superRefine((v, ctx) => {
    const host = v.host.trim();
    if (host === "") addError(ctx, "host", HOST_REQUIRED);
    else if (!isValidHost(host)) addError(ctx, "host", HOST_INVALID);
    if (!inRange(wholeNumber(v.port), 1, 65535)) addError(ctx, "port", PORT_INVALID);
    checkTimeout(ctx, v.timeoutMs);
  });

const rtuSchema = z
  .object({
    mode: z.literal("rtu"),
    serialPort: z.string(),
    baud: z.string(),
    dataBits: z.string(),
    parity: z.string(),
    stopBits: z.string(),
    timeoutMs: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.serialPort.trim() === "") addError(ctx, "serialPort", SERIAL_PORT_REQUIRED);
    if (!(BAUD_RATES as readonly number[]).includes(Number(v.baud))) {
      addError(ctx, "baud", BAUD_INVALID);
    }
    if (!(DATA_BITS as readonly number[]).includes(Number(v.dataBits))) {
      addError(ctx, "dataBits", DATA_BITS_INVALID);
    }
    if (!(STOP_BITS as readonly number[]).includes(Number(v.stopBits))) {
      addError(ctx, "stopBits", STOP_BITS_INVALID);
    }
    if (!(PARITIES as readonly string[]).includes(v.parity)) {
      addError(ctx, "parity", PARITY_INVALID);
    }
    checkTimeout(ctx, v.timeoutMs);
  });

/** TCP/RTU discriminated union. Output is the IPC `ConnectionConfig`. */
export const connectionSchema = z.discriminatedUnion("mode", [tcpSchema, rtuSchema]).transform(
  (v): ConnectionConfig =>
    v.mode === "tcp"
      ? {
          mode: "tcp",
          host: v.host.trim(),
          port: Number(v.port.trim()),
          timeoutMs: Number(v.timeoutMs.trim()),
        }
      : {
          mode: "rtu",
          port: v.serialPort.trim(),
          baud: Number(v.baud),
          dataBits: Number(v.dataBits) as 7 | 8,
          parity: v.parity as Parity,
          stopBits: Number(v.stopBits) as 1 | 2,
          timeoutMs: Number(v.timeoutMs.trim()),
        },
);

export const DATA_BITS_WARNING = "Modbus RTU uses 8 data bits. 7 may not work with most devices.";
export const STOP_BITS_WARNING = "The Modbus specification uses 2 stop bits when parity is None.";
export const BROADCAST_WARNING =
  "Broadcast: devices do not reply, so the result cannot be confirmed.";

export interface ConnectionWarnings {
  dataBits?: string;
  stopBits?: string;
}

/** Warnings are not errors and never block Connect (DES-001 section 1). */
export function connectionWarnings(
  v: Pick<ConnectionFormValues, "mode" | "dataBits" | "parity" | "stopBits">,
): ConnectionWarnings {
  if (v.mode !== "rtu") return {};
  const out: ConnectionWarnings = {};
  if (Number(v.dataBits) === 7) out.dataBits = DATA_BITS_WARNING;
  if (v.parity === "none" && Number(v.stopBits) === 1) out.stopBits = STOP_BITS_WARNING;
  return out;
}

// ---------------------------------------------------------------------------------------------
// 3.2 Poll
// ---------------------------------------------------------------------------------------------

export const SLAVE_ID_INVALID = "Slave ID must be a whole number from 0 to 247.";
export const SLAVE_ID_RTU_READ =
  "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247.";
export const SCAN_RATE_INVALID = "Scan rate must be a whole number from 20 to 60000 ms.";

export function startAddressMessage(base: AddressBase): string {
  const { min, max } = displayAddressRange(base);
  return `Start address must be a whole number from ${min} to ${max}.`;
}

/** Validates a start address typed in the display base. Returns the protocol address. */
function checkStart(ctx: Ctx, path: string, text: string, base: AddressBase): number | null {
  const { min, max } = displayAddressRange(base);
  const n = wholeNumber(text);
  if (!inRange(n, min, max)) {
    addError(ctx, path, startAddressMessage(base));
    return null;
  }
  return toProtocolAddress(n, base);
}

export function pollSchema(mode: ConnectionMode, base: AddressBase) {
  return z
    .object({
      slaveId: z.string(),
      function: z.string(),
      startAddress: z.string(),
      quantity: z.string(),
      scanRateMs: z.string(),
    })
    .superRefine((v, ctx) => {
      const slave = wholeNumber(v.slaveId);
      if (!inRange(slave, 0, 247)) addError(ctx, "slaveId", SLAVE_ID_INVALID);
      else if (mode === "rtu" && slave === 0) addError(ctx, "slaveId", SLAVE_ID_RTU_READ);

      const fc = Number(v.function);
      const fcOk = fc === 1 || fc === 2 || fc === 3 || fc === 4;
      if (!fcOk) addError(ctx, "function", "Select a function.");

      const protocolStart = checkStart(ctx, "startAddress", v.startAddress, base);

      const qty = wholeNumber(v.quantity);
      if (fcOk) {
        const max = QUANTITY_LIMITS[fc as ReadFunction];
        if (!inRange(qty, 1, max)) {
          addError(ctx, "quantity", `Quantity for FC${padFunction(fc)} must be from 1 to ${max}.`);
        } else if (protocolStart !== null && protocolStart + qty - 1 > MAX_PROTOCOL_ADDRESS) {
          addError(
            ctx,
            "quantity",
            `This range ends after the last address (${MAX_PROTOCOL_ADDRESS + base}). The maximum quantity from ${toDisplayAddress(protocolStart, base)} is ${maxQuantityFrom(protocolStart)}.`,
          );
        }
      }

      if (!inRange(wholeNumber(v.scanRateMs), 20, 60000)) {
        addError(ctx, "scanRateMs", SCAN_RATE_INVALID);
      }
    })
    .transform(
      (v): PollDefinition => ({
        slaveId: Number(v.slaveId.trim()),
        function: Number(v.function) as ReadFunction,
        startAddress: toProtocolAddress(Number(v.startAddress.trim()), base),
        quantity: Number(v.quantity.trim()),
        scanRateMs: Number(v.scanRateMs.trim()),
      }),
    );
}

// ---------------------------------------------------------------------------------------------
// 3.3 Write
// ---------------------------------------------------------------------------------------------

export function writeSchema(base: AddressBase) {
  return z
    .object({
      function: z.string(),
      slaveId: z.string(),
      address: z.string(),
      valueFormat: z.enum(["unsigned", "signed", "hex", "binary"]),
      coil: z.boolean(),
      valueText: z.string(),
      valuesText: z.string(),
    })
    .superRefine((v, ctx) => {
      if (!inRange(wholeNumber(v.slaveId), 0, 247)) addError(ctx, "slaveId", SLAVE_ID_INVALID);
      const fc = Number(v.function);
      const protocolStart = checkStart(ctx, "address", v.address, base);

      if (fc === 6) {
        const parsed = parseValue(v.valueText, v.valueFormat);
        if (!parsed.ok) addError(ctx, "valueText", parsed.message);
        return;
      }
      if (fc !== 15 && fc !== 16) return;

      const items = splitValues(v.valuesText);
      const max = QUANTITY_LIMITS[fc];
      if (items.length < 1 || items.length > max) {
        addError(ctx, "valuesText", `Enter from 1 to ${max} values (you entered ${items.length}).`);
        return;
      }
      for (const [i, text] of items.entries()) {
        const message =
          fc === 15
            ? text === "0" || text === "1"
              ? null
              : "enter 0 or 1."
            : (() => {
                const parsed = parseValue(text, v.valueFormat);
                return parsed.ok ? null : parsed.message;
              })();
        if (message !== null) {
          addError(ctx, "valuesText", `Value ${i + 1} ("${text}") is not valid: ${message}`);
          return;
        }
      }
      if (protocolStart !== null && protocolStart + items.length - 1 > MAX_PROTOCOL_ADDRESS) {
        addError(
          ctx,
          "valuesText",
          `These values end after the last address (${MAX_PROTOCOL_ADDRESS + base}). At most ${maxQuantityFrom(protocolStart)} values fit from ${toDisplayAddress(protocolStart, base)}.`,
        );
      }
    })
    .transform((v): WriteRequest => {
      const fc = Number(v.function) as WriteFunction;
      let values: number[];
      if (fc === 5) values = [v.coil ? 1 : 0];
      else if (fc === 6) values = [rawValue(v.valueText, v.valueFormat)];
      else if (fc === 15) values = splitValues(v.valuesText).map(Number);
      else values = splitValues(v.valuesText).map((t) => rawValue(t, v.valueFormat));
      return {
        slaveId: Number(v.slaveId.trim()),
        function: fc,
        address: toProtocolAddress(Number(v.address.trim()), base),
        values,
      };
    });
}

function rawValue(text: string, fmt: ValueFormat): number {
  const parsed = parseValue(text, fmt);
  return parsed.ok ? parsed.raw : 0;
}

export interface WriteWarnings {
  slaveId?: string;
}

/**
 * Slave ID 0 is a broadcast only in RTU mode: a warning, never an error (DES-001 3.3). On TCP, unit
 * 0 is a normal unit that answers, so there is no warning.
 */
export function writeWarnings(
  v: Pick<WriteFormValues, "slaveId">,
  mode: ConnectionMode,
): WriteWarnings {
  return mode === "rtu" && wholeNumber(v.slaveId) === 0 ? { slaveId: BROADCAST_WARNING } : {};
}

// ---------------------------------------------------------------------------------------------
// 3.4 Profile name
// ---------------------------------------------------------------------------------------------

export const PROFILE_NAME_REQUIRED = "Enter a profile name.";
export const PROFILE_NAME_TOO_LONG = "Profile name must be at most 64 characters.";
export const PROFILE_NAME_SPACE = "Profile name cannot start or end with a space.";
export const PROFILE_NAME_DOT_START = "Profile name cannot start with a dot.";
export const PROFILE_NAME_DOT_END = "Profile name cannot end with a dot.";
export const PROFILE_NAME_CHARS = 'Profile name cannot contain \\ / : * ? " < > |';
export const PROFILE_NAME_CONTROL = "Profile name cannot contain control characters.";

const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
  "com¹",
  "com²",
  "com³",
  "lpt¹",
  "lpt²",
  "lpt³",
]);

/** Windows device names, case-insensitive, for the whole name or the part before the first dot. */
export function isReservedName(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED.has(lower) || RESERVED.has(lower.split(".")[0] ?? "");
}

/** The first failing rule of DES-001 3.4, in the listed order, or null when the name is fine. */
export function profileNameError(name: string): string | null {
  if (name.trim() === "") return PROFILE_NAME_REQUIRED;
  if (name.length > 64) return PROFILE_NAME_TOO_LONG;
  if (/^\s|\s$/.test(name)) return PROFILE_NAME_SPACE;
  if (name.startsWith(".")) return PROFILE_NAME_DOT_START;
  if (name.endsWith(".")) return PROFILE_NAME_DOT_END;
  if (/[\\/:*?"<>|]/.test(name)) return PROFILE_NAME_CHARS;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rule rejects.
  if (/[\u0000-\u001f\u007f]/.test(name)) return PROFILE_NAME_CONTROL;
  if (isReservedName(name)) {
    return `"${name}" is reserved by Windows and cannot be used as a profile name.`;
  }
  return null;
}

/**
 * `existingNames` are the names a new name must not collide with (case-insensitive). Save as passes
 * none: the backend answers `profileExists` and the UI shows the Replace confirm. Rename passes the
 * other names. Names are never trimmed silently.
 */
export function profileNameSchema(existingNames: readonly string[] = []) {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  return z.string().superRefine((name, ctx) => {
    const message = profileNameError(name);
    if (message) addError(ctx, "name", message);
    else if (taken.has(name.toLowerCase())) {
      addError(ctx, "name", `A profile named "${name}" already exists.`);
    }
  });
}
