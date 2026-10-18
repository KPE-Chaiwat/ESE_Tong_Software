import { describe, expect, it } from "vitest";
import type { ScaleOverride, ScaleSettings } from "@/shared/ipc/modbus-master.types";
import {
  effectiveScale,
  formatRatio,
  formatScaled,
  plainNumber,
  rawToX,
  scaleKey,
  scaleText,
  scaleValue,
  TOO_LARGE,
} from "./scale-math";
import { presetDefaults } from "./scale-presets";
import { createScaled, type ScaledMarker } from "./scaled";

/** Settings of a preset with a few changes, the way the editor builds them. */
function make(preset: ScaleSettings["preset"], patch: Partial<ScaleSettings> = {}): ScaleSettings {
  return { ...presetDefaults(preset), ...patch };
}

const mA = (patch: Partial<ScaleSettings> = {}) => make("current4to20", patch);
const volt = (patch: Partial<ScaleSettings> = {}) => make("voltage0to10", patch);
const divide = (divisor: number, decimals: number, patch: Partial<ScaleSettings> = {}) =>
  make("divide", { divisor, decimals, ...patch });
const linear = (patch: Partial<ScaleSettings>) => make("linear", patch);

type Marker = ScaledMarker;

interface Example {
  id: string;
  scale: ScaleSettings;
  raw: number;
  text: string;
  marker: Marker;
  tooltip?: string;
  label?: string;
}

