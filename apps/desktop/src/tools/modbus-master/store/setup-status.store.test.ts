import { attentionText, createSetupStatusStore } from "./setup-status.store";

describe("setup status store", () => {
  it("starts valid", () => {
    expect(createSetupStatusStore().getState()).toMatchObject({
      attentionCount: 0,
      pollInvalid: false,
      connectionInvalid: false,
    });
  });

  it("updates a part of the status", () => {
    const store = createSetupStatusStore();
    store.getState().update({ attentionCount: 2, pollInvalid: true });
    expect(store.getState()).toMatchObject({
      attentionCount: 2,
      pollInvalid: true,
      connectionInvalid: false,
    });
  });

  it("resets", () => {
    const store = createSetupStatusStore();
    store.getState().update({ attentionCount: 2, connectionInvalid: true });
    store.getState().reset();
    expect(store.getState()).toMatchObject({ attentionCount: 0, connectionInvalid: false });
  });
});

describe("attentionText", () => {
  it("uses the DES-001 wording", () => {
    expect(attentionText(0)).toBeNull();
    expect(attentionText(1)).toBe("1 field needs attention");
    expect(attentionText(3)).toBe("3 fields need attention");
  });
});
