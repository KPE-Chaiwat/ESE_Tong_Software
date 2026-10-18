import { describe, expect, it } from "vitest";
import type { ScaleOverride } from "@/shared/ipc/modbus-master.types";
import { validate } from "../validation/schemas";
import { overrideExampleText } from "./scale-example";
import { presetDefaults } from "./scale-presets";
import {
  formFromSettings,
  numberText,
  overrideRangesMessage,
  overrideSchema,
  parseNumberText,
  type ScaleErrors,
  type ScaleForm,
  sanitizedSettings,
  scaleSchema,
  validateScaleForm,
} from "./scale-validation";

/** A form of a preset with some texts changed. */
function form(preset: ScaleForm["preset"], patch: Partial<ScaleForm> = {}): ScaleForm {
  return { ...formFromSettings(presetDefaults(preset), false), ...patch };
}

function errorsOf(f: ScaleForm): ScaleErrors {
  const result = validateScaleForm(f);
  return result.ok ? {} : result.errors;
}

describe("raw min and raw max (DES-003 4)", () => {
  it.each([
    ["-1", false, "Raw min must be a whole number from 0 to 65535."],
    ["0", false, undefined],
    ["65535", false, undefined],
    ["65536", false, "Raw min must be a whole number from 0 to 65535."],
    ["-32769", true, "Raw min must be a whole number from -32768 to 32767."],
    ["-32768", true, undefined],
    ["32767", true, undefined],
    ["32768", true, "Raw min must be a whole number from -32768 to 32767."],
    ["1.5", false, "Raw min must be a whole number from 0 to 65535."],
    ["abc", false, "Raw min must be a whole number from 0 to 65535."],
    ["", false, "Raw min must be a whole number from 0 to 65535."],
    [" 12 ", false, undefined],
  ])("raw min %j (signed %s)", (text, signed, message) => {
    const f = form("linear", { xMin: text, xMax: "30000", rawSigned: signed });
    expect(errorsOf(f).xMin).toBe(message);
  });

  it.each([
    ["65536", false, "Raw max must be a whole number from 0 to 65535."],
    ["65535", false, undefined],
    ["32768", true, "Raw max must be a whole number from -32768 to 32767."],
    ["-1", false, "Raw max must be a whole number from 0 to 65535."],
  ])("raw max %j (signed %s)", (text, signed, message) => {
    const f = form("linear", { xMin: signed ? "-5" : "5", xMax: text, rawSigned: signed });
    expect(errorsOf(f).xMax).toBe(message);
  });

  it("equal min and max: the message is under Raw max", () => {
    const errors = errorsOf(form("current4to20", { xMin: "100", xMax: "100" }));
    expect(errors).toEqual({ xMax: "Raw min and raw max must be different." });
  });

  it("equal is not reported while one of them is invalid", () => {
    const errors = errorsOf(form("current4to20", { xMin: "70000", xMax: "70000" }));
    expect(errors.xMin).toBe("Raw min must be a whole number from 0 to 65535.");
    expect(errors.xMax).toBe("Raw max must be a whole number from 0 to 65535.");
  });

  it("a reversed raw range is valid", () => {
    expect(errorsOf(form("linear", { xMin: "1000", xMax: "0" }))).toEqual({});
  });
});

describe("engineering min and max", () => {
  it.each([
    ["4", undefined],
    ["-12.5", undefined],
    ["0", undefined],
    ["999999999999999", undefined],
    ["1000000000000000", "Engineering min must be a number, for example 4 or -12.5."],
    ["0.123456789012345", undefined],
    ["0.1234567890123456", "Engineering min must be a number, for example 4 or -12.5."],
    ["abc", "Engineering min must be a number, for example 4 or -12.5."],
    ["1e3", "Engineering min must be a number, for example 4 or -12.5."],
    ["", "Engineering min must be a number, for example 4 or -12.5."],
    [".5", "Engineering min must be a number, for example 4 or -12.5."],
    ["5.", "Engineering min must be a number, for example 4 or -12.5."],
    ["+5", "Engineering min must be a number, for example 4 or -12.5."],
    ["4,5", "Use a dot as the decimal separator."],
  ])("eng. min %j", (text, message) => {
    expect(errorsOf(form("linear", { yMin: text, yMax: "20" })).yMin).toBe(message);
  });

  it.each([
    ["1e3", "Engineering max must be a number, for example 20 or 100.5."],
    ["x", "Engineering max must be a number, for example 20 or 100.5."],
    ["4,5", "Use a dot as the decimal separator."],
    ["100.5", undefined],
  ])("eng. max %j", (text, message) => {
    expect(errorsOf(form("linear", { yMin: "0", yMax: text })).yMax).toBe(message);
  });

  it("equal min and max: the message is under Eng. max", () => {
    expect(errorsOf(form("linear", { yMin: "5", yMax: "5.0" }))).toEqual({
      yMax: "Engineering min and max must be different.",
    });
  });

  it("a reversed engineering range is valid", () => {
    expect(errorsOf(form("linear", { yMin: "100", yMax: "0" }))).toEqual({});
  });

  it("the fixed presets do not validate the engineering fields", () => {
    expect(errorsOf(form("current4to20", { yMin: "junk", yMax: "junk" }))).toEqual({});
  });
});

