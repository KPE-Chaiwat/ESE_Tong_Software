import type { AddressBase } from "@/shared/ipc/modbus-master.types";
import {
  type ConnectionFormValues,
  connectionSchema,
  connectionWarnings,
  type PollFormValues,
  pollSchema,
  profileNameSchema,
  validate,
  type WriteFormValues,
  writeSchema,
  writeWarnings,
} from "./schemas";

const tcp = (over: Partial<ConnectionFormValues> = {}): ConnectionFormValues => ({
  mode: "tcp",
  host: "192.168.1.10",
  port: "502",
  serialPort: "",
  baud: "9600",
  dataBits: "8",
  parity: "even",
  stopBits: "1",
  timeoutMs: "1000",
  ...over,
});

const rtu = (over: Partial<ConnectionFormValues> = {}) =>
  tcp({ mode: "rtu", serialPort: "COM3", ...over });

const poll = (over: Partial<PollFormValues> = {}): PollFormValues => ({
  slaveId: "1",
  function: "3",
  startAddress: "0",
  quantity: "10",
  scanRateMs: "1000",
  ...over,
});

const write = (over: Partial<WriteFormValues> = {}): WriteFormValues => ({
  function: "16",
  slaveId: "1",
  address: "100",
  valueFormat: "unsigned",
  coil: true,
  valueText: "5",
  valuesText: "10 20 30",
  ...over,
});

function errorsOf<S extends Parameters<typeof validate>[0]>(schema: S, values: unknown) {
  const r = validate(schema, values);
  return r.ok ? {} : r.errors;
}

