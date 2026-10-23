import { describe, expect, it } from "vitest";
import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
import type { FormatOverride } from "@/shared/ipc/modbus-master.types";
import {
  COMPARISONS,
  colorContrast,
  firstRuleConflict,
  formatsMetBy,
  matchRule,
  parseThreshold,
  validateRules,
  validateRulesForOverrides,
} from "./color-rules";

const rule = (patch: Partial<ValueColorRule> = {}): ValueColorRule => ({
  name: "High",
  enabled: true,
  range: null,
  source: "displayed",
  comparison: "greaterThan",
  threshold: "25",
  upperThreshold: null,
  highlight: "lime",
  ...patch,
});
const input = {
  address: 0,
  raw: 253,
  scaled: 25.3,
  displayed: 25.3,
  column: "Scaled" as const,
  current: true,
  format: "unsigned",
};
describe("value color rules", () => {
  it("validates custom color syntax and reports low contrast without blocking", () => {
    expect(
      validateRules(
        [rule({ colors: { background: "#17324D", foreground: "#FFFFFF" } })],
        "unsigned",
      ),
    ).toEqual({});
    expect(
      validateRules(
        [rule({ colors: { background: "#123456", foreground: "#123456" } })],
        "unsigned",
      ),
    ).toEqual({});
    expect(colorContrast("#123456", "#123456")).toBe(1);
    expect(colorContrast("red", "#FFFFFF")).toBeNull();
    expect(
      validateRules([rule({ colors: { background: "red", foreground: "#FFFFFF" } })], "unsigned"),
    ).toHaveProperty("colorRules[0].colors.background", "Choose a six-digit background color.");
  });
  it("implements every boundary including inclusive Between", () => {
    const expected = [
      [false, true, false],
      [true, false, true],
      [true, false, false],
      [true, true, false],
      [false, false, true],
      [false, true, true],
      [false, true, true],
    ];
    Object.keys(COMPARISONS)
      .filter((comparison) => comparison !== "always")
      .forEach((comparison, index) => {
        expect(
          [24, 25, 26].map(
            (displayed) =>
              !!matchRule(
                [
                  rule({
                    comparison: comparison as ValueColorRule["comparison"],
                    upperThreshold: comparison === "between" ? "26" : null,
                  }),
                ],
                { ...input, displayed },
              ),
          ),
        ).toEqual(expected[index]);
      });
    expect(
      matchRule([rule({ comparison: "between", upperThreshold: "25" })], {
        ...input,
        displayed: 25,
      }),
    ).not.toBeNull();
  });
  it("applies a static color only to its selected register", () => {
    const selected = rule({
      comparison: "always",
      threshold: "",
      range: { start: 11, end: 11 },
      colors: { background: "#337bd6", foreground: "#a33300" },
    });
    expect(validateRules([selected], "unsigned")).toEqual({});
    expect(matchRule([selected], { ...input, address: 10 })).toBeNull();
    expect(matchRule([selected], { ...input, address: 11 })).not.toBeNull();
    expect(matchRule([selected], { ...input, address: 12 })).toBeNull();
    expect(
      matchRule([{ ...selected, source: "scaled" }], { ...input, address: 11, scaled: null }),
    ).not.toBeNull();
    expect(matchRule([selected], { ...input, address: 11, displayed: null })).toBeNull();
    const twenty = Array.from({ length: 20 }, (_, address) => ({
      ...selected,
      range: { start: address + 11, end: address + 11 },
    }));
    expect(validateRules(twenty, "unsigned")).toEqual({});
    expect(matchRule(twenty, { ...input, address: 30 })).not.toBeNull();
    expect(
      validateRules(
        Array.from({ length: 257 }, () => selected),
        "unsigned",
      ),
    ).toHaveProperty("colorRules", "A poll can have at most 256 value color rules.");
  });
  it("uses visible numeric source and stable explicit overrides before rounding", () => {
    expect(matchRule([rule()], input)).not.toBeNull();
    expect(matchRule([rule({ threshold: "250" })], input)).toBeNull();
    expect(matchRule([rule({ source: "raw", threshold: "250" })], input)).not.toBeNull();
    expect(
      matchRule([rule({ source: "scaled", threshold: "25.2" })], {
        ...input,
        displayed: 253,
        column: "Raw",
      }),
    ).not.toBeNull();
    expect(matchRule([rule({ source: "raw" })], { ...input, displayed: null })).toBeNull();
  });
  it("matches exact integer64 boundaries without converting to Number", () => {
    const r = rule({ threshold: "9007199254740993", comparison: "equals" });
    const i = {
      ...input,
      format: "unsigned64",
      raw: 9007199254740993n,
      displayed: 9007199254740993n,
      column: "Interpreted" as const,
    };
    expect(matchRule([r], i)).not.toBeNull();
    expect(matchRule([r], { ...i, displayed: 9007199254740992n })).toBeNull();
    expect(
      matchRule([rule({ threshold: "18446744073709551615", comparison: "equals" })], {
        ...i,
        displayed: 18446744073709551615n,
      }),
    ).not.toBeNull();
  });
  it("excludes stale, missing and nonfinite even for Not equals", () => {
    const r = rule({ comparison: "notEquals" });
    for (const displayed of [null, NaN, Infinity, -Infinity])
      expect(matchRule([r], { ...input, displayed })).toBeNull();
    expect(matchRule([r], { ...input, current: false })).toBeNull();
    expect(
      matchRule([rule({ source: "scaled", comparison: "notEquals" })], { ...input, scaled: null }),
    ).toBeNull();
  });
  it("uses first enabled eligible rule and first-register address", () => {
    const first = rule({ name: "First", enabled: false });
    const second = rule({ name: "Second" });
    expect(matchRule([first, second], input)?.rule.name).toBe("Second");
    expect(matchRule([rule({ range: { start: 1, end: 2 } }), second], input)?.rule.name).toBe(
      "Second",
    );
    expect(matchRule([rule({ range: { start: 0, end: 0 } }), second], input)?.rule.name).toBe(
      "High",
    );
  });
  it("validates decimal grammar, overflow, underflow and exact bounded integers", () => {
    for (const text of ["-12.5", ".5", "1.", "+1e3", "0e-999"])
      expect(parseThreshold(text, false)).toHaveProperty("value");
    for (const text of ["1e999", "1e-999", "NaN", "1,5", "0x10", "", "1_000"])
      expect(parseThreshold(text, false)).toHaveProperty("error");
    for (const text of [
      "9007199254740993",
      "-9223372036854775808",
      "18446744073709551615",
      "-18446744073709551615",
    ])
      expect(parseThreshold(text, true)).toEqual({ value: BigInt(text) });
    for (const text of ["1.0", "1e3", "18446744073709551616", "-18446744073709551616"])
      expect(parseThreshold(text, true)).toHaveProperty("error");
    expect(parseThreshold("1".repeat(257), false)).toEqual({
      error: "Enter a threshold with at most 256 characters.",
    });
  });
  it("validates disabled entries, all ranges, names, count and exact Between ordering", () => {
    expect(validateRules([rule({ enabled: false, threshold: "1.0" })], "signed64")).toHaveProperty(
      "colorRules[0].threshold",
    );
    expect(
      validateRules(
        [
          rule({
            comparison: "between",
            threshold: "9007199254740993",
            upperThreshold: "9007199254740992",
          }),
        ],
        "signed64",
      ),
    ).toHaveProperty("colorRules[0].upperThreshold");
    expect(validateRules([rule({ range: { start: 65535, end: 65535 } })], "unsigned")).toEqual({});
    for (const patch of [
      { name: " " },
      { name: "a\n" },
      { name: "a".repeat(65) },
      { range: { start: 2, end: 1 } },
      { range: { start: -1, end: 0 } },
    ])
      expect(Object.keys(validateRules([rule(patch)], "unsigned"))).not.toHaveLength(0);
    expect(
      validateRules(
        Array.from({ length: 257 }, () => rule()),
        "unsigned",
      ),
    ).toHaveProperty("colorRules");
  });
});