describe("divisor, decimals, unit", () => {
  const divide = (patch: Partial<ScaleForm>) => form("divide", patch);

  it.each([
    ["0", "Divisor must be a number other than 0."],
    ["-0", "Divisor must be a number other than 0."],
    ["0.0", "Divisor must be a number other than 0."],
    ["abc", "Divisor must be a number other than 0."],
    ["", "Divisor must be a number other than 0."],
    ["-2.5", undefined],
    ["4", undefined],
    ["0.001", undefined],
  ])("custom divisor %j", (text, message) => {
    expect(errorsOf(divide({ divisorMode: "custom", divisor: text })).divisor).toBe(message);
  });

  it("the 10, 100 and 1000 buttons are never invalid whatever the divisor text says", () => {
    expect(errorsOf(divide({ divisorMode: "100", divisor: "zzz" }))).toEqual({});
  });

  it.each([
    ["0", undefined],
    ["6", undefined],
    ["7", "Decimals must be a whole number from 0 to 6."],
    ["-1", "Decimals must be a whole number from 0 to 6."],
    ["1.5", "Decimals must be a whole number from 0 to 6."],
    ["", "Decimals must be a whole number from 0 to 6."],
  ])("decimals %j", (text, message) => {
    expect(errorsOf(divide({ decimals: text })).decimals).toBe(message);
  });

  it("unit: 12 characters pass, 13 do not", () => {
    expect(errorsOf(divide({ unit: "x".repeat(12) })).unit).toBeUndefined();
    expect(errorsOf(divide({ unit: "x".repeat(13) })).unit).toBe(
      "Unit must be at most 12 characters.",
    );
  });

  it("unit: counts characters, not UTF-16 units", () => {
    expect(errorsOf(divide({ unit: "°C" })).unit).toBeUndefined();
    expect(errorsOf(divide({ unit: "😀".repeat(12) })).unit).toBeUndefined();
  });

  it("unit: a tab or another control character is refused", () => {
    expect(errorsOf(divide({ unit: `a${String.fromCharCode(9)}b` })).unit).toBe(
      "Unit cannot contain control characters.",
    );
    expect(errorsOf(divide({ unit: String.fromCharCode(0x7f) })).unit).toBe(
      "Unit cannot contain control characters.",
    );
  });
});

describe("scaleSchema and settings", () => {
  it("None gives null (the poll then has no scale) and needs no valid field", () => {
    const f = form("none", { xMin: "junk", unit: "x".repeat(40) });
    expect(validate(scaleSchema(false), f)).toEqual({ ok: true, value: null });
  });

  it("a valid 4-20 mA form gives the settings of the preset with the typed raw range", () => {
    const f = form("current4to20", { xMin: "4000", xMax: "20000" });
    expect(validateScaleForm(f)).toEqual({
      ok: true,
      settings: { ...presetDefaults("current4to20"), xMin: 4000, xMax: 20000 },
    });
  });

  it("a valid custom linear form uses the typed numbers", () => {
    const f = form("linear", { yMin: "-12.5", yMax: "100", decimals: "3", unit: "%" });
    expect(validateScaleForm(f)).toMatchObject({
      ok: true,
      settings: { preset: "linear", yMin: -12.5, yMax: 100, decimals: 3, unit: "%" },
    });
  });

  it("Divide takes the divisor of the button or the custom text", () => {
    expect(validateScaleForm(form("divide", { divisorMode: "100" }))).toMatchObject({
      settings: { divisor: 100 },
    });
    expect(
      validateScaleForm(form("divide", { divisorMode: "custom", divisor: "-2.5" })),
    ).toMatchObject({ settings: { divisor: -2.5 } });
  });

  it("negative zero is stored as zero", () => {
    const result = validateScaleForm(form("linear", { xMin: "-0", xMax: "10", yMin: "-0" }));
    expect(result.ok && Object.is(result.settings?.xMin, 0)).toBe(true);
    expect(result.ok && Object.is(result.settings?.yMin, 0)).toBe(true);
  });

  it("inactive fields with bad text still give settings Rust accepts", () => {
    const settings = sanitizedSettings(
      form("divide", { xMin: "junk", yMin: "junk", xMax: "99999" }),
    );
    expect(settings).toMatchObject({ xMin: 0, xMax: 65535, yMin: 0, yMax: 100 });
  });

  it("formFromSettings: None starts raw signed when asked, with a range that signed allows", () => {
    expect(formFromSettings(null, true)).toMatchObject({
      preset: "none",
      rawSigned: true,
      xMin: "0",
      xMax: "32767",
    });
    expect(formFromSettings(null, false)).toMatchObject({ rawSigned: false, xMax: "65535" });
  });

  it("formFromSettings writes numbers without exponents and finds the divisor button", () => {
    const f = formFromSettings(
      { ...presetDefaults("divide"), divisor: 1000, yMin: 0.0000001, yMax: 1e21 },
      false,
    );
    expect(f).toMatchObject({
      divisorMode: "1000",
      yMin: "0.0000001",
      yMax: "1000000000000000000000",
    });
    expect(formFromSettings({ ...presetDefaults("divide"), divisor: 4 }, false).divisorMode).toBe(
      "custom",
    );
  });

  it("numberText copes with a hand-edited profile that misses a number", () => {
    expect(numberText(undefined as unknown as number)).toBe("");
    expect(numberText(Number.NaN)).toBe("");
  });

  it("parseNumberText counts significant digits, not leading zeros", () => {
    expect(parseNumberText("0.000000000000001")).toBe(1e-15);
    expect(parseNumberText(" 7 ")).toBe(7);
    expect(parseNumberText("-0")).toBe(-0);
    expect(parseNumberText("123456789012345.5")).toBeNull();
  });
});

