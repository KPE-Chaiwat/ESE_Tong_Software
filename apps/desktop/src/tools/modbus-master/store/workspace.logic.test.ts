import type { PollSummary } from "@/shared/ipc/modbus-master.types";
import type { Rect } from "@/shared/lib/layout-math";
import {
  cascadeItems,
  clampItems,
  clampSidebarWidth,
  clampTrafficHeight,
  cycleId,
  defaultTrafficHeight,
  dropRect,
  fitMaximized,
  hasMinimized,
  idsByZ,
  isShownInWorkspace,
  itemFromWorkspaceRect,
  itemsEqual,
  itemsFromLayout,
  MAX_Z,
  maximizedIdOf,
  maximizeItem,
  minimizeItem,
  nextSlotRect,
  planSync,
  raise,
  renumberZ,
  restoreItem,
  type SubWindowItem,
  type SubWindowItems,
  shownSignature,
  sizeKnown,
  swapItems,
  tileAreaOf,
  tileItems,
  tileSlots,
  toLayout,
  topVisibleId,
  topZ,
  toWorkspaceRect,
  visibleIds,
} from "./workspace.logic";

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const item = (rect: Rect, z: number, state: SubWindowItem["state"] = "normal"): SubWindowItem => ({
  rect,
  z,
  state,
  restore: null,
});
const AREA = R(8, 8, 1316, 700);

function windows(n: number): SubWindowItems {
  const items: SubWindowItems = {};
  for (let i = 1; i <= n; i += 1) items[i] = item(R(8, 8, 640, 368), i);
  return items;
}
const order = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("areas", () => {
  it("the tile area is the workspace minus 8 px padding", () => {
    expect(tileAreaOf({ width: 1332, height: 716 }, false)).toEqual(AREA);
  });

  it("the minimized bar and a gap (44 + 8) are taken off the height", () => {
    expect(tileAreaOf({ width: 1332, height: 716 }, true)).toEqual(R(8, 8, 1316, 648));
  });

  it("never goes negative and knows an unmeasured size", () => {
    expect(tileAreaOf({ width: 10, height: 10 }, true)).toEqual(R(8, 8, 0, 0));
    expect(sizeKnown({ width: 0, height: 0 })).toBe(false);
    expect(sizeKnown({ width: 1, height: 1 })).toBe(true);
  });
});

describe("queries", () => {
  const items: SubWindowItems = {
    1: item(R(0, 0, 400, 300), 3),
    2: item(R(0, 0, 400, 300), 1, "minimized"),
    3: { ...item(AREA, 2, "maximized"), restore: R(8, 8, 400, 300) },
  };

  it("orders by z, back to front", () => {
    expect(idsByZ(items)).toEqual([2, 3, 1]);
  });

  it("visible ids leave out the minimized ones", () => {
    expect(visibleIds(items)).toEqual([3, 1]);
    expect(topVisibleId(items)).toBe(1);
    expect(topVisibleId(items, 1)).toBe(3);
    expect(topVisibleId({})).toBeNull();
  });

  it("finds the maximized one and the minimized bar", () => {
    expect(maximizedIdOf(items)).toBe(3);
    expect(maximizedIdOf(windows(2))).toBeNull();
    expect(hasMinimized(items)).toBe(true);
    expect(hasMinimized(windows(2))).toBe(false);
  });
});

