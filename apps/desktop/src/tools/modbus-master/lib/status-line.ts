// What the poll status line, the sidebar row and the host markers say (DES-002 2.2.3, 2.3.2, 2.5.1).
// Pure: the components only render these results.
import type {
  BadResponseDetail,
  BadResponseKind,
  ConnectionState,
  ExceptionCode,
  PollHostKind,
  PollState,
  WorkspaceRect,
} from "@/shared/ipc/modbus-master.types";
import type { IconName } from "@/shared/ui/icon";
import { pollPillFor } from "../store/poll.logic";
import { badResponseText, describeException, formatExceptionCode } from "./exceptions";
import { padFunction } from "./functions";

export interface StatusCounters {
  requests: number;
  errors: number;
  timeouts: number;
}

/**
 * `Tx {requests} · Err {errors + timeouts} · ID {slaveId} · F {fc as 2 digits} · SR {scanMs} ms`,
 * with ` (effective {n} ms)` after SR when the effective rate rule fires (DES-002 2.3.2).
 */
export function statusLineText(
  counters: StatusCounters,
  slaveId: number,
  fc: number,
  scanMs: number,
  effectiveScanMs: number | null = null,
): string {
  const p = statusLineParts(counters, slaveId, fc, scanMs, effectiveScanMs);
  return p.tx + p.err + p.ids + p.rate;
}

/**
 * The same text in four parts, so a narrow status line can hide the `Err`, `ID`/`F` ones (DES-002
 * 2.3.2: `Err` goes last, below L 465; `ID` and `F` go below L 606; `Tx` and `SR` never go).
 */
export function statusLineParts(
  counters: StatusCounters,
  slaveId: number,
  fc: number,
  scanMs: number,
  effectiveScanMs: number | null = null,
): { tx: string; err: string; ids: string; rate: string } {
  return {
    tx: `Tx ${counters.requests}`,
    err: ` · Err ${counters.errors + counters.timeouts}`,
    ids: ` · ID ${slaveId} · F ${padFunction(fc)}`,
    rate:
      effectiveScanMs === null
        ? ` · SR ${scanMs} ms`
        : ` · SR ${scanMs} ms (effective ${effectiveScanMs} ms)`,
  };
}

// ---------------------------------------------------------------------------------------------
// Narrow steps (DES-002 2.3.2 revision 9, D-002-16; widths from REPORT-004)
// ---------------------------------------------------------------------------------------------

/**
 * Status line width L (px) below which each step applies (strictly below is on). L is the poll
 * view width; the line gives these up in this order as it narrows, and `data-step` is the number
 * of steps that are on (0 to 5):
 *
 * | step | L below          | what changes                                                           |
 * |------|------------------|------------------------------------------------------------------------|
 * | 0    | -                | everything shows                                                       |
 * | 1    | 720 (810 long)   | the freshness chip INSIDE the status line shows its icon only; 810 for |
 * |      |                  | a long text (stale "... - values from ...", "Waiting for first         |
 * |      |                  | response..."), 720 for "Updated ..." or no chip. The data card header   |
 * |      |                  | chip (L >= 720) never changes: it is not given the step                |
 * | 2    | 620              | the reason text is hidden (the state chip's tooltip carries it)        |
 * | 3    | 606              | the `ID` and `F` segments of the counters are hidden                   |
 * | 4    | 500              | the Show control shows its icon only                                   |
 * | 5    | 465              | the `Err {n}` part of the counters is hidden                           |
 *
 * `Tx` and `SR` are never removed by a step; only the CSS safety (the end of the counters cut with
 * an ellipsis) can cut them. From step 3 on the counters' tooltip and accessible name carry the
 * complete text.
 */
export const STATUS_STEP_WIDTHS = {
  freshnessLive: 720,
  /** The chip of a long text: stale, timeout, offline-with-values or waiting. */
  freshnessLong: 810,
  reasonHidden: 620,
  idsHidden: 606,
  showIconOnly: 500,
  errHidden: 465,
} as const;

export type StatusLineStep = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * The text kind of the freshness chip inside the line: `live` is "Updated {time}", `long` is every
 * other text ("... - values from {time}", "Waiting for first response..."), `none` is no chip.
 */
export type FreshnessTextKind = "live" | "long" | "none";

/** The freshness text kind for a chip kind of the data view (`null`: no chip). */
export function freshnessTextKind(kind: "live" | "loading" | "stale" | null): FreshnessTextKind {
  if (kind === null) return "none";
  return kind === "live" ? "live" : "long";
}

/**
 * Which step the status line is at for width `lineWidthPx` (the PollView width). Fixed steps, not a
 * measured fit: the same width and chip text kind always show the same elements. The result is
 * cumulative: step n means steps 1 to n are on.
 */
export function statusLineStep(
  lineWidthPx: number,
  freshness: FreshnessTextKind = "none",
): StatusLineStep {
  const freshnessLimit =
    freshness === "long" ? STATUS_STEP_WIDTHS.freshnessLong : STATUS_STEP_WIDTHS.freshnessLive;
  const on = [
    lineWidthPx < freshnessLimit,
    lineWidthPx < STATUS_STEP_WIDTHS.reasonHidden,
    lineWidthPx < STATUS_STEP_WIDTHS.idsHidden,
    lineWidthPx < STATUS_STEP_WIDTHS.showIconOnly,
    lineWidthPx < STATUS_STEP_WIDTHS.errHidden,
  ];
  return on.filter(Boolean).length as StatusLineStep;
}

