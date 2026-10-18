// CHK-002 section I (part 2): tile mode drag, list reorder, drag from the list into the workspace,
// keyboard equivalents, title bar menu. Real mouse events.
import { expect, LAYOUT_SEED, test, type Mm } from "../support/mm-fixtures";

const slot = (i: number) =>
  [
    { x: 8, y: 8, width: 654, height: 346 },
    { x: 670, y: 8, width: 654, height: 346 },
    { x: 8, y: 362, width: 654, height: 346 },
    { x: 670, y: 362, width: 654, height: 346 },
  ][i] as { x: number; y: number; width: number; height: number };

async function names(mm: Mm): Promise<string[]> {
  return mm.script((f) => f.snapshot().polls.map((p: { config: { name: string } }) => p.config.name));
}
async function rowNames(mm: Mm): Promise<string[]> {
  return mm.pollList.getByRole("option").evaluateAll((els) =>
    els.map((el) => (el.getAttribute("aria-label") ?? "").split(",")[0] ?? ""),
  );
}
async function tiled(mm: Mm, n: number): Promise<number[]> {
  await mm.open({ polls: Array.from({ length: n }, (_, i) => ({ name: `Poll ${i + 1}` })) });
  await mm.sizeWorkspaceTo(1332, 716);
  const ids = await mm.pollIds();
  await mm.windowMenu("Tile");
  await mm.expectDomRect(ids[n - 1] as number, n === 4 ? slot(3) : {});
  return ids;
}
const rectOf = (el: HTMLElement) => ({ x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });

test.describe("I tile mode", () => {
  test("CHK2-I10 dragging A onto slot 3: slot indicator, order [B, C, A, D], announcement, no resize handles", async ({ mm, page }) => {
    const ids = await tiled(mm, 4);
    const [a, , , d] = ids as [number, number, number, number];
    await expect(mm.workspace.locator("[data-resize-handle]")).toHaveCount(0);
    const to = await mm.wsPoint(slot(2).x + 300, slot(2).y + 150);
    await mm.dragStart(await mm.titlePoint(a, 40), to, 10);
    const indicator = mm.workspace.getByTestId("slot-indicator");
    await expect(indicator).toBeVisible();
    await expect.poll(() => indicator.evaluate(rectOf)).toEqual(slot(2));
    await page.mouse.up();
    await expect.poll(() => names(mm)).toEqual(["Poll 2", "Poll 3", "Poll 1", "Poll 4"]);
    await expect.poll(() => rowNames(mm)).toEqual(["Poll 2", "Poll 3", "Poll 1", "Poll 4"]);
    await expect(mm.livePolite).toHaveText("Poll 1 moved to slot 3 of 4.");
    await mm.expectDomRect(a, slot(2));
    await expect(mm.workspace.locator("[data-resize-handle]")).toHaveCount(0);
    // Ctrl-drop of A on D swaps their slots: [B, C, D, A].
    await page.keyboard.down("Control");
    await mm.dragStart(await mm.titlePoint(a, 40), await mm.titlePoint(d, 60), 10);
    await expect(mm.titleBar(d).getByTestId("swap-overlay")).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect.poll(() => names(mm)).toEqual(["Poll 2", "Poll 3", "Poll 4", "Poll 1"]);
  });

  test("CHK2-I11 tile mode re-tiles on New poll, minimize, pop out and close; Cascade or unchecking ends it keeping the rectangles", async ({ mm, page }) => {
    const ids = await tiled(mm, 4);
    // Closing removes the slot: three tiles, the last row full width.
    await mm.titleButton(ids[3] as number, /^Close/).click();
    await mm.confirm.getByRole("button", { name: "Keep poll" }).click();
    await mm.expectDomRect(ids[2] as number, { x: 8, y: 362, width: 1316, height: 346 });
    // New poll appends a tile at the end: back to four.
    await mm.toolbarButton("New poll").click();
    await expect(mm.row("Poll 5")).toBeVisible();
    const e = await mm.idOf("Poll 5");
    await mm.expectDomRect(e, slot(3));
    expect(await names(mm)).toEqual(["Poll 1", "Poll 2", "Poll 3", "Poll 4", "Poll 5"]);
    // Minimizing removes the slot (the minimized bar takes 52 px of the area).
    await mm.titleButton(ids[1] as number, "Minimize").click();
    await expect(mm.minimizedBar).toBeVisible();
    await expect.poll(() => mm.domRect(ids[0] as number)).toMatchObject({ x: 8, y: 8, width: 654, height: 320 });
    // Pop out removes the slot too.
    await mm.row(ids[2] as number).click();
    await mm.titleButton(ids[2] as number, /^Open in its own window/).click();
    await expect(mm.sub(ids[2] as number)).toHaveCount(0);
    await expect.poll(() => mm.domRect(ids[0] as number)).toMatchObject({ x: 8, y: 8, width: 654 });
    // Unchecking Tile mode keeps the rectangles; the indicator goes.
    const before = await mm.domRect(ids[0] as number);
    await mm.windowMenu("Tile mode", "menuitemcheckbox");
    await expect(mm.tileIndicator).toHaveCount(0);
    await mm.expectDomRect(ids[0] as number, before);
    await expect(mm.workspace.locator("[data-resize-handle]").first()).toBeAttached();
    void page;
  });
});

