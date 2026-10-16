import type { AddressBase } from "@/shared/ipc/modbus-master.types";

export const MAX_PROTOCOL_ADDRESS = 65535;

/** Protocol (0-based) address to the address shown to the user. */
export function toDisplayAddress(protocol: number, base: AddressBase): number {
  return protocol + base;
}

/** Address shown to the user to the protocol (0-based) address. */
export function toProtocolAddress(display: number, base: AddressBase): number {
  return display - base;
}

/** Valid display range of a start address for the given base: 0-65535 or 1-65536. */
export function displayAddressRange(base: AddressBase): { min: number; max: number } {
  return { min: base, max: MAX_PROTOCOL_ADDRESS + base };
}

/** Largest quantity that still ends at or before protocol address 65535. */
export function maxQuantityFrom(protocolStart: number): number {
  return MAX_PROTOCOL_ADDRESS - protocolStart + 1;
}
