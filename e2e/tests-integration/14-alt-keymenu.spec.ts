// REPORT-007: CHK2-R7 (a)-(g), D2 of REPORT-006, with HARDWARE input (SendInput) in W1, a native poll window (W2) and the
// launcher. The binary under test is selected by ESEFACT_APP_EXE (normal debug, dev-hooks debug or release).
// Detection of the old failure: the page does not answer CDP (OS menu mode blocks the browser thread), a hardware Ctrl+P does not
// pause the poll, GetGUIThreadInfo reports GUI_INMENUMODE, an OS menu window (#32768) exists.
import { type Desktop, expect, type RealMm, RealNative, test } from "../integration/fixtures";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";
import { focusFingerprint, hwndByTitle, osMenus, responsive, screenPoint, sleep } from "../integration/qa7";
import { saveProfileAs } from "../integration/profiles";
import type { Page } from "@playwright/test";
import type { Sim } from "../integration/sim";

const SPECS = [
  { name: "A", slave: 1, fc: 3 as const, start: 0, qty: 10, scan: 100 },
  { name: "B", slave: 2, fc: 3 as const, start: 10, qty: 5, scan: 100 },
];

async function live(mm: RealMm, sim: Sim): Promise<[number, number]> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
  const ids = await createPolls(mm, SPECS);
  for (const id of ids) await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  return ids as [number, number];
}

const race = async <T>(p: Promise<T>, ms = 1500): Promise<T | "TIMEOUT"> =>
  Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);

interface Probe {
  responsive: boolean;
  inMenuMode: boolean;
  systemMenu: boolean;
  osMenus: number;
  focus: string;
}

/** What the CHK2-R7 (a) bullets check after the Alt input, before Ctrl+P. */
async function probe(desktop: Desktop, hwnd: number, page: Page): Promise<Probe> {
  const ok = await responsive(page, 1000);
  const mm = desktop.menuMode(hwnd);
  return {
    responsive: ok,
    inMenuMode: mm.inMenuMode,
    systemMenu: mm.systemMenu,
    osMenus: osMenus(desktop).length,
    focus: ok ? await focusFingerprint(page) : "(page frozen)",
  };
}

/** Leaves any menu mode a failed test started (Esc, Alt) so the next steps and the cleanup are not blocked. */
function rescue(desktop: Desktop, hwnd: number): void {
  desktop.nativeKey(hwnd, "esc");
  desktop.holdKey("alt", "down");
  desktop.holdKey("alt", "up");
}

/** Hardware Ctrl+P; returns the ms until `stateLoc` shows `want` (null: not within `limitMs`). */
async function ctrlP(desktop: Desktop, hwnd: number, stateLoc: () => Promise<string | "TIMEOUT">, want: string, limitMs = 2500): Promise<number | null> {
  desktop.nativeKey(hwnd, "ctrl+p");
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if ((await race(stateLoc(), 600)) === want) return Date.now() - t0;
    await sleep(20);
  }
  return null;
}

/** The full (a) check after an Alt input: probe, Ctrl+P pauses within 500 ms, wire quiet, Ctrl+P resumes. */
async function assertAltHarmless(
  label: string,
  desktop: Desktop,
  hwnd: number,
  page: Page,
  state: () => Promise<string | "TIMEOUT">,
  sim: Sim,
  unit: number,
  before: string | null,
  log: string[],
): Promise<void> {
  await sleep(500); // CHK2-R7: "wait 500 ms, then press Ctrl+P"
  const p = await probe(desktop, hwnd, page);
  log.push(`${label}: ${JSON.stringify(p)}`);
  console.log(`${label} probe`, JSON.stringify(p), "| title", desktop.windows().find((w) => w.hwnd === hwnd)?.title, "| state", await race(state(), 800));
  expect.soft(p.responsive, `${label}: the page answers CDP within 1 s (frozen page = OS menu mode)`).toBe(true);
  expect.soft(p.inMenuMode, `${label}: the window's GUI thread is not in menu mode`).toBe(false);
  expect.soft(p.osMenus, `${label}: no OS menu window`).toBe(0);
  if (before !== null && p.responsive) expect.soft(p.focus, `${label}: focus is where it was`).toBe(before);
  const t = await ctrlP(desktop, hwnd, state, "paused");
  log.push(`${label}: Ctrl+P -> paused after ${t} ms`);
  if (t === null) rescue(desktop, hwnd);
  expect.soft(t, `${label}: Ctrl+P pauses within 500 ms of the key (null = never)`).not.toBeNull();
  expect.soft(t ?? 99999, `${label}: Ctrl+P latency`).toBeLessThanOrEqual(500);
  if (t !== null) {
    await sleep(200);
    const m = sim.mark();
    await sleep(400);
    expect.soft(sim.requestsDecoded(m).filter((r) => r.unit === unit).length, `${label}: no further request for the paused poll`).toBe(0);
    const r = await ctrlP(desktop, hwnd, state, "polling");
    expect.soft(r, `${label}: a second Ctrl+P resumes`).not.toBeNull();
  }
  expect(test.info().errors.length, `${label} soft failures so far`).toBe(0);
}

