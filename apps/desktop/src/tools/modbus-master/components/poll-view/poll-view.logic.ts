// What the shared PollView shows (DES-002 2.3, DES-001 2.4). Pure: the components render these
// results and the tests table-drive them.
import type {
  AddressBase,
  ConnectionState,
  ExceptionCode,
  PollDefinition,
  PollHostKind,
  PollState,
  ValueColumns,
} from "@/shared/ipc/modbus-master.types";
import { toDisplayAddress } from "../../lib/address";
import { describeException } from "../../lib/exceptions";
import { formatIsoWithOffset, formatTime } from "../../lib/format";
import { padFunction, READ_ITEM_NAMES } from "../../lib/functions";
import { STATUS_STEP_WIDTHS } from "../../lib/status-line";
import { isPollRunning } from "../../store/poll.logic";
import type { PollDataStatus } from "../../store/poll-data.logic";
import type { ClearReason } from "../../store/poll-data.store";

// ---------------------------------------------------------------------------------------------
// Layout thresholds (DES-002 2.3.3, 2.3.4, 2.6)
// ---------------------------------------------------------------------------------------------

/** Below this width of the poll view the data header becomes the compact "Show" menu. */
export const WIDE_HEADER_MIN_WIDTH = 720;
/**
 * A sub-window whose FRAME is at least this wide shows the setup as a dock, a narrower one as a popover.
 * The caller passes the frame width (the measured body plus the frame borders).
 */
export const DOCK_MIN_WIDTH = 640;
/** A native window narrower than this shows its open setup as a popover instead of the panel. */
export const PANEL_MIN_WIDTH = 640;
export const DOCK_WIDTH = 300;
export const PANEL_WIDTH = 340;
export const POPOVER_WIDTH = 360;
export const RAIL_WIDTH = 30;
/** The width assumed before the first measurement. */
export const DEFAULT_VIEW_WIDTH = 900;

export type SetupPresentation = "closed" | "dock" | "popover" | "panel" | "rail";

/**
 * How the setup is presented in a host (DES-002 2.3.3, 2.6). `open` is the per-poll setup flag.
 * - Sub-window: closed while the setup is closed, then a dock (frame width >= 640) or a popover.
 * - Native window (PollView width): the rail while the setup is closed; once it is open, the panel
 *   at >= 640 and the popover below (REPORT-006 O1). The rail stays in all native cases.
 * Compact mode (`compact`) closes every setup; only a local override (`localOverride`) keeps one
 * open. The store already mirrors that in `open`, so the two flags only make the rule explicit
 * for a caller that passes the raw state.
 */
export function setupPresentationFor(
  host: PollHostKind,
  width: number,
  open: boolean,
  compact = false,
  localOverride = false,
): SetupPresentation {
  const effective = compact ? open && localOverride : open;
  if (host === "native") {
    if (!effective) return "rail";
    return width >= PANEL_MIN_WIDTH ? "panel" : "popover";
  }
  if (!effective) return "closed";
  return width >= DOCK_MIN_WIDTH ? "dock" : "popover";
}

export function isWideHeader(width: number): boolean {
  return width >= WIDE_HEADER_MIN_WIDTH;
}

/**
 * Every width at which something in the poll view changes with the view's width: the status line
 * steps (720, 810, 620, 606, 500, 465), the wide header (720) and the fallback presentation limits
 * (640). All of them compare the EXACT measured width, never a rounded one (REPORT-005 F1).
 */
export const VIEW_WIDTH_BREAKPOINTS: readonly number[] = Array.from(
  new Set<number>([
    ...Object.values(STATUS_STEP_WIDTHS),
    WIDE_HEADER_MIN_WIDTH,
    DOCK_MIN_WIDTH,
    PANEL_MIN_WIDTH,
  ]),
).sort((a, b) => a - b);

/**
 * The exact view width reduced to what the poll view can tell apart: the largest breakpoint that is
 * `<=` the width, or 0 below all of them. `x < t` and `x >= t` give the same answer for the result
 * as for the exact width at every breakpoint `t` (719.8 -> 640, 720 -> 720, 464.8 -> 0, 465 -> 465),
 * so the view re-renders only when a breakpoint is crossed, not on every sub-pixel of a resize drag.
 */
export function snapViewWidth(width: number): number {
  let snapped = 0;
  for (const t of VIEW_WIDTH_BREAKPOINTS) {
    if (width >= t) snapped = t;
  }
  return snapped;
}

// ---------------------------------------------------------------------------------------------
// Header and labels
// ---------------------------------------------------------------------------------------------

/** "Slave 1 · FC03 · 0-9 (10) · 100 ms" (DES-002 2.3.4). */
export function pollHeaderText(def: PollDefinition, base: AddressBase): string {
  const start = toDisplayAddress(def.startAddress, base);
  const end = start + def.quantity - 1;
  return `Slave ${def.slaveId} · FC${padFunction(def.function)} · ${start}-${end} (${def.quantity}) · ${def.scanRateMs} ms`;
}

