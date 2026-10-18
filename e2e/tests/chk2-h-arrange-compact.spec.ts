// CHK-002 section H: arrange popped-out windows (vectors NT-1..NT-3 through the fake with scripted
// monitors), the Popped-out windows menu states, compact mode. The real window placement is [WIN].
import { expect, LAYOUT_SEED, test, type Mm } from "../support/mm-fixtures";

interface Mon {
  id: string;
  label: string;
  name: string;
  primary: boolean;
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}
const MON1: Mon = {
  id: "\\\\.\\DISPLAY1",
  label: "Display 1",
  name: "\\\\.\\DISPLAY1",
  primary: true,
  workArea: { x: 0, y: 0, width: 1920, height: 1032 },
  scaleFactor: 1,
};
const MON2: Mon = {
  id: "\\\\.\\DISPLAY2",
  label: "Display 2",
  name: "\\\\.\\DISPLAY2",
  primary: false,
  workArea: { x: 1920, y: 0, width: 1920, height: 1032 },
  scaleFactor: 1,
};

/** Hook `linkMonitors`: ONE list is shared by the window IPC and the Modbus fake, so one assignment is enough. */
async function setMonitors(mm: Mm, monitors: Mon[]): Promise<void> {
  await mm.page.evaluate((m) => {
    window.__ESEFACT_FAKE_IPC__.monitors = m;
  }, monitors);
  expect(
    await mm.page.evaluate(() => window.__ESEFACT_FAKE_WINDOW_IPC__.monitors.map((x: { id: string }) => x.id)),
    "the window IPC sees the same monitors",
  ).toEqual(monitors.map((x) => x.id));
}

/** A connected window with `n` polls, all in their own windows, at these anchors (client px). */
async function withNatives(mm: Mm, n: number, anchors?: Array<{ x: number; y: number }>): Promise<number[]> {
  await mm.open({ polls: Array.from({ length: n }, (_, i) => ({ name: `Poll ${i + 1}` })) });
  const ids = await mm.pollIds();
  await mm.useVirtual();
  await mm.pressConnect({ autoStart: true });
  await mm.advance(300);
  await mm.script(
    async (f, a) => {
      for (const [i, id] of a.ids.entries()) {
        const at = a.anchors?.[i] ?? { x: 100 + i * 30, y: 100 + i * 30 };
        await f.popOutPoll(id, { kind: "rect", rect: { x: at.x, y: at.y, width: 600, height: 400 } }, null);
      }
    },
    { ids, anchors: anchors ?? null },
  );
  await expect(mm.statusBar).toContainText(n === 1 ? "1 in its own window" : `${n} in their own windows`);
  return ids;
}

async function placements(mm: Mm): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  return mm.script(async (f) => {
    const profile = await f.exportProfile("probe", null);
    return profile.polls.map((p: { view: { native: { x: number; y: number; width: number; height: number } } }) => {
      const n = p.view.native;
      return { x: n.x, y: n.y, width: n.width, height: n.height };
    });
  });
}

async function arrange(mm: Mm, label: string): Promise<void> {
  await mm.openMenu("Window");
  await mm.menuItem("Popped-out windows").click();
  await mm.menuItem(label).click();
}

