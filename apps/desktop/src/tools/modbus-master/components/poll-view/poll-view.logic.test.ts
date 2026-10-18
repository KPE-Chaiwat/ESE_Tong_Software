import type { PollDefinition } from "@/shared/ipc/modbus-master.types";
import { statusLineStep } from "../../lib/status-line";
import {
  type DataViewInput,
  deriveDataView,
  isWideHeader,
  notConnectedText,
  pollHeaderText,
  type SetupPresentation,
  setupPresentationFor,
  showButtonLabel,
  snapViewWidth,
  VIEW_WIDTH_BREAKPOINTS,
} from "./poll-view.logic";

describe("setupPresentationFor (DES-002 2.3.3, FE-002 31a)", () => {
  const cases: Array<["workspace" | "native", number, boolean, SetupPresentation]> = [
    ["workspace", 900, false, "closed"],
    ["workspace", 639, false, "closed"],
    ["workspace", 900, true, "dock"],
    ["workspace", 640, true, "dock"],
    ["workspace", 639, true, "popover"],
    ["workspace", 320, true, "popover"],
    ["native", 900, true, "panel"],
    ["native", 640, true, "panel"],
    ["native", 639, true, "popover"],
    ["native", 639, false, "rail"],
    ["native", 626, true, "popover"],
    ["native", 466, true, "popover"],
    ["native", 466, false, "rail"],
    ["native", 900, false, "rail"],
    ["native", 480, false, "rail"],
  ];
  it.each(cases)("%s, %i px, setup open %s -> %s", (host, width, open, expected) => {
    expect(setupPresentationFor(host, width, open)).toBe(expected);
  });

  it("compact mode keeps the setup on the rail unless the window has a local override", () => {
    expect(setupPresentationFor("native", 640, false, true, false)).toBe("rail");
    expect(setupPresentationFor("native", 640, true, true, false)).toBe("rail");
    expect(setupPresentationFor("native", 640, true, true, true)).toBe("panel");
    expect(setupPresentationFor("native", 639, true, true, true)).toBe("popover");
    expect(setupPresentationFor("native", 639, true, true, false)).toBe("rail");
  });
});

describe("snapViewWidth (REPORT-005 F1: exact fractional widths, never rounded)", () => {
  it("has the breakpoints of the status line, the wide header and the presentation fallback", () => {
    expect(VIEW_WIDTH_BREAKPOINTS).toEqual([465, 500, 606, 620, 640, 720, 810]);
  });

  it.each([
    [900, 810],
    [810, 810],
    [809.8, 720],
    [720, 720],
    [719.8, 640],
    [640, 640],
    [639.9, 620],
    [620, 620],
    [619.8, 606],
    [606, 606],
    [605.8, 500],
    [500, 500],
    [499.8, 465],
    [465, 465],
    [464.8, 0],
    [1, 0],
  ])("%d px snaps to %d", (width, snapped) => {
    expect(snapViewWidth(width)).toBe(snapped);
  });

  it("answers every strict comparison like the exact width, at every breakpoint", () => {
    for (const t of VIEW_WIDTH_BREAKPOINTS) {
      for (const w of [t - 1, t - 0.2, t - 0.01, t, t + 0.01, t + 0.2, t + 1]) {
        expect(snapViewWidth(w) < t).toBe(w < t);
        expect(snapViewWidth(w) >= t).toBe(w >= t);
      }
    }
  });

  it("gives the same status line step as the exact width (the old rounding did not)", () => {
    for (const t of VIEW_WIDTH_BREAKPOINTS) {
      for (const w of [t - 0.4, t - 0.2, t, t + 0.2]) {
        for (const kind of ["live", "long", "none"] as const) {
          expect(statusLineStep(snapViewWidth(w), kind)).toBe(statusLineStep(w, kind));
        }
      }
    }
    // 464.8 rounded to 465 was step 4: the bug.
    expect(statusLineStep(Math.round(464.8))).toBe(4);
    expect(statusLineStep(snapViewWidth(464.8))).toBe(5);
  });
});

describe("header layout", () => {
  it("is wide from 720 px", () => {
    expect(isWideHeader(719)).toBe(false);
    expect(isWideHeader(720)).toBe(true);
  });
  it("pollHeaderText", () => {
    const def: PollDefinition = {
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 10,
      scanRateMs: 100,
    };
    expect(pollHeaderText(def, 0)).toBe("Slave 1 · FC03 · 0-9 (10) · 100 ms");
    expect(pollHeaderText({ ...def, startAddress: 40, quantity: 2 }, 1)).toBe(
      "Slave 1 · FC03 · 41-42 (2) · 100 ms",
    );
  });
  it("showButtonLabel", () => {
    expect(showButtonLabel("both")).toBe("Show Both");
    expect(showButtonLabel("raw")).toBe("Show Raw");
    expect(showButtonLabel("scaled")).toBe("Show Scaled");
  });
});

