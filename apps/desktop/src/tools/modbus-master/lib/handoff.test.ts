import { type PollViewHandoffV1, parseHandoff, serializeHandoff } from "./handoff";

const handoff = (patch: Partial<PollViewHandoffV1> = {}): PollViewHandoffV1 => ({
  version: 1,
  setupOpen: true,
  setupOverride: false,
  selection: [{ start: 3, end: 5 }],
  anchorAddress: 3,
  focusAddress: 5,
  topAddress: 2,
  columnWidths: { alias: 160, address: 120, format: 96, raw: 160, scaled: 160 },
  pollDraft: {
    name: "Tank",
    slaveId: "1",
    function: "3",
    startAddress: "0",
    quantity: "200",
    scanRateMs: "1000",
    dirty: ["quantity"],
    errors: { quantity: "Quantity for FC03 must be from 1 to 125." },
  },
  scaleDraft: { dirty: true, fields: { xMin: "0", xMax: "abc", errors: { xMax: "bad" } } },
  ...patch,
});

describe("PollViewHandoffV1", () => {
  it("round trips through JSON, including invalid field text and its message", () => {
    const original = handoff();
    expect(parseHandoff(serializeHandoff(original))).toEqual(original);
  });

  it("accepts null drafts", () => {
    const original = handoff({ pollDraft: null, scaleDraft: null, selection: [] });
    expect(parseHandoff(serializeHandoff(original))).toEqual(original);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty text", ""],
    ["text that is not JSON", "not json"],
    ["JSON of another shape", '{"hello":1}'],
    ["a number", "42"],
    ["null JSON", "null"],
  ])("ignores %s without throwing", (_name, input) => {
    expect(parseHandoff(input)).toBeNull();
  });

  it("ignores another version", () => {
    expect(parseHandoff(JSON.stringify({ ...handoff(), version: 2 }))).toBeNull();
  });

  it("ignores a wrong field type", () => {
    expect(parseHandoff(JSON.stringify({ ...handoff(), topAddress: "2" }))).toBeNull();
    expect(
      parseHandoff(JSON.stringify({ ...handoff(), selection: [{ start: "a", end: 1 }] })),
    ).toBeNull();
    expect(
      parseHandoff(JSON.stringify({ ...handoff(), pollDraft: { name: "x", dirty: ["bogus"] } })),
    ).toBeNull();
  });

  it("accepts a handoff without the Format column width and ignores the removed keys", () => {
    const old = {
      ...handoff(),
      columnWidths: { alias: 160, address: 120, raw: 160, scaled: 160 },
      groupWidth: 2,
      interpretationDraft: {
        format: "float32",
        swapBytes: false,
        reverseWords: false,
        error: null,
      },
    };
    const parsed = parseHandoff(JSON.stringify(old));
    expect(parsed).not.toBeNull();
    expect(parsed?.columnWidths.format).toBeUndefined();
    expect(parsed).not.toHaveProperty("groupWidth");
    expect(parsed).not.toHaveProperty("interpretationDraft");
  });
});
