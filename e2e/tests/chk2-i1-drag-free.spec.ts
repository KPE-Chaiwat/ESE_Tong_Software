// CHK-002 section I (part 1): drag in the free layout: move, constraint, Esc, resize, edge snap,
// Alt, snap zones, swap, maximized drag, no Alt leak. Real mouse events on the title bars.
import { expect, LAYOUT_SEED, test, type Mm } from "../support/mm-fixtures";

type Item = { index: number; x: number; y: number; width?: number; height?: number; z?: number };

async function open(mm: Mm, items: Item[], names?: string[]): Promise<number[]> {
  const polls = (names ?? items.map((_, i) => `Poll ${i + 1}`)).map((name) => ({ name }));
  await mm.open({ polls, seed: LAYOUT_SEED, seedArg: { items } });
  await mm.sizeWorkspaceTo(1332, 716);
  return mm.pollIds();
}
const z = (mm: Mm, id: number) => mm.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));

test.describe("I move and resize", () => {
  test("CHK2-I1 move: the press raises at once, 3 px does nothing, 40 px moves the frame live, release keeps it", async ({ mm, page }) => {
    const [a, b] = await open(mm, [
      { index: 0, x: 300, y: 200, width: 500, height: 300, z: 1 },
      { index: 1, x: 400, y: 220, width: 500, height: 300, z: 2 },
    ]);
    const p = await mm.titlePoint(a as number, 20);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    expect(await z(mm, a as number), "raised at the press").toBeGreaterThan(await z(mm, b as number));
    await page.mouse.move(p.x + 3, p.y);
    await mm.expectDomRect(a as number, { x: 300, y: 200 });
    await expect(mm.sub(a as number)).not.toHaveAttribute("data-dragging", "true");
    await page.mouse.move(p.x + 40, p.y, { steps: 5 });
    await expect(mm.sub(a as number)).toHaveAttribute("data-dragging", "true");
    await mm.expectDomRect(a as number, { x: 340, y: 200, width: 500, height: 300 });
    // Nothing is committed while the drag runs.
    expect((await mm.storedRect(a as number))?.x ?? 300).not.toBe(340);
    await page.mouse.up();
    await expect(mm.sub(a as number)).not.toHaveAttribute("data-dragging", "true");
    await mm.expectDomRect(a as number, { x: 340, y: 200 });
    await mm.expectStoredRect(a as number, { x: 340, y: 200 });
    await expect(mm.livePolite).toHaveText("Poll 1 moved.");
  });

  test("CHK2-I2 constraint: 80 x 30 px of the title bar stay inside (left, top, right, bottom)", async ({ mm, page }) => {
    const [a] = await open(mm, [{ index: 0, x: 500, y: 300, width: 320, height: 200 }]);
    const id = a as number;
    // Alt switches snapping and zones off, so the edge of the workspace is only the constraint.
    await page.keyboard.down("Alt");
    const start = await mm.titlePoint(id, 20);
    const ws = await mm.workspace.boundingBox();
    if (!ws) throw new Error("no workspace");
    const cases: Array<{ name: string; to: { x: number; y: number }; want: Partial<{ x: number; y: number }> }> = [
      { name: "left", to: { x: ws.x - 280, y: start.y }, want: { x: 80 - 320 } },
      { name: "top", to: { x: start.x, y: ws.y - 30 }, want: { y: 0 } },
      { name: "right", to: { x: ws.x + ws.width - 4, y: start.y }, want: { x: ws.width - 80 } },
      { name: "bottom", to: { x: start.x, y: ws.y + ws.height - 3 }, want: { y: ws.height - 30 } },
    ];
    for (const c of cases) {
      const from = await mm.titlePoint(id, 20);
      await mm.dragStart(from, c.to, 10);
      await mm.expectDomRect(id, c.want);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(mm.sub(id)).not.toHaveAttribute("data-dragging", "true");
      await mm.expectDomRect(id, { x: 500, y: 300 });
    }
    await page.keyboard.up("Alt");
  });

  test("CHK2-I3 Esc during a move restores the rectangle and announces 'Move cancelled.'; during a resize too", async ({ mm, page }) => {
    const [a] = await open(mm, [{ index: 0, x: 300, y: 200, width: 500, height: 300 }]);
    const id = a as number;
    await mm.dragTitle(id, 120, 60);
    await mm.expectDomRect(id, { x: 420, y: 260 });
    await page.keyboard.press("Escape");
    await mm.expectDomRect(id, { x: 300, y: 200, width: 500, height: 300 });
    await page.mouse.up();
    await mm.expectDomRect(id, { x: 300, y: 200 });
    await expect(mm.livePolite).toHaveText("Move cancelled.");
    expect(await mm.storedRect(id)).toMatchObject({ x: 300, y: 200 });
    // Resize.
    const handle = mm.sub(id).locator('[data-resize-handle="se"]');
    const box = await handle.boundingBox();
    if (!box) throw new Error("no handle");
    await mm.dragStart({ x: box.x + 5, y: box.y + 5 }, { x: box.x + 105, y: box.y + 65 }, 6);
    await mm.expectDomRect(id, { width: 600, height: 360 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await mm.expectDomRect(id, { x: 300, y: 200, width: 500, height: 300 });
  });

  const HANDLES: Array<{ h: string; dx: number; dy: number; want: Partial<{ x: number; y: number; width: number; height: number }> }> = [
    { h: "e", dx: 100, dy: 0, want: { x: 300, y: 200, width: 600, height: 300 } },
    { h: "w", dx: -100, dy: 0, want: { x: 200, y: 200, width: 600, height: 300 } },
    { h: "s", dx: 0, dy: 80, want: { x: 300, y: 200, width: 500, height: 380 } },
    { h: "n", dx: 0, dy: -80, want: { x: 300, y: 120, width: 500, height: 380 } },
    { h: "se", dx: 60, dy: 50, want: { x: 300, y: 200, width: 560, height: 350 } },
    { h: "nw", dx: -60, dy: -50, want: { x: 240, y: 150, width: 560, height: 350 } },
    { h: "ne", dx: 60, dy: -50, want: { x: 300, y: 150, width: 560, height: 350 } },
    { h: "sw", dx: -60, dy: 50, want: { x: 240, y: 200, width: 560, height: 350 } },
  ];
  for (const c of HANDLES) {
    test(`CHK2-I4 resize from the ${c.h} handle: live size, the opposite edge stays, announcement`, async ({ mm, page }) => {
      const [a] = await open(mm, [{ index: 0, x: 300, y: 200, width: 500, height: 300 }]);
      const id = a as number;
      const box = await mm.sub(id).locator(`[data-resize-handle="${c.h}"]`).boundingBox();
      if (!box) throw new Error("no handle");
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await mm.dragStart(from, { x: from.x + c.dx, y: from.y + c.dy }, 6);
      await mm.expectDomRect(id, c.want);
      await page.mouse.up();
      await mm.expectDomRect(id, c.want);
      await mm.expectStoredRect(id, c.want);
      await expect(mm.livePolite).toHaveText(`Poll 1 resized to ${c.want.width} by ${c.want.height}.`);
    });
  }

  test("CHK2-I4 the minimum size is 320 x 180 with the opposite edge fixed", async ({ mm, page }) => {
    const [a] = await open(mm, [{ index: 0, x: 300, y: 200, width: 500, height: 300 }]);
    const id = a as number;
    const box = await mm.sub(id).locator('[data-resize-handle="se"]').boundingBox();
    if (!box) throw new Error("no handle");
    const from = { x: box.x + 5, y: box.y + 5 };
    await mm.dragStart(from, { x: from.x - 400, y: from.y - 250 }, 8);
    await mm.expectDomRect(id, { x: 300, y: 200, width: 320, height: 180 });
    await page.mouse.up();
    await mm.expectStoredRect(id, { x: 300, y: 200, width: 320, height: 180 });
  });

  test("CHK2-I5 edge snap: 7 px from B's right edge + 8 snaps to an 8 px gap with a dashed guide; 10 px does not", async ({ mm, page }) => {
    const [a, b] = await open(mm, [
      { index: 0, x: 800, y: 450, width: 300, height: 200 },
      { index: 1, x: 100, y: 100, width: 400, height: 250 },
    ]);
    // B's right edge is 500; the snap line is 508. A's left edge goes to 515 (7 px away).
    const from = await mm.titlePoint(a as number, 20);
    await mm.dragStart(from, { x: from.x - 285, y: from.y }, 8);
    await mm.expectDomRect(a as number, { x: 508 });
    const guide = mm.workspace.getByTestId("snap-guide");
    await expect(guide).toHaveCount(1);
    await expect(guide).toHaveAttribute("data-axis", "x");
    expect(await guide.evaluate((el) => getComputedStyle(el).borderLeftStyle)).toBe("dashed");
    await page.mouse.up();
    await mm.expectStoredRect(a as number, { x: 508 });
    await expect(guide).toHaveCount(0);
    // 10 px away: no snap and no guide.
    const again = await mm.titlePoint(a as number, 20);
    await mm.dragStart(again, { x: again.x + 10, y: again.y }, 4);
    await mm.expectDomRect(a as number, { x: 518 });
    await expect(guide).toHaveCount(0);
    await page.mouse.up();
    void b;
  });

  test("CHK2-I5 the edges of the tile area snap the same way", async ({ mm, page }) => {
    const [a] = await open(mm, [{ index: 0, x: 300, y: 250, width: 300, height: 200 }]);
    // Grab far from the left edge so the pointer is not in the 24 px zone band.
    const from = await mm.titlePoint(a as number, 200);
    await mm.dragStart(from, { x: from.x - 295, y: from.y }, 8);
    // Left edge at 5 is 3 px from the tile area edge (8): it snaps.
    await mm.expectDomRect(a as number, { x: 8 });
    await expect(mm.workspace.getByTestId("snap-guide")).toHaveCount(1);
    await page.mouse.up();
    await mm.expectStoredRect(a as number, { x: 8 });
  });

  test("CHK2-I6 Alt during the move turns snapping off; releasing Alt re-enables it", async ({ mm, page }) => {
    const [a] = await open(mm, [
      { index: 0, x: 800, y: 450, width: 300, height: 200 },
      { index: 1, x: 100, y: 100, width: 400, height: 250 },
    ]);
    const from = await mm.titlePoint(a as number, 20);
    await page.keyboard.down("Alt");
    await mm.dragStart(from, { x: from.x - 285, y: from.y }, 8);
    await mm.expectDomRect(a as number, { x: 515 });
    await expect(mm.workspace.getByTestId("snap-guide")).toHaveCount(0);
    await page.keyboard.up("Alt");
    await expect(mm.workspace.getByTestId("snap-guide")).toHaveCount(1);
    await mm.expectDomRect(a as number, { x: 508 });
    await page.mouse.up();
    await mm.expectStoredRect(a as number, { x: 508 });
  });

  const ZONES: Array<{ name: string; at: (w: number, h: number) => { x: number; y: number }; rect: { x: number; y: number; width: number; height: number }; say: string | null }> = [
    { name: "left edge", at: (_w, h) => ({ x: 20, y: h / 2 }), rect: { x: 8, y: 8, width: 654, height: 700 }, say: "left half" },
    { name: "right edge", at: (w, h) => ({ x: w - 20, y: h / 2 }), rect: { x: 670, y: 8, width: 654, height: 700 }, say: "right half" },
    { name: "top edge", at: (w) => ({ x: w / 2, y: 20 }), rect: { x: 8, y: 8, width: 1316, height: 700 }, say: "full workspace" },
    { name: "top-left corner", at: () => ({ x: 20, y: 20 }), rect: { x: 8, y: 8, width: 654, height: 346 }, say: "top-left quarter" },
    { name: "bottom-right corner", at: (w, h) => ({ x: w - 20, y: h - 20 }), rect: { x: 670, y: 362, width: 654, height: 346 }, say: "bottom-right quarter" },
  ];
  for (const zone of ZONES) {
    test(`CHK2-I7 snap zone at the ${zone.name}: preview, drop, announcement`, async ({ mm, page }) => {
      const [a] = await open(mm, [{ index: 0, x: 400, y: 250, width: 500, height: 300 }]);
      const id = a as number;
      const size = await mm.workspaceSize();
      const to = await mm.wsPoint(zone.at(size.width, size.height).x, zone.at(size.width, size.height).y);
      const from = await mm.titlePoint(id, 20);
      await mm.dragStart(from, to, 10);
      const preview = mm.workspace.getByTestId("zone-preview");
      await expect(preview).toBeVisible();
      await expect.poll(() => preview.evaluate((el) => { const h = el as HTMLElement; return { x: h.offsetLeft, y: h.offsetTop, width: h.offsetWidth, height: h.offsetHeight }; })).toEqual(zone.rect);
      expect(await preview.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
      await page.mouse.up();
      await mm.expectStoredRect(id, { ...zone.rect, state: "normal" });
      await mm.expectDomRect(id, zone.rect);
      await expect(mm.livePolite).toHaveText(`Poll 1 moved to the ${zone.say}.`);
      // The top zone is a rectangle, not a maximize: the button still offers "Maximize".
      await expect(mm.titleButton(id, "Maximize")).toBeVisible();
    });
  }

  test("CHK2-I7 the bottom edge alone shows no zone", async ({ mm, page }) => {
    const [a] = await open(mm, [{ index: 0, x: 400, y: 250, width: 500, height: 300 }]);
    const size = await mm.workspaceSize();
    const to = await mm.wsPoint(size.width / 2, size.height - 12);
    await mm.dragStart(await mm.titlePoint(a as number, 20), to, 10);
    await expect(mm.workspace.getByTestId("zone-preview")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  test("CHK2-I7 zones arm only after the pointer left the start band (a window at (8, 8) can be moved sideways)", async ({ mm, page }) => {
    const [a] = await open(mm, [{ index: 0, x: 8, y: 8, width: 500, height: 300 }]);
    const from = await mm.titlePoint(a as number, 20);
    // The press is inside the 24 px band at the top; moving along the band shows no zone.
    await mm.dragStart(from, { x: from.x + 200, y: from.y }, 8);
    await expect(mm.workspace.getByTestId("zone-preview")).toHaveCount(0);
    await mm.expectDomRect(a as number, { x: 208, y: 8 });
    await page.mouse.up();
    await mm.expectStoredRect(a as number, { x: 208, y: 8 });
    // Leaving the band and coming back arms the zone.
    const again = await mm.titlePoint(a as number, 20);
    await mm.dragStart(again, { x: again.x, y: again.y + 200 }, 6);
    await page.mouse.move(again.x, again.y + 2, { steps: 6 });
    await expect(mm.workspace.getByTestId("zone-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  test("CHK2-I7 (revision 8) while a zone preview is shown there is no guide line and no edge snap, even 5 px from another sub-window's edge", async ({
    mm,
    page,
  }) => {
    const [a] = await open(
      mm,
      [
        { index: 0, x: 300, y: 450, width: 300, height: 200 },
        { index: 1, x: 900, y: 280, width: 300, height: 300 },
      ],
      ["A", "B"],
    );
    const id = a as number;
    const guide = mm.workspace.getByTestId("snap-guide");
    // Control: outside the band, A's top edge (pointer y 300 - 15 = 285, 5 px from B.top = 280) snaps and draws a guide.
    const from = await mm.titlePoint(id, 20);
    const startRect = await mm.domRect(id);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const control = await mm.wsPoint(540, 300);
    await page.mouse.move(control.x, control.y, { steps: 8 });
    await expect(guide, "outside the band the top edge snaps to B's top").toHaveCount(1);
    await expect(guide).toHaveAttribute("data-axis", "y");
    await mm.expectDomRect(id, { y: 280 });
    // Now the pointer enters the 24 px band at the left border: the zone shows, snapping is suspended.
    const inBand = await mm.wsPoint(20, 300);
    await page.mouse.move(inBand.x, inBand.y, { steps: 8 });
    const preview = mm.workspace.getByTestId("zone-preview");
    await expect(preview).toBeVisible();
    await expect(guide, "no guide line while the zone preview is shown").toHaveCount(0);
    const live = await mm.domRect(id);
    // The frame follows the pointer exactly: its offset from the press point is unchanged.
    expect(live.y, "no edge snap: the frame follows the pointer (B.top = 280 is within 8 px)").toBe(startRect.y + (inBand.y - from.y));
    expect(live.x, "no edge snap on x either (the tile area edge at 8 is within 8 px)").toBe(startRect.x + (inBand.x - from.x));
    expect(live.y, "B.top is within 8 px of the unsnapped top").not.toBe(280);
    await page.mouse.up();
    await mm.expectStoredRect(id, { x: 8, y: 8, width: 654, height: 700 });
    void startRect;
  });

  test("CHK2-I7 (revision 8) a press that starts inside the band shows no zone until the pointer has been outside the band once in that drag", async ({
    mm,
    page,
  }) => {
    const [a] = await open(mm, [{ index: 0, x: 8, y: 8, width: 500, height: 300 }]);
    const from = await mm.titlePoint(a as number, 20);
    await mm.dragStart(from, { x: from.x + 100, y: from.y }, 5);
    await expect(mm.workspace.getByTestId("zone-preview")).toHaveCount(0);
    // Out of the band (y 60 > 24) once ...
    await page.mouse.move(from.x + 100, from.y + 80, { steps: 4 });
    await expect(mm.workspace.getByTestId("zone-preview")).toHaveCount(0);
    // ... and back into the band: now the top zone shows.
    await page.mouse.move(from.x + 100, from.y + 2, { steps: 6 });
    await expect(mm.workspace.getByTestId("zone-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  test("CHK2-I8 swap: Ctrl-drag over B's title bar shows 'Swap'; release exchanges the rectangles", async ({ mm, page }) => {
    const [a, b] = await open(mm, [
      { index: 0, x: 100, y: 400, width: 400, height: 250 },
      { index: 1, x: 700, y: 100, width: 520, height: 300 },
    ]);
    const bBar = await mm.titlePoint(b as number, 60);
    await page.keyboard.down("Control");
    await mm.dragStart(await mm.titlePoint(a as number, 20), bBar, 10);
    await expect(mm.titleBar(b as number).getByTestId("swap-overlay")).toHaveText("Swap");
    await page.mouse.up();
    await page.keyboard.up("Control");
    await mm.expectStoredRect(a as number, { x: 700, y: 100, width: 520, height: 300 });
    await mm.expectStoredRect(b as number, { x: 100, y: 400, width: 400, height: 250 });
    await expect(mm.livePolite).toHaveText("Poll 1 swapped with Poll 2.");
  });

  test("CHK2-I8 releasing Ctrl before the drop makes it a normal move", async ({ mm, page }) => {
    const [a, b] = await open(mm, [
      { index: 0, x: 100, y: 400, width: 400, height: 250 },
      { index: 1, x: 700, y: 100, width: 520, height: 300 },
    ]);
    const bBar = await mm.titlePoint(b as number, 60);
    await page.keyboard.down("Control");
    await mm.dragStart(await mm.titlePoint(a as number, 20), bBar, 10);
    await expect(mm.titleBar(b as number).getByTestId("swap-overlay")).toBeVisible();
    await page.keyboard.up("Control");
    await expect(mm.titleBar(b as number).getByTestId("swap-overlay")).toHaveCount(0);
    await page.mouse.up();
    await mm.expectStoredRect(b as number, { x: 700, y: 100, width: 520, height: 300 });
    await mm.expectStoredRect(a as number, { width: 400, height: 250 });
    await expect(mm.livePolite).toHaveText("Poll 1 moved.");
  });

  test("CHK2-I9 dragging a maximized sub-window restores it to its normal size under the pointer", async ({ mm, page }) => {
    const [a] = await open(mm, [{ index: 0, x: 200, y: 150, width: 500, height: 300 }]);
    const id = a as number;
    await mm.titleButton(id, "Maximize").click();
    await expect(mm.sub(id)).toHaveAttribute("data-state", "maximized");
    const from = await mm.titlePoint(id, 400);
    await mm.dragStart(from, { x: from.x + 30, y: from.y + 100 }, 8);
    await expect.poll(async () => (await mm.domRect(id)).width, { message: "live width during the drag" }).toBe(500);
    const r = await mm.domRect(id);
    expect(r.height).toBe(300);
    const ws = await mm.workspace.boundingBox();
    const px = from.x + 30 - (ws?.x ?? 0);
    expect(px, "the pointer is on the title bar").toBeGreaterThanOrEqual(r.x);
    expect(px).toBeLessThanOrEqual(r.x + r.width);
    await page.mouse.up();
    await expect(mm.sub(id)).toHaveAttribute("data-state", "normal");
    await mm.expectStoredRect(id, { width: 500, height: 300, state: "normal" });
  });

  test("CHK2-I21 no Alt leak: Alt key presses during a drag are default-prevented", async ({ mm, page }) => {
    const [a] = await open(mm, [{ index: 0, x: 300, y: 200, width: 500, height: 300 }]);
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __alt: string[] }).__alt = seen;
      // Bubble phase on window: runs after the app's capture listener.
      for (const type of ["keydown", "keyup"] as const) {
        window.addEventListener(type, (e) => {
          if (e.key === "Alt") seen.push(`${type}:${e.defaultPrevented}`);
        });
      }
    });
    await mm.dragStart(await mm.titlePoint(a as number, 20), { x: 600, y: 500 }, 6);
    await page.keyboard.down("Alt");
    await page.keyboard.up("Alt");
    await page.mouse.up();
    const seen = await page.evaluate(() => (window as unknown as { __alt: string[] }).__alt);
    expect(seen).toEqual(["keydown:true", "keyup:true"]);
    // The focus stays in the page content.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBeNull();
  });
});

// CHK2-I22 (revision 8, D-002-10, O-3): snap tie, touching beats the gap line. Tile area 1316 x 700 (x 8-1324),
// free layout, two sub-windows: B (700, 200, 400, 300) and A (100, 100, 320, 200). A's title bar is pressed at
// its centre (260, 115) and the pointer moves by dx with dy = 0. All values are computed in the checklist.
test.describe("I22 snap ties", () => {
  const VECTORS: Array<{ dx: number; free: number; guide: number | null; after: number; alt?: boolean }> = [
    { dx: 260, free: 360, guide: null, after: 360 },
    { dx: 266, free: 372, guide: 692, after: 372 },
    { dx: 275, free: 372, guide: 692, after: 372 },
    { dx: 276, free: 380, guide: 700, after: 380 },
    { dx: 277, free: 380, guide: 700, after: 380 },
    { dx: 284, free: 380, guide: 700, after: 380 },
    { dx: 276, free: 376, guide: null, after: 376, alt: true },
  ];
  for (const v of VECTORS) {
    test(`CHK2-I22 dx ${v.dx}${v.alt ? " with Alt held" : ""}: ${v.guide === null ? "no guide" : `guide at x = ${v.guide}`}, A at x ${v.after} after release`, async ({
      mm,
      page,
    }) => {
      const [a] = await open(
        mm,
        [
          { index: 0, x: 100, y: 100, width: 320, height: 200, z: 2 },
          { index: 1, x: 700, y: 200, width: 400, height: 300, z: 1 },
        ],
        ["A", "B"],
      );
      const id = a as number;
      expect(await mm.workspaceSize()).toEqual({ width: 1332, height: 716 });
      const press = await mm.wsPoint(260, 115);
      // The press point is on A's title bar (name area), not on a button.
      const hit = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-slot="title-bar"]') !== null, press);
      expect(hit, "(260, 115) is on A's title bar").toBe(true);
      if (v.alt) await page.keyboard.down("Alt");
      await page.mouse.move(press.x, press.y);
      await page.mouse.down();
      await page.mouse.move(press.x + v.dx, press.y, { steps: 12 });
      await mm.expectDomRect(id, { x: v.free, y: 100, width: 320, height: 200 });
      const guide = mm.workspace.getByTestId("snap-guide");
      if (v.guide === null) {
        await expect(guide).toHaveCount(0);
      } else {
        await expect(guide).toHaveCount(1);
        await expect(guide).toHaveAttribute("data-axis", "x");
        expect(await guide.evaluate((el) => Number.parseFloat((el as HTMLElement).style.left)), "guide x").toBe(v.guide);
        expect(await guide.evaluate((el) => getComputedStyle(el).borderLeftStyle)).toBe("dashed");
        expect(await guide.evaluate((el) => Number.parseFloat((el as HTMLElement).style.height)), "full workspace height").toBeGreaterThanOrEqual(700);
      }
      await expect(mm.workspace.getByTestId("zone-preview"), "the pointer is far from the band").toHaveCount(0);
      await page.mouse.up();
      if (v.alt) await page.keyboard.up("Alt");
      await mm.expectStoredRect(id, { x: v.after, y: 100, width: 320, height: 200 });
      await mm.expectDomRect(id, { x: v.after, y: 100, width: 320, height: 200 });
      await expect(mm.livePolite).toHaveText("A moved.");
      await expect(guide).toHaveCount(0);
    });
  }

  test("CHK2-I22 touching also wins from the other side: B's right edge against A's left edge (mirror tie)", async ({ mm, page }) => {
    // Mirror image of the 276 vector: A is dragged left towards B.right (1100). Gap line = B.right + 8 = 1108.
    const [a] = await open(
      mm,
      [
        { index: 0, x: 1300 - 500, y: 100, width: 320, height: 200, z: 2 },
        { index: 1, x: 700, y: 200, width: 400, height: 300, z: 1 },
      ],
      ["A", "B"],
    );
    const id = a as number;
    // A.x 800 -> unsnapped A.x = 1104 means 4 px from B.right (1100) and 4 px from the gap line 1108.
    const press = await mm.wsPoint(800 + 160, 115);
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(press.x + 304, press.y, { steps: 12 });
    await mm.expectDomRect(id, { x: 1100 });
    const guide = mm.workspace.getByTestId("snap-guide");
    await expect(guide).toHaveCount(1);
    expect(await guide.evaluate((el) => Number.parseFloat((el as HTMLElement).style.left)), "guide on the touching edge").toBe(1100);
    await page.mouse.up();
  });
});
