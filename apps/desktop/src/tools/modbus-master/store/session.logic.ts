// Pure session-state logic: the transition table, derived UI (pill, banner, enabled actions) and
// the reducer for backend events. No React, no IPC, no store.
import type {
  AddressBase,
  BadResponseDetail,
  BadResponseKind,
  ConnectionConfig,
  PollDefinition,
  SessionReason,
  SessionState,
  StateChangedEvent,
} from "@/shared/ipc/modbus-master.types";
import type { IconName } from "@/shared/ui/icon";
import { toDisplayAddress } from "../lib/address";
import { badResponseText, exceptionName, formatExceptionCode } from "../lib/exceptions";
import { padFunction } from "../lib/functions";

export const SESSION_STATES: readonly SessionState[] = [
  "idle",
  "connecting",
  "connected",
  "polling",
  "paused",
  "timeout",
  "exception",
  "badResponse",
  "disconnected",
];

/** P*: a poll is running. */
const POLL_RUNNING: readonly SessionState[] = ["polling", "timeout", "exception", "badResponse"];

/** Allowed transitions: exactly T1-T15 of DES-001 2.2. */
export const ALLOWED: Readonly<Record<SessionState, readonly SessionState[]>> = {
  idle: ["connecting"],
  connecting: ["connected", "disconnected", "idle"],
  connected: ["polling", "idle", "disconnected"],
  polling: ["polling", "timeout", "exception", "badResponse", "paused", "idle", "disconnected"],
  timeout: ["polling", "timeout", "exception", "badResponse", "paused", "idle", "disconnected"],
  exception: ["polling", "timeout", "exception", "badResponse", "paused", "idle", "disconnected"],
  badResponse: ["polling", "timeout", "exception", "badResponse", "paused", "idle", "disconnected"],
  paused: ["polling", "idle", "disconnected"],
  disconnected: ["connecting", "idle"],
};

export function isAllowed(from: SessionState, to: SessionState): boolean {
  return ALLOWED[from].includes(to);
}

export function isPollRunning(s: SessionState): boolean {
  return POLL_RUNNING.includes(s);
}

/** L*: the link is up. */
export function isLinkUp(s: SessionState): boolean {
  return s === "connected" || s === "paused" || isPollRunning(s);
}

export function isFailureState(s: SessionState): boolean {
  return s === "timeout" || s === "exception" || s === "badResponse";
}

// ---------------------------------------------------------------------------------------------
// Commands that are valid in a state. Used to guard the store and to enable buttons.
// ---------------------------------------------------------------------------------------------

export type PendingCommand =
  | "connect"
  | "cancel"
  | "disconnect"
  | "dismiss"
  | "startPoll"
  | "stopPoll";

/**
 * Does a backend state event answer the pending command? A repeated `timeout` event, for
 * example, does not answer an Apply that is still waiting for its restart (REV-002 m9).
 */
export function answersPending(
  pending: PendingCommand,
  prev: SessionState,
  next: SessionState,
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
    case "startPoll":
      return (
        next === "polling" ||
        next === "idle" ||
        next === "disconnected" ||
        (isFailureState(next) && !isPollRunning(prev))
      );
    case "stopPoll":
      return next === "paused" || next === "idle" || next === "disconnected";
  }
}

export interface SessionActions {
  connect: boolean;
  cancel: boolean;
  disconnect: boolean;
  /** Start, Resume and Apply while running. */
  startPoll: boolean;
  pause: boolean;
  write: boolean;
  dismiss: boolean;
}

export function actionsFor(s: SessionState): SessionActions {
  return {
    connect: s === "idle" || s === "disconnected",
    cancel: s === "connecting",
    disconnect: isLinkUp(s),
    startPoll: s === "connected" || s === "paused" || isPollRunning(s),
    pause: isPollRunning(s),
    write: isLinkUp(s),
    dismiss: s === "disconnected",
  };
}

// ---------------------------------------------------------------------------------------------
// Pill (DES-001 2.3)
// ---------------------------------------------------------------------------------------------

export interface Pill {
  variant: SessionState;
  /** lucide icon name, rendered as `data-icon`. */
  icon: IconName;
  label: string;
}

export function pillFor(s: SessionState, exceptionCode: number | null = null): Pill {
  switch (s) {
    case "idle":
      return { variant: s, icon: "plug", label: "Not connected" };
    case "connecting":
      return { variant: s, icon: "loader", label: "Connecting…" };
    case "connected":
      return { variant: s, icon: "link", label: "Connected" };
    case "polling":
      return { variant: s, icon: "activity", label: "Polling" };
    case "paused":
      return { variant: s, icon: "pause", label: "Paused" };
    case "timeout":
      return { variant: s, icon: "timer-off", label: "Timeout" };
    case "exception":
      return {
        variant: s,
        icon: "octagon-x",
        label:
          `Exception ${exceptionCode === null ? "" : formatExceptionCode(exceptionCode)}`.trim(),
      };
    case "badResponse":
      return { variant: s, icon: "triangle-alert", label: "Bad response" };
    case "disconnected":
      return { variant: s, icon: "unplug", label: "Disconnected" };
  }
}

// ---------------------------------------------------------------------------------------------
// Banner (DES-001 2.3 and 3.4)
// ---------------------------------------------------------------------------------------------

