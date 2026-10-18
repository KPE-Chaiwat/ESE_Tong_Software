import { describe, expect, it } from "vitest";
import type { ScaleSettings } from "@/shared/ipc/modbus-master.types";
import {
  defaultRawRange,
  divisorChoiceOf,
  divisorDecimals,
  hasFixedEngineeringRange,
  overrideMarkerText,
  presetDefaults,
  RAW_QUICK_PICKS,
  rangeLabel,
  rawLimits,
  SCALE_PRESET_LABELS,
  scaleSummary,
  withDivisor,
} from "./scale-presets";

describe("presetDefaults (DES-003 2)", () => {
  it("4-20 mA: Y 4 to 20, unit mA, 2 decimals, raw 0-65535, flag", () => {
    expect(presetDefaults("current4to20")).toEqual({
      preset: "current4to20",
      rawSigned: false,
      xMin: 0,
      xMax: 65535,
      yMin: 4,
      yMax: 20,
      divisor: 10,
      decimals: 2,
      unit: "mA",
      outOfRange: "flag",
    });
  });

  it("0-10 V: Y 0 to 10, unit V, 2 decimals", () => {
    expect(presetDefaults("voltage0to10")).toMatchObject({
      yMin: 0,
      yMax: 10,
      unit: "V",
      decimals: 2,
      xMax: 65535,
    });
  });

  it("Divide: 1 decimal for 10, no unit; Custom linear: 2 decimals, Y 0 to 100", () => {
    expect(presetDefaults("divide")).toMatchObject({ divisor: 10, decimals: 1, unit: "" });
    expect(presetDefaults("linear")).toMatchObject({ yMin: 0, yMax: 100, decimals: 2, unit: "" });
  });

  it("keeps the raw range, signedness and out-of-range choice when the preset changes, and resets unit and decimals", () => {
    const current: ScaleSettings = {
      ...presetDefaults("current4to20"),
      xMin: 4000,
      xMax: 20000,
      rawSigned: false,
      outOfRange: "clamp",
      unit: "A",
      decimals: 5,
    };
    const next = presetDefaults("voltage0to10", current);
    expect(next).toMatchObject({
      xMin: 4000,
      xMax: 20000,
      outOfRange: "clamp",
      unit: "V",
      decimals: 2,
    });
    expect(presetDefaults("divide", current)).toMatchObject({
      xMin: 4000,
      xMax: 20000,
      unit: "",
      decimals: 1,
    });
  });

  it("Custom linear starts from the engineering range of the 4-20 mA preset it replaces", () => {
    const next = presetDefaults("linear", presetDefaults("current4to20"));
    expect(next).toMatchObject({ yMin: 4, yMax: 20, unit: "", decimals: 2 });
    // ...but not from a Divide scale
    expect(presetDefaults("linear", presetDefaults("divide"))).toMatchObject({
      yMin: 0,
      yMax: 100,
    });
  });

  it("raw limits and default ranges follow the signedness", () => {
    expect(rawLimits(true)).toEqual({ min: -32768, max: 32767 });
    expect(rawLimits(false)).toEqual({ min: 0, max: 65535 });
    expect(defaultRawRange(false)).toEqual({ xMin: 0, xMax: 65535 });
    // A signed scale cannot start with raw max 65535.
    expect(defaultRawRange(true)).toEqual({ xMin: 0, xMax: 32767 });
  });

  it("knows which presets have a fixed engineering range", () => {
    expect(hasFixedEngineeringRange("current4to20")).toBe(true);
    expect(hasFixedEngineeringRange("voltage0to10")).toBe(true);
    expect(hasFixedEngineeringRange("linear")).toBe(false);
    expect(hasFixedEngineeringRange("divide")).toBe(false);
  });

  it("lists the select labels and quick picks of the design", () => {
    expect(Object.values(SCALE_PRESET_LABELS)).toEqual([
      "None (raw)",
      "4-20 mA",
      "0-10 V",
      "Divide",
      "Custom linear",
    ]);
    expect(RAW_QUICK_PICKS.map((p) => p.label)).toEqual([
      "0-4095",
      "0-27648",
      "0-32767",
      "0-65535",
      "4000-20000",
    ]);
    expect(RAW_QUICK_PICKS.find((p) => p.label === "4000-20000")).toMatchObject({
      xMin: 4000,
      xMax: 20000,
    });
  });
});

