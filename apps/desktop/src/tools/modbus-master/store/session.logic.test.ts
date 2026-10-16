import { badResponseExtra as bad, sessionReason } from "@/shared/ipc/modbus-master.fake";
import type {
  ConnectionConfig,
  PollDefinition,
  SessionState,
  StateChangedEvent,
} from "@/shared/ipc/modbus-master.types";
import {
  ALLOWED,
  actionsFor,
  type BannerConfig,
  type BannerSnapshot,
  bannerFor,
  initialSessionData,
  isAllowed,
  isLinkUp,
  isPollRunning,
  pillFor,
  reduceStateChanged,
  SESSION_STATES,
} from "./session.logic";

const tcp: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const rtu: ConnectionConfig = {
  mode: "rtu",
  port: "COM3",
  baud: 9600,
  dataBits: 8,
  parity: "even",
  stopBits: 1,
  timeoutMs: 500,
};
const poll: PollDefinition = {
  slaveId: 1,
  function: 3,
  startAddress: 0,
  quantity: 10,
  scanRateMs: 1000,
};
const cfg: BannerConfig = { connection: tcp, poll, addressBase: 0 };

const snap = (over: Partial<BannerSnapshot>): BannerSnapshot => ({
  state: "idle",
  reason: null,
  exceptionCode: null,
  badResponse: null,
  consecutiveFailures: 0,
  ...over,
});

function evt(state: SessionState, over: Partial<StateChangedEvent> = {}): StateChangedEvent {
  return {
    type: "StateChanged",
    state,
    reason: null,
    consecutiveFailures: 0,
    exceptionCode: null,
    badResponseKind: null,
    badResponseDetail: null,
    at: 1000,
    ...over,
  };
}