describe("connectionSchema", () => {
  it("accepts a valid TCP form and produces the IPC config", () => {
    expect(validate(connectionSchema, tcp({ host: " plc-7 ", port: " 502 " }))).toEqual({
      ok: true,
      value: { mode: "tcp", host: "plc-7", port: 502, timeoutMs: 1000 },
    });
  });

  it("accepts a valid RTU form and produces the IPC config", () => {
    expect(validate(connectionSchema, rtu())).toEqual({
      ok: true,
      value: {
        mode: "rtu",
        port: "COM3",
        baud: 9600,
        dataBits: 8,
        parity: "even",
        stopBits: 1,
        timeoutMs: 1000,
      },
    });
  });

  it.each([
    ["0", false],
    ["1", true],
    ["65535", true],
    ["65536", false],
    ["abc", false],
    ["", false],
    ["50.5", false],
  ])("port %j valid=%s", (port, valid) => {
    const errors = errorsOf(connectionSchema, tcp({ port }));
    if (valid) expect(errors).toEqual({});
    else expect(errors).toEqual({ port: "Port must be a whole number from 1 to 65535." });
  });

  it("validates the host", () => {
    expect(errorsOf(connectionSchema, tcp({ host: "" }))).toEqual({
      host: "Enter a host name or IPv4 address.",
    });
    expect(errorsOf(connectionSchema, tcp({ host: "   " }))).toEqual({
      host: "Enter a host name or IPv4 address.",
    });
    const invalid = {
      host: "Enter a valid host name or IPv4 address, for example 192.168.1.10.",
    };
    expect(errorsOf(connectionSchema, tcp({ host: "256.1.1.1" }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "bad host" }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "-bad.example" }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "a..b" }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "a".repeat(64) }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "::1" }))).toEqual(invalid);
    // Digits and dots only must be a whole IPv4 address (the backend rejects these too).
    expect(errorsOf(connectionSchema, tcp({ host: "192.168.1" }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "1.2.3.4.5" }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "12345" }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "1.2.3." }))).toEqual(invalid);
    expect(errorsOf(connectionSchema, tcp({ host: "192.168.1.10" }))).toEqual({});
    expect(errorsOf(connectionSchema, tcp({ host: "plc-7" }))).toEqual({});
    expect(errorsOf(connectionSchema, tcp({ host: "plc.7" }))).toEqual({});
    expect(errorsOf(connectionSchema, tcp({ host: "plc.local" }))).toEqual({});
    expect(errorsOf(connectionSchema, tcp({ host: "255.255.255.255" }))).toEqual({});
    expect(errorsOf(connectionSchema, tcp({ host: "a".repeat(63) }))).toEqual({});
  });

  it.each([
    ["49", false],
    ["50", true],
    ["10000", true],
    ["10001", false],
  ])("timeout %s valid=%s", (timeoutMs, valid) => {
    const errors = errorsOf(connectionSchema, tcp({ timeoutMs }));
    if (valid) expect(errors).toEqual({});
    else
      expect(errors).toEqual({ timeoutMs: "Timeout must be a whole number from 50 to 10000 ms." });
  });

  it("applies the timeout rule in RTU mode too", () => {
    expect(errorsOf(connectionSchema, rtu({ timeoutMs: "49" }))).toEqual({
      timeoutMs: "Timeout must be a whole number from 50 to 10000 ms.",
    });
  });

  it("requires a serial port in RTU mode", () => {
    expect(errorsOf(connectionSchema, rtu({ serialPort: "" }))).toEqual({
      serialPort: "Select a serial port.",
    });
  });

  it("reports every invalid field at once", () => {
    expect(errorsOf(connectionSchema, tcp({ host: "", port: "0", timeoutMs: "1" }))).toEqual({
      host: "Enter a host name or IPv4 address.",
      port: "Port must be a whole number from 1 to 65535.",
      timeoutMs: "Timeout must be a whole number from 50 to 10000 ms.",
    });
  });

  it("rejects out-of-list RTU values with the DES-001 3.1 messages", () => {
    expect(errorsOf(connectionSchema, rtu({ baud: "250000" }))).toEqual({
      baud: "Choose a baud rate from the list.",
    });
    expect(errorsOf(connectionSchema, rtu({ dataBits: "6" }))).toEqual({
      dataBits: "Data bits must be 7 or 8.",
    });
    expect(errorsOf(connectionSchema, rtu({ parity: "mark" }))).toEqual({
      parity: "Choose a parity from the list.",
    });
    expect(errorsOf(connectionSchema, rtu({ stopBits: "3" }))).toEqual({
      stopBits: "Stop bits must be 1 or 2.",
    });
    expect(
      errorsOf(connectionSchema, rtu({ baud: "250000", dataBits: "6", stopBits: "3" })),
    ).toEqual({
      baud: "Choose a baud rate from the list.",
      dataBits: "Data bits must be 7 or 8.",
      stopBits: "Stop bits must be 1 or 2.",
    });
  });

  it("ignores the RTU ranges in TCP mode", () => {
    expect(
      errorsOf(connectionSchema, tcp({ baud: "250000", dataBits: "6", stopBits: "3" })),
    ).toEqual({});
  });
});

describe("connectionWarnings", () => {
  it("warns about 7 data bits and parity None with 1 stop bit, in RTU only", () => {
    expect(connectionWarnings(rtu({ dataBits: "7" }))).toEqual({
      dataBits: "Modbus RTU uses 8 data bits. 7 may not work with most devices.",
    });
    expect(connectionWarnings(rtu({ parity: "none", stopBits: "1" }))).toEqual({
      stopBits: "The Modbus specification uses 2 stop bits when parity is None.",
    });
    expect(connectionWarnings(rtu({ parity: "none", stopBits: "2" }))).toEqual({});
    expect(connectionWarnings(rtu())).toEqual({});
    expect(connectionWarnings(tcp({ dataBits: "7", parity: "none" }))).toEqual({});
  });

  it("never blocks validation", () => {
    expect(validate(connectionSchema, rtu({ dataBits: "7", parity: "none" })).ok).toBe(true);
  });
});