export type BannerVariant = "neutral" | "warning" | "error";
export type BannerActionId = "cancel" | "reconnect" | "dismiss";

export interface Banner {
  variant: BannerVariant;
  icon: IconName;
  text: string;
  actions: BannerActionId[];
}

/** Kind and detail of the last bad response. */
export interface BadResponseInfo {
  kind: BadResponseKind;
  detail: BadResponseDetail | null;
}

/** What `bannerFor` reads from the session store. */
export interface BannerSnapshot {
  state: SessionState;
  reason: SessionReason | null;
  exceptionCode: number | null;
  badResponse: BadResponseInfo | null;
  consecutiveFailures: number;
}

export interface BannerConfig {
  connection: ConnectionConfig;
  poll: PollDefinition;
  addressBase: AddressBase;
}

/** `192.168.1.10:502` for TCP, the port name for RTU. */
export function connectionTarget(c: ConnectionConfig): string {
  return c.mode === "tcp" ? `${c.host}:${c.port}` : c.port;
}

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

export function bannerFor(snap: BannerSnapshot, cfg: BannerConfig): Banner | null {
  const { poll } = cfg;
  const retry = `Retrying every ${poll.scanRateMs} ms (${snap.consecutiveFailures} in a row).`;
  switch (snap.state) {
    case "connecting":
      return {
        variant: "neutral",
        icon: "loader",
        text: `Connecting to ${connectionTarget(cfg.connection)}…`,
        actions: ["cancel"],
      };
    case "timeout":
      return {
        variant: "warning",
        icon: "timer-off",
        text: `Timeout: slave ${poll.slaveId} did not respond within ${cfg.connection.timeoutMs} ms. ${retry}`,
        actions: [],
      };
    case "exception": {
      const code = snap.exceptionCode ?? 0;
      const start = toDisplayAddress(poll.startAddress, cfg.addressBase);
      const end = start + poll.quantity - 1;
      return {
        variant: "error",
        icon: "octagon-x",
        text: `Exception ${formatExceptionCode(code)} (${exceptionName(code)}) from slave ${poll.slaveId} for FC${padFunction(poll.function)} at ${start}-${end}. ${retry}`,
        actions: [],
      };
    }
    case "badResponse":
      return {
        variant: "warning",
        icon: "triangle-alert",
        text: `Bad response from slave ${poll.slaveId}: ${snap.badResponse ? badResponseText(snap.badResponse.kind, snap.badResponse.detail) : "invalid frame"}. ${retry}`,
        actions: [],
      };
    case "disconnected":
      return {
        variant: "error",
        icon: "unplug",
        text: reasonText(snap.reason, cfg.connection),
        actions: ["reconnect", "dismiss"],
      };
    case "idle":
    case "connected":
    case "polling":
    case "paused":
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Reducer for backend snapshots (authoritative)
// ---------------------------------------------------------------------------------------------

export interface SessionData {
  state: SessionState;
  reason: SessionReason | null;
  exceptionCode: number | null;
  badResponse: BadResponseInfo | null;
  /** 0 outside timeout / exception / badResponse. */
  consecutiveFailures: number;
  /** Backend timestamp (ms) of the last state change. */
  since: number;
  lastUnexpected: { from: SessionState; to: SessionState } | null;
}

export const initialSessionData: SessionData = {
  state: "idle",
  reason: null,
  exceptionCode: null,
  badResponse: null,
  consecutiveFailures: 0,
  since: 0,
  lastUnexpected: null,
};

function sameBadKind(a: BadResponseInfo | null, b: BadResponseInfo | null): boolean {
  return a !== null && b !== null && a.kind === b.kind;
}

/**
 * Applies a `StateChanged` event. The backend is authoritative, so an unexpected pair is applied
 * anyway and recorded in `lastUnexpected` (DES-001 2.2).
 * The failure counter uses the backend value when it sent one, otherwise it counts here: +1 while
 * the same state (and the same exception code or bad-response kind) repeats, else 1.
 */
export function badResponseOf(evt: {
  badResponseKind: BadResponseKind | null;
  badResponseDetail: BadResponseDetail | null;
}): BadResponseInfo | null {
  return evt.badResponseKind ? { kind: evt.badResponseKind, detail: evt.badResponseDetail } : null;
}

export function reduceStateChanged(prev: SessionData, evt: StateChangedEvent): SessionData {
  const badResponse = badResponseOf(evt);
  let consecutiveFailures = 0;
  if (isFailureState(evt.state)) {
    const repeats =
      prev.state === evt.state &&
      (evt.state !== "exception" || prev.exceptionCode === evt.exceptionCode) &&
      (evt.state !== "badResponse" || sameBadKind(prev.badResponse, badResponse));
    consecutiveFailures =
      evt.consecutiveFailures > 0
        ? evt.consecutiveFailures
        : repeats
          ? prev.consecutiveFailures + 1
          : 1;
  }
  return {
    state: evt.state,
    reason: evt.state === "disconnected" ? evt.reason : null,
    exceptionCode: evt.state === "exception" ? evt.exceptionCode : null,
    badResponse: evt.state === "badResponse" ? badResponse : null,
    consecutiveFailures,
    since: evt.at,
    lastUnexpected: isAllowed(prev.state, evt.state)
      ? prev.lastUnexpected
      : { from: prev.state, to: evt.state },
  };
}
