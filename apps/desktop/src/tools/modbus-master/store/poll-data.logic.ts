import type {
  PollDefinition,
  PollUpdateEvent,
  ReadFunction,
  SessionState,
} from "@/shared/ipc/modbus-master.types";
import { isBitFunction } from "../lib/functions";
import { isPollRunning } from "./session.logic";

export type PollDataStatus = "none" | "loading" | "live" | "stale";
export type PollKind = "bits" | "registers";

export function kindOf(fn: ReadFunction): PollKind {
  return isBitFunction(fn) ? "bits" : "registers";
}

/** True when an update belongs to the definition the values were requested with. */
export function matchesDefinition(def: PollDefinition, u: PollUpdateEvent): boolean {
  return (
    u.slaveId === def.slaveId &&
    u.function === def.function &&
    u.startAddress === def.startAddress &&
    u.values.length === def.quantity
  );
}

export type PollDataAction = "begin" | "markStale" | "clear" | "none";

/**
 * What the poll data store does when the session moves from `prev` to `next` (FE-001 task 11).
 * `restarted` is true when the transition answers a start / resume / apply command.
 */
export function pollDataActionFor(
  prev: SessionState,
  next: SessionState,
  restarted: boolean,
): PollDataAction {
  if (next === "idle" || next === "connecting") return "clear";
  if (next === "paused" || next === "disconnected") return "markStale";
  if (isPollRunning(next)) {
    if (!isPollRunning(prev) || restarted) return "begin";
    // A failed cycle keeps the last values on screen as stale. A good cycle goes live by itself
    // through the next update.
    return next === "polling" ? "none" : "markStale";
  }
  return "none";
}
