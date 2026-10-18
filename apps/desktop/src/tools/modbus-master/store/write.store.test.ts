import { IpcError } from "@/shared/ipc/modbus-master";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import type {
  AddressBase,
  PollConfig,
  PollDefinition,
  ValueFormat,
  WriteRequest,
} from "@/shared/ipc/modbus-master.types";
import { describeWriteResult, validateDraft, visibleErrors, writeResultText } from "./write.logic";
import { createWriteStore, type WriteStoreApi } from "./write.store";

let ipc: FakeModbusMasterIpc;
let store: WriteStoreApi;
let base: AddressBase;
let format: ValueFormat;
let linkUp: boolean;
let poll: PollDefinition;
let present: boolean;
const POLL_ID = 7;
const get = () => store.getState();

function config(): PollConfig {
  return {
    pollId: POLL_ID,
    name: "Tank 1",
    definition: poll,
    active: true,
    display: { format, addressBase: base, showAlias: true, copyAlias: false },
    scale: null,
    scaleOverrides: [],
    valueColumns: "raw",
    aliases: [],
  };
}

beforeEach(() => {
  ipc = createFakeModbusMasterIpc();
  base = 0;
  format = "unsigned";
  linkUp = true;
  present = true;
  poll = { slaveId: 3, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 };
  store = createWriteStore({
    ipc,
    getConfig: (id) => (present && id === POLL_ID ? config() : null),
    isLinkUp: () => linkUp,
  });
});

describe("initial state", () => {
  it("is closed and idle with function 06 remembered", () => {
    expect(get()).toMatchObject({
      open: false,
      pollId: null,
      status: "idle",
      result: null,
      lastFunction: 6,
      submitted: false,
    });
  });
});

describe("openFor prefill (DES-001 S2)", () => {
  it("an FC01 row prefills function 05 with the coil state", () => {
    get().openFor(POLL_ID, { address: 7, pollFunction: 1, slaveId: 2, raw: 1 });
    expect(get().open).toBe(true);
    expect(get().draft).toMatchObject({ function: "5", slaveId: "2", address: "7", coil: true });
    get().openFor(POLL_ID, { address: 7, pollFunction: 1, slaveId: 2, raw: 0 });
    expect(get().draft.coil).toBe(false);
  });

  it("an FC03 row prefills function 06 with the raw value in the table format", () => {
    format = "hex";
    get().openFor(POLL_ID, { address: 100, pollFunction: 3, slaveId: 1, raw: 1234 });
    expect(get().draft).toMatchObject({
      function: "6",
      address: "100",
      valueFormat: "hex",
      valueText: "0x04D2",
    });
  });

  it("closes up the nibble spaces of a binary value in the list box (REV-002 m6)", () => {
    format = "binary";
    get().openFor(POLL_ID, { address: 0, pollFunction: 3, slaveId: 1, raw: 0x04d2 });
    expect(get().draft.valueText).toBe("0000 0100 1101 0010");
    expect(get().draft.valuesText).toBe("0000010011010010");
    get().updateDraft({ function: "16" });
    expect(validateDraft(get().draft, 0)).toMatchObject({ ok: true, value: { values: [0x04d2] } });
  });

  it("uses the display base for the address", () => {
    base = 1;
    get().openFor(POLL_ID, { address: 100, pollFunction: 3, slaveId: 1, raw: 5 });
    expect(get().draft.address).toBe("101");
  });

  it("uses the last used function for FC02 and FC04", () => {
    get().openFor(POLL_ID, { address: 0, pollFunction: 4, slaveId: 1 });
    expect(get().draft.function).toBe("6");
    get().updateDraft({ function: "16", valuesText: "1 2" });
    return get()
      .send()
      .then(() => {
        get().close();
        get().openFor(POLL_ID, { address: 0, pollFunction: 2, slaveId: 1 });
        expect(get().draft.function).toBe("16");
      });
  });

  it("without a prefill uses the poll slave and the last function", () => {
    get().openFor(POLL_ID);
    expect(get().draft).toMatchObject({ function: "6", slaveId: "3", address: "0" });
  });

  it("resets the result, status and shown errors each time it opens", async () => {
    get().openFor(POLL_ID, { address: 0, pollFunction: 3, slaveId: 1, raw: 1 });
    await get().send();
    expect(get().result).not.toBeNull();
    get().openFor(POLL_ID, { address: 0, pollFunction: 3, slaveId: 1, raw: 1 });
    expect(get()).toMatchObject({ status: "idle", result: null, submitted: false, touched: {} });
  });
});

