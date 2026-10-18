import type { ConnectionConfig, SessionReason } from "@/shared/ipc/modbus-master.types";
import {
  answersPendingConnection,
  CONNECTION_ALLOWED,
  CONNECTION_STATES,
  connectionActionsFor,
  connectionBannerFor,
  connectionPillFor,
  connectionPillTarget,
  connectionSummaryLine,
  connectionTarget,
  initialConnectionData,
  isAllowedConnection,
  isDuplicateConnectionEvent,
  reasonReopensSetup,
  reasonText,
  reduceConnectionStateChanged,
  transportSummary,
} from "./connection.logic";

const tcp: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const rtu: ConnectionConfig = {
  mode: "rtu",
  port: "COM3",
  baud: 9600,
  dataBits: 8,
  parity: "even",
  stopBits: 1,
  timeoutMs: 1000,
};
const reason = (kind: SessionReason["kind"], message = ""): SessionReason => ({
  kind,
  phase: "connectFailed",
  message,
});

describe("CONNECTION_ALLOWED (C1-C7)", () => {
  it("matches the FE-002 table", () => {
    expect(CONNECTION_ALLOWED).toEqual({
      idle: ["connecting"],
      connecting: ["connected", "disconnected", "idle"],
      connected: ["idle", "disconnected"],
      disconnected: ["connecting", "idle"],
    });
  });

  it("isAllowedConnection", () => {
    expect(isAllowedConnection("idle", "connecting")).toBe(true);
    expect(isAllowedConnection("idle", "connected")).toBe(false);
    expect(isAllowedConnection("connected", "connecting")).toBe(false);
    expect(isAllowedConnection("disconnected", "connecting")).toBe(true);
  });
});

describe("pill", () => {
  it("has icon and label for every state", () => {
    expect(CONNECTION_STATES.map((s) => connectionPillFor(s))).toEqual([
      { variant: "idle", icon: "plug", label: "Not connected" },
      { variant: "connecting", icon: "loader", label: "Connecting…" },
      { variant: "connected", icon: "link", label: "Connected" },
      { variant: "disconnected", icon: "unplug", label: "Disconnected" },
    ]);
  });
});

describe("targets", () => {
  it("banner target", () => {
    expect(connectionTarget(tcp)).toBe("192.168.1.10:502");
    expect(connectionTarget(rtu)).toBe("COM3");
  });
  it("pill target (mockup 6)", () => {
    expect(connectionPillTarget(tcp)).toBe("192.168.1.10:502");
    expect(connectionPillTarget(rtu)).toBe("COM3 9600 8E1");
    expect(connectionPillTarget({ ...rtu, parity: "none", dataBits: 7, stopBits: 2 })).toBe(
      "COM3 9600 7N2",
    );
    expect(connectionPillTarget({ ...rtu, parity: "odd" })).toBe("COM3 9600 8O1");
  });
  it("sidebar summary line (DES-002 2.2.2)", () => {
    expect(connectionSummaryLine(tcp)).toBe("TCP 192.168.1.10:502 · timeout 1000 ms");
    expect(connectionSummaryLine(rtu)).toBe("RTU COM3 9600 8E1 · timeout 1000 ms");
  });
  it("status bar transport summary", () => {
    expect(transportSummary(tcp)).toBe("TCP 192.168.1.10:502");
    expect(transportSummary(rtu)).toBe("RTU COM3 9600 8E1");
  });
});

