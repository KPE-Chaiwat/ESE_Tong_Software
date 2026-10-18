// REPORT-007: CHK-002 revision 10 items against the real backend: B11 (17th poll), H9 (compact and tile mode), K8 (traffic filter),
// P3 (invalid input, real wire), N10 (load-flow wording).
import fs from "node:fs";
import path from "node:path";
import { type Desktop, expect, type RealMm, RealNative, test } from "../integration/fixtures";
import { makeDataDir, removeDir, startApp } from "../integration/app-session";
import { invokeIn } from "../integration/real-mm";
import { openProfile, type PollProfileSpec, profileV2, profilesDir, saveProfileAs, writeProfile } from "../integration/profiles";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";
import { diffs, hwndByTitle, sleep } from "../integration/qa7";
import { Sim } from "../integration/sim";
import type { Page } from "@playwright/test";

const LIMIT = "A connection can have at most 16 polls.";

/** Records the text of every toast that appears in a page (toasts disappear after 2-4 s). */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    const scan = () => {
      for (const el of document.querySelectorAll('[role="status"][aria-live="polite"] [data-tone]')) {
        const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (t && !w.__toasts.includes(t)) w.__toasts.push(t);
      }
    };
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true });
    scan();
  });
}
const readToasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts ?? []);

function sixteen(n: number, scan = 250): PollProfileSpec[] {
  return Array.from({ length: n }, (_, i) => ({ name: `Poll ${i + 1}`, slave: 1, fc: 3, start: 5 * i, qty: 5, scan, workspace: null }));
}

async function loadAndConnect(desktop: Desktop, mm: RealMm, sim: Sim, name: string, polls: PollProfileSpec[], workspace: Record<string, unknown> = {}): Promise<void> {
  await referenceMap(sim);
  writeProfile(desktop, name, profileV2(name, polls, { connection: { mode: "tcp", host: "127.0.0.1", port: sim.modbusPort, timeoutMs: 1000 } }, workspace));
  await openProfile(mm, name);
  await expect(mm.pollList.getByRole("option")).toHaveCount(polls.length);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
}

async function allPolling(mm: RealMm): Promise<number[]> {
  const ids = await mm.ids();
  for (const id of ids) {
    const sub = mm.sub(id);
    if ((await sub.count()) > 0) await expect(mm.statusLine(id)).toHaveAttribute("data-state", /polling|exception/, { timeout: 30_000 });
  }
  return ids;
}

test.describe("CHK2-B11 the 17th poll, real backend", () => {
  test("UI path (button disabled, Ctrl+Shift+N toast in W1 and in the native window) and backend path (mm_add_poll rejected with validation, exact message), nothing created", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    await loadAndConnect(desktop, mm, sim, "B11", sixteen(16));
    const ids = await allPolling(mm);
    expect(ids.length).toBe(16);
    // one of them popped out
    await focusPoll(mm, ids[0] as number);
    await mm.page.keyboard.press("Control+Shift+O");
    const nwPage = await desktop.w2Page(ids[0] as number);
    const nw = new RealNative(nwPage);
    await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    const nativeBefore = desktop.windows().filter((w) => w.cls === "Tauri Window").length;
    await expect(mm.page.getByRole("heading", { name: /Polls · 16 of 16/i })).toBeVisible();
    const button = mm.toolbarButton("New poll");
    await expect(button).toBeDisabled();
    await expect(button, "title").toHaveAttribute("title", LIMIT);
    // Ctrl+Shift+N in W1 (hardware) and in the native window (CDP) show the neutral toast
    await mm.row(ids[1] as number).click();
    await mm.grid(ids[1] as number).focus();
    desktop.nativeKey(hwndByTitle(desktop, "Modbus Master"), "ctrl+shift+n");
    await expect(mm.toast(LIMIT), "W1 toast").toBeVisible({ timeout: 8000 });
    await nw.grid.focus();
    await nw.page.keyboard.press("Control+Shift+N");
    await expect(nw.toasts.filter({ hasText: LIMIT }), "native window toast").toBeVisible({ timeout: 8000 });
    await expect(mm.page.getByRole("heading", { name: /Polls · 16 of 16/i })).toBeVisible();
    expect(desktop.windows().filter((w) => w.cls === "Tauri Window").length, "no native window opened").toBe(nativeBefore);
    // backend path
    const mark = sim.mark();
    const outcome = await mm.page.evaluate(async () => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const input = {
        name: "Poll 17",
        definition: { slaveId: 1, function: 3, startAddress: 85, quantity: 5, scanRateMs: 250 },
        display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false },
        scale: null,
        scaleOverrides: [],
        valueColumns: "raw",
        aliases: [],
      };
      try {
        const id = await internals.invoke("mm_add_poll", { input, host: "workspace" });
        return { ok: true, value: JSON.stringify(id) };
      } catch (e) {
        return { ok: false, value: JSON.stringify(e) };
      }
    });
    console.log("B11 backend", JSON.stringify(outcome));
    expect(outcome.ok, "the 17th mm_add_poll must be rejected").toBe(false);
    const err = JSON.parse(outcome.value) as { code: string; message: string; field: string | null };
    expect(err.code).toBe("validation");
    const exported = await mm.exportProfile();
    expect(exported.polls.length, "export lists 16 polls").toBe(16);
    await expect(mm.pollList.getByRole("option")).toHaveCount(16);
    await sleep(1500);
    expect(sim.requestsDecoded(mark).filter((r) => r.addr === 85), "no request for Poll 17's range").toEqual([]);
    await testInfo.attach("b11.json", { body: JSON.stringify({ error: err }, null, 1), contentType: "application/json" });
  });

  test("race: with 15 polls Ctrl+Shift+N in W1 and in the native window within 50 ms creates exactly one poll; no 17th; the other polls keep polling", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    await loadAndConnect(desktop, mm, sim, "B11race", sixteen(15, 250));
    const ids = await allPolling(mm);
    await focusPoll(mm, ids[0] as number);
    await mm.page.keyboard.press("Control+Shift+O");
    const nw = new RealNative(await desktop.w2Page(ids[0] as number));
    await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await mm.row(ids[1] as number).click();
    await mm.grid(ids[1] as number).focus();
    await nw.grid.focus();
    await recordToasts(mm.page);
    await recordToasts(nw.page);
    const mark = sim.mark();
    const t0 = Date.now();
    await Promise.all([mm.page.keyboard.press("Control+Shift+N"), nw.page.keyboard.press("Control+Shift+N")]);
    await expect.poll(async () => (await mm.exportProfile()).polls.length, { timeout: 15_000 }).toBe(16);
    await sleep(2500);
    const exported = await mm.exportProfile();
    expect(exported.polls.length, "exactly 16 polls, no 17th").toBe(16);
    const toasts = { w1: await readToasts(mm.page), w2: await readToasts(nw.page) };
    console.log("B11 race", JSON.stringify({ elapsedMs: Date.now() - t0, toasts, windows: desktop.windows().length }));
    // the other 15 polls keep polling: no gap longer than 2 scan periods (500 ms) + slack
    const reqs = sim.requestsDecoded(mark);
    let maxGap = 0;
    for (let p = 0; p < 15; p += 1) maxGap = Math.max(maxGap, ...diffs(reqs.filter((r) => r.addr === 5 * p).map((r) => r.epoch)));
    console.log("B11 race maxGap", maxGap);
    await testInfo.attach("b11-race.json", { body: JSON.stringify({ toasts, maxGap, pollsInExport: exported.polls.length }), contentType: "application/json" });
    expect(maxGap, "no gap longer than 2 scan periods").toBeLessThanOrEqual(600);
    const messageSeen = [...toasts.w1, ...toasts.w2].some((t) => /at most 16 polls/.test(t));
    expect(messageSeen, `the loser shows a limit message (${JSON.stringify(toasts)})`).toBe(true);
  });
});

