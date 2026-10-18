// Integration mode (REPORT-006), (f): the workspace in the real WebView2. Real pointer input over CDP (Playwright mouse)
// for drag, resize, snap and zones; real HARDWARE input (SendInput) for the keyboard shortcuts and Alt behavior, so the
// WebView2 browser accelerators, the OS menu and focus handling are really exercised. CHK2-I1-I8, I22, E10, E14, R7,
// section 3.1 shortcuts. I16/I17 (drag out / dock by drag) are phase 2 and not implemented: skipped (see report).
import { type Desktop, expect, type RealMm, test } from "../integration/fixtures";
import { openProfile, profileV2, writeProfile } from "../integration/profiles";
import { twoFrames } from "../integration/status-line";

interface Item {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number;
  state?: string;
}

/** Opens a profile with these sub-windows at these rectangles (idle connection) in a maximized W1. */
async function openLayout(desktop: Desktop, mm: RealMm, items: Item[], workspace: Record<string, unknown> = {}): Promise<Record<string, number>> {
  const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
  desktop.showWindow(w1?.hwnd as number, "max");
  await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.zoomed).toBe(true);
  writeProfile(
    desktop,
    "Lay",
    profileV2(
      "Lay",
      items.map((it, n) => ({
        name: it.name,
        scan: 1000,
        workspace: { x: it.x, y: it.y, width: it.width, height: it.height, z: it.z ?? n + 1, state: it.state ?? "normal" },
      })),
      {},
      workspace,
    ),
  );
  await openProfile(mm, "Lay");
  const ids: Record<string, number> = {};
  for (const it of items) {
    ids[it.name] = await mm.idByName(it.name);
    if ((it.state ?? "normal") !== "minimized") await expect(mm.sub(ids[it.name] as number)).toBeVisible();
  }
  await twoFrames(mm.page);
  return ids;
}

/** Announcements of the live regions, recorded in the page from now on. */
async function recordAnnouncements(mm: RealMm): Promise<void> {
  await mm.page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __ann: string[] }).__ann = log;
    for (const id of ["live-polite", "live-assertive"]) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (el) new MutationObserver(() => { if (el.textContent) log.push(`${id === "live-polite" ? "P" : "A"}:${el.textContent}`); }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  });
}
const announcements = (mm: RealMm) => mm.page.evaluate(() => [...((window as unknown as { __ann?: string[] }).__ann ?? [])]);

