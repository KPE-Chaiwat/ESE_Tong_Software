import { vi } from "vitest";
import { createFakeModbusMasterIpc, pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import type { Rect } from "@/shared/lib/layout-math";
import { createToastStore } from "@/shared/lib/toast.store";
import { createDragStore, type DragStoreApi } from "./drag.store";
import { createWorkspaceStore, type WorkspaceStoreApi } from "./workspace.store";

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const NO_MODS = { alt: false, ctrl: false };
const CTRL = { alt: false, ctrl: true };
const ALT = { alt: true, ctrl: false };

interface Setup {
  ws: WorkspaceStoreApi;
  drag: DragStoreApi;
  ids: PollId[];
  order: PollId[];
  announced: string[];
  setOrder: ReturnType<typeof vi.fn>;
  placeFromList: ReturnType<typeof vi.fn>;
  flushes: () => number;
  /** Runs the frames that were scheduled. */
  frame(): void;
  scheduled: () => number;
}

async function setup(n: number, options: { tile?: boolean } = {}): Promise<Setup> {
  const ipc = createFakeModbusMasterIpc({ mode: "manual" });
  await ipc.openSession(() => {});
  const toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  const order: PollId[] = [];
  const ws = createWorkspaceStore({
    ipc,
    toasts,
    getListOrder: () => order,
    getWindowHeight: () => 800,
  });
  const ids: PollId[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = await ipc.addPoll(pollConfigInput({ name: `P${i + 1}` }), "workspace");
    ids.push(id);
    order.push(id);
    ws.getState().applyLayout(
      ipc.snapshot().workspaceLayout,
      ipc.pollIds().map((p) => ipc.pollSummary(p)),
    );
  }
  ws.getState().setSize({ width: 1332, height: 716 });
  if (options.tile) ws.getState().tile();
  const announced: string[] = [];
  const setOrder = vi.fn((next: PollId[]) => {
    order.splice(0, order.length, ...next);
    ws.getState().syncFromList(ipc.pollIds().map((p) => ipc.pollSummary(p)));
  });
  const placeFromList = vi.fn();
  let queue: Array<() => void> = [];
  const drag = createDragStore({
    workspace: ws,
    getName: (id) => `P${ids.indexOf(id) + 1}`,
    getListOrder: () => order,
    setOrder,
    placeFromList,
    announce: (t) => announced.push(t),
    schedule: (cb) => {
      queue.push(cb);
      return () => {
        queue = queue.filter((x) => x !== cb);
      };
    },
  });
  return {
    ws,
    drag,
    ids,
    order,
    announced,
    setOrder,
    placeFromList,
    flushes: () => ipc.callsOf("setWorkspaceLayout").length,
    frame() {
      const run = queue;
      queue = [];
      for (const cb of run) cb();
    },
    scheduled: () => queue.length,
  };
}

let s: Setup;
const d = () => s.drag.getState();
const rectOf = (id: PollId) => s.ws.getState().items[id]?.rect;
/** Moves by a pointer path and runs the frame. */
function pointer(x: number, y: number, mods = NO_MODS) {
  d().update({ x, y }, mods);
  s.frame();
}

describe("initial state", () => {
  it("is idle with snapping on", async () => {
    s = await setup(1);
    expect(d()).toMatchObject({
      kind: "none",
      pollId: null,
      currentRect: null,
      guides: [],
      zone: null,
      swapTargetId: null,
      snapEnabled: true,
    });
  });
});

describe("move", () => {
  it("begin starts a drag at the rectangle of the window; nothing in the workspace changes while it runs", async () => {
    s = await setup(2);
    const [a] = s.ids as [PollId, PollId];
    const before = s.ws.getState().items;
    const flushes = s.flushes();
    expect(d().begin("move", a, { x: 100, y: 20 })).toBe(true);
    expect(d()).toMatchObject({ kind: "move", pollId: a, startRect: R(8, 8, 640, 368) });
    pointer(300, 220);
    expect(d().currentRect).toEqual(R(208, 208, 640, 368));
    expect(s.ws.getState().items).toBe(before);
    expect(s.flushes()).toBe(flushes);
  });

  it("begin of an unknown window does nothing", async () => {
    s = await setup(1);
    expect(d().begin("move", 999, { x: 0, y: 0 })).toBe(false);
    expect(d().kind).toBe("none");
  });

  it("100 updates within one animation frame compute (and notify) once", async () => {
    s = await setup(1);
    d().begin("move", s.ids[0] as PollId, { x: 0, y: 0 });
    const seen = vi.fn();
    const off = s.drag.subscribe(seen);
    for (let i = 0; i < 100; i += 1) d().update({ x: i, y: i }, NO_MODS);
    expect(s.scheduled()).toBe(1);
    expect(seen).not.toHaveBeenCalled();
    s.frame();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(d().currentRect).toMatchObject({ x: 8 + 99, y: 8 + 99 });
    off();
  });

  it("release commits the rectangle once, reports once and announces", async () => {
    s = await setup(2);
    const a = s.ids[0] as PollId;
    d().begin("move", a, { x: 100, y: 20 });
    pointer(300, 220);
    const flushes = s.flushes();
    expect(d().end()).toEqual({ kind: "moved", rect: R(208, 208, 640, 368) });
    expect(rectOf(a)).toEqual(R(208, 208, 640, 368));
    expect(s.flushes()).toBe(flushes + 1);
    expect(s.announced).toEqual(["P1 moved."]);
    expect(d().kind).toBe("none");
    expect(d().currentRect).toBeNull();
  });

  it("the last pointer position counts even when its frame has not run", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().begin("move", a, { x: 0, y: 0 });
    d().update({ x: 50, y: 40 }, NO_MODS);
    d().end();
    expect(rectOf(a)).toEqual(R(58, 48, 640, 368));
  });

  it("a release without movement changes nothing and announces nothing", async () => {
    s = await setup(1);
    d().begin("move", s.ids[0] as PollId, { x: 5, y: 5 });
    expect(d().end()).toEqual({ kind: "unchanged" });
    expect(s.announced).toEqual([]);
  });

  it("Esc (cancel) goes back to the rectangle at the press and announces", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().begin("move", a, { x: 0, y: 0 });
    pointer(200, 200);
    d().cancel();
    expect(rectOf(a)).toEqual(R(8, 8, 640, 368));
    expect(d().kind).toBe("none");
    expect(s.announced).toEqual(["Move cancelled."]);
  });

  it("a cancel without a drag is silent", async () => {
    s = await setup(1);
    d().cancel();
    expect(s.announced).toEqual([]);
  });

  it("snaps to a neighbor with one guide, and Alt turns it off", async () => {
    s = await setup(2);
    const [a, b] = s.ids as [PollId, PollId];
    s.ws.getState().setRect(b, R(700, 8, 500, 300));
    d().begin("move", a, { x: 0, y: 300 });
    // B's left edge is 700, so the gap line is 692. A's right edge is 648 + 47 = 695: 3 px away.
    pointer(47, 300);
    expect((d().currentRect?.x ?? 0) + 640).toBe(692);
    expect(d().guides.filter((g) => g.axis === "x")).toEqual([{ axis: "x", at: 692 }]);
    pointer(47, 300, ALT);
    expect(d().currentRect?.x).toBe(55);
    expect(d().guides).toEqual([]);
    d().cancel();
  });

  it("Alt released mid-drag re-enables snapping", async () => {
    s = await setup(2);
    const [a, b] = s.ids as [PollId, PollId];
    s.ws.getState().setRect(b, R(700, 8, 500, 300));
    d().begin("move", a, { x: 0, y: 300 });
    pointer(47, 300, ALT);
    expect(d().guides).toEqual([]);
    pointer(47, 300, NO_MODS);
    expect(d().guides.filter((g) => g.axis === "x")).toHaveLength(1);
    d().cancel();
  });

  it("a snap zone: the preview shows, the drop sets the zone rectangle and announces the zone", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().begin("move", a, { x: 300, y: 100 });
    pointer(12, 300);
    expect(d().zone).toBe("left");
    expect(d().zoneRect).toEqual(R(8, 8, 654, 700));
    expect(d().end()).toMatchObject({ kind: "zone", zone: "left" });
    expect(rectOf(a)).toEqual(R(8, 8, 654, 700));
    expect(s.ws.getState().items[a]?.state).toBe("normal");
    expect(s.announced).toEqual(["P1 moved to the left half."]);
  });

  it("the top zone is the full area and the window stays normal, not maximized", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().begin("move", a, { x: 300, y: 100 });
    pointer(600, 10);
    d().end();
    expect(rectOf(a)).toEqual(R(8, 8, 1316, 700));
    expect(s.ws.getState().items[a]?.state).toBe("normal");
  });

  it("turning snapping off (Snap while moving) stops the zones", async () => {
    s = await setup(1);
    d().toggleSnap();
    expect(d().snapEnabled).toBe(false);
    d().begin("move", s.ids[0] as PollId, { x: 300, y: 100 });
    pointer(12, 300);
    expect(d().zone).toBeNull();
    d().cancel();
    d().toggleSnap();
    expect(d().snapEnabled).toBe(true);
  });

  describe("zones arm after the pointer left the starting band (Q-FE2-04)", () => {
    it("a press inside the 24 px band does not show a zone, not even for a move along the border", async () => {
      s = await setup(1);
      const a = s.ids[0] as PollId;
      // The window rests at (8, 8): its title bar is inside the top band of the tile area.
      d().begin("move", a, { x: 300, y: 20 });
      expect(d().zonesArmed).toBe(false);
      pointer(600, 12);
      expect(d().zone).toBeNull();
      expect(d().zoneRect).toBeNull();
      pointer(12, 20);
      expect(d().zone).toBeNull();
      // Releasing in the band moves the window; it does not snap to the full area.
      d().end();
      expect(rectOf(a)).not.toEqual(R(8, 8, 1316, 700));
    });

    it("the first position outside the band arms the zones for the rest of the drag", async () => {
      s = await setup(1);
      const a = s.ids[0] as PollId;
      d().begin("move", a, { x: 300, y: 20 });
      pointer(300, 200);
      expect(d().zonesArmed).toBe(true);
      expect(d().zone).toBeNull();
      pointer(12, 300);
      expect(d().zone).toBe("left");
      // Back into the band is still a zone: the arming is for the whole drag.
      pointer(600, 10);
      expect(d().zone).toBe("full");
      d().cancel();
    });

    it("a press outside the band is armed at once", async () => {
      s = await setup(1);
      d().begin("move", s.ids[0] as PollId, { x: 300, y: 100 });
      expect(d().zonesArmed).toBe(true);
      pointer(12, 300);
      expect(d().zone).toBe("left");
      d().cancel();
    });

    it("the arming starts again with the next drag", async () => {
      s = await setup(1);
      const a = s.ids[0] as PollId;
      d().begin("move", a, { x: 300, y: 100 });
      pointer(12, 300);
      d().cancel();
      expect(d().zonesArmed).toBe(true);
      d().begin("move", a, { x: 300, y: 20 });
      expect(d().zonesArmed).toBe(false);
      d().cancel();
    });

    it("edge snapping still works while the zones are not armed", async () => {
      s = await setup(2);
      const [a, b] = s.ids as [PollId, PollId];
      s.ws.getState().setRect(b, R(700, 8, 500, 300));
      d().begin("move", a, { x: 0, y: 20 });
      pointer(47, 20);
      expect(d().zone).toBeNull();
      expect(d().guides.filter((g) => g.axis === "x")).toHaveLength(1);
      d().cancel();
    });
  });

  it("Ctrl over another title bar and release swaps the two rectangles", async () => {
    s = await setup(2);
    const [a, b] = s.ids as [PollId, PollId];
    s.ws.getState().setRect(b, R(700, 100, 500, 300));
    d().begin("move", a, { x: 100, y: 20 });
    pointer(750, 110, CTRL);
    expect(d().swapTargetId).toBe(b);
    expect(d().end()).toEqual({ kind: "swap", with: b });
    expect(rectOf(a)).toEqual(R(700, 100, 500, 300));
    expect(rectOf(b)).toEqual(R(8, 8, 640, 368));
    expect(s.announced).toEqual(["P1 swapped with P2."]);
  });

  it("releasing Ctrl before the drop makes it a normal move", async () => {
    s = await setup(2);
    const [a, b] = s.ids as [PollId, PollId];
    s.ws.getState().setRect(b, R(700, 100, 500, 300));
    d().begin("move", a, { x: 100, y: 20 });
    pointer(750, 110, CTRL);
    pointer(750, 110, NO_MODS);
    expect(d().swapTargetId).toBeNull();
    expect(d().end()).toMatchObject({ kind: "moved" });
  });

  it("dragging a maximized window restores it under the pointer and commits it as normal", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    s.ws.getState().maximize(a);
    d().begin("move", a, { x: 666, y: 10 });
    // The pointer was at the middle of the title bar: it stays at the middle of the restored one.
    expect(d().startRect).toMatchObject({ width: 640, height: 368 });
    expect(d().startRect?.x).toBe(Math.round(666 - ((666 - 8) / 1316) * 640));
    // Cancelled: back to maximized.
    d().cancel();
    expect(s.ws.getState().items[a]?.state).toBe("maximized");
    d().begin("move", a, { x: 666, y: 10 });
    pointer(500, 100);
    d().end();
    expect(s.ws.getState().items[a]).toMatchObject({ state: "normal", restore: null });
    expect(rectOf(a)?.width).toBe(640);
  });
});

