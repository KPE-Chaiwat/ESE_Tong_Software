import { vi } from "vitest";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
  sessionReason,
} from "@/shared/ipc/modbus-master.fake";
import type { ConnectionConfig, PollId, TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { createFakeWindowIpc, type FakeWindowIpc } from "@/shared/ipc/window";
import { type ConnectionRuntime, createConnectionRuntime } from "./connection-runtime";

const TCP: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const sync = (cb: () => void) => {
  cb();
  return () => {};
};

interface Ctx {
  rt: ConnectionRuntime;
  ipc: FakeModbusMasterIpc;
  win: FakeWindowIpc;
  copied: string[];
  timers: Array<{ cb: () => void; ms: number }>;
  /** Runs the timers that were set. */
  fire(): void;
}

let ctx: Ctx;
const stores = () => ctx.rt.stores;

async function make(
  options: {
    prepare?: (ipc: FakeModbusMasterIpc) => void;
    clipboardFails?: boolean;
    init?: boolean;
  } = {},
): Promise<Ctx> {
  const ipc = createFakeModbusMasterIpc({ mode: "virtual" });
  const win = createFakeWindowIpc();
  const copied: string[] = [];
  const timers: Ctx["timers"] = [];
  options.prepare?.(ipc);
  const rt = createConnectionRuntime(ipc, win, {
    scheduler: sync,
    dragScheduler: sync,
    clipboard: {
      writeText: async (t) => {
        if (options.clipboardFails) throw new Error("denied");
        copied.push(t);
      },
    },
    setTimer: (cb, ms) => {
      timers.push({ cb, ms });
      return timers.length;
    },
    clearTimer: () => {},
    getWindowHeight: () => 800,
    warn: () => {},
  });
  if (options.init !== false) await rt.init();
  return {
    rt,
    ipc,
    win,
    copied,
    timers,
    fire() {
      for (const t of timers.splice(0)) t.cb();
    },
  };
}

async function addPoll(name = "Poll 1", patch = {}): Promise<PollId> {
  return ctx.ipc.addPoll(pollConfigInput({ name, ...patch }), "workspace");
}

afterEach(() => ctx?.rt.dispose());

describe("session start", () => {
  it("opens the session once and applies the snapshot", async () => {
    ctx = await make({
      prepare: (ipc) => {
        void ipc.addPoll(pollConfigInput({ name: "Tank 1" }), "workspace");
      },
    });
    await ctx.rt.init();
    expect(ctx.ipc.callsOf("openSession")).toHaveLength(1);
    expect(stores().pollList.getState().order).toHaveLength(1);
    expect(stores().connection.getState()).toMatchObject({ ready: true, state: "idle" });
    expect(Object.keys(stores().workspace.getState().items)).toHaveLength(1);
    expect(stores().section.getState().expanded).toBe(true);
  });

  it("a session in connected state starts with the CONNECTION section collapsed", async () => {
    ctx = await make({
      prepare: (ipc) => {
        void ipc.openSession(() => {});
        void ipc.connect(TCP);
      },
    });
    expect(stores().connection.getState().state).toBe("connected");
    expect(stores().section.getState().expanded).toBe(false);
    expect(stores().draft.getState().connection).toEqual(TCP);
  });

  it("applies the profile name, the preferences and the stored layout", async () => {
    ctx = await make({
      prepare: (ipc) => {
        void ipc.setProfileName("Boiler-PLC");
        void ipc.setCompactMode(true);
        void ipc.setAskOnPollClose(false);
        void ipc.setWorkspaceLayout({
          items: [],
          minimizedOrder: [],
          tileMode: true,
          compact: false,
          sidebarWidth: 320,
          sidebarCollapsed: true,
          trafficExpanded: true,
          trafficHeight: 260,
        });
      },
    });
    expect(stores().profile.getState().name).toBe("Boiler-PLC");
    expect(stores().prefs.getState()).toMatchObject({ compact: true, askOnPollClose: false });
    expect(stores().workspace.getState()).toMatchObject({
      tileMode: true,
      sidebar: { width: 320, collapsed: true },
      traffic: { expanded: true, height: 260 },
    });
  });

  it("holds events that arrive before the snapshot and replays them after it (REV-002 M3)", async () => {
    const ipc = createFakeModbusMasterIpc({ mode: "manual" });
    const win = createFakeWindowIpc();
    const rt = createConnectionRuntime(ipc, win, { scheduler: sync, warn: () => {} });
    ctx = { rt, ipc, win, copied: [], timers: [], fire() {} };
    await ipc.openSession(() => {});
    const held = ipc.hold("openSession");
    const started = rt.init();
    // A transition that happens while the snapshot is on its way.
    ipc.emitConnectionState("connecting");
    ipc.emitConnectionState("connected");
    expect(rt.stores.connection.getState().ready).toBe(false);
    held.release(ipc.snapshot());
    await started;
    expect(rt.stores.connection.getState().state).toBe("connected");
    expect(rt.stores.connection.getState().revision).toBe(2);
  });
});

describe("routing", () => {
  it("poll list, poll state and counters reach the poll list; frames reach the traffic store", async () => {
    ctx = await make();
    const id = await addPoll();
    expect(stores().pollList.getState().order).toEqual([id]);
    ctx.ipc.emitPollState(id, "paused");
    ctx.ipc.emitCounters({
      total: { requests: 9, responses: 8, errors: 1, timeouts: 0 },
      polls: [
        {
          pollId: id,
          counters: { requests: 5, responses: 5, errors: 0, timeouts: 0 },
          effectiveScanMs: null,
          lastOkAt: 123,
        },
      ],
      linkLoadPct: 40,
    });
    expect(stores().pollList.getState().polls[id]?.counters.counters.requests).toBe(5);
    expect(stores().traffic.getState().counters.total.requests).toBe(9);
    expect(stores().traffic.getState().counters.linkLoadPct).toBe(40);
    const frame: TrafficFrame = {
      seq: 1,
      at: 1,
      direction: "tx",
      bytes: [1],
      slaveId: 1,
      function: 3,
      exceptionCode: null,
      note: null,
      origin: null,
    };
    ctx.ipc.emitFrames([frame]);
    expect(stores().traffic.getState().frames.size).toBe(1);
  });

  it("the traffic filter names follow the poll list in list order", async () => {
    ctx = await make();
    const a = await addPoll("Alpha");
    const b = await addPoll("Beta");
    expect(stores().traffic.getState().pollOrder).toEqual([a, b]);
    await ctx.ipc.reorderPolls([b, a]);
    expect(stores().traffic.getState().pollOrder).toEqual([b, a]);
    await ctx.ipc.renamePoll(a, "Alpha 2");
    expect(stores().traffic.getState().pollNames[a]).toBe("Alpha 2");
  });

  it("a deleted poll that was the traffic filter switches the filter to All polls", async () => {
    ctx = await make();
    const a = await addPoll();
    stores().traffic.getState().setFilter({ kind: "poll", pollId: a });
    await ctx.ipc.removePoll(a);
    expect(stores().traffic.getState().filter).toEqual({ kind: "all" });
  });

  it("PrefsChanged reaches the prefs store", async () => {
    ctx = await make();
    await ctx.ipc.setCompactMode(true);
    expect(stores().prefs.getState().compact).toBe(true);
  });

  it("ShowTraffic expands the panel and sets the poll filter", async () => {
    ctx = await make();
    const a = await addPoll();
    ctx.ipc.emitSession({ type: "ShowTraffic", pollId: a });
    expect(stores().workspace.getState().traffic.expanded).toBe(true);
    expect(stores().traffic.getState().filter).toEqual({ kind: "poll", pollId: a });
    ctx.ipc.emitSession({ type: "ShowTraffic", pollId: null });
    expect(stores().traffic.getState().filter).toEqual({ kind: "poll", pollId: a });
  });

  it("the sidebar selection follows the active sub-window", async () => {
    ctx = await make();
    const a = await addPoll("A");
    const b = await addPoll("B");
    expect(stores().pollList.getState().selectedId).toBe(b);
    stores().workspace.getState().activate(a);
    expect(stores().pollList.getState().selectedId).toBe(a);
  });
});

describe("sub-windows follow the poll list", () => {
  it("a new poll becomes a sub-window; a poll in its own window or closed is not one", async () => {
    ctx = await make();
    const a = await addPoll("A");
    const b = await ctx.ipc.addPoll(pollConfigInput({ name: "B" }), "native");
    expect(Object.keys(stores().workspace.getState().items)).toEqual([String(a)]);
    await ctx.ipc.closePollView(a, true);
    expect(stores().workspace.getState().items).toEqual({});
    await ctx.ipc.showPoll(a, null);
    expect(Object.keys(stores().workspace.getState().items)).toEqual([String(a)]);
    expect(b).not.toBe(a);
  });

  it("RevealPoll restores and activates a minimized sub-window", async () => {
    ctx = await make();
    const a = await addPoll("A");
    await addPoll("B");
    stores().workspace.getState().minimize(a);
    await ctx.ipc.showPoll(a, null);
    expect(stores().workspace.getState().items[a]?.state).toBe("normal");
    expect(stores().workspace.getState().activeId).toBe(a);
  });

  it("a list drop (show with a placement) places the sub-window at the rectangle", async () => {
    ctx = await make();
    const a = await addPoll("A");
    await ctx.ipc.closePollView(a, true);
    await ctx.ipc.showPoll(a, {
      workspaceRect: {
        x: 300,
        y: 200,
        width: 500,
        height: 300,
        z: 1,
        state: "normal",
        restore: null,
      },
    });
    expect(stores().workspace.getState().items[a]?.rect).toEqual({
      x: 300,
      y: 200,
      width: 500,
      height: 300,
    });
  });

  it("its view runtime is created when asked, shared, and disposed when the sub-window goes (REV-005 view lifecycle)", async () => {
    ctx = await make();
    const a = await addPoll("A");
    const view = ctx.rt.views.get(a);
    expect(ctx.rt.views.get(a)).toBe(view);
    await view.init();
    expect(ctx.ipc.attachedViews()).toHaveLength(1);
    await ctx.ipc.closePollView(a, true);
    expect(ctx.rt.views.peek(a)).toBeUndefined();
    expect(ctx.ipc.attachedViews()).toEqual([]);
  });

  it("pop out: detached and listed as native first; a failure puts the sub-window back with its handoff", async () => {
    ctx = await make();
    const a = await addPoll("A");
    const view = ctx.rt.views.get(a);
    await view.init();
    ctx.ipc.scriptPopOutFailure("no window");
    await expect(
      ctx.ipc.popOutPoll(a, { kind: "cursor", grabOffset: { x: 5, y: 5 } }, '{"v":1}'),
    ).rejects.toThrow("no window");
    // The sub-window was unmounted and mounted again by the two list events.
    expect(Object.keys(stores().workspace.getState().items)).toEqual([String(a)]);
    const again = ctx.rt.views.get(a);
    expect(again).not.toBe(view);
    await again.init();
    expect(ctx.ipc.attachedViews()).toEqual([expect.objectContaining({ pollId: a })]);
  });

  it("a poll removed in Rust takes its sub-window and its view", async () => {
    ctx = await make();
    const a = await addPoll("A");
    await ctx.rt.views.get(a).init();
    await ctx.ipc.removePoll(a);
    expect(stores().workspace.getState().items).toEqual({});
    expect(ctx.rt.views.ids()).toEqual([]);
  });
});

describe("connection", () => {
  it("connect validates through the form gateway and sends the connection", async () => {
    ctx = await make();
    stores().draft.getState().setConnection(TCP);
    await ctx.rt.actions.connect();
    expect(ctx.ipc.callsOf("connect")).toEqual([[TCP]]);
    expect(stores().connection.getState().state).toBe("connected");
    expect(stores().section.getState().expanded).toBe(false);
  });

  it("an invalid form sends nothing and expands the section", async () => {
    ctx = await make();
    stores().section.getState().applySnapshot("connected");
    await ctx.rt.actions.connect();
    expect(ctx.ipc.callsOf("connect")).toHaveLength(0);
    expect(stores().section.getState()).toMatchObject({ expanded: true, focusRequest: 1 });
  });

  it("Ctrl+L: connect, then disconnect", async () => {
    ctx = await make();
    stores().draft.getState().setConnection(TCP);
    await ctx.rt.actions.toggleConnection();
    expect(stores().connection.getState().state).toBe("connected");
    await ctx.rt.actions.toggleConnection();
    expect(ctx.ipc.callsOf("disconnect")).toHaveLength(1);
  });

  it("Ctrl+L while connecting cancels", async () => {
    ctx = await make();
    ctx.ipc.emitConnectionState("connecting");
    await ctx.rt.actions.toggleConnection();
    expect(ctx.ipc.callsOf("cancelConnect")).toHaveLength(1);
  });

  it("a refused connect re-expands the section and announces the banner text assertively", async () => {
    ctx = await make();
    stores().draft.getState().setConnection(TCP);
    ctx.ipc.scriptConnectFailure(sessionReason("refused"));
    await ctx.rt.actions.connect();
    expect(stores().connection.getState().state).toBe("disconnected");
    expect(stores().section.getState().expanded).toBe(true);
    expect(stores().announcer.getState().assertive.text).toBe(
      "Disconnected. Connection refused by 192.168.1.10:502.",
    );
  });

  it("announces each transition once", async () => {
    ctx = await make();
    stores().draft.getState().setConnection(TCP);
    const seen: string[] = [];
    stores().announcer.subscribe((s) => seen.push(s.polite.text || s.assertive.text));
    await ctx.rt.actions.connect();
    expect(seen).toEqual(["Connecting…. Connecting to 192.168.1.10:502…", "Connected"]);
  });

  it("a rejected command shows a toast, and the backend's field message goes to the form", async () => {
    ctx = await make();
    stores().draft.getState().setConnection(TCP);
    const showFieldError = vi.fn(() => true);
    ctx.rt.form.current = { ...ctx.rt.form.current, showFieldError };
    ctx.ipc.failNext(
      "connect",
      Object.assign(new Error("Host not valid"), { code: "validation", field: "host" }),
    );
    await ctx.rt.actions.connect();
    expect(stores().toasts.getState().items.at(-1)).toMatchObject({
      text: "Host not valid",
      tone: "error",
    });
    expect(showFieldError).toHaveBeenCalledWith("host", "Host not valid");
  });

  it("a connection Rust has (a reload) is shown in the form", async () => {
    ctx = await make();
    const adopt = vi.fn();
    ctx.rt.form.current = { ...ctx.rt.form.current, adopt };
    ctx.ipc.emitConnectionState("connecting");
    // The event carries the connection of the last connect command.
    await ctx.ipc.connect(TCP);
    expect(adopt).toHaveBeenCalled();
  });
});

describe("poll actions", () => {
  it("New poll adds a workspace poll and marks it as new", async () => {
    ctx = await make();
    await ctx.rt.actions.newPoll();
    const id = stores().pollList.getState().order[0] as PollId;
    expect(ctx.ipc.callsOf("addPoll")[0]?.[1]).toBe("workspace");
    expect(stores().workspace.getState().freshId).toBe(id);
  });

  it("New poll at 16 shows the toast and adds nothing", async () => {
    ctx = await make();
    for (let i = 0; i < 16; i += 1) await addPoll(`P${i}`);
    await ctx.rt.actions.newPoll();
    expect(stores().toasts.getState().items.at(-1)?.text).toBe(
      "A connection can have at most 16 polls.",
    );
    expect(ctx.ipc.pollIds()).toHaveLength(16);
  });

  it("Pause all when a poll runs, Resume all when none does", async () => {
    ctx = await make();
    stores().draft.getState().setConnection(TCP);
    await addPoll("A");
    await ctx.rt.actions.connect();
    await ctx.rt.actions.togglePauseAll();
    expect(ctx.ipc.callsOf("setAllPollsActive")).toEqual([[false]]);
    await ctx.rt.actions.togglePauseAll();
    expect(ctx.ipc.callsOf("setAllPollsActive")).toEqual([[false], [true]]);
  });

  it("togglePoll pauses a running poll and resumes a paused one", async () => {
    ctx = await make();
    stores().draft.getState().setConnection(TCP);
    const a = await addPoll("A");
    await ctx.rt.actions.connect();
    await ctx.rt.actions.togglePoll(a);
    await ctx.rt.actions.togglePoll(a);
    expect(ctx.ipc.callsOf("setPollActive")).toEqual([
      [a, false],
      [a, true],
    ]);
  });

  it("showPoll of a mounted sub-window needs no round trip; a closed poll asks Rust", async () => {
    ctx = await make();
    const a = await addPoll("A");
    await ctx.rt.actions.showPoll(a);
    expect(ctx.ipc.callsOf("showPoll")).toHaveLength(0);
    expect(stores().workspace.getState().activeId).toBe(a);
    await ctx.ipc.closePollView(a, true);
    await ctx.rt.actions.showPoll(a);
    expect(ctx.ipc.callsOf("showPoll")).toEqual([[a, null]]);
    expect(Object.keys(stores().workspace.getState().items)).toEqual([String(a)]);
  });

  it("showPoll of a poll in its own window asks Rust", async () => {
    ctx = await make();
    const a = await ctx.ipc.addPoll(pollConfigInput({ name: "N" }), "native");
    await ctx.rt.actions.showPoll(a);
    expect(ctx.ipc.callsOf("showPoll")).toEqual([[a, null]]);
  });

  it("showPoll mounts a sub-window that the list shows but that is missing (a failed attach)", async () => {
    ctx = await make();
    const a = await addPoll("A");
    stores().workspace.getState().unmount(a);
    await ctx.rt.actions.showPoll(a);
    expect(stores().workspace.getState().items[a]).toBeDefined();
  });

  it("show traffic for a poll sets the filter and expands the panel", async () => {
    ctx = await make();
    const a = await addPoll("A");
    ctx.rt.actions.showTrafficFor(a);
    expect(stores().traffic.getState().filter).toEqual({ kind: "poll", pollId: a });
    expect(stores().workspace.getState().traffic.expanded).toBe(true);
    ctx.rt.actions.toggleTraffic();
    expect(stores().workspace.getState().traffic.expanded).toBe(false);
  });

  it("reset all counters sends no poll id", async () => {
    ctx = await make();
    await ctx.rt.actions.resetAllCounters();
    expect(ctx.ipc.callsOf("resetCounters")).toEqual([[null]]);
  });

  it("a new window uses the window facade; a failure is a toast", async () => {
    ctx = await make();
    await ctx.rt.actions.newWindow();
    expect(ctx.win.openedTools).toEqual(["modbus-master"]);
    ctx.win.openError = "no more windows";
    await ctx.rt.actions.newWindow();
    expect(stores().toasts.getState().items.at(-1)?.text).toBe(
      "Could not open a new window: no more windows",
    );
  });

  it("popped-out windows are brought to the front through Rust", async () => {
    ctx = await make();
    await ctx.rt.actions.showPollWindows();
    expect(ctx.ipc.callsOf("showPollWindows")).toHaveLength(1);
  });

  it("the sidebar toggles; in compact mode it peeks, and the peek ends with compact mode", async () => {
    ctx = await make();
    ctx.rt.actions.toggleSidebar();
    expect(stores().workspace.getState().sidebar.collapsed).toBe(true);
    ctx.rt.actions.toggleSidebar();
    await ctx.ipc.setCompactMode(true);
    ctx.rt.actions.toggleSidebar();
    expect(stores().layout.getState().sidebarPeek).toBe(true);
    expect(stores().workspace.getState().sidebar.collapsed).toBe(false);
    await ctx.ipc.setCompactMode(false);
    expect(stores().layout.getState().sidebarPeek).toBe(false);
  });
});

describe("traffic copy", () => {
  const frame = (seq: number, origin: TrafficFrame["origin"]): TrafficFrame => ({
    seq,
    at: new Date(2026, 9, 12, 14, 2, 11, 532).getTime(),
    direction: "tx",
    bytes: [0, 1, 0xab],
    slaveId: 1,
    function: 3,
    exceptionCode: null,
    note: null,
    origin,
  });

  it("copies the selected frame with its poll and the bytes as hex", async () => {
    ctx = await make();
    const a = await addPoll("Pump 2");
    ctx.ipc.emitFrames([frame(1, { kind: "poll", pollId: a })]);
    stores().traffic.getState().select(1);
    await ctx.rt.actions.copyFrame();
    await ctx.rt.actions.copyFrameBytes();
    expect(ctx.copied).toEqual(["14:02:11.532\tTX\t00 01 AB\tFC03 slave 1\tPump 2", "00 01 AB"]);
    expect(
      stores()
        .toasts.getState()
        .items.map((t) => t.text),
    ).toEqual(["Copied 1 frame.", "Copied 3 bytes."]);
  });

  it("copies nothing without a selected frame", async () => {
    ctx = await make();
    await ctx.rt.actions.copyFrame();
    expect(ctx.copied).toEqual([]);
    expect(stores().toasts.getState().items).toEqual([]);
  });

  it("a refused clipboard is an error toast, not a rejection (REV-003 n-3)", async () => {
    ctx = await make({ clipboardFails: true });
    ctx.ipc.emitFrames([frame(1, null)]);
    stores().traffic.getState().select(1);
    await expect(ctx.rt.actions.copyFrame()).resolves.toBeUndefined();
    expect(stores().toasts.getState().items.at(-1)).toMatchObject({
      text: "Could not copy to the clipboard.",
      tone: "error",
    });
  });
});

describe("poll failures are announced once (DES-002 1.5 rule 5)", () => {
  async function runningPolls(n: number): Promise<PollId[]> {
    stores().draft.getState().setConnection(TCP);
    const ids: PollId[] = [];
    for (let i = 0; i < n; i += 1) ids.push(await addPoll(`Poll ${i + 1}`));
    await ctx.rt.actions.connect();
    ctx.ipc.advance(500);
    return ids;
  }

  it("a single failure is announced after the one second window, not before", async () => {
    ctx = await make();
    const [a] = (await runningPolls(1)) as [PollId];
    ctx.ipc.emitPollState(a, "timeout", { consecutiveFailures: 1 });
    expect(stores().announcer.getState().polite.text).not.toContain("Timeout");
    expect(ctx.timers.at(-1)?.ms).toBe(1000);
    ctx.fire();
    expect(stores().announcer.getState().polite.text).toBe("Poll 1: Timeout.");
  });

  it("repeats and recoveries are not announced", async () => {
    ctx = await make();
    const [a] = (await runningPolls(1)) as [PollId];
    ctx.ipc.emitPollState(a, "timeout", { consecutiveFailures: 1 });
    ctx.ipc.emitPollState(a, "timeout", { consecutiveFailures: 2 });
    ctx.fire();
    const seq = stores().announcer.getState().polite.seq;
    ctx.ipc.emitPollState(a, "polling");
    ctx.fire();
    expect(stores().announcer.getState().polite.seq).toBe(seq);
    expect(stores().announcer.getState().polite.text).toBe("Poll 1: Timeout.");
  });

  it("four polls that time out together are one message: '4 polls are failing.'", async () => {
    ctx = await make();
    const ids = await runningPolls(4);
    for (const id of ids) ctx.ipc.emitPollState(id, "timeout", { consecutiveFailures: 1 });
    const before = stores().announcer.getState().polite.seq;
    ctx.fire();
    expect(stores().announcer.getState().polite.text).toBe("4 polls are failing.");
    expect(stores().announcer.getState().polite.seq).toBe(before + 1);
  });

  it("an exception is announced with its code", async () => {
    ctx = await make();
    const [a] = (await runningPolls(1)) as [PollId];
    ctx.ipc.emitPollState(a, "exception", { exceptionCode: 2, consecutiveFailures: 1 });
    ctx.fire();
    expect(stores().announcer.getState().polite.text).toBe("Poll 1: Exception 02.");
  });

  it("a poll that already failed in the snapshot is not announced", async () => {
    ctx = await make({
      prepare: (ipc) => {
        void ipc.openSession(() => {});
        void ipc.addPoll(pollConfigInput({ name: "P" }), "workspace");
        void ipc.connect(TCP);
        ipc.scriptFault(1, { kind: "timeout" });
        ipc.advance(5000);
      },
    });
    ctx.fire();
    expect(stores().announcer.getState().polite.text).not.toContain("Timeout");
  });
});

describe("dispose", () => {
  it("stops the views, the timers and the toasts", async () => {
    ctx = await make();
    const a = await addPoll("A");
    await ctx.rt.views.get(a).init();
    ctx.rt.dispose();
    expect(ctx.rt.views.ids()).toEqual([]);
    expect(ctx.ipc.attachedViews()).toEqual([]);
  });

  it("init is idempotent", async () => {
    ctx = await make();
    await ctx.rt.init();
    await ctx.rt.init();
    expect(ctx.ipc.callsOf("openSession")).toHaveLength(1);
  });
});