const u64 = (start: number, end: number): FormatOverride => ({
  start,
  end,
  format: "unsigned64",
  swapBytes: false,
  reverseWords: false,
});
const s64 = (start: number, end: number): FormatOverride => ({
  ...u64(start, end),
  format: "signed64",
});
const MAX64 = "18446744073709551615";

describe("formatsMetBy", () => {
  it("includes the default only where an address is uncovered", () => {
    expect(formatsMetBy({ start: 0, end: 3 }, [u64(0, 3)])).toEqual(["unsigned64"]);
    expect(formatsMetBy({ start: 0, end: 4 }, [u64(0, 3)])).toEqual(["unsigned", "unsigned64"]);
    expect(formatsMetBy({ start: 4, end: 9 }, [u64(0, 3)])).toEqual(["unsigned"]);
    expect(formatsMetBy(null, [])).toEqual(["unsigned"]);
    expect(formatsMetBy(null, [s64(10, 13)])).toEqual(["unsigned", "signed64"]);
    expect(formatsMetBy({ start: 5, end: 6 }, [u64(0, 3), s64(10, 13)])).toEqual(["unsigned"]);
    expect(formatsMetBy({ start: 0, end: 13 }, [u64(0, 3), s64(4, 13)])).toEqual([
      "unsigned64",
      "signed64",
    ]);
  });
});

