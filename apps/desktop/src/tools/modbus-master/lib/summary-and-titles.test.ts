import type { PollState } from "@/shared/ipc/modbus-master.types";
import { pollSummary } from "./poll-summary";
import { connectionTitle, nativePollTitle, subWindowLabel } from "./titles";

const polls = (...states: PollState[]) => states.map((state) => ({ state }));

describe("pollSummary (DES-002 1.5 rule 2)", () => {
  it("lists counts in the fixed order and omits zeros", () => {
    const s = pollSummary(
      polls(
        "polling",
        "timeout",
        "exception",
        "polling",
        "timeout",
        "polling",
        "polling",
        "polling",
      ),
    );
    expect(s.text).toBe("1 exception · 2 timeout · 5 live");
    expect(s.counts).toEqual({ exception: 1, badResponse: 0, timeout: 2, live: 5, paused: 0 });
    expect(s.total).toBe(8);
  });

  it("uses the order exception, bad response, timeout, live, paused", () => {
    const s = pollSummary(polls("paused", "polling", "timeout", "badResponse", "exception"));
    expect(s.text).toBe("1 exception · 1 bad response · 1 timeout · 1 live · 1 paused");
  });

  it.each([
    [["exception", "polling"], "exception", "octagon-x", "error"],
    [["badResponse", "timeout", "polling"], "badResponse", "triangle-alert", "warning"],
    [["timeout", "polling"], "timeout", "timer-off", "warning"],
    [["polling", "paused"], "live", "activity", "success"],
    [["paused", "paused"], "paused", "pause", "outline"],
  ] as const)("%j: worst %s, icon %s, tone %s", (states, worst, icon, tone) => {
    const s = pollSummary(polls(...states));
    expect(s.worst).toBe(worst);
    expect(s.icon).toBe(icon);
    expect(s.tone).toBe(tone);
  });

  it("no polls reads 'No polls' with no icon and an outline tone", () => {
    expect(pollSummary([])).toMatchObject({
      text: "No polls",
      worst: null,
      icon: null,
      tone: "outline",
      total: 0,
      short: "No polls",
    });
  });

  it("does not count offline polls", () => {
    const s = pollSummary(polls("offline", "offline"));
    expect(s.text).toBe("No polls");
    expect(pollSummary(polls("offline", "polling")).text).toBe("1 live");
  });

  it("a polling poll without data yet counts as live (the state is polling)", () => {
    expect(pollSummary(polls("polling")).text).toBe("1 live");
  });

  it("the narrow variant shows the worst count and the others", () => {
    expect(pollSummary(polls("exception", "timeout", "polling", "polling")).short).toBe(
      "1 exception +3",
    );
    expect(pollSummary(polls("polling", "polling")).short).toBe("2 live");
  });
});

describe("window titles (DES-002 2.12)", () => {
  it("W1 at start", () => {
    expect(connectionTitle(null, false, "idle", null)).toBe(
      "Modbus Master - Untitled - Not connected",
    );
  });
  it("W1 connected with the summary", () => {
    expect(
      connectionTitle("Boiler-PLC", true, "connected", "1 exception · 2 timeout · 5 live"),
    ).toBe("Modbus Master - Boiler-PLC * - Connected (1 exception · 2 timeout · 5 live)");
  });
  it("W1 leaves the summary out when not connected or with no polls", () => {
    expect(connectionTitle("A", false, "disconnected", "1 live")).toBe(
      "Modbus Master - A - Disconnected",
    );
    expect(connectionTitle("A", false, "connected", null)).toBe("Modbus Master - A - Connected");
    expect(connectionTitle(null, false, "connecting", null)).toBe(
      "Modbus Master - Untitled - Connecting…",
    );
  });
  it("W2", () => {
    expect(nativePollTitle("Pump 2", "Boiler-PLC", "Timeout")).toBe(
      "Pump 2 - Boiler-PLC - Timeout",
    );
    expect(nativePollTitle("Pump 2", null, "Offline")).toBe("Pump 2 - Untitled - Offline");
  });
  it("sub-window accessible name", () => {
    expect(subWindowLabel("Tank 1 temperatures", "Polling")).toBe(
      "Tank 1 temperatures, Polling, sub-window",
    );
  });
});
