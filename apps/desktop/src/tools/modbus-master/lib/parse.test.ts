import { parseValue, splitValues } from "./parse";

describe("parseValue", () => {
  it.each([
    ["0", "unsigned", 0],
    ["65535", "unsigned", 65535],
    [" 12 ", "unsigned", 12],
    ["-32768", "signed", 0x8000],
    ["-1", "signed", 65535],
    ["32767", "signed", 32767],
    ["0x1F", "hex", 31],
    ["0X1f", "hex", 31],
    ["1f", "hex", 31],
    ["FFFF", "hex", 65535],
    ["ffff", "hex", 65535],
    ["0xFFFF", "hex", 65535],
    ["1010", "binary", 10],
    ["0b1010", "binary", 10],
    ["1111 1111 1111 1111", "binary", 65535],
    ["0b0000 0000 0000 0001", "binary", 1],
  ] as const)("accepts %j as %s", (text, fmt, raw) => {
    expect(parseValue(text, fmt)).toEqual({ ok: true, raw });
  });

  it.each([
    ["", "unsigned", "Value must be from 0 to 65535."],
    ["65536", "unsigned", "Value must be from 0 to 65535."],
    ["-1", "unsigned", "Value must be from 0 to 65535."],
    ["1.5", "unsigned", "Value must be from 0 to 65535."],
    ["abc", "unsigned", "Value must be from 0 to 65535."],
    ["-32769", "signed", "Value must be from -32768 to 32767."],
    ["32768", "signed", "Value must be from -32768 to 32767."],
    ["", "hex", "Enter a hex value from 0x0000 to 0xFFFF."],
    ["0x10000", "hex", "Enter a hex value from 0x0000 to 0xFFFF."],
    ["12345", "hex", "Enter a hex value from 0x0000 to 0xFFFF."],
    ["0xZZ", "hex", "Enter a hex value from 0x0000 to 0xFFFF."],
    ["", "binary", "Enter up to 16 binary digits (0 or 1)."],
    ["1 0000 0000 0000 0000", "binary", "Enter up to 16 binary digits (0 or 1)."],
    ["102", "binary", "Enter up to 16 binary digits (0 or 1)."],
  ] as const)("rejects %j as %s with the exact message", (text, fmt, message) => {
    expect(parseValue(text, fmt)).toEqual({ ok: false, message });
  });

  it("returns the raw 16-bit pattern for negative signed values", () => {
    expect(parseValue("-2", "signed")).toEqual({ ok: true, raw: 65534 });
  });
});

describe("splitValues", () => {
  it("splits on spaces, commas, tabs and newlines and collapses runs", () => {
    expect(splitValues(" 1,,2\t3\n4 ")).toEqual(["1", "2", "3", "4"]);
  });

  it("returns an empty list for blank text", () => {
    expect(splitValues("")).toEqual([]);
    expect(splitValues(" \n\t, ")).toEqual([]);
  });
});
