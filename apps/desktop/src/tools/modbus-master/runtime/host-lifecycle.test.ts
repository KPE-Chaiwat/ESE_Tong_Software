// The host lifecycle across the two window kinds (DES-002 2.5, FE-002 task 20): the connection
// window runtime and a native window runtime on one fake backend, stores only (no rendering).
import { vi } from "vitest";
import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type { ConnectionConfig, PollId } from "@/shared/ipc/modbus-master.types";
import { createFakeWindowIpc, type FakeWindowIpc } from "@/shared/ipc/window";
import { type ConnectionRuntime, createConnectionRuntime } from "./connection-runtime";
import { createNativePollRuntime, type NativePollRuntime } from "./native-poll-runtime";

const TCP: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const sync = (cb: () => void) => {
  cb();
  return () => {};
};

let ipc: FakeModbusMasterIpc;
let win: FakeWindowIpc;
let rt: ConnectionRuntime;
let natives: NativePollRuntime[] = [];
let blurs = 0;
const copied: string[] = [];

async function make(options: { saveProfile?: () => Promise<boolean> } = {}) {
  ipc = createFakeModbusMasterIpc({ mode: "virtual" });
  win = createFakeWindowIpc();
  blurs = 0;
  copied.length = 0;
  rt = createConnectionRuntime(ipc, win, {
    scheduler: sync,
    dragScheduler: sync,
    clipboard: { writeText: async (t) => void copied.push(t) },
    toastDurationMs: 60_000,
    getWindowHeight: () => 800,
    getWorkspaceOrigin: () => ({ x: 300, y: 56 }),
    blurEditors: () => {
      blurs += 1;
    },
    warn: () => {},
    ...options,
  });
  await rt.init();
  rt.stores.workspace.getState().setSize({ width: 1332, height: 716 });
}

/** A native window runtime for a poll, attached to the same backend. */
async function nativeWindow(pollId: PollId): Promise<NativePollRuntime> {
  const native = createNativePollRuntime(ipc, createFakeWindowIpc(), {
    pollId,
    warn: () => {},
    blurEditors: () => {},
  });
  natives.push(native);
  await native.init();
  return native;
}

afterEach(() => {
  for (const n of natives) n.dispose();
  natives = [];
  rt?.dispose();
});

const add = (name: string, host: "workspace" | "native" = "workspace") =>
  ipc.addPoll(pollConfigInput({ name }), host);
