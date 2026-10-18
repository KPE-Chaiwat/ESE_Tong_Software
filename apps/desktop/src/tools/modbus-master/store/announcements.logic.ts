// What the connection window's live region says (DES-001 7, DES-002 1.5 rule 5). Pure.
import type {
  ConnectionConfig,
  ConnectionState,
  PollState,
  SessionReason,
} from "@/shared/ipc/modbus-master.types";
import { connectionBannerFor, connectionPillFor } from "./connection.logic";

/** "{pill label}. {banner text}" once per transition (the banner exists for connecting and disconnected). */
export function connectionAnnouncement(
  state: ConnectionState,
  reason: SessionReason | null,
  config: ConnectionConfig | null,
): string {
  const pill = connectionPillFor(state).label;
  const banner = config ? connectionBannerFor(state, reason, config) : null;
  return banner ? `${pill}. ${banner.text}` : pill;
}

export function isFailureState(state: PollState): boolean {
  return state === "timeout" || state === "exception" || state === "badResponse";
}

/** A poll moved into a failure state (a repeat of the same state is not a new failure). */
export function enteredFailure(prev: PollState | undefined, next: PollState): boolean {
  return prev !== undefined && prev !== next && isFailureState(next);
}

export const FAILURE_WINDOW_MS = 1000;
/** More than this many failures within the window are announced as one message. */
export const FAILURE_BURST = 3;

export interface FailureEntry {
  name: string;
  /** The full pill label, for example "Timeout" or "Exception 02". */
  label: string;
}

/** The text for the failures collected within one window (DES-002 1.5 rule 5). */
export function failureAnnouncement(entries: readonly FailureEntry[]): string | null {
  if (entries.length === 0) return null;
  if (entries.length > FAILURE_BURST) return `${entries.length} polls are failing.`;
  return entries.map((e) => `${e.name}: ${e.label}.`).join(" ");
}