describe("updateDraft and touch", () => {
  it("merges the patch and keeps the result until the next send (DES-001 2.5)", async () => {
    get().openFor(POLL_ID, { address: 0, pollFunction: 3, slaveId: 1, raw: 1 });
    await get().send();
    expect(get().status).toBe("done");
    get().updateDraft({ valueText: "5" });
    expect(get().draft.valueText).toBe("5");
    expect(get()).toMatchObject({ result: { status: "ok" }, status: "done" });
  });

  it("clearResult empties the result area but not while a write is in flight", async () => {
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    await get().send();
    get().clearResult();
    expect(get()).toMatchObject({ result: null, status: "idle" });
    const held = ipc.hold("write");
    const p = get().send();
    get().clearResult();
    expect(get().status).toBe("sending");
    held.release({ status: "ok" });
    await p;
  });

  it("remembers the field the backend named in a validation rejection", async () => {
    ipc.failNext("write", new IpcError("Slave id out of range", "validation", "slaveId"));
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    await get().send();
    expect(get()).toMatchObject({ ipcError: "Slave id out of range", ipcErrorField: "slaveId" });
    get().updateDraft({ slaveId: "2" });
    expect(get().ipcErrorField).toBeNull();
  });

  it("remembers touched fields", () => {
    get().openFor(POLL_ID);
    get().touch("address");
    expect(get().touched).toEqual({ address: true });
  });
});

describe("send", () => {
  it("validates before sending and shows every error", async () => {
    get().openFor(POLL_ID, { address: 0, pollFunction: 3, slaveId: 1, raw: 1 });
    get().updateDraft({ valueText: "70000" });
    await get().send();
    expect(ipc.callsOf("write")).toHaveLength(0);
    expect(get().submitted).toBe(true);
    expect(get().status).toBe("idle");
  });

  it("rejects 124 values for FC16 without sending", async () => {
    get().openFor(POLL_ID);
    get().updateDraft({
      function: "16",
      valuesText: Array.from({ length: 124 }, () => "1").join(" "),
    });
    await get().send();
    expect(ipc.callsOf("write")).toHaveLength(0);
  });

  it("sends the parsed request and stores a confirmed result", async () => {
    get().openFor(POLL_ID);
    get().updateDraft({ function: "16", slaveId: "1", address: "100", valuesText: "10 20 30" });
    await get().send();
    const expected: WriteRequest = { slaveId: 1, function: 16, address: 100, values: [10, 20, 30] };
    expect(ipc.callsOf("write")).toEqual([[expected, POLL_ID]]);
    expect(get()).toMatchObject({ status: "done", result: { status: "ok" }, lastFunction: 16 });
    expect(get().request).toEqual(expected);
  });

  it("goes through sending and ignores a second send while in flight", async () => {
    const held = ipc.hold("write");
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    const p = get().send();
    expect(get().status).toBe("sending");
    await get().send();
    held.release({ status: "ok" });
    await p;
    expect(ipc.callsOf("write")).toHaveLength(1);
    expect(get().status).toBe("done");
  });

  it.each([
    [{ status: "broadcastSent" }],
    [{ status: "exception", code: 2 }],
    [{ status: "timeout" }],
    [{ status: "badResponse", kind: "crc", detail: { expected: null, got: null, message: "" } }],
    [{ status: "notConnected" }],
  ] as const)("stores the backend result %j", async (result) => {
    ipc.setResult("write", result);
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    await get().send();
    expect(get().result).toEqual(result);
    expect(get().status).toBe("done");
  });

  it("closing during sending drops the late result", async () => {
    const held = ipc.hold("write");
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    const p = get().send();
    get().close();
    held.release({ status: "ok" });
    await p;
    expect(get()).toMatchObject({ open: false, status: "idle", result: null });
  });

  it("re-opening during sending also drops the old result", async () => {
    const held = ipc.hold("write");
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    const p = get().send();
    get().close();
    get().openFor(POLL_ID);
    held.release({ status: "ok" });
    await p;
    expect(get().result).toBeNull();
    expect(get().status).toBe("idle");
  });

  it("records a rejected command as an error text", async () => {
    ipc.failNext("write", "Slave ID out of range");
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    await get().send();
    expect(get()).toMatchObject({
      status: "done",
      result: null,
      ipcError: "Slave ID out of range",
    });
  });

  it("does nothing while closed", async () => {
    await get().send();
    expect(ipc.callsOf("write")).toHaveLength(0);
  });

  it("answers notConnected locally when the link is down", async () => {
    linkUp = false;
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    await get().send();
    expect(ipc.callsOf("write")).toHaveLength(0);
    expect(get().result).toEqual({ status: "notConnected" });
  });

  it("slave 0 on RTU is a broadcast: broadcastSent", async () => {
    await ipc.connect({
      mode: "rtu",
      port: "COM3",
      baud: 9600,
      dataBits: 8,
      parity: "even",
      stopBits: 1,
      timeoutMs: 1000,
    });
    get().openFor(POLL_ID);
    get().updateDraft({ slaveId: "0", valueText: "5" });
    await get().send();
    expect(get().result).toEqual({ status: "broadcastSent" });
  });

  it("slave 0 on TCP is a normal unit: the write is confirmed", async () => {
    await ipc.connect({ mode: "tcp", host: "h", port: 502, timeoutMs: 1000 });
    get().openFor(POLL_ID);
    get().updateDraft({ slaveId: "0", valueText: "5" });
    await get().send();
    expect(get().result).toEqual({ status: "ok" });
    expect(get().request).toMatchObject({ slaveId: 0 });
  });

  it("sends the poll the write is made from, so traffic shows Write: {poll name}", async () => {
    get().openFor(POLL_ID);
    get().updateDraft({ address: "3", valueText: "9" });
    await get().send();
    expect(ipc.callsOf("write")[0]?.[1]).toBe(POLL_ID);
  });

  it("keeps the draft after a linkLost result", async () => {
    ipc.setResult("write", { status: "linkLost" });
    get().openFor(POLL_ID);
    get().updateDraft({ address: "3", valueText: "9" });
    await get().send();
    expect(get().result).toEqual({ status: "linkLost" });
    expect(get().draft).toMatchObject({ address: "3", valueText: "9" });
  });
});

