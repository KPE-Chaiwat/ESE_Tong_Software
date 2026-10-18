// Pure per-poll state logic (DES-002 1.2, 1.4): the transition table PT0-PT8, the pill, the
// banner text and the reducer for backend events. No React, no IPC, no store.
import type {
  AddressBase,
  BadResponseDetail,
  BadResponseKind,
  ExceptionCode,
  PollDefinition,
  PollState,
  PollStateChangedEvent,
} from "@/shared/ipc/modbus-master.types";
import type { IconName } from "@/shared/ui/icon";
import { toDisplayAddress } from "../lib/address";
import { badResponseText, exceptionName, formatExceptionCode } from "../lib/exceptions";
import { padFunction } from "../lib/functions";

export const POLL_STATES: readonly PollState[] = [
  "offline",
  "paused",
  "polling",
  "timeout",
  "exception",
  "badResponse",
];

/** P*: the poll is running. */
const POLL_RUNNING: readonly PollState[] = ["polling", "timeout", "exception", "badResponse"];
const P_STAR: readonly PollState[] = [
  "polling",
  "timeout",
  "exception",
  "badResponse",
  "paused",
  "offline",
];

/** Allowed transitions: PT0-PT8 of DES-002 1.4 (what the backend can send between two events). */
export const POLL_ALLOWED: Readonly<Record<PollState, readonly PollState[]>> = {
  offline: ["paused", "polling"],
  paused: ["polling", "offline"],
  polling: P_STAR,
  timeout: P_STAR,
  exception: P_STAR,
  badResponse: P_STAR,
};

export function isAllowedPoll(from: PollState, to: PollState): boolean {
  return POLL_ALLOWED[from].includes(to);
}

export function isPollRunning(s: PollState): boolean {
  return POLL_RUNNING.includes(s);
}

export function isFailureState(s: PollState): boolean {
  return s === "timeout" || s === "exception" || s === "badResponse";
}

// ---------------------------------------------------------------------------------------------
// Pill (DES-001 2.3 labels, DES-002 2.3.2 chip)
// ---------------------------------------------------------------------------------------------

/** `waiting` is `polling` with no data yet (DES-002 2.3.2: "Waiting…"). */
export type PollPillVariant = PollState | "waiting";

export interface PollPill {
  variant: PollPillVariant;
  icon: IconName;
  label: string;
}

/**
 * The full pill of a poll: "Polling", "Waiting…" (polling, nothing received yet), "Paused",
 * "Timeout", "Exception {cc}", "Bad response" or "Offline".
 */
export function pollPillFor(
  state: PollState,
  exceptionCode: ExceptionCode | null = null,
  hasData = true,
): PollPill {
  switch (state) {
    case "offline":
      return { variant: state, icon: "wifi-off", label: "Offline" };
    case "paused":
      return { variant: state, icon: "pause", label: "Paused" };
    case "polling":
      return hasData
        ? { variant: state, icon: "activity", label: "Polling" }
        : { variant: "waiting", icon: "loader", label: "Waiting…" };
    case "timeout":
      return { variant: state, icon: "timer-off", label: "Timeout" };
    case "exception":
      return {
        variant: state,
        icon: "octagon-x",
        label:
          `Exception ${exceptionCode === null ? "" : formatExceptionCode(exceptionCode)}`.trim(),
      };
    case "badResponse":
      return { variant: state, icon: "triangle-alert", label: "Bad response" };
  }
}

// ---------------------------------------------------------------------------------------------
// Banner / tooltip text (DES-001 2.3, applied to one poll)
// ---------------------------------------------------------------------------------------------

export interface BadResponseInfo {
  kind: BadResponseKind;
  detail: BadResponseDetail | null;
}

export interface PollBannerInput {
  state: PollState;
  exceptionCode: ExceptionCode | null;
  badResponse: BadResponseInfo | null;
  consecutiveFailures: number;
}

export interface PollBannerConfig {
  definition: PollDefinition;
  /** The connection's response timeout. */
  timeoutMs: number;
  addressBase: AddressBase;
}

export interface PollBanner {
  variant: "warning" | "error";
  icon: IconName;
  text: string;
}

