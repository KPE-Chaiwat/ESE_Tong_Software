import type { ConnectionConfig, PollDefinition } from "@/shared/ipc/modbus-master.types";
import {
  NATIVE_IDLE_TEXT,
  nativeBannerFor,
  nativeStatusBarText,
  nativeTitleState,
  pauseButtonLabel,
} from "./native-poll.logic";

const TCP: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const DEF: PollDefinition = {
  slaveId: 5,
  function: 3,
  startAddress: 100,
  quantity: 25,
  scanRateMs: 100,
};
const POLL_CONFIG = { definition: DEF, timeoutMs: 1000, addressBase: 0 } as const;
const HEALTHY = {
  state: "polling",
  exceptionCode: null,
  badResponse: null,
  consecutiveFailures: 0,
} as const;

describe("nativeBannerFor (DES-002 2.6)", () => {
  it("idle: 'Not connected. Connect from the connection window.' with the Connection window action", () => {
    expect(
      nativeBannerFor({
        connection: "idle",
        reason: null,
        config: null,
        poll: HEALTHY,
        pollConfig: POLL_CONFIG,
      }),
    ).toEqual({
      variant: "neutral",
      icon: "plug",
      text: "Not connected. Connect from the connection window.",
      actions: ["connectionWindow"],
    });
    expect(NATIVE_IDLE_TEXT).toBe("Not connected. Connect from the connection window.");
  });

  it("connecting: names the target, no Cancel", () => {
    const banner = nativeBannerFor({
      connection: "connecting",
      reason: null,
      config: TCP,
      poll: HEALTHY,
      pollConfig: POLL_CONFIG,
    });
    expect(banner).toMatchObject({
      variant: "neutral",
      icon: "loader",
      text: "Connecting to 192.168.1.10:502…",
      actions: ["connectionWindow"],
    });
  });

  it("connecting with an unknown target", () => {
    expect(
      nativeBannerFor({
        connection: "connecting",
        reason: null,
        config: null,
        poll: null,
        pollConfig: null,
      })?.text,
    ).toBe("Connecting to the device…");
  });

  it("disconnected: the reason text with Reconnect and Connection window, never Disconnect or Dismiss", () => {
    const banner = nativeBannerFor({
      connection: "disconnected",
      reason: { kind: "refused", phase: "connectFailed", message: "refused" },
      config: TCP,
      poll: HEALTHY,
      pollConfig: POLL_CONFIG,
    });
    expect(banner).toEqual({
      variant: "error",
      icon: "unplug",
      text: "Connection refused by 192.168.1.10:502.",
      actions: ["reconnect", "connectionWindow"],
    });
  });

  it("disconnected without a known connection cannot reconnect from here", () => {
    const banner = nativeBannerFor({
      connection: "disconnected",
      reason: null,
      config: null,
      poll: null,
      pollConfig: null,
    });
    expect(banner).toMatchObject({ text: "Connection lost.", actions: ["connectionWindow"] });
  });

  it("the connection banner wins over a failing poll (never both)", () => {
    const banner = nativeBannerFor({
      connection: "disconnected",
      reason: null,
      config: TCP,
      poll: { state: "timeout", exceptionCode: null, badResponse: null, consecutiveFailures: 3 },
      pollConfig: POLL_CONFIG,
    });
    expect(banner?.text).toBe("Connection lost.");
  });

  it("connected: the DES-001 text of a failing poll, no actions", () => {
    const timeout = nativeBannerFor({
      connection: "connected",
      reason: null,
      config: TCP,
      poll: { state: "timeout", exceptionCode: null, badResponse: null, consecutiveFailures: 3 },
      pollConfig: POLL_CONFIG,
    });
    expect(timeout).toEqual({
      variant: "warning",
      icon: "timer-off",
      text: "Timeout: slave 5 did not respond within 1000 ms. Retrying every 100 ms (3 in a row).",
      actions: [],
    });
    const exception = nativeBannerFor({
      connection: "connected",
      reason: null,
      config: TCP,
      poll: { state: "exception", exceptionCode: 2, badResponse: null, consecutiveFailures: 6 },
      pollConfig: POLL_CONFIG,
    });
    expect(exception).toMatchObject({ variant: "error", icon: "octagon-x" });
    expect(exception?.text).toContain(
      "Exception 02 (Illegal data address) from slave 5 for FC03 at 100-124.",
    );
  });

  it("connected and healthy: no banner", () => {
    expect(
      nativeBannerFor({
        connection: "connected",
        reason: null,
        config: TCP,
        poll: HEALTHY,
        pollConfig: POLL_CONFIG,
      }),
    ).toBeNull();
    expect(
      nativeBannerFor({
        connection: "connected",
        reason: null,
        config: TCP,
        poll: null,
        pollConfig: null,
      }),
    ).toBeNull();
  });
});

describe("window title and buttons", () => {
  it("the title says Offline while the link is not up", () => {
    expect(nativeTitleState("connected", "timeout")).toBe("timeout");
    expect(nativeTitleState("idle", "paused")).toBe("offline");
    expect(nativeTitleState("connecting", "offline")).toBe("offline");
    expect(nativeTitleState("disconnected", "polling")).toBe("offline");
  });

  it("Pause while the poll runs, else Resume", () => {
    for (const state of ["polling", "timeout", "exception", "badResponse"] as const) {
      expect(pauseButtonLabel(state)).toBe("Pause");
    }
    for (const state of ["paused", "offline"] as const)
      expect(pauseButtonLabel(state)).toBe("Resume");
  });
});

describe("native status bar text", () => {
  it("Last OK, Round trip, Resp and Timeouts; nothing of Tx, ID, F or SR", () => {
    const at = new Date(2026, 9, 16, 14, 2, 11, 510).getTime();
    const text = nativeStatusBarText({
      lastOkAt: at,
      roundTripMs: 8,
      responses: 1198,
      timeouts: 0,
    });
    expect(text).toBe("Last OK 14:02:11.510 · Round trip 8 ms · Resp 1198 · Timeouts 0");
    expect(text).not.toContain("Tx");
  });

  it("before a valid reply", () => {
    expect(
      nativeStatusBarText({ lastOkAt: null, roundTripMs: null, responses: 0, timeouts: 6 }),
    ).toBe("No valid reply yet · Resp 0 · Timeouts 6");
  });

  it("without a round trip the segment is left out", () => {
    const at = new Date(2026, 9, 16, 1, 2, 3, 4).getTime();
    expect(
      nativeStatusBarText({ lastOkAt: at, roundTripMs: null, responses: 1, timeouts: 0 }),
    ).toBe("Last OK 01:02:03.004 · Resp 1 · Timeouts 0");
  });
});
