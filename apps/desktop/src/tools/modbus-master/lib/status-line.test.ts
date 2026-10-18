import type { ConnectionState, PollState } from "@/shared/ipc/modbus-master.types";
import {
  compactChip,
  compactChipLabel,
  counterText,
  freshnessTextKind,
  hostMarker,
  hostStateOf,
  statusLineParts,
  statusLineReason,
  statusLineStep,
  statusLineText,
} from "./status-line";

const counters = { requests: 1204, errors: 0, timeouts: 0 };

describe("statusLineText (DES-002 2.3.2)", () => {
  it("the example format", () => {
    expect(statusLineText(counters, 1, 3, 100)).toBe("Tx 1204 · Err 0 · ID 1 · F 03 · SR 100 ms");
  });
  it("Err adds errors and timeouts", () => {
    expect(statusLineText({ requests: 10, errors: 2, timeouts: 4 }, 5, 3, 100)).toContain("Err 6");
  });
  it("FC is two digits", () => {
    expect(statusLineText(counters, 1, 3, 100)).toContain("F 03");
    expect(statusLineText(counters, 1, 1, 100)).toContain("F 01");
    expect(statusLineText(counters, 2, 4, 100)).toContain("ID 2 · F 04");
  });
  it("shows the effective rate when it differs", () => {
    expect(statusLineText(counters, 1, 3, 100, 140)).toBe(
      "Tx 1204 · Err 0 · ID 1 · F 03 · SR 100 ms (effective 140 ms)",
    );
    expect(statusLineText(counters, 1, 3, 20, 31)).toContain("SR 20 ms (effective 31 ms)");
  });
});

describe("statusLineReason (DES-002 2.3.2 table)", () => {
  const details = { timeoutMs: 1000, exceptionCode: null, badResponse: null };

  it("polling and paused have no reason and a plain line", () => {
    expect(statusLineReason("polling", "connected", details)).toEqual({ text: null, tone: "none" });
    expect(statusLineReason("paused", "connected", details)).toEqual({ text: null, tone: "none" });
  });

  it("timeout", () => {
    expect(statusLineReason("timeout", "connected", details)).toEqual({
      text: "No response within 1000 ms",
      tone: "warning",
    });
  });

  it("badResponse uses the kind text", () => {
    expect(
      statusLineReason("badResponse", "connected", {
        ...details,
        badResponse: { kind: "shortFrame", detail: { expected: 29, got: 20, message: "" } },
      }),
    ).toEqual({ text: "Bad response: short frame (20 of 29 bytes)", tone: "warning" });
    expect(
      statusLineReason("badResponse", "connected", {
        ...details,
        badResponse: { kind: "crc", detail: null },
      }).text,
    ).toBe("Bad response: CRC mismatch");
  });

  it("exception", () => {
    expect(statusLineReason("exception", "connected", { ...details, exceptionCode: 2 })).toEqual({
      text: "Exception 02 (Illegal data address)",
      tone: "error",
    });
  });

  it.each([
    ["idle", "No connection", "neutral"],
    ["connecting", "Connecting…", "neutral"],
    ["disconnected", "No connection: link lost", "error"],
  ] as const)("offline while the connection is %s", (connection, text, tone) => {
    expect(statusLineReason("offline", connection, details)).toEqual({ text, tone });
  });

  it("covers every state pair without throwing", () => {
    const polls: PollState[] = [
      "offline",
      "paused",
      "polling",
      "timeout",
      "exception",
      "badResponse",
    ];
    const conns: ConnectionState[] = ["idle", "connecting", "connected", "disconnected"];
    for (const p of polls)
      for (const c of conns) expect(() => statusLineReason(p, c, details)).not.toThrow();
  });
});

describe("compactChip (sidebar rows)", () => {
  const base = { consecutiveFailures: 0, exceptionCode: null, hasData: true };

  it.each([
    ["polling", { ...base }, "Live", "activity", "Polling"],
    ["polling", { ...base, hasData: false }, "Waiting", "loader", "Waiting…"],
    ["paused", { ...base }, "Paused", "pause", "Paused"],
    ["timeout", { ...base, consecutiveFailures: 3 }, "Timeout 3", "timer-off", "Timeout"],
    ["exception", { ...base, exceptionCode: 2 }, "Exc 02", "octagon-x", "Exception 02"],
    ["badResponse", { ...base }, "Bad response", "triangle-alert", "Bad response"],
    ["offline", { ...base }, "Offline", "wifi-off", "Offline"],
  ] as const)("%s", (state, details, label, icon, fullLabel) => {
    expect(compactChip(state, details)).toEqual({ icon, label, fullLabel });
    expect(compactChipLabel(state, details)).toBe(label);
  });
});

describe("host state and markers (DES-002 2.2.3)", () => {
  it("hostStateOf", () => {
    const rect = (state: "normal" | "minimized" | "maximized") => ({ state });
    expect(hostStateOf({ host: "workspace", open: true, workspace: rect("normal") })).toBe(
      "workspace.normal",
    );
    expect(hostStateOf({ host: "workspace", open: true, workspace: rect("minimized") })).toBe(
      "workspace.minimized",
    );
    expect(hostStateOf({ host: "workspace", open: true, workspace: rect("maximized") })).toBe(
      "workspace.maximized",
    );
    expect(hostStateOf({ host: "workspace", open: true, workspace: null })).toBe(
      "workspace.normal",
    );
    expect(hostStateOf({ host: "native", open: true, workspace: rect("minimized") })).toBe(
      "native",
    );
    expect(hostStateOf({ host: "workspace", open: false, workspace: rect("normal") })).toBe(
      "closed",
    );
    expect(hostStateOf({ host: "native", open: false, workspace: null })).toBe("closed");
  });

  it("hostMarker", () => {
    expect(hostMarker("workspace.normal")).toBeNull();
    expect(hostMarker("workspace.maximized")).toBeNull();
    expect(hostMarker("workspace.minimized")).toEqual({ icon: "minus", text: "minimized" });
    expect(hostMarker("native")).toEqual({ icon: "square-arrow-out-up-right", text: "own window" });
    expect(hostMarker("closed")).toEqual({ icon: "eye-off", text: "closed" });
  });
});