describe("resize", () => {
  const SE = { left: false, top: false, right: true, bottom: true };
  const NW = { left: true, top: true, right: false, bottom: false };

  it("changes the size live; release commits and announces the size", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().begin("resize", a, { x: 648, y: 376 }, { edges: SE });
    pointer(748, 416, ALT);
    expect(d().currentRect).toEqual(R(8, 8, 740, 408));
    expect(d().end()).toEqual({ kind: "resized", rect: R(8, 8, 740, 408) });
    expect(rectOf(a)).toEqual(R(8, 8, 740, 408));
    expect(s.announced).toEqual(["P1 resized to 740 by 408."]);
  });

  it("the minimum is 320 x 180 with the opposite edge fixed", async () => {
    s = await setup(1);
    d().begin("resize", s.ids[0] as PollId, { x: 8, y: 8 }, { edges: NW });
    pointer(900, 900, ALT);
    expect(d().currentRect).toEqual(R(328, 196, 320, 180));
    d().cancel();
  });

  it("Esc restores the size at the press", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().begin("resize", a, { x: 648, y: 376 }, { edges: SE });
    pointer(800, 500);
    d().cancel();
    expect(rectOf(a)).toEqual(R(8, 8, 640, 368));
  });
});

describe("tile mode reorder (DES-002 2.10.5)", () => {
  it("dragging A onto slot 3 gives the list order B, C, A, D and re-tiles", async () => {
    s = await setup(4, { tile: true });
    const [a, b, c, dd] = s.ids as [PollId, PollId, PollId, PollId];
    d().begin("move", a, { x: 100, y: 20 });
    expect(d().kind).toBe("tileReorder");
    // Slot 3 (index 2) is the bottom-left tile: (8, 362, 654, 346).
    pointer(100, 500);
    expect(d().slotIndex).toBe(2);
    expect(d().slotRect).toEqual(R(8, 362, 654, 346));
    expect(d().end()).toEqual({ kind: "slot", index: 2 });
    expect(s.setOrder).toHaveBeenCalledWith([b, c, a, dd]);
    expect(s.order).toEqual([b, c, a, dd]);
    expect(rectOf(a)).toEqual(R(8, 362, 654, 346));
    expect(s.announced).toEqual(["P1 moved to slot 3 of 4."]);
  });

  it("dropping on its own slot does nothing", async () => {
    s = await setup(4, { tile: true });
    d().begin("move", s.ids[0] as PollId, { x: 100, y: 20 });
    pointer(120, 40);
    expect(d().end()).toEqual({ kind: "unchanged" });
    expect(s.setOrder).not.toHaveBeenCalled();
    expect(s.announced).toEqual([]);
  });

  it("Ctrl-drop of A on D swaps their slots in the list order", async () => {
    s = await setup(4, { tile: true });
    const [a, b, c, dd] = s.ids as [PollId, PollId, PollId, PollId];
    d().begin("move", a, { x: 100, y: 20 });
    // D's title bar is at (670, 362).
    pointer(700, 370, CTRL);
    expect(d().swapTargetId).toBe(dd);
    expect(d().end()).toEqual({ kind: "swap", with: dd });
    expect(s.setOrder).toHaveBeenCalledWith([dd, b, c, a]);
    expect(s.announced).toEqual(["P1 swapped with P4."]);
  });

  it("only the tiled windows change places: a minimized one keeps its place in the list", async () => {
    s = await setup(4, { tile: true });
    const [a, b, c, dd] = s.ids as [PollId, PollId, PollId, PollId];
    s.ws.getState().minimize(b);
    // Slots now: A, C, D. Drag A onto the last slot.
    d().begin("move", a, { x: 100, y: 20 });
    pointer(1000, 500);
    d().end();
    expect(s.order).toEqual([c, b, dd, a]);
  });
});