describe("pollSchema", () => {
  const schema = (base: AddressBase = 0, mode: "tcp" | "rtu" = "tcp") => pollSchema(mode, base);

  it("accepts defaults and produces a protocol-addressed definition", () => {
    expect(validate(schema(), poll())).toEqual({
      ok: true,
      value: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
    });
  });

  it("converts a 1-based start address to the protocol address", () => {
    const r = validate(schema(1), poll({ startAddress: "1" }));
    expect(r).toMatchObject({ ok: true, value: { startAddress: 0 } });
  });

  it.each([
    ["0", true],
    ["247", true],
    ["248", false],
    ["-1", false],
    ["", false],
  ])("slave id %j valid=%s on TCP", (slaveId, valid) => {
    const errors = errorsOf(schema(), poll({ slaveId }));
    if (valid) expect(errors).toEqual({});
    else expect(errors).toEqual({ slaveId: "Slave ID must be a whole number from 0 to 247." });
  });

  it("rejects slave 0 for reads on RTU only", () => {
    expect(errorsOf(schema(0, "tcp"), poll({ slaveId: "0" }))).toEqual({});
    expect(errorsOf(schema(0, "rtu"), poll({ slaveId: "0" }))).toEqual({
      slaveId: "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247.",
    });
    expect(errorsOf(schema(0, "rtu"), poll({ slaveId: "248" }))).toEqual({
      slaveId: "Slave ID must be a whole number from 0 to 247.",
    });
  });

  it.each([
    [0, "0", true],
    [0, "65535", true],
    [0, "65536", false],
    [0, "-1", false],
    [1, "0", false],
    [1, "1", true],
    [1, "65536", true],
    [1, "65537", false],
  ] as const)("start address base %i value %s valid=%s", (base, startAddress, valid) => {
    const errors = errorsOf(schema(base), poll({ startAddress, quantity: "1" }));
    if (valid) expect(errors).toEqual({});
    else {
      const max = base === 0 ? 65535 : 65536;
      expect(errors).toEqual({
        startAddress: `Start address must be a whole number from ${base} to ${max}.`,
      });
    }
  });

  it.each([
    ["3", "125", true],
    ["3", "126", false],
    ["4", "126", false],
    ["1", "2000", true],
    ["1", "2001", false],
    ["2", "2001", false],
    ["3", "0", false],
    ["3", "", false],
  ])("quantity FC%s %s valid=%s", (fn, quantity, valid) => {
    const errors = errorsOf(schema(), poll({ function: fn, quantity }));
    if (valid) expect(errors).toEqual({});
    else {
      const max = fn === "1" || fn === "2" ? 2000 : 125;
      expect(errors).toEqual({ quantity: `Quantity for FC0${fn} must be from 1 to ${max}.` });
    }
  });

  it("rejects a range that ends after the last address, with the maximum quantity", () => {
    expect(errorsOf(schema(), poll({ startAddress: "65530", quantity: "10" }))).toEqual({
      quantity:
        "This range ends after the last address (65535). The maximum quantity from 65530 is 6.",
    });
    expect(errorsOf(schema(1), poll({ startAddress: "65531", quantity: "10" }))).toEqual({
      quantity:
        "This range ends after the last address (65536). The maximum quantity from 65531 is 6.",
    });
    expect(errorsOf(schema(), poll({ startAddress: "65530", quantity: "6" }))).toEqual({});
  });

  it.each([
    ["19", false],
    ["20", true],
    ["60000", true],
    ["60001", false],
  ])("scan rate %s valid=%s", (scanRateMs, valid) => {
    const errors = errorsOf(schema(), poll({ scanRateMs }));
    if (valid) expect(errors).toEqual({});
    else
      expect(errors).toEqual({
        scanRateMs: "Scan rate must be a whole number from 20 to 60000 ms.",
      });
  });
});

