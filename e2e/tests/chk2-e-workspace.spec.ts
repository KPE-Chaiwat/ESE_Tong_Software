// CHK-002 section E: workspace sub-windows (frame, activation, minimize, maximize, tile, cascade,
// Window menu, clamping, empty texts, setup presentation, compact controls, attach states).
import {
  expect,
  LAYOUT_SEED,
  REF_AREA,
  STANDARD_8,
  test,
  type Mm,
  type PollSpec,
} from "../support/mm-fixtures";

const polls = (n: number): PollSpec[] => Array.from({ length: n }, (_, i) => ({ name: `Poll ${i + 1}` }));
const DARK = "rgb(49, 47, 46)";
const LIGHT = "rgb(237, 239, 242)";

async function bg(mm: Mm, id: number): Promise<string> {
  return mm.titleBar(id).evaluate((el) => getComputedStyle(el).backgroundColor);
}
async function borderTop(mm: Mm, id: number): Promise<number> {
  return mm.sub(id).evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopWidth));
}

test.describe("E workspace sub-windows", () => {
  test("CHK2-E1 frame: title bar buttons with tooltips; active frame has the dark title bar and the thicker border", async ({
    mm,
  }) => {
    await mm.open({ polls: polls(2) });
    const [a, b] = await mm.pollIds();
    const titles = {
      setup: "Poll setup (Ctrl+\\)",
      popOut: "Open in its own window (Ctrl+Shift+O)",
      min: "Minimize",
      max: "Maximize",
      close: "Close (Ctrl+F4)",
    };
    for (const id of [a, b] as number[]) {
      for (const label of Object.values(titles)) {
        const button = mm.titleBar(id).getByRole("button", { name: label, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute("title", label);
      }
      await expect(mm.titleBar(id)).toContainText(id === a ? "Poll 1" : "Poll 2");
    }
    // The last created sub-window is active.
    await expect(mm.sub(b as number)).toHaveAttribute("aria-current", "true");
    await expect(mm.sub(a as number)).not.toHaveAttribute("aria-current", "true");
    expect(await bg(mm, b as number)).toBe(DARK);
    expect(await bg(mm, a as number)).toBe(LIGHT);
    expect(await borderTop(mm, b as number)).toBeGreaterThan(await borderTop(mm, a as number));
    expect(await borderTop(mm, b as number)).toBe(2);
  });

  test("CHK2-E2 a press anywhere in an inactive sub-window raises and activates it; the sidebar selection follows", async ({
    mm,
  }) => {
    await mm.open({ polls: polls(3) });
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    // Press in the visible left strip of the first (inactive, partly covered) sub-window.
    await mm.sub(a).click({ position: { x: 10, y: 150 } });
    await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
    await expect(mm.sub(c)).not.toHaveAttribute("aria-current", "true");
    await expect(mm.row(a)).toHaveAttribute("aria-selected", "true");
    await expect(mm.row(c)).toHaveAttribute("aria-selected", "false");
    const z = async (id: number) => mm.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(await z(a), "raised above the others").toBeGreaterThan(Math.max(await z(b), await z(c)));
    expect(await bg(mm, a)).toBe(DARK);
    // Pressing in the grid of another one does the same.
    await mm.sub(b).click({ position: { x: 10, y: 350 } });
    await expect(mm.sub(b)).toHaveAttribute("aria-current", "true");
    await expect(mm.row(b)).toHaveAttribute("aria-selected", "true");
    expect(await z(b)).toBeGreaterThan(await z(a));
  });

  test("CHK2-E3 Minimize hides the frame, shows the pill in the bar, the sidebar marker, activates the next; the pill restores", async ({
    mm,
  }) => {
    await mm.open({ polls: polls(3) });
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(500);
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    await expect(mm.minimizedBar).toHaveCount(0);
    await mm.titleButton(c, "Minimize").click();
    await expect(mm.sub(c)).toHaveCount(0);
    await expect(mm.minimizedBar).toBeVisible();
    await expect(mm.minimizedBar).toContainText("Minimized");
    const pill = mm.minimizedBar.getByRole("button", { name: /^Poll 3 · Live/ });
    await expect(pill).toBeVisible();
    await expect(pill.locator("[data-icon]")).toHaveCount(1);
    await expect(mm.row(c)).toContainText("minimized");
    // The next sub-window by z-order (the one below it) became active.
    await expect(mm.sub(b)).toHaveAttribute("aria-current", "true");
    await pill.click();
    await expect(mm.sub(c)).toBeVisible();
    await expect(mm.sub(c)).toHaveAttribute("aria-current", "true");
    await expect(mm.minimizedBar).toHaveCount(0);
    await expect(mm.row(c)).not.toContainText("minimized");
    await expect(mm.sub(a)).toBeVisible();
  });

  test("CHK2-E4 Maximize fills the tile area (above the minimized bar); double click restores; another poll from the sidebar swaps the maximized one", async ({
    mm,
  }) => {
    await mm.open({ polls: polls(3) });
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    const ws = await mm.workspaceSize();
    const before = await mm.domRect(a);
    await mm.titleButton(a, "Maximize").click();
    await expect(mm.sub(a)).toHaveAttribute("data-state", "maximized");
    await mm.expectDomRect(a, { x: 8, y: 8, width: ws.width - 16, height: ws.height - 16 });
    await expect(mm.titleButton(a, "Restore")).toBeVisible();
    // Double click on the title bar restores the previous rectangle.
    await mm.titleBar(a).dblclick({ position: { x: 60, y: 15 } });
    await expect(mm.sub(a)).toHaveAttribute("data-state", "normal");
    await mm.expectDomRect(a, before);
    // With a minimized bar the maximized frame stops above it (bar 44 px + 8 px gap).
    await mm.row(c).click();
    await mm.titleButton(c, "Minimize").click();
    await expect(mm.minimizedBar).toBeVisible();
    await mm.titleButton(a, "Maximize").click();
    await mm.expectDomRect(a, { x: 8, y: 8, width: ws.width - 16, height: ws.height - 16 - 52 });
    const bar = await mm.minimizedBar.boundingBox();
    const frame = await mm.sub(a).boundingBox();
    expect((frame?.y ?? 0) + (frame?.height ?? 0), "frame ends above the bar").toBeLessThanOrEqual(bar?.y ?? 0);
    // Clicking B in the sidebar shows B maximized and A at its normal rectangle.
    await mm.row(b).click();
    await expect(mm.sub(b)).toHaveAttribute("data-state", "maximized");
    await expect(mm.sub(a)).toHaveAttribute("data-state", "normal");
    await mm.expectDomRect(a, before);
  });

  test("CHK2-E5 Tile with 4 sub-windows in a 1316 x 700 area gives the DES-002 vectors and turns tile mode on", async ({
    mm,
  }) => {
    await mm.open({ polls: polls(4) });
    await mm.sizeWorkspaceTo(REF_AREA.width + 16, REF_AREA.height + 16);
    const ids = await mm.pollIds();
    await mm.windowMenu("Tile");
    const want = [
      { x: 8, y: 8, width: 654, height: 346 },
      { x: 670, y: 8, width: 654, height: 346 },
      { x: 8, y: 362, width: 654, height: 346 },
      { x: 670, y: 362, width: 654, height: 346 },
    ];
    for (const [i, id] of ids.entries()) {
      await mm.expectDomRect(id, want[i] as never);
      await mm.expectStoredRect(id, want[i] as never);
    }
    await expect(mm.tileIndicator).toBeVisible();
    await expect(mm.tileIndicator).toContainText("Tile mode");
    await mm.openMenu("Window");
    await expect(mm.menuItem("Tile mode", "menuitemcheckbox")).toHaveAttribute("aria-checked", "true");
  });

  test("CHK2-E5 Tile with 3 sub-windows: the last row shares the full width", async ({ mm }) => {
    await mm.open({ polls: polls(3) });
    await mm.sizeWorkspaceTo(REF_AREA.width + 16, REF_AREA.height + 16);
    const ids = await mm.pollIds();
    await mm.windowMenu("Tile");
    const want = [
      { x: 8, y: 8, width: 654, height: 346 },
      { x: 670, y: 8, width: 654, height: 346 },
      { x: 8, y: 362, width: 1316, height: 346 },
    ];
    for (const [i, id] of ids.entries()) await mm.expectDomRect(id, want[i] as never);
  });

  test("CHK2-E6 Tile with 13 sub-windows: 12 tiled at 323 x 228, one cascaded at (8, 8), with the toast", async ({
    mm,
  }) => {
    await mm.open({ polls: polls(13) });
    await mm.sizeWorkspaceTo(REF_AREA.width + 16, REF_AREA.height + 16);
    const ids = await mm.pollIds();
    await mm.windowMenu("Tile");
    await expect(mm.toast("1 window did not fit and was cascaded.")).toBeVisible();
    for (const id of ids.slice(0, 12)) await expect.poll(() => mm.domRect(id)).toMatchObject({ width: 323, height: 228 });
    await mm.expectDomRect(ids[12] as number, { x: 8, y: 8, width: 323, height: 228 });
    // 4 columns x 3 rows, no remainder pixels (DES-002 WT-3).
    await mm.expectDomRect(ids[0] as number, { x: 8, y: 8 });
    await mm.expectDomRect(ids[3] as number, { x: 8 + 3 * (323 + 8), y: 8 });
    await mm.expectDomRect(ids[11] as number, { x: 8 + 3 * (323 + 8), y: 8 + 2 * (228 + 8) });
  });

  test("CHK2-E7 Cascade with 3: (8,8) (32,32) (56,56) at 640 x 368, tile mode off, the last in list order on top", async ({
    mm,
  }) => {
    await mm.open({ polls: polls(3) });
    await mm.sizeWorkspaceTo(REF_AREA.width + 16, REF_AREA.height + 16);
    const ids = (await mm.pollIds()) as number[];
    await mm.windowMenu("Tile");
    await expect(mm.tileIndicator).toBeVisible();
    await mm.windowMenu("Cascade");
    await expect(mm.tileIndicator).toHaveCount(0);
    for (const [i, id] of ids.entries()) {
      await mm.expectDomRect(id, { x: 8 + 24 * i, y: 8 + 24 * i, width: 640, height: 368 });
    }
    await expect.poll(async () => {
      const z = await Promise.all(ids.map(async (id) => (await mm.storedRect(id))?.z ?? 0));
      return (z[2] ?? 0) > (z[1] ?? 0) && (z[1] ?? 0) > (z[0] ?? 0);
    }).toBe(true);
    await mm.openMenu("Window");
    await expect(mm.menuItem("Tile mode", "menuitemcheckbox")).toHaveAttribute("aria-checked", "false");
  });

  test("CHK2-E8 Arrange minimized sorts the pills by list order; Minimize all and Restore all", async ({ mm }) => {
    await mm.open({ polls: polls(4) });
    const [a, b, c, d] = (await mm.pollIds()) as [number, number, number, number];
    for (const id of [c, a, d]) await mm.titleButton(id, "Minimize").click();
    const pills = mm.minimizedBar.getByRole("button", { name: /^Poll \d/ });
    await expect(pills).toHaveCount(3);
    await expect(pills.nth(0)).toContainText("Poll 3");
    await expect(pills.nth(1)).toContainText("Poll 1");
    await expect(pills.nth(2)).toContainText("Poll 4");
    await mm.windowMenu("Arrange minimized");
    await expect(pills.nth(0)).toContainText("Poll 1");
    await expect(pills.nth(1)).toContainText("Poll 3");
    await expect(pills.nth(2)).toContainText("Poll 4");
    await mm.windowMenu("Minimize all");
    await expect(pills).toHaveCount(4);
    await expect(mm.workspace.locator("[data-subwindow]")).toHaveCount(0);
    await mm.windowMenu("Restore all");
    await expect(mm.minimizedBar).toHaveCount(0);
    for (const id of [a, b, c, d]) await expect(mm.sub(id)).toHaveAttribute("data-state", "normal");
  });

  test("CHK2-E8 Window menu entries are enabled as in DES-002 2.7", async ({ mm, page }) => {
    await mm.open();
    const enabled = async (label: string, role: "menuitem" | "menuitemcheckbox" = "menuitem") =>
      (await mm.menuItem(label, role).getAttribute("aria-disabled")) !== "true";
    // No sub-window at all.
    await mm.openMenu("Window");
    for (const label of ["Tile", "Cascade", "Arrange minimized", "Minimize all", "Restore all", "Popped-out windows", "Next sub-window", "Previous sub-window"]) {
      expect(await enabled(label), `${label} with no sub-window`).toBe(false);
    }
    expect(await enabled("Collapse setup panels", "menuitemcheckbox")).toBe(true);
    await page.keyboard.press("Escape");
    // One visible sub-window.
    await mm.addPolls([{ name: "Poll 1" }]);
    await mm.openMenu("Window");
    for (const label of ["Tile", "Cascade", "Minimize all"]) expect(await enabled(label), `${label} with one`).toBe(true);
    for (const label of ["Arrange minimized", "Restore all", "Next sub-window", "Previous sub-window"]) {
      expect(await enabled(label), `${label} with one`).toBe(false);
    }
    await page.keyboard.press("Escape");
    // Two, one of them minimized.
    await mm.addPolls([{ name: "Poll 2" }]);
    const [a] = await mm.pollIds();
    await mm.titleButton(a as number, "Minimize").click();
    await mm.openMenu("Window");
    for (const label of ["Tile", "Cascade", "Minimize all", "Arrange minimized", "Restore all"]) {
      expect(await enabled(label), `${label} with two, one minimized`).toBe(true);
    }
    await page.keyboard.press("Escape");
  });

  test("CHK2-E9 Ctrl+F6 / Ctrl+Shift+F6 cycle in poll LIST order (wrap, minimized skipped), raise and focus the grid; the Window menu lists list order", async ({
    mm,
    page,
  }) => {
    // P1-P4 as sub-windows; z-order P1 (front) > P3 > P4 > P2 (back); P4 minimized.
    await mm.open({
      connected: true,
      polls: polls(4),
      seed: LAYOUT_SEED,
      seedArg: {
        items: [
          { index: 0, x: 8, y: 8, z: 4 },
          { index: 1, x: 120, y: 60, z: 1 },
          { index: 2, x: 240, y: 110, z: 3 },
          { index: 3, x: 360, y: 160, z: 2, state: "minimized" },
        ],
        minimizedOrder: [3],
      },
    });
    const [a, b, c, d] = (await mm.pollIds()) as [number, number, number, number];
    // The list is reordered to [P3, P1, P4, P2].
    await mm.script((f, ids) => f.reorderPolls([ids[2], ids[0], ids[3], ids[1]]), [a, b, c, d]);
    await expect(mm.pollList.getByRole("option").first()).toContainText("Poll 3");
    await expect(mm.sub(d)).toHaveCount(0);
    await mm.row(a).click();
    await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
    const z = async (id: number) => mm.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(await z(b), "P2 is at the back before the first Ctrl+F6").toBeLessThan(await z(c));

    await page.keyboard.press("Control+F6");
    await expect(mm.sub(b), "P4 is skipped: P1 -> P2").toHaveAttribute("aria-current", "true");
    expect(await z(b), "P2 comes to the front").toBeGreaterThan(Math.max(await z(a), await z(c)));
    await expect(mm.grid(b), "its data grid has the focus").toBeFocused();
    await page.keyboard.press("Control+F6");
    await expect(mm.sub(c), "wraps from the last (P2) to the first (P3)").toHaveAttribute("aria-current", "true");
    await expect(mm.grid(c)).toBeFocused();
    await page.keyboard.press("Control+Shift+F6");
    await expect(mm.sub(b), "Ctrl+Shift+F6 from P3 goes to P2").toHaveAttribute("aria-current", "true");
    await expect(mm.grid(b)).toBeFocused();

    // The Window menu lists the list order with a check on the active one and the markers.
    await mm.openMenu("Window");
    const items = page.getByRole("menuitemcheckbox", { name: /^\d /});
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveAccessibleName("1 Poll 3");
    await expect(items.nth(1)).toHaveAccessibleName("2 Poll 1");
    await expect(items.nth(2)).toHaveAccessibleName("3 Poll 4 (minimized)");
    await expect(items.nth(3)).toHaveAccessibleName("4 Poll 2");
    await expect(items.nth(3)).toHaveAttribute("aria-checked", "true");
    await expect(items.nth(0)).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");

    // With only one visible sub-window Next and Previous are disabled.
    await mm.titleButton(a, "Minimize").click();
    await mm.titleButton(c, "Minimize").click();
    await expect(mm.workspace.locator("[data-subwindow]")).toHaveCount(1);
    await mm.openMenu("Window");
    await expect(mm.menuItem("Next sub-window")).toHaveAttribute("aria-disabled", "true");
    await expect(mm.menuItem("Previous sub-window")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
  });

  test("CHK2-E9 Ctrl+F6 with a sub-window maximized shows the next one maximized (2.3.1)", async ({ mm, page }) => {
    await mm.open({ polls: polls(3) });
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    await mm.row(a).click();
    await mm.titleButton(a, "Maximize").click();
    await expect(mm.sub(a)).toHaveAttribute("data-state", "maximized");
    await page.keyboard.press("Control+F6");
    await expect(mm.sub(b)).toHaveAttribute("aria-current", "true");
    await expect(mm.sub(b)).toHaveAttribute("data-state", "maximized");
    await expect(mm.sub(a)).toHaveAttribute("data-state", "normal");
    void c;
  });

  test("CHK2-E9 the Window menu shows the markers: own window, minimized, closed", async ({ mm, page }) => {
    await mm.open({ polls: polls(3) });
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    await mm.row(b).click();
    await mm.titleButton(b, "Minimize").click();
    await mm.script((f, id) => f.popOutPoll(id, { kind: "rect", rect: { x: 10, y: 10, width: 600, height: 400 } }, null), a);
    await mm.script((f, id) => f.closePollView(id, true), c);
    await expect(mm.row(a)).toContainText("own window");
    await mm.openMenu("Window");
    await expect(page.getByRole("menuitemcheckbox", { name: "1 Poll 1 (own window)" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: "2 Poll 2 (minimized)" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: "3 Poll 3 (closed)" })).toBeVisible();
  });

  test("CHK2-E9 the active sub-window has the check mark in the Window menu", async ({ mm, page }) => {
    await mm.open({ polls: polls(3) });
    await mm.openMenu("Window");
    await expect(page.getByRole("menuitemcheckbox", { name: "3 Poll 3" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("menuitemcheckbox", { name: "1 Poll 1" })).toHaveAttribute("aria-checked", "false");
    await page.getByRole("menuitemcheckbox", { name: "1 Poll 1" }).click();
    await mm.openMenu("Window");
    await expect(page.getByRole("menuitemcheckbox", { name: "1 Poll 1" })).toHaveAttribute("aria-checked", "true");
  });

  test("CHK2-E10 shrinking W1 clamps every sub-window so 80 x 30 px of its title bar stays visible", async ({ mm }) => {
    await mm.open({
      polls: polls(3),
      seed: LAYOUT_SEED,
      seedArg: {
        items: [
          { index: 0, x: 1000, y: 600, width: 640, height: 368 },
          { index: 1, x: 8, y: 8 },
          { index: 2, x: -500, y: 300 },
        ],
      },
    });
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    await mm.sizeWorkspaceTo(900, 500);
    const ws = await mm.workspaceSize();
    await expect.poll(async () => (await mm.domRect(a)).x).toBeLessThanOrEqual(ws.width - 80);
    await expect.poll(async () => (await mm.domRect(a)).y).toBeLessThanOrEqual(ws.height - 30);
    const ra = await mm.domRect(a);
    const rc = await mm.domRect(c);
    expect(ra.x).toBe(ws.width - 80);
    expect(ra.y).toBe(ws.height - 30);
    expect(rc.x + rc.width, "left limit").toBeGreaterThanOrEqual(80);
    // A rectangle that was valid is not moved.
    await mm.expectDomRect(b, { x: 8, y: 8, width: 640, height: 368 });
    // The stored rectangle follows (the window reports it).
    await mm.expectStoredRect(a, { x: ws.width - 80, y: ws.height - 30 });
  });

  test("CHK2-E10 in tile mode shrinking W1 recomputes the tiles", async ({ mm }) => {
    await mm.open({ polls: polls(4) });
    await mm.sizeWorkspaceTo(REF_AREA.width + 16, REF_AREA.height + 16);
    const ids = (await mm.pollIds()) as number[];
    await mm.windowMenu("Tile");
    await mm.expectDomRect(ids[3] as number, { x: 670, y: 362, width: 654, height: 346 });
    // Area 984 x 484: 2 x 2 cells of 488 x 238.
    await mm.sizeWorkspaceTo(1000, 500);
    const want = [
      { x: 8, y: 8, width: 488, height: 238 },
      { x: 504, y: 8, width: 488, height: 238 },
      { x: 8, y: 254, width: 488, height: 238 },
      { x: 504, y: 254, width: 488, height: 238 },
    ];
    for (const [i, id] of ids.entries()) await mm.expectDomRect(id, want[i] as never);
  });

  test("CHK2-E11 empty workspace: all closed gives the 'not shown' text; popped-out polls add the second line", async ({
    mm,
  }) => {
    await mm.open({ polls: polls(3) });
    const ids = (await mm.pollIds()) as number[];
    for (const id of ids) await mm.script((f, i) => f.closePollView(i, true), id);
    await expect(mm.workspaceEmpty).toHaveText(
      "No poll is shown in the workspace. Click a poll in the list, or drag it here.",
    );
    await expect(mm.workspace).not.toContainText("open in their own window");
    // Two of them reopen in their own windows (host native).
    for (const id of ids.slice(0, 2)) {
      await mm.script((f, i) => f.showPoll(i), id);
      await mm.script((f, i) => f.popOutPoll(i, { kind: "rect", rect: { x: 10, y: 10, width: 600, height: 400 } }, null), id);
    }
    await expect(mm.workspaceEmpty).toHaveText(
      "No poll is shown in the workspace. Click a poll in the list, or drag it here.",
    );
    await expect(mm.workspace).toContainText("2 polls are open in their own windows.");
    await expect(mm.statusBar).toContainText("2 in their own windows");
  });

  // CHK2-E12 (revision 8): the setup presentation depends on the FRAME width (rectangle width, borders included).
  const E12_CASES: Array<{ width: number; dock: boolean }> = [
    { width: 900, dock: true },
    { width: 641, dock: true },
    { width: 640, dock: true },
    { width: 639, dock: false },
    { width: 600, dock: false },
  ];
  for (const c of E12_CASES) {
    test(`CHK2-E12 frame ${c.width}: the setup button opens the ${c.dock ? "300 px dock" : "360 px popover with [Done]"}`, async ({
      mm,
    }) => {
      await mm.open({
        polls: polls(2),
        seed: LAYOUT_SEED,
        seedArg: {
          items: [
            { index: 0, x: 8, y: 8, width: c.width, height: 420 },
            { index: 1, x: 8, y: 440, width: 700, height: 250 },
          ],
        },
      });
      const [a] = (await mm.pollIds()) as [number, number];
      await mm.row(a).click();
      await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
      expect((await mm.domRect(a)).width, "frame width as seeded").toBe(c.width);
      await mm.titleButton(a, /^Poll setup/).click();
      const surface = c.dock ? mm.setupDock(a) : mm.setupPopover(a);
      const other = c.dock ? mm.setupPopover(a) : mm.setupDock(a);
      await expect(surface).toBeVisible();
      await expect(other).toHaveCount(0);
      expect((await surface.boundingBox())?.width).toBeCloseTo(c.dock ? 300 : 360, 0);
      if (!c.dock) await expect(surface.getByRole("button", { name: "Done" })).toBeVisible();
      // The setup button toggles it closed again.
      await mm.titleButton(a, /^Poll setup/).click();
      await expect(surface).toHaveCount(0);
    });

    // The same frame width when the sub-window is INACTIVE (its border is thinner: 1.5 px in the design, 1 px as
    // Chromium draws it at 100% scale). The threshold is the frame element's offsetWidth, active or inactive
    // (revision 9, D-002-17): 640 -> dock, 639 -> popover, the border style never changes the presentation.
    test(`CHK2-E12 frame ${c.width} stays a ${c.dock ? "dock" : "popover"} when the sub-window becomes inactive and when it is activated again`, async ({
      mm,
    }) => {
      await mm.open({
        polls: polls(2),
        seed: LAYOUT_SEED,
        seedArg: {
          items: [
            { index: 0, x: 8, y: 8, width: c.width, height: 420 },
            { index: 1, x: 8, y: 440, width: 700, height: 250 },
          ],
        },
      });
      const [a, b] = (await mm.pollIds()) as [number, number];
      const offsetWidth = () => mm.sub(a).evaluate((el) => (el as HTMLElement).offsetWidth);
      const border = () => mm.sub(a).evaluate((el) => getComputedStyle(el).borderLeftWidth);
      await mm.row(a).click();
      await mm.titleButton(a, /^Poll setup/).click();
      const surface = c.dock ? mm.setupDock(a) : mm.setupPopover(a);
      const other = c.dock ? mm.setupPopover(a) : mm.setupDock(a);
      await expect(surface).toBeVisible();
      expect(await offsetWidth(), "active frame offsetWidth").toBe(c.width);
      const activeBorder = await border();
      await mm.row(b).click();
      await expect(mm.sub(a)).not.toHaveAttribute("aria-current", "true");
      const inactiveBorder = await border();
      expect(await offsetWidth(), `inactive frame offsetWidth (border ${activeBorder} active, ${inactiveBorder} inactive)`).toBe(c.width);
      expect((await mm.domRect(a)).width, "the frame width did not change").toBe(c.width);
      const presentation = () => mm.sub(a).locator('[data-slot="poll-view"]').getAttribute("data-presentation");
      await expect(
        surface,
        `inactive frame ${c.width} (offsetWidth ${c.width}, border ${inactiveBorder}): ${c.dock ? "dock" : "popover"} expected, presentation is ${await presentation()}`,
      ).toBeVisible();
      await expect(other).toHaveCount(0);
      // Activated again: still the same presentation, no change by the activation itself.
      await mm.row(a).click();
      await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
      expect(await offsetWidth(), "re-activated frame offsetWidth").toBe(c.width);
      await expect(surface, `re-activated frame ${c.width}: presentation is ${await presentation()}`).toBeVisible();
      await expect(other).toHaveCount(0);
    });
  }

  test("CHK2-E12 a new poll at the default size (frame 640 x 368; PollView body 636 px) opens with the dock, not the popover", async ({
    mm,
  }) => {
    await mm.open();
    await mm.toolbarButton("New poll").click();
    await expect(mm.row("Poll 1")).toBeVisible();
    const id = await mm.idOf("Poll 1");
    await mm.expectDomRect(id, { width: 640, height: 368 });
    await expect(mm.setupDock(id)).toBeVisible();
    await expect(mm.setupPopover(id)).toHaveCount(0);
    const body = await mm.sub(id).locator('[data-slot="poll-view"]').boundingBox();
    expect(body?.width, "the PollView body is narrower than the frame").toBeLessThan(640);
    expect(body?.width).toBeCloseTo(636, 0);
  });

  test("CHK2-E12 resizing from 640 to 639 (keyboard, 1 px) with an unapplied Quantity edit switches the dock to the popover and keeps the edit and the dot", async ({
    mm,
    page,
  }) => {
    await mm.open({ polls: polls(1), connected: true });
    const [a] = (await mm.pollIds()) as [number];
    await mm.titleButton(a, /^Poll setup/).click();
    await expect(mm.setupDock(a)).toBeVisible();
    await mm.setupField(a, "Quantity").fill("12");
    await expect(mm.titleBar(a).getByTestId("unapplied-dot")).toBeVisible();
    await mm.grid(a).focus();
    await page.keyboard.press("Control+Alt+Shift+ArrowLeft");
    await mm.expectDomRect(a, { width: 639 });
    await expect(mm.setupPopover(a), "popover at 639").toBeVisible();
    await expect(mm.setupDock(a)).toHaveCount(0);
    await expect(mm.setupField(a, "Quantity"), "the edit survived").toHaveValue("12");
    await expect(mm.titleBar(a).getByTestId("unapplied-dot")).toBeVisible();
    await expect(mm.setupPopover(a).getByTestId("unapplied-text")).toHaveText("Unapplied changes");
    // And back to 640: the dock returns, still with the edit.
    await mm.grid(a).focus();
    await page.keyboard.press("Control+Alt+Shift+ArrowRight");
    await mm.expectDomRect(a, { width: 640 });
    await expect(mm.setupDock(a)).toBeVisible();
    await expect(mm.setupField(a, "Quantity")).toHaveValue("12");
  });

  test("CHK2-E12 a live resize drag re-evaluates the presentation while the button is held", async ({ mm }) => {
    await mm.open({ polls: polls(1) });
    const [a] = (await mm.pollIds()) as [number];
    await mm.titleButton(a, /^Poll setup/).click();
    await expect(mm.setupDock(a)).toBeVisible();
    const handle = (await mm.sub(a).locator('[data-resize-handle="e"]').boundingBox()) as { x: number; y: number; width: number; height: number };
    const edge = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await mm.dragStart(edge, { x: edge.x - 10, y: edge.y }, 5);
    await expect.poll(async () => (await mm.domRect(a)).width, { message: "live width" }).toBe(630);
    await expect(mm.setupPopover(a), "popover while 630 px is held").toBeVisible();
    await expect(mm.setupDock(a)).toHaveCount(0);
    await mm.page.mouse.move(edge.x, edge.y, { steps: 5 });
    await expect.poll(async () => (await mm.domRect(a)).width).toBe(640);
    await expect(mm.setupDock(a), "dock again at 640 px").toBeVisible();
    await mm.release();
    await mm.expectStoredRect(a, { width: 640 });
  });

  test("CHK2-E12 popover: a click outside does not close it; Esc and [Done] do; an unapplied edit shows the dot and 'Unapplied changes'", async ({
    mm,
    page,
  }) => {
    await mm.open({
      polls: polls(2),
      seed: LAYOUT_SEED,
      seedArg: {
        items: [
          { index: 0, x: 8, y: 8, width: 900, height: 420 },
          { index: 1, x: 8, y: 440, width: 600, height: 300 },
        ],
      },
    });
    const [, b] = (await mm.pollIds()) as [number, number];
    await mm.titleButton(b, /^Poll setup/).click();
    const pop = mm.setupPopover(b);
    await expect(pop).toBeVisible();
    await expect(pop.getByRole("button", { name: "Done" })).toBeVisible();
    await mm.setupField(b, "Quantity").fill("12");
    await expect(mm.titleBar(b).getByTestId("unapplied-dot")).toBeVisible();
    await expect(pop.getByTestId("unapplied-text")).toHaveText("Unapplied changes");
    await mm.workspace.click({ position: { x: 1100, y: 600 } });
    await expect(pop).toBeVisible();
    await mm.setupField(b, "Quantity").press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(mm.titleBar(b).getByTestId("unapplied-dot")).toBeVisible();
    await mm.titleButton(b, /^Poll setup/).click();
    await expect(pop).toBeVisible();
    await pop.getByRole("button", { name: "Done" }).click();
    await expect(pop).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("CHK2-E13 narrow sub-window (< 720 px): 'Show' menu with Raw format, Address base, Alias column, Include alias in copy", async ({
    mm,
    page,
  }) => {
    await mm.open({
      polls: polls(2),
      seed: LAYOUT_SEED,
      seedArg: {
        items: [
          { index: 0, x: 8, y: 8, width: 640, height: 400 },
          { index: 1, x: 660, y: 8, width: 760, height: 400 },
        ],
      },
    });
    const [narrow, wide] = (await mm.pollIds()) as [number, number];
    const showButton = mm.statusLine(narrow).getByRole("button", { name: /^Show / });
    await expect(showButton).toBeVisible();
    await expect(mm.sub(narrow).getByRole("radiogroup")).toHaveCount(0);
    await showButton.click();
    const menu = page.getByRole("menu").last();
    for (const heading of ["Show", "Raw format", "Address base"]) await expect(menu.getByText(heading, { exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /^Raw/ }).first()).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: "Alias column" })).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: "Include alias in copy" })).toBeVisible();
    await page.keyboard.press("Escape");
    // The wide one shows the segmented controls and no menu.
    await expect(mm.sub(wide).getByRole("radiogroup", { name: "Show" })).toBeVisible();
    await expect(mm.sub(wide).getByRole("radiogroup", { name: "Raw format" })).toBeVisible();
    await expect(mm.sub(wide).getByRole("radiogroup", { name: "Address base" })).toBeVisible();
    await expect(mm.statusLine(wide).getByRole("button", { name: /^Show / })).toHaveCount(0);
  });

  test("CHK2-E15 a delayed attach snapshot shows 'Loading poll…' and 'Loading…', then the real state", async ({ mm }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.expectConnection("connected");
    // The reply of the next attach waits; its effects run (the view is registered).
    await mm.script((f) => {
      (window as unknown as { __release: () => void }).__release = f.holdReply("attachPollView").release;
    });
    await mm.toolbarButton("New poll").click();
    await expect(mm.row("Poll 1")).toBeVisible();
    const id = await mm.idOf("Poll 1");
    await expect(mm.sub(id)).toContainText("Loading poll…");
    await expect(mm.statusLine(id)).toContainText("Loading…");
    await mm.page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect(mm.sub(id)).not.toContainText("Loading poll…");
    await expect(mm.statusLine(id)).not.toContainText("Loading…");
    await expect(mm.statusLine(id)).toContainText(/Waiting|Polling|Paused/);
  });

  test("CHK2-E14 (UI side) a window that starts with a stored layout mounts every sub-window as stored, with values, not Modified", async ({
    mm,
  }) => {
    await mm.open({
      polls: STANDARD_8.slice(0, 4),
      seed: async (f, a, ids) => {
        f.setMode("virtual");
        await f.connect({ mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 });
        f.advance(500);
        const base = f.snapshot().workspaceLayout;
        f.setWorkspaceLayout({
          ...base,
          minimizedOrder: [ids[2]],
          items: [
            { pollId: ids[0], rect: { x: 40, y: 50, width: 500, height: 300, z: 3, state: "normal", restore: null } },
            { pollId: ids[1], rect: { x: 300, y: 120, width: 600, height: 340, z: 4, state: "normal", restore: null } },
            { pollId: ids[2], rect: { x: 100, y: 100, width: 640, height: 368, z: 1, state: "minimized", restore: null } },
            { pollId: ids[3], rect: { x: 8, y: 8, width: 1316, height: 640, z: 2, state: "maximized", restore: { x: 20, y: 20, width: 640, height: 368 } } },
          ],
        });
        void a;
      },
    });
    const [a, b, c, d] = (await mm.pollIds()) as [number, number, number, number];
    await mm.expectConnection("connected");
    await mm.expectDomRect(a, { x: 40, y: 50, width: 500, height: 300 });
    await mm.expectDomRect(b, { x: 300, y: 120, width: 600, height: 340 });
    await expect(mm.sub(c)).toHaveCount(0);
    await expect(mm.minimizedBar).toContainText("Poll 3");
    await expect(mm.sub(d)).toHaveAttribute("data-state", "maximized");
    // z-order: B in front, then A, then the maximized D.
    const z = async (id: number) => mm.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(await z(b)).toBeGreaterThan(await z(a));
    expect(await z(a)).toBeGreaterThan(await z(d));
    // Values are there at once (no "Waiting for first response…") and the profile is not Modified.
    await expect(mm.grid(a)).toHaveAttribute("data-status", "live");
    await expect(mm.sub(a)).not.toContainText("Waiting for first response");
    expect(await mm.modified()).toBe(false);
  });

  test("CHK2-E14 (UI side, reload) with ?fakePersist a reload re-attaches every sub-window at the same rectangle, state and z-order, without Modified", async ({
    mm,
    page,
  }) => {
    // Hook: the fake keeps polls, hosts, rectangles, layout and preferences in sessionStorage (not the link, values or counters).
    await mm.open({ route: "/tools/modbus-master?fakePersist" });
    const [a, b, c] = await mm.addPolls(polls(3));
    await mm.dragTitle(a as number, 120, 90);
    await mm.release();
    await mm.expectStoredRect(a as number, { x: 128, y: 98 });
    await mm.titleButton(c as number, "Minimize").click();
    await mm.expectStoredRect(c as number, { state: "minimized" });
    await mm.sub(b as number).click({ position: { x: 10, y: 150 } });
    await mm.titleButton(b as number, "Maximize").click();
    await mm.expectStoredRect(b as number, { state: "maximized" });
    const z = async (id: number) => mm.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));
    const before = {
      a: await mm.domRect(a as number),
      b: await mm.domRect(b as number),
      zOrder: (await z(a as number)) < (await z(b as number)),
      layout: await mm.layout(),
    };
    await page.reload();
    await expect(mm.toolbar.getByRole("button", { name: /^(Connect|Disconnect|Reconnect|Cancel)$/ }).first()).toBeEnabled({ timeout: 30_000 });
    await expect.poll(() => mm.pollIds()).toEqual([a, b, c]);
    await expect(mm.sub(a as number)).toBeVisible();
    await mm.expectDomRect(a as number, before.a);
    await expect(mm.sub(b as number)).toHaveAttribute("data-state", "maximized");
    await mm.expectDomRect(b as number, before.b);
    await expect(mm.sub(c as number)).toHaveCount(0);
    await expect(mm.minimizedBar).toContainText("Poll 3");
    expect((await z(a as number)) < (await z(b as number)), "z-order kept").toBe(before.zOrder);
    const after = await mm.layout();
    expect(after.items.map((i) => ({ id: i.pollId, state: i.rect.state, z: i.rect.z }))).toEqual(
      before.layout.items.map((i) => ({ id: i.pollId, state: i.rect.state, z: i.rect.z })),
    );
    expect(after.minimizedOrder).toEqual(before.layout.minimizedOrder);
    expect(await mm.modified(), "a reload is not a change").toBe(false);
    // What the fake does not keep: the link and the values.
    await mm.expectConnection("idle");
  });
});
