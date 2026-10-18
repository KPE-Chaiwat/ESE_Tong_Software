import {
  ALL_POLLS_FILTER,
  filterEntries,
  filterKey,
  filterLabel,
  frameMatchesFilter,
  frameOriginLabel,
  framesToTsv,
  framesToTsvWithPoll,
  sameFilter,
  trafficEmptyText,
} from "./traffic.logic";

const names = { 1: "Poll 1", 2: "Pump 2" };
const TAB = String.fromCharCode(9);

describe("filters", () => {
  it("sameFilter and filterKey", () => {
    expect(sameFilter({ kind: "all" }, { kind: "all" })).toBe(true);
    expect(sameFilter({ kind: "poll", pollId: 1 }, { kind: "poll", pollId: 1 })).toBe(true);
    expect(sameFilter({ kind: "poll", pollId: 1 }, { kind: "poll", pollId: 2 })).toBe(false);
    expect(sameFilter({ kind: "writes" }, { kind: "all" })).toBe(false);
    expect(sameFilter({ kind: "all" }, { kind: "poll", pollId: 1 })).toBe(false);
    expect(filterKey({ kind: "poll", pollId: 7 })).toBe("poll:7");
    expect(filterKey({ kind: "writes" })).toBe("writes");
  });

  it("frameMatchesFilter", () => {
    const poll1 = { origin: { kind: "poll", pollId: 1 } } as const;
    const write1 = { origin: { kind: "write", pollId: 1 } } as const;
    expect(frameMatchesFilter(poll1, ALL_POLLS_FILTER)).toBe(true);
    expect(frameMatchesFilter(write1, ALL_POLLS_FILTER)).toBe(true);
    expect(frameMatchesFilter(poll1, { kind: "writes" })).toBe(false);
    expect(frameMatchesFilter(write1, { kind: "writes" })).toBe(true);
    expect(frameMatchesFilter(poll1, { kind: "poll", pollId: 1 })).toBe(true);
    expect(frameMatchesFilter(poll1, { kind: "poll", pollId: 2 })).toBe(false);
    expect(frameMatchesFilter(write1, { kind: "poll", pollId: 1 })).toBe(false);
  });

  it("a frame without an origin (late, discarded or unsolicited bytes) shows only under All polls", () => {
    expect(frameMatchesFilter({ origin: null }, ALL_POLLS_FILTER)).toBe(true);
    expect(frameMatchesFilter({ origin: null }, { kind: "writes" })).toBe(false);
    expect(frameMatchesFilter({ origin: null }, { kind: "poll", pollId: 1 })).toBe(false);
    expect(frameOriginLabel(null, names)).toBe("");
  });

  it("filterEntries and filterLabel", () => {
    expect(filterEntries([2, 1], names).map((e) => e.label)).toEqual([
      "All polls",
      "Writes",
      "Pump 2",
      "Poll 1",
    ]);
    expect(filterEntries([5], {})[2]?.label).toBe("Poll 5");
    expect(filterLabel({ kind: "all" }, names)).toBe("All polls");
    expect(filterLabel({ kind: "writes" }, names)).toBe("Writes");
    expect(filterLabel({ kind: "poll", pollId: 2 }, names)).toBe("Pump 2");
  });
});

describe("the Poll column", () => {
  it("names the poll, or 'Write: {poll}', or 'Write'", () => {
    expect(frameOriginLabel({ kind: "poll", pollId: 2 }, names)).toBe("Pump 2");
    expect(frameOriginLabel({ kind: "write", pollId: 2 }, names)).toBe("Write: Pump 2");
    expect(frameOriginLabel({ kind: "write", pollId: null }, names)).toBe("Write");
    expect(frameOriginLabel({ kind: "poll", pollId: 9 }, names)).toBe("Poll 9");
  });
});

describe("trafficEmptyText", () => {
  it("per filter", () => {
    expect(trafficEmptyText({ kind: "all" }, names, null)).toBe(
      "No frames yet. Requests and responses appear here.",
    );
    expect(trafficEmptyText({ kind: "poll", pollId: 1 }, names, null)).toBe(
      "No frames for Poll 1 yet.",
    );
    expect(trafficEmptyText({ kind: "writes" }, names, null)).toBe("No frames for Writes yet.");
  });
  it("after Clear, under All polls", () => {
    const at = new Date(2026, 0, 1, 14, 2, 11, 540).getTime();
    expect(trafficEmptyText({ kind: "all" }, names, at)).toBe(
      "Log cleared at 14:02:11.540. New frames appear here.",
    );
  });
});

describe("framesToTsv with the Poll column", () => {
  const at = new Date(2026, 0, 1, 14, 2, 11, 540).getTime();
  const base = {
    at,
    direction: "tx",
    bytes: [0, 1, 0xab],
    slaveId: 1,
    function: 3,
    exceptionCode: null,
    note: null,
  } as const;

  it("adds the poll as the last column", () => {
    const line = framesToTsvWithPoll([{ ...base, origin: { kind: "poll", pollId: 2 } }], names);
    expect(line).toBe(["14:02:11.540", "TX", "00 01 AB", "FC03 slave 1", "Pump 2"].join(TAB));
  });

  it("one line per frame, a write names its poll", () => {
    const out = framesToTsvWithPoll(
      [
        { ...base, origin: { kind: "poll", pollId: 1 } },
        { ...base, direction: "rx", origin: { kind: "write", pollId: 2 } },
      ],
      names,
    );
    const lines = out.split(String.fromCharCode(10));
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith(`${TAB}Write: Pump 2`)).toBe(true);
    expect(lines[1]?.split(TAB)[1]).toBe("RX");
  });

  it("the old format without the poll is unchanged", () => {
    expect(framesToTsv([base])).toBe(["14:02:11.540", "TX", "00 01 AB", "FC03 slave 1"].join(TAB));
  });
});