// CHK-003 section A: every worked example, exactly (the expected text is the exact cell text).
const EXAMPLES: Example[] = [
  { id: "A1", scale: mA(), raw: 0, text: "4.00", marker: "none" },
  { id: "A2", scale: mA(), raw: 65535, text: "20.00", marker: "none" },
  { id: "A3", scale: mA(), raw: 32768, text: "12.00", marker: "none" },
  { id: "A4", scale: mA(), raw: 16384, text: "8.00", marker: "none" },
  { id: "A5", scale: mA({ decimals: 4 }), raw: 32768, text: "12.0001", marker: "none" },
  { id: "A6", scale: mA({ xMin: 4000, xMax: 20000 }), raw: 12000, text: "12.00", marker: "none" },
  {
    id: "A7",
    scale: mA({ xMin: 4000, xMax: 20000 }),
    raw: 0,
    text: "0.00",
    marker: "outOfRange",
    tooltip: "Raw 0 is outside the raw range 4000-20000.",
  },
  {
    id: "A8",
    scale: mA({ xMin: 4000, xMax: 20000, outOfRange: "clamp" }),
    raw: 0,
    text: "4.00",
    marker: "clamped-low",
    label: "4.00 mA, clamped",
  },
  {
    id: "A9",
    scale: mA({ xMin: 4000, xMax: 20000 }),
    raw: 3000,
    text: "3.00",
    marker: "outOfRange",
  },
  { id: "A10", scale: volt({ xMax: 4095 }), raw: 2048, text: "5.00", marker: "none" },
  { id: "A11", scale: volt({ xMax: 4095 }), raw: 4095, text: "10.00", marker: "none" },
  {
    id: "A12",
    scale: volt({ xMax: 4095 }),
    raw: 5000,
    text: "12.21",
    marker: "outOfRange",
    label: "12.21 V, out of range",
  },
  {
    id: "A13",
    scale: volt({ xMax: 4095, outOfRange: "clamp" }),
    raw: 5000,
    text: "10.00",
    marker: "clamped-high",
    label: "10.00 V, clamped",
  },
  { id: "A14", scale: volt({ xMax: 27648 }), raw: 13824, text: "5.00", marker: "none" },
  { id: "A15", scale: volt({ xMax: 27648 }), raw: 32767, text: "11.85", marker: "outOfRange" },
  { id: "A16", scale: divide(10, 1), raw: 253, text: "25.3", marker: "none" },
  { id: "A17", scale: divide(10, 1), raw: 65535, text: "6553.5", marker: "none" },
  {
    id: "A18",
    scale: divide(10, 1, { rawSigned: true }),
    raw: 65535,
    text: "-0.1",
    marker: "none",
  },
  { id: "A19", scale: divide(100, 2), raw: 1234, text: "12.34", marker: "none" },
  {
    id: "A20",
    scale: divide(100, 2, { rawSigned: true }),
    raw: 65436,
    text: "-1.00",
    marker: "none",
  },
  { id: "A21", scale: divide(1000, 3), raw: 1, text: "0.001", marker: "none" },
  { id: "A22", scale: divide(1000, 3), raw: 65535, text: "65.535", marker: "none" },
  { id: "A23", scale: divide(10, 0), raw: 25, text: "3", marker: "none" },
  { id: "A24", scale: divide(10, 0), raw: 35, text: "4", marker: "none" },
  { id: "A25", scale: divide(10, 0), raw: 24, text: "2", marker: "none" },
  { id: "A26", scale: divide(10, 0, { rawSigned: true }), raw: 65511, text: "-3", marker: "none" },
  { id: "A27", scale: divide(10, 0, { rawSigned: true }), raw: 65532, text: "0", marker: "none" },
  { id: "A28", scale: divide(4, 2), raw: 10, text: "2.50", marker: "none" },
  { id: "A29", scale: divide(-2, 2), raw: 10, text: "-5.00", marker: "none" },
  {
    id: "A30",
    scale: linear({ xMin: 4000, xMax: 20000, yMin: 0, yMax: 100, unit: "%", decimals: 1 }),
    raw: 12000,
    text: "50.0",
    marker: "none",
  },
  {
    id: "A31",
    scale: linear({ xMin: 4000, xMax: 20000, yMin: 0, yMax: 100, unit: "%", decimals: 1 }),
    raw: 3000,
    text: "-6.3",
    marker: "outOfRange",
  },
  {
    id: "A32",
    scale: linear({
      xMin: 4000,
      xMax: 20000,
      yMin: 0,
      yMax: 100,
      unit: "%",
      decimals: 1,
      outOfRange: "clamp",
    }),
    raw: 3000,
    text: "0.0",
    marker: "clamped-low",
  },
  {
    id: "A33",
    scale: linear({ xMin: 4000, xMax: 20000, yMin: 0, yMax: 100, unit: "%", decimals: 1 }),
    raw: 24000,
    text: "125.0",
    marker: "outOfRange",
  },
  {
    id: "A34",
    scale: linear({ xMin: 0, xMax: 1000, yMin: 100, yMax: 0 }),
    raw: 250,
    text: "75.00",
    marker: "none",
  },
  {
    id: "A35",
    scale: linear({ xMin: 0, xMax: 1000, yMin: 100, yMax: 0 }),
    raw: 1200,
    text: "-20.00",
    marker: "outOfRange",
  },
  {
    id: "A36",
    scale: linear({ xMin: 0, xMax: 1000, yMin: 100, yMax: 0, outOfRange: "clamp" }),
    raw: 1200,
    text: "0.00",
    marker: "clamped-high",
  },
  { id: "A37", scale: volt({ xMax: 1000, decimals: 1 }), raw: 15, text: "0.2", marker: "none" },
  { id: "A38", scale: volt({ xMax: 1000, decimals: 1 }), raw: 5, text: "0.1", marker: "none" },
  { id: "A39", scale: volt({ xMax: 1000, decimals: 1 }), raw: 25, text: "0.3", marker: "none" },
  {
    id: "A40",
    scale: linear({ rawSigned: true, xMin: -32768, xMax: 32767, yMin: -100, yMax: 100 }),
    raw: 32768,
    text: "-100.00",
    marker: "none",
  },
  {
    id: "A41",
    scale: linear({ rawSigned: true, xMin: -32768, xMax: 32767, yMin: -100, yMax: 100 }),
    raw: 32767,
    text: "100.00",
    marker: "none",
  },
  {
    id: "A42",
    scale: linear({ rawSigned: true, xMin: -32768, xMax: 32767, yMin: -100, yMax: 100 }),
    raw: 0,
    text: "0.00",
    marker: "none",
  },
  {
    id: "A43",
    scale: linear({ xMin: 0, xMax: 1, yMin: 0, yMax: 999999999999999 }),
    raw: 2,
    text: "too large",
    marker: "outOfRange",
  },
  // revision 7: the tie rule, the carry and "too large" after rounding (DES-003 1.3)
  { id: "A45", scale: mA({ decimals: 6 }), raw: 717, text: "4.175051", marker: "none" },
  {
    id: "A46",
    scale: linear({ xMin: 0, xMax: 4000, yMin: 0, yMax: 4, decimals: 2 }),
    raw: 2675,
    text: "2.68",
    marker: "none",
  },
  {
    id: "A47",
    scale: linear({ xMin: 0, xMax: 4000, yMin: 0, yMax: -4, decimals: 2 }),
    raw: 2675,
    text: "-2.68",
    marker: "none",
  },
  {
    id: "A48",
    scale: divide(0.4, 0, { rawSigned: true }),
    raw: 65535,
    text: "-3",
    marker: "none",
  },
  {
    id: "A49",
    scale: linear({ xMin: 0, xMax: 10, yMin: 0, yMax: 10000000004, decimals: 0 }),
    raw: 1,
    text: "1000000000",
    marker: "none",
  },
  {
    id: "A50",
    scale: linear({ xMin: 0, xMax: 2, yMin: 999999999999998, yMax: 999999999999999, decimals: 0 }),
    raw: 3,
    text: "too large",
    marker: "outOfRange",
    tooltip: "Raw 3 is outside the raw range 0-2.",
  },
  {
    id: "A51",
    scale: linear({ xMin: 0, xMax: 2, yMin: 999999999999998, yMax: 999999999999999, decimals: 1 }),
    raw: 3,
    text: "999999999999999.5",
    marker: "outOfRange",
  },
  {
    id: "A52",
    scale: linear({ xMin: 0, xMax: 2, yMin: 999999999999998, yMax: 999999999999999, decimals: 0 }),
    raw: 2,
    text: "999999999999999",
    marker: "none",
  },
  {
    id: "A53",
    scale: linear({ xMin: 0, xMax: 1, yMin: 0, yMax: 0.1499999999, decimals: 1 }),
    raw: 1,
    text: "0.2",
    marker: "none",
  },
  {
    id: "A54",
    scale: linear({ xMin: 0, xMax: 1, yMin: 0, yMax: 0.14999999, decimals: 1 }),
    raw: 1,
    text: "0.1",
    marker: "none",
  },
  {
    id: "A55",
    scale: linear({ xMin: 0, xMax: 1000, yMin: 0, yMax: 2, decimals: 2 }),
    raw: 998,
    text: "2.00",
    marker: "none",
  },
];