describe("statusLineParts (DES-002 2.3.2)", () => {
  it("the four parts join into the full text", () => {
    const parts = statusLineParts(counters, 1, 3, 100, 140);
    expect(parts).toEqual({
      tx: "Tx 1204",
      err: " · Err 0",
      ids: " · ID 1 · F 03",
      rate: " · SR 100 ms (effective 140 ms)",
    });
    expect(parts.tx + parts.err + parts.ids + parts.rate).toBe(
      statusLineText(counters, 1, 3, 100, 140),
    );
  });
});

describe("statusLineStep (DES-002 2.3.2 revision 9: 720/810, 620, 606, 500, 465; strictly below is on)", () => {
  // The freshness chip text kind: live = "Updated ...", long = every other text, none = no chip.
  it.each([
    ["live", 900, 0],
    ["live", 720, 0],
    ["live", 719, 1],
    ["live", 700, 1],
    ["live", 621, 1],
    ["live", 620, 1],
    ["live", 619, 2],
    ["live", 606, 2],
    ["live", 605, 3],
    ["live", 500, 3],
    ["live", 499, 4],
    ["live", 465, 4],
    ["live", 464, 5],
    ["live", 316, 5],
    ["none", 900, 0],
    ["none", 720, 0],
    ["none", 719, 1],
    ["none", 464, 5],
    ["long", 900, 0],
    ["long", 810, 0],
    ["long", 809, 1],
    ["long", 720, 1],
    ["long", 719, 1],
    ["long", 620, 1],
    ["long", 619, 2],
    ["long", 606, 2],
    ["long", 605, 3],
    ["long", 500, 3],
    ["long", 499, 4],
    ["long", 465, 4],
    ["long", 464, 5],
  ] as const)("%s chip, L = %i -> step %i", (freshness, width, step) => {
    expect(statusLineStep(width, freshness)).toBe(step);
  });

  it("defaults to no chip", () => {
    expect(statusLineStep(719)).toBe(1);
    expect(statusLineStep(720)).toBe(0);
  });

  it("the old thresholds (700, 580, 480) no longer apply", () => {
    expect(statusLineStep(710, "live")).toBe(1);
    expect(statusLineStep(590, "live")).toBe(3);
    expect(statusLineStep(490, "live")).toBe(4);
    expect(statusLineStep(470, "live")).toBe(4);
  });

  it("the QA reference frames (active frame - 4): 640 = step 1, 600 = 3, 560 = 3, 430 = 5", () => {
    expect(statusLineStep(640 - 4, "live")).toBe(1);
    expect(statusLineStep(600 - 4, "live")).toBe(3);
    expect(statusLineStep(560 - 4, "live")).toBe(3);
    expect(statusLineStep(430 - 4, "live")).toBe(5);
  });

  it("steps are cumulative as the line narrows", () => {
    for (const kind of ["live", "long", "none"] as const) {
      let last = 0;
      for (let width = 1000; width >= 200; width -= 1) {
        const step = statusLineStep(width, kind);
        expect(step).toBeGreaterThanOrEqual(last);
        last = step;
      }
      expect(last).toBe(5);
    }
  });

  it("freshnessTextKind", () => {
    expect(freshnessTextKind("live")).toBe("live");
    expect(freshnessTextKind("stale")).toBe("long");
    expect(freshnessTextKind("loading")).toBe("long");
    expect(freshnessTextKind(null)).toBe("none");
  });
});

describe("counterText", () => {
  const fields = {
    counters: { requests: 1234, errors: 1, timeouts: 2 },
    slaveId: 1,
    fc: 3,
    scanMs: 100,
  };
  const FULL = "Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms";

  it.each([
    [0, FULL],
    [1, FULL],
    [2, FULL],
    [3, "Tx 1234 · Err 3 · SR 100 ms"],
    [4, "Tx 1234 · Err 3 · SR 100 ms"],
    [5, "Tx 1234 · SR 100 ms"],
  ] as const)("step %i", (step, visible) => {
    expect(counterText(fields, step)).toEqual({ visible, full: FULL });
  });

  it("with the effective rate", () => {
    const withEffective = { ...fields, effectiveScanMs: 180 };
    const full = "Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms (effective 180 ms)";
    expect(counterText(withEffective, 0)).toEqual({ visible: full, full });
    expect(counterText(withEffective, 3)).toEqual({
      visible: "Tx 1234 · Err 3 · SR 100 ms (effective 180 ms)",
      full,
    });
    expect(counterText(withEffective, 5)).toEqual({
      visible: "Tx 1234 · SR 100 ms (effective 180 ms)",
      full,
    });
  });

  it("matches statusLineText as the full text", () => {
    expect(counterText(fields, 0).full).toBe(statusLineText(fields.counters, 1, 3, 100));
  });
});
