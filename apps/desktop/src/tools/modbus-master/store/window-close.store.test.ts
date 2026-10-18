import { vi } from "vitest";
import type { WindowCloseSummary } from "./poll-host.logic";
import { createWindowCloseStore, type WindowCloseStoreApi } from "./window-close.store";

const CLEAN: WindowCloseSummary = {
  profileName: "Boiler-PLC",
  modified: false,
  nativeCount: 0,
  unappliedNames: [],
};
const DIRTY: WindowCloseSummary = { ...CLEAN, modified: true, nativeCount: 2 };

let summary: WindowCloseSummary;
let save: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let store: WindowCloseStoreApi;
const get = () => store.getState();

function make(withSave = true) {
  save = vi.fn<() => Promise<boolean>>(async () => true);
  store = createWindowCloseStore({ summary: () => summary, ...(withSave ? { save } : {}) });
}

beforeEach(() => {
  summary = CLEAN;
  make();
});

describe("windowCloseStore", () => {
  it("starts closed, and knows whether Save is possible", () => {
    expect(get()).toMatchObject({ asking: null, saving: false, canSave: true });
    make(false);
    expect(get().canSave).toBe(false);
  });

  it("closes at once when nothing is unsaved: no dialog, the window and its poll windows go", async () => {
    await expect(get().request()).resolves.toBe("close");
    expect(get().asking).toBeNull();
  });

  it("asks when the profile is modified, with what the dialog says", async () => {
    summary = DIRTY;
    const answer = get().request();
    expect(get().asking).toEqual(DIRTY);
    get().discard();
    await expect(answer).resolves.toBe("close");
    expect(get().asking).toBeNull();
  });

  it("asks for unapplied edits alone", async () => {
    summary = { ...CLEAN, unappliedNames: ["Pump 2"] };
    const answer = get().request();
    expect(get().asking).toMatchObject({ unappliedNames: ["Pump 2"] });
    get().cancel();
    await expect(answer).resolves.toBe("cancel");
  });

  it("Cancel keeps the window open and nothing is saved", async () => {
    summary = DIRTY;
    const answer = get().request();
    get().cancel();
    await expect(answer).resolves.toBe("cancel");
    expect(get().asking).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("Don't save closes without saving", async () => {
    summary = DIRTY;
    const answer = get().request();
    get().discard();
    await expect(answer).resolves.toBe("close");
    expect(save).not.toHaveBeenCalled();
  });

  it("Save saves, then closes", async () => {
    summary = DIRTY;
    const answer = get().request();
    await get().save();
    expect(save).toHaveBeenCalledOnce();
    await expect(answer).resolves.toBe("close");
    expect(get()).toMatchObject({ asking: null, saving: false });
  });

  it("a save that did not happen keeps the dialog open", async () => {
    summary = DIRTY;
    save.mockResolvedValueOnce(false);
    const answer = get().request();
    let settled = false;
    void answer.then(() => {
      settled = true;
    });
    await get().save();
    expect(get()).toMatchObject({ saving: false });
    expect(get().asking).toEqual(DIRTY);
    expect(settled).toBe(false);
    await get().save();
    await expect(answer).resolves.toBe("close");
  });

  it("a save that throws keeps the dialog open", async () => {
    summary = DIRTY;
    save.mockRejectedValueOnce(new Error("disk full"));
    void get().request();
    await get().save();
    expect(get().asking).toEqual(DIRTY);
    expect(get().saving).toBe(false);
  });

  it("is saving while Save runs, and a second Save is ignored", async () => {
    summary = DIRTY;
    let release: (ok: boolean) => void = () => {};
    save.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    void get().request();
    const first = get().save();
    expect(get().saving).toBe(true);
    await get().save();
    expect(save).toHaveBeenCalledOnce();
    release(true);
    await first;
    expect(get().saving).toBe(false);
  });

  it("without a save function Save does nothing and the dialog stays", async () => {
    make(false);
    summary = DIRTY;
    void get().request();
    await get().save();
    expect(get().asking).toEqual(DIRTY);
  });

  it("a second request while the dialog is open is answered cancel; only the first can close (REV-006 n-8)", async () => {
    summary = DIRTY;
    const first = get().request();
    const second = get().request();
    await expect(second).resolves.toBe("cancel");
    get().discard();
    await expect(first).resolves.toBe("close");
  });

  it("the answers do nothing when no dialog is open", () => {
    get().cancel();
    get().discard();
    expect(get().asking).toBeNull();
  });

  it("asks again at the next request", async () => {
    summary = DIRTY;
    const first = get().request();
    get().cancel();
    await first;
    const second = get().request();
    expect(get().asking).toEqual(DIRTY);
    get().discard();
    await expect(second).resolves.toBe("close");
  });
});
