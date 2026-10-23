import { vi } from "vitest";
import type {
  PollConfig,
  PollViewSettings,
  ScaleOverride,
  ScaleSettings,
} from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "../lib/scale-presets";
import { nextValueColumns, withoutOverridesIn } from "./poll-scale.logic";
import { createPollScaleStore, type PollScaleStoreApi } from "./poll-scale.store";

const mA = presetDefaults("current4to20");
const divide = (divisor: number): ScaleSettings => ({ ...presetDefaults("divide"), divisor });
const override = (start: number, end: number, scale = divide(10)): ScaleOverride => ({
  start,
  end,
  scale,
});

function configOf(patch: Partial<PollConfig> = {}): PollConfig {
  return {
    pollId: 1 as PollConfig["pollId"],
    name: "Tank 1",
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 20, scanRateMs: 100 },
    active: true,
    display: { addressBase: 0, showAlias: true, copyAlias: false },
    formatOverrides: [],
    colorRules: [],
    scale: null,
    scaleOverrides: [],
    valueColumns: "raw",
    aliases: [],
    ...patch,
  };
}

let config: PollConfig;
let setView: ReturnType<typeof vi.fn<(partial: Partial<PollViewSettings>) => Promise<boolean>>>;
let store: PollScaleStoreApi;

/** The store follows the config like the runtime does: an applied patch becomes the next config. */
function setup(initial: PollConfig = configOf()) {
  config = initial;
  setView = vi.fn(async (partial: Partial<PollViewSettings>) => {
    config = {
      ...config,
      ...(partial.scale === undefined ? {} : { scale: partial.scale }),
      ...(partial.scaleOverrides === undefined ? {} : { scaleOverrides: partial.scaleOverrides }),
      ...(partial.valueColumns === undefined ? {} : { valueColumns: partial.valueColumns }),
    };
    store.getState().applyFromConfig(config);
    return true;
  });
  store = createPollScaleStore({ getConfig: () => config, setView });
  store.getState().applyFromConfig(config);
}

describe("initial state and applyFromConfig", () => {
  it("starts empty and mirrors the config", () => {
    setup();
    expect(store.getState()).toMatchObject({
      scale: null,
      overrides: [],
      valueColumns: "raw",
      scaleActive: true,
      pending: false,
    });
    const o = [override(0, 3)];
    store
      .getState()
      .applyFromConfig(configOf({ scale: mA, scaleOverrides: o, valueColumns: "both" }));
    expect(store.getState()).toMatchObject({ scale: mA, overrides: o, valueColumns: "both" });
    expect(store.getState().display).toMatchObject({ addressBase: 0 });
  });

  it("with FC01 or FC02 the scale is inactive but kept", () => {
    setup();
    store.getState().applyFromConfig(
      configOf({
        scale: mA,
        definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
      }),
    );
    expect(store.getState()).toMatchObject({ scaleActive: false, scale: mA });
  });
});

