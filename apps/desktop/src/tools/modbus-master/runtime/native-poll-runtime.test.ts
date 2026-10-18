import { vi } from "vitest";
import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type { ConnectionConfig, PollId } from "@/shared/ipc/modbus-master.types";
import { createFakeWindowIpc, type FakeWindowIpc } from "@/shared/ipc/window";
import { createNativePollRuntime, type NativePollRuntime } from "./native-poll-runtime";

const TCP: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };

let ipc: FakeModbusMasterIpc;
let win: FakeWindowIpc;
let rt: NativePollRuntime;
let pollId: PollId;
const live: NativePollRuntime[] = [];

async function make(
  options: {
    prepare?: (ipc: FakeModbusMasterIpc, id: PollId) => Promise<void> | void;
    init?: boolean;
  } = {},
) {
  ipc = createFakeModbusMasterIpc({ mode: "virtual" });
  win = createFakeWindowIpc();
  await ipc.openSession(() => {});
  pollId = await ipc.addPoll(pollConfigInput({ name: "Pump 2" }), "native");
  await options.prepare?.(ipc, pollId);
  rt = createNativePollRuntime(ipc, win, { pollId, warn: () => {}, blurEditors: () => {} });
  live.push(rt);
  if (options.init !== false) await rt.init();
}

afterEach(() => {
  for (const r of live.splice(0)) r.dispose();
});

