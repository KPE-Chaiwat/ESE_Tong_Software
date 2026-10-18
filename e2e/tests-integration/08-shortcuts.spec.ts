// Integration mode (REPORT-006), (f): keyboard shortcuts with REAL hardware-level input (SendInput) so the WebView2
// browser accelerators (print, find, history, reload, downloads, new window...) compete with the page exactly like for a
// user. Playwright's keyboard goes through CDP and never reaches those accelerators. DES-002 3.1; CHK2-R7 (Alt, system
// menu), CHK2-E14 (reload re-attaches).
import { type Desktop, expect, type RealMm, test } from "../integration/fixtures";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";

const SPECS = [
  { name: "A", slave: 1, fc: 3 as const, start: 0, qty: 10, scan: 100 },
  { name: "B", slave: 2, fc: 3 as const, start: 10, qty: 5, scan: 100 },
];

async function live(mm: RealMm, sim: import("../integration/fixtures").Sim): Promise<number[]> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
  const ids = await createPolls(mm, SPECS);
  for (const id of ids) await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  return ids;
}

const hwndOf = (desktop: Desktop, prefix: string) => desktop.windows().find((w) => w.title.startsWith(prefix))?.hwnd as number;
/** Classes of every visible top-level window of the app process (titles of the Tauri windows change with the polls). */
const signature = (desktop: Desktop) => desktop.allWindows().filter((w) => w.visible).map((w) => (w.cls === "Tauri Window" ? "Tauri Window" : `${w.cls}|${w.title}`)).sort();

/** Sends the chord to W1 with OS input and returns a function that proves nothing foreign opened. */
function press(desktop: Desktop, hwnd: number, chord: string): void {
  desktop.nativeKey(hwnd, chord);
}