describe("writeSchema", () => {
  const schema = (base: AddressBase = 0) => writeSchema(base);
  const list = (n: number, fill = "1") => Array.from({ length: n }, () => fill).join(" ");

  it("builds an FC16 request from a values list", () => {
    expect(validate(schema(), write())).toEqual({
      ok: true,
      value: { slaveId: 1, function: 16, address: 100, values: [10, 20, 30] },
    });
  });

  it("parses FC16 values in the selected format", () => {
    const r = validate(schema(), write({ valueFormat: "hex", valuesText: "0x0A, FF" }));
    expect(r).toMatchObject({ ok: true, value: { values: [10, 255] } });
  });

  it("builds FC05 from the ON/OFF choice and FC06 from the single value", () => {
    expect(validate(schema(), write({ function: "5", coil: false }))).toMatchObject({
      ok: true,
      value: { function: 5, values: [0] },
    });
    expect(validate(schema(), write({ function: "5", coil: true }))).toMatchObject({
      value: { values: [1] },
    });
    expect(
      validate(schema(), write({ function: "6", valueFormat: "signed", valueText: "-1" })),
    ).toMatchObject({ ok: true, value: { function: 6, values: [65535] } });
  });

  it("converts the 1-based address", () => {
    expect(validate(schema(1), write({ address: "101" }))).toMatchObject({
      value: { address: 100 },
    });
  });

  it("checks slave id and address", () => {
    expect(errorsOf(schema(), write({ slaveId: "248", address: "65536" }))).toEqual({
      slaveId: "Slave ID must be a whole number from 0 to 247.",
      address: "Start address must be a whole number from 0 to 65535.",
    });
    expect(errorsOf(schema(1), write({ address: "0" }))).toEqual({
      address: "Start address must be a whole number from 1 to 65536.",
    });
  });

  it("reports single value errors per format for FC06", () => {
    expect(errorsOf(schema(), write({ function: "6", valueText: "70000" }))).toEqual({
      valueText: "Value must be from 0 to 65535.",
    });
    expect(
      errorsOf(schema(), write({ function: "6", valueFormat: "hex", valueText: "0x10000" })),
    ).toEqual({ valueText: "Enter a hex value from 0x0000 to 0xFFFF." });
    expect(
      errorsOf(
        schema(),
        write({ function: "6", valueFormat: "binary", valueText: "1 0000 0000 0000 0000" }),
      ),
    ).toEqual({ valueText: "Enter up to 16 binary digits (0 or 1)." });
  });

  it("limits FC16 to 123 values", () => {
    expect(errorsOf(schema(), write({ valuesText: list(123) }))).toEqual({});
    expect(errorsOf(schema(), write({ valuesText: list(124) }))).toEqual({
      valuesText: "Enter from 1 to 123 values (you entered 124).",
    });
    expect(errorsOf(schema(), write({ valuesText: "" }))).toEqual({
      valuesText: "Enter from 1 to 123 values (you entered 0).",
    });
  });

  it("limits FC15 to 1968 values of 0 or 1", () => {
    expect(errorsOf(schema(), write({ function: "15", valuesText: list(1968) }))).toEqual({});
    expect(errorsOf(schema(), write({ function: "15", valuesText: list(1969) }))).toEqual({
      valuesText: "Enter from 1 to 1968 values (you entered 1969).",
    });
    expect(errorsOf(schema(), write({ function: "15", valuesText: "1 2 0" }))).toEqual({
      valuesText: 'Value 2 ("2") is not valid: enter 0 or 1.',
    });
  });

  it("reports the first failing FC16 item with the single value message", () => {
    expect(errorsOf(schema(), write({ valuesText: "1 99999 abc" }))).toEqual({
      valuesText: 'Value 2 ("99999") is not valid: Value must be from 0 to 65535.',
    });
  });

  it("rejects values that run past the last address", () => {
    expect(errorsOf(schema(), write({ address: "65534", valuesText: "1 2 3" }))).toEqual({
      valuesText:
        "These values end after the last address (65535). At most 2 values fit from 65534.",
    });
    expect(errorsOf(schema(), write({ address: "65534", valuesText: "1 2" }))).toEqual({});
  });
});