describe("z-order", () => {
  it("raise puts a window on top and keeps the others", () => {
    const items = windows(3);
    const next = raise(items, 1);
    expect(idsByZ(next)).toEqual([2, 3, 1]);
    expect(next[2]).toBe(items[2]);
  });

  it("the z values are renumbered before they grow past MAX_Z (REV-006 n-6)", () => {
    const items = windows(3);
    const high = {
      1: { ...(items[1] as SubWindowItem), z: MAX_Z + 5 },
      2: { ...(items[2] as SubWindowItem), z: MAX_Z + 3 },
      3: { ...(items[3] as SubWindowItem), z: MAX_Z + 4 },
    };
    const next = raise(high, 2);
    expect(idsByZ(next)).toEqual([3, 1, 2]);
    expect(Math.max(...Object.values(next).map((i) => i.z))).toBe(4);
    expect(renumberZ(high)[2]?.z).toBe(1);
  });

  it("raise of the front window changes nothing", () => {
    const items = windows(3);
    expect(raise(items, 3)).toBe(items);
    expect(raise(items, 99)).toBe(items);
  });

  it("renumberZ gives 1..n and breaks duplicates by poll id", () => {
    const items: SubWindowItems = {
      5: item(R(0, 0, 1, 1), 40),
      2: item(R(0, 0, 1, 1), 40),
      9: item(R(0, 0, 1, 1), 7),
    };
    const next = renumberZ(items);
    expect(idsByZ(next)).toEqual([9, 2, 5]);
    expect(
      Object.values(next)
        .map((i) => i.z)
        .sort(),
    ).toEqual([1, 2, 3]);
    expect(renumberZ(next)).toBe(next);
    expect(topZ(next)).toBe(4);
  });
});

describe("state of one window", () => {
  const normal = item(R(10, 20, 640, 368), 1);

  it("maximize keeps the normal rectangle and fills the area", () => {
    const max = maximizeItem(normal, AREA);
    expect(max).toMatchObject({ state: "maximized", rect: AREA, restore: normal.rect });
    expect(maximizeItem(max, AREA)).toBe(max);
  });

  it("restore returns the previous rectangle", () => {
    expect(restoreItem(maximizeItem(normal, AREA))).toEqual(normal);
    expect(restoreItem(normal)).toBe(normal);
  });

  it("minimize of a maximized window goes back to the normal rectangle first", () => {
    const min = minimizeItem(maximizeItem(normal, AREA));
    expect(min).toMatchObject({ state: "minimized", rect: normal.rect, restore: null });
    expect(restoreItem(min)).toMatchObject({ state: "normal", rect: normal.rect });
  });

  it("a maximized window follows the tile area", () => {
    const items = { 1: maximizeItem(normal, AREA) };
    const smaller = R(8, 8, 1000, 500);
    expect(fitMaximized(items, smaller)[1]?.rect).toEqual(smaller);
    expect(fitMaximized(items, AREA)).toBe(items);
  });
});

describe("clamping (DES-002 2.10.1)", () => {
  const size = { width: 1332, height: 716 };

  it("keeps 80 x 30 px of the title bar inside", () => {
    const items = { 1: item(R(-600, -50, 640, 368), 1), 2: item(R(5000, 5000, 640, 368), 2) };
    const next = clampItems(items, size, AREA);
    expect(next[1]?.rect).toMatchObject({ x: -560, y: 0 });
    expect(next[2]?.rect).toMatchObject({ x: 1252, y: 686 });
  });

  it("raises a window to the 320 x 180 minimum", () => {
    const next = clampItems({ 1: item(R(8, 8, 100, 50), 1) }, size, AREA);
    expect(next[1]?.rect).toEqual(R(8, 8, 320, 180));
  });

  it("leaves valid windows (the same objects) alone", () => {
    const items = windows(2);
    expect(clampItems(items, size, AREA)).toBe(items);
  });

  it("an unmeasured workspace is not clamped", () => {
    const items = { 1: item(R(-9000, 0, 640, 368), 1) };
    expect(clampItems(items, { width: 0, height: 0 }, AREA)).toBe(items);
  });

  it("a maximized window gets the area and a clamped restore rectangle", () => {
    const max = { ...maximizeItem(item(R(-9000, 0, 640, 368), 1), R(0, 0, 1, 1)) };
    const next = clampItems({ 1: max }, size, AREA);
    expect(next[1]?.rect).toEqual(AREA);
    expect(next[1]?.restore?.x).toBe(-560);
  });
});