describe("keyboard", () => {
  it("Alt+Right moves 16 px, Alt+Shift+Right 1 px, each a committed and reported step", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    const flushes = s.flushes();
    d().nudge(a, "move", "right", false);
    expect(rectOf(a)?.x).toBe(24);
    d().nudge(a, "move", "right", true);
    expect(rectOf(a)?.x).toBe(25);
    expect(s.flushes()).toBe(flushes + 2);
    expect(s.announced).toEqual(["P1 moved.", "P1 moved."]);
  });

  it("Ctrl+Alt+Down grows the height by 16 px", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().nudge(a, "size", "down", false);
    expect(rectOf(a)).toEqual(R(8, 8, 640, 384));
    expect(s.announced).toEqual(["P1 resized to 640 by 384."]);
  });

  it("a key that changes nothing is silent", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().nudge(a, "size", "left", false);
    d().nudge(a, "size", "up", false);
    s.ws.getState().setRect(a, R(8, 8, 320, 180));
    d().nudge(a, "size", "left", false);
    expect(s.announced.at(-1)).not.toBe(undefined);
    const count = s.announced.length;
    d().nudge(a, "size", "left", false);
    expect(s.announced).toHaveLength(count);
  });

  it("is off in tile mode and for a maximized window", async () => {
    s = await setup(2, { tile: true });
    const a = s.ids[0] as PollId;
    const before = rectOf(a);
    d().nudge(a, "move", "right", false);
    expect(rectOf(a)).toEqual(before);
    s.ws.getState().setTileMode(false);
    s.ws.getState().maximize(a);
    d().nudge(a, "move", "right", false);
    expect(s.ws.getState().items[a]?.state).toBe("maximized");
  });

  it("Ctrl+Shift+Right swaps with the neighbor on the right", async () => {
    s = await setup(2);
    const [a, b] = s.ids as [PollId, PollId];
    s.ws.getState().setRect(b, R(700, 8, 500, 300));
    d().swapDirection(a, "right");
    expect(rectOf(a)).toEqual(R(700, 8, 500, 300));
    expect(rectOf(b)).toEqual(R(8, 8, 640, 368));
    expect(s.announced).toEqual(["P1 swapped with P2."]);
  });

  it("swap ignores a window that is mostly below and does nothing without a neighbor", async () => {
    s = await setup(2);
    const [a, b] = s.ids as [PollId, PollId];
    s.ws.getState().setRect(b, R(20, 500, 300, 150));
    d().swapDirection(a, "right");
    expect(rectOf(a)).toEqual(R(8, 8, 640, 368));
    expect(s.announced).toEqual([]);
  });

  it("in tile mode it swaps with the adjacent slot in that direction", async () => {
    s = await setup(4, { tile: true });
    const [a, b, c, dd] = s.ids as [PollId, PollId, PollId, PollId];
    d().swapDirection(a, "right");
    expect(s.order).toEqual([b, a, c, dd]);
    d().swapDirection(a, "right");
    expect(s.order).toEqual([b, a, c, dd]);
    d().swapDirection(a, "down");
    expect(s.order).toEqual([b, dd, c, a]);
  });

  it("Move mode: arrows move an outline, Enter commits, Esc cancels", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    expect(d().beginKeyboard("keyboardMove", a)).toBe(true);
    d().keyboardStep("right", false);
    d().keyboardStep("down", false);
    expect(d().currentRect).toEqual(R(24, 24, 640, 368));
    expect(rectOf(a)).toEqual(R(8, 8, 640, 368));
    expect(d().end()).toMatchObject({ kind: "moved" });
    expect(rectOf(a)).toEqual(R(24, 24, 640, 368));
    d().beginKeyboard("keyboardMove", a);
    d().keyboardStep("right", false);
    d().cancel();
    expect(rectOf(a)).toEqual(R(24, 24, 640, 368));
    expect(s.announced.at(-1)).toBe("Move cancelled.");
  });

  it("Size mode moves the right and bottom edges", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().beginKeyboard("keyboardSize", a);
    d().keyboardStep("right", false);
    d().keyboardStep("down", false);
    expect(d().end()).toEqual({ kind: "resized", rect: R(8, 8, 656, 384) });
  });

  it("Size mode snaps the moving edge to a neighbor, like the pointer does (REV-006 n-1)", async () => {
    s = await setup(2);
    const [a, b] = s.ids as [PollId, PollId];
    s.ws.getState().setRect(b, R(680, 8, 400, 300));
    // The right edge of A is at 648; one step makes 664, 8 px from the gap line at 672.
    d().beginKeyboard("keyboardSize", a);
    d().keyboardStep("right", false);
    expect(d().guides).toHaveLength(1);
    expect(d().end()).toEqual({ kind: "resized", rect: R(8, 8, 664, 368) });
  });

  it("Size mode does not snap when 'Snap while moving' is off", async () => {
    s = await setup(2);
    const [a, b] = s.ids as [PollId, PollId];
    s.ws.getState().setRect(b, R(680, 8, 400, 300));
    d().toggleSnap();
    d().beginKeyboard("keyboardSize", a);
    d().keyboardStep("right", false);
    expect(d().guides).toHaveLength(0);
    expect(d().end()).toEqual({ kind: "resized", rect: R(8, 8, 656, 368) });
  });

  it("the keyboard modes are not available in tile mode", async () => {
    s = await setup(2, { tile: true });
    expect(d().beginKeyboard("keyboardMove", s.ids[0] as PollId)).toBe(false);
  });

  it("steps outside a keyboard mode do nothing", async () => {
    s = await setup(1);
    d().keyboardStep("right", false);
    expect(d().currentRect).toBeNull();
  });

  it("Move to a zone sets the zone rectangle and announces it", async () => {
    s = await setup(1);
    const a = s.ids[0] as PollId;
    d().moveToZone(a, "topRight");
    expect(rectOf(a)).toEqual(R(670, 8, 654, 346));
    expect(s.announced).toEqual(["P1 moved to the top-right quarter."]);
  });

  it("Move to Slot n in tile mode reorders; the own slot does nothing", async () => {
    s = await setup(3, { tile: true });
    const [a, b, c] = s.ids as [PollId, PollId, PollId];
    d().moveToSlot(a, 0);
    expect(s.setOrder).not.toHaveBeenCalled();
    d().moveToSlot(a, 2);
    expect(s.order).toEqual([b, c, a]);
    expect(s.announced).toEqual(["P1 moved to slot 3 of 3."]);
  });
});