describe("writeWarnings", () => {
  it("warns for broadcast slave 0 in RTU mode only", () => {
    expect(writeWarnings({ slaveId: "0" }, "rtu")).toEqual({
      slaveId: "Broadcast: devices do not reply, so the result cannot be confirmed.",
    });
    expect(writeWarnings({ slaveId: " 0 " }, "rtu")).toHaveProperty("slaveId");
    expect(writeWarnings({ slaveId: "1" }, "rtu")).toEqual({});
    expect(writeWarnings({ slaveId: "" }, "rtu")).toEqual({});
  });

  it("never warns in TCP mode: unit 0 is a normal unit", () => {
    expect(writeWarnings({ slaveId: "0" }, "tcp")).toEqual({});
  });
});

describe("profileNameSchema (DES-001 3.4, in the listed order)", () => {
  const nameErrors = (name: string, existing: string[] = []) =>
    errorsOf(profileNameSchema(existing), name);

  it("accepts a valid name without trimming it", () => {
    expect(validate(profileNameSchema([]), "Boiler-PLC")).toEqual({
      ok: true,
      value: "Boiler-PLC",
    });
    expect(validate(profileNameSchema([]), "My bench 2")).toMatchObject({ ok: true });
  });

  it("requires a name", () => {
    expect(nameErrors("")).toEqual({ name: "Enter a profile name." });
    expect(nameErrors("   ")).toEqual({ name: "Enter a profile name." });
  });

  it("limits the length to 64 characters", () => {
    expect(nameErrors("a".repeat(64))).toEqual({});
    expect(nameErrors("a".repeat(65))).toEqual({
      name: "Profile name must be at most 64 characters.",
    });
  });

  it("rejects leading and trailing spaces instead of trimming them", () => {
    const message = { name: "Profile name cannot start or end with a space." };
    expect(nameErrors(" a")).toEqual(message);
    expect(nameErrors("a ")).toEqual(message);
    expect(nameErrors("\tbench")).toEqual(message);
  });

  it("rejects a leading or trailing dot", () => {
    expect(nameErrors(".hidden")).toEqual({ name: "Profile name cannot start with a dot." });
    expect(nameErrors("name.")).toEqual({ name: "Profile name cannot end with a dot." });
    expect(nameErrors("bench.v2")).toEqual({});
  });

  it.each(["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"])(
    "rejects the character in %j",
    (name) => {
      expect(nameErrors(name)).toEqual({
        name: 'Profile name cannot contain \\ / : * ? " < > |',
      });
    },
  );

  it("rejects control characters", () => {
    const message = { name: "Profile name cannot contain control characters." };
    expect(nameErrors("a\u0007b")).toEqual(message);
    expect(nameErrors("a\tb")).toEqual(message);
    expect(nameErrors("a\u007fb")).toEqual(message);
  });

  it.each(["CON", "nul", "com1", "LPT9", "COM¹", "lpt³", "con.backup", "Aux.txt"])(
    "rejects the Windows reserved name %j",
    (name) => {
      expect(nameErrors(name)).toEqual({
        name: `"${name}" is reserved by Windows and cannot be used as a profile name.`,
      });
    },
  );

  it("accepts names that only look like reserved ones", () => {
    for (const name of ["COM10", "CONSOLE", "com0", "lpt10", "my.con", "nullable"]) {
      expect(nameErrors(name), name).toEqual({});
    }
  });

  it("applies the rules in the listed order", () => {
    // A leading dot and a reserved name: the dot rule comes first.
    expect(nameErrors(".con")).toEqual({ name: "Profile name cannot start with a dot." });
    expect(nameErrors(` ${"a".repeat(64)}`)).toEqual({
      name: "Profile name must be at most 64 characters.",
    });
    expect(nameErrors("a/\u0007")).toEqual({
      name: 'Profile name cannot contain \\ / : * ? " < > |',
    });
  });

  it("rejects a duplicate in a different case (rename)", () => {
    expect(nameErrors("boiler-plc", ["Boiler-PLC"])).toEqual({
      name: 'A profile named "boiler-plc" already exists.',
    });
    expect(nameErrors("Pump", ["Boiler-PLC"])).toEqual({});
  });
});
