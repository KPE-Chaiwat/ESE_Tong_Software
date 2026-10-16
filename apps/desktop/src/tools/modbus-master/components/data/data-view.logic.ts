// What the data card shows for a session state and the poll data (DES-001 2.3 and 2.4). Pure.
import type {
  AddressBase,
  ConnectionConfig,
  PollDefinition,
  SessionState,
} from "@/shared/ipc/modbus-master.types";
import { toDisplayAddress } from "../../lib/address";
import { exceptionName, formatExceptionCode } from "../../lib/exceptions";
import { formatIsoWithOffset, formatTime } from "../../lib/format";
import { padFunction, READ_FUNCTION_NAMES, READ_ITEM_NAMES } from "../../lib/functions";
import type { PollDataStatus } from "../../store/poll-data.logic";
import type { ClearReason } from "../../store/poll-data.store";
import { connectionTarget, isPollRunning } from "../../store/session.logic";

export type ChipKind = "live" | "loading" | "stale";

export interface DataViewInput {
  state: SessionState;
  exceptionCode: number | null;
  status: PollDataStatus;
  hasValues: boolean;
  lastOkAt: number | null;
  clearedBecause: ClearReason | null;
  /** The definition the values belong to. */
  definition: PollDefinition | null;
  /** The poll settings in the setup form. */
  poll: PollDefinition;
  connection: ConnectionConfig;
  addressBase: AddressBase;
  /** The poll form is invalid right now. */
  pollInvalid: boolean;
}

export type EmptyIcon = "plug" | "loader" | "link" | "octagon-x" | "unplug" | "circle-x" | "pause";

export interface DataViewModel {
  /** Rows to draw (addresses and values), or 0 when the empty text is shown instead. */
  rowCount: number;
  emptyText: { icon: EmptyIcon; text: string } | null;
  chip: { kind: ChipKind; text: string; title?: string } | null;
  /** Values are drawn in the muted color. */
  stale: boolean;
  /** Rows exist but have no values yet: draw the dash. */
  loading: boolean;
  header: string;
}

export function pollSummary(def: PollDefinition, base: AddressBase): string {
  const start = toDisplayAddress(def.startAddress, base);
  const end = start + def.quantity - 1;
  return `Slave ${def.slaveId} · FC${padFunction(def.function)} ${READ_FUNCTION_NAMES[def.function]} · ${start}-${end} (${def.quantity})`;
}

const STALE_PREFIX: Partial<Record<SessionState, string>> = {
  paused: "Paused",
  timeout: "No response",
  exception: "Exception",
  badResponse: "Bad response",
  disconnected: "Disconnected",
};

function chipFor(input: DataViewInput): DataViewModel["chip"] {
  const { status, state, lastOkAt } = input;
  if (status === "live" && lastOkAt !== null) {
    return {
      kind: "live",
      text: `Updated ${formatTime(lastOkAt)}`,
      title: formatIsoWithOffset(lastOkAt),
    };
  }
  if (status === "stale" && lastOkAt !== null) {
    const prefix = STALE_PREFIX[state];
    const time = formatTime(lastOkAt);
    return {
      kind: "stale",
      text: prefix ? `${prefix} - values from ${time}` : `Values from ${time}`,
      title: formatIsoWithOffset(lastOkAt),
    };
  }
  if (status === "loading") {
    return state === "paused"
      ? { kind: "stale", text: "Paused" }
      : { kind: "loading", text: "Waiting for first response…" };
  }
  return null;
}

function emptyFor(input: DataViewInput): DataViewModel["emptyText"] {
  const { state, poll, connection } = input;
  switch (state) {
    case "idle":
      return {
        icon: "plug",
        text: "Not connected. Configure a connection and press Connect (Ctrl+L).",
      };
    case "connecting":
      return { icon: "loader", text: `Connecting to ${connectionTarget(connection)}…` };
    case "connected":
      return input.pollInvalid
        ? { icon: "circle-x", text: "Fix the poll settings to start polling." }
        : {
            icon: "link",
            text: `Connected. Press Start polling (Ctrl+P) to read ${poll.quantity} ${READ_ITEM_NAMES[poll.function]} from slave ${poll.slaveId}.`,
          };
    case "paused":
      return {
        icon: "pause",
        text: "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.",
      };
    case "exception": {
      const code = input.exceptionCode ?? 0;
      return {
        icon: "octagon-x",
        text: `No data: the device answered with exception ${formatExceptionCode(code)} (${exceptionName(code)}).`,
      };
    }
    case "disconnected":
      return { icon: "unplug", text: "Connection lost. Press Reconnect to continue." };
    case "polling":
    case "timeout":
    case "badResponse":
      return null;
  }
}

export function deriveDataView(input: DataViewInput): DataViewModel {
  const { definition, poll, state, status, hasValues } = input;
  // The definition the values belong to, else what the user would poll next.
  const shown = definition ?? poll;
  const header = pollSummary(shown, input.addressBase);

  const noData = !hasValues && status !== "loading" && status !== "live";
  // These two states explain themselves in words when no value ever arrived.
  const exceptionBeforeData = (state === "exception" || state === "disconnected") && !hasValues;
  const settingsChanged = state === "paused" && input.clearedBecause === "settingsChanged";

  let showEmpty = false;
  if (exceptionBeforeData) showEmpty = true;
  else if (status === "none" || noData) {
    // Nothing on screen yet. Running polls show loading rows instead of an empty text.
    showEmpty = !isPollRunning(state);
    if (state === "paused" && !settingsChanged) showEmpty = false;
  }

  if (showEmpty) {
    return {
      rowCount: 0,
      emptyText: emptyFor(input),
      chip: null,
      stale: false,
      loading: false,
      header,
    };
  }

  const rows = definition?.quantity ?? poll.quantity;
  const chip =
    chipFor(input) ??
    (status === "none"
      ? state === "paused"
        ? { kind: "stale" as const, text: "Paused" }
        : { kind: "loading" as const, text: "Waiting for first response…" }
      : null);
  return {
    rowCount: rows,
    emptyText: null,
    chip,
    stale: status === "stale",
    loading: !hasValues,
    header,
  };
}