describe("visibleErrors", () => {
  it("only reports fields the function shows", () => {
    const errors = { slaveId: "a", valueText: "b", valuesText: "c" };
    expect(visibleErrors(errors, 6)).toEqual({ slaveId: "a", valueText: "b" });
    expect(visibleErrors(errors, 16)).toEqual({ slaveId: "a", valuesText: "c" });
    expect(visibleErrors(errors, 5)).toEqual({ slaveId: "a" });
  });
});

describe("describeWriteResult (DES-001 2.5)", () => {
  it("link lost has the exact text, the unplug icon and the error tone", () => {
    const ctx = { request: null, base: 0 as const, timeoutMs: 1000 };
    const text =
      "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.";
    expect(describeWriteResult({ status: "linkLost" }, ctx)).toEqual({
      tone: "error",
      icon: "unplug",
      text,
    });
    expect(writeResultText({ status: "linkLost" }, ctx)).toBe(text);
  });

  it("bad response texts come from the detail (DES-001 3.4)", () => {
    const ctx = { request: null, base: 0 as const, timeoutMs: 1000 };
    expect(
      writeResultText(
        { status: "badResponse", kind: "shortFrame", detail: { expected: 8, got: 5, message: "" } },
        ctx,
      ),
    ).toBe("Bad response: short frame (5 of 8 bytes). The write may or may not have been applied.");
    expect(
      writeResultText(
        { status: "badResponse", kind: "wrongSlave", detail: { expected: 1, got: 2, message: "" } },
        ctx,
      ),
    ).toBe(
      "Bad response: reply from slave 2, expected 1. The write may or may not have been applied.",
    );
  });

  const ctx = (request: WriteRequest | null, b: AddressBase = 0) => ({
    request,
    base: b,
    timeoutMs: 1000,
  });
  const req16: WriteRequest = { slaveId: 1, function: 16, address: 100, values: [10, 20, 30] };

  it("success for several registers and coils", () => {
    expect(describeWriteResult({ status: "ok" }, ctx(req16))).toEqual({
      tone: "success",
      icon: "circle-check",
      text: "Write confirmed by slave 1: 3 registers at 100-102.",
    });
    expect(
      describeWriteResult({ status: "ok" }, ctx({ ...req16, function: 15, values: [1, 0] })).text,
    ).toBe("Write confirmed by slave 1: 2 coils at 100-101.");
  });

  it("success for a single register and coil, using the display base", () => {
    expect(
      describeWriteResult(
        { status: "ok" },
        ctx({ slaveId: 2, function: 6, address: 4, values: [1] }, 1),
      ).text,
    ).toBe("Write confirmed by slave 2: register at 5.");
    expect(
      describeWriteResult(
        { status: "ok" },
        ctx({ slaveId: 2, function: 5, address: 4, values: [1] }),
      ).text,
    ).toBe("Write confirmed by slave 2: coil at 4.");
  });

  it("every other result", () => {
    expect(describeWriteResult({ status: "broadcastSent" }, ctx(null))).toEqual({
      tone: "outline",
      icon: "circle-check",
      text: "Broadcast sent. Devices do not reply to slave ID 0, so the write cannot be confirmed.",
    });
    expect(describeWriteResult({ status: "exception", code: 2 }, ctx(null))).toEqual({
      tone: "error",
      icon: "octagon-x",
      text: "Exception 02 (Illegal data address). Nothing was confirmed.",
    });
    expect(describeWriteResult({ status: "timeout" }, ctx(null))).toEqual({
      tone: "warning",
      icon: "timer-off",
      text: "No response within 1000 ms. The write may or may not have been applied.",
    });
    expect(
      describeWriteResult(
        { status: "badResponse", kind: "crc", detail: { expected: null, got: null, message: "" } },
        ctx(null),
      ),
    ).toEqual({
      tone: "warning",
      icon: "triangle-alert",
      text: "Bad response: CRC mismatch. The write may or may not have been applied.",
    });
    expect(describeWriteResult({ status: "notConnected" }, ctx(null))).toEqual({
      tone: "error",
      icon: "unplug",
      text: "Not connected. Connect before writing.",
    });
  });
});
