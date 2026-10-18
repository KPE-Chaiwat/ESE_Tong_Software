import type { MonitorInfo } from "@/shared/ipc/modbus-master.types";
import {
  arrangeNative,
  cascadeRects,
  clampMin,
  clampRect,
  groupByMonitor,
  NATIVE_ARRANGE,
  nextSlot,
  type Rect,
  sideBySideRects,
  stackedRects,
  tileRects,
  WORKSPACE_ARRANGE,
} from "./layout-math";

const WS_AREA: Rect = { x: 8, y: 8, width: 1316, height: 700 };
const WS = WORKSPACE_ARRANGE;
const NATIVE_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1032 };
const NT = NATIVE_ARRANGE;

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe("tileRects: DES-002 2.8.1 test vectors", () => {
  it("WT-1: 4 windows are 2 x 2", () => {
    const result = tileRects(4, WS_AREA, WS.gap, WS.min);
    expect(result.rects).toEqual([
      r(8, 8, 654, 346),
      r(670, 8, 654, 346),
      r(8, 362, 654, 346),
      r(670, 362, 654, 346),
    ]);
    expect(result.overflow).toBe(0);
    expect(result.tiled).toBe(4);
  });

  it("WT-2: 3 windows, the last row shares the full width", () => {
    const result = tileRects(3, WS_AREA, WS.gap, WS.min);
    expect(result.rects).toEqual([r(8, 8, 654, 346), r(670, 8, 654, 346), r(8, 362, 1316, 346)]);
  });

  it("WT-3: 13 windows: 12 tiled at 323 x 228, one cascaded at (8, 8)", () => {
    const result = tileRects(13, WS_AREA, WS.gap, WS.min);
    expect(result.cols).toBe(4);
    expect(result.rows).toBe(3);
    expect(result.tiled).toBe(12);
    expect(result.overflow).toBe(1);
    expect(result.rects).toHaveLength(13);
    for (const rect of result.rects.slice(0, 12)) {
      expect(rect.width).toBe(323);
      expect(rect.height).toBe(228);
    }
    expect(result.rects[12]).toEqual(r(8, 8, 323, 228));
  });

  it("WT-4: one window in a small area fills it", () => {
    const result = tileRects(1, r(8, 8, 600, 300), WS.gap, WS.min);
    expect(result.rects).toEqual([r(8, 8, 600, 300)]);
  });

  it("NT-1: 4 native windows on 1920 x 1032 at (0, 0)", () => {
    const result = tileRects(4, NATIVE_AREA, NT.gap, NT.min);
    expect(result.rects).toEqual([
      r(0, 0, 960, 516),
      r(960, 0, 960, 516),
      r(0, 516, 960, 516),
      r(960, 516, 960, 516),
    ]);
  });

  it("NT-2: 9 native windows are 3 x 3 at 640 x 344", () => {
    const result = tileRects(9, NATIVE_AREA, NT.gap, NT.min);
    expect(result.cols).toBe(3);
    expect(result.rows).toBe(3);
    expect(result.rects.every((rect) => rect.width === 640 && rect.height === 344)).toBe(true);
    expect(result.rects[4]).toEqual(r(640, 344, 640, 344));
  });

  it("NT-3: 13 native windows: 12 tiled at 480 x 344, one cascaded", () => {
    const result = tileRects(13, NATIVE_AREA, NT.gap, NT.min);
    expect(result.tiled).toBe(12);
    expect(result.overflow).toBe(1);
    expect(result.rects.slice(0, 12).every((x) => x.width === 480 && x.height === 344)).toBe(true);
    expect(result.rects[12]).toEqual(r(0, 0, 480, 344));
  });
});

