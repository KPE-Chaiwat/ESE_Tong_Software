import { vi } from "vitest";
import type { PollConfig, ScaleSettings } from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "../lib/scale-presets";
import type { ScaleDraft } from "./poll-view-ui.store";
import {
  appliedFormOf,
  createScaleDraftStore,
  type ScaleDraftStoreApi,
  selectScaleDirty,
  selectScaleErrors,
  selectScaleFailed,
  selectScaleForm,
} from "./scale-draft.store";

function configOf(patch: Partial<PollConfig> = {}): PollConfig {
  return {
    pollId: 1 as PollConfig["pollId"],
    name: "Tank 1",
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 20, scanRateMs: 100 },
    active: true,
    display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false },
    scale: null,
    scaleOverrides: [],
    valueColumns: "raw",
    aliases: [],
    ...patch,
  };
}

let config: PollConfig;
let store: ScaleDraftStoreApi;
let applyScale: ReturnType<typeof vi.fn<(s: ScaleSettings | null) => Promise<boolean>>>;
let persisted: Array<ScaleDraft | null>;

function setup(initial: PollConfig = configOf()) {
  config = initial;
  persisted = [];
  applyScale = vi.fn(async (s: ScaleSettings | null) => {
    config = { ...config, scale: s };
    return true;
  });
  store = createScaleDraftStore({
    getConfig: () => config,
    applyScale,
    persist: (d) => persisted.push(d),
  });
  store.getState().syncApplied(config);
}

const form = () => selectScaleForm(store.getState());
const errors = () => selectScaleErrors(store.getState());

describe("initial state", () => {
  it("shows the applied scale (None) and no unapplied edits", () => {
    setup();
    expect(form()).toMatchObject({ preset: "none", rawSigned: false });
    expect(selectScaleDirty(store.getState())).toBe(false);
    expect(errors()).toEqual({});
    expect(selectScaleFailed(store.getState())).toBe(false);
    expect(persisted).toEqual([]);
  });

  it("a new scale starts raw signed when the poll shows Signed (B4)", () => {
    setup(configOf({ display: { ...configOf().display, format: "signed" } }));
    expect(form().rawSigned).toBe(true);
    expect(
      appliedFormOf(configOf({ display: { ...configOf().display, format: "hex" } })).rawSigned,
    ).toBe(false);
  });

  it("an applied scale is shown as texts", () => {
    setup(configOf({ scale: { ...presetDefaults("current4to20"), xMin: 4000, xMax: 20000 } }));
    expect(form()).toMatchObject({
      preset: "current4to20",
      xMin: "4000",
      xMax: "20000",
      unit: "mA",
    });
  });
});

describe("editing", () => {
  it("selecting 4-20 mA fills mA, 2 decimals and Y 4 and 20", () => {
    setup();
    store.getState().setPreset("current4to20");
    expect(form()).toMatchObject({
      preset: "current4to20",
      unit: "mA",
      decimals: "2",
      yMin: "4",
      yMax: "20",
      xMin: "0",
      xMax: "65535",
    });
    expect(selectScaleDirty(store.getState())).toBe(true);
    expect(persisted.at(-1)).toMatchObject({ dirty: true });
  });

  it("the quick pick 4000-20000 fills the raw fields", () => {
    setup();
    store.getState().setPreset("current4to20");
    store.getState().quickPick("4000-20000");
    expect(form()).toMatchObject({ xMin: "4000", xMax: "20000" });
    store.getState().quickPick("no such pick");
    expect(form().xMax).toBe("20000");
  });

  it("changing preset keeps the raw range and resets unit and decimals", () => {
    setup();
    store.getState().setPreset("current4to20");
    store.getState().quickPick("4000-20000");
    store.getState().setField("unit", "A");
    store.getState().setField("decimals", "5");
    store.getState().setPreset("voltage0to10");
    expect(form()).toMatchObject({ xMin: "4000", xMax: "20000", unit: "V", decimals: "2" });
  });

  it("Divide with 100 sets decimals to 2, 1000 to 3, 10 to 1, Custom to 2", () => {
    setup();
    store.getState().setPreset("divide");
    expect(form()).toMatchObject({ divisorMode: "10", decimals: "1" });
    store.getState().setDivisorMode("100");
    expect(form()).toMatchObject({ divisorMode: "100", divisor: "100", decimals: "2" });
    store.getState().setDivisorMode("1000");
    expect(form()).toMatchObject({ divisor: "1000", decimals: "3" });
    store.getState().setDivisorMode("custom");
    expect(form()).toMatchObject({ divisorMode: "custom", divisor: "", decimals: "2" });
    store.getState().setField("divisor", "4");
    store.getState().setDivisorMode("10");
    store.getState().setDivisorMode("custom");
    // the custom text is not kept across the buttons (it starts empty again)
    expect(form().divisor).toBe("");
  });

  it("typing the applied text back is no draft at all", () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setField("decimals", "3");
    expect(selectScaleDirty(store.getState())).toBe(true);
    store.getState().setField("decimals", "2");
    expect(selectScaleDirty(store.getState())).toBe(false);
    expect(persisted.at(-1)).toBeNull();
  });

  it("the out-of-range choice is part of the draft", () => {
    setup(configOf({ scale: presetDefaults("linear") }));
    store.getState().setOutOfRange("clamp");
    expect(form().outOfRange).toBe("clamp");
    expect(selectScaleDirty(store.getState())).toBe(true);
  });
});