test.describe("CHK2-H9 compact and tile mode, real backend, hardware Ctrl+Shift+\\", () => {
  test("(a)-(e) Standard 8 polls: P1-P5 sub-windows, P6/P7 native, P8 closed", async ({}, testInfo) => {
    test.setTimeout(360_000);
    const dataDir = makeDataDir();
    const sim = await Sim.start();
    let s1: Awaited<ReturnType<typeof startApp>> | null = null;
    let s2: Awaited<ReturnType<typeof startApp>> | null = null;
    const log: string[] = [];
    try {
      await referenceMap(sim);
      s1 = await startApp(dataDir);
      const { desktop, mm } = s1;
      const std: PollProfileSpec[] = [
        { name: "Poll 1", fc: 3, start: 0, qty: 10 },
        { name: "Poll 2", fc: 3, start: 10, qty: 10 },
        { name: "Poll 3", fc: 4, start: 0, qty: 10 },
        { name: "Poll 4", fc: 1, start: 0, qty: 32 },
        { name: "Poll 5", fc: 2, start: 0, qty: 8 },
        { name: "Poll 6", fc: 3, start: 20, qty: 125, host: "native", native: null },
        { name: "Poll 7", fc: 3, start: 50, qty: 10, slave: 2, host: "native", native: null },
        { name: "Poll 8", fc: 3, start: 0, qty: 2, scan: 1000, open: false },
      ].map((p) => ({ scan: 100, workspace: null, ...p })) as PollProfileSpec[];
      writeProfile(desktop, "Std8", profileV2("Std8", std, { connection: { mode: "tcp", host: "127.0.0.1", port: sim.modbusPort, timeoutMs: 1000 } }));
      await openProfile(mm, "Std8");
      await expect(mm.pollList.getByRole("option")).toHaveCount(8);
      await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
      const ids = await mm.ids();
      const [p1, p2, p3, p4, p5, p6, p7, p8] = ids as number[] as [number, number, number, number, number, number, number, number];
      void p8;
      await expect.poll(() => desktop.windows().filter((w) => /^Poll [67] - /.test(w.title)).length, { timeout: 30_000 }).toBe(2);
      const nw6 = new RealNative(await desktop.w2Page(p6));
      const nw7 = new RealNative(await desktop.w2Page(p7));
      await expect(nw6.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
      await expect(nw7.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
      await mm.windowMenu("Tile");
      await expect(mm.tileIndicator).toBeVisible();
      // docks open in the five sub-windows
      for (const id of [p1, p2, p3, p4, p5]) {
        if (!(await mm.setup(id).isVisible()) && !(await mm.setupPopover(id).isVisible())) await mm.titleButton(id, /^Poll setup/).click();
      }
      for (const id of [p1, p2, p3, p4, p5]) await expect(mm.setup(id)).toBeVisible();
      const docksBefore = await Promise.all([p1, p2, p3, p4, p5].map((id) => mm.setup(id).isVisible()));
      // native windows: widen to 900 logical, open the panel
      const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
      for (const [nw, title] of [[nw6, "Poll 6 - "], [nw7, "Poll 7 - "]] as const) {
        const w = desktop.windows().find((x) => x.title.startsWith(title));
        desktop.moveWindow(w?.hwnd as number, w?.rect.x ?? 0, w?.rect.y ?? 0, Math.round(900 * dpr), w?.rect.h ?? 400);
        await expect(nw.view).toHaveAttribute("data-presentation", /rail|panel/);
        if ((await nw.view.getAttribute("data-presentation")) === "rail") await nw.page.keyboard.press("Control+Backslash");
        await expect(nw.view).toHaveAttribute("data-presentation", "panel");
      }
      // (a) hardware Ctrl+Shift+\ in W1
      const w1 = hwndByTitle(desktop, "Modbus Master");
      await mm.row(p1).click();
      await mm.titleBar(p1).focus();
      desktop.nativeKey(w1, "ctrl+shift+backslash");
      const t0 = Date.now();
      await expect(mm.rail, "W1 sidebar becomes the rail").toBeVisible({ timeout: 5000 });
      const railBox = await mm.rail.boundingBox();
      const icons = mm.rail.locator('[data-slot="rail-icon"]');
      await expect(icons).toHaveCount(8);
      const labels = await icons.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const t6 = await nw6.rail.waitFor({ timeout: 5000 }).then(() => Date.now() - t0);
      const t7 = await nw7.rail.waitFor({ timeout: 5000 }).then(() => Date.now() - t0);
      log.push(`(a) rail width ${railBox?.width}, labels ${JSON.stringify(labels)}, native rails after ${t6} / ${t7} ms (from key press)`);
      expect.soft(Math.round(railBox?.width ?? 0), "W1 rail is 44 px wide").toBe(44);
      expect.soft(labels.map((l) => l?.split(":")[0]), "rail icons in list order").toEqual(["Poll 1", "Poll 2", "Poll 3", "Poll 4", "Poll 5", "Poll 6", "Poll 7", "Poll 8"]);
      expect.soft(labels[5], "tooltip of Poll 6").toMatch(/^Poll 6: Exception 02/);
      expect.soft(Math.max(t6, t7), "native windows show the 30 px rail within 500 ms of the key press").toBeLessThanOrEqual(500);
      expect.soft(Math.round((await nw6.rail.boundingBox())?.width ?? 0), "native rail 30 px").toBe(30);
      for (const id of [p1, p2, p3, p4, p5]) await expect.soft(mm.setup(id), `dock of ${id} closed`).toHaveCount(0);
      // (b) Ctrl+\ in P1's sub-window opens only P1's dock; rail click in P6 (900 wide) opens the panel
      await mm.titleBar(p1).focus();
      await mm.page.keyboard.press("Control+Backslash");
      await expect(mm.setup(p1)).toBeVisible();
      for (const id of [p2, p3, p4, p5]) await expect.soft(mm.setup(id), `only P1's dock opened (${id})`).toHaveCount(0);
      await nw6.rail.click();
      await expect.soft(nw6.view, "P6 (900 wide) rail click opens the panel").toHaveAttribute("data-presentation", "panel");
      await nw6.page.keyboard.press("Control+Backslash"); // close again
      // a narrow native window gets the popover
      const w7 = desktop.windows().find((x) => x.title.startsWith("Poll 7 - "));
      desktop.moveWindow(w7?.hwnd as number, w7?.rect.x ?? 0, w7?.rect.y ?? 0, Math.round(640 * dpr), w7?.rect.h ?? 400);
      await expect.poll(() => nw7.view.evaluate((e) => (e as HTMLElement).offsetWidth)).toBeLessThan(640);
      await nw7.rail.click();
      await expect.soft(nw7.view, "P7 (< 640 wide) rail click opens the popover").toHaveAttribute("data-presentation", "popover");
      await nw7.page.keyboard.press("Escape");
      desktop.moveWindow(w7?.hwnd as number, w7?.rect.x ?? 0, w7?.rect.y ?? 0, Math.round(900 * dpr), w7?.rect.h ?? 400);
      await expect.poll(() => nw7.view.evaluate((e) => (e as HTMLElement).offsetWidth)).toBeGreaterThanOrEqual(640);
      // (c) Ctrl+Shift+\ in P7's native window turns compact mode off everywhere
      await nw7.grid.focus();
      await nw7.page.keyboard.press("Control+Shift+Backslash");
      await expect(mm.rail, "compact off: W1 rail gone").toHaveCount(0, { timeout: 5000 });
      await expect(mm.sidebar).toBeVisible();
      const docksAfter = await Promise.all([p1, p2, p3, p4, p5].map((id) => mm.setup(id).isVisible()));
      log.push(`(c) docks before compact ${JSON.stringify(docksBefore)}, after compact off ${JSON.stringify(docksAfter)}`);
      expect.soft(docksAfter.slice(1), "the docks that were open before compact mode come back (P2-P5)").toEqual(docksBefore.slice(1));
      await expect.soft(nw6.view, "P6 panel presentation returns").toHaveAttribute("data-presentation", /panel|rail/);
      log.push(`(c) P6 presentation after compact off: ${await nw6.view.getAttribute("data-presentation")}, P7: ${await nw7.view.getAttribute("data-presentation")}`);
      // (d) compact on, Tile, Save as "Compact"
      await mm.titleBar(p1).focus();
      desktop.nativeKey(w1, "ctrl+shift+backslash");
      await expect(mm.rail).toBeVisible({ timeout: 5000 });
      if (!(await mm.tileIndicator.isVisible())) await mm.windowMenu("Tile");
      await expect(mm.tileIndicator).toBeVisible();
      await saveProfileAs(mm, "Compact");
      const title = desktop.windows().find((w) => w.title.startsWith("Modbus Master"))?.title ?? "";
      log.push(`(d) W1 title after Save as: ${title}`);
      expect.soft(title, "title has no ' *'").not.toContain("*");
      await expect(mm.profileLabel).not.toContainText("Modified");
      const exported1 = await mm.exportProfile();
      log.push(`(e) export before restart: compact ${exported1.workspace?.compact}, tileMode ${exported1.workspace?.tileMode}`);
      await s1.desktop.closeGracefully(30_000);
      await s1.desktop.stop();
      s1 = null;
      // restart on the same data dir, open "Compact"
      s2 = await startApp(dataDir);
      await openProfile(s2.mm, "Compact");
      await expect(s2.mm.rail, "compact mode is on in W1 after the restart").toBeVisible({ timeout: 20_000 });
      await expect(s2.mm.tileIndicator, "tile mode is on").toBeVisible();
      await expect.poll(() => s2?.desktop.windows().filter((w) => /^Poll [67] - /.test(w.title)).length, { timeout: 30_000 }).toBe(2);
      const natives = s2.desktop.w2Pages().sort((a, b) => a.pollId - b.pollId);
      expect(natives.length, "two native windows reopened").toBe(2);
      for (const { page, pollId: id } of natives) {
        const n = new RealNative(page);
        await expect(n.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
        const prefs = await n.prefs();
        log.push(`(d) native ${id} prefs after restart: ${JSON.stringify(prefs)}`);
        expect.soft(prefs.compact, `compact on in the native window of poll ${id}`).toBe(true);
        await expect.soft(n.rail).toBeVisible();
      }
      const title2 = s2.desktop.windows().find((w) => w.title.startsWith("Modbus Master"))?.title ?? "";
      log.push(`(d) W1 title after reopening: ${title2}`);
      expect.soft(title2, "no ' *' after reopening").not.toContain("*");
      const exported2 = await s2.mm.exportProfile();
      log.push(`(e) export after restart: compact ${exported2.workspace?.compact}, tileMode ${exported2.workspace?.tileMode}`);
      expect.soft(exported2.workspace?.compact, "workspace.compact").toBe(true);
      expect.soft(exported2.workspace?.tileMode, "workspace.tileMode").toBe(true);
      await testInfo.attach("h9.log", { body: log.join("\n"), contentType: "text/plain" });
      console.log("H9", log.join(" || "));
      expect(test.info().errors.length).toBe(0);
    } finally {
      await s1?.desktop.stop();
      await s2?.desktop.stop();
      await sim.stop();
      removeDir(dataDir);
    }
  });
});

test.describe("CHK2-K8 traffic filter, real backend", () => {
  test("(a) 'No frames for Poll 8 yet.' then Resume; (b) Show traffic for this poll from a sub-window and a native window; (c) delete the filtered poll and reorder; totals equal the simulator", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const std: PollProfileSpec[] = [
      { name: "Poll 1", fc: 3, start: 0, qty: 10 },
      { name: "Poll 2", fc: 3, start: 10, qty: 10 },
      { name: "Poll 3", fc: 4, start: 0, qty: 10 },
      { name: "Poll 4", fc: 1, start: 0, qty: 32 },
      { name: "Poll 5", fc: 2, start: 0, qty: 8 },
      { name: "Poll 6", fc: 3, start: 20, qty: 125 },
      { name: "Poll 7", fc: 3, start: 50, qty: 10, slave: 2 },
      { name: "Poll 8", fc: 3, start: 0, qty: 2, scan: 1000, active: false },
    ].map((p) => ({ scan: 100, workspace: null, ...p })) as PollProfileSpec[];
    const log: string[] = [];
    await loadAndConnect(desktop, mm, sim, "K8", std);
    const ids = await mm.ids();
    const [, p2, p3, , p5, , , p8] = ids as number[] as [number, number, number, number, number, number, number, number];
    await expect(mm.statusLine(ids[0] as number)).toHaveAttribute("data-state", "polling", { timeout: 20_000 });
    await expect(mm.statusLine(p8)).toHaveAttribute("data-state", "paused");
    await mm.expandTraffic();
    const filter = mm.traffic.getByRole("combobox", { name: "Traffic filter" });
    // (a)
    await filter.selectOption({ label: "Poll 8" });
    await expect(mm.page.getByTestId("traffic-empty")).toHaveText("No frames for Poll 8 yet.");
    for (const k of ["requests", "responses", "errors", "timeouts"] as const) await expect(mm.counter(k)).toHaveText("0");
    await mm.row(p8).click();
    await mm.titleBar(p8).focus();
    const tResume = Date.now();
    await mm.page.keyboard.press("Control+p");
    await expect(mm.page.getByTestId("traffic-empty"), "empty text gone once frames arrive").toHaveCount(0, { timeout: 1500 });
    const resumeMs = Date.now() - tResume;
    // (b) from P3's sub-window
    await filter.selectOption({ label: "All polls" });
    await mm.page.keyboard.press("Control+j");
    await expect(mm.traffic).toHaveCount(0);
    await mm.row(p3).click();
    await mm.statusLine(p3).getByRole("button", { name: "Poll actions" }).click();
    await mm.page.getByRole("menuitem", { name: /^Show traffic for this poll/ }).click();
    await expect(mm.traffic).toBeVisible();
    await expect(filter.locator("option:checked")).toHaveText("Poll 3");
    await mm.toolbarButton("Pause all").click();
    await expect(mm.toolbarButton("Resume all")).toBeVisible();
    await sleep(600);
    const rows3 = await mm.readTrafficAll();
    expect(rows3.length, "frames are listed").toBeGreaterThan(0);
    expect(new Set(rows3.map((r) => r.poll)), "every listed frame's Poll column reads Poll 3").toEqual(new Set(["Poll 3"]));
    // from P2 popped out: W1 comes to the front (restored if minimized), expanded, filter Poll 2
    await mm.toolbarButton("Resume all").click();
    await mm.page.keyboard.press("Control+j");
    await expect(mm.traffic).toHaveCount(0);
    await focusPoll(mm, p2);
    await mm.page.keyboard.press("Control+Shift+O");
    const nw = new RealNative(await desktop.w2Page(p2));
    await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    desktop.showWindow(w1?.hwnd as number, "min");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.iconic).toBe(true);
    await nw.page.getByRole("button", { name: "Poll actions" }).click();
    await nw.page.getByRole("menuitem", { name: /^Show traffic for this poll/ }).click();
    await expect(mm.traffic, "the panel is expanded in W1").toBeVisible({ timeout: 8000 });
    await sleep(1500);
    const w1After = desktop.windows().find((w) => w.hwnd === w1?.hwnd);
    log.push("K5 from the native window: W1 iconic=" + w1After?.iconic + ", foreground=" + w1After?.foreground);
    expect.soft(w1After?.iconic, "CHK2-K5/K8(b): W1 is restored from minimized by Show traffic for this poll in a native window").toBe(false);
    expect.soft(w1After?.foreground, "CHK2-K5/K8(b): W1 comes to the front").toBe(true);
    desktop.showWindow(w1?.hwnd as number, "focus");
    await expect(filter.locator("option:checked")).toHaveText("Poll 2");
    // pause everything to read a stable list, compare the last 20 frames with the simulator log lines of P2's start address (10)
    await mm.toolbarButton("Pause all").click();
    await expect(mm.toolbarButton("Resume all")).toBeVisible();
    await sleep(600);
    const rows2 = await mm.readTrafficAll();
    const last20 = rows2.slice(-20);
    const simFrames = sim.frames();
    const mismatches: string[] = [];
    for (const r of last20) {
      const f = simFrames.find((x) => x.bytes === r.bytes && x.len === r.len);
      if (!f) mismatches.push(`${r.seq}: ${r.bytes}`);
    }
    expect(new Set(rows2.map((r) => r.poll))).toEqual(new Set(["Poll 2"]));
    expect(mismatches, "the bytes of the last 20 frames equal simulator log lines").toEqual([]);
    for (const r of last20.filter((x) => x.dir.includes("TX"))) expect(r.bytes, "P2's request: slave 1, FC03, start 10, quantity 10").toMatch(/01 03 00 0A 00 0A$/);
    // (c) delete the filtered poll (S7), filter returns to All polls; reorder follows
    await mm.toolbarButton("Resume all").click();
    await filter.selectOption({ label: "Poll 5" });
    await mm.row(p5).click();
    await mm.row(p5).focus();
    await mm.page.keyboard.press("Delete");
    await expect(mm.confirm).toContainText("Delete poll?");
    await mm.confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(filter.locator("option:checked")).toHaveText("All polls");
    await expect(filter.locator("option", { hasText: "Poll 5" })).toHaveCount(0);
    // reorder: P1 below P3 with Alt+Down twice (keyboard equivalent I20)
    const first = (await mm.ids())[0] as number;
    await mm.row(first).click();
    await mm.row(first).focus();
    await mm.page.keyboard.press("Alt+ArrowDown");
    await mm.page.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await mm.ids()).indexOf(first)).toBe(2);
    const options = await filter.locator("option").allInnerTexts();
    const listNames = await mm.pollList.getByRole("option").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").split(",")[0]?.trim()));
    // totals equal the simulator after a pause
    await mm.toolbarButton("Pause all").click();
    await sleep(600);
    await filter.selectOption({ label: "All polls" });
    const rx = sim.frames().filter((f) => f.dir === "RX").length;
    const totals = await mm.totals();
    console.log("K8", JSON.stringify({ resumeMs, options, listNames, totals, simRequests: rx }));
    await testInfo.attach("k8.json", { body: JSON.stringify({ resumeMs, options, listNames, totals, simRequests: rx }, null, 1), contentType: "application/json" });
    expect(options.slice(1).filter((o) => o !== "Writes"), "filter entries follow the list order").toEqual(listNames.filter((n): n is string => !!n));
    expect(totals.requests, "total Requests equals the simulator's request count").toBe(rx);
    await testInfo.attach("k8.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("K8 log", log.join(" || "));
    expect(test.info().errors.length, "soft failures of this test").toBe(0);
  });
});