describe("tileRects: edge cases", () => {
  it("n = 0 does nothing", () => {
    expect(tileRects(0, WS_AREA, WS.gap, WS.min)).toEqual({
      rects: [],
      overflow: 0,
      tiled: 0,
      cols: 0,
      rows: 0,
    });
  });

  it("remainder pixels go to the last column and the last row so the outer edges line up", () => {
    // 1001 x 601 with gap 8 and 2 x 2: cells are floor(993 / 2) = 496 and floor(593 / 2) = 296,
    // one pixel is left over in each direction.
    const area = r(0, 0, 1001, 601);
    const { rects } = tileRects(4, area, 8, { width: 100, height: 100 });
    expect(rects[0]).toEqual(r(0, 0, 496, 296));
    expect(rects[1]).toEqual(r(504, 0, 497, 296));
    expect(rects[2]).toEqual(r(0, 304, 496, 297));
    expect(rects[3]).toEqual(r(504, 304, 497, 297));
    expect(Math.max(...rects.map((x) => x.x + x.width))).toBe(1001);
    expect(Math.max(...rects.map((x) => x.y + x.height))).toBe(601);
  });

  it("the last row of 2 in 3 columns shares the full width, remainder to its last window", () => {
    const area = r(0, 0, 1000, 600);
    const { rects, cols } = tileRects(5, area, 8, { width: 100, height: 100 });
    expect(cols).toBe(3);
    // k = 2: w = floor((1000 - 8) / 2) = 496, the remainder (0) goes to the last one.
    expect(rects[3]).toEqual(r(0, 304, 496, 296));
    expect(rects[4]).toEqual(r(504, 304, 496, 296));
  });

  it("an area smaller than the minimum tiles one window and cascades the rest", () => {
    const result = tileRects(3, r(0, 0, 100, 100), 0, { width: 480, height: 320 });
    expect(result.tiled).toBe(1);
    expect(result.overflow).toBe(2);
    expect(result.rects[1]?.x).toBe(0);
    expect(result.rects[2]).toMatchObject({ x: 24, y: 24 });
  });

  it("overflow windows cascade with a column shift after 10", () => {
    const result = tileRects(25, r(0, 0, 640, 360), 0, { width: 640, height: 360 });
    expect(result.tiled).toBe(1);
    expect(result.overflow).toBe(24);
    // overflow index 10 is the 11th cascaded window.
    expect(result.rects[1 + 10]).toMatchObject({ x: 240, y: 0 });
  });
});

describe("sideBySideRects and stackedRects", () => {
  it("side by side with 3 native windows gives three 640 x 1032 columns", () => {
    const result = sideBySideRects(3, NATIVE_AREA, NT.gap, NT.min);
    expect(result.rects).toEqual([r(0, 0, 640, 1032), r(640, 0, 640, 1032), r(1280, 0, 640, 1032)]);
  });

  it("stacked with 3 native windows gives three 1920 x 344 rows", () => {
    const result = stackedRects(3, NATIVE_AREA, NT.gap, NT.min);
    expect(result.rects).toEqual([r(0, 0, 1920, 344), r(0, 344, 1920, 344), r(0, 688, 1920, 344)]);
  });

  it("side by side with more windows than columns cascades the overflow", () => {
    const result = sideBySideRects(6, NATIVE_AREA, NT.gap, NT.min);
    expect(result.tiled).toBe(4);
    expect(result.overflow).toBe(2);
    expect(result.rects[0]?.width).toBe(480);
  });

  it("stacked with more windows than rows cascades the overflow", () => {
    const result = stackedRects(5, NATIVE_AREA, NT.gap, NT.min);
    expect(result.tiled).toBe(3);
    expect(result.overflow).toBe(2);
  });

  it("n = 0 does nothing", () => {
    expect(sideBySideRects(0, NATIVE_AREA, 0, NT.min).rects).toEqual([]);
    expect(stackedRects(0, NATIVE_AREA, 0, NT.min).rects).toEqual([]);
  });
});

