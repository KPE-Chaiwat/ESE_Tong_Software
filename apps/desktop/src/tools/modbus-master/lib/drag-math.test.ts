import type { Rect } from "@/shared/lib/layout-math";
import {
  AUTO_SCROLL_BAND_PX,
  AUTO_SCROLL_STEP_PX,
  adjacentSlot,
  autoScrollDelta,
  buildSnapCandidates,
  DRAG_THRESHOLD_PX,
  exceedsDragThreshold,
  gapToIndex,
  insertAmongSubset,
  insertAt,
  listInsertIndex,
  MOVE_EDGES,
  moveRect,
  neighborInDirection,
  placeInSubset,
  popOutModeFor,
  reorder,
  resizeRect,
  restoreFromMaximizedForDrag,
  snapRect,
  snapZoneAt,
  swapInOrder,
  swapTargetAt,
  tileSlotAt,
  ZONE_LABELS,
  zoneRect,
} from "./drag-math";

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const AREA = r(8, 8, 1316, 700);
const MIN = { width: 320, height: 180 };

describe("drag threshold", () => {
  it("3 px is a click, 4 px is a drag", () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });
});

describe("moveRect", () => {
  it("moves by the pointer delta and keeps the size", () => {
    expect(moveRect(r(10, 20, 640, 368), { x: -5, y: 7 })).toEqual(r(5, 27, 640, 368));
  });
});

describe("resizeRect: the opposite edge stays fixed", () => {
  const start = r(100, 100, 600, 400);
  const edges = (e: Partial<Record<"left" | "right" | "top" | "bottom", boolean>>) => ({
    left: false,
    right: false,
    top: false,
    bottom: false,
    ...e,
  });

  it("right edge grows to the right", () => {
    expect(resizeRect(start, edges({ right: true }), { x: 50, y: 99 }, MIN)).toEqual(
      r(100, 100, 650, 400),
    );
  });

  it("left edge moves, the right edge stays at 700", () => {
    const out = resizeRect(start, edges({ left: true }), { x: -40, y: 0 }, MIN);
    expect(out).toEqual(r(60, 100, 640, 400));
    expect(out.x + out.width).toBe(700);
  });

  it("top and bottom", () => {
    expect(resizeRect(start, edges({ top: true }), { x: 0, y: 30 }, MIN)).toEqual(
      r(100, 130, 600, 370),
    );
    expect(resizeRect(start, edges({ bottom: true }), { x: 0, y: 30 }, MIN)).toEqual(
      r(100, 100, 600, 430),
    );
  });

  it("a corner moves two edges", () => {
    expect(resizeRect(start, edges({ left: true, top: true }), { x: -10, y: -10 }, MIN)).toEqual(
      r(90, 90, 610, 410),
    );
  });

  it("below the minimum clamps to 320 x 180 with the opposite edge fixed", () => {
    const right = resizeRect(
      start,
      edges({ right: true, bottom: true }),
      { x: -9000, y: -9000 },
      MIN,
    );
    expect(right).toEqual(r(100, 100, 320, 180));
    const left = resizeRect(start, edges({ left: true, top: true }), { x: 9000, y: 9000 }, MIN);
    expect(left).toEqual(r(380, 320, 320, 180));
    expect(left.x + left.width).toBe(700);
    expect(left.y + left.height).toBe(500);
  });

  it("the top edge cannot go above the workspace top when a limit is given", () => {
    const out = resizeRect(start, edges({ top: true }), { x: 0, y: -500 }, MIN, { minTop: 0 });
    expect(out.y).toBe(0);
    expect(out.y + out.height).toBe(500);
  });
});