describe("a row dragged from the poll list (DES-002 2.10.6, 2.10.7)", () => {
  // Client coordinates: four rows of 48 px with 2 px between them in a list at (0, 100), and the
  // workspace at (300, 56).
  const ROWS = [R(0, 100, 260, 48), R(0, 150, 260, 48), R(0, 200, 260, 48), R(0, 250, 260, 48)];
  const LIST = R(0, 100, 260, 400);
  const WORKSPACE = R(300, 56, 1332, 716);
  const over = (x: number, y: number, mods = NO_MODS) => ({
    pointer: { x, y },
    rows: ROWS,
    list: LIST,
    workspace: WORKSPACE,
    modifiers: mods,
  });
  function listPointer(x: number, y: number, mods = NO_MODS) {
    d().updateList(over(x, y, mods));
    s.frame();
  }

  it("beginList starts a list reorder at the index of the row; an unknown poll does nothing", async () => {
    s = await setup(4);
    expect(d().beginList(s.ids[2] as PollId)).toBe(true);
    expect(d()).toMatchObject({ kind: "listReorder", pollId: s.ids[2], listFromIndex: 2 });
    expect(d().beginList(999)).toBe(false);
    d().cancel();
  });

  it("over the list the insertion gap is the one nearest to the pointer", async () => {
    s = await setup(4);
    d().beginList(s.ids[0] as PollId);
    listPointer(100, 252);
    expect(d()).toMatchObject({ kind: "listReorder", listGapIndex: 3, listPlace: null });
    expect(d().listPointer).toEqual({ x: 100, y: 252 });
    listPointer(100, 101);
    expect(d().listGapIndex).toBe(0);
    d().cancel();
  });

  it("row 1 dropped between rows 3 and 4 gives [B, C, A, D] and announces the position", async () => {
    s = await setup(4);
    const [a, b, c, dd] = s.ids as [PollId, PollId, PollId, PollId];
    d().beginList(a);
    listPointer(100, 249);
    expect(d().listGapIndex).toBe(3);
    expect(d().end()).toEqual({ kind: "listReordered", index: 2 });
    expect(s.setOrder).toHaveBeenCalledWith([b, c, a, dd]);
    expect(s.announced).toEqual(["P1 moved to position 3 of 4."]);
    expect(d().kind).toBe("none");
    expect(d().listGapIndex).toBeNull();
    expect(d().listPointer).toBeNull();
  });

  it("a gap next to the own place of the row changes nothing", async () => {
    s = await setup(4);
    d().beginList(s.ids[1] as PollId);
    listPointer(100, 149);
    expect(d().listGapIndex).toBe(1);
    expect(d().end()).toEqual({ kind: "unchanged" });
    d().beginList(s.ids[1] as PollId);
    listPointer(100, 199);
    expect(d().listGapIndex).toBe(2);
    expect(d().end()).toEqual({ kind: "unchanged" });
    expect(s.setOrder).not.toHaveBeenCalled();
    expect(s.announced).toEqual([]);
  });

  it("dragging down to the end and up to the top", async () => {
    s = await setup(4);
    const [a, b, c, dd] = s.ids as [PollId, PollId, PollId, PollId];
    d().beginList(b);
    listPointer(100, 330);
    expect(d().listGapIndex).toBe(4);
    d().end();
    expect(s.setOrder).toHaveBeenLastCalledWith([a, c, dd, b]);
    // The mock applied the new order: the list is [A, C, D, B] now.
    d().beginList(dd);
    listPointer(100, 101);
    expect(d().listGapIndex).toBe(0);
    d().end();
    expect(s.setOrder).toHaveBeenLastCalledWith([dd, a, c, b]);
  });

  it("outside the list and the workspace there is no target, and the release does nothing", async () => {
    s = await setup(4);
    d().beginList(s.ids[0] as PollId);
    d().updateList({ ...over(280, 40), workspace: null });
    s.frame();
    expect(d()).toMatchObject({ kind: "listReorder", listGapIndex: null, listPlace: null });
    expect(d().end()).toEqual({ kind: "unchanged" });
    expect(s.setOrder).not.toHaveBeenCalled();
    expect(s.placeFromList).not.toHaveBeenCalled();
  });

  it("a pointer within 16 px above the first row or below the list still targets the list", async () => {
    s = await setup(4);
    d().beginList(s.ids[2] as PollId);
    listPointer(100, 90);
    expect(d().listGapIndex).toBe(0);
    listPointer(100, 84);
    expect(d().listGapIndex).toBe(0);
    listPointer(100, 83);
    expect(d().listGapIndex).toBeNull();
    listPointer(100, 515);
    expect(d().listGapIndex).toBe(4);
    listPointer(100, 516);
    expect(d().listGapIndex).toBeNull();
    // The tolerance is vertical only.
    listPointer(262, 90);
    expect(d().listGapIndex).toBeNull();
    d().cancel();
  });

  it("releasing 10 px above the first row moves the poll to the top", async () => {
    s = await setup(4);
    const [a, b, c, dd] = s.ids as [PollId, PollId, PollId, PollId];
    d().beginList(dd);
    listPointer(100, 90);
    d().end();
    expect(s.setOrder).toHaveBeenCalledWith([dd, a, b, c]);
  });

  it("the moved poll is found by its id when the list changed during the drag (REV-006 m-3)", async () => {
    s = await setup(4);
    const [, b, c, dd] = s.ids as [PollId, PollId, PollId, PollId];
    d().beginList(c);
    listPointer(100, 330);
    expect(d().listGapIndex).toBe(4);
    // A is deleted while the button is held: C is at index 1 now, not 2.
    s.order.splice(0, 1);
    expect(d().end()).toEqual({ kind: "listReordered", index: 2 });
    expect(s.setOrder).toHaveBeenCalledWith([b, dd, c]);
    expect(s.announced).toEqual(["P3 moved to position 3 of 3."]);
  });

  it("a poll that left the list during the drag is dropped without a move", async () => {
    s = await setup(3);
    const [a] = s.ids as [PollId];
    d().beginList(a);
    listPointer(100, 252);
    s.order.splice(0, 1);
    expect(d().end()).toEqual({ kind: "unchanged" });
    expect(s.setOrder).not.toHaveBeenCalled();
  });

  it("a rejected reorder is not announced, an accepted one is, after the command (REV-006 m-4)", async () => {
    s = await setup(4);
    const [a] = s.ids as [PollId];
    s.setOrder.mockImplementationOnce(async () => false);
    d().beginList(a);
    listPointer(100, 249);
    d().end();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.announced).toEqual([]);

    let accept!: (ok: boolean) => void;
    s.setOrder.mockImplementationOnce(() => new Promise<boolean>((r) => (accept = r)));
    d().beginList(a);
    listPointer(100, 249);
    d().end();
    expect(s.announced).toEqual([]);
    accept(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.announced).toEqual(["P1 moved to position 3 of 4."]);
  });

  it("a refused drop into the workspace is not announced; a native poll is not announced twice", async () => {
    s = await setup(2);
    const [a] = s.ids as [PollId];
    s.placeFromList.mockResolvedValueOnce(false);
    d().beginList(a);
    listPointer(900, 356);
    d().end();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.announced).toEqual([]);

    s.placeFromList.mockResolvedValueOnce(true);
    d().beginList(a);
    listPointer(900, 356);
    d().end();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.announced).toEqual(["P1 shown in the workspace."]);
  });

  it("abort drops the drag of a poll that is gone, silently, and ignores other polls", async () => {
    s = await setup(3);
    const [a, b] = s.ids as [PollId, PollId];
    d().beginList(a);
    d().abort(b);
    expect(d().kind).toBe("listReorder");
    d().abort(a);
    expect(d().kind).toBe("none");
    expect(s.announced).toEqual([]);
  });

  it("over the workspace the preview is the default size with the title bar under the pointer", async () => {
    s = await setup(2);
    d().beginList(s.ids[0] as PollId);
    // Workspace coordinates (600, 300).
    listPointer(900, 356);
    expect(d().kind).toBe("listToWorkspace");
    expect(d().listGapIndex).toBeNull();
    expect(d().listPlace).toEqual({ kind: "rect", rect: R(280, 285, 640, 368) });
    d().cancel();
  });

  it("the drop calls placeFromList once and announces that the poll is shown", async () => {
    s = await setup(2);
    const a = s.ids[0] as PollId;
    d().beginList(a);
    listPointer(900, 356);
    const place = { kind: "rect", rect: R(280, 285, 640, 368) };
    expect(d().end()).toEqual({ kind: "listPlaced", place });
    expect(s.placeFromList).toHaveBeenCalledOnce();
    expect(s.placeFromList).toHaveBeenCalledWith(a, place);
    expect(s.announced).toEqual(["P1 shown in the workspace."]);
    expect(d().kind).toBe("none");
    expect(d().listPlace).toBeNull();
  });

  it("at the right edge of the workspace the preview is the right half and the drop announces it", async () => {
    s = await setup(2);
    d().beginList(s.ids[0] as PollId);
    // Workspace x 1320 is within 24 px of the right edge of the tile area (1324).
    listPointer(300 + 1320, 356);
    expect(d().listPlace).toEqual({ kind: "zone", zone: "right", rect: R(670, 8, 654, 700) });
    d().end();
    expect(s.announced).toEqual(["P1 moved to the right half."]);
  });

  it("Alt turns the zone off during a list drag, and so does the Snap switch", async () => {
    s = await setup(2);
    d().beginList(s.ids[0] as PollId);
    listPointer(300 + 1320, 356, ALT);
    expect(d().listPlace?.kind).toBe("rect");
    listPointer(300 + 1320, 356);
    expect(d().listPlace?.kind).toBe("zone");
    d().cancel();
    d().toggleSnap();
    d().beginList(s.ids[0] as PollId);
    listPointer(300 + 1320, 356);
    expect(d().listPlace?.kind).toBe("rect");
    d().cancel();
  });

  it("moving back from the workspace to the list swaps the target again", async () => {
    s = await setup(4);
    d().beginList(s.ids[0] as PollId);
    listPointer(900, 356);
    expect(d().kind).toBe("listToWorkspace");
    listPointer(100, 252);
    expect(d()).toMatchObject({ kind: "listReorder", listGapIndex: 3, listPlace: null });
    d().cancel();
  });

  it("in tile mode the preview is the slot the poll would take and the drop announces the slot", async () => {
    s = await setup(3, { tile: true });
    const a = s.ids[0] as PollId;
    d().beginList(a);
    // The three are tiled in a 2 x 2 grid; the pointer is in the second cell (workspace 900, 100).
    listPointer(300 + 900, 56 + 100);
    expect(d().listPlace).toMatchObject({ kind: "slot", index: 1 });
    expect(d().end()).toMatchObject({ kind: "listPlaced", place: { kind: "slot", index: 1 } });
    expect(s.announced).toEqual(["P1 moved to slot 2 of 3."]);
  });

  it("a poll that is not tiled yet joins a grid of one window more", async () => {
    s = await setup(3, { tile: true });
    const a = s.ids[0] as PollId;
    // A is minimized: two tiles are left, the dropped A makes three again.
    s.ws.getState().minimize(a);
    d().beginList(a);
    listPointer(300 + 100, 56 + 100);
    expect(d().listPlace).toMatchObject({ kind: "slot", index: 0 });
    d().end();
    expect(s.announced).toEqual(["P1 moved to slot 1 of 3."]);
  });

  it("Esc cancels: nothing is committed, and Move cancelled is announced", async () => {
    s = await setup(4);
    d().beginList(s.ids[0] as PollId);
    listPointer(100, 252);
    d().cancel();
    expect(d().kind).toBe("none");
    expect(d().listGapIndex).toBeNull();
    expect(s.setOrder).not.toHaveBeenCalled();
    expect(s.announced).toEqual(["Move cancelled."]);
  });

  it("100 list updates within one frame compute once; the last position counts at the release", async () => {
    s = await setup(4);
    d().beginList(s.ids[0] as PollId);
    const seen = vi.fn();
    const off = s.drag.subscribe(seen);
    for (let i = 0; i < 100; i += 1) d().updateList(over(100, 100 + i));
    expect(s.scheduled()).toBe(1);
    expect(seen).not.toHaveBeenCalled();
    s.frame();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    // A position whose frame has not run yet is used by end().
    d().updateList(over(100, 330));
    d().end();
    expect(s.setOrder).toHaveBeenCalledTimes(1);
  });

  it("a list drag does not touch the workspace or report the layout", async () => {
    s = await setup(2);
    const before = s.ws.getState().items;
    const flushes = s.flushes();
    d().beginList(s.ids[0] as PollId);
    listPointer(900, 356);
    d().end();
    expect(s.ws.getState().items).toBe(before);
    expect(s.flushes()).toBe(flushes);
  });

  it("update and updateList ignore the wrong kind of drag", async () => {
    s = await setup(2);
    d().updateList(over(100, 100));
    expect(d().kind).toBe("none");
    d().beginList(s.ids[0] as PollId);
    d().update({ x: 5, y: 5 }, NO_MODS);
    expect(s.scheduled()).toBe(0);
    d().cancel();
    d().begin("move", s.ids[0] as PollId, { x: 100, y: 100 });
    d().updateList(over(100, 100));
    expect(s.scheduled()).toBe(0);
    d().cancel();
  });
});
