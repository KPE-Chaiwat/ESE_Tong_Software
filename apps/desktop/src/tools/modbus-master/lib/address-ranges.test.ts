import {
  addressesOf,
  clampRanges,
  countAddresses,
  formatRanges,
  normalizeRanges,
  rangeBetween,
  rangesContain,
  sameRanges,
  toggleAddress,
} from "./address-ranges";

const r = (start: number, end: number) => ({ start, end });

describe("normalizeRanges", () => {
  it("sorts and merges overlapping and touching ranges", () => {
    expect(normalizeRanges([r(10, 12), r(0, 3), r(4, 5), r(2, 2)])).toEqual([r(0, 5), r(10, 12)]);
  });
  it("drops invalid ranges and does not change its input", () => {
    const input = [r(5, 1), r(0, 0)];
    expect(normalizeRanges(input)).toEqual([r(0, 0)]);
    expect(input).toEqual([r(5, 1), r(0, 0)]);
    expect(normalizeRanges([{ start: 1.5, end: 3 }])).toEqual([]);
  });
});

describe("rangesContain", () => {
  const ranges = [r(2, 4), r(8, 8)];
  it.each([
    [1, false],
    [2, true],
    [4, true],
    [5, false],
    [8, true],
    [9, false],
  ])("%i is %s", (address, expected) => {
    expect(rangesContain(ranges, address)).toBe(expected);
  });
  it("is false for an empty selection", () => {
    expect(rangesContain([], 0)).toBe(false);
  });
});

describe("rangeBetween, toggleAddress", () => {
  it("rangeBetween works in either order", () => {
    expect(rangeBetween(5, 2)).toEqual(r(2, 5));
    expect(rangeBetween(2, 5)).toEqual(r(2, 5));
  });

  it("toggle adds a new address and merges it", () => {
    expect(toggleAddress([r(0, 1)], 2)).toEqual([r(0, 2)]);
    expect(toggleAddress([r(0, 1)], 5)).toEqual([r(0, 1), r(5, 5)]);
  });

  it("toggle removes an address and splits the range", () => {
    expect(toggleAddress([r(0, 4)], 2)).toEqual([r(0, 1), r(3, 4)]);
    expect(toggleAddress([r(0, 4)], 0)).toEqual([r(1, 4)]);
    expect(toggleAddress([r(0, 4)], 4)).toEqual([r(0, 3)]);
    expect(toggleAddress([r(3, 3)], 3)).toEqual([]);
  });
});

describe("clampRanges", () => {
  it("keeps only what lies inside", () => {
    expect(clampRanges([r(0, 3), r(8, 12), r(20, 30)], 2, 10)).toEqual([r(2, 3), r(8, 10)]);
    expect(clampRanges([r(0, 3)], 5, 9)).toEqual([]);
  });
});

describe("addressesOf, countAddresses, formatRanges, sameRanges", () => {
  it("lists and counts addresses", () => {
    expect(addressesOf([r(1, 2), r(5, 5)])).toEqual([1, 2, 5]);
    expect(countAddresses([r(1, 2), r(5, 5)])).toBe(3);
    expect(countAddresses([])).toBe(0);
  });

  it("formats in the display base: 'Applies to 0-1, 5, 9-12'", () => {
    expect(formatRanges([r(0, 1), r(5, 5), r(9, 12)])).toBe("0-1, 5, 9-12");
    expect(formatRanges([r(0, 1), r(5, 5)], 1)).toBe("1-2, 6");
    expect(formatRanges([])).toBe("");
  });

  it("compares", () => {
    expect(sameRanges([r(0, 1)], [r(0, 1)])).toBe(true);
    expect(sameRanges([r(0, 1)], [r(0, 2)])).toBe(false);
    expect(sameRanges([], [r(0, 0)])).toBe(false);
  });
});