test.describe("H arrange popped-out windows", () => {
  test("CHK2-H (hook) the window IPC and the Modbus fake share one monitor list, both directions", async ({ mm }) => {
    await mm.open();
    await setMonitors(mm, [MON1, MON2]);
    await mm.page.evaluate((m) => {
      window.__ESEFACT_FAKE_WINDOW_IPC__.monitors = [m];
    }, MON1);
    expect(await mm.page.evaluate(() => window.__ESEFACT_FAKE_IPC__.monitors.map((x: { id: string }) => x.id))).toEqual([MON1.id]);
  });

  test("CHK2-H1 (UI side) Tile with 4 windows on 1920 x 1032 gives 960 x 516 cells (NT-1)", async ({ mm }) => {
    await withNatives(mm, 4);
    await arrange(mm, "Tile");
    await mm.expectCalls("arrangePollWindows", 1);
    expect(await mm.lastCall("arrangePollWindows")).toEqual(["tile", { kind: "eachMonitor" }]);
    expect(await placements(mm)).toEqual([
      { x: 0, y: 0, width: 960, height: 516 },
      { x: 960, y: 0, width: 960, height: 516 },
      { x: 0, y: 516, width: 960, height: 516 },
      { x: 960, y: 516, width: 960, height: 516 },
    ]);
  });

  test("CHK2-H2 (UI side) Tile with 9 windows is 3 x 3 at 640 x 344; with 13, 12 tile at 480 x 344 and one cascades with the toast", async ({
    mm,
  }) => {
    await withNatives(mm, 9);
    await arrange(mm, "Tile");
    await mm.expectCalls("arrangePollWindows", 1);
    const nine = await placements(mm);
    expect(nine).toHaveLength(9);
    for (const [i, p] of nine.entries()) {
      expect(p).toEqual({ x: (i % 3) * 640, y: Math.floor(i / 3) * 344, width: 640, height: 344 });
    }
  });

  test("CHK2-H2 (UI side) 13 windows: 12 tiled at 480 x 344, one cascaded, toast", async ({ mm }) => {
    await withNatives(mm, 13);
    await arrange(mm, "Tile");
    await expect(mm.toast("1 window did not fit and was cascaded.")).toBeVisible();
    const p = await placements(mm);
    for (const [i, r] of p.slice(0, 12).entries()) {
      expect(r).toEqual({ x: (i % 4) * 480, y: Math.floor(i / 4) * 344, width: 480, height: 344 });
    }
    expect(p[12]).toMatchObject({ x: 0, y: 0, width: 480, height: 344 });
  });

  test("CHK2-H3 (UI side) Side by side, Stacked and Cascade with 3 windows", async ({ mm }) => {
    await withNatives(mm, 3);
    await arrange(mm, "Side by side");
    await mm.expectCalls("arrangePollWindows", 1);
    expect(await placements(mm)).toEqual([
      { x: 0, y: 0, width: 640, height: 1032 },
      { x: 640, y: 0, width: 640, height: 1032 },
      { x: 1280, y: 0, width: 640, height: 1032 },
    ]);
    await arrange(mm, "Stacked");
    await mm.expectCalls("arrangePollWindows", 2);
    expect(await placements(mm)).toEqual([
      { x: 0, y: 0, width: 1920, height: 344 },
      { x: 0, y: 344, width: 1920, height: 344 },
      { x: 0, y: 688, width: 1920, height: 344 },
    ]);
    await arrange(mm, "Cascade");
    await mm.expectCalls("arrangePollWindows", 3);
    expect(await placements(mm)).toEqual([
      { x: 0, y: 0, width: 900, height: 640 },
      { x: 24, y: 24, width: 900, height: 640 },
      { x: 48, y: 48, width: 900, height: 640 },
    ]);
  });

  test("CHK2-H4 (UI side) two monitors: 'Each monitor (in place)' tiles each pair on its own display; 'Display 2' moves all four there", async ({
    mm,
  }) => {
    await withNatives(mm, 4, [
      { x: 100, y: 100 },
      { x: 400, y: 200 },
      { x: 2000, y: 100 },
      { x: 2400, y: 200 },
    ]);
    await setMonitors(mm, [MON1, MON2]);
    await arrange(mm, "Tile");
    await mm.expectCalls("arrangePollWindows", 1);
    expect(await placements(mm)).toEqual([
      { x: 0, y: 0, width: 960, height: 1032 },
      { x: 960, y: 0, width: 960, height: 1032 },
      { x: 1920, y: 0, width: 960, height: 1032 },
      { x: 2880, y: 0, width: 960, height: 1032 },
    ]);
    // Choose "Display 2" and tile again: all four on monitor 2 in 2 x 2.
    await mm.openMenu("Window");
    await mm.menuItem("Popped-out windows").click();
    await expect(mm.menuItem("Each monitor (in place)", "menuitemradio")).toHaveAttribute("aria-checked", "true");
    await expect(mm.menuItem("Display 1 (primary)", "menuitemradio")).toBeVisible();
    await mm.menuItem("Display 2", "menuitemradio").click();
    await arrange(mm, "Tile");
    await mm.expectCalls("arrangePollWindows", 2);
    expect((await mm.lastCall("arrangePollWindows"))?.[1]).toEqual({ kind: "monitor", monitorId: MON2.id });
    expect(await placements(mm)).toEqual([
      { x: 1920, y: 0, width: 960, height: 516 },
      { x: 2880, y: 0, width: 960, height: 516 },
      { x: 1920, y: 516, width: 960, height: 516 },
      { x: 2880, y: 516, width: 960, height: 516 },
    ]);
  });

  test("CHK2-H5 (UI side) 'Display 2' chosen, monitor 2 unplugged: toast, target returns to 'Each monitor (in place)'", async ({
    mm,
  }) => {
    await withNatives(mm, 2);
    await setMonitors(mm, [MON1, MON2]);
    await mm.openMenu("Window");
    await mm.menuItem("Popped-out windows").click();
    await mm.menuItem("Display 2", "menuitemradio").click();
    await setMonitors(mm, [MON1]);
    await arrange(mm, "Tile");
    await expect(mm.toast("That display is no longer connected.")).toBeVisible();
    await expect(mm.toasts.filter({ hasText: "That display is no longer connected." })).toHaveAttribute("data-tone", "error");
    await mm.openMenu("Window");
    await mm.menuItem("Popped-out windows").click();
    await expect(mm.menuItem("Each monitor (in place)", "menuitemradio")).toHaveAttribute("aria-checked", "true");
    await expect(mm.menuItem("Display 2", "menuitemradio")).toHaveCount(0);
  });

  test("CHK2-H6 no native window: 'Popped-out windows' is disabled with its title", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await mm.openMenu("Window");
    const item = mm.menuItem("Popped-out windows");
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toHaveAttribute("title", "No poll is open in its own window.");
    await expect(mm.menuItem("Bring popped-out windows to front")).toHaveAttribute("aria-disabled", "true");
  });

  test("CHK2-H6 a single native window fills the work area when tiled from its own menu", async ({ mm }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await w2.page.getByRole("button", { name: "Poll window menu" }).click();
    await w2.page.getByRole("menuitem", { name: /^Arrange poll windows/ }).click();
    await w2.page.getByRole("menuitem", { name: /^Tile/ }).click();
    await w2.expectCalls("arrangePollWindows", 1);
    const native = await w2.script(async (f) => {
      const p = await f.exportProfile("probe", null);
      return p.polls[0].view.native;
    });
    expect(native).toMatchObject({ x: 0, y: 0, width: 1920, height: 1032 });
  });

  test("CHK2-H6 race: the only native window is gone when the command runs: toast 'No poll is open in its own window.'", async ({
    mm,
  }) => {
    await withNatives(mm, 1);
    await mm.script((f) => f.setResult("arrangePollWindows", { arranged: 0, overflow: 0 }));
    await arrange(mm, "Tile");
    await expect(mm.toast("No poll is open in its own window.")).toBeVisible();
  });
});