describe("snapRect (DES-002 2.10.3)", () => {
  const other = r(100, 100, 400, 300); // right edge 500, bottom 400
  const candidates = buildSnapCandidates(AREA, [{ rect: other, z: 2 }]);

  it("a left edge 7 px from another window's right edge + 8 snaps, with one vertical guide", () => {
    const moving = r(515, 600, 300, 200); // left edge 515 = 500 + 8 + 7
    const out = snapRect(moving, MOVE_EDGES, candidates);
    expect(out.rect.x).toBe(508);
    expect(out.guides.filter((g) => g.axis === "x")).toEqual([{ axis: "x", at: 508 }]);
    expect(out.rect.y).toBe(600);
  });

  it("at 9 px it does not snap", () => {
    const moving = r(517, 600, 300, 200);
    const out = snapRect(moving, MOVE_EDGES, candidates);
    expect(out.rect).toEqual(moving);
    expect(out.guides).toEqual([]);
  });

  it("a right edge snaps to another window's left edge minus the gap", () => {
    // moving right edge at 95: 3 px from the line 92 (left edge - 8), 5 px from 100
    const moving = r(-205, 600, 300, 200);
    const out = snapRect(moving, MOVE_EDGES, candidates);
    expect(out.rect.x + out.rect.width).toBe(92);
  });

  it("snaps to the tile-area edges", () => {
    const out = snapRect(r(12, 14, 300, 200), MOVE_EDGES, candidates);
    expect(out.rect.x).toBe(8);
    expect(out.rect.y).toBe(8);
    expect(out.guides).toEqual([
      { axis: "x", at: 8 },
      { axis: "y", at: 8 },
    ]);
  });

  it("returns at most one vertical and one horizontal guide", () => {
    const out = snapRect(r(12, 14, 300, 200), MOVE_EDGES, candidates);
    expect(out.guides.filter((g) => g.axis === "x")).toHaveLength(1);
    expect(out.guides.filter((g) => g.axis === "y")).toHaveLength(1);
  });

  it("the nearest candidate wins", () => {
    // left edge 509: candidates 508 (distance 1) and 500 (distance 9, outside anyway)
    const out = snapRect(r(509, 600, 300, 200), MOVE_EDGES, candidates);
    expect(out.rect.x).toBe(508);
  });

  it("ties go to the workspace edge before a window edge", () => {
    // A window whose left edge is at 8 + 4 = 12; the moving left edge at 10 is 2 px from the
    // workspace line (8) and 2 px from the window line (12).
    const cands = buildSnapCandidates(AREA, [{ rect: r(12, 300, 100, 100), z: 5 }]);
    const out = snapRect(
      r(10, 600, 300, 200),
      { left: true, right: false, top: false, bottom: false },
      cands,
    );
    expect(out.guides[0]).toEqual({ axis: "x", at: 8 });
  });

  it("ties between windows go to the higher z", () => {
    const cands = buildSnapCandidates(AREA, [
      { rect: r(200, 300, 100, 100), z: 1 },
      { rect: r(204, 300, 100, 100), z: 9 },
    ]);
    // left edge at 202 is 2 px from 200 (z 1) and 2 px from 204 (z 9)
    const out = snapRect(
      r(202, 600, 300, 200),
      { left: true, right: false, top: false, bottom: false },
      cands,
    );
    expect(out.guides[0]).toEqual({ axis: "x", at: 204 });
  });

  it("a resize snaps only the moving edge", () => {
    const out = snapRect(
      r(100, 600, 398, 200), // right edge at 498 -> 2 px from the other's right edge 500
      { left: false, right: true, top: false, bottom: false },
      candidates,
      8,
      MIN,
    );
    expect(out.rect).toEqual(r(100, 600, 400, 200));
  });

  it("a resize snap keeps the minimum size", () => {
    const out = snapRect(
      r(100, 600, 322, 200),
      { left: false, right: true, top: false, bottom: false },
      buildSnapCandidates(AREA, [{ rect: r(0, 0, 410, 10), z: 1 }]),
      8,
      MIN,
    );
    expect(out.rect.width).toBeGreaterThanOrEqual(320);
  });
});