const stores = () => rt.stores;
const items = () => stores().workspace.getState().items;
const live = () => stores().announcer.getState().polite.text;
const toastTexts = () =>
  stores()
    .toasts.getState()
    .items.map((t) => t.text);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("pop out (H4, DES-002 2.5.2)", () => {
  it("sends the sub-window's rectangle in client coordinates, after the layout, with its handoff", async () => {
    await make();
    const a = await add("A");
    await rt.views.get(a).init();
    await rt.actions.popOutPoll(a);
    const [id, anchor, handoff] = ipc.callsOf("popOutPoll")[0] as [PollId, unknown, string];
    expect(id).toBe(a);
    // The workspace starts at (300, 56) in the window; the sub-window is at (8, 8).
    expect(anchor).toEqual({ kind: "rect", rect: { x: 308, y: 64, width: 640, height: 368 } });
    expect(JSON.parse(handoff)).toMatchObject({ version: 1 });
    const order = ipc.calls.map((c) => c.method);
    expect(order.lastIndexOf("setWorkspaceLayout")).toBeLessThan(order.indexOf("popOutPoll"));
    expect(blurs).toBe(1);
  });

  it("the sub-window and its view go, the poll is native, and the pop out is announced", async () => {
    await make();
    const a = await add("A");
    await rt.views.get(a).init();
    await rt.actions.popOutPoll(a);
    expect(items()[a]).toBeUndefined();
    expect(rt.views.ids()).toEqual([]);
    expect(stores().pollList.getState().polls[a]?.host).toBe("native");
    expect(live()).toBe("A opened in its own window.");
  });

  it("the sub-window stays mounted, with a spinner state, until the command answers (the backend's order)", async () => {
    await make();
    const a = await add("A");
    const view = rt.views.get(a);
    await view.init();
    // Rust detaches the view and says "native" BEFORE it creates the window; only the answer waits.
    const held = ipc.holdReply("popOutPoll");
    const run = rt.actions.popOutPoll(a);
    await tick();
    expect(ipc.pollSummary(a).host).toBe("native");
    expect(stores().pollList.getState().polls[a]?.host).toBe("native");
    expect(view.stores.poll.getState().attach).toBe("detached");
    expect(items()[a]).toBeDefined();
    expect(rt.views.peek(a)).toBe(view);
    expect(view.stores.poll.getState().pending).toBe("popOut");
    expect(stores().host.getState().pending[a]).toBe("popOut");
    held.release();
    await run;
    expect(items()[a]).toBeUndefined();
    expect(rt.views.ids()).toEqual([]);
    expect(view.stores.poll.getState().pending).toBeNull();
  });

  it("a pop out that fails keeps the sub-window the whole time and gives it a new view with its handoff", async () => {
    await make();
    const a = await add("A");
    const old = rt.views.get(a);
    await old.init();
    old.stores.ui.getState().click(3);
    old.stores.ui.getState().click(5, { shift: true });
    ipc.scriptPopOutFailure("no window");
    const held = ipc.holdReply("popOutPoll");
    const run = rt.actions.popOutPoll(a);
    await tick();
    // The list went native and back, the old view is detached; the frame never left.
    expect(items()[a]).toBeDefined();
    expect(old.stores.poll.getState().attach).toBe("detached");
    expect(toastTexts()).toEqual([]);
    held.release();
    await run;
    expect(toastTexts()).toContain("Could not open the poll window: no window");
    expect(items()[a]).toBeDefined();
    const fresh = rt.views.get(a);
    expect(fresh).not.toBe(old);
    expect(rt.views.epoch(a)).toBe(1);
    await fresh.init();
    expect(fresh.stores.ui.getState().selection).toEqual([{ start: 3, end: 5 }]);
    expect(ipc.attachedViews()).toEqual([
      expect.objectContaining({ pollId: a, host: "workspace" }),
    ]);
  });

  it("the second trigger while the layout is reported sends one command (REV-006 m-1)", async () => {
    await make();
    const a = await add("A");
    await rt.views.get(a).init();
    const layout = ipc.hold("setWorkspaceLayout");
    stores().workspace.getState().setRect(a, { x: 40, y: 40, width: 500, height: 300 });
    const first = rt.actions.popOutPoll(a);
    const second = rt.actions.popOutPoll(a);
    layout.release();
    await Promise.all([first, second]);
    expect(ipc.callsOf("popOutPoll")).toHaveLength(1);
  });

  it("a maximized sub-window pops out at its normal size, a minimized one at the rectangle it had", async () => {
    await make();
    const a = await add("A");
    const b = await add("B");
    stores().workspace.getState().setRect(a, { x: 100, y: 50, width: 500, height: 300 });
    stores().workspace.getState().maximize(a);
    await rt.actions.popOutPoll(a);
    expect((ipc.callsOf("popOutPoll")[0] as unknown[])[1]).toEqual({
      kind: "rect",
      rect: { x: 400, y: 106, width: 500, height: 300 },
    });
    stores().workspace.getState().setRect(b, { x: 40, y: 20, width: 400, height: 250 });
    stores().workspace.getState().minimize(b);
    await rt.actions.popOutPoll(b);
    expect((ipc.callsOf("popOutPoll")[1] as unknown[])[1]).toEqual({
      kind: "rect",
      rect: { x: 340, y: 76, width: 400, height: 250 },
    });
  });

  it("a view that was never attached has no handoff to send", async () => {
    await make();
    const a = await add("A");
    await rt.actions.popOutPoll(a);
    expect((ipc.callsOf("popOutPoll")[0] as unknown[])[2]).toBeNull();
  });

  it("a failure shows the toast and the sub-window is back, attached again", async () => {
    await make();
    const a = await add("A");
    await rt.views.get(a).init();
    ipc.scriptPopOutFailure("no window");
    await rt.actions.popOutPoll(a);
    expect(toastTexts()).toContain("Could not open the poll window: no window");
    expect(items()[a]).toBeDefined();
    expect(stores().pollList.getState().polls[a]?.host).toBe("workspace");
    await rt.views.get(a).init();
    expect(ipc.attachedViews()).toEqual([
      expect.objectContaining({ pollId: a, host: "workspace" }),
    ]);
    // The host that went back is not announced as a dock.
    expect(live()).not.toContain("docked");
  });

  it("when the answer of the failed command comes before the list events, the host change back is not a dock (REV-006 m-8)", async () => {
    await make();
    const a = await add("A");
    await rt.views.get(a).init();
    ipc.failNext("popOutPoll", "no window");
    await rt.actions.popOutPoll(a);
    const before = ipc.pollSummary(a);
    ipc.emitSession({ type: "PollListChanged", polls: [{ ...before, host: "native" }] });
    ipc.emitSession({ type: "PollListChanged", polls: [before] });
    expect(live()).not.toContain("docked");
  });

  it("Keep without asking, triggered twice while the layout is reported, closes once (REV-006 m-1)", async () => {
    await make();
    const a = await add("A");
    await rt.views.get(a).init();
    await stores().prefs.getState().setAskOnPollClose(false);
    const layout = ipc.hold("setWorkspaceLayout");
    stores().workspace.getState().setRect(a, { x: 40, y: 40, width: 500, height: 300 });
    stores().host.getState().requestClose(a);
    stores().host.getState().requestClose(a);
    layout.release();
    await tick();
    expect(ipc.callsOf("closePollView")).toEqual([[a, true]]);
  });

  it("a real dock a few seconds after is announced", async () => {
    await make();
    const a = await add("A");
    await rt.views.get(a).init();
    ipc.emitSession({
      type: "PollListChanged",
      polls: [{ ...ipc.pollSummary(a), host: "native" }],
    });
    ipc.emitSession({ type: "PollListChanged", polls: [ipc.pollSummary(a)] });
    expect(live()).toBe("A docked in the workspace.");
  });

  it("a rejected command with no change leaves the sub-window where it is", async () => {
    await make();
    const a = await add("A");
    await rt.views.get(a).init();
    ipc.failNext("popOutPoll", new IpcError("bad anchor", "validation", "anchor"));
    await rt.actions.popOutPoll(a);
    expect(toastTexts()).toEqual(["Could not open the poll window: bad anchor"]);
    expect(items()[a]).toBeDefined();
    expect(ipc.attachedViews()).toHaveLength(1);
  });

  it("does nothing while a dialog is open", async () => {
    await make();
    const a = await add("A");
    const release = stores().layout.getState().lockModal();
    await rt.actions.popOutPoll(a);
    expect(ipc.callsOf("popOutPoll")).toHaveLength(0);
    release();
  });

  it("the view's own pop out action (the title bar button) is the same call", async () => {
    await make();
    const a = await add("A");
    rt.views.get(a).hostActions.popOut?.();
    await vi.waitFor(() => expect(ipc.callsOf("popOutPoll")).toHaveLength(1));
  });
});