describe("swap", () => {
  it("exchanges the rectangles and keeps everything else", () => {
    const items = { 1: item(R(0, 0, 400, 300), 1), 2: item(R(500, 100, 600, 400), 2) };
    const next = swapItems(items, 1, 2);
    expect(next[1]?.rect).toEqual(R(500, 100, 600, 400));
    expect(next[2]?.rect).toEqual(R(0, 0, 400, 300));
    expect(next[1]?.z).toBe(1);
  });

  it("restores a maximized target first", () => {
    const max = maximizeItem(item(R(500, 100, 600, 400), 2), AREA);
    const next = swapItems({ 1: item(R(0, 0, 400, 300), 1), 2: max }, 1, 2);
    expect(next[2]).toMatchObject({ state: "normal", rect: R(0, 0, 400, 300), restore: null });
    expect(next[1]?.rect).toEqual(R(500, 100, 600, 400));
  });

  it("does nothing for itself or an unknown window", () => {
    const items = windows(2);
    expect(swapItems(items, 1, 1)).toBe(items);
    expect(swapItems(items, 1, 9)).toBe(items);
  });
});

describe("tile (DES-002 2.8.1, vectors WT-1 to WT-3)", () => {
  it("WT-1: four windows in 2 x 2", () => {
    const { items, overflow, tiled, cols } = tileItems(windows(4), order(4), AREA);
    expect(order(4).map((id) => items[id]?.rect)).toEqual([
      R(8, 8, 654, 346),
      R(670, 8, 654, 346),
      R(8, 362, 654, 346),
      R(670, 362, 654, 346),
    ]);
    expect({ overflow, tiled, cols }).toEqual({ overflow: 0, tiled: 4, cols: 2 });
  });

  it("WT-2: three windows, the last row shares the full width", () => {
    const { items } = tileItems(windows(3), order(3), AREA);
    expect(order(3).map((id) => items[id]?.rect)).toEqual([
      R(8, 8, 654, 346),
      R(670, 8, 654, 346),
      R(8, 362, 1316, 346),
    ]);
  });

  it("WT-3: 13 windows, 12 tiled at 323 x 228 and one cascaded", () => {
    const { items, overflow, tiled } = tileItems(windows(13), order(13), AREA);
    expect(overflow).toBe(1);
    expect(tiled).toBe(12);
    expect(items[1]?.rect).toEqual(R(8, 8, 323, 228));
    expect(items[12]?.rect).toEqual(R(1001, 480, 323, 228));
    expect(items[13]?.rect).toEqual(R(8, 8, 323, 228));
    // The cascaded one lies on top of the tiles.
    expect(idsByZ(items).at(-1)).toBe(13);
  });

  it("follows the list order, not the z-order", () => {
    const items = windows(2);
    const { items: next } = tileItems(items, [2, 1], AREA);
    expect(next[2]?.rect.x).toBe(8);
    expect(next[1]?.rect.x).toBe(670);
    expect(idsByZ(next)).toEqual([2, 1]);
  });

  it("minimized windows get no slot and stay behind", () => {
    const items = { ...windows(3), 2: item(R(8, 8, 640, 368), 2, "minimized") };
    const { items: next, tiled } = tileItems(items, order(3), AREA);
    expect(tiled).toBe(2);
    expect(next[2]).toMatchObject({ state: "minimized", rect: items[2]?.rect });
    expect(next[1]?.rect.width).toBe(654);
    expect(idsByZ(next)[0]).toBe(2);
  });

  it("a maximized window keeps filling the area and gets its slot as the restore rectangle", () => {
    const items = windows(2);
    items[1] = maximizeItem(items[1] as SubWindowItem, AREA);
    const { items: next } = tileItems(items, order(2), AREA);
    expect(next[1]?.state).toBe("maximized");
    expect(next[1]?.rect).toEqual(AREA);
    expect(next[1]?.restore).toEqual(R(8, 8, 654, 700));
  });

  it("the Tile command restores maximized windows first", () => {
    const items = windows(2);
    items[1] = maximizeItem(items[1] as SubWindowItem, AREA);
    const { items: next } = tileItems(items, order(2), AREA, { restoreMaximized: true });
    expect(next[1]).toMatchObject({ state: "normal", rect: R(8, 8, 654, 700) });
  });

  it("is stable: tiling a tiled workspace returns the same items", () => {
    const first = tileItems(windows(4), order(4), AREA).items;
    expect(tileItems(first, order(4), AREA).items).toBe(first);
  });

  it("does nothing without windows", () => {
    const empty: SubWindowItems = {};
    expect(tileItems(empty, [], AREA)).toMatchObject({ items: empty, tiled: 0, overflow: 0 });
  });

  it("slots can be read without changing anything", () => {
    const slots = tileSlots(windows(4), order(4), AREA);
    expect(slots.ids).toEqual([1, 2, 3, 4]);
    expect(slots.rects[3]).toEqual(R(670, 362, 654, 346));
    expect(slots.cols).toBe(2);
    expect(tileSlots({}, [], AREA).rects).toEqual([]);
  });
});

