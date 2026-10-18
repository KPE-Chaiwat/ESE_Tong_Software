// Pure connection-state logic (DES-002 1.2, 1.3, 1.5): the transition table C1-C7, the pill, the
// banner and the reducer for backend events. No React, no IPC, no store.
import type {
  ConnectionConfig,
  ConnectionState,
  ConnectionStateChangedEvent,
  SessionReason,
} from "@/shared/ipc/modbus-master.types";
import type { IconName } from "@/shared/ui/icon";

export const CONNECTION_STATES: readonly ConnectionState[] = [
  "idle",
  "connecting",
  "connected",
  "disconnected",
];

/** Allowed transitions: exactly C1-C7 of DES-002 1.3. */
export const CONNECTION_ALLOWED: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  idle: ["connecting"],
  connecting: ["connected", "disconnected", "idle"],
  connected: ["idle", "disconnected"],
  disconnected: ["connecting", "idle"],
};

export function isAllowedConnection(from: ConnectionState, to: ConnectionState): boolean {
  return CONNECTION_ALLOWED[from].includes(to);
}

export type ConnectionPendingCommand = "connect" | "cancel" | "disconnect" | "dismiss";

/** Does a backend state event answer the pending command? */
export function answersPendingConnection(
  pending: ConnectionPendingCommand,
  prev: ConnectionState,
  next: ConnectionState,
): boolean {
  switch (pending) {
    case "connect":
      return next !== prev;
    case "cancel":
      return next === "idle" || next === "connected" || next === "disconnected";
    case "disconnect":
      return next === "idle" || next === "disconnected";
    case "dismiss":
      return next === "idle";
  }
}

export interface ConnectionActions {
  connect: boolean;
  cancel: boolean;
  disconnect: boolean;
  dismiss: boolean;
  /** Writes need a link. */
  write: boolean;
}

export function connectionActionsFor(s: ConnectionState): ConnectionActions {
  return {
    connect: s === "idle" || s === "disconnected",
    cancel: s === "connecting",
    disconnect: s === "connected",
    dismiss: s === "disconnected",
    write: s === "connected",
  };
}

// ---------------------------------------------------------------------------------------------
// Pill (DES-002 1.5 rule 1)
// ---------------------------------------------------------------------------------------------

export interface ConnectionPill {
  variant: ConnectionState;
  icon: IconName;
  label: string;
}

export function connectionPillFor(s: ConnectionState): ConnectionPill {
  switch (s) {
    case "idle":
      return { variant: s, icon: "plug", label: "Not connected" };
    case "connecting":
      return { variant: s, icon: "loader", label: "Connecting…" };
    case "connected":
      return { variant: s, icon: "link", label: "Connected" };
    case "disconnected":
      return { variant: s, icon: "unplug", label: "Disconnected" };
  }
}

/** `192.168.1.10:502` for TCP, the port name for RTU (banner texts). */
export function connectionTarget(c: ConnectionConfig): string {
  return c.mode === "tcp" ? `${c.host}:${c.port}` : c.port;
}

const PARITY_LETTER = { none: "N", even: "E", odd: "O" } as const;

/** The pill's `{target}`: `192.168.1.10:502` or `COM3 9600 8E1` (DES-002 1.5, mockup 6). */
export function connectionPillTarget(c: ConnectionConfig): string {
  return c.mode === "tcp"
    ? `${c.host}:${c.port}`
    : `${c.port} ${c.baud} ${c.dataBits}${PARITY_LETTER[c.parity]}${c.stopBits}`;
}

/** Sidebar summary line: `TCP 192.168.1.10:502 · timeout 1000 ms` (DES-002 2.2.2). */
export function connectionSummaryLine(c: ConnectionConfig): string {
  const head = c.mode === "tcp" ? `TCP ${c.host}:${c.port}` : `RTU ${connectionPillTarget(c)}`;
  return `${head} · timeout ${c.timeoutMs} ms`;
}