describe("CHK-003 section A worked examples", () => {
  it("lists A1 to A43 and A45 to A55 (A44 is the simulator run)", () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(
      [
        ...Array.from({ length: 43 }, (_, i) => i + 1),
        ...Array.from({ length: 11 }, (_, i) => i + 45),
      ].map((n) => `A${n}`),
    );
  });

  it.each(EXAMPLES)("$id: raw $raw shows $text ($marker)", (example) => {
    const provider = createScaled({
      scale: example.scale,
      scaleOverrides: [],
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
      display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false },
    });
    const cell = provider(example.raw, 0);
    expect(cell?.text).toBe(example.text);
    expect(cell?.marker).toBe(example.marker);
    if (example.tooltip !== undefined) expect(cell?.tooltip).toBe(example.tooltip);
    if (example.label !== undefined) expect(cell?.label).toBe(example.label);
    // The pure text function agrees with the cell.
    expect(scaleText(example.raw, example.scale)).toBe(example.text);
  });
});

describe("formatScaled", () => {
  it.each([
    [-0.04, 1, "0.0"],
    [0.04, 1, "0.0"],
    [-0.0001, 0, "0"],
    [0.15, 1, "0.2"],
    [0.25, 1, "0.3"],
    [-0.15, 1, "-0.2"],
    [1.005, 2, "1.01"],
    [2.675, 2, "2.68"],
    [0.1 + 0.2, 1, "0.3"],
    [12.3, 2, "12.30"],
    [5, 0, "5"],
    [5, 6, "5.000000"],
    [0.000001, 6, "0.000001"],
    [0.0000004, 6, "0.000000"],
    [-6.25, 1, "-6.3"],
    [6.24, 1, "6.2"],
    [123456.789, 3, "123456.789"],
    [999999999999999, 0, "999999999999999"],
    [1e9, 0, "1000000000"],
    [123456789.5, 0, "123456790"],
  ])("formatScaled(%s, %s) is %s", (y, decimals, expected) => {
    expect(formatScaled(y, decimals)).toBe(expected);
  });

  it("shows 'too large' from 1e15 on, for either sign", () => {
    expect(formatScaled(1e15, 2)).toBe(TOO_LARGE);
    expect(formatScaled(-1e15, 2)).toBe(TOO_LARGE);
    expect(formatScaled(Number.POSITIVE_INFINITY, 2)).toBe(TOO_LARGE);
    expect(formatScaled(Number.NaN, 2)).toBe(TOO_LARGE);
    expect(formatScaled(999999999999999, 2)).toBe("999999999999999.00");
  });

  it("applies the limit to the rounded magnitude (REV-007 n-1)", () => {
    expect(formatScaled(999999999999999.5, 0)).toBe(TOO_LARGE);
    expect(formatScaled(-999999999999999.5, 0)).toBe(TOO_LARGE);
    expect(formatScaled(999999999999999.9, 0)).toBe(TOO_LARGE);
    expect(formatScaled(999999999999999.5, 1)).toBe("999999999999999.5");
    expect(formatScaled(999999999999999.4, 0)).toBe("999999999999999");
    expect(formatScaled(1.996, 2)).toBe("2.00");
    // the exact path already did it (1e15 exactly)
    expect(formatRatio({ numerator: 1e16, denominator: 10 }, 0)).toBe(TOO_LARGE);
  });

  it("never uses exponent notation and never a thousands separator", () => {
    for (const y of [1e-9, 123456789012, 0.00000123, 1234567.891]) {
      expect(formatScaled(y, 6)).toMatch(/^-?\d+(\.\d{6})?$/);
    }
  });

  it("does not turn a large exact value into a tie (the 1e-9 band is capped)", () => {
    // Taken literally the tie band exceeds 0.5 above |s| = 5e8 and 1e9 would show 1000000001.
    expect(formatScaled(1e9, 0)).toBe("1000000000");
    expect(formatScaled(2500000.25, 0)).toBe("2500000");
    expect(formatScaled(2500000.75, 0)).toBe("2500001");
  });
});

