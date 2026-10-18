import type { Rect } from "@/shared/lib/layout-math";
import {
  announce,
  buildDragContext,
  computeListPlacement,
  computeMove,
  computeResize,
  type DragContext,
  keyboardMove,
  keyboardSize,
  zonesArmedAfter,
} from "./drag.logic";

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const AREA = R(8, 8, 1316, 700);
const SIZE = { width: 1332, height: 716 };
const NO_MODS = { alt: false, ctrl: false };

function ctx(
  others: Array<{ id: number; rect: Rect; z: number }> = [],
  tileMode = false,
  slots = { ids: [] as number[], rects: [] as Rect[], cols: 0 },
): DragContext {
  return buildDragContext({ area: AREA, size: SIZE, tileMode, others, slots });
}

const start = R(100, 100, 640, 368);
const move = (
  c: DragContext,
  pointer: { x: number; y: number },
  extra: { modifiers?: typeof NO_MODS; snapEnabled?: boolean } = {},
) =>
  computeMove({
    ctx: c,
    startRect: start,
    pointerStart: { x: 200, y: 110 },
    pointer,
    modifiers: extra.modifiers ?? NO_MODS,
    snapEnabled: extra.snapEnabled ?? true,
    selfId: 1,
  });

describe("buildDragContext", () => {
  it("makes the title bars 30 px high and keeps the other windows' z", () => {
    const c = ctx([{ id: 2, rect: R(700, 50, 300, 200), z: 4 }]);
    expect(c.titleBars).toEqual([{ id: 2, rect: R(700, 50, 300, 30), z: 4 }]);
    expect(c.min).toEqual({ width: 320, height: 180 });
  });
});

describe("move (DES-002 2.10.1)", () => {
  it("follows the pointer without snapping when nothing is near", () => {
    const frame = move(ctx(), { x: 300, y: 310 });
    expect(frame.rect).toEqual(R(200, 300, 640, 368));
    expect(frame.guides).toEqual([]);
    expect(frame.zone).toBeNull();
  });

  it("keeps 80 x 30 px of the title bar inside the workspace", () => {
    expect(move(ctx(), { x: -5000, y: -5000 }).rect).toMatchObject({ x: -560, y: 0 });
    expect(move(ctx(), { x: 9000, y: 9000 }).rect).toMatchObject({ x: 1252, y: 686 });
  });

  it("snaps to a neighbor's edge plus the 8 px gap within 7 px, with one guide", () => {
    // The other window ends at x = 600; its right edge + 8 = 608.
    const c = ctx([{ id: 2, rect: R(100, 500, 500, 100), z: 1 }]);
    // Start x 100 + delta -85 = 15... use delta that puts the left edge at 615 (7 px from 608).
    const frame = move(c, { x: 200 + 515, y: 110 });
    expect(frame.rect.x).toBe(608);
    expect(frame.guides).toEqual([{ axis: "x", at: 608 }]);
  });

  it("does not snap at 9 px", () => {
    const c = ctx([{ id: 2, rect: R(100, 500, 500, 100), z: 1 }]);
    const frame = move(c, { x: 200 + 517, y: 110 });
    expect(frame.rect.x).toBe(617);
    expect(frame.guides).toEqual([]);
  });

  it("Alt turns edge snapping off", () => {
    const c = ctx([{ id: 2, rect: R(100, 500, 500, 100), z: 1 }]);
    const frame = move(c, { x: 200 + 515, y: 110 }, { modifiers: { alt: true, ctrl: false } });
    expect(frame.rect.x).toBe(615);
    expect(frame.guides).toEqual([]);
  });

  it("the snap switch turns snapping and zones off", () => {
    const frame = move(ctx(), { x: 10, y: 300 }, { snapEnabled: false });
    expect(frame.zone).toBeNull();
    expect(frame.zoneRect).toBeNull();
  });

  it("a pointer near the left edge shows the left half zone (and no edge snap)", () => {
    const frame = move(ctx(), { x: 12, y: 300 });
    expect(frame.zone).toBe("left");
    expect(frame.zoneRect).toEqual(R(8, 8, 654, 700));
    expect(frame.guides).toEqual([]);
  });

  it("zones: right half, top edge is the full area, corner is a quarter, bottom edge none", () => {
    expect(move(ctx(), { x: 1320, y: 300 }).zoneRect).toEqual(R(670, 8, 654, 700));
    expect(move(ctx(), { x: 600, y: 10 }).zoneRect).toEqual(AREA);
    expect(move(ctx(), { x: 10, y: 10 }).zone).toBe("topLeft");
    expect(move(ctx(), { x: 10, y: 10 }).zoneRect).toEqual(R(8, 8, 654, 346));
    expect(move(ctx(), { x: 600, y: 705 }).zone).toBeNull();
  });

  it("Ctrl over another title bar picks it as the swap target and nothing snaps", () => {
    const c = ctx([{ id: 2, rect: R(700, 50, 300, 200), z: 4 }]);
    const frame = move(c, { x: 750, y: 60 }, { modifiers: { alt: false, ctrl: true } });
    expect(frame.swapTargetId).toBe(2);
    expect(frame.zone).toBeNull();
    const away = move(c, { x: 750, y: 150 }, { modifiers: { alt: false, ctrl: true } });
    expect(away.swapTargetId).toBeNull();
  });

  it("tile mode: the pointer picks the slot and no zone or snap applies", () => {
    const slots = {
      ids: [1, 2],
      rects: [R(8, 8, 654, 700), R(670, 8, 654, 700)],
      cols: 2,
    };
    const c = ctx([], true, slots);
    const frame = move(c, { x: 900, y: 300 });
    expect(frame.slotIndex).toBe(1);
    expect(frame.slotRect).toEqual(R(670, 8, 654, 700));
    expect(frame.zone).toBeNull();
  });

  it("tile mode with Ctrl picks a swap target instead of a slot", () => {
    const slots = { ids: [1, 2], rects: [R(8, 8, 654, 700), R(670, 8, 654, 700)], cols: 2 };
    const c = ctx([{ id: 2, rect: R(670, 8, 654, 700), z: 2 }], true, slots);
    const frame = move(c, { x: 800, y: 20 }, { modifiers: { alt: false, ctrl: true } });
    expect(frame.swapTargetId).toBe(2);
    expect(frame.slotIndex).toBeNull();
  });
});