describe("pop out and dock keep the state of the view (DES-002 2.5.4)", () => {
  it("rows 3-5, the top row and an invalid Quantity draft arrive in the native window and come back", async () => {
    await make();
    const a = await add("A");
    await stores().connection.getState().connect(TCP);
    await ipc.setAllPollsActive(true);
    ipc.advance(300);
    const view = rt.views.get(a);
    await view.init();
    const ui = view.stores.ui.getState();
    ui.click(3);
    ui.click(5, { shift: true });
    ui.setTopAddress(2);
    ui.patchPollDraft("quantity", "200");
    ui.checkPollDraftField("quantity", view.draftContext());
    const message = view.stores.ui.getState().pollDraft?.errors.quantity;
    expect(message).toBeTruthy();

    await rt.actions.popOutPoll(a);
    const native = await nativeWindow(a);
    const nui = native.view.stores.ui.getState();
    expect(nui.selection).toEqual([{ start: 3, end: 5 }]);
    expect(nui.focusAddress).toBe(5);
    expect(nui.topAddress).toBe(2);
    expect(nui.pollDraft).toMatchObject({ quantity: "200", errors: { quantity: message } });
    // Live values at once: no "Waiting for first response…".
    expect(native.view.stores.data.getState().status).toBe("live");
    expect(native.view.stores.data.getState().values).not.toBeNull();
    expect(native.view.stores.poll.getState().hasUnappliedEdits).toBe(true);

    // Back: the same in the sub-window.
    await native.actions.dock();
    const again = rt.views.get(a);
    await again.init();
    const aui = again.stores.ui.getState();
    expect(aui.selection).toEqual([{ start: 3, end: 5 }]);
    expect(aui.topAddress).toBe(2);
    expect(aui.pollDraft).toMatchObject({ quantity: "200", errors: { quantity: message } });
    expect(again.stores.data.getState().status).toBe("live");
    expect(items()[a]).toBeDefined();
    expect(stores().workspace.getState().activeId).toBe(a);
  });

  it("the state and the counters do not change over five pop out and dock cycles", async () => {
    await make();
    const a = await add("A");
    await stores().connection.getState().connect(TCP);
    await ipc.setAllPollsActive(true);
    ipc.advance(300);
    await rt.views.get(a).init();
    const before = stores().pollList.getState().polls[a]?.status.state;
    for (let i = 0; i < 5; i += 1) {
      await rt.actions.popOutPoll(a);
      const native = await nativeWindow(a);
      await native.actions.dock();
      native.dispose();
      await rt.views.get(a).init();
    }
    expect(stores().pollList.getState().polls[a]?.status.state).toBe(before);
    expect(ipc.attachedViews()).toHaveLength(1);
    expect(items()[a]).toBeDefined();
    expect(ipc.pollSummary(a).host).toBe("workspace");
  });

  it("a dock is announced in W1 and brings the sub-window back at its rectangle", async () => {
    await make();
    const a = await add("A");
    stores().workspace.getState().setRect(a, { x: 120, y: 80, width: 500, height: 300 });
    await rt.views.get(a).init();
    await rt.actions.popOutPoll(a);
    const native = await nativeWindow(a);
    await native.actions.dock();
    expect(live()).toBe("A docked in the workspace.");
    expect(items()[a]?.rect).toEqual({ x: 120, y: 80, width: 500, height: 300 });
  });
});

