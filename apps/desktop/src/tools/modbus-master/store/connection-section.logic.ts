// The sidebar CONNECTION section (DES-002 2.2.2): when it is expanded. Pure.
import type { ConnectionState, SessionReason } from "@/shared/ipc/modbus-master.types";
import { reasonReopensSetup } from "./connection.logic";

/** Expanded while idle or disconnected, collapsed while connected or connecting. */
export function initialSectionExpanded(state: ConnectionState): boolean {
  return state === "idle" || state === "disconnected";
}

/**
 * The section after a connection transition: it collapses on entering `connected`, re-expands on
 * entering `disconnected` with a reason the user can fix (port busy or missing, refused), and keeps
 * the user's choice for every other transition.
 */
export function sectionAfterTransition(
  expanded: boolean,
  from: ConnectionState,
  to: ConnectionState,
  reason: SessionReason | null,
): boolean {
  if (from === to) return expanded;
  if (to === "connected") return false;
  if (to === "disconnected" && reasonReopensSetup(reason)) return true;
  return expanded;
}