describe("formatRatio (exact integer divisors)", () => {
  it.each([
    [25, 10, 0, "3"],
    [-25, 10, 0, "-3"],
    [24, 10, 0, "2"],
    [-24, 10, 0, "-2"],
    [-4, 10, 0, "0"],
    [5, 100, 1, "0.1"],
    [-5, 100, 1, "-0.1"],
    [1, 3, 4, "0.3333"],
    [2, 3, 4, "0.6667"],
    [10, -2, 2, "-5.00"],
    [-10, -2, 2, "5.00"],
    [65535, 7, 6, "9362.142857"],
  ])("%s / %s at %s places is %s", (numerator, denominator, decimals, expected) => {
    expect(formatRatio({ numerator, denominator }, decimals)).toBe(expected);
  });

  it("is exact where the float rule would need its tolerance", () => {
    // 1 / 200000001 at 6 places is 0.000000005 -> rounds to 0.000000; 5 / 1e6 is a true tie.
    expect(formatRatio({ numerator: 1, denominator: 200000001 }, 6)).toBe("0.000000");
    expect(formatRatio({ numerator: 5, denominator: 10000000 }, 6)).toBe("0.000001");
  });
});

describe("scaleValue", () => {
  it("reads the register unsigned or signed", () => {
    expect(rawToX(65535, false)).toBe(65535);
    expect(rawToX(65535, true)).toBe(-1);
    expect(rawToX(32767, true)).toBe(32767);
    expect(rawToX(32768, true)).toBe(-32768);
  });

  it("gives null for None, equal raw ends and a zero divisor", () => {
    expect(scaleValue(5, presetDefaults("none"))).toBeNull();
    expect(scaleValue(5, mA({ xMin: 100, xMax: 100 }))).toBeNull();
    expect(scaleValue(5, divide(0, 2))).toBeNull();
  });

  it("clamps a reversed raw range to the nearest raw end", () => {
    // Raw 1000 -> 0 and raw 0 -> 100, reversed raw ends: 1000-0 maps 1000 to Ymin.
    const reversed = linear({ xMin: 1000, xMax: 0, yMin: 0, yMax: 100, outOfRange: "clamp" });
    expect(scaleValue(1200, reversed)).toMatchObject({ y: 0, outOfRange: "above" });
    expect(scaleValue(0, reversed)?.y).toBe(100);
    // A raw range reversed and an engineering range reversed.
    const both = linear({ xMin: 1000, xMax: 0, yMin: 100, yMax: 0, outOfRange: "clamp" });
    expect(scaleValue(1200, both)).toMatchObject({ y: 100, outOfRange: "above" });
  });

  it("clamps to the exact engineering end, not to a recomputed value", () => {
    const s = linear({ xMin: 0, xMax: 3, yMin: 0.1, yMax: 0.3, outOfRange: "clamp" });
    expect(scaleValue(9, s)?.y).toBe(0.3);
    expect(scaleValue(0, s)?.y).toBe(0.1);
  });

  it("flag mode extrapolates", () => {
    expect(scaleValue(0, mA({ xMin: 4000, xMax: 20000 }))).toMatchObject({
      y: 0,
      outOfRange: "below",
    });
  });
});

