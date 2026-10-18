// The Write dialog's poll context and request building (FE-002 task 22): the poll the dialog
// belongs to, FC05/15/16 requests, binary lists, the queue semantics of one dialog, and the
// alias line and scaled preview texts (DES-002 3.3, DES-003 3.5).
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import type {
  AddressBase,
  PollConfig,
  PollDefinition,
  ScaleOverride,
  ScaleSettings,
  ValueFormat,
} from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "../lib/scale-presets";
import { createScaled } from "../lib/scaled";
import {
  aliasLineFor,
  PREVIEW_VALUES,
  READ_ONLY_TOAST,
  validateDraft,
  writeDialogTitle,
  writePreviewFor,
} from "./write.logic";
import { createWriteStore, type WriteStoreApi } from "./write.store";

let ipc: FakeModbusMasterIpc;
let store: WriteStoreApi;
let base: AddressBase;
let format: ValueFormat;
let present: boolean;
const POLL_ID = 7;
const poll: PollDefinition = {
  slaveId: 3,
  function: 3,
  startAddress: 0,
  quantity: 10,
  scanRateMs: 1000,
};
const get = () => store.getState();

function config(): PollConfig {
  return {
    pollId: POLL_ID,
    name: "Tank 1",
    definition: poll,
    active: true,
    display: {
      format,
      addressBase: base,
      showAlias: true,
      copyAlias: false,
      swapBytes: false,
      reverseWords: false,
    },
    colorRules: [],
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
  present = true;
  store = createWriteStore({
    ipc,
    getConfig: (id) => (present && id === POLL_ID ? config() : null),
    isLinkUp: () => true,
  });
});

describe("the poll of the dialog", () => {
  it("remembers the poll it was opened for and forgets it on close", () => {
    get().openFor(POLL_ID);
    expect(get().pollId).toBe(POLL_ID);
    get().close();
    expect(get()).toMatchObject({ open: false, pollId: null });
  });

  it("does not open for a poll that is gone", () => {
    present = false;
    get().openFor(POLL_ID);
    expect(get().open).toBe(false);
    expect(get().pollId).toBeNull();
  });

  it("takes the address base, the table format and the slave of that poll", () => {
    base = 1;
    format = "hex";
    get().openFor(POLL_ID, { address: 9, pollFunction: 3, slaveId: 4, raw: 255 });
    expect(get().draft).toMatchObject({
      address: "10",
      valueFormat: "hex",
      valueText: "0x00FF",
      slaveId: "4",
    });
  });

  it("sends the protocol address of a 1-based draft and reports the base of that send", async () => {
    base = 1;
    get().openFor(POLL_ID);
    get().updateDraft({ address: "11", valueText: "5" });
    await get().send();
    expect(ipc.callsOf("write")[0]).toEqual([
      { slaveId: 3, function: 6, address: 10, values: [5] },
      POLL_ID,
    ]);
    expect(get().requestBase).toBe(1);
  });
});

describe("FC05, FC15 and FC16 requests", () => {
  it("FC05 sends one coil value", async () => {
    get().openFor(POLL_ID);
    get().updateDraft({ function: "5", address: "4", coil: false });
    await get().send();
    expect(ipc.callsOf("write")[0]?.[0]).toEqual({
      slaveId: 3,
      function: 5,
      address: 4,
      values: [0],
    });
  });

  it("FC15 sends the 0/1 list and rejects other digits", async () => {
    get().openFor(POLL_ID);
    get().updateDraft({ function: "15", address: "0", valuesText: "1 0, 1\n1" });
    await get().send();
    expect(ipc.callsOf("write")[0]?.[0]).toMatchObject({ function: 15, values: [1, 0, 1, 1] });
    get().updateDraft({ valuesText: "1 2" });
    await get().send();
    expect(ipc.callsOf("write")).toHaveLength(1);
    expect(get().submitted).toBe(true);
  });

  it("whitespace always separates binary values: four nibbles are four values", () => {
    get().openFor(POLL_ID);
    get().updateDraft({
      function: "16",
      valueFormat: "binary",
      valuesText: "0000 0100 1101 0010",
    });
    expect(validateDraft(get().draft, 0)).toMatchObject({
      ok: true,
      value: { values: [0, 4, 13, 2] },
    });
    get().updateDraft({ valuesText: "0000010011010010" });
    expect(validateDraft(get().draft, 0)).toMatchObject({ ok: true, value: { values: [1234] } });
    get().updateDraft({ valuesText: "0b0000010011010010" });
    expect(validateDraft(get().draft, 0)).toMatchObject({ ok: true, value: { values: [1234] } });
  });

  it("a binary list item with a stray digit or no digits names its position", () => {
    get().openFor(POLL_ID);
    get().updateDraft({
      function: "16",
      valueFormat: "binary",
      valuesText: "0000 0100 1101 00102",
    });
    const result = validateDraft(get().draft, 0);
    expect(result.ok ? null : result.errors.valuesText).toBe(
      'Value 4 ("00102") is not valid: Enter up to 16 binary digits (0 or 1).',
    );
    get().updateDraft({ valuesText: "0b" });
    const empty = validateDraft(get().draft, 0);
    expect(empty.ok ? null : empty.errors.valuesText).toBe(
      'Value 1 ("0b") is not valid: Enter up to 16 binary digits (0 or 1).',
    );
  });

  it("a 17-digit binary value is too long", () => {
    get().openFor(POLL_ID);
    get().updateDraft({ function: "16", valueFormat: "binary", valuesText: "10000000000000000" });
    const result = validateDraft(get().draft, 0);
    expect(result.ok ? null : result.errors.valuesText).toBe(
      'Value 1 ("10000000000000000") is not valid: Enter up to 16 binary digits (0 or 1).',
    );
  });

  it("a single FC06 binary value keeps its nibble spaces", () => {
    get().openFor(POLL_ID);
    get().updateDraft({ valueFormat: "binary", valueText: "0000 0100 1101 0010" });
    expect(validateDraft(get().draft, 0)).toMatchObject({ ok: true, value: { values: [1234] } });
  });

  it("FC16 reports a range that ends after the last address", () => {
    get().openFor(POLL_ID);
    get().updateDraft({ function: "16", address: "65535", valuesText: "1 2" });
    const result = validateDraft(get().draft, 0);
    expect(result.ok ? null : result.errors.valuesText).toBe(
      "These values end after the last address (65535). At most 1 values fit from 65535.",
    );
  });
});

