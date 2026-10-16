import { createDialogsStore } from "./dialogs.store";

describe("dialogs store", () => {
  it("starts with every dialog hidden", () => {
    expect(createDialogsStore().getState()).toMatchObject({
      openProfileVisible: false,
      saveAsVisible: false,
    });
  });

  it("shows and hides the Open profile dialog", () => {
    const store = createDialogsStore();
    store.getState().showOpenProfile();
    expect(store.getState().openProfileVisible).toBe(true);
    store.getState().hideOpenProfile();
    expect(store.getState().openProfileVisible).toBe(false);
  });

  it("resolves true when Save as saved the profile", async () => {
    const store = createDialogsStore();
    const result = store.getState().requestSaveAs();
    expect(store.getState().saveAsVisible).toBe(true);
    store.getState().resolveSaveAs(true);
    await expect(result).resolves.toBe(true);
    expect(store.getState().saveAsVisible).toBe(false);
  });

  it("resolves false when Save as is cancelled", async () => {
    const store = createDialogsStore();
    const result = store.getState().requestSaveAs();
    store.getState().resolveSaveAs(false);
    await expect(result).resolves.toBe(false);
    expect(store.getState().saveAsVisible).toBe(false);
  });

  it("answers false to a second request while one is open", async () => {
    const store = createDialogsStore();
    const first = store.getState().requestSaveAs();
    await expect(store.getState().requestSaveAs()).resolves.toBe(false);
    store.getState().resolveSaveAs(true);
    await expect(first).resolves.toBe(true);
  });

  it("ignores resolveSaveAs without a request", () => {
    const store = createDialogsStore();
    expect(() => store.getState().resolveSaveAs(true)).not.toThrow();
  });
});