describe("resize (DES-002 2.10.2)", () => {
  const edges = (e: Partial<Record<"left" | "right" | "top" | "bottom", boolean>>) => ({
    left: false,
    right: false,
    top: false,
    bottom: false,
    ...e,
  });
  const resize = (
    e: ReturnType<typeof edges>,
    pointer: { x: number; y: number },
    c = ctx(),
    mods = NO_MODS,
  ) =>
    computeResize({
      ctx: c,
      startRect: start,
      pointerStart: { x: 0, y: 0 },
      pointer,
      edges: e,
      modifiers: mods,
      snapEnabled: true,
    });

  it("moves only the flagged edges and keeps the opposite edge fixed", () => {
    expect(resize(edges({ right: true, bottom: true }), { x: 50, y: 30 }).rect).toEqual(
      R(100, 100, 690, 398),
    );
    expect(resize(edges({ left: true, top: true }), { x: -40, y: -20 }).rect).toEqual(
      R(60, 80, 680, 388),
    );
  });

  it("never goes below 320 x 180 and the opposite edge stays fixed", () => {
    const r = resize(edges({ left: true, top: true }), { x: 900, y: 900 }).rect;
    expect(r.width).toBe(320);
    expect(r.height).toBe(180);
    expect(r.x + r.width).toBe(740);
    expect(r.y + r.height).toBe(468);
  });

  it("the top edge cannot leave the workspace", () => {
    // Alt: no snapping to the tile area edge at 8 px.
    expect(
      resize(edges({ top: true }), { x: 0, y: -500 }, ctx(), { alt: true, ctrl: false }).rect.y,
    ).toBe(0);
  });

  it("snaps the moving edge to a neighbor and shows a guide; Alt does not", () => {
    const c = ctx([{ id: 2, rect: R(900, 100, 300, 300), z: 1 }]);
    // The right edge is at 740 + 150 = 890; the neighbor's left edge - 8 is 892: 2 px away.
    const snapped = resize(edges({ right: true }), { x: 150, y: 0 }, c);
    expect(snapped.rect.x + snapped.rect.width).toBe(892);
    expect(snapped.guides).toEqual([{ axis: "x", at: 892 }]);
    const free = resize(edges({ right: true }), { x: 150, y: 0 }, c, { alt: true, ctrl: false });
    expect(free.rect.x + free.rect.width).toBe(890);
  });
});

