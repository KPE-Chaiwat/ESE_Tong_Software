import { describe, expect, it } from "vitest";
import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
import {
  COMPARISONS,
  colorContrast,
  matchRule,
  parseThreshold,
  validateRules,
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
