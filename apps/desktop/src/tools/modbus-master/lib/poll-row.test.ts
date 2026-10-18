import { pollMeta, pollRowCopyText, pollRowLabel, pollRowTooltip } from "./poll-row";

const def = { slaveId: 1, function: 3 as const, startAddress: 0, quantity: 10, scanRateMs: 100 };

describe("sidebar poll row texts (DES-002 2.2.3)", () => {
  it("the meta line is slave, FC and range in the display base", () => {
    expect(pollMeta(def, 0)).toBe("1 · FC03 · 0-9");
    expect(pollMeta(def, 1)).toBe("1 · FC03 · 1-10");
    expect(pollMeta({ ...def, function: 1, slaveId: 5, startAddress: 100, quantity: 32 }, 0)).toBe(
      "5 · FC01 · 100-131",
    );
  });

  it("the tooltip has every part, with a dash for no update yet", () => {
    expect(
      pollRowTooltip({ name: "Tank 1", definition: def, base: 0, lastOkAt: null, errors: 0 }),
    ).toBe("Tank 1 · Slave 1 · FC03 · 0-9 (10) · 100 ms · Last update — · Errors 0");
  });

  it("the tooltip shows the last update time and the errors", () => {
    const at = new Date(2026, 9, 12, 14, 2, 11, 532).getTime();
    expect(
      pollRowTooltip({ name: "Pump 2", definition: def, base: 0, lastOkAt: at, errors: 12 }),
    ).toBe("Pump 2 · Slave 1 · FC03 · 0-9 (10) · 100 ms · Last update 14:02:11.532 · Errors 12");
  });

  it("the accessible name has the name, the full pill label and the marker or 'in workspace'", () => {
    expect(pollRowLabel("Pump 2", "Timeout", null)).toBe("Pump 2, Timeout, in workspace");
    expect(pollRowLabel("Valves", "Exception 02", "minimized")).toBe(
      "Valves, Exception 02, minimized",
    );
  });
});

describe("Ctrl+C on a row (DES-002 3.2)", () => {
  it("is name, slave, FC, range, scan rate and the state label, tab separated", () => {
    expect(
      pollRowCopyText({ name: "Tank 1", definition: def, base: 0, pillLabel: "Polling" }),
    ).toBe("Tank 1\t1\tFC03\t0-9\t100 ms\tPolling");
  });

  it("the range is in the display base", () => {
    expect(
      pollRowCopyText({
        name: "Pump 2",
        definition: { ...def, slaveId: 5, function: 1, startAddress: 100, quantity: 32 },
        base: 1,
        pillLabel: "Exception 02",
      }),
    ).toBe("Pump 2\t5\tFC01\t101-132\t100 ms\tException 02");
  });
});