describe("snap zones", () => {
  it("pointer near the left edge is the left half, top-left corner is the top-left quarter", () => {
    expect(snapZoneAt({ x: AREA.x + 10, y: AREA.y + 300 }, AREA)).toBe("left");
    expect(snapZoneAt({ x: AREA.x + 10, y: AREA.y + 10 }, AREA)).toBe("topLeft");
  });

  it("right edge, top edge, other corners", () => {
    expect(snapZoneAt({ x: AREA.x + AREA.width - 5, y: AREA.y + 300 }, AREA)).toBe("right");
    expect(snapZoneAt({ x: AREA.x + 600, y: AREA.y + 5 }, AREA)).toBe("full");
    expect(snapZoneAt({ x: AREA.x + AREA.width - 5, y: AREA.y + 5 }, AREA)).toBe("topRight");
    expect(snapZoneAt({ x: AREA.x + 5, y: AREA.y + AREA.height - 5 }, AREA)).toBe("bottomLeft");
    expect(snapZoneAt({ x: AREA.x + AREA.width - 5, y: AREA.y + AREA.height - 5 }, AREA)).toBe(
      "bottomRight",
    );
  });

  it("the bottom edge alone (not a corner) is no zone, and the middle is none", () => {
    expect(snapZoneAt({ x: AREA.x + 600, y: AREA.y + AREA.height - 5 }, AREA)).toBeNull();
    expect(snapZoneAt({ x: AREA.x + 600, y: AREA.y + 300 }, AREA)).toBeNull();
  });

  it("the margin is 24 px", () => {
    expect(snapZoneAt({ x: AREA.x + 24, y: AREA.y + 300 }, AREA)).toBe("left");
    expect(snapZoneAt({ x: AREA.x + 25, y: AREA.y + 300 }, AREA)).toBeNull();
  });

  it("a pointer far outside the area is no zone", () => {
    expect(snapZoneAt({ x: AREA.x - 100, y: AREA.y + 300 }, AREA)).toBeNull();
  });

  it("zoneRect: right half of (8, 8, 1316, 700) is (670, 8, 654, 700)", () => {
    expect(zoneRect("right", AREA)).toEqual(r(670, 8, 654, 700));
    expect(zoneRect("left", AREA)).toEqual(r(8, 8, 654, 700));
    expect(zoneRect("full", AREA)).toEqual(AREA);
  });

  it("zoneRect: quarters leave the 8 px gap", () => {
    expect(zoneRect("topLeft", AREA)).toEqual(r(8, 8, 654, 346));
    expect(zoneRect("topRight", AREA)).toEqual(r(670, 8, 654, 346));
    expect(zoneRect("bottomLeft", AREA)).toEqual(r(8, 362, 654, 346));
    expect(zoneRect("bottomRight", AREA)).toEqual(r(670, 362, 654, 346));
  });

  it("has the announcement text of every zone", () => {
    expect(ZONE_LABELS.left).toBe("left half");
    expect(ZONE_LABELS.bottomRight).toBe("bottom-right quarter");
    expect(ZONE_LABELS.full).toBe("full workspace");
  });
});

describe("swapTargetAt", () => {
  const bars = [
    { id: "a", rect: r(0, 0, 200, 30), z: 1 },
    { id: "b", rect: r(100, 0, 200, 30), z: 3 },
    { id: "self", rect: r(0, 0, 100, 30), z: 9 },
  ];

  it("picks the title bar under the pointer, excluding itself", () => {
    expect(swapTargetAt({ x: 50, y: 10 }, bars, "self")).toBe("a");
  });
  it("the highest z wins where bars overlap", () => {
    expect(swapTargetAt({ x: 150, y: 10 }, bars, "self")).toBe("b");
  });
  it("is null away from every bar", () => {
    expect(swapTargetAt({ x: 150, y: 100 }, bars, "self")).toBeNull();
  });
});

describe("tile slots and order helpers", () => {
  const slots = [
    r(0, 0, 100, 100),
    r(100, 0, 100, 100),
    r(0, 100, 100, 100),
    r(100, 100, 100, 100),
  ];

  it("tileSlotAt: the slot under the pointer, else the nearest", () => {
    expect(tileSlotAt({ x: 150, y: 150 }, slots)).toBe(3);
    expect(tileSlotAt({ x: 500, y: 20 }, slots)).toBe(1);
    expect(tileSlotAt({ x: 10, y: 10 }, [])).toBe(-1);
  });

  it("insertAt moves an id to the index", () => {
    expect(insertAt(["A", "B", "C", "D"], "A", 2)).toEqual(["B", "C", "A", "D"]);
    expect(insertAt(["A", "B", "C", "D"], "D", 0)).toEqual(["D", "A", "B", "C"]);
    expect(insertAt(["A", "B"], "A", 99)).toEqual(["B", "A"]);
    expect(insertAt(["A", "B"], "Z", 1)).toEqual(["A", "Z", "B"]);
  });

  it("insertAmongSubset: tiles [A, B, C, D], A to slot 3 gives [B, C, A, D]", () => {
    expect(insertAmongSubset(["A", "B", "C", "D"], ["A", "B", "C", "D"], "A", 2)).toEqual([
      "B",
      "C",
      "A",
      "D",
    ]);
  });

  it("insertAmongSubset keeps untiled windows where they are", () => {
    // X and Y are not tiled (for example minimized): they keep positions 1 and 3.
    expect(insertAmongSubset(["A", "X", "B", "Y", "C"], ["A", "B", "C"], "A", 2)).toEqual([
      "B",
      "X",
      "C",
      "Y",
      "A",
    ]);
  });

  it("swapInOrder exchanges two places", () => {
    expect(swapInOrder(["A", "B", "C", "D"], "A", "D")).toEqual(["D", "B", "C", "A"]);
    expect(swapInOrder(["A", "B"], "A", "A")).toEqual(["A", "B"]);
    expect(swapInOrder(["A", "B"], "A", "Z")).toEqual(["A", "B"]);
  });
});

