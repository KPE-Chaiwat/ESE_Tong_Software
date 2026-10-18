import { createNativeReadyStore, type NativeReadyStoreApi } from "./native-ready.store";

let store: NativeReadyStoreApi;
beforeEach(() => {
  store = createNativeReadyStore();
});

describe("nativeReadyStore", () => {
  it("starts not ready", () => {
    expect(store.getState().ready).toBe(false);
  });
  it("markReady sets it and reset clears it", () => {
    store.getState().markReady();
    expect(store.getState().ready).toBe(true);
    store.getState().reset();
    expect(store.getState().ready).toBe(false);
  });
});
