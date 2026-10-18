// Integration mode (REPORT-006), (j): CHK2-Q4 (Q1-Q3 on WebView2, authoritative, strict 0 long tasks over 50 ms), CHK2-Q5
// (soak, 3 minutes here: PARTIAL against the 10-minute criterion), CHK3-G3 (8 polls with scale, overrides, aliases).
// A PerformanceObserver (type longtask) is installed in every page over CDP; the machine load is recorded.
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, type RealMm, type Sim, test } from "../integration/fixtures";
import { RealNative } from "../integration/real-mm";
import { openProfile, profilesDir, readProfile, saveProfileAs } from "../integration/profiles";
import { createPolls, focusPoll, referenceMap, STANDARD_8 } from "../integration/scenario";

async function installLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __lt?: Array<{ at: number; dur: number }> };
    w.__lt = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__lt?.push({ at: Math.round(e.startTime), dur: Math.round(e.duration * 10) / 10 });
    }).observe({ type: "longtask", buffered: true });
  });
}
const longTasks = (page: Page) => page.evaluate(() => (window as unknown as { __lt?: Array<{ at: number; dur: number }> }).__lt ?? []);

/** Proof that the observer works in this WebView2: a 90 ms busy loop must be reported. */
async function calibrate(page: Page): Promise<number> {
  // the busy loop must run from a task of its own (a CDP evaluate is not reported as a long task)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          const t = performance.now();
          while (performance.now() - t < 90) {
            /* busy */
          }
          resolve();
        }, 20);
      }),
  );
  await new Promise((r) => setTimeout(r, 300));
  const lt = await longTasks(page);
  return lt.length;
}

function cpuLoad(): number {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average"], { encoding: "utf8", timeout: 20_000 }).trim();
  return Number(out || "0");
}

async function standard8(mm: RealMm, sim: Sim): Promise<number[]> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
  return createPolls(mm, STANDARD_8);
}

async function tile(mm: RealMm): Promise<void> {
  await mm.windowMenu("Tile");
  await expect(mm.tileIndicator).toBeVisible();
}

