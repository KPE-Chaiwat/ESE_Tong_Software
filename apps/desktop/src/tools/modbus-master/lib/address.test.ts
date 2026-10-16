import {
  displayAddressRange,
  maxQuantityFrom,
  toDisplayAddress,
  toProtocolAddress,
} from "./address";

describe("address conversion", () => {
  it.each([
    [0, 0, 0],
    [65535, 0, 65535],
    [0, 1, 1],
    [65535, 1, 65536],
  ] as const)("protocol %i with base %i displays as %i", (protocol, base, display) => {
    expect(toDisplayAddress(protocol, base)).toBe(display);
    expect(toProtocolAddress(display, base)).toBe(protocol);
  });

  it("has the display ranges from DES-001 3.2", () => {
    expect(displayAddressRange(0)).toEqual({ min: 0, max: 65535 });
    expect(displayAddressRange(1)).toEqual({ min: 1, max: 65536 });
  });

  it("computes the largest quantity that fits", () => {
    expect(maxQuantityFrom(0)).toBe(65536);
    expect(maxQuantityFrom(65530)).toBe(6);
    expect(maxQuantityFrom(65535)).toBe(1);
  });
});