describe("validation on blur", () => {
  it("Raw min = Raw max shows the message under Raw max", () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setField("xMin", "100");
    store.getState().setField("xMax", "100");
    // typing shows nothing yet
    expect(errors()).toEqual({});
    store.getState().blur("xMax");
    expect(errors()).toEqual({ xMax: "Raw min and raw max must be different." });
  });

  it("leaving one raw field also checks its partner; fixing the text and leaving clears it", () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setField("xMin", "100");
    store.getState().setField("xMax", "100");
    store.getState().blur("xMin");
    expect(errors().xMax).toBe("Raw min and raw max must be different.");
    store.getState().setField("xMax", "200");
    store.getState().blur("xMax");
    expect(errors()).toEqual({});
  });

  it("blurring without edits does nothing", () => {
    setup();
    store.getState().blur("xMin");
    expect(persisted).toEqual([]);
  });

  it("toggling Raw is signed re-validates the raw fields against the new range (C2)", () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setRawSigned(true);
    expect(errors()).toEqual({ xMax: "Raw max must be a whole number from -32768 to 32767." });
    store.getState().setRawSigned(false);
    expect(errors()).toEqual({});
  });

  it("a quick pick that does not fit the signed range reports it", () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setRawSigned(true);
    store.getState().quickPick("0-32767");
    expect(errors()).toEqual({});
    store.getState().quickPick("4000-20000");
    expect(errors()).toEqual({});
    store.getState().quickPick("0-65535");
    expect(errors().xMax).toBe("Raw max must be a whole number from -32768 to 32767.");
  });
});

describe("apply", () => {
  it("an invalid draft is not applied: messages, header, the draft stays, nothing is sent", async () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setField("xMin", "100");
    store.getState().setField("xMax", "100");
    const result = await store.getState().apply();
    expect(result).toEqual({ ok: false, applied: false, firstInvalid: "xMax" });
    expect(applyScale).not.toHaveBeenCalled();
    expect(errors()).toEqual({ xMax: "Raw min and raw max must be different." });
    expect(selectScaleFailed(store.getState())).toBe(true);
    expect(form()).toMatchObject({ xMin: "100", xMax: "100" });
    expect(persisted.at(-1)).toMatchObject({ dirty: true });
  });

  it("reports the first invalid field in field order", async () => {
    setup();
    store.getState().setPreset("linear");
    store.getState().setField("yMin", "x");
    store.getState().setField("unit", "x".repeat(13));
    const result = await store.getState().apply();
    expect(result.firstInvalid).toBe("yMin");
    expect(errors()).toMatchObject({
      yMin: "Engineering min must be a number, for example 4 or -12.5.",
      unit: "Unit must be at most 12 characters.",
    });
  });

  it("the header goes away when the last message is fixed and the field is left", async () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setField("decimals", "9");
    await store.getState().apply();
    expect(selectScaleFailed(store.getState())).toBe(true);
    store.getState().setField("decimals", "3");
    store.getState().blur("decimals");
    expect(selectScaleFailed(store.getState())).toBe(false);
  });

  it("a valid draft is sent once as settings and the draft clears", async () => {
    setup();
    store.getState().setPreset("current4to20");
    store.getState().quickPick("4000-20000");
    const result = await store.getState().apply();
    expect(result).toEqual({ ok: true, applied: true, firstInvalid: null });
    expect(applyScale).toHaveBeenCalledTimes(1);
    expect(applyScale).toHaveBeenCalledWith({
      ...presetDefaults("current4to20"),
      xMin: 4000,
      xMax: 20000,
    });
    expect(selectScaleDirty(store.getState())).toBe(false);
    expect(persisted.at(-1)).toBeNull();
  });

  it("None applies null", async () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setPreset("none");
    await store.getState().apply();
    expect(applyScale).toHaveBeenCalledWith(null);
  });

  it("a rejected command keeps the draft", async () => {
    setup();
    store.getState().setPreset("divide");
    applyScale.mockResolvedValueOnce(false);
    expect(await store.getState().apply()).toEqual({
      ok: false,
      applied: false,
      firstInvalid: null,
    });
    expect(selectScaleDirty(store.getState())).toBe(true);
    expect(store.getState().pending).toBe(false);
  });

  it("validate returns the settings without changing the state", () => {
    setup();
    store.getState().setPreset("divide");
    expect(store.getState().validate()).toMatchObject({ ok: true, settings: { divisor: 10 } });
    expect(persisted).toHaveLength(1);
  });
});