describe("overrides (DES-003 3.2, 4)", () => {
  const override = (start: number, end: number): ScaleOverride => ({
    start,
    end,
    scale: presetDefaults("divide"),
  });
  const run = (
    start: string,
    end: string,
    existing: ScaleOverride[] = [],
    base: 0 | 1 = 0,
    editing?: number | null,
  ) => validate(overrideSchema(base, existing, editing), { start, end });

  it("converts the display base to protocol addresses", () => {
    expect(run("1", "4", [], 1)).toEqual({ ok: true, value: { start: 0, end: 3 } });
    expect(run("0", "3")).toEqual({ ok: true, value: { start: 0, end: 3 } });
  });

  it("start and end follow the display base range", () => {
    expect(run("0", "3", [], 1)).toMatchObject({
      ok: false,
      errors: { start: "Start address must be a whole number from 1 to 65536." },
    });
    expect(run("65536", "65536", [], 0)).toMatchObject({
      ok: false,
      errors: {
        start: "Start address must be a whole number from 0 to 65535.",
        end: "End address must be a whole number from 0 to 65535.",
      },
    });
    expect(run("65536", "65536", [], 1)).toEqual({ ok: true, value: { start: 65535, end: 65535 } });
    expect(run("x", "3")).toMatchObject({ errors: { start: expect.stringContaining("Start") } });
  });

  it("end before start", () => {
    expect(run("5", "3")).toMatchObject({
      ok: false,
      errors: { end: "End address must not be before the start address." },
    });
  });

  it("overlap names the other override in the display base", () => {
    expect(run("5", "9", [override(8, 12)])).toMatchObject({
      ok: false,
      errors: { range: "This range overlaps the override for 8-12." },
    });
    expect(run("6", "10", [override(7, 11)], 1)).toMatchObject({
      errors: { range: "This range overlaps the override for 8-12." },
    });
    // touching is not overlapping
    expect(run("5", "7", [override(8, 12)]).ok).toBe(true);
  });

  it("editing an override leaves it out of the overlap check", () => {
    expect(run("8", "12", [override(8, 12)], 0, 0).ok).toBe(true);
    expect(run("8", "12", [override(8, 12)], 0, null).ok).toBe(false);
  });

  it("the 65th override is refused, the 64th is fine", () => {
    const many = Array.from({ length: 64 }, (_, i) => override(i * 2, i * 2));
    expect(run("1000", "1000", many.slice(0, 63)).ok).toBe(true);
    expect(run("1000", "1000", many)).toMatchObject({
      ok: false,
      errors: { range: "A poll can have at most 64 scale overrides." },
    });
    // replacing one of the 64 is fine
    expect(run("1000", "1000", many, 0, 5).ok).toBe(true);
  });

  it("several new ranges count together against the limit", () => {
    const sixtyTwo = Array.from({ length: 62 }, (_, i) => override(i * 2, i * 2));
    expect(
      overrideRangesMessage(
        [
          { start: 500, end: 500 },
          { start: 502, end: 502 },
        ],
        sixtyTwo,
        0,
      ),
    ).toBeNull();
    expect(
      overrideRangesMessage(
        [
          { start: 500, end: 500 },
          { start: 502, end: 502 },
          { start: 504, end: 504 },
        ],
        sixtyTwo,
        0,
      ),
    ).toBe("A poll can have at most 64 scale overrides.");
  });
});

describe("the S8 example line (DES-003 3.2)", () => {
  const divideTemperature = form("divide", { unit: "°C" });

  it("shows what the draft makes of the raw value", () => {
    expect(overrideExampleText(divideTemperature, 253)).toBe(
      "Example: raw 253 shows 25.3 °C. Overrides win over the poll scale.",
    );
  });

  it("uses 1000 when there is no value", () => {
    expect(overrideExampleText(divideTemperature, undefined)).toBe(
      "Example: raw 1000 shows 100.0 °C. Overrides win over the poll scale.",
    );
  });

  it("leaves out the unit when there is none", () => {
    expect(overrideExampleText(form("divide"), 253)).toBe(
      "Example: raw 253 shows 25.3. Overrides win over the poll scale.",
    );
  });

  it("an invalid draft gives only the reminder", () => {
    expect(overrideExampleText(form("divide", { divisorMode: "custom", divisor: "0" }), 253)).toBe(
      "Overrides win over the poll scale.",
    );
  });
});