export const VALUE_COLUMN_LABELS: Record<ValueColumns, string> = {
  raw: "Raw",
  scaled: "Scaled",
  both: "Both",
};

/** The label of the compact menu button: "Show Both". */
export function showButtonLabel(columns: ValueColumns): string {
  return `Show ${VALUE_COLUMN_LABELS[columns]}`;
}

export const NO_SCALE_TITLE = "Set a scale to show scaled values.";
export const BITS_FORMAT_TOOLTIP = "Coils and discrete inputs are shown as 0 or 1.";

// ---------------------------------------------------------------------------------------------
// Data view (empty, loading, live, stale)
// ---------------------------------------------------------------------------------------------

export type ChipKind = "live" | "loading" | "stale";
export type EmptyIcon = "plug" | "loader" | "pause" | "octagon-x" | "unplug" | "circle-x";

export interface DataViewInput {
  host: PollHostKind;
  pollState: PollState;
  connectionState: ConnectionState;
  exceptionCode: ExceptionCode | null;
  status: PollDataStatus;
  hasValues: boolean;
  lastOkAt: number | null;
  clearedBecause: ClearReason | null;
  /** The poll as Rust has it. */
  definition: PollDefinition;
  addressBase: AddressBase;
  /** `192.168.1.10:502` or the port name, for the connecting text. */
  connectionTarget: string | null;
  /** The setup form has an invalid draft and the poll never ran. */
  draftInvalid: boolean;
}

export interface DataViewModel {
  /** The empty text and icon, or null when rows are drawn. */
  empty: { icon: EmptyIcon; text: string } | null;
  chip: { kind: ChipKind; text: string; title?: string } | null;
  /** Values are drawn muted. */
  stale: boolean;
  /** Rows exist but have no values yet: draw the dash. */
  loading: boolean;
}

const STALE_PREFIX: Partial<Record<PollState, string>> = {
  paused: "Paused",
  timeout: "No response",
  exception: "Exception",
  badResponse: "Bad response",
  offline: "Offline",
};

export function notConnectedText(host: PollHostKind): string {
  return host === "native"
    ? "Not connected. Connect from the connection window (Ctrl+Shift+M)."
    : "Not connected. Connect from the toolbar (Ctrl+L).";
}

function emptyFor(input: DataViewInput): DataViewModel["empty"] {
  const { pollState, connectionState, definition } = input;
  switch (pollState) {
    case "offline":
      switch (connectionState) {
        case "idle":
          return { icon: "plug", text: notConnectedText(input.host) };
        case "connecting":
          return {
            icon: "loader",
            text: `Connecting to ${input.connectionTarget ?? "the device"}…`,
          };
        case "disconnected":
          return { icon: "unplug", text: "Connection lost. Press Reconnect to continue." };
        case "connected":
          return { icon: "loader", text: "Waiting for the connection…" };
      }
      break;
    case "paused":
      if (input.clearedBecause === "settingsChanged") {
        return {
          icon: "pause",
          text: "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.",
        };
      }
      if (input.draftInvalid) {
        return { icon: "circle-x", text: "Fix the poll settings to start polling." };
      }
      return {
        icon: "pause",
        text: `Poll paused. Press Resume (Ctrl+P) to read ${definition.quantity} ${READ_ITEM_NAMES[definition.function]} from slave ${definition.slaveId}.`,
      };
    case "exception": {
      const code = input.exceptionCode ?? 0;
      return {
        icon: "octagon-x",
        text: `No data: the device answered with ${describeException(code).replace("Exception ", "exception ")}.`,
      };
    }
    case "polling":
    case "timeout":
    case "badResponse":
      return null;
  }
  return null;
}

/**
 * The data card of a poll: the empty text, the freshness chip and whether rows are stale or
 * loading (DES-001 2.4 with the offline texts of DES-002 2.3.4).
 */
export function deriveDataView(input: DataViewInput): DataViewModel {
  const { pollState, status, hasValues } = input;

  // Without values, a poll that is not running (and a poll in exception) explains itself in words.
  // A running poll shows loading rows instead.
  const explains = !hasValues && (!isPollRunning(pollState) || pollState === "exception");
  if (explains) {
    const empty = emptyFor(input);
    if (empty) return { empty, chip: null, stale: false, loading: false };
  }

  if (hasValues && status === "live" && input.lastOkAt !== null) {
    return {
      empty: null,
      chip: {
        kind: "live",
        text: `Updated ${formatTime(input.lastOkAt)}`,
        title: formatIsoWithOffset(input.lastOkAt),
      },
      stale: false,
      loading: false,
    };
  }
  if (hasValues && input.lastOkAt !== null) {
    const prefix = STALE_PREFIX[pollState];
    const time = formatTime(input.lastOkAt);
    return {
      empty: null,
      chip: {
        kind: "stale",
        text: prefix ? `${prefix} - values from ${time}` : `Values from ${time}`,
        title: formatIsoWithOffset(input.lastOkAt),
      },
      stale: true,
      loading: false,
    };
  }
  return {
    empty: null,
    chip: { kind: "loading", text: "Waiting for first response…" },
    stale: false,
    loading: true,
  };
}