describe("cascadeRects", () => {
  it("3 workspace windows step by 24 px at the default size (CHK2-E7)", () => {
    const rects = cascadeRects(3, WS_AREA, WS.min, WS.defaultSize);
    expect(rects).toEqual([r(8, 8, 640, 368), r(32, 32, 640, 368), r(56, 56, 640, 368)]);
  });

  it("3 native windows cascade from the work area top-left at 900 x 640", () => {
    const rects = cascadeRects(3, NATIVE_AREA, NT.min, NT.defaultSize);
    expect(rects).toEqual([r(0, 0, 900, 640), r(24, 24, 900, 640), r(48, 48, 900, 640)]);
  });

  it("the 11th window (index 10) shifts right by 240 and starts at the top again", () => {
    const rects = cascadeRects(12, WS_AREA, WS.min, WS.defaultSize);
    expect(rects[10]).toMatchObject({ x: WS_AREA.x + 240, y: WS_AREA.y });
    expect(rects[9]).toMatchObject({ x: 8 + 216, y: 8 + 216 });
  });

  it("the size shrinks so 10 steps fit, but never below the minimum", () => {
    const small = cascadeRects(10, r(0, 0, 500, 300), WS.min, WS.defaultSize);
    // 500 - 24 * 9 = 284 < 320 -> the minimum width wins.
    expect(small[0]).toMatchObject({ width: 320, height: 180 });
    const roomy = cascadeRects(10, r(0, 0, 1000, 700), WS.min, WS.defaultSize);
    expect(roomy[0]).toMatchObject({ width: 640, height: 368 });
  });

  it("n = 0 gives nothing", () => {
    expect(cascadeRects(0, WS_AREA, WS.min, WS.defaultSize)).toEqual([]);
  });
});

describe("nextSlot", () => {
  it("is the cascade slot (8 + 24k, 8 + 24k) with k mod 10", () => {
    expect(nextSlot(0, WS_AREA, WS.defaultSize)).toEqual(r(8, 8, 640, 368));
    expect(nextSlot(3, WS_AREA, WS.defaultSize)).toEqual(r(80, 80, 640, 368));
    expect(nextSlot(10, WS_AREA, WS.defaultSize)).toEqual(r(8, 8, 640, 368));
    expect(nextSlot(13, WS_AREA, WS.defaultSize)).toEqual(r(80, 80, 640, 368));
  });

  it("clamps the default size to the tile area", () => {
    expect(nextSlot(0, r(8, 8, 500, 300), WS.defaultSize)).toEqual(r(8, 8, 500, 300));
  });
});

describe("clampRect (DES-002 2.10.1)", () => {
  const workspace = { width: 1316, height: 700 };

  it("keeps 80 px of the title bar inside at the left edge: x = 80 - w", () => {
    expect(clampRect(r(-600, 10, 640, 368), workspace).x).toBe(-560);
  });

  it("keeps 80 px inside at the right edge: x = W - 80", () => {
    expect(clampRect(r(2000, 10, 640, 368), workspace).x).toBe(1236);
  });

  it("keeps the title bar inside vertically: y in [0, H - 30]", () => {
    expect(clampRect(r(10, -40, 640, 368), workspace).y).toBe(0);
    expect(clampRect(r(10, 900, 640, 368), workspace).y).toBe(670);
  });

  it("returns the same object when nothing changes", () => {
    const rect = r(10, 10, 640, 368);
    expect(clampRect(rect, workspace)).toBe(rect);
  });

  it("does not change the size", () => {
    const out = clampRect(r(-9000, 9000, 640, 368), workspace);
    expect(out.width).toBe(640);
    expect(out.height).toBe(368);
  });
});

describe("clampMin", () => {
  it("raises width and height to the minimum", () => {
    expect(clampMin(r(5, 6, 100, 50), WS.min)).toEqual(r(5, 6, 320, 180));
  });
  it("returns the same object when it is large enough", () => {
    const rect = r(0, 0, 400, 300);
    expect(clampMin(rect, WS.min)).toBe(rect);
  });
});

function monitor(id: string, x: number, primary = false): MonitorInfo {
  return {
    id,
    label: `Display ${id}`,
    name: id,
    primary,
    workArea: { x, y: 0, width: 1920, height: 1032 },
    scaleFactor: 1,
  };
}