describe("list reorder", () => {
  const rows = [r(0, 0, 200, 48), r(0, 48, 200, 48), r(0, 96, 200, 48), r(0, 144, 200, 48)];

  it("listInsertIndex: the gap nearest to the pointer y", () => {
    expect(listInsertIndex(-5, rows)).toBe(0);
    expect(listInsertIndex(20, rows)).toBe(0);
    expect(listInsertIndex(30, rows)).toBe(1);
    expect(listInsertIndex(144, rows)).toBe(3);
    expect(listInsertIndex(180, rows)).toBe(4);
    expect(listInsertIndex(900, rows)).toBe(4);
    expect(listInsertIndex(10, [])).toBe(0);
  });

  it("dragging row 1 below row 3: the gap is 3 and the item ends at index 2", () => {
    const gap = listInsertIndex(140, rows);
    expect(gap).toBe(3);
    expect(gapToIndex(0, gap)).toBe(2);
    expect(reorder(["A", "B", "C", "D"], 0, gapToIndex(0, gap))).toEqual(["B", "C", "A", "D"]);
  });

  it("gapToIndex for an item moving up", () => {
    expect(gapToIndex(3, 1)).toBe(1);
    expect(gapToIndex(2, 2)).toBe(2);
    expect(gapToIndex(2, 3)).toBe(2);
  });

  it("reorder clamps the target and ignores a bad source", () => {
    expect(reorder(["A", "B", "C"], 0, 2)).toEqual(["B", "C", "A"]);
    expect(reorder(["A", "B", "C"], 2, 0)).toEqual(["C", "A", "B"]);
    expect(reorder(["A", "B", "C"], 0, 99)).toEqual(["B", "C", "A"]);
    expect(reorder(["A", "B", "C"], 5, 0)).toEqual(["A", "B", "C"]);
    expect(reorder(["A", "B", "C"], 1, 1)).toEqual(["A", "B", "C"]);
  });

  it("reorder does not change its input", () => {
    const input = ["A", "B", "C"];
    reorder(input, 0, 2);
    expect(input).toEqual(["A", "B", "C"]);
  });
});

describe("neighborInDirection", () => {
  const active = r(400, 300, 200, 100); // center (500, 350)

  it("picks the closer of two windows to the right", () => {
    const others = [
      { id: "far", rect: r(1000, 300, 200, 100) }, // center 1100
      { id: "near", rect: r(700, 310, 200, 100) }, // center 800
    ];
    expect(neighborInDirection(active, others, "right")).toBe("near");
  });

  it("ignores a window that is mostly below", () => {
    const others = [{ id: "below", rect: r(520, 700, 200, 100) }];
    expect(neighborInDirection(active, others, "right")).toBeNull();
    expect(neighborInDirection(active, others, "down")).toBe("below");
  });

  it("works in all four directions and returns null when there is nobody", () => {
    const others = [
      { id: "l", rect: r(0, 300, 200, 100) },
      { id: "u", rect: r(400, 0, 200, 100) },
    ];
    expect(neighborInDirection(active, others, "left")).toBe("l");
    expect(neighborInDirection(active, others, "up")).toBe("u");
    expect(neighborInDirection(active, others, "right")).toBeNull();
    expect(neighborInDirection(active, [], "down")).toBeNull();
  });

  it("a window exactly on the 45 degree line is inside the cone", () => {
    expect(neighborInDirection(active, [{ id: "d", rect: r(600, 450, 200, 100) }], "right")).toBe(
      "d",
    );
  });
});