test.describe("H compact mode", () => {
  const WIDE = {
    items: [
      { index: 0, x: 8, y: 8, width: 900, height: 330 },
      { index: 1, x: 8, y: 350, width: 900, height: 330 },
      { index: 2, x: 920, y: 8, width: 380, height: 330 },
    ],
  };
  const polls = [{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }];
  const dock = (mm: Mm, id: number) => mm.setupDock(id);

  test("CHK2-H7 compact: the sidebar becomes a rail with one icon per poll, every dock closes, Ctrl+\\ opens one dock, toggling off restores", async ({
    mm,
    page,
  }) => {
    await mm.open({ polls, seed: LAYOUT_SEED, seedArg: WIDE });
    const [a, b] = (await mm.pollIds()) as [number, number, number];
    await mm.titleButton(a, /^Poll setup/).click();
    await mm.titleButton(b, /^Poll setup/).click();
    await expect(dock(mm, a)).toBeVisible();
    await expect(dock(mm, b)).toBeVisible();
    await expect(mm.sidebar).toBeVisible();

    await mm.titleBar(a).focus();
    await page.keyboard.press("Control+Shift+Backslash");
    await mm.expectCalls("setCompactMode", 1);
    expect(await mm.lastCall("setCompactMode")).toEqual([true]);
    await expect(mm.rail).toBeVisible();
    await expect(mm.sidebar).toBeHidden();
    const icons = mm.rail.locator('[data-slot="rail-icon"]');
    await expect(icons).toHaveCount(3);
    await expect(icons.nth(0)).toHaveAttribute("aria-label", "Poll 1: Offline");
    await expect(icons.nth(0)).toHaveAttribute("title", "Poll 1: Offline");
    await expect(dock(mm, a)).toHaveCount(0);
    await expect(dock(mm, b)).toHaveCount(0);
    // Ctrl+\ in one sub-window opens only its dock.
    await mm.titleBar(a).focus();
    await page.keyboard.press("Control+Backslash");
    await expect(dock(mm, a)).toBeVisible();
    await expect(dock(mm, b)).toHaveCount(0);
    // Toggle off from the Window menu: the previous presentation returns.
    await mm.windowMenu("Collapse setup panels", "menuitemcheckbox");
    expect(await mm.lastCall("setCompactMode")).toEqual([false]);
    await expect(mm.sidebar).toBeVisible();
    await expect(mm.rail).toHaveCount(0);
    await expect(dock(mm, a)).toBeVisible();
    await expect(dock(mm, b), "the dock that was open before compact mode comes back").toBeVisible();
  });

  test("CHK2-H7 a native window: compact turns the setup panel into the 30 px rail (⋯ menu)", async ({ mm }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await expect(w2.setupPanel).toBeVisible();
    await w2.page.getByRole("button", { name: "Poll window menu" }).click();
    await w2.page.getByRole("menuitemcheckbox", { name: /^Collapse setup panels/ }).click();
    await w2.expectCalls("setCompactMode", 1);
    await expect(w2.rail).toBeVisible();
    await expect(w2.setupPanel).toHaveCount(0);
    expect((await w2.rail.boundingBox())?.width).toBeCloseTo(30, 0);
    // Ctrl+Shift+\ toggles it back.
    await w2.page.keyboard.press("Control+Shift+Backslash");
    await expect(w2.setupPanel).toBeVisible();
  });

  test("CHK2-H8 compact and tile mode do not mark Modified, are saved in the profile and come back when it is opened", async ({
    mm,
    page,
  }) => {
    await mm.open({ polls: polls.slice(0, 3) });
    await mm.hostField.fill("127.0.0.1");
    await mm.portField.fill("5020");
    // Save as "Layout test" (the file now holds the connection and the polls).
    await mm.openMenu("File");
    await mm.menuItem("Save as…").click();
    await mm.saveAsDialog.getByLabel("Name").fill("Layout test");
    await mm.saveAsDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mm.profileLabel).toContainText("Layout test");
    expect(await mm.modified()).toBe(false);
    // Layout changes: not Modified.
    await mm.windowMenu("Tile");
    await page.keyboard.press("Control+Shift+Backslash");
    await expect(mm.rail).toBeVisible();
    await expect(mm.tileIndicator).toBeVisible();
    expect(await mm.modified(), "compact and tile mode are not edits").toBe(false);
    // Save: the file keeps both.
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await mm.calls("profilesSave")).length).toBeGreaterThanOrEqual(2);
    const saved = (await mm.lastCall("profilesSave")) as [{ workspace: { compact: boolean; tileMode: boolean } }, boolean];
    expect(saved[0].workspace).toMatchObject({ compact: true, tileMode: true });
    // Back to the defaults, then open the profile: both return, still not Modified.
    await page.keyboard.press("Control+Shift+Backslash");
    await mm.windowMenu("Tile mode", "menuitemcheckbox");
    await expect(mm.rail).toHaveCount(0);
    await expect(mm.tileIndicator).toHaveCount(0);
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await mm.openDialog.getByRole("row", { name: /Layout test/ }).dblclick();
    await expect(mm.openDialog).toHaveCount(0);
    await expect(mm.rail).toBeVisible();
    await expect(mm.tileIndicator).toBeVisible();
    expect(await mm.modified()).toBe(false);
  });
});