describe("cascade (DES-002 2.8.4)", () => {
  it("three windows step by 24 px at 640 x 368, the last in front", () => {
    const next = cascadeItems(windows(3), order(3), AREA);
    expect(order(3).map((id) => next[id]?.rect)).toEqual([
      R(8, 8, 640, 368),
      R(32, 32, 640, 368),
      R(56, 56, 640, 368),
    ]);
    expect(idsByZ(next)).toEqual([1, 2, 3]);
  });

  it("the 11th window starts a new column 240 px to the right", () => {
    const next = cascadeItems(windows(11), order(11), AREA);
    expect(next[11]?.rect).toMatchObject({ x: 248, y: 8 });
  });

  it("restores maximized windows", () => {
    const items = windows(2);
    items[2] = maximizeItem(items[2] as SubWindowItem, AREA);
    expect(cascadeItems(items, order(2), AREA)[2]?.state).toBe("normal");
  });
});

describe("placement of a new window (DES-002 2.4)", () => {
  it("the first window is at (8, 8), then 24 px further for every visible one", () => {
    expect(nextSlotRect({}, AREA)).toEqual(R(8, 8, 640, 368));
    expect(nextSlotRect(windows(2), AREA)).toEqual(R(56, 56, 640, 368));
  });

  it("a minimized window does not count", () => {
    const items = { ...windows(2), 2: item(R(0, 0, 1, 1), 2, "minimized") };
    expect(nextSlotRect(items, AREA)).toMatchObject({ x: 32, y: 32 });
  });

  it("the default size is clamped to a small area", () => {
    expect(nextSlotRect({}, R(8, 8, 500, 300))).toEqual(R(8, 8, 500, 300));
  });

  it("a drop centers the title bar under the pointer", () => {
    expect(dropRect({ x: 500, y: 200 }, { width: 1332, height: 716 })).toEqual(
      R(180, 185, 640, 368),
    );
  });
});