describe("keyboard (DES-002 2.10.8)", () => {
  const rect = R(100, 100, 640, 368);

  it("Alt+Arrow moves 16 px, with Shift 1 px", () => {
    const c = ctx();
    expect(
      keyboardMove({ ctx: c, rect, dir: "right", fine: false, snapEnabled: false }).rect,
    ).toEqual(R(116, 100, 640, 368));
    expect(keyboardMove({ ctx: c, rect, dir: "up", fine: true, snapEnabled: false }).rect).toEqual(
      R(100, 99, 640, 368),
    );
  });

  it("moves are constrained and snap only while the switch is on", () => {
    const c = ctx([{ id: 2, rect: R(100, 600, 300, 100), z: 1 }]);
    // The bottom edge is 577; down 16 gives 593, one px from the other's top - 8 = 592.
    const near = keyboardMove({
      ctx: c,
      rect: R(100, 200, 640, 377),
      dir: "down",
      fine: false,
      snapEnabled: true,
    });
    expect(near.rect.y + near.rect.height).toBe(592);
    const off = keyboardMove({
      ctx: c,
      rect: R(100, 200, 640, 377),
      dir: "down",
      fine: false,
      snapEnabled: false,
    });
    expect(off.rect.y + off.rect.height).toBe(593);
    expect(
      keyboardMove({
        ctx: c,
        rect: R(-560, 0, 640, 368),
        dir: "left",
        fine: false,
        snapEnabled: false,
      }).rect.x,
    ).toBe(-560);
  });

  it("Ctrl+Alt+Arrow: Right and Down grow, Left and Up shrink the right and bottom edges", () => {
    const c = ctx();
    expect(keyboardSize({ ctx: c, rect, dir: "down", fine: false }).rect.height).toBe(384);
    expect(keyboardSize({ ctx: c, rect, dir: "right", fine: false }).rect.width).toBe(656);
    expect(keyboardSize({ ctx: c, rect, dir: "left", fine: true }).rect.width).toBe(639);
    expect(keyboardSize({ ctx: c, rect, dir: "up", fine: false }).rect.height).toBe(352);
    expect(keyboardSize({ ctx: c, rect, dir: "up", fine: false }).rect.y).toBe(100);
  });

  it("never shrinks below 320 x 180", () => {
    const c = ctx();
    const small = R(100, 100, 325, 185);
    expect(keyboardSize({ ctx: c, rect: small, dir: "left", fine: false }).rect.width).toBe(320);
    expect(keyboardSize({ ctx: c, rect: small, dir: "up", fine: false }).rect.height).toBe(180);
  });
});

describe("announcements (DES-002 2.10.8)", () => {
  it("has the exact texts", () => {
    expect(announce.moved("Pump 2")).toBe("Pump 2 moved.");
    expect(announce.resized("Pump 2", R(0, 0, 640, 368))).toBe("Pump 2 resized to 640 by 368.");
    expect(announce.zone("Pump 2", "left half")).toBe("Pump 2 moved to the left half.");
    expect(announce.swapped("A", "B")).toBe("A swapped with B.");
    expect(announce.slot("A", 3, 4)).toBe("A moved to slot 3 of 4.");
    expect(announce.listPosition("A", 3, 4)).toBe("A moved to position 3 of 4.");
    expect(announce.shown("Pump 2")).toBe("Pump 2 shown in the workspace.");
    expect(announce.cancelled).toBe("Move cancelled.");
  });
});