describe("queue semantics of one dialog", () => {
  it("a second Send is ignored while one is in flight", async () => {
    const held = ipc.hold("write");
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    const first = get().send();
    const second = get().send();
    held.release({ status: "ok" });
    await Promise.all([first, second]);
    expect(ipc.callsOf("write")).toHaveLength(1);
  });

  it("a write in flight when the link dropped is a linkLost result and keeps the draft", async () => {
    const held = ipc.hold("write");
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    const sending = get().send();
    held.release({ status: "linkLost" });
    await sending;
    expect(get()).toMatchObject({ status: "done", result: { status: "linkLost" } });
    expect(get().draft.valueText).toBe("5");
  });

  it("a queued write that never left answers notConnected", async () => {
    get().openFor(POLL_ID);
    get().updateDraft({ valueText: "5" });
    ipc.setResult("write", { status: "notConnected" });
    await get().send();
    expect(get().result).toEqual({ status: "notConnected" });
  });
});

describe("dialog context texts (DES-002 3.3, DES-003 3.5)", () => {
  it("the title is 'Write · {poll name}'", () => {
    expect(writeDialogTitle("Tank 1")).toBe("Write · Tank 1");
  });

  it("the read-only toast is the DES-001 S2 text", () => {
    expect(READ_ONLY_TOAST).toBe("Discrete inputs and input registers are read-only.");
  });

  const aliases = new Map([
    [0, "PT-201"],
    [2, "PT-203"],
    [3, "PT-204"],
  ]);

  it("aliasLineFor shows the alias of the target address", () => {
    expect(aliasLineFor(6, 0, 1, aliases)).toBe("Alias: PT-201");
    expect(aliasLineFor(5, 0, 1, aliases)).toBe("Alias: PT-201");
  });

  it("aliasLineFor has no line without an alias or with an invalid address", () => {
    expect(aliasLineFor(6, 1, 1, aliases)).toBeNull();
    expect(aliasLineFor(6, null, 1, aliases)).toBeNull();
    expect(aliasLineFor(6, 0, 1, new Map())).toBeNull();
  });

  it("aliasLineFor counts the other aliases in an FC15 or FC16 range", () => {
    expect(aliasLineFor(16, 0, 4, aliases)).toBe("Alias: PT-201 (+2 more with aliases)");
    expect(aliasLineFor(15, 0, 2, aliases)).toBe("Alias: PT-201");
    expect(aliasLineFor(16, 0, 1, aliases)).toBe("Alias: PT-201");
    expect(aliasLineFor(16, 0, 3, aliases)).toBe("Alias: PT-201 (+1 more with aliases)");
  });
});