const toastTexts = () => rt.stores.toasts.getState().items.map((t) => t.text);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("native poll runtime", () => {
  it("attaches one native view for its poll and learns the connection from it", async () => {
    await make();
    expect(ipc.attachedViews()).toEqual([expect.objectContaining({ pollId, host: "native" })]);
    expect(rt.stores.connection.getState()).toMatchObject({ ready: true, state: "idle" });
    expect(rt.view.host).toBe("native");
    expect(rt.pollId).toBe(pollId);
    expect(rt.stores.connection.getState().ready).toBe(true);
  });

  it("init is idempotent", async () => {
    await make();
    await rt.init();
    expect(ipc.callsOf("attachPollView")).toHaveLength(1);
  });

  it("takes the preferences of the snapshot and of PrefsChanged", async () => {
    await make({
      prepare: async (i) => {
        await i.setCompactMode(true);
        await i.setAskOnPollClose(false);
      },
    });
    expect(rt.stores.prefs.getState()).toMatchObject({ compact: true, askOnPollClose: false });
    expect(rt.view.stores.ui.getState().compact).toBe(true);
    await ipc.setCompactMode(false);
    await ipc.setAskOnPollClose(true);
    expect(rt.stores.prefs.getState()).toMatchObject({ compact: false, askOnPollClose: true });
    expect(rt.view.stores.ui.getState().compact).toBe(false);
  });

  it("the view of a native window gets the dock, close, delete, traffic and duplicate actions and no pop out", async () => {
    await make();
    const a = rt.view.hostActions;
    expect(a.dock).toBeTypeOf("function");
    expect(a.close).toBeTypeOf("function");
    expect(a.deletePoll).toBeTypeOf("function");
    expect(a.showTraffic).toBeTypeOf("function");
    expect(a.duplicate).toBeTypeOf("function");
    expect(a.popOut).toBeUndefined();
  });

  it("the OS close request opens S6 and says cancel; Rust destroys the window after the answer", async () => {
    await make();
    await tick();
    await expect(win.requestClose()).resolves.toBe(false);
    expect(rt.stores.host.getState().closing).toBe(pollId);
    expect(win.closed).toBe(false);
  });

  it("a window whose attach failed can still be closed with the OS close (REV-006 m-5)", async () => {
    ipc = createFakeModbusMasterIpc({ mode: "virtual" });
    win = createFakeWindowIpc();
    ipc.failNext("attachPollView", "internal error");
    rt = createNativePollRuntime(ipc, win, { pollId: 99, warn: () => {}, blurEditors: () => {} });
    live.push(rt);
    await rt.init().catch(() => {});
    await tick();
    expect(rt.view.stores.poll.getState().config).toBeNull();
    await expect(win.requestClose()).resolves.toBe(true);
    expect(rt.stores.host.getState().closing).toBeNull();
  });

  it("a detached view (Rust is destroying the window) closes without asking", async () => {
    await make();
    await tick();
    await ipc.closePollView(pollId, true);
    expect(rt.view.stores.poll.getState().attach).toBe("detached");
    await expect(win.requestClose()).resolves.toBe(true);
  });

  it("dispose removes the close handler, the view and its channel", async () => {
    await make();
    await tick();
    rt.dispose();
    await expect(win.requestClose()).resolves.toBe(true);
    expect(ipc.attachedViews()).toEqual([]);
  });

  it("a handoff request is answered with the handoff of the view", async () => {
    await make();
    rt.view.stores.ui.getState().patchPollDraft("quantity", "20");
    await ipc.dockPoll(pollId, null, true, null);
    const [call] = ipc.callsOf("provideHandoff") as Array<[PollId, string | null]>;
    expect(call?.[0]).toBe(pollId);
    expect(JSON.parse(call?.[1] ?? "{}")).toMatchObject({ pollDraft: { quantity: "20" } });
  });

  it("a handoff request is refused while S6 is open", async () => {
    await make();
    rt.stores.host.getState().requestClose(pollId);
    await expect(ipc.dockPoll(pollId, null, true, null)).rejects.toMatchObject({
      field: "handoff",
    });
    expect(ipc.callsOf("provideHandoff")).toEqual([[pollId, null]]);
  });

  describe("actions", () => {
    it("connectOrReconnect connects with the known connection when the link is down, and only then", async () => {
      await make();
      await rt.actions.connectOrReconnect();
      expect(ipc.callsOf("connect")).toHaveLength(0);
      await rt.stores.connection.getState().connect(TCP);
      ipc.advance(300);
      await rt.actions.connectOrReconnect();
      expect(ipc.callsOf("connect")).toHaveLength(1);
      ipc.dropLink();
      await rt.actions.connectOrReconnect();
      expect(ipc.callsOf("connect")).toEqual([[TCP], [TCP]]);
    });

    it("the native window cannot disconnect or cancel", async () => {
      await make();
      await rt.stores.connection.getState().connect(TCP);
      ipc.advance(300);
      await rt.stores.connection.getState().disconnect();
      await rt.stores.connection.getState().cancelConnect();
      expect(ipc.callsOf("disconnect")).toHaveLength(0);
      expect(ipc.callsOf("cancelConnect")).toHaveLength(0);
    });

    it("toggleActive pauses a running poll and resumes a paused one", async () => {
      await make();
      await rt.stores.connection.getState().connect(TCP);
      await ipc.setAllPollsActive(true);
      ipc.advance(300);
      await rt.actions.toggleActive();
      expect(ipc.callsOf("setPollActive")).toEqual([[pollId, false]]);
      await rt.actions.toggleActive();
      expect(ipc.callsOf("setPollActive")[1]).toEqual([pollId, true]);
    });

    it("focusConnectionWindow, showTraffic and duplicate call Rust; a failure is a toast", async () => {
      await make();
      await rt.actions.focusConnectionWindow();
      await rt.actions.showTraffic();
      await rt.actions.duplicate();
      expect(ipc.callsOf("focusConnectionWindow")).toHaveLength(1);
      expect(ipc.callsOf("showTraffic")).toEqual([[pollId]]);
      expect(ipc.callsOf("duplicatePoll")).toEqual([[pollId]]);
      ipc.failNext("focusConnectionWindow", new IpcError("no window", "internal"));
      await rt.actions.focusConnectionWindow();
      ipc.failNext("showTraffic", "not now");
      await rt.actions.showTraffic();
      ipc.failNext("duplicatePoll", "full");
      await rt.actions.duplicate();
      expect(toastTexts()).toEqual(["no window", "not now", "full"]);
    });

    it("dock sends the handoff of this view", async () => {
      await make();
      await rt.actions.dock();
      expect(ipc.callsOf("dockPoll")).toHaveLength(1);
      expect(ipc.pollSummary(pollId).host).toBe("workspace");
    });

    it("toggleCompact flips compact mode in Rust and rolls back when rejected", async () => {
      await make();
      await rt.actions.toggleCompact();
      expect(ipc.compact).toBe(true);
      ipc.failNext("setCompactMode", "no");
      await rt.actions.toggleCompact();
      expect(rt.stores.prefs.getState().compact).toBe(true);
      expect(toastTexts()).toEqual(["no"]);
    });

    it("arrange goes through the arrange store", async () => {
      await make();
      await rt.actions.arrange("cascade");
      expect(ipc.callsOf("arrangePollWindows")).toEqual([["cascade", { kind: "eachMonitor" }]]);
    });
  });

  describe("title", () => {
    it("is set at the start and follows the poll and the link", async () => {
      await make();
      expect(win.titles.at(-1)).toBe("Pump 2 - Untitled - Offline");
      await rt.stores.connection.getState().connect(TCP);
      await ipc.setAllPollsActive(true);
      ipc.advance(300);
      expect(win.titles.at(-1)).toBe("Pump 2 - Untitled - Polling");
    });

    it("is not set again when nothing it shows changed", async () => {
      await make();
      const before = win.titles.length;
      await ipc.setPollView(pollId, { hasUnappliedEdits: true });
      expect(win.titles.length).toBe(before);
    });

    it("a title that cannot be set (not a Tauri window) is not an error", async () => {
      await make({ init: false });
      win.setTitle = () => Promise.reject(new Error("no window"));
      await rt.init();
      expect(rt.stores.toasts.getState().items).toEqual([]);
    });
  });

  it("a toast store of its own is cleared on dispose", async () => {
    await make();
    rt.stores.toasts.getState().show("x");
    rt.dispose();
    expect(rt.stores.toasts.getState().items).toEqual([]);
    vi.useRealTimers();
  });
});