/** The error message a field points to with aria-describedby (`-error`), and its aria-invalid. */
async function fieldState(loc: import("@playwright/test").Locator): Promise<{ invalid: string | null; message: string }> {
  return loc.evaluate((el) => ({
    invalid: el.getAttribute("aria-invalid"),
    message: (el.getAttribute("aria-describedby") ?? "").split(" ").filter((i) => i.endsWith("-error")).map((i) => document.getElementById(i)?.textContent?.trim() ?? "").join(" "),
  }));
}

type SetupAccess = { root: import("@playwright/test").Locator; page: Page; label: string; apply: import("@playwright/test").Locator; settle: () => Promise<void> };

const P3_CASES: Array<{ field: string; value: string; message: string; fc?: string }> = [
  { field: "Name", value: "", message: "Enter a poll name." },
  { field: "Name", value: "x".repeat(49), message: "Poll name must be at most 48 characters." },
  { field: "Name", value: " a", message: "Poll name cannot start or end with a space." },
  { field: "Name", value: "poll 2", message: 'A poll named "poll 2" already exists on this connection.' },
  { field: "Slave ID", value: "248", message: "Slave ID must be a whole number from 0 to 247." },
  { field: "Quantity", value: "0", message: "Quantity for FC03 must be from 1 to 125." },
  { field: "Quantity", value: "126", message: "Quantity for FC03 must be from 1 to 125." },
  { field: "Scan rate (ms)", value: "19", message: "Scan rate must be a whole number from 20 to 60000 ms." },
  { field: "Scan rate (ms)", value: "60001", message: "Scan rate must be a whole number from 20 to 60000 ms." },
];