describe("layout conversion", () => {
  const items: SubWindowItems = {
    1: item(R(10, 20, 640, 368), 5),
    2: maximizeItem(item(R(30, 40, 500, 300), 9), AREA),
    3: item(R(50, 60, 400, 250), 2, "minimized"),
  };

  it("toLayout lists the items from back to front with renumbered z", () => {
    const layout = toLayout({
      items,
      minimizedOrder: [3],
      tileMode: true,
      compact: false,
      sidebar: { width: 300, collapsed: true },
      traffic: { expanded: true, height: 240.4 },
    });
    expect(layout.items.map((i) => i.pollId)).toEqual([3, 1, 2]);
    expect(layout.items.map((i) => i.rect.z)).toEqual([1, 2, 3]);
    expect(layout.items[2]?.rect).toMatchObject({
      state: "maximized",
      restore: R(30, 40, 500, 300),
    });
    expect(layout).toMatchObject({
      minimizedOrder: [3],
      tileMode: true,
      sidebarWidth: 300,
      sidebarCollapsed: true,
      trafficExpanded: true,
      trafficHeight: 240,
    });
  });

  it("the minimized order only lists windows that are minimized", () => {
    const layout = toLayout({
      items,
      minimizedOrder: [1, 3, 9],
      tileMode: false,
      compact: false,
      sidebar: { width: 280, collapsed: false },
      traffic: { expanded: false, height: null },
    });
    expect(layout.minimizedOrder).toEqual([3]);
    expect(layout.trafficHeight).toBeNull();
  });

  it("round-trips through the layout", () => {
    const layout = toLayout({
      items,
      minimizedOrder: [3],
      tileMode: false,
      compact: false,
      sidebar: { width: 280, collapsed: false },
      traffic: { expanded: false, height: null },
    });
    const back = itemsFromLayout(layout, new Set([1, 2, 3]), AREA);
    expect(idsByZ(back)).toEqual(idsByZ(renumberZ(items)));
    expect(back[2]).toMatchObject({ state: "maximized", rect: AREA, restore: R(30, 40, 500, 300) });
    expect(back[3]?.state).toBe("minimized");
  });

  it("drops rectangles of polls that are not shown and renumbers duplicate z", () => {
    const layout = {
      items: [
        { pollId: 1, rect: { ...toWorkspaceRect(item(R(0, 0, 400, 300), 4)) } },
        { pollId: 2, rect: { ...toWorkspaceRect(item(R(0, 0, 400, 300), 4)) } },
        { pollId: 3, rect: { ...toWorkspaceRect(item(R(0, 0, 400, 300), 1)) } },
      ],
    };
    const back = itemsFromLayout(layout, new Set([1, 2]), AREA);
    expect(Object.keys(back)).toEqual(["1", "2"]);
    expect(new Set(Object.values(back).map((i) => i.z)).size).toBe(2);
  });

  it("a stored maximized rectangle fills the area", () => {
    const r = { ...toWorkspaceRect(item(R(0, 0, 10, 10), 1)), state: "maximized" as const };
    expect(itemFromWorkspaceRect(r, AREA, 3)).toMatchObject({
      rect: AREA,
      z: 3,
      restore: R(0, 0, 10, 10),
    });
  });

  it("clamps the sidebar width to 220-400 and the traffic panel to 120 px - 70%", () => {
    expect(clampSidebarWidth(100)).toBe(220);
    expect(clampSidebarWidth(900)).toBe(400);
    expect(clampSidebarWidth(Number.NaN)).toBe(280);
    expect(clampTrafficHeight(10, 800)).toBe(120);
    expect(clampTrafficHeight(900, 800)).toBe(560);
    expect(defaultTrafficHeight(800)).toBe(280);
  });

  it("itemsEqual compares the item objects", () => {
    const a = windows(2);
    expect(itemsEqual(a, a)).toBe(true);
    expect(itemsEqual(a, { ...a })).toBe(true);
    expect(itemsEqual(a, { ...a, 1: { ...(a[1] as SubWindowItem) } })).toBe(false);
    expect(itemsEqual(a, windows(3))).toBe(false);
  });
});

function summary(
  id: number,
  patch: Partial<Pick<PollSummary, "host" | "open" | "workspace">> = {},
): PollSummary {
  return {
    config: { pollId: id, name: `Poll ${id}` },
    host: "workspace",
    open: true,
    workspace: null,
    ...patch,
  } as PollSummary;
}

describe("which polls are sub-windows", () => {
  it("a poll is shown when its host is the workspace and it is open", () => {
    expect(isShownInWorkspace(summary(1))).toBe(true);
    expect(isShownInWorkspace(summary(1, { open: false }))).toBe(false);
    expect(isShownInWorkspace(summary(1, { host: "native" }))).toBe(false);
  });

  it("plans the mounts and unmounts", () => {
    const items = windows(2);
    const plan = planSync(items, [summary(2), summary(3), summary(4, { host: "native" })]);
    expect(plan.mount.map((p) => p.config.pollId)).toEqual([3]);
    expect(plan.unmount).toEqual([1]);
  });

  it("the signature changes with who is shown and with the order", () => {
    const a = shownSignature([summary(1), summary(2)]);
    expect(shownSignature([summary(2), summary(1)])).not.toBe(a);
    expect(shownSignature([summary(1), summary(2, { open: false })])).not.toBe(a);
    expect(shownSignature([summary(1), summary(2)])).toBe(a);
  });
});

describe("cycleId", () => {
  it("goes forward and backward and wraps", () => {
    expect(cycleId([1, 2, 3], 1, 1)).toBe(2);
    expect(cycleId([1, 2, 3], 3, 1)).toBe(1);
    expect(cycleId([1, 2, 3], 1, -1)).toBe(3);
  });

  it("starts at the first or the last when there is no current window", () => {
    expect(cycleId([1, 2, 3], null, 1)).toBe(1);
    expect(cycleId([1, 2, 3], 9, -1)).toBe(3);
    expect(cycleId([], null, 1)).toBeNull();
  });
});