describe("scaled preview seam (DES-003 3.5)", () => {
  const cell = (text: string, unit: string, marker: "none" | "outOfRange" | "clamped-low") => ({
    text,
    unit,
    marker,
    tooltip: null,
    label: text,
    override: null,
  });

  it("is hidden with the default provider, for every function", () => {
    const none = () => null;
    expect(writePreviewFor(6, 0, [5], none)).toBeNull();
    expect(writePreviewFor(16, 0, [5, 6], none)).toBeNull();
  });

  it("FC05 and FC15 never have a preview", () => {
    const some = () => cell("1.00", "mA", "none");
    expect(writePreviewFor(5, 0, [1], some)).toBeNull();
    expect(writePreviewFor(15, 0, [1, 0], some)).toBeNull();
  });

  it("FC06 shows the value, the unit and the out-of-range or clamped note", () => {
    expect(writePreviewFor(6, 4, [100], () => cell("12.50", "mA", "none"))).toEqual({
      text: "Scaled: 12.50 mA",
      tone: "neutral",
      icon: null,
    });
    expect(writePreviewFor(6, 4, [100], () => cell("22.00", "mA", "outOfRange"))).toEqual({
      text: "Scaled: 22.00 mA (out of range)",
      tone: "warning",
      icon: "triangle-alert",
    });
    expect(writePreviewFor(6, 4, [100], () => cell("4.00", "mA", "clamped-low"))).toEqual({
      text: "Scaled: 4.00 mA (clamped)",
      tone: "neutral",
      icon: "arrow-down-to-line",
    });
  });

  it("FC16 lists the first five values, each with the scale of its own address", () => {
    const seen: number[] = [];
    const provider = (raw: number, address: number) => {
      seen.push(address);
      return cell(String(raw / 10), "mA", "none");
    };
    const preview = writePreviewFor(16, 10, [10, 20, 30, 40, 50, 60, 70], provider);
    expect(preview?.text).toBe("Scaled: 1, 2, 3, 4, 5 … mA");
    expect(seen).toEqual([10, 11, 12, 13, 14]);
    expect(PREVIEW_VALUES).toBe(5);
  });

  describe("FC16 with the real provider (CHK3-F3, F10, F11)", () => {
    const providerFor = (scale: ScaleSettings | null, scaleOverrides: ScaleOverride[] = []) =>
      createScaled({
        scale,
        scaleOverrides,
        definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 20, scanRateMs: 100 },
        display: {
          format: "unsigned",
          addressBase: 0,
          showAlias: true,
          copyAlias: false,
          swapBytes: false,
          reverseWords: false,
        },
      });
    const divide = (divisor: number, decimals: number, unit: string): ScaleSettings => ({
      ...presetDefaults("divide"),
      divisor,
      decimals,
      unit,
    });
    const mA = (patch: Partial<ScaleSettings> = {}): ScaleSettings => ({
      ...presetDefaults("current4to20"),
      xMin: 4000,
      xMax: 20000,
      ...patch,
    });

    it("F3: one unit at the end, after ' …' when more than five values are given", () => {
      const p = providerFor(null, [{ start: 0, end: 9, scale: divide(10, 1, "°C") }]);
      expect(writePreviewFor(16, 0, [253, 254], p)).toEqual({
        text: "Scaled: 25.3, 25.4 °C",
        tone: "neutral",
        icon: null,
      });
      expect(writePreviewFor(16, 0, [253, 254, 255, 256, 257, 258, 259], p)?.text).toBe(
        "Scaled: 25.3, 25.4, 25.5, 25.6, 25.7 … °C",
      );
    });

    it("F10: different units get one unit each, and an address without a scale shows a dash", () => {
      const p = providerFor(null, [
        { start: 2, end: 2, scale: divide(10, 1, "°C") },
        { start: 3, end: 3, scale: divide(100, 2, "bar") },
      ]);
      expect(writePreviewFor(16, 2, [253, 1234], p)).toEqual({
        text: "Scaled: 25.3 °C, 12.34 bar",
        tone: "neutral",
        icon: null,
      });
      expect(writePreviewFor(16, 2, [253, 1234, 5], p)?.text).toBe("Scaled: 25.3 °C, 12.34 bar, —");
      // an empty unit differs from "°C" too
      const mixed = providerFor(null, [
        { start: 2, end: 2, scale: divide(10, 1, "°C") },
        { start: 3, end: 3, scale: divide(10, 1, "") },
      ]);
      expect(writePreviewFor(16, 2, [253, 254], mixed)?.text).toBe("Scaled: 25.3 °C, 25.4");
      // more than five values with differing units: nothing is added at the end
      expect(writePreviewFor(16, 2, [253, 1234, 5, 6, 7, 8], p)?.text).toBe(
        "Scaled: 25.3 °C, 12.34 bar, —, —, — …",
      );
      // nothing in the list has a scale: no preview
      expect(writePreviewFor(16, 10, [1, 2], p)).toBeNull();
    });

    it("F11: out of range and clamped values are marked, the unit stays at the end", () => {
      expect(
        writePreviewFor(16, 0, [0, 12000], providerFor(mA({ decimals: 2, outOfRange: "flag" }))),
      ).toEqual({
        text: "Scaled: 0.00 (out of range), 12.00 mA",
        tone: "warning",
        icon: "triangle-alert",
      });
      expect(
        writePreviewFor(16, 0, [0, 12000], providerFor(mA({ decimals: 2, outOfRange: "clamp" }))),
      ).toEqual({ text: "Scaled: 4.00 (clamped), 12.00 mA", tone: "neutral", icon: null });
    });

    it("any flagged value gives the warning tone, even among values with different units", () => {
      const p = providerFor(mA({ outOfRange: "flag" }), [
        { start: 1, end: 1, scale: divide(10, 1, "°C") },
      ]);
      expect(writePreviewFor(16, 0, [12000, 253, 0], p)).toEqual({
        text: "Scaled: 12.00 mA, 25.3 °C, 0.00 mA (out of range)",
        tone: "warning",
        icon: "triangle-alert",
      });
    });
  });
});
