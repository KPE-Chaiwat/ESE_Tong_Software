import type { PollDefinition, PollState } from "@/shared/ipc/modbus-master.types";
import {
  effectiveScanShown,
  initialPollRuntimeData,
  isAllowedPoll,
  isFailureState,
  isPollRunning,
  POLL_ALLOWED,
  POLL_STATES,
  pollBannerFor,
  pollPillFor,
  reducePollStateChanged,
} from "./poll.logic";

const evt = (
  state: PollState,
  extra: Partial<Parameters<typeof reducePollStateChanged>[1]> = {},
): Parameters<typeof reducePollStateChanged>[1] => ({
  state,
  consecutiveFailures: 0,
  exceptionCode: null,
  badResponseKind: null,
  badResponseDetail: null,
  at: 1,
  ...extra,
});

describe("POLL_ALLOWED (PT0-PT8)", () => {
  it("is the table of FE-002", () => {
    expect(POLL_ALLOWED.offline).toEqual(["paused", "polling"]);
    expect(POLL_ALLOWED.paused).toEqual(["polling", "offline"]);
    for (const s of ["polling", "timeout", "exception", "badResponse"] as const) {
      expect([...POLL_ALLOWED[s]].sort()).toEqual(
        ["polling", "timeout", "exception", "badResponse", "paused", "offline"].sort(),
      );
    }
  });

  it("isAllowedPoll", () => {
    expect(isAllowedPoll("offline", "polling")).toBe(true);
    expect(isAllowedPoll("polling", "offline")).toBe(true);
    expect(isAllowedPoll("offline", "timeout")).toBe(false);
    expect(isAllowedPoll("paused", "exception")).toBe(false);
    expect(isAllowedPoll("paused", "paused")).toBe(false);
  });

  it("classifies running and failing states", () => {
    expect(POLL_STATES.filter(isPollRunning)).toEqual([
      "polling",
      "timeout",
      "exception",
      "badResponse",
    ]);
    expect(POLL_STATES.filter(isFailureState)).toEqual(["timeout", "exception", "badResponse"]);
  });
});

describe("pollPillFor", () => {
  it.each([
    ["offline", null, true, "wifi-off", "Offline", "offline"],
    ["paused", null, true, "pause", "Paused", "paused"],
    ["polling", null, true, "activity", "Polling", "polling"],
    ["polling", null, false, "loader", "Waiting…", "waiting"],
    ["timeout", null, true, "timer-off", "Timeout", "timeout"],
    ["exception", 2, true, "octagon-x", "Exception 02", "exception"],
    ["exception", null, true, "octagon-x", "Exception", "exception"],
    ["badResponse", null, true, "triangle-alert", "Bad response", "badResponse"],
  ] as const)("%s (code %s, data %s)", (state, code, hasData, icon, label, variant) => {
    expect(pollPillFor(state, code, hasData)).toEqual({ variant, icon, label });
  });
});

describe("pollBannerFor (DES-001 2.3 texts per poll)", () => {
  const definition: PollDefinition = {
    slaveId: 5,
    function: 3,
    startAddress: 20,
    quantity: 125,
    scanRateMs: 100,
  };
  const cfg = { definition, timeoutMs: 1000, addressBase: 0 as const };
  const input = (state: PollState, extra = {}) => ({
    state,
    exceptionCode: null,
    badResponse: null,
    consecutiveFailures: 3,
    ...extra,
  });

  it("timeout", () => {
    expect(pollBannerFor(input("timeout"), cfg)).toEqual({
      variant: "warning",
      icon: "timer-off",
      text: "Timeout: slave 5 did not respond within 1000 ms. Retrying every 100 ms (3 in a row).",
    });
  });

  it("exception with the display range", () => {
    expect(pollBannerFor(input("exception", { exceptionCode: 2 }), cfg)?.text).toBe(
      "Exception 02 (Illegal data address) from slave 5 for FC03 at 20-144. Retrying every 100 ms (3 in a row).",
    );
    expect(
      pollBannerFor(input("exception", { exceptionCode: 2 }), { ...cfg, addressBase: 1 })?.text,
    ).toContain("at 21-145.");
  });

  it("badResponse", () => {
    expect(
      pollBannerFor(
        input("badResponse", {
          badResponse: { kind: "shortFrame", detail: { expected: 29, got: 20, message: "" } },
        }),
        cfg,
      )?.text,
    ).toBe(
      "Bad response from slave 5: short frame (20 of 29 bytes). Retrying every 100 ms (3 in a row).",
    );
    expect(pollBannerFor(input("badResponse"), cfg)?.text).toContain("invalid frame");
  });

  it("no banner for offline, paused and polling", () => {
    for (const s of ["offline", "paused", "polling"] as const) {
      expect(pollBannerFor(input(s), cfg)).toBeNull();
    }
  });
});