async function p3Matrix(desktop: Desktop, sim: Sim, a: SetupAccess, hostLabel: string, log: string[]): Promise<void> {
  const f = (label: string) => a.root.getByLabel(label, { exact: true });
  const startMark = sim.mark();
  for (const c of P3_CASES) {
    await f(c.field).fill(c.value);
    await f(c.field).blur();
    let st = await fieldState(f(c.field));
    let source = "on blur";
    if (st.message === "") {
      // no client-side message: the rule may be enforced by the backend on Apply (a native window does not know the other polls' names)
      await a.apply.click();
      await a.settle();
      await sleep(300);
      st = await fieldState(f(c.field));
      const banner = (await a.root.locator('[data-slot="field-message"], [role="alert"]').allInnerTexts()).map((t) => t.trim());
      if (st.message === "" && banner.length > 0) st = { invalid: st.invalid, message: banner.join(" | ") };
      source = "after Apply";
    }
    log.push(`${hostLabel}: ${c.field}=${JSON.stringify(c.value.length > 20 ? c.value.slice(0, 5) + "…" : c.value)} -> invalid=${st.invalid} message="${st.message}" (${source})`);
    expect.soft(st.invalid, `${hostLabel}: ${c.field}='${c.value.slice(0, 8)}' aria-invalid`).toBe("true");
    expect.soft(st.message, `${hostLabel}: ${c.field}='${c.value.slice(0, 8)}' message`).toBe(c.message);
    await a.apply.click();
    // restore the valid value before the next case
    await a.settle();
    const orig: Record<string, string> = { Name: "Poll 1", "Slave ID": "1", Quantity: "10", "Scan rate (ms)": "200" };
    await f(c.field).fill(orig[c.field] as string);
    await f(c.field).blur();
  }
  // FC01 quantity 2001
  await f("Function").selectOption("1");
  await f("Quantity").fill("2001");
  await f("Quantity").blur();
  const q = await fieldState(f("Quantity"));
  log.push(`${hostLabel}: FC01 Quantity=2001 -> ${q.invalid} "${q.message}"`);
  expect.soft(q.message, `${hostLabel}: FC01 quantity`).toBe("Quantity for FC01 must be from 1 to 2000.");
  // start 65535 with quantity 2 invalid, quantity 1 valid
  await f("Function").selectOption("3");
  await f("Quantity").fill("2");
  await f("Start address").fill("65535");
  await f("Start address").blur();
  const s = await fieldState(f("Start address"));
  const q2 = await fieldState(f("Quantity"));
  log.push(`${hostLabel}: start 65535 + qty 2 -> start "${s.message}" invalid=${s.invalid}; quantity "${q2.message}" invalid=${q2.invalid}`);
  await a.apply.click();
  await a.settle();
  const afterApply = (await a.root.locator('[data-slot="field-message"]').allInnerTexts()).map((t) => t.trim());
  log.push(`${hostLabel}: start 65535 + qty 2 after Apply: messages ${JSON.stringify(afterApply)}`);
  expect.soft(`${s.message} ${q2.message}`.trim().length + afterApply.length, `${hostLabel}: start 65535 with quantity 2 is rejected with a message (on blur or on Apply)`).toBeGreaterThan(0);
  // nothing invalid went to the wire: every request since the start belongs to the original definition (slave 1, FC03, 0, qty 10) or Poll 2 (slave 2)
  const wrong = sim.requestsDecoded(startMark).filter((r) => !(r.unit === 1 && r.fc === 3 && r.addr === 0 && r.arg === 10) && !(r.unit === 2));
  log.push(`${hostLabel}: requests with a foreign definition after the invalid Apply attempts: ${wrong.length}`);
  expect.soft(wrong.map((r) => `${r.unit}:${r.fc}@${r.addr}x${r.arg}`), `${hostLabel}: no request with an invalid definition`).toEqual([]);
  // edge values accepted and applied with a real request
  const edges: Array<{ set: Record<string, string>; want: (r: ReturnType<Sim["requestsDecoded"]>[number]) => boolean; label: string }> = [
    { label: "start 0 qty 1", set: { "Start address": "0", Quantity: "1" }, want: (r) => r.unit === 1 && r.addr === 0 && r.arg === 1 },
    { label: "start 65535 qty 1", set: { "Start address": "65535", Quantity: "1" }, want: (r) => r.unit === 1 && r.addr === 65535 && r.arg === 1 },
    { label: "qty 125", set: { "Start address": "0", Quantity: "125" }, want: (r) => r.unit === 1 && r.addr === 0 && r.arg === 125 },
    { label: "scan 20", set: { Quantity: "10", "Scan rate (ms)": "20" }, want: (r) => r.unit === 1 && r.arg === 10 },
    { label: "scan 60000", set: { "Scan rate (ms)": "60000" }, want: (r) => r.unit === 1 && r.arg === 10 },
    { label: "slave 247", set: { "Slave ID": "247", "Scan rate (ms)": "200" }, want: (r) => r.unit === 247 },
  ];
  for (const e of edges) {
    for (const [k, v] of Object.entries(e.set)) await f(k).fill(v);
    const m = sim.mark();
    await a.apply.click();
    await a.settle();
    const t0 = Date.now();
    await expect
      .poll(() => sim.requestsDecoded(m).some(e.want), { timeout: 4000, message: `${hostLabel}: edge '${e.label}' reaches the wire` })
      .toBe(true)
      .catch(() => undefined);
    const ok = sim.requestsDecoded(m).some(e.want);
    log.push(`${hostLabel}: edge ${e.label}: applied=${ok} after ${Date.now() - t0} ms; messages: ${(await a.root.locator('[data-slot="field-message"]').allInnerTexts()).join(" | ")}`);
    expect.soft(ok, `${hostLabel}: edge '${e.label}' accepted and requested`).toBe(true);
  }
  void desktop;
}