describe("reset, syncApplied and the handoff", () => {
  it("reset discards the edits", () => {
    setup();
    store.getState().setPreset("divide");
    store.getState().reset();
    expect(selectScaleDirty(store.getState())).toBe(false);
    expect(persisted.at(-1)).toBeNull();
  });

  it("when the applied scale becomes what was typed (another host applied it), the draft ends", () => {
    setup();
    store.getState().setPreset("divide");
    config = configOf({ scale: presetDefaults("divide") });
    store.getState().syncApplied(config);
    expect(selectScaleDirty(store.getState())).toBe(false);
    expect(persisted.at(-1)).toBeNull();
  });

  it("a different applied scale leaves the draft as typed", () => {
    setup();
    store.getState().setPreset("divide");
    store.getState().syncApplied(configOf({ scale: presetDefaults("current4to20") }));
    expect(selectScaleDirty(store.getState())).toBe(true);
    expect(form().preset).toBe("divide");
  });

  it("hydrate restores the typed text, the messages and the header of a draft that was persisted", async () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setField("xMin", "100");
    store.getState().setField("xMax", "100");
    await store.getState().apply();
    const draft = persisted.at(-1) as ScaleDraft;
    // the draft travels as JSON in the handoff
    const travelled = JSON.parse(JSON.stringify(draft)) as ScaleDraft;

    const other = createScaleDraftStore({
      getConfig: () => config,
      applyScale,
      persist: () => {},
    });
    other.getState().syncApplied(config);
    other.getState().hydrate(travelled);
    expect(selectScaleForm(other.getState())).toMatchObject({ xMin: "100", xMax: "100" });
    expect(selectScaleErrors(other.getState())).toEqual({
      xMax: "Raw min and raw max must be different.",
    });
    expect(selectScaleFailed(other.getState())).toBe(true);
    expect(selectScaleDirty(other.getState())).toBe(true);
  });

  it("hydrate drops a draft it cannot read (the mirror is emptied too) and clears on null", () => {
    setup(configOf({ scale: presetDefaults("current4to20") }));
    store.getState().setField("decimals", "3");
    store.getState().hydrate({ dirty: true, fields: { nonsense: 1 } });
    expect(selectScaleDirty(store.getState())).toBe(false);
    expect(persisted.at(-1)).toBeNull();
    store.getState().setField("decimals", "3");
    store.getState().hydrate(null);
    expect(selectScaleDirty(store.getState())).toBe(false);
    // an unknown field name in the stored messages is dropped
    store.getState().hydrate({
      dirty: true,
      fields: {
        form: { ...appliedFormOf(config), decimals: "9" },
        errors: { decimals: "Decimals must be a whole number from 0 to 6.", bogus: "x" },
        failed: false,
      },
    });
    expect(errors()).toEqual({ decimals: "Decimals must be a whole number from 0 to 6." });
  });
});