describe("zones arm after the pointer left the band (Q-FE2-04)", () => {
  it("a pointer in the band does not arm; one outside does, and stays armed", () => {
    expect(zonesArmedAfter(false, { x: 100, y: 20 }, AREA)).toBe(false);
    expect(zonesArmedAfter(false, { x: 12, y: 300 }, AREA)).toBe(false);
    expect(zonesArmedAfter(false, { x: 300, y: 300 }, AREA)).toBe(true);
    expect(zonesArmedAfter(true, { x: 12, y: 300 }, AREA)).toBe(true);
  });

  it("the band is 24 px: 32 is inside the top band, 33 is outside", () => {
    expect(zonesArmedAfter(false, { x: 300, y: 32 }, AREA)).toBe(false);
    expect(zonesArmedAfter(false, { x: 300, y: 33 }, AREA)).toBe(true);
  });

  it("computeMove shows no zone while the zones are not armed, and the same position shows it when armed", () => {
    const frame = (zonesArmed: boolean) =>
      computeMove({
        ctx: ctx(),
        startRect: start,
        pointerStart: { x: 200, y: 110 },
        pointer: { x: 12, y: 300 },
        modifiers: NO_MODS,
        snapEnabled: true,
        selfId: 1,
        zonesArmed,
      });
    expect(frame(false).zone).toBeNull();
    expect(frame(false).zoneRect).toBeNull();
    expect(frame(true).zone).toBe("left");
  });

  it("an unarmed move falls through to edge snapping", () => {
    const c = ctx([{ id: 2, rect: R(100, 500, 500, 100), z: 1 }]);
    const out = computeMove({
      ctx: c,
      startRect: start,
      pointerStart: { x: 200, y: 110 },
      pointer: { x: 200 + 515, y: 20 },
      modifiers: NO_MODS,
      snapEnabled: true,
      selfId: 1,
      zonesArmed: false,
    });
    expect(out.zone).toBeNull();
    expect(out.guides.some((g) => g.axis === "x" && g.at === 608)).toBe(true);
  });
});

describe("computeListPlacement (DES-002 2.10.7)", () => {
  const place = (
    c: DragContext,
    pointer: { x: number; y: number },
    extra: { alt?: boolean; snap?: boolean; tiled?: boolean } = {},
  ) =>
    computeListPlacement({
      ctx: c,
      pointer,
      modifiers: { alt: extra.alt ?? false, ctrl: false },
      snapEnabled: extra.snap ?? true,
      tiled: extra.tiled ?? false,
    });

  it("free layout: the default size with the title bar centered under the pointer", () => {
    expect(place(ctx(), { x: 600, y: 300 })).toEqual({
      kind: "rect",
      rect: R(280, 285, 640, 368),
    });
  });

  it("is clamped so 80 x 30 px of the title bar stay inside", () => {
    const out = place(ctx(), { x: 600, y: 740 });
    expect(out).toMatchObject({ kind: "rect", rect: { y: 686 } });
  });

  it("a snap zone replaces the rectangle: the right edge is the right half", () => {
    expect(place(ctx(), { x: 1320, y: 300 })).toEqual({
      kind: "zone",
      zone: "right",
      rect: R(670, 8, 654, 700),
    });
  });

  it("Alt and the Snap switch turn the zones off", () => {
    expect(place(ctx(), { x: 1320, y: 300 }, { alt: true }).kind).toBe("rect");
    expect(place(ctx(), { x: 1320, y: 300 }, { snap: false }).kind).toBe("rect");
  });

  it("tile mode: the slot of the grid the poll joins (one window more than are tiled)", () => {
    const slots = { ids: [1, 2, 3], rects: [] as Rect[], cols: 2 };
    const c = ctx([], true, slots);
    // Four windows will be tiled: a 2 x 2 grid. The pointer is in the lower left cell.
    expect(place(c, { x: 100, y: 600 })).toEqual({
      kind: "slot",
      index: 2,
      rect: R(8, 362, 654, 346),
    });
    // A poll that is tiled already stays in a grid of three.
    expect(place(c, { x: 100, y: 600 }, { tiled: true })).toEqual({
      kind: "slot",
      index: 2,
      rect: R(8, 362, 1316, 346),
    });
  });

  it("tile mode with nobody tiled: the first slot is the whole area", () => {
    const c = ctx([], true, { ids: [], rects: [], cols: 0 });
    expect(place(c, { x: 100, y: 100 })).toEqual({ kind: "slot", index: 0, rect: AREA });
  });
});