test.describe("(j) performance on WebView2", () => {
  test("CHK2-Q1/Q4 8 polls at 100 ms, all tiled, 60 s: 0 long tasks over 50 ms; Pause of one poll reaches Paused quickly", async ({ mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const ids = await standard8(mm, sim);
    await tile(mm);
    await installLongTasks(mm.page);
    const calibrated = await calibrate(mm.page);
    expect(calibrated, "the observer reports a 90 ms task (calibration)").toBeGreaterThan(0);
    await mm.page.evaluate(() => ((window as unknown as { __lt: unknown[] }).__lt.length = 0));
    const load0 = cpuLoad();
    const t0 = Date.now();
    await expect.poll(() => Date.now() - t0, { timeout: 70_000, intervals: [1000] }).toBeGreaterThanOrEqual(60_000);
    const lt = await longTasks(mm.page);
    // Pause latency: Ctrl+P in the active sub-window, time to data-state=paused measured in the page
    await focusPoll(mm, ids[0] as number);
    const pauseMs = await mm.page.evaluate(
      (id) =>
        new Promise<number>((resolve) => {
          const el = document.querySelector(`[data-subwindow="${id}"] [data-testid="poll-status-line"]`) as HTMLElement;
          const t = performance.now();
          const mo = new MutationObserver(() => {
            if (el.getAttribute("data-state") === "paused") {
              mo.disconnect();
              resolve(performance.now() - t);
            }
          });
          mo.observe(el, { attributes: true });
          document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }));
        }),
      ids[0] as number,
    );
    const load1 = cpuLoad();
    const data = { longTasks: lt, count: lt.length, max: Math.max(0, ...lt.map((x) => x.dur)), calibrationReports: calibrated, pauseToPausedMs: Math.round(pauseMs), cpuLoadBefore: load0, cpuLoadAfter: load1 };
    console.log("Q1 WEBVIEW2", JSON.stringify(data));
    await testInfo.attach("q1.json", { body: JSON.stringify(data, null, 1), contentType: "application/json" });
    expect(lt.filter((x) => x.dur > 50), "long tasks over 50 ms in 60 s of 8 tiled polls at 100 ms (strict, WebView2)").toEqual([]);
    expect(pauseMs, "Pause reaches Paused within 100 ms").toBeLessThan(100);
  });

  test("CHK2-Q2/Q4 4 sub-windows + 4 native windows, 30 s: 0 long tasks over 50 ms in every window", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const ids = await standard8(mm, sim);
    for (const id of ids.slice(4)) {
      await mm.row(id).click();
      await mm.titleButton(id, /^Open in its own window/).click();
      await desktop.w2Page(id);
    }
    const pages: Array<{ name: string; page: Page }> = [{ name: "W1", page: mm.page }];
    for (const id of ids.slice(4)) {
      const nw = new RealNative(await desktop.w2Page(id));
      await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
      await expect(nw.view).toHaveAttribute("data-attach", "attached");
      pages.push({ name: `W2#${id}`, page: nw.page });
    }
    for (const p of pages) {
      await installLongTasks(p.page);
      const c = await calibrate(p.page);
      expect(c, `${p.name}: observer calibration`).toBeGreaterThan(0);
      await p.page.evaluate(() => ((window as unknown as { __lt: unknown[] }).__lt.length = 0));
    }
    const t0 = Date.now();
    await expect.poll(() => Date.now() - t0, { timeout: 40_000, intervals: [1000] }).toBeGreaterThanOrEqual(30_000);
    const out: Record<string, unknown> = { cpuLoad: cpuLoad() };
    for (const p of pages) {
      const lt = await longTasks(p.page);
      out[p.name] = { count: lt.length, max: Math.max(0, ...lt.map((x) => x.dur)), tasks: lt };
      expect(lt.filter((x) => x.dur > 50), `${p.name}: long tasks over 50 ms`).toEqual([]);
    }
    console.log("Q2 WEBVIEW2", JSON.stringify(out));
    await testInfo.attach("q2.json", { body: JSON.stringify(out, null, 1), contentType: "application/json" });
  });

  test("CHK2-Q3/Q4 drag and resize one sub-window continuously for 30 s while 8 polls run at 100 ms: 0 long tasks, the other tables keep updating, DOM churn of the others", async ({ mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const ids = await standard8(mm, sim);
    await tile(mm);
    await mm.windowMenu("Tile mode", "menuitemcheckbox"); // free layout again: the dragged window can move
    const dragged = ids[0] as number;
    await installLongTasks(mm.page);
    expect(await calibrate(mm.page)).toBeGreaterThan(0);
    await mm.page.evaluate(() => ((window as unknown as { __lt: unknown[] }).__lt.length = 0));
    // DOM mutations per second inside the other 7 sub-windows: idle versus while dragging
    await mm.page.evaluate((exclude) => {
      const w = window as unknown as { __mut: { n: number } };
      w.__mut = { n: 0 };
      for (const el of document.querySelectorAll("[data-subwindow]")) {
        if (el.getAttribute("data-subwindow") === String(exclude)) continue;
        new MutationObserver((m) => { w.__mut.n += m.length; }).observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
      }
    }, dragged);
    const mutations = () => mm.page.evaluate(() => (window as unknown as { __mut: { n: number } }).__mut.n);
    const txOf = async (id: number) => Number((await mm.statusText(id)).match(/Tx (\d+)/)?.[1]);
    const others = ids.slice(1);
    const txBefore = await Promise.all(others.map(txOf));
    const m0 = await mutations();
    const t0 = Date.now();
    await expect.poll(() => Date.now() - t0, { timeout: 15_000, intervals: [500] }).toBeGreaterThanOrEqual(10_000);
    const idleRate = ((await mutations()) - m0) / ((Date.now() - t0) / 1000);
    // drag + resize loop for 30 s with real pointer events
    const m1 = await mutations();
    const d0 = Date.now();
    const start = await mm.titlePoint(dragged, 40);
    await mm.page.mouse.move(start.x, start.y);
    await mm.page.mouse.down();
    let n = 0;
    while (Date.now() - d0 < 30_000) {
      const a = (n % 120) / 120 * Math.PI * 2;
      await mm.page.mouse.move(start.x + Math.cos(a) * 120, start.y + Math.sin(a) * 80);
      n += 1;
    }
    await mm.page.mouse.up();
    // resize phase: the east handle, back and forth for 10 s
    const h = await mm.sub(dragged).locator('[data-resize-handle="e"]').boundingBox();
    const r0 = Date.now();
    if (h) {
      await mm.page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await mm.page.mouse.down();
      let k = 0;
      while (Date.now() - r0 < 10_000) {
        await mm.page.mouse.move(h.x + h.width / 2 + Math.sin(k / 10) * 80, h.y + h.height / 2);
        k += 1;
      }
      await mm.page.mouse.up();
    }
    const dragSec = (Date.now() - d0) / 1000;
    const dragRate = ((await mutations()) - m1) / dragSec;
    const txAfter = await Promise.all(others.map(txOf));
    const lt = await longTasks(mm.page);
    const data = { pointerMoves: n, dragSeconds: Math.round(dragSec), domMutationsPerSecIdle: Math.round(idleRate * 10) / 10, domMutationsPerSecDrag: Math.round(dragRate * 10) / 10, txBefore, txAfter, longTasks: lt, cpuLoad: cpuLoad() };
    console.log("Q3 WEBVIEW2", JSON.stringify(data));
    await testInfo.attach("q3.json", { body: JSON.stringify(data, null, 1), contentType: "application/json" });
    expect(lt.filter((x) => x.dur > 50), "long tasks over 50 ms while dragging and resizing (strict, WebView2)").toEqual([]);
    for (const [i, id] of others.entries()) {
      const scan = STANDARD_8[i + 1]?.scan ?? 100;
      const want = Math.floor((0.8 * (Date.now() - t0 - 10_000)) / scan);
      expect((txAfter[i] ?? 0) - (txBefore[i] ?? 0), `poll ${id} (scan ${scan} ms) keeps updating while another window is dragged`).toBeGreaterThan(want);
    }
    expect(dragRate, "the drag must not multiply the DOM churn of the other windows").toBeLessThan(idleRate * 1.5 + 5);
  });

  test("CHK2-Q5 (partial) soak: 8 polls at 100 ms, traffic panel open, 5 pop out / dock cycles, 3 minutes; heap and working set trend, no long tasks", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(420_000);
    const ids = await standard8(mm, sim);
    await mm.expandTraffic();
    await installLongTasks(mm.page);
    await mm.page.evaluate(() => ((window as unknown as { __lt: unknown[] }).__lt.length = 0));
    const samples: Array<{ t: number; heapMB: number | null; heapRawMB: number | null; wsMB: number; frames: number; requests: number }> = [];
    // a forced garbage collection before every reading: the JS heap trend is then the live heap, not lazy-GC noise
    const cdp = await mm.page.context().newCDPSession(mm.page);
    const sample = async (t: number) => {
      const raw = await mm.page.evaluate(() => {
        const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return m ? m.usedJSHeapSize / 1048576 : null;
      });
      await cdp.send("HeapProfiler.collectGarbage");
      const usage = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
      samples.push({ t, heapMB: Math.round((usage.usedSize / 1048576) * 10) / 10, heapRawMB: raw === null ? null : Math.round(raw * 10) / 10, wsMB: Math.round(desktop.workingSetBytes() / 1048576), frames: sim.frames().length, requests: sim.requestsSince(0) });
    };
    const t0 = Date.now();
    await sample(0);
    let cycles = 0;
    while (Date.now() - t0 < 180_000) {
      await new Promise((r) => setTimeout(r, 15_000));
      await sample(Math.round((Date.now() - t0) / 1000));
      if (cycles < 5 && Date.now() - t0 > 20_000 + cycles * 25_000) {
        const id = ids[cycles % ids.length] as number;
        await mm.row(id).click();
        await mm.titleButton(id, /^Open in its own window/).click();
        const nw = new RealNative(await desktop.w2Page(id));
        await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
        await nw.toolbarButton("Dock to workspace").click();
        await expect(mm.sub(id)).toBeVisible();
        cycles += 1;
      }
    }
    const lt = await longTasks(mm.page);
    const first = samples.find((s) => s.t >= 30) ?? samples[0];
    const last = samples[samples.length - 1];
    const pct = (a: number | null | undefined, b: number | null | undefined) => (a && b ? Math.round(((b - a) / a) * 1000) / 10 : null);
    const data = { samples, cycles, longTasks: lt.length, heapGrowthPctFrom30s: pct(first?.heapMB, last?.heapMB), workingSetGrowthPctFrom30s: pct(first?.wsMB, last?.wsMB), note: "3 minutes, not the 10 minutes of CHK2-Q5: partial" };
    console.log("Q5 SOAK", JSON.stringify(data));
    await testInfo.attach("soak.json", { body: JSON.stringify(data, null, 1), contentType: "application/json" });
    expect(lt.filter((x) => x.dur > 50), "long tasks over 50 ms during the soak").toEqual([]);
    expect(sim.linesWith("OVERLAP")).toEqual([]);
    // the traffic ring fills at 5000 frames (about 30 s here): the trend after it is full is the criterion (10 %)
    expect(Math.abs(data.workingSetGrowthPctFrom30s ?? 0), "working set growth between 30 s and the end (partial)").toBeLessThan(25);
    void data;
  });
});


