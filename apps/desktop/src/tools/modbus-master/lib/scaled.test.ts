import { describe, expect, it } from "vitest";
import type { PollConfig, ScaleOverride, ScaleSettings } from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "./scale-presets";
import {
  createScaled,
  createScaledFactory,
  effectiveValueColumns,
  hasAnyScale,
  NO_SCALE,
  scaleActive,
  scaleAvailable,
} from "./scaled";

type Config = Pick<PollConfig, "scale" | "scaleOverrides" | "definition" | "display">;

function config(patch: Partial<Config> = {}): Config {
  return {
    scale: null,
    scaleOverrides: [],
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
    display: {
      format: "unsigned",
      addressBase: 0,
      showAlias: true,
      copyAlias: false,
      swapBytes: false,
      reverseWords: false,
    },
    ...patch,
  };
}

const mA = presetDefaults("current4to20");
const divide = (divisor: number, patch: Partial<ScaleSettings> = {}): ScaleSettings => ({
  ...presetDefaults("divide"),
  divisor,
  ...patch,
});

describe("hasAnyScale, scaleActive and scaleAvailable", () => {
  it("a scale, a None scale and overrides", () => {
    expect(hasAnyScale(config())).toBe(false);
    expect(hasAnyScale(config({ scale: presetDefaults("none") }))).toBe(false);
    expect(hasAnyScale(config({ scale: mA }))).toBe(true);
    expect(hasAnyScale(config({ scaleOverrides: [{ start: 0, end: 0, scale: mA }] }))).toBe(true);
  });

  it("coils and discrete inputs ignore a scale", () => {
    const fc1 = config({
      scale: mA,
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
    });
    expect(scaleActive(fc1)).toBe(false);
    expect(scaleAvailable(fc1)).toBe(false);
    expect(createScaled(fc1)).toBe(NO_SCALE);
    expect(scaleAvailable(config({ scale: mA }))).toBe(true);
  });
});

describe("createScaled", () => {
  it("without any scale it is the shared no-scale provider", () => {
    expect(createScaled(config())).toBe(NO_SCALE);
    expect(createScaled(config({ scale: presetDefaults("none") }))).toBe(NO_SCALE);
    expect(createScaled(config())(5, 0)).toBeNull();
  });

  it("an in-range value: text, unit, no marker, accessible name with the unit", () => {
    const cell = createScaled(config({ scale: mA }))(0, 0);
    expect(cell).toEqual({
      text: "4.00",
      numeric: 4,
      unit: "mA",
      marker: "none",
      tooltip: null,
      label: "4.00 mA",
      override: null,
    });
  });

  it("a flagged value has the out-of-range marker, tooltip and name", () => {
    const flagged: ScaleSettings = { ...presetDefaults("voltage0to10"), xMax: 4095 };
    const cell = createScaled(config({ scale: flagged }))(5000, 0);
    expect(cell).toMatchObject({
      text: "12.21",
      unit: "V",
      marker: "outOfRange",
      tooltip: "Raw 5000 is outside the raw range 0-4095.",
      label: "12.21 V, out of range",
    });
  });

  it("a clamped value has the arrow marker, tooltip and name, below and above", () => {
    const clamped: ScaleSettings = {
      ...presetDefaults("voltage0to10"),
      xMax: 4095,
      outOfRange: "clamp",
    };
    const provider = createScaled(config({ scale: clamped }));
    expect(provider(5000, 0)).toMatchObject({
      text: "10.00",
      marker: "clamped-high",
      tooltip: "Raw 5000 is outside the raw range 0-4095; shown clamped.",
      label: "10.00 V, clamped",
    });
    const low = createScaled(
      config({ scale: { ...mA, xMin: 4000, xMax: 20000, outOfRange: "clamp" } }),
    )(100, 0);
    expect(low).toMatchObject({ text: "4.00", marker: "clamped-low" });
  });

  it("a value without a unit has a name without a trailing space", () => {
    expect(createScaled(config({ scale: divide(10) }))(253, 0)?.label).toBe("25.3");
  });

  it("a signed raw value shows its signed number in the tooltip", () => {
    const signed = { ...presetDefaults("linear"), rawSigned: true, xMin: 0, xMax: 100 };
    expect(createScaled(config({ scale: signed }))(65531, 0)).toMatchObject({
      marker: "outOfRange",
      tooltip: "Raw -5 is outside the raw range 0-100.",
    });
  });

  describe("overrides", () => {
    const o1: ScaleOverride = { start: 0, end: 3, scale: divide(10, { unit: "°C" }) };
    const o2: ScaleOverride = {
      start: 8,
      end: 9,
      scale: divide(100, { decimals: 2, unit: "bar" }),
    };

    it("the override wins and the poll scale applies elsewhere (D8)", () => {
      const provider = createScaled(config({ scaleOverrides: [o1, o2] }));
      expect(provider(253, 0)).toMatchObject({ text: "25.3", unit: "°C" });
      expect(provider(1234, 8)).toMatchObject({ text: "12.34", unit: "bar" });
      // Poll scale None: a row outside the overrides has no scale.
      expect(provider(7, 5)).toBeNull();
      // With a poll scale, the rest of the rows use it.
      const withPoll = createScaled(config({ scale: mA, scaleOverrides: [o1] }));
      expect(withPoll(0, 0)).toMatchObject({ text: "0.0", unit: "°C" });
      expect(withPoll(0, 4)).toMatchObject({ text: "4.00", unit: "mA" });
    });

    it("the marker text and title come from the summary, in the display base", () => {
      const cell = createScaled(config({ scaleOverrides: [o1] }))(1, 2);
      expect(cell?.override).toEqual({ tooltip: "Scale override 0-3: Divide by 10, 1 dp, °C" });
      const based = createScaled(
        config({
          scaleOverrides: [o1],
          display: {
            format: "unsigned",
            addressBase: 1,
            showAlias: true,
            copyAlias: false,
            swapBytes: false,
            reverseWords: false,
          },
        }),
      )(1, 2);
      expect(based?.override?.tooltip).toBe("Scale override 1-4: Divide by 10, 1 dp, °C");
    });

    it("the marker is known without a value (loading rows show it too)", () => {
      const provider = createScaled(config({ scaleOverrides: [o1] }));
      expect(provider.override?.(2)).toEqual({
        tooltip: "Scale override 0-3: Divide by 10, 1 dp, °C",
      });
      expect(provider.override?.(4)).toBeNull();
    });

    it("an override whose scale is None gives no value and no marker", () => {
      const provider = createScaled(
        config({
          scale: mA,
          scaleOverrides: [{ start: 0, end: 0, scale: presetDefaults("none") }],
        }),
      );
      expect(provider(5, 0)).toBeNull();
      expect(provider.override?.(0)).toBeNull();
      // a row of the poll scale next to it is untouched
      expect(provider(5, 1)?.override).toBeNull();
    });
  });

  it("computes a row once per raw value", () => {
    const provider = createScaled(config({ scale: mA }));
    const first = provider(100, 3);
    expect(provider(100, 3)).toBe(first);
    expect(provider(101, 3)).not.toBe(first);
    expect(provider(100, 4)).not.toBe(first);
  });
});