describe("banner (connection states only)", () => {
  it("connecting has Cancel", () => {
    expect(connectionBannerFor("connecting", null, tcp)).toEqual({
      variant: "neutral",
      icon: "loader",
      text: "Connecting to 192.168.1.10:502…",
      actions: ["cancel"],
    });
  });
  it("disconnected has Reconnect and Dismiss", () => {
    expect(connectionBannerFor("disconnected", reason("refused"), tcp)).toEqual({
      variant: "error",
      icon: "unplug",
      text: "Connection refused by 192.168.1.10:502.",
      actions: ["reconnect", "dismiss"],
    });
  });
  it("idle and connected have none", () => {
    expect(connectionBannerFor("idle", null, tcp)).toBeNull();
    expect(connectionBannerFor("connected", null, tcp)).toBeNull();
  });

  it.each([
    [reason("refused"), tcp, "Connection refused by 192.168.1.10:502."],
    [reason("connectTimeout"), tcp, "No answer from 192.168.1.10:502 within 1000 ms."],
    [reason("hostNotFound"), tcp, 'Host "192.168.1.10" could not be resolved.'],
    [reason("hostNotFound"), rtu, 'Host "COM3" could not be resolved.'],
    [reason("portBusy"), rtu, "COM3 is in use by another application or window."],
    [reason("portNotFound"), rtu, "COM3 is not available. Refresh the port list."],
    [reason("closedByPeer"), tcp, "The device at 192.168.1.10:502 closed the connection."],
    [reason("portRemoved"), rtu, "COM3 was removed."],
    [reason("ioError", "os error 10054"), tcp, "Connection error: os error 10054"],
    [null, tcp, "Connection lost."],
  ])("reason text %#", (r, cfg, text) => {
    expect(reasonText(r, cfg)).toBe(text);
  });

  it("portBusy, portNotFound and refused re-open the connection section", () => {
    expect(reasonReopensSetup(reason("portBusy"))).toBe(true);
    expect(reasonReopensSetup(reason("portNotFound"))).toBe(true);
    expect(reasonReopensSetup(reason("refused"))).toBe(true);
    expect(reasonReopensSetup(reason("closedByPeer"))).toBe(false);
    expect(reasonReopensSetup(null)).toBe(false);
  });
});

describe("actions and pending", () => {
  it("connectionActionsFor", () => {
    expect(connectionActionsFor("idle")).toMatchObject({
      connect: true,
      cancel: false,
      disconnect: false,
      write: false,
    });
    expect(connectionActionsFor("connecting")).toMatchObject({ connect: false, cancel: true });
    expect(connectionActionsFor("connected")).toMatchObject({
      disconnect: true,
      write: true,
      connect: false,
    });
    expect(connectionActionsFor("disconnected")).toMatchObject({
      connect: true,
      dismiss: true,
      write: false,
    });
  });

  it("answersPendingConnection", () => {
    expect(answersPendingConnection("connect", "idle", "connecting")).toBe(true);
    expect(answersPendingConnection("connect", "idle", "idle")).toBe(false);
    expect(answersPendingConnection("cancel", "connecting", "idle")).toBe(true);
    expect(answersPendingConnection("cancel", "connecting", "connected")).toBe(true);
    expect(answersPendingConnection("cancel", "connecting", "connecting")).toBe(false);
    expect(answersPendingConnection("disconnect", "connected", "idle")).toBe(true);
    expect(answersPendingConnection("disconnect", "connected", "connected")).toBe(false);
    expect(answersPendingConnection("dismiss", "disconnected", "idle")).toBe(true);
    expect(answersPendingConnection("dismiss", "disconnected", "disconnected")).toBe(false);
  });
});

describe("reduceConnectionStateChanged", () => {
  it("keeps the reason only in disconnected", () => {
    const r = reason("refused");
    const a = reduceConnectionStateChanged(initialConnectionData, {
      state: "connecting",
      reason: null,
      at: 1,
    });
    const b = reduceConnectionStateChanged(a, { state: "disconnected", reason: r, at: 2 });
    expect(b).toMatchObject({ state: "disconnected", reason: r, since: 2, lastUnexpected: null });
    const c = reduceConnectionStateChanged(b, { state: "connecting", reason: r, at: 3 });
    expect(c.reason).toBeNull();
  });

  it("records an unexpected pair and still applies it", () => {
    const s = reduceConnectionStateChanged(initialConnectionData, {
      state: "connected",
      reason: null,
      at: 5,
    });
    expect(s.state).toBe("connected");
    expect(s.lastUnexpected).toEqual({ from: "idle", to: "connected" });
  });

  it("isDuplicateConnectionEvent: same state at the same time", () => {
    const s = reduceConnectionStateChanged(initialConnectionData, {
      state: "connecting",
      reason: null,
      at: 7,
    });
    expect(isDuplicateConnectionEvent(s, { state: "connecting", at: 7 })).toBe(true);
    expect(isDuplicateConnectionEvent(s, { state: "connecting", at: 8 })).toBe(false);
    expect(isDuplicateConnectionEvent(s, { state: "connected", at: 7 })).toBe(false);
  });
});