describe("show (H12-H14)", () => {
  it("a poll in its own window is shown through Rust, and a failure says the window could not open", async () => {
    await make();
    const n = await add("N", "native");
    await rt.actions.showPoll(n);
    expect(ipc.callsOf("showPoll")).toEqual([[n, null]]);
    ipc.failNext("showPoll", "no window");
    await rt.actions.showPoll(n);
    expect(toastTexts()).toEqual(["Could not open the poll window: no window"]);
  });

  it("RevealPoll after a dock places the sub-window at the rectangle Rust sends", async () => {
    await make();
    const n = await add("N", "native");
    await ipc.dockPoll(n, null, false, {
      x: 50,
      y: 60,
      width: 400,
      height: 250,
      z: 1,
      state: "normal",
      restore: null,
    });
    expect(items()[n]?.rect).toEqual({ x: 50, y: 60, width: 400, height: 250 });
    expect(stores().workspace.getState().activeId).toBe(n);
  });
});

describe("a poll dropped from the list (DES-002 2.10.7)", () => {
  const rect = (x: number, y: number, width = 640, height = 368) => ({ x, y, width, height });

  it("a closed poll is shown at the rectangle with the next z", async () => {
    await make();
    const a = await add("A");
    await add("B");
    await ipc.closePollView(a, true);
    const top = Math.max(...Object.values(items()).map((i) => i.z));
    await rt.actions.placePollFromList(a, { kind: "rect", rect: rect(200, 100) });
    const [, placement] = ipc.callsOf("showPoll").at(-1) as [
      PollId,
      { workspaceRect: { z: number } },
    ];
    expect(placement.workspaceRect).toMatchObject({
      x: 200,
      y: 100,
      width: 640,
      height: 368,
      state: "normal",
    });
    expect(placement.workspaceRect.z).toBe(top + 1);
    expect(items()[a]?.rect).toEqual(rect(200, 100));
    expect(stores().pollList.getState().selectedId).toBe(a);
  });

  it("a sub-window that is there is moved and activated without a round trip to Rust", async () => {
    await make();
    const a = await add("A");
    await add("B");
    await rt.actions.placePollFromList(a, {
      kind: "zone",
      zone: "left",
      rect: rect(8, 8, 654, 700),
    });
    expect(items()[a]?.rect).toEqual(rect(8, 8, 654, 700));
    expect(stores().workspace.getState().activeId).toBe(a);
    expect(ipc.callsOf("showPoll")).toHaveLength(0);
    expect(ipc.callsOf("dockPoll")).toHaveLength(0);
  });

  it("a minimized sub-window is restored there", async () => {
    await make();
    const a = await add("A");
    stores().workspace.getState().minimize(a);
    await rt.actions.placePollFromList(a, { kind: "rect", rect: rect(300, 120) });
    expect(items()[a]).toMatchObject({ state: "normal", rect: rect(300, 120) });
    expect(stores().workspace.getState().minimizedOrder).toEqual([]);
  });

  it("a poll in its own window is docked with a handoff request and the drop rectangle", async () => {
    await make();
    const n = await add("N", "native");
    await rt.actions.placePollFromList(n, { kind: "rect", rect: rect(200, 100) });
    expect(ipc.callsOf("dockPoll")).toEqual([
      [n, null, true, expect.objectContaining({ x: 200, y: 100, state: "normal" })],
    ]);
    expect(items()[n]?.rect).toEqual(rect(200, 100));
  });

  it("a refused dock names the window", async () => {
    await make();
    const n = await add("Pump 2", "native");
    await ipc.attachPollView(n, "native", (e) => {
      if (e.type === "HandoffRequested") void ipc.provideHandoff(n, null);
    });
    await rt.actions.placePollFromList(n, { kind: "rect", rect: rect(200, 100) });
    expect(toastTexts()).toEqual(['Close the dialog in the "Pump 2" window first.']);
    expect(items()[n]).toBeUndefined();
  });

  it("tile mode: the slot decides the list order, then the poll is shown", async () => {
    await make();
    const a = await add("A");
    const b = await add("B");
    const c = await add("C");
    stores().workspace.getState().tile();
    await ipc.closePollView(c, true);
    // Two are tiled [A, B]; C is dropped on slot 0.
    await rt.actions.placePollFromList(c, { kind: "slot", index: 0, rect: rect(8, 8, 654, 700) });
    expect(ipc.callsOf("reorderPolls")).toEqual([[[c, a, b]]]);
    expect(stores().pollList.getState().order).toEqual([c, a, b]);
    expect(ipc.callsOf("showPoll")).toHaveLength(1);
  });

  it("tile mode: a tiled sub-window dropped on another slot only reorders the list", async () => {
    await make();
    const a = await add("A");
    const b = await add("B");
    const c = await add("C");
    stores().workspace.getState().tile();
    await rt.actions.placePollFromList(a, { kind: "slot", index: 2, rect: rect(8, 8) });
    expect(ipc.callsOf("reorderPolls")).toEqual([[[b, c, a]]]);
    expect(ipc.callsOf("showPoll")).toHaveLength(0);
    expect(stores().workspace.getState().activeId).toBe(a);
  });

  it("an unknown poll does nothing", async () => {
    await make();
    await rt.actions.placePollFromList(99, { kind: "rect", rect: rect(0, 0) });
    expect(ipc.callsOf("showPoll")).toHaveLength(0);
  });
});

