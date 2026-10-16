import { type ConfirmSpec, createConfirmStore } from "./confirm.store";

const spec = (title: string): ConfirmSpec => ({
  title,
  body: "Body",
  buttons: [
    { id: "cancel", label: "Cancel" },
    { id: "ok", label: "OK", variant: "destructive" },
  ],
  defaultId: "cancel",
  cancelId: "cancel",
});

describe("confirm store", () => {
  it("starts with no dialog", () => {
    expect(createConfirmStore().getState()).toMatchObject({ current: null, queued: 0 });
  });

  it("shows a dialog and resolves with the pressed button", async () => {
    const store = createConfirmStore();
    const answer = store.getState().ask(spec("A"));
    expect(store.getState().current?.title).toBe("A");
    store.getState().resolve("ok");
    await expect(answer).resolves.toBe("ok");
    expect(store.getState().current).toBeNull();
  });

  it("queues a second dialog until the first is answered", async () => {
    const store = createConfirmStore();
    const first = store.getState().ask(spec("A"));
    const second = store.getState().ask(spec("B"));
    expect(store.getState().current?.title).toBe("A");
    expect(store.getState().queued).toBe(1);
    store.getState().resolve("cancel");
    await expect(first).resolves.toBe("cancel");
    expect(store.getState().current?.title).toBe("B");
    expect(store.getState().queued).toBe(0);
    store.getState().resolve("ok");
    await expect(second).resolves.toBe("ok");
    expect(store.getState().current).toBeNull();
  });

  it("ignores resolve without a dialog", () => {
    const store = createConfirmStore();
    expect(() => store.getState().resolve("ok")).not.toThrow();
  });
});
