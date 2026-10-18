import { vi } from "vitest";
import type { PollConfig, ScaleOverride } from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "../lib/scale-presets";
import {
  createOverrideDialogStore,
  initialOverrideForm,
  type OverrideDialogStoreApi,
} from "./override-dialog.store";
import type { PollScaleStoreApi } from "./poll-scale.store";

const divide = (divisor: number, unit = "") => ({ ...presetDefaults("divide"), divisor, unit });
const override = (start: number, end: number): ScaleOverride => ({
  start,
  end,
  scale: divide(10),
});

function configOf(patch: Partial<PollConfig> = {}): PollConfig {
  return {
    pollId: 1 as PollConfig["pollId"],
    name: "Tank 1",
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 20, scanRateMs: 100 },
    active: true,
    display: {
      format: "unsigned",
      addressBase: 0,
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
    ...patch,
  };
}

let config: PollConfig;
let store: OverrideDialogStoreApi;
let addOverrides: ReturnType<typeof vi.fn>;
let updateOverride: ReturnType<typeof vi.fn>;

function setup(initial: PollConfig = configOf()) {
  config = initial;
  addOverrides = vi.fn(async () => true);
  updateOverride = vi.fn(async () => true);
  store = createOverrideDialogStore({
    getConfig: () => config,
    scale: {
      getState: () => ({ addOverrides, updateOverride }),
    } as unknown as Pick<PollScaleStoreApi, "getState">,
  });
}

describe("open", () => {
  it("is closed at first", () => {
    setup();
    expect(store.getState()).toMatchObject({ open: false, ranges: [], errors: {}, pending: false });
  });

  it("from a selection: the ranges are fixed and the form starts as Divide by 10", () => {
    setup();
    expect(
      store.getState().openForSelection([
        { start: 0, end: 1 },
        { start: 5, end: 5 },
        { start: 9, end: 12 },
      ]),
    ).toBe(true);
    expect(store.getState()).toMatchObject({
      open: true,
      mode: "selection",
      ranges: [
        { start: 0, end: 1 },
        { start: 5, end: 5 },
        { start: 9, end: 12 },
      ],
    });
    expect(store.getState().form).toMatchObject({
      preset: "divide",
      divisorMode: "10",
      decimals: "1",
    });
  });

  it("nothing selected opens nothing", () => {
    setup();
    expect(store.getState().openForSelection([])).toBe(false);
    expect(store.getState().open).toBe(false);
  });

  it("starts from the poll scale when the poll has one", () => {
    setup(configOf({ scale: { ...presetDefaults("current4to20"), xMax: 4095 } }));
    store.getState().openForSelection([{ start: 0, end: 0 }]);
    expect(store.getState().form).toMatchObject({
      preset: "current4to20",
      xMax: "4095",
      unit: "mA",
    });
    expect(initialOverrideForm(null)).toMatchObject({ preset: "divide" });
  });

  it("starts raw signed when the poll shows Signed", () => {
    setup(configOf({ display: { ...configOf().display, format: "signed" } }));
    store.getState().openForSelection([{ start: 0, end: 0 }]);
    expect(store.getState().form.rawSigned).toBe(true);
  });

  it("[+ Add override] opens with Start and End in the display base", () => {
    setup(configOf({ display: { ...configOf().display, addressBase: 1 } }));
    store.getState().openNew(4);
    expect(store.getState()).toMatchObject({ mode: "new", startText: "5", endText: "5" });
    store.getState().openNew();
    expect(store.getState()).toMatchObject({ startText: "1", endText: "1" });
  });

  it("[Edit] opens an override with its range and scale", () => {
    setup(
      configOf({
        scaleOverrides: [override(0, 3), { start: 8, end: 9, scale: divide(100, "bar") }],
      }),
    );
    store.getState().openEdit(1);
    expect(store.getState()).toMatchObject({
      mode: "edit",
      editingIndex: 1,
      startText: "8",
      endText: "9",
    });
    expect(store.getState().form).toMatchObject({ divisorMode: "100", unit: "bar" });
    store.getState().close();
    store.getState().openEdit(5);
    expect(store.getState().open).toBe(false);
  });

  it("close resets everything", () => {
    setup();
    store.getState().openNew(3);
    store.getState().setStart("x");
    store.getState().close();
    expect(store.getState()).toMatchObject({ open: false, startText: "", rangeError: null });
  });
});