export interface CounterFields {
  counters: StatusCounters;
  slaveId: number;
  fc: number;
  scanMs: number;
  effectiveScanMs?: number | null;
}

/**
 * The counters text at `step`: `visible` drops `ID`/`F` from step 3 and `Err` at step 5; `full` is
 * always complete (the tooltip and accessible name).
 */
export function counterText(
  c: CounterFields,
  step: StatusLineStep,
): { visible: string; full: string } {
  const p = statusLineParts(c.counters, c.slaveId, c.fc, c.scanMs, c.effectiveScanMs ?? null);
  return {
    visible: p.tx + (step >= 5 ? "" : p.err) + (step >= 3 ? "" : p.ids) + p.rate,
    full: p.tx + p.err + p.ids + p.rate,
  };
}

export type ReasonTone = "none" | "warning" | "error" | "neutral";

export interface StatusReason {
  /** null: no reason text (the line shows only the chip and the counters). */
  text: string | null;
  /** Background of the status line: surface, `--color-warning`, error tint or neutral tint. */
  tone: ReasonTone;
}

export interface StatusReasonDetails {
  timeoutMs: number;
  exceptionCode: ExceptionCode | null;
  badResponse: { kind: BadResponseKind; detail: BadResponseDetail | null } | null;
}

/** The reason text and line tone of DES-002 2.3.2. */
export function statusLineReason(
  poll: PollState,
  connection: ConnectionState,
  details: StatusReasonDetails,
): StatusReason {
  switch (poll) {
    case "polling":
    case "paused":
      return { text: null, tone: "none" };
    case "timeout":
      return { text: `No response within ${details.timeoutMs} ms`, tone: "warning" };
    case "badResponse":
      return {
        text: `Bad response: ${details.badResponse ? badResponseText(details.badResponse.kind, details.badResponse.detail) : "invalid frame"}`,
        tone: "warning",
      };
    case "exception":
      return {
        text: describeException(details.exceptionCode ?? 0),
        tone: "error",
      };
    case "offline":
      switch (connection) {
        case "idle":
          return { text: "No connection", tone: "neutral" };
        case "connecting":
          return { text: "Connecting…", tone: "neutral" };
        case "disconnected":
          return { text: "No connection: link lost", tone: "error" };
        case "connected":
          return { text: null, tone: "none" };
      }
  }
}

// ---------------------------------------------------------------------------------------------
// Compact chip (sidebar rows, minimized bar, compact rail)
// ---------------------------------------------------------------------------------------------

export interface CompactChipDetails {
  consecutiveFailures: number;
  exceptionCode: ExceptionCode | null;
  /** The poll has received values (polling without data is "Waiting"). */
  hasData: boolean;
}

export interface CompactChip {
  icon: IconName;
  /** "Live", "Paused", "Timeout 3", "Exc 02", "Bad response", "Offline", "Waiting". */
  label: string;
  /** The full pill label ("Exception 02"), the chip's accessible name. */
  fullLabel: string;
}

export function compactChip(state: PollState, details: CompactChipDetails): CompactChip {
  const pill = pollPillFor(state, details.exceptionCode, details.hasData);
  const fullLabel = pill.label;
  switch (state) {
    case "polling":
      return details.hasData
        ? { icon: "activity", label: "Live", fullLabel }
        : { icon: "loader", label: "Waiting", fullLabel };
    case "paused":
      return { icon: "pause", label: "Paused", fullLabel };
    case "timeout":
      return {
        icon: "timer-off",
        label: `Timeout ${details.consecutiveFailures}`.trim(),
        fullLabel,
      };
    case "exception":
      return {
        icon: "octagon-x",
        label:
          `Exc ${details.exceptionCode === null ? "" : formatExceptionCode(details.exceptionCode)}`.trim(),
        fullLabel,
      };
    case "badResponse":
      return { icon: "triangle-alert", label: "Bad response", fullLabel };
    case "offline":
      return { icon: "wifi-off", label: "Offline", fullLabel };
  }
}

export function compactChipLabel(state: PollState, details: CompactChipDetails): string {
  return compactChip(state, details).label;
}

// ---------------------------------------------------------------------------------------------
// Host state and markers (DES-002 2.2.3, 2.5.1)
// ---------------------------------------------------------------------------------------------

export type PollHostState =
  | "workspace.normal"
  | "workspace.minimized"
  | "workspace.maximized"
  | "native"
  | "closed";

/** The host state of a poll from the fields Rust stores. */
export function hostStateOf(poll: {
  host: PollHostKind;
  open: boolean;
  workspace: Pick<WorkspaceRect, "state"> | null;
}): PollHostState {
  if (!poll.open) return "closed";
  if (poll.host === "native") return "native";
  switch (poll.workspace?.state) {
    case "minimized":
      return "workspace.minimized";
    case "maximized":
      return "workspace.maximized";
    default:
      return "workspace.normal";
  }
}

export interface HostMarker {
  icon: IconName;
  text: string;
}

/** The marker after the name in a sidebar row; null for a normal workspace sub-window. */
export function hostMarker(host: PollHostState): HostMarker | null {
  switch (host) {
    case "workspace.minimized":
      return { icon: "minus", text: "minimized" };
    case "native":
      return { icon: "square-arrow-out-up-right", text: "own window" };
    case "closed":
      return { icon: "eye-off", text: "closed" };
    case "workspace.normal":
    case "workspace.maximized":
      return null;
  }
}