describe("reducePollStateChanged", () => {
  it("applies state, clears fields that do not belong", () => {
    const a = reducePollStateChanged(initialPollRuntimeData, evt("polling"));
    expect(a).toMatchObject({
      state: "polling",
      consecutiveFailures: 0,
      exceptionCode: null,
      since: 1,
    });
    const b = reducePollStateChanged(a, evt("exception", { exceptionCode: 2, at: 2 }));
    expect(b.exceptionCode).toBe(2);
    const c = reducePollStateChanged(b, evt("polling", { at: 3 }));
    expect(c.exceptionCode).toBeNull();
    expect(c.badResponse).toBeNull();
  });

  it("counts a repeated failure itself when the backend sends 0", () => {
    let s = reducePollStateChanged(initialPollRuntimeData, evt("polling"));
    s = reducePollStateChanged(s, evt("timeout"));
    expect(s.consecutiveFailures).toBe(1);
    s = reducePollStateChanged(s, evt("timeout"));
    s = reducePollStateChanged(s, evt("timeout"));
    expect(s.consecutiveFailures).toBe(3);
    s = reducePollStateChanged(s, evt("exception", { exceptionCode: 2 }));
    expect(s.consecutiveFailures).toBe(1);
    s = reducePollStateChanged(s, evt("exception", { exceptionCode: 2 }));
    expect(s.consecutiveFailures).toBe(2);
    // another exception code is another failure
    s = reducePollStateChanged(s, evt("exception", { exceptionCode: 3 }));
    expect(s.consecutiveFailures).toBe(1);
  });

  it("uses the backend count when it sends one", () => {
    const s = reducePollStateChanged(
      initialPollRuntimeData,
      evt("timeout", { consecutiveFailures: 7 }),
    );
    expect(s.consecutiveFailures).toBe(7);
  });

  it("keeps the kind of a bad response", () => {
    const s = reducePollStateChanged(
      initialPollRuntimeData,
      evt("badResponse", {
        badResponseKind: "crc",
        badResponseDetail: { expected: 1, got: 2, message: "m" },
      }),
    );
    expect(s.badResponse).toEqual({ kind: "crc", detail: { expected: 1, got: 2, message: "m" } });
    const again = reducePollStateChanged(s, evt("badResponse", { badResponseKind: "crc" }));
    expect(again.consecutiveFailures).toBe(2);
    const other = reducePollStateChanged(
      again,
      evt("badResponse", { badResponseKind: "shortFrame" }),
    );
    expect(other.consecutiveFailures).toBe(1);
  });

  it("records an unexpected pair and still applies it", () => {
    const s = reducePollStateChanged(initialPollRuntimeData, evt("timeout"));
    expect(s.state).toBe("timeout");
    expect(s.lastUnexpected).toEqual({ from: "offline", to: "timeout" });
  });

  it("keeps an older warning on an expected pair", () => {
    const first = reducePollStateChanged(initialPollRuntimeData, evt("exception"));
    const second = reducePollStateChanged(first, evt("polling"));
    expect(second.lastUnexpected).toEqual({ from: "offline", to: "exception" });
  });
});

describe("effectiveScanShown (DES-002 2.3.2)", () => {
  it("is null when Rust reports nothing", () => {
    expect(effectiveScanShown(null, 100)).toBeNull();
  });
  it("is null while the mean interval is within 1.5 x the scan rate", () => {
    expect(effectiveScanShown(100, 100)).toBeNull();
    expect(effectiveScanShown(150, 100)).toBeNull();
  });
  it("fires above 1.5 x the scan rate, rounded to whole ms", () => {
    expect(effectiveScanShown(151, 100)).toBe(151);
    expect(effectiveScanShown(140.6, 80)).toBe(141);
    expect(effectiveScanShown(140, 90)).toBe(140);
  });
});
