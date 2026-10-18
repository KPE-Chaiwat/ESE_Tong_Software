// Integration mode (REPORT-006), priority (a): the real app starts, the launcher offers Modbus Master,
// Open creates a real W1, New poll works, native titles are real. CHK2-A1, A2 (idle part), B1.
import { expect, openModbusWindow, RealMm, test } from "../integration/fixtures";
import { monitorsPx } from "../integration/desktop";
import { LOGICAL_OFFSET } from "../integration/helpers";

test.describe("(a) smoke", () => {
  test("INT-A-1 app starts, launcher shows the Modbus Master card, native launcher window exists", async ({ desktop, launcher }) => {
    await expect(launcher.getByRole("heading", { name: "ESEfact" })).toBeVisible();
    const card = launcher.getByTestId("tool-card-modbus-master");
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(desktop.windows().map((w) => w.title)).toContain("ESEfact");
    expect(desktop.log.filter((l) => /panic|error/i.test(l)), "app stdout/stderr has no panic or error").toEqual([]);
  });

  test("CHK2-A1 Open creates a real W1: Untitled, Not connected, empty texts, collapsed traffic, offset 24 logical px, native title", async ({
    desktop,
    launcher,
  }) => {
    const before = desktop.windows();
    const launcherWin = before.find((w) => w.title === "ESEfact");
    expect(launcherWin, "launcher window").toBeTruthy();
    const dpr = await launcher.evaluate(() => window.devicePixelRatio);

    const mm = await openModbusWindow(desktop, launcher);
    await mm.expectPill("Not connected", "plug");
    await expect(mm.page.getByRole("heading", { name: /^Polls · 0 of 16$/i })).toBeVisible();
    await expect(mm.sidebar).toContainText("No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection.");
    await expect(mm.workspaceEmpty).toContainText("No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection.");
    await expect(mm.workspace.getByRole("button", { name: /New poll/ })).toBeVisible();
    await expect(mm.summaryChip).toHaveCount(0);
    await expect(mm.traffic).toHaveCount(0); // collapsed: only the bar
    await expect(mm.trafficBar).toBeVisible();
    await expect(mm.page).toHaveTitle("Modbus Master - Untitled - Not connected");
    await expect.poll(() => desktop.windows().map((w) => w.title), { message: "native title" }).toContain("Modbus Master - Untitled - Not connected");

    const win = desktop.windows().find((w) => w.title === "Modbus Master - Untitled - Not connected");
    const lw = desktop.windows().find((w) => w.title === "ESEfact");
    expect(win && lw ? win.rect.x - lw.rect.x : null, "x offset in physical px").toBeCloseTo(LOGICAL_OFFSET * dpr, 0);
    // REPORT-007: since D-002-22 / CHK2-A7 the W1 is clamped to the work area, so the 24 px cascade applies only while the visible
    // frame still fits; otherwise the visible bottom edge sits on the work area bottom (nothing under the taskbar).
    const wa = monitorsPx().find((m) => m.primary)?.work;
    const unclampedBottom = (lw?.rect.y ?? 0) + Math.round(LOGICAL_OFFSET * dpr) + ((win?.frame?.y ?? 0) - (win?.rect.y ?? 0)) + (win?.frame?.h ?? 0);
    if (wa && unclampedBottom > wa.y + wa.h) {
      expect((win?.frame?.y ?? 0) + (win?.frame?.h ?? 0), "clamped: visible bottom on the work area bottom (+-1 px)").toBeGreaterThanOrEqual(wa.y + wa.h - 1);
      expect((win?.frame?.y ?? 0) + (win?.frame?.h ?? 0), "clamped: not below the work area").toBeLessThanOrEqual(wa.y + wa.h + 1);
    } else {
      expect(win && lw ? win.rect.y - lw.rect.y : null, "y offset in physical px").toBeCloseTo(LOGICAL_OFFSET * dpr, 0);
    }
    // the default size: inner 1280 x 800 logical
    expect(win?.client.w, "client width px").toBe(Math.round(1280 * dpr));
    // CHK2-A7: the height is reduced only as far as the work area needs (visible frame inside the work area); never enlarged
    expect(win?.client.h ?? 0, "client height px (at most 800 logical)").toBeLessThanOrEqual(Math.round(800 * dpr));
    if (wa) expect((win?.frame?.y ?? 0) + (win?.frame?.h ?? 0), "visible bottom edge inside the work area (+1 px DWM tolerance)").toBeLessThanOrEqual(wa.y + wa.h + 1);
    expect(mm.pageErrors).toEqual([]);
  });

  test("CHK2-A2 idle: New poll creates 'Poll 1' (Offline / No connection) as an active sub-window at (8, 8, 640, 368) with the setup dock", async ({ mm }) => {
    await mm.toolbarButton("New poll").click();
    await expect(mm.row("Poll 1")).toBeVisible();
    const id = await mm.idByName("Poll 1");
    await expect(mm.sub(id)).toBeVisible();
    await expect(mm.sub(id)).toHaveAttribute("data-active", "true");
    await mm.expectDomRect(id, { x: 8, y: 8, width: 640, height: 368 });
    await expect(mm.setupDock(id)).toBeVisible();
    await expect(mm.setupPopover(id)).toHaveCount(0);
    expect((await mm.setupDock(id).boundingBox())?.width).toBeCloseTo(300, 0);
    const name = mm.setupField(id, "Name");
    await expect(name).toBeFocused();
    expect(await name.evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length), "Name text selected").toBe(true);
    await expect(mm.row(id)).toContainText("Offline");
    await expect(mm.statusLine(id)).toContainText("Offline");
    await expect(mm.statusLine(id)).toContainText("No connection");
    // the profile became Modified (D-002-12) and the native title says so
    await expect.poll(() => mm.page.title()).toBe("Modbus Master - Untitled * - Not connected");
    await expect.poll(async () => (await mm.statusBar.innerText()).replace(/\s+/g, " ")).toContain("1 poll");
  });

  test("CHK2-A1 Ctrl+N in W1 opens another real W1, offset 24 logical px from it", async ({ desktop, mm }) => {
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    const first = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    expect(first).toBeTruthy();
    const known = new Set(desktop.pages());
    await mm.page.keyboard.press("Control+n");
    await expect.poll(() => desktop.windows().filter((w) => w.title.startsWith("Modbus Master")).length).toBe(2);
    const second = desktop.windows().find((w) => w.title.startsWith("Modbus Master") && w.hwnd !== first?.hwnd);
    expect(second).toBeTruthy();
    expect((second?.rect.x ?? 0) - (first?.rect.x ?? 0)).toBeCloseTo(LOGICAL_OFFSET * dpr, 0);
    expect((second?.rect.y ?? 0) - (first?.rect.y ?? 0)).toBeCloseTo(LOGICAL_OFFSET * dpr, 0);
    const page2 = await desktop.newPage(known, (u) => /\/tools\/modbus-master(\/)?(\?|#|$)/.test(u));
    const app2 = new RealMm(page2);
    await expect(app2.toolbarButton("Connect")).toBeEnabled();
    await app2.expectPill("Not connected", "plug");
    await expect(page2).toHaveTitle("Modbus Master - Untitled - Not connected");
  });

  test("INT-A-2 W1 minimum size 960 x 600 logical: real OS resize drags (right edge, top edge) stop at the minimum", async ({ desktop, mm }) => {
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    const w = desktop.windows().find((x) => x.title.startsWith("Modbus Master"));
    expect(w).toBeTruthy();
    const hwnd = (w as { hwnd: number }).hwnd;
    const get = () => desktop.windows().find((x) => x.hwnd === hwnd);
    const r = (w as { rect: { x: number; y: number; w: number; h: number } }).rect;
    const f = (w as { frame: { x: number; y: number; w: number; h: number } }).frame;
    desktop.showWindow(hwnd, "focus");
    // right edge: grab inside the visible frame at the border, drag far to the left
    desktop.mouseDrag(f.x + f.w - 1, r.y + 500, r.x + 600, r.y + 500, 25, 20);
    await expect.poll(() => get()?.client.w ?? 0, { message: "client width shrank" }).toBeLessThan(Math.round(1280 * dpr));
    expect(get()?.client.w, "client width px at the minimum").toBe(Math.round(960 * dpr));
    // top edge: drag down
    desktop.mouseDrag(r.x + 400, r.y, r.x + 400, r.y + 700, 25, 20);
    await expect.poll(() => get()?.client.h ?? 0, { message: "client height shrank" }).toBeLessThan(Math.round(800 * dpr));
    expect(get()?.client.h, "client height px at the minimum").toBe(Math.round(600 * dpr));
    await expect(mm.pill).toBeVisible();
  });
});