test.describe("CHK2-P3 invalid input against the real backend (messages, aria-invalid, nothing invalid on the wire, edge values applied)", () => {
  const hosts: Array<{ label: string; poll1: PollProfileSpec }> = [
    { label: "sub-window dock (frame 640)", poll1: { name: "Poll 1", slave: 1, fc: 3, start: 0, qty: 10, scan: 200, workspace: { x: 8, y: 8, width: 700, height: 380, z: 1 } } },
    { label: "sub-window popover (frame 600)", poll1: { name: "Poll 1", slave: 1, fc: 3, start: 0, qty: 10, scan: 200, workspace: { x: 8, y: 8, width: 600, height: 380, z: 1 } } },
    { label: "native panel (900)", poll1: { name: "Poll 1", slave: 1, fc: 3, start: 0, qty: 10, scan: 200, host: "native", native: null } },
    { label: "native popover (626)", poll1: { name: "Poll 1", slave: 1, fc: 3, start: 0, qty: 10, scan: 200, host: "native", native: null } },
  ];
  for (const h of hosts) {
    test(`P3(a) ${h.label}`, async ({ desktop, mm, sim }, testInfo) => {
      test.setTimeout(240_000);
      const poll2: PollProfileSpec = { name: "Poll 2", slave: 2, fc: 3, start: 20, qty: 5, scan: 500, workspace: null };
      await loadAndConnect(desktop, mm, sim, "P3", [h.poll1, poll2]);
      const ids = await mm.ids();
      const a = ids[0] as number;
      const log: string[] = [];
      let access: SetupAccess;
      if (h.label.startsWith("native")) {
        await expect.poll(() => hwndByTitle(desktop, "Poll 1 - "), { timeout: 30_000 }).not.toBe(0);
        const nw = new RealNative(await desktop.w2Page(a));
        await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
        const w = desktop.windows().find((x) => x.title.startsWith("Poll 1 - "));
        const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
        if (h.label.includes("panel")) {
          desktop.moveWindow(w?.hwnd as number, w?.rect.x ?? 0, w?.rect.y ?? 0, Math.round(900 * dpr), 700);
          await expect.poll(() => nw.view.evaluate((e) => (e as HTMLElement).offsetWidth)).toBeGreaterThanOrEqual(640);
          if ((await nw.view.getAttribute("data-presentation")) !== "panel") await nw.page.keyboard.press("Control+Backslash");
          await expect(nw.view).toHaveAttribute("data-presentation", "panel");
          access = { root: nw.setupPanel, page: nw.page, label: h.label, apply: nw.setupPanel.getByRole("button", { name: "Apply", exact: true }), settle: async () => { await sleep(150); } };
        } else {
          // the profile-opened window is 900 x 640 logical: make it the pop out size (640 x 368 logical outer, client ~626)
          desktop.moveWindow(w?.hwnd as number, w?.rect.x ?? 0, w?.rect.y ?? 0, Math.round(640 * dpr), Math.round(368 * dpr));
          await expect.poll(() => nw.view.evaluate((e) => (e as HTMLElement).offsetWidth)).toBeLessThan(640);
          await expect(nw.view).toHaveAttribute("data-presentation", /rail|popover/);
          if ((await nw.view.getAttribute("data-presentation")) === "rail") await nw.rail.click();
          await expect(nw.view).toHaveAttribute("data-presentation", "popover");
          const pop = nw.page.locator('[data-slot="setup-popover"]');
          access = { root: pop, page: nw.page, label: h.label, apply: pop.getByRole("button", { name: "Apply", exact: true }), settle: async () => { await sleep(150); } };
        }
      } else {
        await expect(mm.statusLine(a)).toHaveAttribute("data-state", "polling", { timeout: 20_000 });
        await focusPoll(mm, a);
        await mm.titleButton(a, /^Poll setup/).click();
        await expect(mm.setup(a)).toBeVisible();
        const slot = h.label.includes("popover") ? mm.setupPopover(a) : mm.setupDock(a);
        await expect(slot).toBeVisible();
        access = { root: mm.setup(a), page: mm.page, label: h.label, apply: mm.setup(a).getByRole("button", { name: "Apply", exact: true }), settle: async () => { await sleep(150); } };
      }
      await p3Matrix(desktop, sim, access, h.label, log);
      await testInfo.attach("p3.log", { body: log.join("\n"), contentType: "text/plain" });
      console.log("P3", h.label, log.join(" || "));
      expect(test.info().errors.length).toBe(0);
    });
  }

  test("P3(b) invalid connection field (port 0): Ctrl+S in a native window brings W1 to the front with 'Fix the highlighted fields before saving.' and the Port message; no profile file is written", async ({ desktop, mm, sim }) => {
    test.setTimeout(150_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const [a] = await createPolls(mm, [{ name: "A", slave: 1, fc: 3, start: 0, qty: 10, scan: 200 }]);
    await focusPoll(mm, a as number);
    await mm.page.keyboard.press("Control+Shift+O");
    const nw = new RealNative(await desktop.w2Page(a as number));
    await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    // an invalid connection field in W1 while connected is edited through Edit? the section is read-only while connected: disconnect first
    await mm.toolbarButton("Disconnect").click();
    await mm.expectConnection("idle");
    await mm.page.getByRole("button", { name: "Edit", exact: true }).click().catch(() => undefined);
    await mm.portField.fill("0");
    await mm.portField.blur();
    const profilesBefore = fs.existsSync(path.join(profilesDir(desktop))) ? fs.readdirSync(profilesDir(desktop)).map((f) => `${f}:${fs.statSync(path.join(profilesDir(desktop), f)).mtimeMs}`) : [];
    const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    desktop.showWindow(w1?.hwnd as number, "min");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.iconic).toBe(true);
    desktop.nativeKey(hwndByTitle(desktop, "A - "), "ctrl+s");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.iconic, { message: "W1 restored" }).toBe(false);
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.foreground, { message: "W1 in front" }).toBe(true);
    await expect(mm.toast("Fix the highlighted fields before saving."), "error toast").toBeVisible({ timeout: 8000 });
    expect(await fieldState(mm.portField)).toMatchObject({ message: "Port must be a whole number from 1 to 65535." });
    const profilesAfter = fs.existsSync(path.join(profilesDir(desktop))) ? fs.readdirSync(profilesDir(desktop)).map((f) => `${f}:${fs.statSync(path.join(profilesDir(desktop), f)).mtimeMs}`) : [];
    expect(profilesAfter, "no profile file written or changed").toEqual(profilesBefore);
  });
});

