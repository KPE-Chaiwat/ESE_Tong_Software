// What the data of one poll view does when the poll or the connection changes state (DES-001 2.4
// view states, DES-002 1.4). Pure.
import type {
  ConnectionState,
  PollDefinition,
  PollState,
  PollUpdate,
  ReadFunction,
} from "@/shared/ipc/modbus-master.types";
import { isBitFunction } from "../lib/functions";
import { isPollRunning } from "./poll.logic";

export type PollDataStatus = "none" | "loading" | "live" | "stale";
export type PollKind = "bits" | "registers";

export function kindOf(fn: ReadFunction): PollKind {
  return isBitFunction(fn) ? "bits" : "registers";
}

/** True when an update belongs to the definition the values were requested with. */
export function matchesDefinition(
  def: PollDefinition,
  u: Pick<PollUpdate, "slaveId" | "function" | "startAddress" | "values">,
): boolean {
  return (
    u.slaveId === def.slaveId &&
    u.function === def.function &&
    u.startAddress === def.startAddress &&
    u.values.length === def.quantity
  );
}

export function sameDefinition(a: PollDefinition, b: PollDefinition): boolean {
  return (
    a.slaveId === b.slaveId &&
    a.function === b.function &&
    a.startAddress === b.startAddress &&
    a.quantity === b.quantity &&
    a.scanRateMs === b.scanRateMs
  );
}

export type PollDataAction = "begin" | "markStale" | "none";

/**
 * What the data store does when the poll moves from `prev` to `next`:
 * - a poll that starts (from paused or offline into P*) begins: old values are dropped and the view
 *   is loading;
 * - a failed cycle, a pause and a lost link keep the values and show them as stale;
 * - a recovery needs no action: the next update makes the view live.
 */
export function pollDataActionFor(prev: PollState, next: PollState): PollDataAction {
  if (next === "paused" || next === "offline") return prev === next ? "none" : "markStale";
  if (isPollRunning(next)) {
    if (!isPollRunning(prev)) return next === "polling" ? "begin" : "markStale";
    return next === "polling" ? "none" : "markStale";
  }
  return "none";
}

/** Disconnect and Dismiss (the connection goes to idle) clear the values of every poll. */
export function connectionClearsData(prev: ConnectionState, next: ConnectionState): boolean {
  return next === "idle" && prev !== "idle";
}

export type DefinitionChangeAction = "begin" | "clear" | "none";

/**
 * The applied definition changed (PT6, PT6b). A running poll restarts and the view is loading
 * (the old values are dropped); a paused or offline poll only clears its values.
 */
export function definitionChangeAction(
  prev: PollDefinition,
  next: PollDefinition,
  state: PollState,
): DefinitionChangeAction {
  if (sameDefinition(prev, next)) return "none";
  return isPollRunning(state) ? "begin" : "clear";
}