describe("applyScale and clearScale", () => {
  it("the first scale switches the table to Both, in the same patch (one call)", async () => {
    setup();
    expect(await store.getState().applyScale(mA)).toBe(true);
    expect(setView).toHaveBeenCalledTimes(1);
    expect(setView).toHaveBeenCalledWith({ scale: mA, valueColumns: "both" });
    expect(store.getState()).toMatchObject({ scale: mA, valueColumns: "both" });
  });

  it("a second scale keeps the user's choice of columns", async () => {
    setup(configOf({ scale: mA, valueColumns: "scaled" }));
    await store.getState().applyScale(divide(100));
    expect(setView).toHaveBeenCalledWith({ scale: divide(100) });
    expect(store.getState().valueColumns).toBe("scaled");
  });

  it("a scale added while an override exists does not change the columns", async () => {
    setup(configOf({ scaleOverrides: [override(0, 1)], valueColumns: "scaled" }));
    await store.getState().applyScale(mA);
    expect(setView).toHaveBeenCalledWith({ scale: mA });
  });

  it("None (or null) removes the scale with `scale: null` and goes back to Raw when nothing is left", async () => {
    setup(configOf({ scale: mA, valueColumns: "both" }));
    await store.getState().applyScale(presetDefaults("none"));
    expect(setView).toHaveBeenCalledWith({ scale: null, valueColumns: "raw" });
    expect(store.getState()).toMatchObject({ scale: null, valueColumns: "raw" });
  });

  it("clearScale keeps the columns while an override remains", async () => {
    setup(configOf({ scale: mA, scaleOverrides: [override(0, 1)], valueColumns: "both" }));
    await store.getState().clearScale();
    expect(setView).toHaveBeenCalledWith({ scale: null });
  });

  it("the same scale with its keys in another order sends nothing (n-5)", async () => {
    setup(configOf({ scale: mA, valueColumns: "both" }));
    const reordered = Object.fromEntries(Object.entries(mA).reverse()) as ScaleSettings;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(mA)[0]);
    expect(await store.getState().applyScale(reordered)).toBe(true);
    expect(setView).not.toHaveBeenCalled();
    expect(await store.getState().applyScale({ ...mA, decimals: 3 })).toBe(true);
    expect(setView).toHaveBeenCalledTimes(1);
  });

  it("the same scale again sends nothing", async () => {
    setup(configOf({ scale: mA, valueColumns: "both" }));
    expect(await store.getState().applyScale({ ...mA })).toBe(true);
    expect(await store.getState().applyScale(null)).toBe(true); // changes: sends
    setView.mockClear();
    expect(await store.getState().applyScale(null)).toBe(true);
    expect(setView).not.toHaveBeenCalled();
  });

  it("a rejected command returns false and the pending flag clears", async () => {
    setup();
    setView.mockResolvedValueOnce(false);
    expect(await store.getState().applyScale(mA)).toBe(false);
    expect(store.getState().pending).toBe(false);
  });

  it("pending is true while the command runs", async () => {
    setup();
    let release: (v: boolean) => void = () => {};
    setView.mockImplementationOnce(() => new Promise<boolean>((r) => (release = r)));
    const done = store.getState().applyScale(mA);
    expect(store.getState().pending).toBe(true);
    release(true);
    await done;
    expect(store.getState().pending).toBe(false);
  });
});

