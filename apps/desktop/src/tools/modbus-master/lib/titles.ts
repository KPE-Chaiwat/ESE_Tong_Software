// Window titles and accessible names (DES-002 2.12). Pure.
import type { ConnectionState } from "@/shared/ipc/modbus-master.types";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Disconnected",
};

/**
 * W1: `Modbus Master - {profile or "Untitled"}{" *" if modified} - {connection label}` plus
 * ` ({poll summary})` when connected and polls exist. Pass `summary` as null when there are no polls.
 */
export function connectionTitle(
  profileName: string | null,
  modified: boolean,
  state: ConnectionState,
  summary: string | null,
): string {
  const base = `Modbus Master - ${profileName ?? "Untitled"}${modified ? " *" : ""} - ${CONNECTION_LABEL[state]}`;
  return state === "connected" && summary ? `${base} (${summary})` : base;
}

/** W2: `{poll name} - {profile or "Untitled"} - {pill label}`; the pill reads "Offline" when not connected. */
export function nativePollTitle(
  pollName: string,
  profileName: string | null,
  pillLabel: string,
): string {
  return `${pollName} - ${profileName ?? "Untitled"} - ${pillLabel}`;
}

/** Accessible name of a sub-window frame. */
export function subWindowLabel(name: string, pillLabel: string): string {
  return `${name}, ${pillLabel}, sub-window`;
}
