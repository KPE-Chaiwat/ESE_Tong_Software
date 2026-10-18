// What a native poll window (W2) shows besides the shared PollView (DES-002 2.6): the banner and its
// precedence, the status bar text and the Pause or Resume button. Pure.
import type {
  ConnectionConfig,
  ConnectionState,
  PollState,
  SessionReason,
} from "@/shared/ipc/modbus-master.types";
import type { IconName } from "@/shared/ui/icon";
import type { BannerVariant } from "@/shared/ui/state-banner";
import { formatTime } from "../lib/format";
import { connectionTarget, reasonText } from "./connection.logic";
import {
  isPollRunning,
  type PollBannerConfig,
  type PollBannerInput,
  pollBannerFor,
} from "./poll.logic";

export const NATIVE_IDLE_TEXT = "Not connected. Connect from the connection window.";

export type NativeBannerAction = "reconnect" | "connectionWindow";

export interface NativeBanner {
  variant: BannerVariant;
  icon: IconName;
  text: string;
  actions: NativeBannerAction[];
}

export interface NativeBannerInput {
  connection: ConnectionState;
  reason: SessionReason | null;
  /** The connection settings Rust last had, null when it never connected. */
  config: ConnectionConfig | null;
  /** The poll's own state, for the poll banner while the link is up. */
  poll: PollBannerInput | null;
  pollConfig: PollBannerConfig | null;
}

/**
 * The one banner under the toolbar. The connection banner wins; the poll banner (DES-001 texts of a
 * failing poll) shows only while connected; never both. There is no Disconnect or Cancel: the link
 * belongs to the connection window.
 */
export function nativeBannerFor(input: NativeBannerInput): NativeBanner | null {
  switch (input.connection) {
    case "idle":
      return {
        variant: "neutral",
        icon: "plug",
        text: NATIVE_IDLE_TEXT,
        actions: ["connectionWindow"],
      };
    case "connecting":
      return {
        variant: "neutral",
        icon: "loader",
        text: input.config
          ? `Connecting to ${connectionTarget(input.config)}…`
          : "Connecting to the device…",
        actions: ["connectionWindow"],
      };
    case "disconnected":
      return {
        variant: "error",
        icon: "unplug",
        text: input.config ? reasonText(input.reason, input.config) : "Connection lost.",
        actions: input.config ? ["reconnect", "connectionWindow"] : ["connectionWindow"],
      };
    case "connected": {
      const banner =
        input.poll && input.pollConfig ? pollBannerFor(input.poll, input.pollConfig) : null;
      return banner
        ? { variant: banner.variant, icon: banner.icon, text: banner.text, actions: [] }
        : null;
    }
  }
}

/** The state of the pill label used in the window title: "Offline" while the link is not up. */
export function nativeTitleState(connection: ConnectionState, poll: PollState): PollState {
  return connection === "connected" ? poll : "offline";
}

/** The toolbar button next to the state pill: Pause while running, else Resume. */
export function pauseButtonLabel(state: PollState): "Pause" | "Resume" {
  return isPollRunning(state) ? "Pause" : "Resume";
}

export interface NativeStatusBarInput {
  lastOkAt: number | null;
  roundTripMs: number | null;
  responses: number;
  timeouts: number;
}

/**
 * "Last OK 14:02:11.510 · Round trip 8 ms · Resp 1198 · Timeouts 0". The counters of the status line
 * (`Tx`, `ID`, `F`, `SR`) are not repeated here. Before a valid reply: "No valid reply yet".
 */
export function nativeStatusBarText(s: NativeStatusBarInput): string {
  const head =
    s.lastOkAt === null
      ? "No valid reply yet"
      : [
          `Last OK ${formatTime(s.lastOkAt)}`,
          ...(s.roundTripMs === null ? [] : [`Round trip ${s.roundTripMs} ms`]),
        ].join(" · ");
  return `${head} · Resp ${s.responses} · Timeouts ${s.timeouts}`;
}
