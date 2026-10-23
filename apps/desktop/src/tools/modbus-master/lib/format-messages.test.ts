import { describe, expect, it } from "vitest";
import {
  appliedAnnouncement,
  applyFailedMessage,
  cutMessages,
  cutRangeInfo,
  INSPECTOR_SCALE_NOTE,
  limitCutLines,
  MIXED_NOTE,
  outsidePollNote,
  quickCutToast,
  ruleConflictMessage,
  scaleCombinedNote,
  tooManyMessage,
} from "./format-messages";
import type { Cut } from "./format-overrides";

const r = (start: number, end = start) => ({ start, end });
describe("limitCutLines (M-C, DES-010 8)", () => {
  it("keeps up to four lines as they are", () => {
    expect(limitCutLines([])).toEqual([]);
    expect(limitCutLines(["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });
  it("shows four lines and counts the rest", () => {
    expect(limitCutLines(["a", "b", "c", "d", "e"])).toEqual([
      "a",
      "b",
      "c",
      "d",
      "… and 1 more split value.",
    ]);
    expect(limitCutLines(["a", "b", "c", "d", "e", "f", "g"]).slice(4)).toEqual([
      "… and 3 more split values.",
    ]);
  });
});

describe("tooManyMessage (M-T)", () => {
  it("states the count", () => {
    expect(tooManyMessage(257)).toBe(
      "A poll can have at most 256 format overrides. This change would create 257. Select fewer separate blocks.",
    );
  });
});

describe("cutMessages (M-C1, M-C2)", () => {
  const inside: Cut = {
    cut: r(3),
    group: r(2, 3),
    format: "float32",
    outsidePoll: [],
  };
  it("M-C1 when the cut registers are in the poll", () => {
    expect(cutMessages([inside], 0)).toEqual([
      "Also resets 3 to Unsigned: this change splits the Float 32-bit value 2-3.",
    ]);
    expect(cutMessages([inside], 1)).toEqual([
      "Also resets 4 to Unsigned: this change splits the Float 32-bit value 3-4.",
    ]);
  });
  it("M-C2 with is/are, one line per group", () => {
    const one: Cut = { cut: r(100), group: r(100, 101), format: "float32", outsidePoll: [r(100)] };
    const two: Cut = {
      cut: r(98, 99),
      group: r(98, 101),
      format: "float64",
      outsidePoll: [r(98, 99)],
    };
    expect(cutMessages([one, two], 0)).toEqual([
      "Also resets 100 to Unsigned: this change splits the Float 32-bit value 100-101. 100 is outside this poll.",
      "Also resets 98-99 to Unsigned: this change splits the Float 64-bit (Double) value 98-101. 98-99 are outside this poll.",
    ]);
  });
  it("P41 merges the cuts of one group into one line", () => {
    const a: Cut = { cut: r(0), group: r(0, 3), format: "unsigned64", outsidePoll: [] };
    const b: Cut = { cut: r(3), group: r(0, 3), format: "unsigned64", outsidePoll: [] };
    expect(cutMessages([a, b], 0)).toEqual([
      "Also resets 0, 3 to Unsigned: this change splits the Unsigned 64-bit value 0-3.",
    ]);
    expect(cutMessages([a, b], 1)).toEqual([
      "Also resets 1, 4 to Unsigned: this change splits the Unsigned 64-bit value 1-4.",
    ]);
  });
  it("P52 joins the outside ranges of one group and says are", () => {
    const a: Cut = { cut: r(100), group: r(100, 103), format: "unsigned64", outsidePoll: [r(100)] };
    const b: Cut = { cut: r(103), group: r(100, 103), format: "unsigned64", outsidePoll: [r(103)] };
    expect(cutMessages([a, b], 0)).toEqual([
      "Also resets 100, 103 to Unsigned: this change splits the Unsigned 64-bit value 100-103. 100, 103 are outside this poll.",
    ]);
  });
  it("keeps separate groups on separate lines", () => {
    const g1: Cut = { cut: r(1), group: r(0, 1), format: "float32", outsidePoll: [] };
    const g2: Cut = { cut: r(4), group: r(4, 5), format: "float32", outsidePoll: [] };
    expect(cutMessages([g1, g2], 0)).toHaveLength(2);
  });
  it("is empty without cuts", () => {
    expect(cutMessages([], 0)).toEqual([]);
  });
});

describe("rule, failure and unchanged texts", () => {
  it("M-R and M-F", () => {
    expect(
      ruleConflictMessage("Flow", "Enter a whole decimal number for a 64-bit integer comparison."),
    ).toBe(
      'Format not applied. Rule "Flow": Enter a whole decimal number for a 64-bit integer comparison.',
    );
    expect(applyFailedMessage("Boom.")).toBe("Could not apply the format. Boom.");
    expect(applyFailedMessage(null)).toBe("Could not apply the format. Try again.");
    expect(applyFailedMessage("")).toBe("Could not apply the format. Try again.");
  });
  it("M-F passes the backend's own Format not applied text through (DES-009 11.8)", () => {
    const text =
      'Format not applied. Rule "High" requires whole-number thresholds for 64-bit integers.';
    expect(applyFailedMessage(text)).toBe(text);
    expect(applyFailedMessage("Rejected view")).toBe("Could not apply the format. Rejected view");
    expect(applyFailedMessage("Interpretation not applied. x")).toBe(
      "Could not apply the format. Interpretation not applied. x",
    );
  });
  it("the mixed note says the applied format replaces all of them", () => {
    expect(MIXED_NOTE).toBe(
      "The selected rows use different formats. The format you apply replaces all of them.",
    );
  });
});

describe("announcements and toasts", () => {
  it("announces the applied format", () => {
    expect(appliedAnnouncement("hex", "big", [r(2, 3)], 0)).toBe("Format applied: Hex to 2-3.");
    expect(appliedAnnouncement("float32", "little", [r(2, 5)], 1)).toBe(
      "Format applied: Float 32-bit, Little-endian (DCBA) to 3-6.",
    );
  });
  it("the quick-format toast lists the reset registers", () => {
    const cut: Cut = { cut: r(100), group: r(100, 101), format: "float32", outsidePoll: [r(100)] };
    expect(quickCutToast("unsigned", [r(101)], [cut], 0)).toBe(
      "Unsigned applied to 101. Also reset 100 to Unsigned because a combined value was split.",
    );
    expect(quickCutToast("hex", [r(101)], [cut], 1)).toBe(
      "Hex applied to 102. Also reset 101 to Unsigned because a combined value was split.",
    );
  });
});

describe("cutRangeInfo (P1 line)", () => {
  const one = [{ group: r(100, 101), format: "float32" as const }];
  it("names the first group and counts the others", () => {
    expect(cutRangeInfo([], 0)).toBeNull();
    expect(cutRangeInfo(one, 0)).toBe(
      "This range cuts the Float 32-bit value 100-101; it will show as Incomplete.",
    );
    expect(cutRangeInfo(one, 1)).toBe(
      "This range cuts the Float 32-bit value 101-102; it will show as Incomplete.",
    );
    expect(cutRangeInfo([...one, { group: r(104, 105), format: "float32" }], 0)).toBe(
      "This range cuts the Float 32-bit value 100-101; it will show as Incomplete. 1 more value is cut.",
    );
    expect(
      cutRangeInfo(
        [
          ...one,
          { group: r(104, 105), format: "float32" },
          { group: r(108, 111), format: "float64" },
        ],
        0,
      ),
    ).toBe(
      "This range cuts the Float 32-bit value 100-101; it will show as Incomplete. 2 more values are cut.",
    );
  });
});

describe("scale and inspector notes", () => {
  it("scaleCombinedNote singular and plural", () => {
    expect(scaleCombinedNote(1)).toBe(
      "Scaling applies to 16-bit rows. 1 combined value in this poll is not scaled.",
    );
    expect(scaleCombinedNote(2)).toBe(
      "Scaling applies to 16-bit rows. 2 combined values in this poll are not scaled.",
    );
    expect(scaleCombinedNote(3)).toBe(
      "Scaling applies to 16-bit rows. 3 combined values in this poll are not scaled.",
    );
  });
  it("outsidePollNote singular, plural and none, base 0 and 1", () => {
    expect(outsidePollNote([], 0)).toBeNull();
    expect(outsidePollNote([r(100)], 0)).toBe("Register 100 of this value is outside this poll.");
    expect(outsidePollNote([r(100)], 1)).toBe("Register 101 of this value is outside this poll.");
    expect(outsidePollNote([r(104, 105)], 0)).toBe(
      "Registers 104-105 of this value are outside this poll.",
    );
    expect(outsidePollNote([r(98), r(104)], 0)).toBe(
      "Registers 98, 104 of this value are outside this poll.",
    );
  });
  it("the inspector scale note", () => {
    expect(INSPECTOR_SCALE_NOTE).toBe(
      "Saved scales apply again when these registers use a 16-bit format.",
    );
  });
});