describe("createScaledFactory", () => {
  it("returns the same provider while the scale, overrides, base and function do not change", () => {
    const factory = createScaledFactory();
    const a = config({ scale: mA });
    const provider = factory(a as PollConfig);
    // a new object with equal settings (an alias edit sends a new config)
    const again = config({ scale: { ...mA } });
    expect(factory(again as PollConfig)).toBe(provider);
  });

  it("builds a new provider when a setting changes", () => {
    const factory = createScaledFactory();
    const provider = factory(config({ scale: mA }) as PollConfig);
    expect(factory(config({ scale: { ...mA, decimals: 3 } }) as PollConfig)).not.toBe(provider);
    const p2 = factory(config({ scale: mA }) as PollConfig);
    expect(
      factory(
        config({
          scale: mA,
          display: {
            format: "unsigned",
            addressBase: 1,
            showAlias: true,
            copyAlias: false,
            swapBytes: false,
            reverseWords: false,
          },
        }) as PollConfig,
      ),
    ).not.toBe(p2);
    const p3 = factory(config({ scale: mA }) as PollConfig);
    expect(
      factory(
        config({ scale: mA, scaleOverrides: [{ start: 0, end: 0, scale: mA }] }) as PollConfig,
      ),
    ).not.toBe(p3);
  });
});

describe("effectiveValueColumns (REV-007 m-3)", () => {
  const withColumns = (columns: PollConfig["valueColumns"], patch: Partial<Config> = {}) => ({
    ...config(patch),
    valueColumns: columns,
  });

  it.each(["raw", "scaled", "both"] as const)("%s without any scale is Raw", (columns) => {
    expect(effectiveValueColumns(withColumns(columns))).toBe("raw");
    expect(effectiveValueColumns(withColumns(columns, { scale: presetDefaults("none") }))).toBe(
      "raw",
    );
  });

  it("follows the setting while there is a poll scale or an override", () => {
    expect(effectiveValueColumns(withColumns("scaled", { scale: mA }))).toBe("scaled");
    expect(effectiveValueColumns(withColumns("both", { scale: mA }))).toBe("both");
    const override: ScaleOverride = { start: 0, end: 1, scale: divide(10) };
    expect(effectiveValueColumns(withColumns("scaled", { scaleOverrides: [override] }))).toBe(
      "scaled",
    );
  });

  it("is Raw for a coil or discrete poll whatever is stored", () => {
    const bits = {
      scale: mA,
      definition: {
        slaveId: 1,
        function: 2 as const,
        startAddress: 0,
        quantity: 8,
        scanRateMs: 100,
      },
    };
    expect(effectiveValueColumns(withColumns("both", bits))).toBe("raw");
  });
});
