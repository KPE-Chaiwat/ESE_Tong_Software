import {
  formatBit,
  formatDateTime,
  formatHexBytes,
  formatHexDump,
  formatIsoWithOffset,
  formatOffset,
  formatTime,
  formatValue,
} from "./format";

describe("formatValue", () => {
  it.each([
    [0, "unsigned", "0"],
    [1, "unsigned", "1"],
    [32767, "unsigned", "32767"],
    [32768, "unsigned", "32768"],
    [65535, "unsigned", "65535"],
    [0, "signed", "0"],
    [1, "signed", "1"],
    [32767, "signed", "32767"],
    [32768, "signed", "-32768"],
    [65535, "signed", "-1"],
    [0, "hex", "0x0000"],
    [1, "hex", "0x0001"],
    [1234, "hex", "0x04D2"],
    [32767, "hex", "0x7FFF"],
    [32768, "hex", "0x8000"],
    [65535, "hex", "0xFFFF"],
    [0, "binary", "0000 0000 0000 0000"],
    [1, "binary", "0000 0000 0000 0001"],
    [32767, "binary", "0111 1111 1111 1111"],
    [32768, "binary", "1000 0000 0000 0000"],
    [65535, "binary", "1111 1111 1111 1111"],
  ] as const)("formats %i as %s -> %s", (raw, fmt, expected) => {
    expect(formatValue(raw, fmt)).toBe(expected);
  });
});

describe("formatBit", () => {
  it("shows 0 or 1", () => {
    expect(formatBit(true)).toBe("1");
    expect(formatBit(false)).toBe("0");
    expect(formatBit(1)).toBe("1");
    expect(formatBit(0)).toBe("0");
  });
});

describe("formatHexBytes", () => {
  it("renders uppercase two-digit groups", () => {
    expect(formatHexBytes([0, 1, 0xab, 0xff])).toBe("00 01 AB FF");
    expect(formatHexBytes([])).toBe("");
  });
});

describe("hex dump", () => {
  it("uses 4-digit offsets and 16 bytes per line", () => {
    const bytes = Array.from({ length: 20 }, (_, i) => i);
    expect(formatHexDump(bytes)).toEqual([
      "0000  00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F",
      "0010  10 11 12 13",
    ]);
    expect(formatOffset(0x1a0)).toBe("01A0");
    expect(formatHexDump([])).toEqual([]);
  });
});

describe("time formatting", () => {
  const ms = new Date(2026, 9, 12, 14, 2, 11, 532).getTime();

  it("formats HH:MM:SS.mmm in local time", () => {
    expect(formatTime(ms)).toBe("14:02:11.532");
    expect(formatTime(new Date(2026, 0, 1, 3, 4, 5, 6).getTime())).toBe("03:04:05.006");
  });

  it("formats an ISO date-time with offset", () => {
    expect(formatIsoWithOffset(ms)).toMatch(/^2026-10-12T14:02:11\.532[+-]\d{2}:\d{2}$/);
  });

  it("formats a profile modified time", () => {
    expect(formatDateTime(ms)).toBe("2026-10-12 14:02");
  });
});
