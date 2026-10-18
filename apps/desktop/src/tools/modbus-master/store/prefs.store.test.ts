import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { createPrefsStore, type PrefsStoreApi } from "./prefs.store";

let ipc: FakeModbusMasterIpc;
let toasts: ToastStoreApi;
let store: PrefsStoreApi;
const get = () => store.getState();

beforeEach(() => {
  ipc = createFakeModbusMasterIpc({ mode: "manual" });
  toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  store = createPrefsStore({ ipc, toasts });
});

describe("prefsStore", () => {
  it("starts with the defaults: ask on close, not compact", () => {
    expect(get()).toMatchObject({ askOnPollClose: true, compact: false });
  });

  it("applies the snapshot and PrefsChanged", () => {
    get().applySnapshot({ askOnPollClose: false, compact: true });
    expect(get()).toMatchObject({ askOnPollClose: false, compact: true });
    get().applyPrefs({ askOnPollClose: true, compact: false });
    expect(get()).toMatchObject({ askOnPollClose: true, compact: false });
  });

  it("setCompact applies at once and tells Rust", async () => {
    const held = ipc.hold("setCompactMode");
    const p = get().setCompact(true);
    expect(get().compact).toBe(true);
    held.release();
    await p;
    expect(ipc.callsOf("setCompactMode")).toEqual([[true]]);
  });

  it("toggleCompact flips it", async () => {
    await get().toggleCompact();
    expect(get().compact).toBe(true);
    await get().toggleCompact();
    expect(get().compact).toBe(false);
    expect(ipc.callsOf("setCompactMode")).toEqual([[true], [false]]);
  });

  it("a rejected setCompact rolls back and shows the error", async () => {
    ipc.failNext("setCompactMode", "no");
    await get().setCompact(true);
    expect(get().compact).toBe(false);
    expect(toasts.getState().items.at(-1)).toMatchObject({ text: "no", tone: "error" });
  });

  it("a rollback does not undo a newer PrefsChanged", async () => {
    const held = ipc.hold("setCompactMode");
    const p = get().setCompact(true);
    get().applyPrefs({ askOnPollClose: true, compact: false });
    held.fail("late");
    await p;
    expect(get().compact).toBe(false);
  });

  it("setAskOnPollClose sends the preference; the same value sends nothing", async () => {
    await get().setAskOnPollClose(false);
    await get().setAskOnPollClose(false);
    expect(get().askOnPollClose).toBe(false);
    expect(ipc.callsOf("setAskOnPollClose")).toEqual([[false]]);
  });

  it("a rejected setAskOnPollClose rolls back", async () => {
    ipc.failNext("setAskOnPollClose", "nope");
    await get().setAskOnPollClose(false);
    expect(get().askOnPollClose).toBe(true);
    expect(toasts.getState().items).toHaveLength(1);
  });
});