/** Status bar transport summary: `TCP 192.168.1.10:502` or `RTU COM3 9600 8E1`. */
export function transportSummary(c: ConnectionConfig): string {
  return c.mode === "tcp" ? `TCP ${c.host}:${c.port}` : `RTU ${connectionPillTarget(c)}`;
}

// ---------------------------------------------------------------------------------------------
// Banner (DES-001 2.3 and 3.4, DES-002 1.5 rule 4: connection states only)
// ---------------------------------------------------------------------------------------------

export function reasonText(reason: SessionReason | null, c: ConnectionConfig): string {
  const target = connectionTarget(c);
  switch (reason?.kind) {
    case "refused":
      return `Connection refused by ${target}.`;
    case "connectTimeout":
      return `No answer from ${target} within ${c.timeoutMs} ms.`;
    case "hostNotFound":
      return `Host "${c.mode === "tcp" ? c.host : c.port}" could not be resolved.`;
    case "portBusy":
      return `${target} is in use by another application or window.`;
    case "portNotFound":
      return `${target} is not available. Refresh the port list.`;
    case "closedByPeer":
      return `The device at ${target} closed the connection.`;
    case "portRemoved":
      return `${target} was removed.`;
    case "ioError":
      return `Connection error: ${reason.message}`;
    case undefined:
      return "Connection lost.";
  }
}

export type ConnectionBannerActionId = "cancel" | "reconnect" | "dismiss";

export interface ConnectionBanner {
  variant: "neutral" | "error";
  icon: IconName;
  text: string;
  actions: ConnectionBannerActionId[];
}

/** Banner under the toolbar: only connecting and disconnected have one. */
export function connectionBannerFor(
  state: ConnectionState,
  reason: SessionReason | null,
  config: ConnectionConfig,
): ConnectionBanner | null {
  switch (state) {
    case "connecting":
      return {
        variant: "neutral",
        icon: "loader",
        text: `Connecting to ${connectionTarget(config)}…`,
        actions: ["cancel"],
      };
    case "disconnected":
      return {
        variant: "error",
        icon: "unplug",
        text: reasonText(reason, config),
        actions: ["reconnect", "dismiss"],
      };
    case "idle":
    case "connected":
      return null;
  }
}

/** The sidebar CONNECTION section re-expands for these reasons (DES-002 2.2.2). */
export function reasonReopensSetup(reason: SessionReason | null): boolean {
  return (
    reason?.kind === "portBusy" || reason?.kind === "portNotFound" || reason?.kind === "refused"
  );
}

// ---------------------------------------------------------------------------------------------
// Reducer for backend events
// ---------------------------------------------------------------------------------------------

export interface ConnectionData {
  state: ConnectionState;
  reason: SessionReason | null;
  /** Backend timestamp (ms) of the last state change. */
  since: number;
  lastUnexpected: { from: ConnectionState; to: ConnectionState } | null;
}

export const initialConnectionData: ConnectionData = {
  state: "idle",
  reason: null,
  since: 0,
  lastUnexpected: null,
};

/**
 * True when the event repeats what is already shown. The W1 connection store receives every
 * `ConnectionStateChanged` twice (session channel and view channels), and a transition is
 * counted and announced once.
 */
export function isDuplicateConnectionEvent(
  data: ConnectionData,
  evt: Pick<ConnectionStateChangedEvent, "state" | "at">,
): boolean {
  return evt.state === data.state && evt.at === data.since;
}

/**
 * Applies a `ConnectionStateChanged` event. The backend is authoritative, so an unexpected pair is
 * applied anyway and recorded in `lastUnexpected` (DES-002 1.4).
 */
export function reduceConnectionStateChanged(
  prev: ConnectionData,
  evt: Pick<ConnectionStateChangedEvent, "state" | "reason" | "at">,
): ConnectionData {
  return {
    state: evt.state,
    reason: evt.state === "disconnected" ? evt.reason : null,
    since: evt.at,
    lastUnexpected: isAllowedConnection(prev.state, evt.state)
      ? prev.lastUnexpected
      : { from: prev.state, to: evt.state },
  };
}
