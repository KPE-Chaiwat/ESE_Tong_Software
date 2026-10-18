// Texts of a sidebar poll row (DES-002 2.2.3, 9). Pure.
import type { AddressBase, PollDefinition } from "@/shared/ipc/modbus-master.types";
import { toDisplayAddress } from "./address";
import { formatTime } from "./format";
import { padFunction } from "./functions";

/** "1 · FC03 · 0-9": slave, function and range in the display base. */
export function pollMeta(def: PollDefinition, base: AddressBase): string {
  const start = toDisplayAddress(def.startAddress, base);
  return `${def.slaveId} · FC${padFunction(def.function)} · ${start}-${start + def.quantity - 1}`;
}

/**
 * The row tooltip: "{name} · Slave {id} · FC{fc} · {start}-{end} ({qty}) · {scan} ms · Last update
 * {time or —} · Errors {n}".
 */
export function pollRowTooltip(input: {
  name: string;
  definition: PollDefinition;
  base: AddressBase;
  lastOkAt: number | null;
  errors: number;
}): string {
  const { definition: def } = input;
  const start = toDisplayAddress(def.startAddress, input.base);
  return [
    input.name,
    `Slave ${def.slaveId}`,
    `FC${padFunction(def.function)}`,
    `${start}-${start + def.quantity - 1} (${def.quantity})`,
    `${def.scanRateMs} ms`,
    `Last update ${input.lastOkAt === null ? "—" : formatTime(input.lastOkAt)}`,
    `Errors ${input.errors}`,
  ].join(" · ");
}

/** Accessible name of an option: "{name}, {full pill label}, {marker text or 'in workspace'}". */
export function pollRowLabel(name: string, pillLabel: string, markerText: string | null): string {
  return `${name}, ${pillLabel}, ${markerText ?? "in workspace"}`;
}

/**
 * Ctrl+C on a sidebar row (DES-002 3.2): `{name}\t{slave}\tFC{fc}\t{range}\t{scan} ms\t{state label}`.
 * The range is in the display base.
 */
export function pollRowCopyText(input: {
  name: string;
  definition: PollDefinition;
  base: AddressBase;
  pillLabel: string;
}): string {
  const { definition: def } = input;
  const start = toDisplayAddress(def.startAddress, input.base);
  return [
    input.name,
    String(def.slaveId),
    `FC${padFunction(def.function)}`,
    `${start}-${start + def.quantity - 1}`,
    `${def.scanRateMs} ms`,
    input.pillLabel,
  ].join("\t");
}
