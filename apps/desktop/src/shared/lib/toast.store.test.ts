import { createToastStore } from "./toast.store";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts empty", () => {
    expect(createToastStore().getState().items).toEqual([]);
  });

  it("shows a toast and removes it after 2 seconds", () => {
    const store = createToastStore();
    const id = store.getState().show("Copied 2 rows.");
    expect(store.getState().items).toEqual([{ id, text: "Copied 2 rows.", tone: "default" }]);
    vi.advanceTimersByTime(1999);
    expect(store.getState().items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getState().items).toEqual([]);
  });

  it("keeps several toasts with distinct ids", () => {
    const store = createToastStore();
    const a = store.getState().show("a");
    const b = store.getState().show("b");
    expect(a).not.toBe(b);
    expect(store.getState().items.map((t) => t.text)).toEqual(["a", "b"]);
  });

  it("dismisses one toast and cancels its timer", () => {
    const store = createToastStore();
    const a = store.getState().show("a");
    store.getState().show("b");
    store.getState().dismiss(a);
    expect(store.getState().items.map((t) => t.text)).toEqual(["b"]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("ignores an unknown id", () => {
    const store = createToastStore();
    store.getState().show("a");
    store.getState().dismiss(999);
    expect(store.getState().items).toHaveLength(1);
  });

  it("clear removes everything and cancels timers", () => {
    const store = createToastStore();
    store.getState().show("a");
    store.getState().show("b");
    store.getState().clear();
    expect(store.getState().items).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows an error toast with its own duration (DES-001 3.5: 4 s)", () => {
    const store = createToastStore();
    store.getState().show("Fix the highlighted fields before saving.", {
      tone: "error",
      durationMs: 4000,
    });
    expect(store.getState().items[0]).toMatchObject({ tone: "error" });
    vi.advanceTimersByTime(3999);
    expect(store.getState().items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getState().items).toEqual([]);
  });

  it("uses a custom duration", () => {
    const store = createToastStore({ durationMs: 500 });
    store.getState().show("a");
    vi.advanceTimersByTime(500);
    expect(store.getState().items).toEqual([]);
  });
});
