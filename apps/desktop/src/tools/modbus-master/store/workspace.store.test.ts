import { createFakeModbusMasterIpc, pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import type { PollId, PollSummary } from "@/shared/ipc/modbus-master.types";
import type { Rect } from "@/shared/lib/layout-math";
import { createToastStore } from "@/shared/lib/toast.store";
import { idsByZ } from "./workspace.logic";
import { createWorkspaceStore, overflowToast, type WorkspaceStoreApi } from "./workspace.store";

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const SIZE = { width: 1332, height: 716 };

interface Setup {
  store: WorkspaceStoreApi;
  ipc: ReturnType<typeof createFakeModbusMasterIpc>;
  toasts: ReturnType<typeof createToastStore>;
  /** Adds polls to the fake backend and mounts them. */
  add(n: number): Promise<PollId[]>;
  summaries(): PollSummary[];
  timers: Array<{ cb: () => void; ms: number; cleared: boolean }>;
  order: PollId[];
}

function setup(): Setup {
  const ipc = createFakeModbusMasterIpc({ mode: "manual" });
  const toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  const order: PollId[] = [];
  const timers: Setup["timers"] = [];
  const store = createWorkspaceStore({
    ipc,
    toasts,
    getListOrder: () => order,
    getWindowHeight: () => 800,
    setTimer: (cb, ms) => {
      const t = { cb, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
  });
  const summaries = () => ipc.pollIds().map((id) => ipc.pollSummary(id));
  return {
    store,
    ipc,
    toasts,
    timers,
    order,
    summaries,
    async add(n) {
      const ids: PollId[] = [];
      for (let i = 0; i < n; i += 1) {
        const id = await ipc.addPoll(
          pollConfigInput({ name: `Poll ${order.length + 1}` }),
          "workspace",
        );
        order.push(id);
        ids.push(id);
        store.getState().syncFromList(summaries());
      }
      return ids;
    },
  };
}

let s: Setup;
const get = () => s.store.getState();
const rectOf = (id: PollId) => get().items[id]?.rect;
const layoutCalls = () => s.ipc.callsOf("setWorkspaceLayout");

beforeEach(async () => {
  s = setup();
  await s.ipc.openSession(() => {});
  get().applyLayout(s.ipc.snapshot().workspaceLayout, []);
  get().setSize(SIZE);
});

afterEach(() => get().dispose());

describe("initial state", () => {
  it("has no windows, the default sidebar and a collapsed traffic panel", () => {
    expect(get()).toMatchObject({
      items: {},
      activeId: null,
      minimizedOrder: [],
      tileMode: false,
      sidebar: { width: 280, collapsed: false },
      traffic: { expanded: false, height: null },
    });
  });
});

describe("mounting from the poll list", () => {
  it("mounts a new poll at the next slot and makes it active; the others keep their place", async () => {
    const [a, b] = await s.add(2);
    expect(rectOf(a as PollId)).toEqual(R(8, 8, 640, 368));
    expect(rectOf(b as PollId)).toEqual(R(32, 32, 640, 368));
    expect(get().activeId).toBe(b);
    expect(idsByZ(get().items)).toEqual([a, b]);
  });

  it("reports the layout when a window is mounted", async () => {
    await s.add(1);
    expect(layoutCalls()).toHaveLength(1);
    expect(layoutCalls()[0]?.[0]).toMatchObject({ items: [{ rect: { x: 8, y: 8 } }] });
  });

  it("unmounts a poll that was closed or moved to its own window, and activates the next", async () => {
    const [a, b] = await s.add(2);
    await s.ipc.closePollView(b as PollId, true);
    get().syncFromList(s.summaries());
    expect(Object.keys(get().items)).toEqual([String(a)]);
    expect(get().activeId).toBe(a);
  });

  it("a closed poll comes back at the rectangle Rust stored", async () => {
    const [a] = await s.add(1);
    get().setRect(a as PollId, R(100, 50, 500, 300));
    await get().flush();
    await s.ipc.closePollView(a as PollId, true);
    get().syncFromList(s.summaries());
    expect(get().items[a as PollId]).toBeUndefined();
    await s.ipc.showPoll(a as PollId, null);
    get().syncFromList(s.summaries());
    expect(rectOf(a as PollId)).toEqual(R(100, 50, 500, 300));
  });

  it("does nothing, and does not report, when nothing changed", async () => {
    await s.add(1);
    const calls = layoutCalls().length;
    get().syncFromList(s.summaries());
    expect(layoutCalls()).toHaveLength(calls);
  });
});

describe("the snapshot layout", () => {
  it("applies rectangles, the minimized order, tile mode, sidebar and traffic without reporting", async () => {
    const ids = await s.add(3);
    const [a, b, c] = ids as [PollId, PollId, PollId];
    get().minimize(b);
    get().setSidebarWidth(320);
    get().setTrafficHeight(300);
    get().setTrafficExpanded(true);
    await get().flush();
    const layout = get().toLayout();
    const fresh = setup();
    await fresh.ipc.openSession(() => {});
    for (const [i] of ids.entries()) {
      await fresh.ipc.addPoll(pollConfigInput({ name: `Poll ${i + 1}` }), "workspace");
    }
    // The ids of the second fake are the same numbers, so the stored layout fits its polls.
    fresh.store.getState().applyLayout(layout, fresh.summaries());
    const w = fresh.store.getState();
    expect(Object.keys(w.items).sort()).toEqual([a, b, c].map(String).sort());
    expect(w.items[b]?.state).toBe("minimized");
    expect(w.minimizedOrder).toEqual([b]);
    expect(w.sidebar.width).toBe(320);
    expect(w.traffic).toEqual({ expanded: true, height: 300 });
    expect(fresh.ipc.callsOf("setWorkspaceLayout")).toHaveLength(0);
    fresh.store.getState().dispose();
  });

  it("the polls without a stored rectangle are mounted but do not take the focus", async () => {
    await s.ipc.addPoll(pollConfigInput(), "workspace");
    const fresh = s.summaries();
    const w = createWorkspaceStore({
      ipc: s.ipc,
      toasts: s.toasts,
      getListOrder: () => s.ipc.pollIds(),
    });
    w.getState().applyLayout(s.ipc.snapshot().workspaceLayout, fresh);
    expect(Object.keys(w.getState().items)).toHaveLength(1);
    expect(w.getState().activeId).toBe(Object.keys(w.getState().items).map(Number)[0]);
  });
});

describe("activation and z-order", () => {
  it("activate raises the window and makes it active, without reporting", async () => {
    const [a, b] = await s.add(2);
    const calls = layoutCalls().length;
    get().activate(a as PollId);
    expect(get().activeId).toBe(a);
    expect(idsByZ(get().items)).toEqual([b, a]);
    expect(layoutCalls()).toHaveLength(calls);
  });

  it("show activates, asks for the focus and reports", async () => {
    const [a] = await s.add(2);
    expect(get().show(a as PollId)).toBe(true);
    expect(get().focusRequest).toMatchObject({ id: a });
    expect(layoutCalls().at(-1)?.[0]).toMatchObject({ items: expect.any(Array) });
    expect(get().show(999)).toBe(false);
  });

  it("requestFocus asks for the focus only: no raise, no activation, no report, a new request each time (REPORT-007 D9)", async () => {
    const [a, b] = await s.add(2);
    const calls = layoutCalls().length;
    const active = get().activeId;
    const order = idsByZ(get().items);
    get().requestFocus(a as PollId);
    const first = get().focusRequest;
    expect(first).toMatchObject({ id: a });
    expect(get().activeId).toBe(active);
    expect(idsByZ(get().items)).toEqual(order);
    expect(layoutCalls()).toHaveLength(calls);
    get().requestFocus(a as PollId);
    expect(get().focusRequest?.seq).toBeGreaterThan(first?.seq ?? 0);
    get().requestFocus(b as PollId);
    expect(get().focusRequest).toMatchObject({ id: b });
  });

  it("requestFocus of an unknown poll does nothing", async () => {
    await s.add(1);
    const before = get().focusRequest;
    get().requestFocus(999);
    expect(get().focusRequest).toBe(before);
  });

  it("show restores a minimized window", async () => {
    const [a] = await s.add(2);
    get().minimize(a as PollId);
    get().show(a as PollId);
    expect(get().items[a as PollId]?.state).toBe("normal");
    expect(get().minimizedOrder).toEqual([]);
    expect(get().activeId).toBe(a);
  });

  it("activating another window while one is maximized shows it maximized and restores the first", async () => {
    const [a, b] = await s.add(2);
    get().maximize(a as PollId);
    get().activate(b as PollId);
    expect(get().items[b as PollId]?.state).toBe("maximized");
    expect(get().items[a as PollId]).toMatchObject({ state: "normal", rect: R(8, 8, 640, 368) });
  });
});

describe("setRect", () => {
  it("commits a rectangle, clamped to keep the title bar inside", async () => {
    const [a] = await s.add(1);
    get().setRect(a as PollId, R(-9000, -9000, 640, 368));
    expect(rectOf(a as PollId)).toEqual(R(-560, 0, 640, 368));
  });

  it("does not report: the drag reports once at its end", async () => {
    const [a] = await s.add(1);
    const calls = layoutCalls().length;
    get().setRect(a as PollId, R(100, 100, 640, 368));
    get().setRect(a as PollId, R(120, 120, 640, 368));
    expect(layoutCalls()).toHaveLength(calls);
  });

  it("a maximized window becomes normal at the new rectangle", async () => {
    const [a] = await s.add(1);
    get().maximize(a as PollId);
    get().setRect(a as PollId, R(40, 40, 500, 300));
    expect(get().items[a as PollId]).toMatchObject({
      state: "normal",
      rect: R(40, 40, 500, 300),
      restore: null,
    });
  });
});

describe("minimize, maximize, restore", () => {
  it("minimizing the active window activates the next one by z-order and fills the bar", async () => {
    const [a, b, c] = await s.add(3);
    get().minimize(c as PollId);
    expect(get().minimizedOrder).toEqual([c]);
    expect(get().activeId).toBe(b);
    get().minimize(b as PollId);
    expect(get().minimizedOrder).toEqual([c, b]);
    expect(get().activeId).toBe(a);
  });

  it("minimizing reports once", async () => {
    const [a] = await s.add(2);
    const calls = layoutCalls().length;
    get().minimize(a as PollId);
    expect(layoutCalls()).toHaveLength(calls + 1);
  });

  it("restore of a minimized window activates it and leaves the bar", async () => {
    const [a] = await s.add(2);
    get().minimize(a as PollId);
    get().restore(a as PollId);
    expect(get().items[a as PollId]?.state).toBe("normal");
    expect(get().minimizedOrder).toEqual([]);
    expect(get().activeId).toBe(a);
  });

  it("maximize fills the tile area (above the bar) and restore returns the rectangle", async () => {
    const [a, b] = await s.add(2);
    get().minimize(b as PollId);
    get().maximize(a as PollId);
    expect(rectOf(a as PollId)).toEqual(R(8, 8, 1316, 648));
    get().restore(a as PollId);
    expect(rectOf(a as PollId)).toEqual(R(8, 8, 640, 368));
  });

  it("only one window is maximized at a time", async () => {
    const [a, b] = await s.add(2);
    get().maximize(a as PollId);
    get().maximize(b as PollId);
    expect(get().items[a as PollId]?.state).toBe("normal");
    expect(get().items[b as PollId]?.state).toBe("maximized");
  });

  it("toggleMaximize switches back and forth", async () => {
    const [a] = await s.add(1);
    get().toggleMaximize(a as PollId);
    expect(get().items[a as PollId]?.state).toBe("maximized");
    get().toggleMaximize(a as PollId);
    expect(get().items[a as PollId]?.state).toBe("normal");
  });

  it("ignores unknown windows and impossible changes", async () => {
    const [a] = await s.add(1);
    const calls = layoutCalls().length;
    get().minimize(99);
    get().maximize(99);
    get().restore(a as PollId);
    expect(layoutCalls()).toHaveLength(calls);
  });

  it("minimizeAll minimizes every window in list order and restoreAll brings them back", async () => {
    const [a, b, c] = await s.add(3);
    get().minimizeAll();
    expect(get().minimizedOrder).toEqual([a, b, c]);
    expect(get().activeId).toBeNull();
    get().restoreAll();
    expect(get().minimizedOrder).toEqual([]);
    expect(Object.values(get().items).every((i) => i.state === "normal")).toBe(true);
  });

  it("restoreAll also restores a maximized window", async () => {
    const [a] = await s.add(1);
    get().maximize(a as PollId);
    get().restoreAll();
    expect(get().items[a as PollId]?.state).toBe("normal");
  });

  it("arrangeMinimized sorts the bar by list order", async () => {
    const [a, b, c] = await s.add(3);
    get().minimize(c as PollId);
    get().minimize(a as PollId);
    get().minimize(b as PollId);
    get().arrangeMinimized(s.order);
    expect(get().minimizedOrder).toEqual([a, b, c]);
  });
});

describe("cycle (Ctrl+F6)", () => {
  it("goes through the visible windows in list order and wraps", async () => {
    const [a, b, c] = await s.add(3);
    get().activate(a as PollId);
    get().cycle(1);
    expect(get().activeId).toBe(b);
    get().cycle(1);
    get().cycle(1);
    expect(get().activeId).toBe(a);
    get().cycle(-1);
    expect(get().activeId).toBe(c);
  });

  it("skips minimized windows and needs two", async () => {
    const [a, b] = await s.add(2);
    get().minimize(b as PollId);
    get().cycle(1);
    expect(get().activeId).toBe(a);
  });
});

describe("tile and cascade (DES-002 2.8)", () => {
  it("Tile gives the WT-1 rectangles and turns tile mode on", async () => {
    const ids = await s.add(4);
    get().tile();
    expect(get().tileMode).toBe(true);
    expect(ids.map((id) => rectOf(id))).toEqual([
      R(8, 8, 654, 346),
      R(670, 8, 654, 346),
      R(8, 362, 654, 346),
      R(670, 362, 654, 346),
    ]);
  });

  it("the window that closes in tile mode leaves the others in the WT-2 tiles", async () => {
    const ids = await s.add(4);
    get().tile();
    await s.ipc.closePollView(ids[3] as PollId, true);
    s.order.splice(3, 1);
    get().syncFromList(s.summaries());
    expect(ids.slice(0, 3).map((id) => rectOf(id))).toEqual([
      R(8, 8, 654, 346),
      R(670, 8, 654, 346),
      R(8, 362, 1316, 346),
    ]);
  });

  it("a new poll in tile mode is appended and the tiles are recomputed", async () => {
    await s.add(2);
    get().tile();
    const [c] = await s.add(1);
    expect(rectOf(c as PollId)).toEqual(R(8, 362, 1316, 346));
  });

  it("minimizing in tile mode re-tiles the rest", async () => {
    const [a, b, c] = await s.add(3);
    get().tile();
    get().minimize(c as PollId);
    expect(rectOf(a as PollId)?.width).toBe(654);
    expect(rectOf(b as PollId)).toMatchObject({ x: 670, height: 700 - 52 });
  });

  it("a list reorder re-tiles", async () => {
    const [a, b] = await s.add(2);
    get().tile();
    s.order.splice(0, 2, b as PollId, a as PollId);
    get().syncFromList(s.summaries());
    expect(rectOf(b as PollId)?.x).toBe(8);
    expect(rectOf(a as PollId)?.x).toBe(670);
  });

  it("13 windows: 12 tiled, one cascaded, and the toast says so", async () => {
    await s.add(13);
    get().tile();
    expect(s.toasts.getState().items.map((t) => t.text)).toContain(
      "1 window did not fit and was cascaded.",
    );
  });

  it("the overflow toast text for several windows", () => {
    expect(overflowToast(1)).toBe("1 window did not fit and was cascaded.");
    expect(overflowToast(3)).toBe("3 windows did not fit and were cascaded.");
  });

  it("Cascade turns tile mode off and steps by 24 px with the last window in front", async () => {
    const ids = await s.add(3);
    get().tile();
    get().cascade();
    expect(get().tileMode).toBe(false);
    expect(ids.map((id) => rectOf(id))).toEqual([
      R(8, 8, 640, 368),
      R(32, 32, 640, 368),
      R(56, 56, 640, 368),
    ]);
  });

  it("Cascade does not raise the active window", async () => {
    const [a] = await s.add(3);
    get().activate(a as PollId);
    get().cascade();
    expect(get().activeId).toBe(a);
    expect(idsByZ(get().items).at(-1)).not.toBe(a);
  });

  it("the Tile mode checkbox: on tiles, off keeps the rectangles", async () => {
    const [a] = await s.add(2);
    get().setTileMode(true);
    const tiled = rectOf(a as PollId);
    get().setTileMode(false);
    expect(get().tileMode).toBe(false);
    expect(rectOf(a as PollId)).toEqual(tiled);
  });

  it("Tile restores a maximized window", async () => {
    const [a] = await s.add(2);
    get().maximize(a as PollId);
    get().tile();
    expect(get().items[a as PollId]?.state).toBe("normal");
  });

  it("a maximized window keeps filling the area in tile mode, and restore returns to the slot", async () => {
    const [a] = await s.add(2);
    get().tile();
    get().maximize(a as PollId);
    expect(rectOf(a as PollId)).toEqual(R(8, 8, 1316, 700));
    get().restore(a as PollId);
    expect(rectOf(a as PollId)).toEqual(R(8, 8, 654, 700));
  });
});

describe("workspace size", () => {
  it("a smaller workspace clamps windows so 80 x 30 px of the title bar stay inside", async () => {
    const [a] = await s.add(1);
    get().setRect(a as PollId, R(1200, 600, 640, 368));
    get().setSize({ width: 800, height: 500 });
    expect(rectOf(a as PollId)).toMatchObject({ x: 720, y: 470 });
  });

  it("does not move windows that are still valid", async () => {
    const [a] = await s.add(1);
    const before = get().items[a as PollId];
    get().setSize({ width: 1000, height: 600 });
    expect(get().items[a as PollId]).toBe(before);
  });

  it("tile mode re-tiles to the new size", async () => {
    await s.add(4);
    get().tile();
    get().setSize({ width: 1000, height: 600 });
    expect(rectOf(get().activeId as PollId)?.width).toBeLessThan(654);
  });

  it("a maximized window follows the workspace", async () => {
    const [a] = await s.add(1);
    get().maximize(a as PollId);
    get().setSize({ width: 1000, height: 600 });
    expect(rectOf(a as PollId)).toEqual(R(8, 8, 984, 584));
  });

  it("reports 300 ms after the last change, not during the resize", async () => {
    const [a] = await s.add(1);
    get().setRect(a as PollId, R(1200, 600, 640, 368));
    await get().flush();
    const calls = layoutCalls().length;
    get().setSize({ width: 800, height: 500 });
    get().setSize({ width: 790, height: 490 });
    expect(layoutCalls()).toHaveLength(calls);
    const live = s.timers.filter((t) => !t.cleared);
    expect(live).toHaveLength(1);
    expect(live[0]?.ms).toBe(300);
    live[0]?.cb();
    await Promise.resolve();
    expect(layoutCalls()).toHaveLength(calls + 1);
  });

  it("ignores the same size", () => {
    const before = get().items;
    get().setSize(SIZE);
    expect(get().items).toBe(before);
  });
});

describe("reveal (RevealPoll)", () => {
  it("restores, activates, asks for the focus and reports", async () => {
    const [a] = await s.add(2);
    get().minimize(a as PollId);
    get().reveal(a as PollId, null);
    expect(get().items[a as PollId]?.state).toBe("normal");
    expect(get().activeId).toBe(a);
    expect(get().focusRequest?.id).toBe(a);
  });

  it("places the window at the given rectangle", async () => {
    const [a] = await s.add(1);
    get().reveal(a as PollId, R(300, 200, 500, 300));
    expect(rectOf(a as PollId)).toEqual(R(300, 200, 500, 300));
  });

  it("a reveal that arrives before its poll is mounted is applied when it is", async () => {
    get().reveal(42, R(300, 200, 500, 300));
    expect(get().pendingReveal[42]).toEqual(R(300, 200, 500, 300));
    const id = await s.ipc.addPoll(pollConfigInput(), "workspace");
    expect(id).not.toBe(42);
    // Simulate the poll with that id appearing.
    const summary = {
      ...s.ipc.pollSummary(id),
      config: { ...s.ipc.pollSummary(id).config, pollId: 42 },
    };
    get().syncFromList([summary]);
    expect(rectOf(42)).toEqual(R(300, 200, 500, 300));
    expect(get().pendingReveal[42]).toBeUndefined();
    expect(get().activeId).toBe(42);
  });
});

describe("reporting (flush)", () => {
  it("sends the layout once and skips an identical one", async () => {
    await s.add(1);
    const calls = layoutCalls().length;
    await get().flush();
    await get().flush();
    expect(layoutCalls()).toHaveLength(calls);
  });

  it("sends tile mode, the minimized order, the sidebar and the traffic panel", async () => {
    const [a] = await s.add(1);
    get().minimize(a as PollId);
    get().tile();
    get().setSidebarWidth(300);
    get().toggleSidebar();
    get().setTrafficExpanded(true);
    get().setTrafficHeight(250);
    await get().flush();
    expect(layoutCalls().at(-1)?.[0]).toMatchObject({
      tileMode: true,
      minimizedOrder: [a],
      sidebarWidth: 300,
      sidebarCollapsed: true,
      trafficExpanded: true,
      trafficHeight: 250,
    });
  });

  it("a rejected report shows an error toast and is tried again next time", async () => {
    await s.add(1);
    s.ipc.failNext("setWorkspaceLayout", "layout rejected");
    get().setSidebarWidth(300);
    await get().flush();
    expect(s.toasts.getState().items.at(-1)).toMatchObject({
      text: "layout rejected",
      tone: "error",
    });
    const calls = layoutCalls().length;
    await get().flush();
    expect(layoutCalls()).toHaveLength(calls + 1);
  });

  it("clamps the sidebar width and the traffic height", () => {
    get().setSidebarWidth(9999);
    expect(get().sidebar.width).toBe(400);
    get().setTrafficHeight(5);
    expect(get().traffic.height).toBe(120);
    get().setTrafficHeight(null);
    expect(get().traffic.height).toBeNull();
  });

  it("the traffic panel and the sidebar toggles report", async () => {
    const calls = layoutCalls().length;
    get().setTrafficExpanded(true);
    get().setTrafficExpanded(true);
    expect(layoutCalls()).toHaveLength(calls + 1);
    get().toggleSidebar();
    expect(layoutCalls()).toHaveLength(calls + 2);
  });
});

describe("small state", () => {
  it("marks the new poll and the title rename", async () => {
    const [a] = await s.add(1);
    get().markFresh(a as PollId);
    expect(get().freshId).toBe(a);
    get().startTitleRename(a as PollId);
    expect(get().titleRenameId).toBe(a);
    get().endTitleRename();
    expect(get().titleRenameId).toBeNull();
    get().startTitleRename(999);
    expect(get().titleRenameId).toBeNull();
  });

  it("unmount removes a window without reporting", async () => {
    const [a, b] = await s.add(2);
    const calls = layoutCalls().length;
    get().unmount(b as PollId);
    expect(get().items[b as PollId]).toBeUndefined();
    expect(get().activeId).toBe(a);
    expect(layoutCalls()).toHaveLength(calls);
  });

  it("in tile mode unmount tiles the rest again and reports the rectangles (REV-006 n-3)", async () => {
    const [a, b, c] = await s.add(3);
    get().tile();
    await get().flush();
    const calls = layoutCalls().length;
    get().unmount(c as PollId);
    // Two tiles are left: side by side.
    expect(rectOf(a as PollId)).toEqual(R(8, 8, 654, 700));
    expect(rectOf(b as PollId)).toEqual(R(670, 8, 654, 700));
    await Promise.resolve();
    expect(layoutCalls()).toHaveLength(calls + 1);
    const last = layoutCalls().at(-1)?.[0] as { items: Array<{ pollId: number; rect: Rect }> };
    expect(last.items.find((i) => i.pollId === a)?.rect).toMatchObject({ width: 654, height: 700 });
  });

  it("swap exchanges two rectangles", async () => {
    const [a, b] = await s.add(2);
    get().swap(a as PollId, b as PollId);
    expect(rectOf(a as PollId)).toEqual(R(32, 32, 640, 368));
    expect(rectOf(b as PollId)).toEqual(R(8, 8, 640, 368));
  });
});
