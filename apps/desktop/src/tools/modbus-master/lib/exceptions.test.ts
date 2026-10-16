import {
  badResponseText,
  describeException,
  exceptionName,
  formatExceptionCode,
} from "./exceptions";

describe("exceptions", () => {
  it.each([
    [0x01, "Illegal function"],
    [0x02, "Illegal data address"],
    [0x03, "Illegal data value"],
    [0x04, "Server device failure"],
    [0x05, "Acknowledge"],
    [0x06, "Server device busy"],
    [0x08, "Memory parity error"],
    [0x0a, "Gateway path unavailable"],
    [0x0b, "Gateway target device failed to respond"],
    [0x0c, "Unknown exception"],
    [0x07, "Unknown exception"],
    [0xff, "Unknown exception"],
  ])("names code %i as %s", (code, name) => {
    expect(exceptionName(code)).toBe(name);
  });

  it("formats codes as two uppercase hex digits", () => {
    expect(formatExceptionCode(2)).toBe("02");
    expect(formatExceptionCode(0x0a)).toBe("0A");
    expect(describeException(0x0b)).toBe("Exception 0B (Gateway target device failed to respond)");
  });

  it("describes every bad response kind (DES-001 3.4)", () => {
    const d = (got: number | null, expected: number | null, message = "") => ({
      got,
      expected,
      message,
    });
    expect(badResponseText("crc", d(0x1234, 0x5678))).toBe("CRC mismatch");
    expect(badResponseText("wrongSlave", d(2, 1))).toBe("reply from slave 2, expected 1");
    expect(badResponseText("wrongFunction", d(4, 3))).toBe("reply for FC04, expected FC03");
    expect(badResponseText("wrongFunction", d(16, 3))).toBe("reply for FC16, expected FC03");
    expect(badResponseText("transactionMismatch", d(7, 6))).toBe(
      "transaction ID mismatch (got 7, expected 6)",
    );
    expect(badResponseText("malformed", d(null, null, "byte count"))).toBe(
      "malformed frame (byte count)",
    );
    expect(badResponseText("shortFrame", d(20, 29))).toBe("short frame (20 of 29 bytes)");
    expect(badResponseText("shortFrame", d(5, 8))).toBe("short frame (5 of 8 bytes)");
  });

  it("uses the leading words when numbers or detail are missing", () => {
    expect(badResponseText("wrongSlave")).toBe("reply from unexpected slave");
    expect(badResponseText("wrongSlave", { got: 2, expected: null, message: "" })).toBe(
      "reply from unexpected slave",
    );
    expect(badResponseText("wrongFunction", { got: null, expected: null, message: "" })).toBe(
      "reply for unexpected function",
    );
    expect(badResponseText("transactionMismatch")).toBe("transaction ID mismatch");
    expect(badResponseText("shortFrame", null)).toBe("short frame");
    expect(badResponseText("shortFrame", { got: 5, expected: null, message: "" })).toBe(
      "short frame",
    );
    expect(badResponseText("malformed")).toBe("malformed frame");
    expect(badResponseText("malformed", { got: null, expected: null, message: "" })).toBe(
      "malformed frame",
    );
  });
});