describe("effectiveScale", () => {
  const poll = divide(100, 2);
  const o1: ScaleOverride = { start: 0, end: 3, scale: divide(10, 1) };
  const o2: ScaleOverride = { start: 8, end: 9, scale: divide(100, 2, { unit: "bar" }) };

  it("returns the override inside its range and the poll scale outside", () => {
    expect(effectiveScale(0, poll, [o1, o2])).toEqual({ scale: o1.scale, override: o1 });
    expect(effectiveScale(3, poll, [o1, o2]).override).toBe(o1);
    expect(effectiveScale(9, poll, [o1, o2]).override).toBe(o2);
    expect(effectiveScale(4, poll, [o1, o2])).toEqual({ scale: poll, override: null });
    expect(effectiveScale(10, poll, [o1, o2]).scale).toBe(poll);
  });

  it("applies an override although the poll has no scale", () => {
    expect(effectiveScale(1, null, [o1]).scale).toBe(o1.scale);
    expect(effectiveScale(5, null, [o1]).scale).toBeNull();
  });
});

describe("scaleKey and plainNumber", () => {
  it("changes with every field that changes a result", () => {
    const base = mA();
    const keys = new Set([
      scaleKey(base),
      scaleKey({ ...base, xMax: 4095 }),
      scaleKey({ ...base, decimals: 3 }),
      scaleKey({ ...base, unit: "A" }),
      scaleKey({ ...base, outOfRange: "clamp" }),
      scaleKey({ ...base, rawSigned: true }),
    ]);
    expect(keys.size).toBe(6);
    expect(scaleKey(null)).toBe(scaleKey(presetDefaults("none")));
  });

  it("writes numbers without an exponent", () => {
    expect(plainNumber(0.0000001)).toBe("0.0000001");
    expect(plainNumber(12.5)).toBe("12.5");
    expect(plainNumber(-4)).toBe("-4");
  });
});