describe("adjacentSlot (row-major)", () => {
  // 3 columns, 7 slots:  0 1 2 / 3 4 5 / 6
  it("moves within a row and a column", () => {
    expect(adjacentSlot(1, 3, 7, "right")).toBe(2);
    expect(adjacentSlot(1, 3, 7, "left")).toBe(0);
    expect(adjacentSlot(1, 3, 7, "down")).toBe(4);
    expect(adjacentSlot(4, 3, 7, "up")).toBe(1);
  });
  it("is null at the borders and past the last slot", () => {
    expect(adjacentSlot(0, 3, 7, "left")).toBeNull();
    expect(adjacentSlot(2, 3, 7, "right")).toBeNull();
    expect(adjacentSlot(0, 3, 7, "up")).toBeNull();
    expect(adjacentSlot(5, 3, 7, "down")).toBeNull();
    expect(adjacentSlot(6, 3, 7, "right")).toBeNull();
    expect(adjacentSlot(9, 3, 7, "left")).toBeNull();
  });
});

describe("popOutModeFor", () => {
  const client = r(0, 0, 1280, 800);
  const workspace = r(300, 100, 900, 600);

  it("false inside the workspace and 47 px outside it", () => {
    expect(popOutModeFor({ x: 500, y: 300 }, workspace, client)).toBe(false);
    expect(popOutModeFor({ x: 300 - 47, y: 300 }, workspace, client)).toBe(false);
    expect(popOutModeFor({ x: 500, y: 700 + 47 }, workspace, client)).toBe(false);
  });
  it("false at exactly 48 px, true at 49 px", () => {
    expect(popOutModeFor({ x: 300 - 48, y: 300 }, workspace, client)).toBe(false);
    expect(popOutModeFor({ x: 300 - 49, y: 300 }, workspace, client)).toBe(true);
    expect(popOutModeFor({ x: 500, y: 700 + 49 }, workspace, client)).toBe(true);
  });
  it("true outside the client area", () => {
    expect(popOutModeFor({ x: 1300, y: 300 }, workspace, client)).toBe(true);
    expect(popOutModeFor({ x: -1, y: 300 }, workspace, client)).toBe(true);
  });
});

describe("restoreFromMaximizedForDrag", () => {
  it("keeps the pointer at the same relative x of the title bar", () => {
    const maximized = r(8, 8, 1316, 700);
    const normal = r(100, 100, 640, 368);
    // pointer at the middle of the maximized title bar
    const out = restoreFromMaximizedForDrag(normal, { x: 8 + 658, y: 20 }, maximized);
    expect(out).toEqual(r(346, 8, 640, 368));
    // the pointer is still at the middle of the restored title bar
    expect(out.x + out.width / 2).toBe(8 + 658);
  });
  it("at the far left the window starts under the pointer", () => {
    const out = restoreFromMaximizedForDrag(r(0, 0, 640, 368), { x: 8, y: 20 }, r(8, 8, 1316, 700));
    expect(out.x).toBe(8);
  });
  it("at the far right the window ends under the pointer", () => {
    const out = restoreFromMaximizedForDrag(
      r(0, 0, 640, 368),
      { x: 1324, y: 20 },
      r(8, 8, 1316, 700),
    );
    expect(out.x + out.width).toBe(1324);
  });
});

describe("placeInSubset (DES-002 2.10.7, tile mode drop of a poll that is not tiled)", () => {
  // The list is [A, B, C, D]; B and D are minimized (not tiled), so the tiles are [A, C].
  const order = ["A", "B", "C", "D"];
  const tiled = ["A", "C"];

  it("a poll dropped on slot 0 goes right before the window that has that slot", () => {
    expect(placeInSubset(order, tiled, "D", 0)).toEqual(["D", "A", "B", "C"]);
  });

  it("slot 1 goes before the second tile", () => {
    expect(placeInSubset(order, tiled, "D", 1)).toEqual(["A", "B", "D", "C"]);
  });

  it("a slot after the last tile goes right after the last tiled window", () => {
    expect(placeInSubset(["A", "B", "C", "D", "E"], tiled, "E", 2)).toEqual([
      "A",
      "B",
      "C",
      "E",
      "D",
    ]);
  });

  it("clamps an index beyond the slots", () => {
    expect(placeInSubset(order, tiled, "B", 9)).toEqual(["A", "C", "B", "D"]);
  });

  it("with nobody tiled the order stays", () => {
    expect(placeInSubset(order, [], "C", 0)).toEqual(order);
  });

  it("a poll that is tiled already moves among the others", () => {
    expect(placeInSubset(order, tiled, "C", 0)).toEqual(["C", "A", "B", "D"]);
  });

  it("does not change its input", () => {
    const copy = [...order];
    placeInSubset(order, tiled, "D", 0);
    expect(order).toEqual(copy);
  });
});