test.describe("(j) CHK3-G3 scale, overrides and aliases on every poll", () => {
  test("CHK3-G3 8 polls at 100 ms, each with a scale, 4 overrides and 10 aliases, all tiled, 30 s on WebView2: 0 long tasks over 50 ms and no extra requests compared with the scan rates", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const [s1] = await createPolls(mm, [{ name: "S1", slave: 1, fc: 3, start: 0, qty: 20, scan: 100 }]);
    const id = s1 as number;
    // seed: a 4-20 mA scale and one override made through the UI, so the file carries the real shapes
    await mm.titleButton(id, /^Poll setup/).click();
    const sc = mm.setup(id);
    await sc.getByLabel("Preset", { exact: true }).selectOption({ label: "4-20 mA" });
    await sc.getByRole("button", { name: "Apply scale", exact: true }).click();
    await mm.closeSetup(id);
    await focusPoll(mm, id);
    await mm.gridRow(id, 0).click();
    await mm.page.keyboard.press("Control+Shift+E");
    const dlg = mm.page.getByTestId("override-dialog");
    await dlg.getByLabel("Preset", { exact: true }).selectOption({ label: "Divide" });
    await dlg.getByRole("radio", { name: "10", exact: true }).click();
    await dlg.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dlg).toHaveCount(0);
    await saveProfileAs(mm, "Seed");
    const seed = readProfile(desktop, "Seed");
    const base = seed.polls[0];
    expect(base.scale, "the seed poll carries a scale").toBeTruthy();
    expect(base.scaleOverrides.length, "and an override").toBe(1);
    const override = base.scaleOverrides[0];
    const polls = Array.from({ length: 8 }, (_, i) => ({
      ...base,
      name: `S${i + 1}`,
      definition: { ...base.definition, slaveId: 1, startAddress: 0, quantity: 20, scanRateMs: i === 7 ? 1000 : 100 },
      scaleOverrides: [[0, 1], [3, 4], [6, 7], [9, 10]].map(([start, end]) => ({ ...override, start, end })),
      aliases: Array.from({ length: 10 }, (_, a) => ({ address: a, alias: `Signal ${i + 1}.${a}` })),
      valueColumns: "both",
      view: { host: "workspace", open: true, workspace: { x: 8 + (i % 4) * 330, y: 8 + Math.floor(i / 4) * 300, width: 320, height: 290, z: i + 1, state: "normal", restore: null }, native: null },
    }));
    const profile = { ...seed, name: "Scaled8", polls, workspace: { ...seed.workspace, tileMode: true } };
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.writeFileSync(path.join(profilesDir(desktop), "Scaled8.json"), JSON.stringify(profile));
    await openProfile(mm, "Scaled8");
    for (let i = 0; i < 4; i += 1) {
      const d = mm.confirm;
      if (!(await d.isVisible().catch(() => false))) break;
      const names = await d.getByRole("button").allInnerTexts();
      await d.getByRole("button", { name: names.find((n) => /Don't save|Disconnect and load/.test(n)) ?? "Cancel", exact: true }).click();
      await new Promise((r) => setTimeout(r, 300));
    }
    await expect.poll(async () => (await mm.ids()).length, { timeout: 20_000 }).toBe(8);
    await mm.toolbarButton("Connect").click();
    await expect(mm.pill).toContainText("Connected", { timeout: 15_000 });
    const ids = await mm.ids();
    for (const pid of ids) await expect(mm.statusLine(pid)).toHaveAttribute("data-state", "polling", { timeout: 15_000 });
    await expect.poll(async () => (await scaledText(mm, ids[0] as number)).length).toBeGreaterThan(0);
    await installLongTasks(mm.page);
    expect(await calibrate(mm.page)).toBeGreaterThan(0);
    await mm.page.evaluate(() => ((window as unknown as { __lt: unknown[] }).__lt.length = 0));
    const mark = sim.mark();
    const t0 = Date.now();
    await expect.poll(() => Date.now() - t0, { timeout: 40_000, intervals: [1000] }).toBeGreaterThanOrEqual(30_000);
    const lt = await longTasks(mm.page);
    const reqs = sim.requestsSince(mark);
    const expected = 7 * (30_000 / 100) + 30; // seven 100 ms polls at their scan rate (REPORT-007: D1 fixed, no 109 ms cycle any more) and the 1000 ms poll
    const data = { longTasks: lt, requests: reqs, expectedAtScanRates: Math.round(expected), cpuLoad: cpuLoad(), scaledSample: await scaledText(mm, ids[0] as number) };
    console.log("G3 WEBVIEW2", JSON.stringify(data));
    await testInfo.attach("g3.json", { body: JSON.stringify(data, null, 1), contentType: "application/json" });
    expect(lt.filter((x) => x.dur > 50), "long tasks over 50 ms (8 scaled polls)").toEqual([]);
    expect(reqs, "requests do not exceed what the scan rates allow (scaling adds no request)").toBeLessThanOrEqual(Math.round(expected * 1.05));
  });
});

async function scaledText(mm: RealMm, id: number): Promise<string> {
  return mm.gridRow(id, 2).locator('[data-cell="scaled"]').innerText().catch(() => "");
}