describe("row actions", () => {
  it("movePoll moves one place and announces the position; a no-op says nothing", async () => {
    await make();
    const a = await add("A");
    const b = await add("B");
    await rt.actions.movePoll(b, "up");
    expect(stores().pollList.getState().order).toEqual([b, a]);
    expect(live()).toBe("B moved to position 1 of 2.");
    const text = live();
    await rt.actions.movePoll(b, "up");
    expect(ipc.callsOf("reorderPolls")).toHaveLength(1);
    expect(live()).toBe(text);
    await rt.actions.movePoll(99, "up");
  });

  it("copyPollRow copies the row and says 'Copied 1 row.'", async () => {
    await make();
    const a = await add("A");
    await rt.actions.copyPollRow(a);
    expect(copied).toEqual(["A\t1\tFC03\t0-9\t1000 ms\tOffline"]);
    expect(toastTexts()).toEqual(["Copied 1 row."]);
  });
});

describe("closing the window (DES-002 2.11)", () => {
  it("registers the close handler once the session is open; dispose removes it", async () => {
    await make();
    await tick();
    await expect(win.requestClose()).resolves.toBe(true);
    expect(win.closed).toBe(true);
    win.closed = false;
    rt.dispose();
    // The handler is gone: the fake closes without asking.
    await tick();
    stores().profile.getState().setModified(true);
    await expect(win.requestClose()).resolves.toBe(true);
  });

  it("closeWindow closes the window when nothing is unsaved", async () => {
    await make();
    await rt.actions.closeWindow();
    expect(win.closed).toBe(true);
  });

  it("closeWindow with unsaved changes waits for the answer", async () => {
    await make();
    stores().profile.getState().setModified(true);
    const closing = rt.actions.closeWindow();
    expect(stores().windowClose.getState().asking).not.toBeNull();
    expect(win.closed).toBe(false);
    stores().windowClose.getState().cancel();
    await closing;
    expect(win.closed).toBe(false);
    const again = rt.actions.closeWindow();
    stores().windowClose.getState().discard();
    await again;
    expect(win.closed).toBe(true);
  });

  it("the summary names the native windows and the polls with unapplied edits, in list order", async () => {
    await make();
    const a = await add("Tank");
    const b = await add("Pump 2");
    await add("N", "native");
    await ipc.setPollView(b, { hasUnappliedEdits: true });
    await ipc.setPollView(a, { hasUnappliedEdits: true });
    stores().profile.getState().setName("Boiler-PLC");
    stores().profile.getState().setBaseline(rt.contentSignature());
    const closing = stores().windowClose.getState().request();
    expect(stores().windowClose.getState().asking).toEqual({
      profileName: "Boiler-PLC",
      modified: false,
      nativeCount: 1,
      unappliedNames: ["Tank", "Pump 2"],
    });
    stores().windowClose.getState().cancel();
    await closing;
  });
});