describe("autoScrollDelta (DES-002 2.10.6)", () => {
  const list = r(0, 100, 260, 400);

  it("scrolls 8 px per frame near the top and the bottom edge, 0 elsewhere", () => {
    expect(AUTO_SCROLL_STEP_PX).toBe(8);
    expect(AUTO_SCROLL_BAND_PX).toBe(24);
    expect(autoScrollDelta({ x: 100, y: 110 }, list)).toBe(-8);
    expect(autoScrollDelta({ x: 100, y: 490 }, list)).toBe(8);
    expect(autoScrollDelta({ x: 100, y: 300 }, list)).toBe(0);
  });

  it("the band is exactly 24 px: 24 scrolls, 25 does not", () => {
    expect(autoScrollDelta({ x: 100, y: 124 }, list)).toBe(-8);
    expect(autoScrollDelta({ x: 100, y: 125 }, list)).toBe(0);
    expect(autoScrollDelta({ x: 100, y: 476 }, list)).toBe(8);
    expect(autoScrollDelta({ x: 100, y: 475 }, list)).toBe(0);
  });

  it("just beyond an edge still scrolls, far beyond does not", () => {
    expect(autoScrollDelta({ x: 100, y: 80 }, list)).toBe(-8);
    expect(autoScrollDelta({ x: 100, y: 520 }, list)).toBe(8);
    expect(autoScrollDelta({ x: 100, y: 60 }, list)).toBe(0);
    expect(autoScrollDelta({ x: 100, y: 600 }, list)).toBe(0);
  });

  it("only over the list's column", () => {
    expect(autoScrollDelta({ x: 400, y: 110 }, list)).toBe(0);
    expect(autoScrollDelta({ x: -5, y: 490 }, list)).toBe(0);
  });
});

describe("snap ties: touching edge before the gap line (DES-002 2.10.3, D-002-10, CHK2-I22)", () => {
  // B: x 300..700. The right edge of a moving window can snap to B.left (the windows touch, 300) or
  // to B.left - 8 (the tile gap, 292).
  const B = r(300, 100, 400, 300);
  const cands = buildSnapCandidates(AREA, [{ rect: B, z: 2 }]);
  const RIGHT_ONLY = { left: false, right: true, top: false, bottom: false };
  const snapRight = (edgeAt: number) =>
    snapRect(r(edgeAt - 200, 600, 200, 100), RIGHT_ONLY, cands).rect;

  it.each([
    // the moving edge position, where it ends up
    [296, 300], // 4 px from both: the touching edge wins the tie
    [297, 300], // nearer to 300
    [295, 292], // nearer to 292
    [292, 292],
    [284, 292], // 8 px from the gap line, the edge of the threshold
    [304, 300], // 4 px from the touching edge and from the gap line inside B (308)
  ])("a right edge at %i ends at %i", (edgeAt, ends) => {
    const out = snapRight(edgeAt);
    expect(out.x + out.width).toBe(ends);
  });

  it("a right edge 9 px from both lines does not snap", () => {
    const out = snapRight(283);
    expect(out.x + out.width).toBe(283);
    expect(snapRight(317).x + 200).toBe(317);
  });

  it("the guide is drawn on the touching edge", () => {
    expect(snapRect(r(96, 600, 200, 100), RIGHT_ONLY, cands).guides).toEqual([
      { axis: "x", at: 300 },
    ]);
  });

  it("the same tie on a move shifts the whole window to touch", () => {
    const out = snapRect(r(96, 600, 200, 100), MOVE_EDGES, cands);
    expect(out.rect.x).toBe(100);
  });

  it("the tile-area edge still wins over both, then the higher window", () => {
    // Lines: area left 8, B.left 12 (touching), B.left - 8 = 4 (gap). A left edge at 8 is on the
    // workspace line.
    const near = buildSnapCandidates(AREA, [{ rect: r(12, 300, 100, 100), z: 5 }]);
    const left = { left: true, right: false, top: false, bottom: false };
    expect(snapRect(r(10, 600, 300, 200), left, near).guides[0]).toEqual({ axis: "x", at: 8 });
    // Between two windows, at the same distance and offset, the higher z wins.
    const two = buildSnapCandidates(AREA, [
      { rect: r(200, 300, 100, 100), z: 1 },
      { rect: r(204, 300, 100, 100), z: 9 },
    ]);
    expect(snapRect(r(202, 600, 300, 200), left, two).guides[0]).toEqual({ axis: "x", at: 204 });
  });
});