describe("transition table (DES-001 T1-T15)", () => {
  it("lists every state", () => {
    expect(Object.keys(ALLOWED).sort()).toEqual([...SESSION_STATES].sort());
  });

  it.each([
    ["idle", "connecting"],
    ["disconnected", "connecting"],
    ["connecting", "connected"],
    ["connecting", "disconnected"],
    ["connecting", "idle"],
    ["connected", "polling"],
    ["paused", "polling"],
    ["polling", "polling"],
    ["polling", "timeout"],
    ["polling", "exception"],
    ["polling", "badResponse"],
    ["timeout", "polling"],
    ["timeout", "exception"],
    ["exception", "badResponse"],
    ["badResponse", "timeout"],
    ["polling", "paused"],
    ["timeout", "paused"],
    ["connected", "idle"],
    ["paused", "idle"],
    ["exception", "idle"],
    ["connected", "disconnected"],
    ["paused", "disconnected"],
    ["badResponse", "disconnected"],
    ["disconnected", "idle"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(isAllowed(from, to)).toBe(true);
  });

  it.each([
    ["idle", "polling"],
    ["idle", "connected"],
    ["idle", "disconnected"],
    ["connecting", "polling"],
    ["connected", "paused"],
    ["connected", "timeout"],
    ["paused", "timeout"],
    ["disconnected", "connected"],
    ["disconnected", "polling"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(isAllowed(from, to)).toBe(false);
  });

  it("classifies the P* and L* families", () => {
    const pStar = SESSION_STATES.filter(isPollRunning);
    expect(pStar).toEqual(["polling", "timeout", "exception", "badResponse"]);
    const lStar = SESSION_STATES.filter(isLinkUp);
    expect(lStar).toEqual([
      "connected",
      "polling",
      "paused",
      "timeout",
      "exception",
      "badResponse",
    ]);
  });
});

describe("actionsFor", () => {
  it("enables the commands that are valid in each state", () => {
    expect(actionsFor("idle")).toMatchObject({ connect: true, disconnect: false, write: false });
    expect(actionsFor("connecting")).toMatchObject({ cancel: true, connect: false });
    expect(actionsFor("connected")).toMatchObject({ startPoll: true, pause: false, write: true });
    expect(actionsFor("polling")).toMatchObject({ startPoll: true, pause: true, disconnect: true });
    expect(actionsFor("paused")).toMatchObject({ startPoll: true, pause: false, write: true });
    expect(actionsFor("disconnected")).toMatchObject({
      connect: true,
      dismiss: true,
      write: false,
      disconnect: false,
    });
  });
});

describe("pillFor", () => {
  it.each([
    ["idle", "plug", "Not connected"],
    ["connecting", "loader", "Connecting…"],
    ["connected", "link", "Connected"],
    ["polling", "activity", "Polling"],
    ["paused", "pause", "Paused"],
    ["timeout", "timer-off", "Timeout"],
    ["badResponse", "triangle-alert", "Bad response"],
    ["disconnected", "unplug", "Disconnected"],
  ] as const)("%s shows icon %s and label %s", (state, icon, label) => {
    expect(pillFor(state)).toEqual({ variant: state, icon, label });
  });

  it("shows the exception code as two hex digits", () => {
    expect(pillFor("exception", 2)).toEqual({
      variant: "exception",
      icon: "octagon-x",
      label: "Exception 02",
    });
    expect(pillFor("exception", 0x0b).label).toBe("Exception 0B");
    expect(pillFor("exception", null).label).toBe("Exception");
  });
});

describe("bannerFor", () => {
  it("has no banner in idle, connected, polling and paused", () => {
    for (const state of ["idle", "connected", "polling", "paused"] as const) {
      expect(bannerFor(snap({ state }), cfg)).toBeNull();
    }
  });

  it("shows the connecting banner with Cancel", () => {
    expect(bannerFor(snap({ state: "connecting" }), cfg)).toEqual({
      variant: "neutral",
      icon: "loader",
      text: "Connecting to 192.168.1.10:502…",
      actions: ["cancel"],
    });
    expect(bannerFor(snap({ state: "connecting" }), { ...cfg, connection: rtu })?.text).toBe(
      "Connecting to COM3…",
    );
  });

  it("shows the timeout warning with the counter", () => {
    expect(bannerFor(snap({ state: "timeout", consecutiveFailures: 5 }), cfg)).toEqual({
      variant: "warning",
      icon: "timer-off",
      text: "Timeout: slave 1 did not respond within 1000 ms. Retrying every 1000 ms (5 in a row).",
      actions: [],
    });
  });

  it("shows the exception error with name, function and display range", () => {
    expect(
      bannerFor(snap({ state: "exception", exceptionCode: 2, consecutiveFailures: 1 }), cfg),
    ).toEqual({
      variant: "error",
      icon: "octagon-x",
      text: "Exception 02 (Illegal data address) from slave 1 for FC03 at 0-9. Retrying every 1000 ms (1 in a row).",
      actions: [],
    });
    expect(
      bannerFor(snap({ state: "exception", exceptionCode: 0x0c, consecutiveFailures: 2 }), {
        ...cfg,
        addressBase: 1,
      })?.text,
    ).toBe(
      "Exception 0C (Unknown exception) from slave 1 for FC03 at 1-10. Retrying every 1000 ms (2 in a row).",
    );
  });

  it("shows the bad response warning for CRC mismatch", () => {
    expect(
      bannerFor(
        snap({
          state: "badResponse",
          badResponse: { kind: "crc", detail: null },
          consecutiveFailures: 3,
        }),
        cfg,
      ),
    ).toEqual({
      variant: "warning",
      icon: "triangle-alert",
      text: "Bad response from slave 1: CRC mismatch. Retrying every 1000 ms (3 in a row).",
      actions: [],
    });
  });

  it.each([
    ["refused", tcp, "Connection refused by 192.168.1.10:502."],
    ["connectTimeout", tcp, "No answer from 192.168.1.10:502 within 1000 ms."],
    [
      "hostNotFound",
      { ...tcp, host: "plc.local" } as ConnectionConfig,
      'Host "plc.local" could not be resolved.',
    ],
    ["portBusy", rtu, "COM3 is in use by another application or window."],
    ["portNotFound", rtu, "COM3 is not available. Refresh the port list."],
    ["closedByPeer", tcp, "The device at 192.168.1.10:502 closed the connection."],
    ["portRemoved", rtu, "COM3 was removed."],
    ["ioError", tcp, "Connection error: boom"],
  ] as const)("disconnected reason %s", (kind, connection, text) => {
    expect(
      bannerFor(snap({ state: "disconnected", reason: sessionReason(kind, "boom") }), {
        ...cfg,
        connection,
      }),
    ).toEqual({ variant: "error", icon: "unplug", text, actions: ["reconnect", "dismiss"] });
  });

  it("falls back to a generic text without a reason", () => {
    expect(bannerFor(snap({ state: "disconnected" }), cfg)?.text).toBe("Connection lost.");
  });
});

describe("reduceStateChanged", () => {
  it("counts consecutive timeouts and resets on a different failure", () => {
    let s = reduceStateChanged(initialSessionData, evt("connecting"));
    s = reduceStateChanged(s, evt("connected"));
    s = reduceStateChanged(s, evt("polling"));
    s = reduceStateChanged(s, evt("timeout"));
    expect(s.consecutiveFailures).toBe(1);
    s = reduceStateChanged(s, evt("timeout"));
    s = reduceStateChanged(s, evt("timeout"));
    expect(s.consecutiveFailures).toBe(3);
    s = reduceStateChanged(s, evt("exception", { exceptionCode: 2 }));
    expect(s.consecutiveFailures).toBe(1);
    expect(s.exceptionCode).toBe(2);
    s = reduceStateChanged(s, evt("exception", { exceptionCode: 2 }));
    expect(s.consecutiveFailures).toBe(2);
    s = reduceStateChanged(s, evt("exception", { exceptionCode: 3 }));
    expect(s.consecutiveFailures).toBe(1);
    s = reduceStateChanged(s, evt("polling"));
    expect(s.consecutiveFailures).toBe(0);
    expect(s.exceptionCode).toBeNull();
  });

  it("keys bad responses by kind", () => {
    let s = reduceStateChanged(initialSessionData, evt("badResponse", bad("crc")));
    s = reduceStateChanged(s, evt("badResponse", bad("crc")));
    expect(s.consecutiveFailures).toBe(2);
    s = reduceStateChanged(s, evt("badResponse", bad("transactionMismatch")));
    expect(s.consecutiveFailures).toBe(1);
  });

  it("prefers the backend counter when it sends one", () => {
    const s = reduceStateChanged(initialSessionData, evt("timeout", { consecutiveFailures: 7 }));
    expect(s.consecutiveFailures).toBe(7);
  });

  it("keeps the reason only for disconnected and uses the event time", () => {
    const reason = sessionReason("refused", "x");
    const s = reduceStateChanged(initialSessionData, evt("disconnected", { reason, at: 4242 }));
    expect(s.reason).toEqual(reason);
    expect(s.since).toBe(4242);
    expect(reduceStateChanged(s, evt("connecting", { reason })).reason).toBeNull();
  });

  it("records an unexpected pair and still applies it", () => {
    const s = reduceStateChanged(initialSessionData, evt("polling"));
    expect(s.state).toBe("polling");
    expect(s.lastUnexpected).toEqual({ from: "idle", to: "polling" });
    expect(reduceStateChanged(s, evt("paused")).lastUnexpected).toEqual({
      from: "idle",
      to: "polling",
    });
  });
});
