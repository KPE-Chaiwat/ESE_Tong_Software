import type { ConnectionConfig, PollDefinition } from "@/shared/ipc/modbus-master.types";
import { type DataViewInput, deriveDataView, pollSummary } from "./data-view.logic";

const connection: ConnectionConfig = {
  mode: "tcp",
  host: "192.168.1.10",
  port: 502,
  timeoutMs: 1000,
};
const poll: PollDefinition = {
  slaveId: 1,
  function: 3,
  startAddress: 0,
  quantity: 10,
  scanRateMs: 1000,
};
const at = new Date(2026, 9, 12, 14, 2, 11, 540).getTime();

function input(over: Partial<DataViewInput> = {}): DataViewInput {
  return {
    state: "idle",
    exceptionCode: null,
    status: "none",
    hasValues: false,
    lastOkAt: null,
    clearedBecause: null,
    definition: null,
    poll,
    connection,
    addressBase: 0,
    pollInvalid: false,
    ...over,
  };
}

const withData = (over: Partial<DataViewInput>) =>
  input({ status: "live", hasValues: true, lastOkAt: at, definition: poll, ...over });

describe("pollSummary", () => {
  it("describes slave, function and range in the display base", () => {
    expect(pollSummary(poll, 0)).toBe("Slave 1 · FC03 Read holding registers · 0-9 (10)");
    expect(pollSummary(poll, 1)).toBe("Slave 1 · FC03 Read holding registers · 1-10 (10)");
    expect(pollSummary({ ...poll, function: 2, slaveId: 7 }, 0)).toBe(
      "Slave 7 · FC02 Read discrete inputs · 0-9 (10)",
    );
  });
});

describe("empty texts (DES-001 2.4)", () => {
  it.each([
    ["idle", "plug", "Not connected. Configure a connection and press Connect (Ctrl+L)."],
    ["connecting", "loader", "Connecting to 192.168.1.10:502…"],
    [
      "connected",
      "link",
      "Connected. Press Start polling (Ctrl+P) to read 10 holding registers from slave 1.",
    ],
    ["disconnected", "unplug", "Connection lost. Press Reconnect to continue."],
  ] as const)("%s", (state, icon, text) => {
    const view = deriveDataView(input({ state }));
    expect(view.emptyText).toEqual({ icon, text });
    expect(view.rowCount).toBe(0);
    expect(view.chip).toBeNull();
  });

  it("names the item kind of the function", () => {
    const text = (fn: 1 | 2 | 3 | 4) =>
      deriveDataView(
        input({ state: "connected", poll: { ...poll, function: fn, quantity: 5, slaveId: 3 } }),
      ).emptyText?.text;
    expect(text(1)).toContain("read 5 coils from slave 3.");
    expect(text(2)).toContain("read 5 discrete inputs from slave 3.");
    expect(text(3)).toContain("read 5 holding registers from slave 3.");
    expect(text(4)).toContain("read 5 input registers from slave 3.");
  });

  it("connected with an invalid poll", () => {
    expect(deriveDataView(input({ state: "connected", pollInvalid: true })).emptyText?.text).toBe(
      "Fix the poll settings to start polling.",
    );
  });

  it("paused after Apply with changed settings", () => {
    const view = deriveDataView(input({ state: "paused", clearedBecause: "settingsChanged" }));
    expect(view.emptyText?.text).toBe(
      "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.",
    );
  });

  it("exception before any data", () => {
    const view = deriveDataView(
      input({ state: "exception", exceptionCode: 2, status: "loading", definition: poll }),
    );
    expect(view.emptyText?.text).toBe(
      "No data: the device answered with exception 02 (Illegal data address).",
    );
  });

  it("disconnected before any data", () => {
    const view = deriveDataView(
      input({ state: "disconnected", status: "loading", definition: poll }),
    );
    expect(view.emptyText?.text).toBe("Connection lost. Press Reconnect to continue.");
  });
});

describe("loading", () => {
  it.each(["polling", "timeout", "badResponse"] as const)(
    "rows with dashes while %s waits for data",
    (state) => {
      const view = deriveDataView(input({ state, status: "loading", definition: poll }));
      expect(view.rowCount).toBe(10);
      expect(view.loading).toBe(true);
      expect(view.chip).toEqual({ kind: "loading", text: "Waiting for first response…" });
      expect(view.emptyText).toBeNull();
    },
  );

  it("paused before the first value shows a plain Paused chip", () => {
    const view = deriveDataView(input({ state: "paused", status: "loading", definition: poll }));
    expect(view.chip).toEqual({ kind: "stale", text: "Paused" });
    expect(view.rowCount).toBe(10);
  });
});

describe("live", () => {
  it("shows the update time", () => {
    const view = deriveDataView(withData({ state: "polling" }));
    expect(view.chip).toMatchObject({ kind: "live", text: "Updated 14:02:11.540" });
    expect(view.chip?.title).toMatch(/^2026-10-12T14:02:11\.540[+-]\d\d:\d\d$/);
    expect(view.stale).toBe(false);
    expect(view.loading).toBe(false);
    expect(view.rowCount).toBe(10);
  });
});

describe("stale chips", () => {
  it.each([
    ["paused", "Paused - values from 14:02:11.540"],
    ["timeout", "No response - values from 14:02:11.540"],
    ["exception", "Exception - values from 14:02:11.540"],
    ["badResponse", "Bad response - values from 14:02:11.540"],
    ["disconnected", "Disconnected - values from 14:02:11.540"],
  ] as const)("%s", (state, text) => {
    const view = deriveDataView(withData({ state, status: "stale", exceptionCode: 2 }));
    expect(view.chip).toMatchObject({ kind: "stale", text });
    expect(view.stale).toBe(true);
    expect(view.rowCount).toBe(10);
    expect(view.emptyText).toBeNull();
  });

  it("uses the quantity of the definition the values belong to", () => {
    const view = deriveDataView(
      withData({
        state: "paused",
        status: "stale",
        definition: { ...poll, quantity: 3 },
        poll: { ...poll, quantity: 50 },
      }),
    );
    expect(view.rowCount).toBe(3);
    expect(view.header).toContain("(3)");
  });
});