test.describe("I poll list drag", () => {
  const four = [{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }, { name: "Poll 4" }];

  test("CHK2-I12 dragging row 1 below row 3: indicator with its gap, new order everywhere, announcement, not Modified; Esc cancels", async ({ mm, page }) => {
    await mm.open({ polls: four });
    const [a, b, c, d] = (await mm.pollIds()) as [number, number, number, number];
    const r1 = await mm.row(a).boundingBox();
    const r3 = await mm.row(c).boundingBox();
    if (!r1 || !r3) throw new Error("rows not rendered");
    const from = { x: r1.x + 60, y: r1.y + r1.height / 2 };
    const to = { x: r1.x + 60, y: r3.y + r3.height * 0.75 };
    await mm.dragStart(from, to, 8);
    const indicator = page.getByTestId("list-drop-indicator");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute("data-gap-index", "3");
    await expect(page.getByTestId("list-drag-ghost")).toBeVisible();
    await expect(mm.row(a)).toHaveAttribute("data-dragging", "true");
    await page.mouse.up();
    await expect.poll(() => names(mm)).toEqual(["Poll 2", "Poll 3", "Poll 1", "Poll 4"]);
    expect(await mm.lastCall("reorderPolls")).toEqual([[b, c, a, d]]);
    await expect.poll(() => rowNames(mm)).toEqual(["Poll 2", "Poll 3", "Poll 1", "Poll 4"]);
    await expect(mm.livePolite).toHaveText("Poll 1 moved to position 3 of 4.");
    expect(await mm.modified(), "reorder does not mark Modified").toBe(false);
    await mm.openMenu("Window");
    await expect(page.getByRole("menuitemcheckbox", { name: "3 Poll 1" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+j");
    const options = await mm.traffic.getByRole("combobox", { name: "Traffic filter" }).locator("option").allTextContents();
    expect(options.slice(2)).toEqual(["Poll 2", "Poll 3", "Poll 1", "Poll 4"]);
    await page.keyboard.press("Control+j");
    await expect(mm.traffic).toHaveCount(0);
    // Esc cancels a drag.
    const r2 = await mm.row(b).boundingBox();
    const r4 = await mm.row(d).boundingBox();
    if (!r2 || !r4) throw new Error("rows");
    await mm.dragStart({ x: r2.x + 60, y: r2.y + r2.height / 2 }, { x: r4.x + 60, y: r4.y + r4.height * 0.75 }, 8);
    await expect(indicator).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(indicator).toHaveCount(0);
    expect(await names(mm)).toEqual(["Poll 2", "Poll 3", "Poll 1", "Poll 4"]);
    expect(await mm.callCount("reorderPolls")).toBe(1);
  });

  test("CHK2-I13 holding a dragged row near the bottom of a short list scrolls it", async ({ mm, page }) => {
    await mm.open({
      polls: Array.from({ length: 16 }, (_, i) => ({ name: `Poll ${i + 1}` })),
      viewport: { width: 1618, height: 640 },
    });
    const list = mm.pollList;
    const box = await list.boundingBox();
    const first = await mm.row("Poll 1").boundingBox();
    if (!box || !first) throw new Error("list not rendered");
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight), "the list scrolls").toBe(true);
    await mm.dragStart({ x: first.x + 60, y: first.y + first.height / 2 }, { x: box.x + 60, y: box.y + box.height - 8 }, 8);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(40);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  async function closedPollSetup(mm: Mm, tile = false): Promise<number[]> {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }] });
    await mm.sizeWorkspaceTo(1332, 716);
    const ids = (await mm.pollIds()) as number[];
    if (tile) {
      await mm.script((f, id) => f.closePollView(id, true), ids[2]);
      await mm.windowMenu("Tile");
    } else {
      await mm.script((f, id) => f.closePollView(id, true), ids[1]);
    }
    return ids;
  }

  test("CHK2-I14 dragging a closed poll into the workspace: preview 640 x 368 centered under the pointer; release shows it there", async ({ mm, page }) => {
    const ids = await closedPollSetup(mm);
    const id = ids[1] as number;
    const row = await mm.row(id).boundingBox();
    if (!row) throw new Error("row");
    const to = await mm.wsPoint(700, 400);
    await mm.dragStart({ x: row.x + 60, y: row.y + row.height / 2 }, to, 10);
    const preview = mm.workspace.getByTestId("list-preview");
    await expect(preview).toBeVisible();
    // Title bar (30 px) centered under the pointer: x = 700 - 320, y = 400 - 15.
    await expect.poll(() => preview.evaluate(rectOf)).toEqual({ x: 380, y: 385, width: 640, height: 368 });
    await page.mouse.up();
    await expect(mm.sub(id)).toBeVisible();
    await mm.expectDomRect(id, { x: 380, y: 385, width: 640, height: 368 });
    const placed = (await mm.lastCall("showPoll")) as [number, { workspaceRect: { x: number; y: number } }];
    expect(placed[0]).toBe(id);
    expect(placed[1].workspaceRect).toMatchObject({ x: 380, y: 385 });
  });

  test("CHK2-I14 into the right snap zone: the right half", async ({ mm, page }) => {
    const ids = await closedPollSetup(mm);
    const id = ids[1] as number;
    const row = await mm.row(id).boundingBox();
    if (!row) throw new Error("row");
    const size = await mm.workspaceSize();
    await mm.dragStart({ x: row.x + 60, y: row.y + row.height / 2 }, await mm.wsPoint(size.width - 20, 350), 10);
    const preview = mm.workspace.getByTestId("list-preview");
    await expect.poll(() => preview.evaluate(rectOf)).toEqual({ x: 670, y: 8, width: 654, height: 700 });
    await page.mouse.up();
    await mm.expectDomRect(id, { x: 670, y: 8, width: 654, height: 700 });
  });

  test("CHK2-I14 in tile mode it is inserted at the slot under the pointer", async ({ mm, page }) => {
    const ids = await closedPollSetup(mm, true);
    const id = ids[2] as number;
    const row = await mm.row(id).boundingBox();
    if (!row) throw new Error("row");
    await mm.dragStart({ x: row.x + 60, y: row.y + row.height / 2 }, await mm.wsPoint(250, 300), 10);
    await expect(mm.workspace.getByTestId("list-preview").or(mm.workspace.getByTestId("slot-indicator"))).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => names(mm)).toEqual(["Poll 3", "Poll 1", "Poll 2"]);
    await expect(mm.sub(id)).toBeVisible();
    await mm.expectDomRect(id, slot(0));
  });

  test("CHK2-I15 (UI side) a popped-out poll dropped into the workspace docks at the drop point with the handoff; a refusal shows the toast and moves nothing", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }] });
    const [a] = (await mm.pollIds()) as [number, number];
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(300);
    await mm.titleButton(a, /^Open in its own window/).click();
    await expect(mm.sub(a)).toHaveCount(0);
    // A native view that refuses (a modal is open in that window).
    await mm.script((f, id) => {
      f.attachPollView(id, "native", (e: { type: string }) => {
        if (e.type === "HandoffRequested") void f.provideHandoff(id, null);
      });
    }, a);
    const row = await mm.row(a).boundingBox();
    if (!row) throw new Error("row");
    await mm.dragStart({ x: row.x + 60, y: row.y + row.height / 2 }, await mm.wsPoint(600, 300), 10);
    await page.mouse.up();
    await expect(mm.toast('Close the dialog in the "Poll 1" window first.')).toBeVisible();
    await expect(mm.sub(a)).toHaveCount(0);
    await expect(mm.row(a)).toContainText("own window");
    // A native view that answers with its handoff: the sub-window appears there with the selection.
    const handoff = JSON.stringify({
      version: 1, setupOpen: false, setupOverride: false, selection: [{ start: 2, end: 3 }], anchorAddress: 2, focusAddress: 3,
      topAddress: null, columnWidths: { alias: 160, address: 120, raw: 160, scaled: 160 }, pollDraft: null, scaleDraft: null,
    });
    await mm.script((f, a2) => {
      f.attachPollView(a2.id, "native", (e: { type: string }) => {
        if (e.type === "HandoffRequested") void f.provideHandoff(a2.id, a2.handoff);
      });
    }, { id: a, handoff });
    await mm.dragStart({ x: row.x + 60, y: row.y + row.height / 2 }, await mm.wsPoint(600, 300), 10);
    await page.mouse.up();
    await expect(mm.sub(a)).toBeVisible();
    await mm.expectDomRect(a, { x: 280, y: 285, width: 640, height: 368 });
    await expect(mm.row(a)).not.toContainText("own window");
    for (const i of [2, 3]) await expect(mm.gridRow(a, i)).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("I keyboard", () => {
  async function two(mm: Mm): Promise<[number, number]> {
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }],
      seed: LAYOUT_SEED,
      seedArg: {
        items: [
          { index: 0, x: 50, y: 150, width: 500, height: 300 },
          { index: 1, x: 700, y: 400, width: 500, height: 300 },
        ],
      },
    });
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(300);
    return (await mm.pollIds()) as [number, number];
  }

  test("CHK2-I18 Alt+Arrow moves 16 px (1 px with Shift), Ctrl+Alt+Arrow resizes, Ctrl+Shift+Arrow swaps with the neighbor", async ({ mm, page }) => {
    const [a, b] = await two(mm);
    await mm.grid(a).focus();
    await page.keyboard.press("Alt+ArrowRight");
    await mm.expectDomRect(a, { x: 66, y: 150 });
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await mm.expectDomRect(a, { x: 67, y: 150 });
    await page.keyboard.press("Alt+ArrowDown");
    await mm.expectDomRect(a, { x: 67, y: 166 });
    await page.keyboard.press("Control+Alt+ArrowDown");
    await mm.expectDomRect(a, { x: 67, y: 166, width: 500, height: 316 });
    await page.keyboard.press("Control+Alt+Shift+ArrowRight");
    await mm.expectDomRect(a, { width: 501, height: 316 });
    await mm.expectStoredRect(a, { x: 67, y: 166, width: 501, height: 316 });
    await page.keyboard.press("Control+Shift+ArrowRight");
    await mm.expectStoredRect(a, { x: 700, y: 400, width: 500, height: 300 });
    await mm.expectStoredRect(b, { x: 67, y: 166, width: 501, height: 316 });
    await expect(mm.livePolite).toHaveText("Poll 1 swapped with Poll 2.");
  });

  test("CHK2-I18 inside the alias editor the same keys act on the text, not on the window", async ({ mm, page }) => {
    const [a, b] = await two(mm);
    await mm.gridRow(a, 0).locator('[data-cell="alias"]').dblclick();
    const editor = mm.sub(a).getByRole("textbox", { name: /^Alias for address/ });
    await expect(editor).toBeFocused();
    await editor.fill("abc");
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await mm.expectDomRect(a, { x: 50, y: 150, width: 500, height: 300 });
    await mm.expectDomRect(b, { x: 700, y: 400 });
    await expect(editor).toBeVisible();
  });

  test("CHK2-I19 title bar menu (Shift+F10): Move mode with arrows, Enter commits, Esc cancels; Size mode; Move to a half", async ({ mm, page }) => {
    const [a] = await two(mm);
    await mm.titleBar(a).focus();
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu", { name: "Poll 1 window menu" });
    await expect(menu).toBeVisible();
    for (const label of ["Restore", "Move", "Size", "Minimize", "Maximize", "Move to", "Snap while moving", "Close"]) {
      await expect(menu.getByRole(label === "Snap while moving" ? "menuitemcheckbox" : "menuitem", { name: new RegExp(`^${label}${label === "Move" ? "$" : ""}`) })).toBeVisible();
    }
    await expect(menu.getByRole("menuitemcheckbox", { name: /^Snap while moving/ })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitem", { name: /^Move$/ }).click();
    await expect(mm.workspace.getByTestId("keyboard-outline")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(mm.workspace.getByTestId("keyboard-outline")).toHaveCount(0);
    await mm.expectStoredRect(a, { x: 82, y: 150 });
    // Esc cancels.
    await mm.titleBar(a).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menu", { name: "Poll 1 window menu" }).getByRole("menuitem", { name: /^Move$/ }).click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await mm.expectDomRect(a, { x: 82, y: 150 });
    // Size mode grows the right and bottom edges.
    await mm.titleBar(a).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menu", { name: "Poll 1 window menu" }).getByRole("menuitem", { name: /^Size$/ }).click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await mm.expectStoredRect(a, { x: 82, y: 150, width: 516, height: 316 });
    // Move to > Left half.
    await mm.titleBar(a).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menu", { name: "Poll 1 window menu" }).getByRole("menuitem", { name: /^Move to/ }).click();
    await page.getByRole("menuitem", { name: /^Left half/ }).click();
    await mm.expectStoredRect(a, { x: 8, y: 8, width: 654, height: 700 });
    await expect(mm.livePolite).toHaveText("Poll 1 moved to the left half.");
  });

  const snapSetup = async (mm: Mm) => {
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }],
      seed: LAYOUT_SEED,
      seedArg: {
        items: [
          { index: 0, x: 100, y: 150, width: 400, height: 250 },
          { index: 1, x: 525, y: 150, width: 400, height: 250 },
        ],
      },
    });
    return ((await mm.pollIds()) as number[])[0] as number;
  };

  test("CHK2-I19 keyboard moves snap to the 8 px gap by default (right edge 516 -> the 8 px gap line 517)", async ({ mm, page }) => {
    const a = await snapSetup(mm);
    await mm.titleBar(a).focus();
    await page.keyboard.press("Alt+ArrowRight");
    await mm.expectDomRect(a, { x: 117 });
  });

  test("CHK2-I19 unchecking 'Snap while moving' stops keyboard snapping (the same step gives 116)", async ({ mm, page }) => {
    const a = await snapSetup(mm);
    await mm.titleBar(a).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menu", { name: "Poll 1 window menu" }).getByRole("menuitemcheckbox", { name: /^Snap while moving/ }).click();
    await mm.titleBar(a).focus();
    await page.keyboard.press("Alt+ArrowRight");
    await mm.expectDomRect(a, { x: 116 });
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu", { name: "Poll 1 window menu" }).getByRole("menuitemcheckbox", { name: /^Snap while moving/ })).toHaveAttribute("aria-checked", "false");
  });

  test("CHK2-I20 Alt+Up / Alt+Down on a sidebar row reorder it; Alt+Up on the first row does nothing", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }] });
    const [a, b] = (await mm.pollIds()) as [number, number, number];
    await mm.row(a).focus();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await mm.callCount("reorderPolls")).toBe(0);
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => names(mm)).toEqual(["Poll 2", "Poll 1", "Poll 3"]);
    await expect(mm.livePolite).toHaveText("Poll 1 moved to position 2 of 3.");
    await expect(mm.row(a)).toBeFocused();
    await mm.row(b).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => names(mm)).toEqual(["Poll 1", "Poll 2", "Poll 3"]);
  });
});