describe("validateRulesForOverrides (DES-009 7.3, vectors R1-R8)", () => {
  const raw = (patch: Partial<ValueColorRule>) => rule({ source: "raw", ...patch });
  it("R1 a 64-bit integer threshold on a range of only Unsigned64 rows", () => {
    const r = raw({
      range: { start: 0, end: 3 },
      comparison: "equals",
      threshold: MAX64,
    });
    expect(validateRulesForOverrides([r], [u64(0, 3)])).toEqual({});
  });
  it("R2 a range that also meets the default is validated under both", () => {
    const r = raw({ range: { start: 0, end: 4 }, comparison: "equals", threshold: MAX64 });
    expect(validateRulesForOverrides([r], [u64(0, 3)])).toEqual({});
  });
  it("R3 a decimal threshold on an Unsigned64 range is refused", () => {
    const r = raw({ range: { start: 0, end: 3 }, threshold: "1.5" });
    expect(validateRulesForOverrides([r], [u64(0, 3)])).toEqual({
      "colorRules[0].threshold": "Enter a whole decimal number for a 64-bit integer comparison.",
    });
  });
  it("R4 no range and no overrides behaves like the old Unsigned path", () => {
    expect(validateRulesForOverrides([rule({ threshold: "1.5" })], [])).toEqual({});
    expect(validateRulesForOverrides([rule({ threshold: "abc" })], [])).toEqual(
      validateRules([rule({ threshold: "abc" })], "unsigned"),
    );
  });
  it("R5 a rule without a range meets every override", () => {
    const errors = validateRulesForOverrides([raw({ threshold: "1.5" })], [s64(10, 13)]);
    expect(Object.keys(errors)).toEqual(["colorRules[0].threshold"]);
  });
  it("R6 a rule that does not touch the override is not checked against it", () => {
    const r = raw({ range: { start: 20, end: 30 }, threshold: "1.5" });
    expect(validateRulesForOverrides([r], [s64(10, 13)])).toEqual({});
  });
  it("R7 integer mode applies to non-Scaled sources only", () => {
    const r = rule({
      source: "scaled",
      range: { start: 0, end: 3 },
      threshold: "1.5",
    });
    expect(validateRulesForOverrides([r], [u64(0, 3)])).toEqual({});
  });
  it("R8 disabled rules are validated too", () => {
    const r = raw({ enabled: false, range: { start: 0, end: 3 }, threshold: "1.5" });
    expect(Object.keys(validateRulesForOverrides([r], [u64(0, 3)]))).toEqual([
      "colorRules[0].threshold",
    ]);
  });
  it("keeps the index of the failing rule and the first message of a field", () => {
    const rules = [rule(), raw({ range: { start: 0, end: 3 }, threshold: "x" })];
    const errors = validateRulesForOverrides(rules, [u64(0, 3)]);
    expect(errors).toEqual({
      "colorRules[1].threshold": "Enter a whole decimal number for a 64-bit integer comparison.",
    });
    // Both Unsigned (decimal) and Unsigned64 (integer) are met: the first format's message wins.
    const both = raw({ range: { start: 0, end: 4 }, threshold: "x" });
    expect(validateRulesForOverrides([both], [u64(0, 3)])["colorRules[0].threshold"]).toBe(
      "Enter a finite decimal number, for example -12.5 or 1e3.",
    );
  });
  it("reports other rule errors once and the rule limit", () => {
    expect(Object.keys(validateRulesForOverrides([rule({ name: " " })], [u64(0, 3)]))).toEqual([
      "colorRules[0].name",
    ]);
    expect(
      validateRulesForOverrides(
        Array.from({ length: 257 }, () => rule()),
        [],
      ),
    ).toHaveProperty("colorRules");
  });
  it("firstRuleConflict names the rule and its message", () => {
    const rules = [rule({ name: "Fine" }), raw({ name: "Flow", threshold: "1.5" })];
    expect(firstRuleConflict(rules, [s64(0, 3)])).toEqual({
      name: "Flow",
      message: "Enter a whole decimal number for a 64-bit integer comparison.",
    });
    expect(firstRuleConflict(rules, [])).toBeNull();
  });
});
