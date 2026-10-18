import { vi } from "vitest";
import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import type { MonitorInfo } from "@/shared/ipc/modbus-master.types";
import { createFakeWindowIpc, type FakeWindowIpc } from "@/shared/ipc/window";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import {
  type ArrangeStoreApi,
  createArrangeStore,
  MONITOR_GONE_TOAST,
  NO_NATIVE_TOAST,
} from "./arrange.store";

let ipc: FakeModbusMasterIpc;
let win: FakeWindowIpc;
let toasts: ToastStoreApi;
let store: ArrangeStoreApi;
const get = () => store.getState();
const toastItems = () => toasts.getState().items.map((t) => ({ text: t.text, tone: t.tone }));

const monitor = (id: string, label: string, primary: boolean, x: number): MonitorInfo => ({
  id,
  label,
  name: id,
  primary,
  workArea: { x, y: 0, width: 1920, height: 1032 },
  scaleFactor: 1,
});

beforeEach(async () => {
  ipc = createFakeModbusMasterIpc({
    mode: "manual",
    monitors: [monitor("D1", "Display 1", true, 0), monitor("D2", "Display 2", false, 1920)],
  });
  await ipc.openSession(() => {});
  win = createFakeWindowIpc();
  win.monitors = ipc.monitors;
  toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  store = createArrangeStore({ ipc, windowIpc: win, toasts });
});

/** Opens `n` polls in their own windows. */
async function natives(n: number) {
  for (let i = 0; i < n; i += 1) {
    await ipc.addPoll(
      {
        name: `P${i + 1}`,
        definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
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
      },
      "native",
    );
  }
}

describe("arrangeStore", () => {
  it("starts with each monitor in place, no monitors, nothing pending", () => {
    expect(get()).toMatchObject({
      monitors: [],
      target: { kind: "eachMonitor" },
      pending: false,
      loaded: false,
    });
  });

  it("loads the displays, the primary first", async () => {
    await get().loadMonitors();
    expect(get().loaded).toBe(true);
    expect(get().monitors.map((m) => m.label)).toEqual(["Display 1", "Display 2"]);
    expect(get().monitors[0]?.primary).toBe(true);
  });

  it("a failed monitor list is quiet and leaves the list empty", async () => {
    win.monitorsError = "no monitors";
    await get().loadMonitors();
    expect(get()).toMatchObject({ monitors: [], loaded: true });
    expect(toastItems()).toEqual([]);
  });

  it("setTarget remembers the target", () => {
    get().setTarget({ kind: "monitor", monitorId: "D2" });
    expect(get().target).toEqual({ kind: "monitor", monitorId: "D2" });
    get().setTarget({ kind: "eachMonitor" });
    expect(get().target).toEqual({ kind: "eachMonitor" });
  });

  it("arrange sends the layout with the target and arranges the windows", async () => {
    await natives(4);
    await get().arrange("tile");
    expect(ipc.callsOf("arrangePollWindows")).toEqual([["tile", { kind: "eachMonitor" }]]);
    expect(toastItems()).toEqual([]);
    expect(get().pending).toBe(false);
  });

  it("a layout on one display sends the monitor id", async () => {
    await natives(2);
    get().setTarget({ kind: "monitor", monitorId: "D2" });
    await get().arrange("sideBySide");
    expect(ipc.callsOf("arrangePollWindows")).toEqual([
      ["sideBySide", { kind: "monitor", monitorId: "D2" }],
    ]);
  });

  it("with no window of its own the toast says so", async () => {
    await get().arrange("tile");
    expect(toastItems()).toEqual([{ text: "No poll is open in its own window.", tone: "default" }]);
    expect(NO_NATIVE_TOAST).toBe("No poll is open in its own window.");
  });

  it("windows that did not fit give the overflow toast", async () => {
    ipc.setResult("arrangePollWindows", { arranged: 13, overflow: 1 });
    await get().arrange("tile");
    expect(toastItems()).toEqual([
      { text: "1 window did not fit and was cascaded.", tone: "default" },
    ]);
    ipc.setResult("arrangePollWindows", { arranged: 13, overflow: 3 });
    await get().arrange("tile");
    expect(toasts.getState().items.at(-1)?.text).toBe("3 windows did not fit and were cascaded.");
  });

  it("a display that is gone: the toast, and the target goes back to each monitor", async () => {
    await natives(2);
    get().setTarget({ kind: "monitor", monitorId: "D9" });
    await get().arrange("tile");
    expect(toastItems()).toEqual([{ text: "That display is no longer connected.", tone: "error" }]);
    expect(MONITOR_GONE_TOAST).toBe("That display is no longer connected.");
    expect(get().target).toEqual({ kind: "eachMonitor" });
    // The list of displays is read again.
    await vi.waitFor(() => expect(get().loaded).toBe(true));
  });

  it("another failure shows its message and keeps the target", async () => {
    get().setTarget({ kind: "monitor", monitorId: "D2" });
    ipc.failNext("arrangePollWindows", new IpcError("The window could not be moved.", "internal"));
    await get().arrange("cascade");
    expect(toastItems()).toEqual([{ text: "The window could not be moved.", tone: "error" }]);
    expect(get().target).toEqual({ kind: "monitor", monitorId: "D2" });
    expect(get().pending).toBe(false);
  });

  it("is pending while the command runs and ignores a second one", async () => {
    await natives(2);
    const held = ipc.hold("arrangePollWindows");
    const first = get().arrange("tile");
    expect(get().pending).toBe(true);
    await get().arrange("stacked");
    expect(ipc.callsOf("arrangePollWindows")).toHaveLength(1);
    held.release({ arranged: 2, overflow: 0 });
    await first;
    expect(get().pending).toBe(false);
  });
});