describe("deriveDataView", () => {
  const base: DataViewInput = {
    host: "workspace",
    pollState: "polling",
    connectionState: "connected",
    exceptionCode: null,
    status: "live",
    hasValues: true,
    lastOkAt: new Date(2026, 0, 1, 14, 2, 11, 540).getTime(),
    clearedBecause: null,
    definition: { slaveId: 5, function: 4, startAddress: 0, quantity: 8, scanRateMs: 100 },
    addressBase: 0,
    connectionTarget: "192.168.1.10:502",
    draftInvalid: false,
  };
  const view = (patch: Partial<DataViewInput>) => deriveDataView({ ...base, ...patch });

  it("live: values and the Updated chip", () => {
    expect(view({})).toMatchObject({
      empty: null,
      stale: false,
      loading: false,
      chip: { kind: "live", text: "Updated 14:02:11.540" },
    });
  });

  it("a poll that is running without values shows loading rows", () => {
    for (const pollState of ["polling", "timeout", "badResponse"] as const) {
      expect(
        view({ pollState, hasValues: false, status: "loading", lastOkAt: null }),
      ).toMatchObject({
        empty: null,
        loading: true,
        chip: { kind: "loading", text: "Waiting for first response…" },
      });
    }
  });

  it.each([
    ["paused", "Paused - values from 14:02:11.540"],
    ["timeout", "No response - values from 14:02:11.540"],
    ["exception", "Exception - values from 14:02:11.540"],
    ["badResponse", "Bad response - values from 14:02:11.540"],
    ["offline", "Offline - values from 14:02:11.540"],
  ] as const)("stale values in %s", (pollState, text) => {
    expect(view({ pollState, status: "stale" })).toMatchObject({
      empty: null,
      stale: true,
      chip: { kind: "stale", text },
    });
  });

  describe("without values", () => {
    const none = { hasValues: false, status: "none" as const, lastOkAt: null };

    it("offline, by host and connection state", () => {
      expect(view({ ...none, pollState: "offline", connectionState: "idle" }).empty).toEqual({
        icon: "plug",
        text: "Not connected. Connect from the toolbar (Ctrl+L).",
      });
      expect(
        view({ ...none, host: "native", pollState: "offline", connectionState: "idle" }).empty,
      ).toEqual({
        icon: "plug",
        text: "Not connected. Connect from the connection window (Ctrl+Shift+M).",
      });
      expect(view({ ...none, pollState: "offline", connectionState: "connecting" }).empty).toEqual({
        icon: "loader",
        text: "Connecting to 192.168.1.10:502…",
      });
      expect(
        view({ ...none, pollState: "offline", connectionState: "disconnected" }).empty,
      ).toEqual({
        icon: "unplug",
        text: "Connection lost. Press Reconnect to continue.",
      });
    });

    it("connecting without a known target", () => {
      expect(
        view({
          ...none,
          pollState: "offline",
          connectionState: "connecting",
          connectionTarget: null,
        }).empty?.text,
      ).toBe("Connecting to the device…");
    });

    it("notConnectedText", () => {
      expect(notConnectedText("workspace")).toBe(
        "Not connected. Connect from the toolbar (Ctrl+L).",
      );
      expect(notConnectedText("native")).toBe(
        "Not connected. Connect from the connection window (Ctrl+Shift+M).",
      );
    });

    it("paused: never started, settings changed, invalid draft", () => {
      expect(view({ ...none, pollState: "paused" }).empty).toEqual({
        icon: "pause",
        text: "Poll paused. Press Resume (Ctrl+P) to read 8 input registers from slave 5.",
      });
      expect(
        view({ ...none, pollState: "paused", clearedBecause: "settingsChanged" }).empty?.text,
      ).toBe("Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.");
      expect(view({ ...none, pollState: "paused", draftInvalid: true }).empty).toEqual({
        icon: "circle-x",
        text: "Fix the poll settings to start polling.",
      });
    });

    it("the item names follow the function", () => {
      const text = (function_: 1 | 2 | 3 | 4) =>
        view({
          ...none,
          pollState: "paused",
          definition: { ...base.definition, function: function_ },
        }).empty?.text;
      expect(text(1)).toContain("8 coils");
      expect(text(2)).toContain("8 discrete inputs");
      expect(text(3)).toContain("8 holding registers");
      expect(text(4)).toContain("8 input registers");
    });

    it("exception before any data", () => {
      expect(view({ ...none, pollState: "exception", exceptionCode: 2 }).empty).toEqual({
        icon: "octagon-x",
        text: "No data: the device answered with exception 02 (Illegal data address).",
      });
    });
  });

  it("an offline poll whose loading never finished does not show loading rows", () => {
    expect(
      view({
        pollState: "offline",
        connectionState: "idle",
        hasValues: false,
        status: "loading",
        lastOkAt: null,
      }).empty,
    ).not.toBeNull();
  });
});
