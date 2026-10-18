import type { PollState } from "@/shared/ipc/modbus-master.types";
import {
  connectionAnnouncement,
  enteredFailure,
  FAILURE_BURST,
  failureAnnouncement,
  isFailureState,
} from "./announcements.logic";

const tcp = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 } as const;

describe("connectionAnnouncement", () => {
  it("is the pill label, plus the banner text for connecting and disconnected", () => {
    expect(connectionAnnouncement("idle", null, tcp)).toBe("Not connected");
    expect(connectionAnnouncement("connected", null, tcp)).toBe("Connected");
    expect(connectionAnnouncement("connecting", null, tcp)).toBe(
      "Connecting…. Connecting to 192.168.1.10:502…",
    );
    expect(
      connectionAnnouncement(
        "disconnected",
        { kind: "refused", phase: "connectFailed", message: "" },
        tcp,
      ),
    ).toBe("Disconnected. Connection refused by 192.168.1.10:502.");
  });

  it("is only the label when the connection is not known", () => {
    expect(connectionAnnouncement("connecting", null, null)).toBe("Connecting…");
  });
});

describe("poll failures (DES-002 1.5 rule 5)", () => {
  it("failure states are timeout, exception and badResponse", () => {
    const failing: PollState[] = ["timeout", "exception", "badResponse"];
    const others: PollState[] = ["polling", "paused", "offline"];
    expect(failing.every(isFailureState)).toBe(true);
    expect(others.some(isFailureState)).toBe(false);
  });

  it("only a move into a failure state counts, not a repeat, a recovery or a first sight", () => {
    expect(enteredFailure("polling", "timeout")).toBe(true);
    expect(enteredFailure("timeout", "exception")).toBe(true);
    expect(enteredFailure("timeout", "timeout")).toBe(false);
    expect(enteredFailure("timeout", "polling")).toBe(false);
    expect(enteredFailure(undefined, "timeout")).toBe(false);
  });

  it("one failure reads '{name}: {label}.'", () => {
    expect(failureAnnouncement([{ name: "Pump 2", label: "Timeout" }])).toBe("Pump 2: Timeout.");
  });

  it("up to three failures are listed", () => {
    expect(
      failureAnnouncement([
        { name: "A", label: "Timeout" },
        { name: "B", label: "Exception 02" },
        { name: "C", label: "Bad response" },
      ]),
    ).toBe("A: Timeout. B: Exception 02. C: Bad response.");
  });

  it("more than three become one message", () => {
    const four = Array.from({ length: FAILURE_BURST + 1 }, (_, i) => ({
      name: `P${i}`,
      label: "Timeout",
    }));
    expect(failureAnnouncement(four)).toBe("4 polls are failing.");
  });

  it("nothing to say for no failures", () => {
    expect(failureAnnouncement([])).toBeNull();
  });
});