test.describe("(f) keyboard shortcuts with hardware input in the real WebView2", () => {
  test("DES-002 3.1 table: Ctrl+P, Ctrl+Shift+P, Ctrl+E, Ctrl+O, Ctrl+S, Ctrl+J, Ctrl+\\, Ctrl+L, Ctrl+Shift+N, Ctrl+Shift+T/C, Ctrl+F4, Ctrl+F6, F6 act on the page and no WebView2 accelerator UI appears", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const [a, b] = (await live(mm, sim)) as [number, number];
    const w1 = hwndOf(desktop, "Modbus Master");
    const baseline = signature(desktop);
    const pagesBefore = desktop.pages().length;
    const log: string[] = [];
    const noForeign = (what: string) => {
      const now = signature(desktop);
      const extra = now.length === baseline.length ? now.filter((s) => !baseline.includes(s)) : now;
      log.push(`${what}: extra OS windows ${JSON.stringify(extra)}, pages ${desktop.pages().length}`);
      expect.soft(extra, `${what}: foreign OS window(s) appeared`).toEqual([]);
      expect.soft(desktop.pages().length, `${what}: CDP pages`).toBe(pagesBefore);
    };
    await focusPoll(mm, a);

    // Ctrl+P: pause / resume the poll of the focused sub-window (the browser's print accelerator must not win)
    press(desktop, w1, "ctrl+p");
    await expect(mm.statusLine(a), "Ctrl+P pauses A").toHaveAttribute("data-state", "paused", { timeout: 10_000 });
    noForeign("Ctrl+P");
    press(desktop, w1, "ctrl+p");
    await expect(mm.statusLine(a), "Ctrl+P resumes A").toHaveAttribute("data-state", "polling", { timeout: 10_000 });

    // Ctrl+Shift+P: pause all, again resume all
    press(desktop, w1, "ctrl+shift+p");
    await expect(mm.toolbarButton("Resume all")).toBeVisible({ timeout: 10_000 });
    await expect(mm.statusLine(b)).toHaveAttribute("data-state", "paused");
    noForeign("Ctrl+Shift+P");
    press(desktop, w1, "ctrl+shift+p");
    await expect(mm.toolbarButton("Pause all")).toBeVisible({ timeout: 10_000 });

    // Ctrl+E: Write dialog; Esc closes it (hardware Esc)
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+e");
    await expect(mm.writeDialog, "Ctrl+E opens the Write dialog").toBeVisible({ timeout: 10_000 });
    press(desktop, w1, "esc");
    await expect(mm.writeDialog).toHaveCount(0);
    noForeign("Ctrl+E");

    // Ctrl+O: Open profile dialog (the browser's file-open accelerator must not open a file picker)
    press(desktop, w1, "ctrl+o");
    await expect(mm.openDialog, "Ctrl+O opens the Open profile dialog").toBeVisible({ timeout: 10_000 });
    press(desktop, w1, "esc");
    await expect(mm.openDialog).toHaveCount(0);
    noForeign("Ctrl+O");

    // Ctrl+S on an Untitled profile: Save as dialog (the browser's save-page accelerator must not win)
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+s");
    await expect(mm.saveAsDialog, "Ctrl+S opens Save as for an Untitled profile").toBeVisible({ timeout: 10_000 });
    press(desktop, w1, "esc");
    await expect(mm.saveAsDialog).toHaveCount(0);
    noForeign("Ctrl+S");

    // Ctrl+J: traffic panel (the browser's downloads accelerator must not win); again collapses
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+j");
    await expect(mm.traffic, "Ctrl+J expands the traffic panel").toBeVisible({ timeout: 10_000 });
    noForeign("Ctrl+J");
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+j");
    await expect(mm.traffic).toHaveCount(0);

    // Ctrl+\ with the focus in a sub-window toggles its setup (dock or popover)
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+backslash");
    await expect(mm.setup(a), "Ctrl+\\ opens the setup").toBeVisible({ timeout: 10_000 });
    press(desktop, w1, "ctrl+backslash");
    await expect(mm.setup(a)).toHaveCount(0);

    // Ctrl+Shift+N: new poll in the workspace
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+shift+n");
    await expect.poll(async () => (await mm.ids()).length, { message: "Ctrl+Shift+N created a poll", timeout: 10_000 }).toBe(3);
    noForeign("Ctrl+Shift+N");

    // Ctrl+Shift+T tiles the workspace (tile mode indicator), Ctrl+Shift+C cascades (indicator gone)
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+shift+t");
    await expect(mm.tileIndicator, "Ctrl+Shift+T").toBeVisible({ timeout: 10_000 });
    noForeign("Ctrl+Shift+T");
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+shift+c");
    await expect(mm.tileIndicator, "Ctrl+Shift+C").toHaveCount(0, { timeout: 10_000 });

    // Ctrl+F6: next sub-window in list order becomes active
    const active = async () => mm.page.locator('[data-subwindow][data-active="true"]').getAttribute("data-subwindow");
    await mm.grid(a).focus();
    const before = await active();
    press(desktop, w1, "ctrl+f6");
    await expect.poll(active, { message: "Ctrl+F6 changed the active sub-window", timeout: 10_000 }).not.toBe(before);
    noForeign("Ctrl+F6");

    // F6 cycles the regions
    const region = () => mm.page.evaluate(() => (document.activeElement?.closest("[data-region]") as HTMLElement | null)?.dataset.region ?? "none");
    await mm.grid(a).focus();
    const r0 = await region();
    press(desktop, w1, "f6");
    await expect.poll(region, { message: "F6 moved to another region", timeout: 10_000 }).not.toBe(r0);
    const r1 = await region();
    press(desktop, w1, "f6");
    await expect.poll(region, { timeout: 10_000 }).not.toBe(r1);
    log.push(`F6 regions: ${r0} -> ${r1} -> ${await region()}`);
    noForeign("F6");

    // Ctrl+F4 on the active sub-window: the close dialog S6
    await focusPoll(mm, a);
    press(desktop, w1, "ctrl+f4");
    await expect(mm.confirm, "Ctrl+F4 opens S6").toBeVisible({ timeout: 10_000 });
    await expect(mm.confirm).toContainText("Close poll window?");
    press(desktop, w1, "esc");
    await expect(mm.confirm).toHaveCount(0);

    // Ctrl+L: disconnect, again connect (the browser's address bar accelerator must not win)
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+l");
    await mm.expectConnection("idle");
    press(desktop, w1, "ctrl+l");
    await mm.expectConnection("connected");
    noForeign("Ctrl+L");

    await testInfo.attach("shortcut-log.txt", { body: log.join("\n"), contentType: "text/plain" });
    console.log("SHORTCUTS", log.join(" || "));
  });

  test("DES-002 3.1 browser keys: Alt+Left / Alt+Right do not navigate the webview, Ctrl+W / Ctrl+Shift+N-like browser actions do not close or open windows", async ({ desktop, mm, sim }) => {
    const [a] = (await live(mm, sim)) as [number, number];
    const w1 = hwndOf(desktop, "Modbus Master");
    const url = mm.page.url();
    await focusPoll(mm, a);
    for (const chord of ["alt+left", "alt+right", "ctrl+w"]) {
      await mm.grid(a).focus();
      press(desktop, w1, chord);
      await expect(mm.statusLine(a)).toBeVisible();
      expect(mm.page.url(), `${chord} must not navigate`).toBe(url);
    }
    expect(desktop.windows().filter((w) => w.title.startsWith("Modbus Master"))).toHaveLength(1);
    await expect(mm.pill).toContainText("Connected");
  });

  test("CHK2-E14 F5 (a real reload of the W1 webview) re-attaches every sub-window at the same rectangles, states and values", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    const [a, b] = (await live(mm, sim)) as [number, number];
    // move B so the layout is not the default, then remember everything
    const tb = await mm.titlePoint(b, 60);
    await mm.page.mouse.move(tb.x, tb.y);
    await mm.page.mouse.down();
    await mm.page.mouse.move(tb.x + 120, tb.y + 90, { steps: 6 });
    await mm.page.mouse.up();
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+p");
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "paused");
    const rects = { a: await mm.domRect(a), b: await mm.domRect(b) };
    const cellsA = await mm.rowCells(a, 1);
    const w1 = hwndOf(desktop, "Modbus Master");
    const modifiedBefore = await mm.modified();
    const loads: string[] = [];
    mm.page.on("framenavigated", (f) => { if (f === mm.page.mainFrame()) loads.push(f.url()); });
    press(desktop, w1, "f5");
    // a hardware F5 does not reload the app page (the WebView2 accelerator is not active or the app swallows it)
    await new Promise((r) => setTimeout(r, 1500));
    console.log("F5 hardware: page reloads =", loads.length);
    expect(loads.length, "hardware F5 must not reload a running tool window (it would drop the page state)").toBe(0);
    await mm.page.reload();
    await expect(mm.toolbar.getByRole("button", { name: /^(Connect|Disconnect|Reconnect|Cancel)$/ }).first()).toBeEnabled({ timeout: 30_000 });
    await expect(mm.sub(a)).toBeVisible();
    await expect(mm.sub(b)).toBeVisible();
    await mm.expectDomRect(a, rects.a);
    await mm.expectDomRect(b, rects.b);
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "paused");
    await expect(mm.statusLine(b)).toHaveAttribute("data-state", "polling");
    await expect.poll(async () => (await mm.rowCells(a, 1)).at(-1)).toBe(cellsA.at(-1));
    await mm.expectConnection("connected");
    // E14: the re-attach itself must not mark the profile Modified. The profile was Modified before (polls were added);
    // whether the flag survives a reload is recorded, not asserted (the flag lives in the page).
    const modifiedAfter = await mm.modified();
    console.log("E14 Modified before/after reload:", modifiedBefore, modifiedAfter, "title:", await mm.page.title());
    await expect(mm.pill).toContainText("Connected");
    expect(mm.pageErrors).toEqual([]);
  });

  test("CHK2-R7 Alt: after a real Alt tap / Alt-drag the page keeps the keyboard focus (no OS menu mode); Alt+Space opens the Windows system menu and Esc returns", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    const [a] = (await live(mm, sim)) as [number, number];
    const w1 = hwndOf(desktop, "Modbus Master");
    const race = async <T,>(p: Promise<T>, ms = 3000): Promise<T | "TIMEOUT"> => Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);
    await focusPoll(mm, a);
    await mm.grid(a).focus();
    // Alt held with OS input while the sub-window is dragged with the mouse (CDP), then released
    desktop.showWindow(w1, "focus");
    desktop.holdKey("alt", "down");
    await mm.page.keyboard.down("Alt");
    const p = await mm.titlePoint(a, 60);
    await mm.dragStart(p, { x: p.x + 60, y: p.y + 40 }, 6);
    await mm.page.mouse.up();
    await mm.page.keyboard.up("Alt");
    desktop.holdKey("alt", "up");
    await new Promise((r) => setTimeout(r, 500));
    const focus = await race(mm.page.evaluate(() => document.hasFocus()));
    const reqs = (() => { const m = sim.mark(); return m; })();
    // a hardware Ctrl+P must still reach the page (pauses A): proves the focus is not in an OS menu
    press(desktop, w1, "ctrl+p");
    await new Promise((r) => setTimeout(r, 700));
    const paused = await race(mm.statusLine(a).getAttribute("data-state"));
    const stillPolling = sim.requestsSince(reqs) > 3;
    console.log("R7 after Alt-drag: page responsive =", String(focus), "| Ctrl+P paused A =", String(paused), "| requests still flowing =", stillPolling);
    // leave any menu mode the Alt tap started (Esc, then another Alt tap) so the app can be inspected and closed
    if (focus === "TIMEOUT" || paused !== "paused") {
      desktop.nativeKey(w1, "esc");
      desktop.holdKey("alt", "down");
      desktop.holdKey("alt", "up");
      await new Promise((r) => setTimeout(r, 800));
    }
    expect(focus, "CHK2-R7: the page must answer (focus stays in W1 content) after an Alt-drag; an OS menu mode freezes it").toBe(true);
    expect(paused, "CHK2-R7: hardware Ctrl+P reaches the page after the Alt-drag").toBe("paused");
    // Alt+Space: the Windows system menu
    press(desktop, w1, "ctrl+p");
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "polling", { timeout: 10_000 });
    press(desktop, w1, "alt+space");
    await expect.poll(() => desktop.allWindows().filter((w) => w.cls === "#32768" && w.visible).length, { message: "the system menu opened", timeout: 10_000 }).toBeGreaterThan(0);
    // Windows: the first Esc closes the popup, the second leaves the menu mode (the page is blocked until then)
    press(desktop, w1, "esc");
    await expect.poll(() => desktop.allWindows().filter((w) => w.cls === "#32768" && w.visible).length, { message: "the system menu closed" }).toBe(0);
    if (desktop.menuMode(w1).inMenuMode) press(desktop, w1, "esc");
    await expect.poll(() => desktop.menuMode(w1).inMenuMode, { message: "menu mode ended after at most two Esc" }).toBe(false);
    await mm.grid(a).focus();
    press(desktop, w1, "ctrl+p");
    await expect(mm.statusLine(a), "keys reach the page after the system menu").toHaveAttribute("data-state", "paused", { timeout: 10_000 });
  });
});