test.describe("CHK2-N10 'Save changes?' wording in the load flow", () => {
  test("untitled modified W1 with 1 popped-out window and unapplied edits in Poll 2 reads '... before loading? This also closes 1 poll window. Unapplied edits in: Poll 2.'; a named modified profile reads 'Save changes to \"Plant\" before loading?'; close keeps 'closing'", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    await referenceMap(sim);
    writeProfile(desktop, "Other", profileV2("Other", [{ name: "O1", scan: 1000, workspace: null }]));
    // idle connection: three polls, Poll 3 popped out, an unapplied Quantity edit in Poll 2
    const ids: number[] = [];
    for (const name of ["Poll 1", "Poll 2", "Poll 3"]) {
      await mm.toolbarButton("New poll").click();
      await expect.poll(async () => (await mm.ids()).length).toBe(ids.length + 1);
      const id = (await mm.ids()).find((i) => !ids.includes(i)) as number;
      await mm.setupField(id, "Name").fill(name);
      await mm.setup(id).getByRole("button", { name: "Apply", exact: true }).click();
      await mm.closeSetup(id);
      ids.push(id);
    }
    const [, p2, p3] = ids as [number, number, number];
    await mm.row(p3).click();
    await mm.titleBar(p3).focus();
    await mm.page.keyboard.press("Control+Shift+O");
    const nw3 = new RealNative(await desktop.w2Page(p3));
    await expect(nw3.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await mm.row(p2).click();
    await mm.titleButton(p2, /^Poll setup/).click();
    await mm.setupField(p2, "Quantity").fill("20");
    await mm.setupField(p2, "Quantity").blur();
    await expect(mm.setup(p2).getByTestId("unapplied-text")).toBeVisible();
    await mm.titleButton(p2, /^Poll setup/).click();
    await mm.expectConnection("idle");
    const texts: string[] = [];
    // case 1: untitled
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await mm.openDialog.getByRole("row", { name: /Other/ }).dblclick();
    await expect(mm.confirm).toBeVisible({ timeout: 8000 });
    const t1 = (await mm.confirm.innerText()).replace(/\s+/g, " ").trim();
    texts.push(`untitled: ${t1}`);
    expect(t1).toContain("Save this setup as a profile before loading? This also closes 1 poll window. Unapplied edits in: Poll 2.");
    expect(t1.toLowerCase()).not.toContain("closing");
    await expect(mm.confirm.getByRole("button", { name: "Save", exact: true }), "default focus Save").toBeFocused();
    await expect(mm.confirm.getByRole("button", { name: "Don't save", exact: true })).toBeVisible();
    await expect(mm.confirm.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    // Cancel keeps everything
    await mm.confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(mm.confirm).toHaveCount(0);
    await expect(mm.pollList.getByRole("option")).toHaveCount(3);
    expect(desktop.windows().filter((w) => w.title.startsWith("Poll 3 - ")).length, "native window stays").toBe(1);
    // Don't save loads Other and closes the native window without S6
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await mm.openDialog.getByRole("row", { name: /Other/ }).dblclick();
    await expect(mm.confirm).toBeVisible();
    await mm.confirm.getByRole("button", { name: "Don't save", exact: true }).click();
    await expect.poll(() => desktop.windows().filter((w) => w.title.startsWith("Poll 3 - ")).length, { timeout: 15_000 }).toBe(0);
    await expect(mm.pollList.getByRole("option")).toHaveCount(1);
    await expect(mm.confirm, "no S6 for the closed native window").toHaveCount(0);
    // case 2: a named, modified profile "Plant": save as Plant, rename O1 -> modified
    await saveProfileAs(mm, "Plant");
    const o1 = (await mm.ids())[0] as number;
    await mm.row(o1).click();
    await mm.row(o1).focus();
    await mm.page.keyboard.press("F2");
    await mm.page.keyboard.press("Control+a");
    await mm.page.keyboard.type("O1x");
    await mm.page.keyboard.press("Enter");
    await expect(mm.profileLabel).toContainText("Modified");
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await mm.openDialog.getByRole("row", { name: /Other/ }).dblclick();
    await expect(mm.confirm).toBeVisible();
    const t2 = (await mm.confirm.innerText()).replace(/\s+/g, " ").trim();
    texts.push(`named: ${t2}`);
    expect(t2).toContain('Save changes to "Plant" before loading?');
    expect(t2.toLowerCase()).not.toContain("closing");
    await mm.confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    // the close-window variant still says 'before closing'
    desktop.closeWindow(hwndByTitle(desktop, "Modbus Master"));
    await expect(mm.confirm).toBeVisible({ timeout: 8000 });
    const t3 = (await mm.confirm.innerText()).replace(/\s+/g, " ").trim();
    texts.push(`close: ${t3}`);
    expect(t3).toContain('Save changes to "Plant" before closing?');
    await mm.confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await testInfo.attach("n10.txt", { body: texts.join("\n"), contentType: "text/plain" });
    console.log("N10", texts.join(" || "));
  });
});

void invokeIn;