describe("groupByMonitor", () => {
  const monitors = [monitor("1", 0, true), monitor("2", 1920)];

  it("groups by the monitor that contains the window center, keeping input order", () => {
    const groups = groupByMonitor(
      [
        { id: 1, rect: r(100, 100, 400, 300) },
        { id: 2, rect: r(2000, 100, 400, 300) },
        { id: 3, rect: r(300, 300, 400, 300) },
      ],
      monitors,
    );
    expect(groups.map((g) => [g.monitor.id, g.windows.map((w) => w.id)])).toEqual([
      ["1", [1, 3]],
      ["2", [2]],
    ]);
  });

  it("a window straddling two monitors goes to the one holding its center", () => {
    const groups = groupByMonitor([{ id: 1, rect: r(1700, 0, 400, 300) }], monitors);
    // center x = 1900 -> monitor 1
    expect(groups.map((g) => g.monitor.id)).toEqual(["1"]);
  });

  it("a center outside every work area goes to the nearest monitor", () => {
    const groups = groupByMonitor([{ id: 1, rect: r(0, 1100, 100, 100) }], monitors);
    expect(groups[0]?.monitor.id).toBe("1");
  });

  it("leaves out monitors without windows", () => {
    expect(groupByMonitor([], monitors)).toEqual([]);
  });
});

describe("arrangeNative", () => {
  const monitors = [monitor("1", 0, true), monitor("2", 1920)];
  const windows = [
    { id: 1, rect: r(100, 100, 400, 300) },
    { id: 2, rect: r(2000, 100, 400, 300) },
    { id: 3, rect: r(200, 200, 400, 300) },
    { id: 4, rect: r(2100, 200, 400, 300) },
  ];

  it("each monitor in place: a pair per monitor, each tiled in its own work area", () => {
    const result = arrangeNative("tile", windows, monitors, null);
    expect(result.arranged).toBe(4);
    expect(result.overflow).toBe(0);
    const byId = Object.fromEntries(result.placements.map((p) => [p.id, p]));
    expect(byId[1]).toMatchObject({ rect: r(0, 0, 960, 1032), monitorId: "1" });
    expect(byId[3]).toMatchObject({ rect: r(960, 0, 960, 1032), monitorId: "1" });
    expect(byId[2]).toMatchObject({ rect: r(1920, 0, 960, 1032), monitorId: "2" });
    expect(byId[4]).toMatchObject({ rect: r(2880, 0, 960, 1032), monitorId: "2" });
  });

  it("one chosen display: all windows move there and tile 2 x 2", () => {
    const second = monitors[1] as MonitorInfo;
    const result = arrangeNative("tile", windows, monitors, second);
    expect(result.placements.every((p) => p.monitorId === "2")).toBe(true);
    expect(result.placements.map((p) => p.rect)).toEqual([
      r(1920, 0, 960, 516),
      r(2880, 0, 960, 516),
      r(1920, 516, 960, 516),
      r(2880, 516, 960, 516),
    ]);
  });

  it("a single window is one cell: Tile fills the work area", () => {
    const result = arrangeNative("tile", [windows[0] as (typeof windows)[number]], monitors, null);
    expect(result.placements).toEqual([{ id: 1, rect: r(0, 0, 1920, 1032), monitorId: "1" }]);
  });

  it("reports overflow for 13 windows", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: i + 1, rect: r(10, 10, 400, 300) }));
    const result = arrangeNative("tile", many, [monitor("1", 0, true)], null);
    expect(result.arranged).toBe(12);
    expect(result.overflow).toBe(1);
  });

  it("cascade arranges every window", () => {
    const result = arrangeNative("cascade", windows, monitors, monitors[0] as MonitorInfo);
    expect(result.arranged).toBe(4);
    expect(result.overflow).toBe(0);
    expect(result.placements[0]?.rect).toEqual(r(0, 0, 900, 640));
    expect(result.placements[1]?.rect).toEqual(r(24, 24, 900, 640));
  });

  it("side by side and stacked use the native minimum size", () => {
    const sbs = arrangeNative(
      "sideBySide",
      windows.slice(0, 3),
      monitors,
      monitors[0] as MonitorInfo,
    );
    expect(sbs.placements.map((p) => p.rect.width)).toEqual([640, 640, 640]);
    const stacked = arrangeNative(
      "stacked",
      windows.slice(0, 3),
      monitors,
      monitors[0] as MonitorInfo,
    );
    expect(stacked.placements.map((p) => p.rect.height)).toEqual([344, 344, 344]);
  });

  it("no windows: nothing to do", () => {
    expect(arrangeNative("tile", [], monitors, monitors[0] as MonitorInfo)).toEqual({
      placements: [],
      arranged: 0,
      overflow: 0,
    });
  });
});