describe("divisor choices", () => {
  it("decimals: 10 gives 1, 100 gives 2, 1000 gives 3, custom 2", () => {
    expect(divisorDecimals(10)).toBe(1);
    expect(divisorDecimals(100)).toBe(2);
    expect(divisorDecimals(1000)).toBe(3);
    expect(divisorDecimals("custom")).toBe(2);
  });

  it("maps a divisor to its button", () => {
    expect(divisorChoiceOf(10)).toBe(10);
    expect(divisorChoiceOf(1000)).toBe(1000);
    expect(divisorChoiceOf(4)).toBe("custom");
    expect(divisorChoiceOf(-10)).toBe("custom");
  });

  it("withDivisor sets the divisor and the decimals of the choice", () => {
    expect(withDivisor(presetDefaults("divide"), 100)).toMatchObject({ divisor: 100, decimals: 2 });
    expect(withDivisor({ ...presetDefaults("divide"), divisor: 7 }, "custom")).toMatchObject({
      divisor: 7,
      decimals: 2,
    });
  });
});

describe("scaleSummary (DES-003 3.1)", () => {
  const base = presetDefaults("current4to20");
  it.each([
    [null, false, "Raw (no scale)"],
    [presetDefaults("none"), true, "Raw (no scale)"],
    [base, false, "4-20 mA (raw 0-65535)"],
    [{ ...base, xMin: 4000, xMax: 20000 }, false, "4-20 mA (raw 4000-20000)"],
    [presetDefaults("voltage0to10"), false, "0-10 V (raw 0-65535)"],
    [presetDefaults("divide"), false, "Divide by 10"],
    [{ ...presetDefaults("divide"), divisor: 2.5 }, false, "Divide by 2.5"],
    [
      { ...presetDefaults("linear"), xMin: 4000, xMax: 20000, yMin: 0, yMax: 100 },
      false,
      "Linear 4000-20000 to 0-100",
    ],
  ] as const)("short form of %j is %s", (scale, full, expected) => {
    expect(scaleSummary(scale as ScaleSettings | null, full)).toBe(expected);
  });

  it("never prints an exponent (REV-007 n-2)", () => {
    expect(scaleSummary({ ...presetDefaults("divide"), divisor: 1e-7 }, false)).toBe(
      "Divide by 0.0000001",
    );
    expect(
      scaleSummary({ ...presetDefaults("linear"), xMin: 0, xMax: 10, yMin: 0, yMax: 5e-7 }, false),
    ).toBe("Linear 0-10 to 0-0.0000005");
    expect(scaleSummary({ ...presetDefaults("divide"), divisor: 1e21 }, false)).toBe(
      "Divide by 1000000000000000000000",
    );
    expect(
      overrideMarkerText(
        { start: 0, end: 1, scale: { ...presetDefaults("divide"), divisor: 1e-7 } },
        0,
      ),
    ).toBe("Scale override 0-1: Divide by 0.0000001, 1 dp");
  });

  it("the full form appends decimals, unit and signed", () => {
    expect(scaleSummary(base, true)).toBe("4-20 mA (raw 0-65535), 2 dp, mA");
    expect(scaleSummary({ ...presetDefaults("divide"), unit: "°C" }, true)).toBe(
      "Divide by 10, 1 dp, °C",
    );
    expect(scaleSummary(presetDefaults("divide"), true)).toBe("Divide by 10, 1 dp");
    expect(scaleSummary({ ...presetDefaults("divide"), rawSigned: true, decimals: 0 }, true)).toBe(
      "Divide by 10, 0 dp, signed",
    );
  });
});

describe("override texts", () => {
  it("writes ranges in the display base", () => {
    expect(rangeLabel(0, 1, 0)).toBe("0-1");
    expect(rangeLabel(0, 1, 1)).toBe("1-2");
    expect(rangeLabel(5, 5, 0)).toBe("5");
  });

  it("marker text: Scale override {start}-{end}: {summary}", () => {
    expect(overrideMarkerText({ start: 0, end: 1, scale: presetDefaults("divide") }, 0)).toBe(
      "Scale override 0-1: Divide by 10, 1 dp",
    );
    expect(overrideMarkerText({ start: 0, end: 1, scale: presetDefaults("divide") }, 1)).toBe(
      "Scale override 1-2: Divide by 10, 1 dp",
    );
  });
});