describe("overrides", () => {
  it("addOverrides makes one override per range, sorted, and switches to Both when it is the first scale", async () => {
    setup();
    const ok = await store.getState().addOverrides(
      [
        { start: 9, end: 12 },
        { start: 0, end: 1 },
        { start: 5, end: 5 },
      ],
      divide(10),
    );
    expect(ok).toBe(true);
    expect(setView).toHaveBeenCalledTimes(1);
    const patch = setView.mock.calls[0]?.[0];
    expect(patch?.scaleOverrides?.map((o) => [o.start, o.end])).toEqual([
      [0, 1],
      [5, 5],
      [9, 12],
    ]);
    expect(patch?.valueColumns).toBe("both");
    // each override owns its copy of the scale
    expect(patch?.scaleOverrides?.[0]?.scale).not.toBe(patch?.scaleOverrides?.[1]?.scale);
  });

  it("refuses overlapping ranges and more than 64 without a command", async () => {
    setup(configOf({ scaleOverrides: [override(8, 12)] }));
    expect(await store.getState().addOverrides([{ start: 5, end: 9 }], divide(10))).toBe(false);
    const many = Array.from({ length: 64 }, (_, i) => override(i * 2, i * 2));
    setup(configOf({ scaleOverrides: many }));
    expect(await store.getState().addOverrides([{ start: 1000, end: 1000 }], divide(10))).toBe(
      false,
    );
    expect(setView).not.toHaveBeenCalled();
  });

  it("an empty list of ranges does nothing", async () => {
    setup();
    expect(await store.getState().addOverrides([], divide(10))).toBe(false);
    expect(setView).not.toHaveBeenCalled();
  });

  it("updateOverride replaces one override, once", async () => {
    setup(
      configOf({
        scale: mA,
        scaleOverrides: [override(0, 3), override(8, 9)],
        valueColumns: "both",
      }),
    );
    await store.getState().updateOverride(1, override(10, 12, divide(100)));
    expect(setView).toHaveBeenCalledTimes(1);
    expect(store.getState().overrides.map((o) => [o.start, o.end])).toEqual([
      [0, 3],
      [10, 12],
    ]);
  });

  it("updateOverride refuses an overlap with another override and an unknown index", async () => {
    setup(configOf({ scaleOverrides: [override(0, 3), override(8, 9)] }));
    expect(await store.getState().updateOverride(1, override(2, 9))).toBe(false);
    expect(await store.getState().updateOverride(5, override(20, 21))).toBe(false);
    expect(setView).not.toHaveBeenCalled();
  });

  it("removeOverrides removes every override a selection touches (two at once)", async () => {
    setup(
      configOf({
        scaleOverrides: [override(0, 3), override(5, 6), override(8, 9)],
        valueColumns: "both",
      }),
    );
    await store.getState().removeOverrides([{ start: 3, end: 5 }]);
    expect(setView).toHaveBeenCalledTimes(1);
    expect(store.getState().overrides.map((o) => [o.start, o.end])).toEqual([[8, 9]]);
  });

  it("removing the last scale of the poll goes back to Raw", async () => {
    setup(configOf({ scaleOverrides: [override(0, 3)], valueColumns: "scaled" }));
    await store.getState().removeOverrides([{ start: 0, end: 0 }]);
    expect(setView).toHaveBeenCalledWith({ scaleOverrides: [], valueColumns: "raw" });
  });

  it("removing where there is no override sends nothing", async () => {
    setup(configOf({ scaleOverrides: [override(0, 3)] }));
    expect(await store.getState().removeOverrides([{ start: 10, end: 12 }])).toBe(false);
    expect(setView).not.toHaveBeenCalled();
  });

  it("withoutOverridesIn keeps the others in order", () => {
    expect(
      withoutOverridesIn([override(0, 1), override(5, 6)], [{ start: 6, end: 9 }]).map(
        (o) => o.start,
      ),
    ).toEqual([0]);
  });
});

describe("value columns", () => {
  it("cycles Raw, Scaled, Both, Raw", async () => {
    setup(configOf({ scale: mA, valueColumns: "raw" }));
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await store.getState().cycleValueColumns();
      seen.push(store.getState().valueColumns);
    }
    expect(seen).toEqual(["scaled", "both", "raw", "scaled"]);
    expect(setView).toHaveBeenCalledTimes(4);
  });

  it("without any scale the cycle stays on Raw and sends nothing", async () => {
    setup();
    await store.getState().cycleValueColumns();
    expect(store.getState().valueColumns).toBe("raw");
    expect(setView).not.toHaveBeenCalled();
    expect(nextValueColumns("both", false)).toBe("raw");
  });

  it("a stored Scaled or Both without any scale: the cycle does nothing and rewrites nothing", async () => {
    setup(configOf({ valueColumns: "scaled" }));
    expect(await store.getState().cycleValueColumns()).toBe(true);
    expect(setView).not.toHaveBeenCalled();
    expect(store.getState().valueColumns).toBe("scaled");
  });

  it("on a coil poll the cycle does nothing either (Raw only is shown)", async () => {
    setup(
      configOf({
        scale: mA,
        valueColumns: "both",
        definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
      }),
    );
    await store.getState().cycleValueColumns();
    expect(setView).not.toHaveBeenCalled();
  });

  it("setValueColumns sends only a change", async () => {
    setup(configOf({ scale: mA, valueColumns: "both" }));
    await store.getState().setValueColumns("both");
    expect(setView).not.toHaveBeenCalled();
    await store.getState().setValueColumns("raw");
    expect(setView).toHaveBeenCalledWith({ valueColumns: "raw" });
  });
});