describe("saving a selection", () => {
  it("creates one override per range with the scale of the form (D1)", async () => {
    setup();
    store.getState().openForSelection([
      { start: 0, end: 1 },
      { start: 5, end: 5 },
      { start: 9, end: 12 },
    ]);
    expect(await store.getState().save()).toBe(true);
    expect(addOverrides).toHaveBeenCalledTimes(1);
    expect(addOverrides).toHaveBeenCalledWith(
      [
        { start: 0, end: 1 },
        { start: 5, end: 5 },
        { start: 9, end: 12 },
      ],
      divide(10),
    );
    expect(store.getState().open).toBe(false);
  });

  it("an overlap with an existing override is reported and nothing is sent (D2)", async () => {
    setup(configOf({ scaleOverrides: [override(8, 12)] }));
    store.getState().openForSelection([{ start: 5, end: 9 }]);
    expect(await store.getState().save()).toBe(false);
    expect(store.getState().rangeError).toBe("This range overlaps the override for 8-12.");
    expect(store.getState().open).toBe(true);
    expect(addOverrides).not.toHaveBeenCalled();
  });

  it("an invalid scale is reported and nothing is sent", async () => {
    setup();
    store.getState().openForSelection([{ start: 0, end: 0 }]);
    store.getState().setDivisorMode("custom");
    store.getState().setField("divisor", "0");
    expect(await store.getState().save()).toBe(false);
    expect(store.getState().errors).toEqual({ divisor: "Divisor must be a number other than 0." });
    expect(addOverrides).not.toHaveBeenCalled();
  });

  it("the preset can be changed before saving", async () => {
    setup();
    store.getState().openForSelection([{ start: 0, end: 3 }]);
    store.getState().setPreset("current4to20");
    store.getState().quickPick("4000-20000");
    await store.getState().save();
    expect(addOverrides.mock.calls[0]?.[1]).toMatchObject({
      preset: "current4to20",
      xMin: 4000,
      xMax: 20000,
      unit: "mA",
    });
  });

  it("a command that fails keeps the dialog open", async () => {
    setup();
    addOverrides.mockResolvedValueOnce(false);
    store.getState().openForSelection([{ start: 0, end: 0 }]);
    expect(await store.getState().save()).toBe(false);
    expect(store.getState()).toMatchObject({ open: true, pending: false });
  });
});

describe("saving from the list", () => {
  it("validates Start and End in the display base and converts them", async () => {
    setup(configOf({ display: { ...configOf().display, addressBase: 1 } }));
    store.getState().openNew();
    store.getState().setStart("0");
    store.getState().setEnd("3");
    expect(await store.getState().save()).toBe(false);
    expect(store.getState().startError).toBe(
      "Start address must be a whole number from 1 to 65536.",
    );
    store.getState().setStart("1");
    expect(await store.getState().save()).toBe(true);
    expect(addOverrides.mock.calls[0]?.[0]).toEqual([{ start: 0, end: 2 }]);
  });

  it("end before start (D3)", async () => {
    setup();
    store.getState().openNew();
    store.getState().setStart("5");
    store.getState().setEnd("3");
    store.getState().blurRange();
    expect(store.getState().endError).toBe("End address must not be before the start address.");
    expect(await store.getState().save()).toBe(false);
  });

  it("overlap and the 64-override limit (D2, D5)", async () => {
    setup(configOf({ scaleOverrides: [override(8, 12)] }));
    store.getState().openNew();
    store.getState().setStart("5");
    store.getState().setEnd("9");
    expect(await store.getState().save()).toBe(false);
    expect(store.getState().rangeError).toBe("This range overlaps the override for 8-12.");

    const many = Array.from({ length: 64 }, (_, i) => override(i * 2, i * 2));
    setup(configOf({ scaleOverrides: many }));
    store.getState().openNew();
    store.getState().setStart("1000");
    store.getState().setEnd("1000");
    expect(await store.getState().save()).toBe(false);
    expect(store.getState().rangeError).toBe("A poll can have at most 64 scale overrides.");
  });

  it("editing saves with updateOverride and may keep its own range", async () => {
    setup(configOf({ scaleOverrides: [override(0, 3), override(8, 9)] }));
    store.getState().openEdit(0);
    store.getState().setDivisorMode("100");
    expect(await store.getState().save()).toBe(true);
    expect(updateOverride).toHaveBeenCalledWith(0, {
      start: 0,
      end: 3,
      scale: { ...divide(100), decimals: 2 },
    });
    expect(addOverrides).not.toHaveBeenCalled();
  });

  it("editing cannot move onto another override", async () => {
    setup(configOf({ scaleOverrides: [override(0, 3), override(8, 9)] }));
    store.getState().openEdit(0);
    store.getState().setEnd("8");
    expect(await store.getState().save()).toBe(false);
    expect(store.getState().rangeError).toBe("This range overlaps the override for 8-9.");
  });
});

describe("editing the scale in the dialog", () => {
  it("raw signed re-validates, a quick pick fills, blur shows a message", () => {
    setup();
    store.getState().openForSelection([{ start: 0, end: 0 }]);
    store.getState().setPreset("linear");
    store.getState().setRawSigned(true);
    expect(store.getState().errors).toEqual({
      xMax: "Raw max must be a whole number from -32768 to 32767.",
    });
    store.getState().quickPick("0-32767");
    expect(store.getState().errors).toEqual({});
    store.getState().setField("yMin", "abc");
    store.getState().blur("yMin");
    expect(store.getState().errors.yMin).toBe(
      "Engineering min must be a number, for example 4 or -12.5.",
    );
    store.getState().setOutOfRange("clamp");
    expect(store.getState().form.outOfRange).toBe("clamp");
  });
});