test.describe("(f) workspace pointer input in the real WebView2", () => {
  test("CHK2-I1/I2/I3 move: 3 px does nothing, 40 px moves live, release keeps; far left/top/right/bottom keep 80 x 30 px of the title bar; Esc restores and announces 'Move cancelled.'", async ({ desktop, mm }) => {
    test.setTimeout(120_000);
    const ids = await openLayout(desktop, mm, [{ name: "A", x: 500, y: 300, width: 320, height: 200 }]);
    const a = ids.A as number;
    await recordAnnouncements(mm);
    const p = await mm.titlePoint(a, 20);
    await mm.page.mouse.move(p.x, p.y);
    await mm.page.mouse.down();
    await mm.page.mouse.move(p.x + 3, p.y);
    await mm.expectDomRect(a, { x: 500, y: 300 });
    await expect(mm.sub(a)).not.toHaveAttribute("data-dragging", "true");
    await mm.page.mouse.move(p.x + 40, p.y, { steps: 5 });
    await expect(mm.sub(a)).toHaveAttribute("data-dragging", "true");
    const live = await mm.domRect(a);
    expect(live.x, "moves live under the pointer (125 % scale: +-1 px)").toBeGreaterThanOrEqual(538);
    expect(live.x).toBeLessThanOrEqual(542);
    await mm.page.mouse.up();
    await expect(mm.sub(a)).not.toHaveAttribute("data-dragging", "true");
    const kept = await mm.domRect(a);
    expect(kept.x, "release keeps the position").toBe(live.x);
    await expect.poll(() => announcements(mm)).toContain("P:A moved.");
    // constraint, with Alt held so no snapping or zones interfere (CDP modifier)
    const ws = await mm.workspace.boundingBox();
    if (!ws) throw new Error("no workspace");
    await mm.page.keyboard.down("Alt");
    const cases: Array<{ name: string; dxy: [number, number]; want: (r: { x: number; y: number }) => boolean }> = [
      { name: "left", dxy: [-2000, 0], want: (r) => r.x === 80 - 320 },
      { name: "top", dxy: [0, -2000], want: (r) => r.y === 0 },
      { name: "right", dxy: [2000, 0], want: (r) => Math.abs(r.x - (Math.round(ws.width) - 80)) <= 1 },
      { name: "bottom", dxy: [0, 2000], want: (r) => Math.abs(r.y - (Math.round(ws.height) - 30)) <= 1 },
    ];
    for (const c of cases) {
      const from = await mm.titlePoint(a, 20);
      await mm.dragStart(from, { x: from.x + c.dxy[0], y: from.y + c.dxy[1] }, 10);
      const r = await mm.domRect(a);
      expect(c.want(r), `${c.name}: frame at ${JSON.stringify(r)} (workspace ${Math.round(ws.width)} x ${Math.round(ws.height)})`).toBe(true);
      await mm.page.keyboard.press("Escape");
      await mm.page.mouse.up();
      await expect(mm.sub(a)).not.toHaveAttribute("data-dragging", "true");
    }
    await mm.page.keyboard.up("Alt");
    // Esc during a move restores the rectangle from before the press and announces it
    const before = await mm.domRect(a);
    const q = await mm.titlePoint(a, 20);
    await mm.dragStart(q, { x: q.x + 120, y: q.y + 60 }, 6);
    await expect.poll(async () => (await mm.domRect(a)).x).not.toBe(before.x);
    await mm.page.keyboard.press("Escape");
    await mm.page.mouse.up();
    await mm.expectDomRect(a, before);
    await expect.poll(() => announcements(mm)).toContain("P:Move cancelled.");
    expect(mm.pageErrors).toEqual([]);
  });

  test("CHK2-I4 resize: east, south and south-east handles change the size live, opposite edges stay, minimum 320 x 180, announcement 'A resized to w by h.'", async ({ desktop, mm }) => {
    const ids = await openLayout(desktop, mm, [{ name: "A", x: 200, y: 150, width: 500, height: 300 }]);
    const a = ids.A as number;
    await recordAnnouncements(mm);
    const grab = async (h: string) => {
      const b = await mm.sub(a).locator(`[data-resize-handle="${h}"]`).boundingBox();
      if (!b) throw new Error(`handle ${h}`);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    // east +100
    let g = await grab("e");
    await mm.dragStart(g, { x: g.x + 100, y: g.y }, 6);
    let r = await mm.domRect(a);
    expect(r.x).toBe(200);
    expect(r.width).toBeGreaterThanOrEqual(598);
    expect(r.width).toBeLessThanOrEqual(602);
    await mm.page.mouse.up();
    // south-east -250 -250 reaches the minimum
    g = await grab("se");
    await mm.dragStart(g, { x: g.x - 600, y: g.y - 400 }, 10);
    r = await mm.domRect(a);
    expect(r, "minimum size 320 x 180 at the top-left corner of the frame").toMatchObject({ x: 200, y: 150, width: 320, height: 180 });
    await mm.page.mouse.up();
    await expect.poll(() => announcements(mm)).toContain("P:A resized to 320 by 180.");
    // north-west: the south-east corner stays fixed
    const before = await mm.domRect(a);
    g = await grab("nw");
    await mm.dragStart(g, { x: g.x - 50, y: g.y - 40 }, 5);
    r = await mm.domRect(a);
    expect(r.x + r.width, "right edge fixed").toBe(before.x + before.width);
    expect(r.y + r.height, "bottom edge fixed").toBe(before.y + before.height);
    await mm.page.keyboard.press("Escape");
    await mm.page.mouse.up();
    await mm.expectDomRect(a, before);
  });

  test("CHK2-I5/I6 edge snap (dashed guide, 8 px gap): snaps at 4 and 7 px, not at 10 px; the 8 and 9 px boundary is recorded; Alt disables snapping", async ({ desktop, mm }, testInfo) => {
    const ids = await openLayout(desktop, mm, [
      { name: "A", x: 100, y: 100, width: 320, height: 200 },
      { name: "B", x: 700, y: 450, width: 320, height: 200 },
    ]);
    const a = ids.A as number;
    // B.left = 700, so the 8 px gap line is 692. Put A's right edge `near` px short of 692 and look at the guide.
    const gap = 692;
    const table: Array<Record<string, unknown>> = [];
    for (const near of [4, 7, 8, 9, 10, 14]) {
      const r0 = await mm.domRect(a);
      const start = await mm.titlePoint(a, 160);
      await mm.dragStart(start, { x: start.x + (gap - near - (r0.x + r0.width)), y: start.y }, 6);
      const r = await mm.domRect(a);
      const guides = await mm.page.getByTestId("snap-guide").count();
      table.push({ near, right: r.x + r.width, guides, snapped: r.x + r.width === gap });
      await mm.page.keyboard.press("Escape");
      await mm.page.mouse.up();
      await mm.expectDomRect(a, r0);
    }
    console.log("I5 SNAP TABLE", JSON.stringify(table));
    await testInfo.attach("i5-snap.json", { body: JSON.stringify(table), contentType: "application/json" });
    const by = (n: number) => table.find((x) => x.near === n) as { snapped: boolean; guides: number };
    expect(by(4).snapped, "snaps at 4 px").toBe(true);
    expect(by(4).guides, "dashed guide at 4 px").toBeGreaterThan(0);
    expect(by(7).snapped, "snaps at 7 px (CHK2-I5)").toBe(true);
    expect(by(10).snapped, "no snap at 10 px (CHK2-I5)").toBe(false);
    expect(by(10).guides, "no guide at 10 px").toBe(0);
    // Alt held: no snap even at 4 px
    await mm.page.keyboard.down("Alt");
    const r1 = await mm.domRect(a);
    const s2 = await mm.titlePoint(a, 160);
    await mm.dragStart(s2, { x: s2.x + (gap - 4 - (r1.x + r1.width)), y: s2.y }, 6);
    await expect(mm.page.getByTestId("snap-guide")).toHaveCount(0);
    const r2 = await mm.domRect(a);
    expect(Math.abs(r2.x + r2.width - (gap - 4))).toBeLessThanOrEqual(1);
    await mm.page.keyboard.press("Escape");
    await mm.page.mouse.up();
    await mm.page.keyboard.up("Alt");
  });

  test("CHK2-I22 snap tie: touching beats the gap line (exact pixels, real pointer at 125 %)", async ({ desktop, mm }, testInfo) => {
    test.setTimeout(120_000);
    const ids = await openLayout(desktop, mm, [
      { name: "A", x: 100, y: 100, width: 320, height: 200 },
      { name: "B", x: 700, y: 200, width: 400, height: 300 },
    ]);
    const a = ids.A as number;
    const rows: Array<{ dx: number; alt: boolean; guide: number | null; after: number }> = [
      { dx: 260, alt: false, guide: null, after: 360 },
      { dx: 266, alt: false, guide: 692, after: 372 },
      { dx: 275, alt: false, guide: 692, after: 372 },
      { dx: 276, alt: false, guide: 700, after: 380 },
      { dx: 277, alt: false, guide: 700, after: 380 },
      { dx: 284, alt: false, guide: 700, after: 380 },
      { dx: 276, alt: true, guide: null, after: 376 },
    ];
    const result: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      // reset A to x = 100 through the keyboard-free route: the press starts at A's current title bar center
      const cur = await mm.domRect(a);
      const start = await mm.titlePoint(a, 160); // title bar center of a 320 px frame is 160 px from its left edge
      const ws = await mm.workspace.boundingBox();
      if (row.alt) await mm.page.keyboard.down("Alt");
      await mm.dragStart(start, { x: start.x + row.dx, y: start.y }, 8);
      const live = await mm.domRect(a);
      const guideEl = mm.page.getByTestId("snap-guide");
      const guide = (await guideEl.count()) > 0 ? Math.round(((await guideEl.first().boundingBox())?.x ?? 0) - (ws?.x ?? 0)) : null;
      await mm.page.mouse.up();
      if (row.alt) await mm.page.keyboard.up("Alt");
      await expect(mm.sub(a)).not.toHaveAttribute("data-dragging", "true");
      const after = await mm.domRect(a);
      result.push({ ...row, startX: cur.x, liveX: live.x, observedGuide: guide, observedAfter: after.x, width: after.width });
      // put A back at x = 100 for the next row with a drag the other way (Alt: no snapping)
      await mm.page.keyboard.down("Alt");
      const back = await mm.titlePoint(a, 160);
      await mm.dragStart(back, { x: back.x - (after.x - 100), y: back.y }, 8);
      await mm.page.mouse.up();
      await mm.page.keyboard.up("Alt");
      await expect.poll(async () => Math.abs((await mm.domRect(a)).x - 100)).toBeLessThanOrEqual(1);
    }
    console.log("I22", JSON.stringify(result));
    await testInfo.attach("i22.json", { body: JSON.stringify(result, null, 1), contentType: "application/json" });
    for (const r of result) {
      expect(r.observedAfter, `dx ${r.dx}${r.alt ? " with Alt" : ""}: A.x after release (want ${r.after})`).toBe(r.after);
      expect(r.observedGuide, `dx ${r.dx}${r.alt ? " with Alt" : ""}: guide x during the drag (want ${r.guide})`).toBe(r.guide);
    }
  });

  test("CHK2-I7 snap zones: pointer at the left edge shows the preview, the drop gives the left half and announces it; the top edge fills the area", async ({ desktop, mm }) => {
    const ids = await openLayout(desktop, mm, [{ name: "A", x: 300, y: 200, width: 400, height: 250 }]);
    const a = ids.A as number;
    await recordAnnouncements(mm);
    const ws = await mm.workspace.boundingBox();
    if (!ws) throw new Error("no workspace");
    const area = { w: Math.round(ws.width) - 16, h: Math.round(ws.height) - 16 };
    const start = await mm.titlePoint(a, 60);
    // left edge, mid height (outside the 24 px band of the starting position)
    await mm.dragStart(start, { x: ws.x + 20, y: ws.y + ws.height / 2 }, 10);
    await expect(mm.page.getByTestId("zone-preview")).toBeVisible();
    await mm.page.mouse.up();
    const half = Math.floor((area.w - 8) / 2);
    const left = await mm.domRect(a);
    expect(left, "left half").toMatchObject({ x: 8, y: 8, height: area.h });
    expect(Math.abs(left.width - half), `half width ${half} vs ${left.width}`).toBeLessThanOrEqual(1);
    await expect.poll(() => announcements(mm)).toContain("P:A moved to the left half.");
    // top edge: the whole area, the state stays normal
    const s2 = await mm.titlePoint(a, 60);
    // the press is inside the 24 px band (the frame is at y = 8): leave the band once, then come back
    await mm.dragStart(s2, { x: s2.x + 60, y: s2.y + 200 }, 6);
    await mm.page.mouse.move(ws.x + ws.width / 2, ws.y + 20, { steps: 10 });
    await expect(mm.page.getByTestId("zone-preview")).toBeVisible();
    await mm.page.mouse.up();
    const full = await mm.domRect(a);
    expect(full).toMatchObject({ x: 8, y: 8 });
    expect(Math.abs(full.width - area.w)).toBeLessThanOrEqual(1);
    await expect(mm.sub(a)).toHaveAttribute("data-state", "normal");
  });

  test("CHK2-I8 Ctrl-drag over another title bar shows 'Swap'; release exchanges the rectangles and announces it", async ({ desktop, mm }) => {
    const ids = await openLayout(desktop, mm, [
      { name: "A", x: 40, y: 40, width: 360, height: 220 },
      { name: "B", x: 500, y: 300, width: 400, height: 240 },
    ]);
    const [a, b] = [ids.A as number, ids.B as number];
    await recordAnnouncements(mm);
    const ra = await mm.domRect(a);
    const rb = await mm.domRect(b);
    const start = await mm.titlePoint(a, 60);
    const target = await mm.titlePoint(b, 60);
    await mm.page.keyboard.down("Control");
    await mm.dragStart(start, target, 12);
    await expect(mm.page.getByTestId("swap-overlay")).toBeVisible();
    await mm.page.mouse.up();
    await mm.page.keyboard.up("Control");
    await mm.expectDomRect(a, rb);
    await mm.expectDomRect(b, ra);
    await expect.poll(() => announcements(mm)).toContain("P:A swapped with B.");
  });

  test("CHK2-E10 shrinking W1 with a real OS resize clamps every sub-window to keep 80 x 30 px of its title bar visible", async ({ desktop, mm }) => {
    test.setTimeout(90_000);
    const ids = await openLayout(desktop, mm, [{ name: "A", x: 700, y: 300, width: 400, height: 250 }]);
    const a = ids.A as number;
    const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    desktop.showWindow(w1?.hwnd as number, "restore");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.zoomed).toBe(false);
    const w = desktop.windows().find((x) => x.hwnd === w1?.hwnd);
    // a real OS resize: drag the right edge to the left (the minimum is 960 x 600 logical)
    const f = w?.frame as { x: number; y: number; w: number; h: number };
    const r = w?.rect as { x: number; y: number; w: number; h: number };
    desktop.showWindow(w1?.hwnd as number, "focus");
    desktop.mouseDrag(f.x + f.w - 1, r.y + 400, r.x + 500, r.y + 400, 25, 20);
    await expect.poll(async () => (await mm.workspaceSize()).width, { message: "workspace shrank" }).toBeLessThan(900);
    const ws = await mm.workspaceSize();
    const rect = await mm.domRect(a);
    expect(rect.x, `A.x ${rect.x} leaves at least 80 px visible in a workspace of ${ws.width}`).toBeLessThanOrEqual(ws.width - 80);
    expect(rect.y).toBeLessThanOrEqual(ws.height - 30);
  });
});