// ---- property tests (a seeded generator, so a failure repeats) ----
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("properties", () => {
  const random = rng(20261016);
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

  it("a linear scale with increasing ranges never decreases with the raw value", () => {
    for (let i = 0; i < 200; i += 1) {
      const xMin = int(0, 30000);
      const xMax = xMin + int(1, 35000);
      const yMin = int(-1000, 1000) / 4;
      const yMax = yMin + int(1, 2000) / 4;
      for (const mode of ["flag", "clamp"] as const) {
        const s = linear({ xMin, xMax, yMin, yMax, outOfRange: mode, decimals: 3 });
        let previous = Number.NEGATIVE_INFINITY;
        for (let raw = 0; raw <= 65535; raw += 997) {
          const y = scaleValue(raw, s)?.y ?? Number.NaN;
          expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = y;
        }
      }
    }
  });

  it("a reversed engineering range never increases with the raw value", () => {
    for (let i = 0; i < 100; i += 1) {
      const xMin = int(0, 30000);
      const xMax = xMin + int(1, 35000);
      const yMax = int(-1000, 1000) / 4;
      const yMin = yMax + int(1, 2000) / 4;
      const s = linear({ xMin, xMax, yMin, yMax, outOfRange: "clamp" });
      let previous = Number.POSITIVE_INFINITY;
      for (let raw = 0; raw <= 65535; raw += 1009) {
        const y = scaleValue(raw, s)?.y ?? Number.NaN;
        expect(y).toBeLessThanOrEqual(previous + 1e-9);
        previous = y;
      }
    }
  });

  it("the text of a value is within half a unit of the last place of the value", () => {
    for (let i = 0; i < 2000; i += 1) {
      const decimals = int(0, 6);
      const y = (random() - 0.5) * 10 ** int(0, 9);
      const text = formatScaled(y, decimals);
      expect(text).toMatch(decimals === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+\\.\\d{${decimals}}$`));
      const half = 0.5 * 10 ** -decimals;
      // Allow the tie band (the value may sit on the other side of a tie by a hair).
      expect(Math.abs(Number(text) - y)).toBeLessThanOrEqual(half + Math.abs(y) * 1e-12 + 1e-6);
    }
  });

  it("never prints a negative zero", () => {
    for (let i = 0; i < 2000; i += 1) {
      const decimals = int(0, 6);
      const y = (random() - 0.5) * 10 ** -int(0, 8);
      const text = formatScaled(y, decimals);
      if (/^-0(\.0+)?$/.test(text))
        throw new Error(`negative zero for ${y} at ${decimals}: ${text}`);
    }
    for (const raw of [0, 1, 65535, 65534, 65532]) {
      for (const decimals of [0, 1, 2]) {
        const text = scaleText(raw, divide(1000000, decimals, { rawSigned: true }));
        expect(text).not.toMatch(/^-0(\.0+)?$/);
      }
    }
  });

  it("formatScaled is the rule of DES-003 1.3 as written, where the written rule is sound (|s| < 1000)", () => {
    // The literal rule: s = |y| x 10^d; a tie when |s| - floor(|s|) is within 1e-9 x max(1, |s|) of 0.5.
    const literal = (y: number, decimals: number): string => {
      const s = Math.abs(y) * 10 ** decimals;
      const floor = Math.floor(s);
      const tie = Math.abs(s - floor - 0.5) <= 1e-9 * Math.max(1, s);
      const n = tie ? floor + 1 : Math.round(s);
      const digits = String(n).padStart(decimals + 1, "0");
      const text =
        decimals === 0
          ? digits
          : `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`;
      return y < 0 && n !== 0 ? `-${text}` : text;
    };
    for (let i = 0; i < 5000; i += 1) {
      const decimals = int(0, 6);
      const limit = 1000 / 10 ** decimals;
      // a mix of arbitrary values and values built to sit near a tie
      const y =
        i % 2 === 0
          ? (random() - 0.5) * 2 * limit
          : (int(-999, 999) + 0.5) / 10 ** decimals + (random() - 0.5) * 1e-13;
      expect(formatScaled(y, decimals), `${y} at ${decimals}`).toBe(literal(y, decimals));
    }
  });

  it("an exact divisor agrees with the float result away from ties", () => {
    for (let i = 0; i < 2000; i += 1) {
      const raw = int(0, 65535);
      const divisor = [10, 100, 1000, 7, 3, 4, -2][int(0, 6)] as number;
      const decimals = int(0, 4);
      const exact = scaleText(raw, divide(divisor, decimals));
      const approx = (raw / divisor).toFixed(decimals);
      // They may differ only on a tie (toFixed rounds the stored binary value).
      if (exact !== approx) {
        const s = Math.abs(raw / divisor) * 10 ** decimals;
        expect(Math.abs(s - Math.floor(s) - 0.5)).toBeLessThan(1e-6);
      }
    }
  });
});