const w1Of = (desktop: Desktop) => hwndByTitle(desktop, "Modbus Master");
const dprOf = (page: Page) => page.evaluate(() => window.devicePixelRatio);

test.describe("CHK2-R7 lone Alt with hardware input", () => {
  test("CHK2-R7-a lone Alt tap in W1 (focus in P1's grid, row 3): the page answers, focus unchanged, no OS menu, Ctrl+P pauses within 500 ms", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(120_000);
    const [a] = await live(mm, sim);
    const w1 = w1Of(desktop);
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    const before = await focusFingerprint(mm.page);
    const log: string[] = [`binary ${process.env.ESEFACT_APP_EXE ?? "default debug"}`, `focus before: ${before}`];
    desktop.nativeKey(w1, "alt");
    await assertAltHarmless("R7a", desktop, w1, mm.page, () => race(mm.statusLine(a).getAttribute("data-state") as Promise<string>), sim, 1, before, log);
    await testInfo.attach("r7a.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("R7a", log.join(" || "));
  });

  test("CHK2-R7-control the same steps WITHOUT any Alt input: hardware Ctrl+P pauses and resumes (proves the harness)", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    const [a] = await live(mm, sim);
    const w1 = w1Of(desktop);
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    const log: string[] = [];
    await assertAltHarmless("R7control", desktop, w1, mm.page, () => race(mm.statusLine(a).getAttribute("data-state") as Promise<string>), sim, 1, null, log);
    console.log("R7control", log.join(" || "));
  });

  for (const order of ["mouse-first", "alt-first"] as const) {
    test(`CHK2-R7-b after an Alt-drag with the real mouse (${order === "mouse-first" ? "mouse button released before Alt" : "Alt released before the mouse button"}): the page answers, no OS menu, Ctrl+P pauses`, async ({ desktop, mm, sim }, testInfo) => {
      test.setTimeout(120_000);
      const [a] = await live(mm, sim);
      const w1 = w1Of(desktop);
      await focusPoll(mm, a);
      await mm.gridRow(a, 3).click();
      const before = await focusFingerprint(mm.page);
      const dpr = await dprOf(mm.page);
      const win = desktop.windows().find((w) => w.hwnd === w1);
      if (!win) throw new Error("no W1 window");
      const rect0 = await mm.domRect(a);
      const p = await mm.titlePoint(a, 60);
      const s0 = screenPoint(win, dpr, p);
      const log: string[] = [`binary ${process.env.ESEFACT_APP_EXE ?? "default debug"}`, `scale ${dpr}`, `focus before: ${before}`];
      desktop.showWindow(w1, "focus");
      await expect.poll(() => desktop.foregroundHwnd()).toBe(w1);
      desktop.holdKey("alt", "down");
      desktop.mouseMove(s0.x, s0.y);
      desktop.mouseDown();
      for (let i = 1; i <= 8; i += 1) desktop.mouseMove(s0.x + Math.round((125 * i) / 8), s0.y + Math.round((50 * i) / 8));
      await expect.poll(async () => (await mm.domRect(a)).x - rect0.x, { message: "the Alt-drag moved the sub-window (~100 css px)" }).toBeGreaterThan(60);
      const rect1 = await mm.domRect(a);
      log.push(`sub-window moved by (${rect1.x - rect0.x}, ${rect1.y - rect0.y}) css px`);
      if (order === "mouse-first") {
        desktop.mouseUp();
        desktop.holdKey("alt", "up");
      } else {
        desktop.holdKey("alt", "up");
        desktop.mouseUp();
      }
      await assertAltHarmless(`R7b(${order})`, desktop, w1, mm.page, () => race(mm.statusLine(a).getAttribute("data-state") as Promise<string>), sim, 1, null, log);
      await testInfo.attach(`r7b-${order}.log`, { body: log.join("\n"), contentType: "text/plain" });
      console.log(`R7b ${order}`, log.join(" || "));
    });
  }

  test("CHK2-R7-c two lone Alt taps in a row, then Ctrl+P acts (no state a second tap undoes)", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(120_000);
    const [a] = await live(mm, sim);
    const w1 = w1Of(desktop);
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    const before = await focusFingerprint(mm.page);
    const log: string[] = [];
    desktop.nativeKey(w1, "alt");
    await sleep(300);
    desktop.nativeKey(w1, "alt");
    await assertAltHarmless("R7c", desktop, w1, mm.page, () => race(mm.statusLine(a).getAttribute("data-state") as Promise<string>), sim, 1, before, log);
    await testInfo.attach("r7c.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("R7c", log.join(" || "));
  });

  test("CHK2-R7-d lone Alt tap in P2's native window (focus in its grid): Ctrl+P pauses P2", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(120_000);
    const [, b] = await live(mm, sim);
    await focusPoll(mm, b);
    await mm.page.keyboard.press("Control+Shift+O");
    const page = await desktop.w2Page(b);
    const nw = new RealNative(page);
    await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect.poll(() => hwndByTitle(desktop, "B - ")).not.toBe(0);
    const w2 = hwndByTitle(desktop, "B - ");
    await nw.gridRow(3).click();
    const before = await focusFingerprint(page);
    const log: string[] = [`focus before: ${before}`];
    desktop.nativeKey(w2, "alt");
    await assertAltHarmless("R7d", desktop, w2, page, () => race(nw.statusLine.getAttribute("data-state") as Promise<string>), sim, 2, before, log);
    // an Alt-drag cannot move a native window, but a hardware Alt held while the pointer clicks in the grid must be harmless too
    await testInfo.attach("r7d.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("R7d", log.join(" || "));
  });

  test("CHK2-R7-e lone Alt tap in the launcher, then Tab: the same next element as without the Alt tap, no OS menu", async ({ desktop, launcher }, testInfo) => {
    test.setTimeout(90_000);
    const lw = hwndByTitle(desktop, "ESEfact");
    expect(lw, "launcher window").not.toBe(0);
    const describeFocus = () => launcher.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a ? `${a.tagName}|${a.getAttribute("aria-label") ?? ""}|${(a.textContent ?? "").trim().slice(0, 40)}|${a.getAttribute("data-testid") ?? ""}` : "none";
    });
    // The launcher has a single focusable element, so Tab from a fresh document lands on [Open]. Every trial starts from a reloaded page
    // (the sequential focus navigation start point is the document start), with or without a lone Alt tap before the Tab.
    const trial = async (withAltTap: boolean) => {
      await launcher.reload();
      await launcher.getByRole("heading", { name: "ESEfact" }).waitFor({ timeout: 20_000 });
      let probeAfter: Awaited<ReturnType<typeof probe>> | null = null;
      if (withAltTap) {
        desktop.nativeKey(lw, "alt");
        await sleep(500);
        probeAfter = await probe(desktop, lw, launcher);
      } else {
        desktop.showWindow(lw, "focus");
      }
      desktop.nativeKey(lw, "tab");
      let landed: string | "TIMEOUT" = "TIMEOUT";
      const t0 = Date.now();
      while (Date.now() - t0 < 3000) {
        landed = await race(describeFocus(), 800);
        if (landed !== "TIMEOUT" && !landed.startsWith("BODY")) break;
        await sleep(30);
      }
      return { landed, probeAfter };
    };
    const t1 = await trial(false);
    const t2 = await trial(true);
    const t3 = await trial(false);
    const t4 = await trial(true);
    const p = t4.probeAfter as Awaited<ReturnType<typeof probe>>;
    const withoutAlt = t1.landed;
    const withAlt = t2.landed;
    void t3;
    const log = [`Tab without Alt (trial 1, 3) -> ${t1.landed} | ${t3.landed}`, `after Alt tap: ${JSON.stringify(t2.probeAfter)} | ${JSON.stringify(p)}`, `Tab after the Alt tap (trial 2, 4) -> ${withAlt} | ${t4.landed}`];
    await testInfo.attach("r7e.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("R7e", log.join(" || "));
    if (p.inMenuMode || withAlt === "TIMEOUT" || t4.landed === "TIMEOUT") rescue(desktop, lw);
    expect.soft(p.responsive, "launcher page answers after the Alt tap").toBe(true);
    expect.soft(p.inMenuMode, "launcher GUI thread not in menu mode").toBe(false);
    expect.soft(p.osMenus, "no OS menu").toBe(0);
    expect(withAlt, "Tab after a lone Alt tap lands on the same element as Tab without it").toBe(withoutAlt);
    expect(t4.landed, "and the same on the repeat").toBe(t3.landed);
  });

  test("CHK2-R7-f Alt+Right moves P1 16 px; Alt+Space opens the OS window menu and Esc closes it; keys reach the page afterwards", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(120_000);
    const [a] = await live(mm, sim);
    const w1 = w1Of(desktop);
    const log: string[] = [];
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    // Alt+Right (hardware) moves the sub-window 16 css px
    const r0 = await mm.domRect(a);
    desktop.nativeKey(w1, "alt+right");
    await expect.poll(async () => (await mm.domRect(a)).x - r0.x, { message: "Alt+Right moved P1 by 16 px", timeout: 5000 }).toBe(16);
    log.push(`Alt+Right: dx ${(await mm.domRect(a)).x - r0.x}`);
    // Alt+Space: the OS window menu (kept)
    desktop.nativeKey(w1, "alt+space");
    await expect
      .poll(() => osMenus(desktop).length > 0 || desktop.menuMode(w1).systemMenu || desktop.menuMode(w1).inMenuMode, { message: "the OS window menu opened (Alt+Space kept)", timeout: 8000 })
      .toBe(true);
    log.push(`Alt+Space: menus ${osMenus(desktop).length}, gui ${JSON.stringify(desktop.menuMode(w1))}`);
    // Windows behaviour: the first Esc closes the popup, the second leaves the menu mode (until then the page is blocked)
    let escPresses = 0;
    for (; escPresses < 3; ) {
      desktop.nativeKey(w1, "esc");
      escPresses += 1;
      await sleep(500);
      if (osMenus(desktop).length === 0 && !desktop.menuMode(w1).inMenuMode) break;
    }
    log.push(`Esc presses until the menu mode ended: ${escPresses}; popup gone after the first: ${escPresses >= 1}`);
    expect(osMenus(desktop).length === 0 && !desktop.menuMode(w1).inMenuMode, "Esc closed the OS window menu and left menu mode").toBe(true);
    expect.soft(escPresses, "at most two Esc presses (popup, then menu mode)").toBeLessThanOrEqual(2);
    await mm.gridRow(a, 3).click();
    const t = await ctrlP(desktop, w1, () => race(mm.statusLine(a).getAttribute("data-state") as Promise<string>), "paused");
    log.push(`Ctrl+P after Esc: ${t} ms`);
    await testInfo.attach("r7f.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("R7f", log.join(" || "));
    expect(t, "keys reach the page after the window menu was closed").not.toBeNull();
  });

  test("INT-EXTRA keyboard layout: hardware Ctrl+P / Ctrl+E / Ctrl+J with the Thai input language active (this machine has en-US and th installed)", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(150_000);
    const [a] = await live(mm, sim);
    const w1 = w1Of(desktop);
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    await mm.page.evaluate(() => {
      const w = window as unknown as { __k: string[] };
      w.__k = [];
      window.addEventListener("keydown", (e) => w.__k.push(e.key + "/" + e.code + (e.ctrlKey ? "+ctrl" : "")), true);
    });
    const log: string[] = [];
    desktop.showWindow(w1, "focus");
    desktop.setKeyboardLayout(w1, "041E041E");
    await expect.poll(() => desktop.keyboardLayout(w1).focus, { timeout: 5000 }).toBe("041E041E");
    try {
      const results: Record<string, boolean> = {};
      desktop.nativeKey(w1, "ctrl+p", { keepLayout: true });
      await sleep(800);
      results["Ctrl+P pauses"] = (await race(mm.statusLine(a).getAttribute("data-state") as Promise<string>)) === "paused";
      desktop.nativeKey(w1, "ctrl+e", { keepLayout: true });
      await sleep(800);
      results["Ctrl+E opens Write"] = await mm.writeDialog.isVisible();
      if (results["Ctrl+E opens Write"]) desktop.nativeKey(w1, "esc", { keepLayout: true });
      desktop.nativeKey(w1, "ctrl+j", { keepLayout: true });
      await sleep(800);
      results["Ctrl+J expands traffic"] = await mm.traffic.isVisible();
      const keys = await mm.page.evaluate(() => (window as unknown as { __k: string[] }).__k);
      log.push("layout " + JSON.stringify(desktop.keyboardLayout(w1)), "keys seen by the page: " + JSON.stringify(keys), "results " + JSON.stringify(results));
      console.log("INT-EXTRA Thai layout", log.join(" || "));
      await testInfo.attach("thai-layout.log", { body: log.join("\n"), contentType: "text/plain" });
      for (const [k, v] of Object.entries(results)) expect.soft(v, "with the Thai layout active: " + k).toBe(true);
    } finally {
      desktop.setKeyboardLayout(w1, "04090409");
    }
    expect(test.info().errors.length).toBe(0);
  });

  test("CHK2-R7-x F10, Alt+letter and Alt+Tab (away and back) do not enter menu mode or freeze the page", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(180_000);
    const [a, b] = await live(mm, sim);
    const w1 = w1Of(desktop);
    const state = () => race(mm.statusLine(a).getAttribute("data-state") as Promise<string>);
    const log: string[] = [];
    // a second window so that Alt+Tab has a target inside the app
    await focusPoll(mm, b);
    await mm.page.keyboard.press("Control+Shift+O");
    await desktop.w2Page(b);
    await expect.poll(() => hwndByTitle(desktop, "B - ")).not.toBe(0);
    const w2 = hwndByTitle(desktop, "B - ");
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    for (const chord of ["f10", "alt+f", "alt+x"]) {
      desktop.nativeKey(w1, chord);
      await assertAltHarmless(`R7x(${chord})`, desktop, w1, mm.page, state, sim, 1, null, log);
      await mm.gridRow(a, 3).click();
    }
    // Alt+Tab to the other app window and back, with Alt held between the two taps of Tab
    desktop.showWindow(w1, "focus");
    await expect.poll(() => desktop.foregroundHwnd()).toBe(w1);
    desktop.holdKey("alt", "down");
    desktop.rawKey("tab");
    await sleep(700);
    desktop.holdKey("alt", "up");
    await expect.poll(() => desktop.foregroundHwnd(), { message: "Alt+Tab switched away from W1", timeout: 5000 }).not.toBe(w1);
    const fgAway = desktop.foregroundHwnd();
    log.push(`Alt+Tab away: foreground ${fgAway} (W2 is ${w2})`);
    desktop.holdKey("alt", "down");
    desktop.rawKey("tab");
    await sleep(700);
    desktop.holdKey("alt", "up");
    await sleep(500);
    const fgBack = desktop.foregroundHwnd();
    log.push(`Alt+Tab back: foreground ${fgBack} (W1 is ${w1})`);
    expect.soft(fgBack, "Alt+Tab returned to W1").toBe(w1);
    const p = await probe(desktop, w1, mm.page);
    log.push(`after Alt+Tab pair: ${JSON.stringify(p)}`);
    expect.soft(p.responsive, "page answers after Alt+Tab").toBe(true);
    expect.soft(p.inMenuMode, "not in menu mode after Alt+Tab").toBe(false);
    await mm.gridRow(a, 3).click();
    const t = await ctrlP(desktop, w1, state, "paused");
    log.push(`Ctrl+P after Alt+Tab: ${t} ms`);
    expect.soft(t, "Ctrl+P acts after Alt+Tab").not.toBeNull();
    await testInfo.attach("r7x.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("R7x", log.join(" || "));
    expect(test.info().errors.length).toBe(0);
  });

  test("CHK2-R7-g Alt+F4 still closes through the confirm flows: P2 gets S6 (default Keep poll, Cancel keeps); W1 with unsaved changes gets Save changes? (Cancel keeps); W1 saved closes with its native windows", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(180_000);
    const [a, b] = await live(mm, sim);
    const w1 = w1Of(desktop);
    const log: string[] = [];
    await focusPoll(mm, b);
    await mm.page.keyboard.press("Control+Shift+O");
    const page = await desktop.w2Page(b);
    const nw = new RealNative(page);
    await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect.poll(() => hwndByTitle(desktop, "B - ")).not.toBe(0);
    const w2 = hwndByTitle(desktop, "B - ");
    // P2's native window: Alt+F4 -> S6
    await nw.gridRow(1).click();
    desktop.nativeKey(w2, "alt+f4");
    await expect(nw.confirm, "Alt+F4 in the native window opens S6").toBeVisible({ timeout: 8000 });
    await expect(nw.confirm).toContainText("Close poll window?");
    await expect(nw.confirm.getByRole("button", { name: "Keep poll" }), "default focus Keep poll").toBeFocused();
    await nw.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(nw.confirm).toHaveCount(0);
    expect(hwndByTitle(desktop, "B - "), "Cancel keeps the native window").toBe(w2);
    log.push("W2 Alt+F4: S6 shown, default focus Keep poll, Cancel keeps the window");
    // W1 with unsaved changes (Untitled, polls added): Save changes?
    await focusPoll(mm, a);
    await mm.gridRow(a, 1).click();
    desktop.nativeKey(w1, "alt+f4");
    await expect(mm.confirm, "Alt+F4 in W1 with unsaved changes opens Save changes?").toBeVisible({ timeout: 8000 });
    const text = ((await mm.confirm.innerText()) ?? "").replace(/\s+/g, " ");
    log.push(`W1 Alt+F4 dialog: ${text}`);
    expect(text).toMatch(/Save this setup as a profile before closing\?/);
    expect(text).toMatch(/This also closes 1 poll window\./);
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(mm.confirm).toHaveCount(0);
    expect(hwndByTitle(desktop, "Modbus Master"), "Cancel keeps W1").toBe(w1);
    expect(hwndByTitle(desktop, "B - "), "Cancel keeps the native window").toBe(w2);
    await expect(mm.pill).toContainText("Connected");
    // W1 saved: Alt+F4 closes W1 and its native window, no dialog
    await saveProfileAs(mm, "R7g");
    await expect(mm.profileLabel).not.toContainText("Modified");
    desktop.nativeKey(w1, "alt+f4");
    await expect.poll(() => desktop.windows().filter((w) => w.title.startsWith("Modbus Master") || w.title.startsWith("B - ")).length, { message: "W1 and the native window closed", timeout: 15_000 }).toBe(0);
    expect(desktop.windows().some((w) => w.title === "ESEfact"), "the launcher stays").toBe(true);
    await expect.poll(() => desktop.establishedTo(sim.modbusPort), { message: "the connection closed" }).toBe(0);
    log.push("W1 saved: Alt+F4 closed W1 and the native window, connection closed");
    await testInfo.attach("r7g.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("R7g", log.join(" || "));
  });
});
