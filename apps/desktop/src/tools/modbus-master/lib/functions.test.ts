import { isBitFunction, isWritableRead, padFunction, QUANTITY_LIMITS } from "./functions";

describe("functions", () => {
  it("has the quantity limits from FE-001 task 03", () => {
    expect(QUANTITY_LIMITS[1]).toBe(2000);
    expect(QUANTITY_LIMITS[2]).toBe(2000);
    expect(QUANTITY_LIMITS[3]).toBe(125);
    expect(QUANTITY_LIMITS[4]).toBe(125);
    expect(QUANTITY_LIMITS[15]).toBe(1968);
    expect(QUANTITY_LIMITS[16]).toBe(123);
  });

  it("classifies functions", () => {
    expect(([1, 2, 3, 4] as const).map(isBitFunction)).toEqual([true, true, false, false]);
    expect(([1, 2, 3, 4] as const).map(isWritableRead)).toEqual([true, false, true, false]);
    expect(padFunction(3)).toBe("03");
    expect(padFunction(16)).toBe("16");
  });
});