/**
 * The full text of a failing poll, for the status line tooltip and the native window banner:
 * "Timeout: slave 5 did not respond within 1000 ms. Retrying every 100 ms (3 in a row)."
 */
export function pollBannerFor(input: PollBannerInput, cfg: PollBannerConfig): PollBanner | null {
  const { definition: def } = cfg;
  const retry = `Retrying every ${def.scanRateMs} ms (${input.consecutiveFailures} in a row).`;
  switch (input.state) {
    case "timeout":
      return {
        variant: "warning",
        icon: "timer-off",
        text: `Timeout: slave ${def.slaveId} did not respond within ${cfg.timeoutMs} ms. ${retry}`,
      };
    case "exception": {
      const code = input.exceptionCode ?? 0;
      const start = toDisplayAddress(def.startAddress, cfg.addressBase);
      const end = start + def.quantity - 1;
      return {
        variant: "error",
        icon: "octagon-x",
        text: `Exception ${formatExceptionCode(code)} (${exceptionName(code)}) from slave ${def.slaveId} for FC${padFunction(def.function)} at ${start}-${end}. ${retry}`,
      };
    }
    case "badResponse":
      return {
        variant: "warning",
        icon: "triangle-alert",
        text: `Bad response from slave ${def.slaveId}: ${input.badResponse ? badResponseText(input.badResponse.kind, input.badResponse.detail) : "invalid frame"}. ${retry}`,
      };
    case "offline":
    case "paused":
    case "polling":
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Reducer for backend events (authoritative)
// ---------------------------------------------------------------------------------------------

export interface PollRuntimeData {
  state: PollState;
  /** 0 outside timeout / exception / badResponse. */
  consecutiveFailures: number;
  exceptionCode: ExceptionCode | null;
  badResponse: BadResponseInfo | null;
  /** Backend timestamp (ms) of the last state change. */
  since: number;
  lastUnexpected: { from: PollState; to: PollState } | null;
}

export const initialPollRuntimeData: PollRuntimeData = {
  state: "offline",
  consecutiveFailures: 0,
  exceptionCode: null,
  badResponse: null,
  since: 0,
  lastUnexpected: null,
};

export function badResponseOf(evt: {
  badResponseKind: BadResponseKind | null;
  badResponseDetail: BadResponseDetail | null;
}): BadResponseInfo | null {
  return evt.badResponseKind ? { kind: evt.badResponseKind, detail: evt.badResponseDetail } : null;
}

function sameBadKind(a: BadResponseInfo | null, b: BadResponseInfo | null): boolean {
  return a !== null && b !== null && a.kind === b.kind;
}

/**
 * Applies a `PollStateChanged` event. An unexpected pair is applied anyway and recorded in
 * `lastUnexpected` (DES-002 1.4). The failure counter uses the backend value when it sent one,
 * otherwise it counts here: +1 while the same failure repeats, else 1.
 */
export function reducePollStateChanged(
  prev: PollRuntimeData,
  evt: Pick<
    PollStateChangedEvent,
    | "state"
    | "consecutiveFailures"
    | "exceptionCode"
    | "badResponseKind"
    | "badResponseDetail"
    | "at"
  >,
): PollRuntimeData {
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
    consecutiveFailures,
    exceptionCode: evt.state === "exception" ? evt.exceptionCode : null,
    badResponse: evt.state === "badResponse" ? badResponse : null,
    since: evt.at,
    lastUnexpected: isAllowedPoll(prev.state, evt.state)
      ? prev.lastUnexpected
      : { from: prev.state, to: evt.state },
  };
}

// ---------------------------------------------------------------------------------------------
// Effective scan rate (DES-002 2.3.2)
// ---------------------------------------------------------------------------------------------

/** The rate rule fires when the mean interval of the last 10 cycles is above 1.5 x the scan rate. */
export const EFFECTIVE_RATE_FACTOR = 1.5;

/**
 * Rust measures the mean interval of the last 10 cycles (`effectiveScanMs`). The status line shows
 * it only when the rule fires, so a value at or below 1.5 x the scan rate is not shown.
 */
export function effectiveScanShown(reported: number | null, scanMs: number): number | null {
  return reported !== null && reported > scanMs * EFFECTIVE_RATE_FACTOR
    ? Math.round(reported)
    : null;
}
