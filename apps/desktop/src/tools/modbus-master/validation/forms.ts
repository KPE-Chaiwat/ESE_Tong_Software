import type {
  AddressBase,
  ConnectionConfig,
  PollDefinition,
} from "@/shared/ipc/modbus-master.types";
import { toDisplayAddress } from "../lib/address";
import type { ConnectionFormValues, PollFormValues } from "./schemas";

/** Form defaults for the fields of the mode that is not active (RTU 9600 8 Even 1). */
export const RTU_FORM_DEFAULTS = {
  serialPort: "",
  baud: "9600",
  dataBits: "8",
  parity: "even",
  stopBits: "1",
} as const;

export const TCP_FORM_DEFAULTS = { host: "", port: "502" } as const;

/** Turns a typed connection into form strings, keeping the other mode's values from `previous`. */
export function connectionToForm(
  c: ConnectionConfig,
  previous?: ConnectionFormValues,
): ConnectionFormValues {
  const base: ConnectionFormValues = {
    mode: c.mode,
    ...TCP_FORM_DEFAULTS,
    ...RTU_FORM_DEFAULTS,
    timeoutMs: String(c.timeoutMs),
  };
  if (previous) {
    base.host = previous.host;
    base.port = previous.port;
    base.serialPort = previous.serialPort;
    base.baud = previous.baud;
    base.dataBits = previous.dataBits;
    base.parity = previous.parity;
    base.stopBits = previous.stopBits;
  }
  if (c.mode === "tcp") {
    base.host = c.host;
    base.port = String(c.port);
  } else {
    base.serialPort = c.port;
    base.baud = String(c.baud);
    base.dataBits = String(c.dataBits);
    base.parity = c.parity;
    base.stopBits = String(c.stopBits);
  }
  return base;
}

/** The poll start address is shown in the display base. */
export function pollToForm(p: PollDefinition, base: AddressBase): PollFormValues {
  return {
    slaveId: String(p.slaveId),
    function: String(p.function),
    startAddress: String(toDisplayAddress(p.startAddress, base)),
    quantity: String(p.quantity),
    scanRateMs: String(p.scanRateMs),
  };
}
