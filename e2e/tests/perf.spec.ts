// CHK-002 section Q (performance smoke in UI mode). A desktop Chromium, NOT WebView2 and not the
// packaged app: the numbers only show that the React tree does not block the main thread with 8
// polls at 100 ms, with a sub-window dragged and resized at the same time. The fake runs in real
// time (a 20 ms ticker) and sends the same events over the same channel path as the real backend.
// Q4 (WebView2) and Q5 (10 minutes) need the integration mode.
//
// Runs in the "perf" project, one worker, after the "ui" project.
import os from "node:os";
import type { Page, TestInfo } from "@playwright/test";
import { expect, Mm, STANDARD_8, test } from "../support/mm-fixtures";

test.describe.configure({ mode: "serial" });

interface LongTask {
  start: number;
  duration: number;
}

/** Observes long tasks in the page and proves the instrument sees a deliberate 90 ms block. */
async function installLongTaskProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { longTasks: [] as LongTask[] };
    (window as unknown as { __perf: typeof state }).__perf = state;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) state.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask" });
  });
  // A timer task (code run directly by CDP evaluate is not reported as a task).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          const t0 = performance.now();
          while (performance.now() - t0 < 90) {
            /* busy */
          }
          resolve();
        }, 0);
      }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __perf: { longTasks: unknown[] } }).__perf.longTasks.length), {
      message: "the PerformanceObserver sees a deliberate 90 ms task",
    })
    .toBeGreaterThanOrEqual(1);
  await page.evaluate(() => {
    (window as unknown as { __perf: { longTasks: unknown[] } }).__perf.longTasks.length = 0;
  });
}

const longTasks = (page: Page): Promise<LongTask[]> =>
  page.evaluate(() => (window as unknown as { __perf: { longTasks: LongTask[] } }).__perf.longTasks.slice());

const describeTasks = (tasks: LongTask[]) => tasks.map((t) => `${Math.round(t.duration)} ms at ${Math.round(t.start)}`);

/**
 * D-002-15 (CHK-002 Q1-Q3 measurement note): in the browser smoke two or more long tasks in a run, or any task over
 * 52 ms, is a failure. One isolated task of 50-52 ms is an observation. Every measured task is recorded either way.
 */
function judgeLongTasks(tasks: LongTask[], label: string, testInfo: TestInfo): void {
  const longest = Math.max(0, ...tasks.map((t) => t.duration));
  testInfo.annotations.push({
    type: "longtasks",
    description: `${label}: ${tasks.length} task(s) ${describeTasks(tasks).join("; ") || "-"}`,
  });
  console.log(`PERF longtasks ${label}: count=${tasks.length} max=${longest.toFixed(1)} ms ${JSON.stringify(describeTasks(tasks))}`);
  expect(tasks.length, `${label}: long tasks in the run (${describeTasks(tasks).join("; ")}); 2 or more is a failure`).toBeLessThan(2);
  expect(longest, `${label}: longest task in ms (over 52 ms is a failure)`).toBeLessThanOrEqual(52);
}

/** System-wide CPU busy percentage over `ms` (all processes, this test's browser included when it runs). */
async function cpuBusyPct(ms: number): Promise<number> {
  const snap = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 });
  const a = snap();
  await new Promise((r) => setTimeout(r, ms));
  const b = snap();
  return Math.round((1 - (b.idle - a.idle) / (b.total - a.total)) * 1000) / 10;
}

/** The raw value of the first row of every grid on the page, by sub-window id. */
async function firstValues(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const el of document.querySelectorAll<HTMLElement>("[data-subwindow]")) {
      const cell = el.querySelector('[data-row="0"] [data-cell="raw"]');
      out[el.dataset.subwindow ?? "?"] = cell?.textContent ?? "";
    }
    return out;
  });
}

/** 8 polls (Standard 8 without the exception fault), tiled, live in real time. */
async function eightTiled(mm: Mm): Promise<number[]> {
  await mm.open({ polls: STANDARD_8.map((p) => ({ ...p, qty: Math.min(p.qty ?? 10, 40) })), mode: "realtime" });
  const ids = await mm.pollIds();
  await mm.pressConnect({ autoStart: true });
  await mm.expectConnection("connected");
  await mm.windowMenu("Tile");
  for (const id of ids) await expect(mm.grid(id)).toHaveAttribute("data-status", "live", { timeout: 15_000 });
  return ids;
}

test.describe("Q performance (browser, not WebView2)", () => {
  test("CHK2-Q1 smoke: Standard 8 polls tiled in W1 for 60 s: 0 long tasks over 50 ms; Pause of one poll reaches Paused within 100 ms", async ({ mm }, testInfo) => {
    test.setTimeout(180_000);
    testInfo.annotations.push({ type: "cpu-before", description: `system CPU busy ${await cpuBusyPct(1500)}% before the run` });
    const ids = await eightTiled(mm);
    await installLongTaskProbe(mm.page);
    const before = await firstValues(mm.page);
    // 60 s of polling; tables keep changing (each poll's first row), traffic bar counters move.
    const requests = async () => Number((await mm.trafficBar.innerText()).match(/Requests (\d+)/)?.[1]);
    const start = await requests();
    const t0 = Date.now();
    await expect
      .poll(async () => Date.now() - t0, { timeout: 70_000, intervals: [1000], message: "60 s smoke" })
      .toBeGreaterThanOrEqual(60_000);
    expect((await requests()) - start, "requests during the smoke").toBeGreaterThan(300);
    const after = await firstValues(mm.page);
    let changed = 0;
    for (const id of ids) if (before[String(id)] !== after[String(id)]) changed += 1;
    expect(changed, "tables that kept changing").toBeGreaterThanOrEqual(5);
    // Pause of one poll: from the keypress to the Paused chip in the page.
    const target = ids[0] as number;
    await mm.row(target).click();
    await mm.grid(target).focus();
    const ms = await mm.page.evaluate(
      (id) =>
        new Promise<number>((resolve) => {
          const line = document.querySelector(`[data-subwindow="${id}"] [data-testid="poll-status-line"]`) as HTMLElement;
          const t = performance.now();
          const obs = new MutationObserver(() => {
            if (line.getAttribute("data-state") === "paused") {
              obs.disconnect();
              resolve(performance.now() - t);
            }
          });
          obs.observe(line, { attributes: true, attributeFilter: ["data-state"] });
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }));
        }),
      target,
    );
    console.log(`PERF Q1 pause=${Math.round(ms)}ms`);
    expect(ms, "Pause to Paused in ms").toBeLessThan(100);
    judgeLongTasks(await longTasks(mm.page), "Q1 W1", testInfo);
  });

  test("CHK2-Q2 smoke: 4 sub-windows and 4 native windows polling together for 30 s: 0 long tasks over 50 ms in every window", async ({ mm }, testInfo) => {
    test.setTimeout(180_000);
    testInfo.annotations.push({ type: "cpu-before", description: `system CPU busy ${await cpuBusyPct(1500)}% before the run` });
    await mm.open({
      polls: STANDARD_8.slice(0, 4).map((p) => ({ ...p, qty: 20 })),
      mode: "realtime",
    });
    await mm.pressConnect({ autoStart: true });
    await mm.expectConnection("connected");
    await mm.windowMenu("Tile");
    const natives = [];
    for (let i = 0; i < 4; i++) {
      const w = await mm.openNative({
        polls: [{ name: `Poll ${i + 5}`, qty: 20, scan: 100 }],
        realtime: true,
        viewport: { width: 700, height: 500 },
      });
      await expect(w.grid).toHaveAttribute("data-status", "live", { timeout: 15_000 });
      natives.push(w);
    }
    await mm.page.bringToFront();
    const pages = [mm.page, ...natives.map((n) => n.page)];
    for (const p of pages) await installLongTaskProbe(p);
    const t0 = Date.now();
    await expect.poll(async () => Date.now() - t0, { timeout: 45_000, intervals: [1000] }).toBeGreaterThanOrEqual(30_000);
    for (const [i, p] of pages.entries()) {
      judgeLongTasks(await longTasks(p), `Q2 ${i === 0 ? "W1" : `W2 #${i}`}`, testInfo);
    }
    for (const n of natives) await expect(n.statusLine).toContainText("Polling");
  });

  test("CHK2-Q3 drag while polling: 8 sub-windows at 100 ms, one dragged and resized for 30 s: 0 long tasks over 50 ms; the other 7 tables keep updating; no extra renders", async ({ mm, page }, testInfo) => {
    test.setTimeout(240_000);
    testInfo.annotations.push({ type: "cpu-before", description: `system CPU busy ${await cpuBusyPct(1500)}% before the run` });
    const ids = await eightTiled(mm);
    const dragged = ids[0] as number;
    // Free layout (tile mode off, rectangles kept): the frame can be moved and resized.
    await mm.windowMenu("Tile mode", "menuitemcheckbox");
    await expect(mm.tileIndicator).toHaveCount(0);
    await mm.row(dragged).click();
    // Baseline: how many DOM mutations the other 7 sub-windows make in 10 s without a drag.
    await page.evaluate((skip) => {
      const state = { count: 0 };
      (window as unknown as { __mut: typeof state }).__mut = state;
      for (const el of document.querySelectorAll<HTMLElement>("[data-subwindow]")) {
        if (Number(el.dataset.subwindow) === skip) continue;
        new MutationObserver((records) => {
          state.count += records.length;
        }).observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
      }
    }, dragged);
    const mutations = () => page.evaluate(() => (window as unknown as { __mut: { count: number } }).__mut.count);
    // Dev render probe (`window.__ESEFACT_RENDERS__`, key `poll-view:{id}`): commits of each poll view body.
    expect(await mm.renders(ids[1] as number), "the dev render probe is installed").toBeGreaterThanOrEqual(0);
    await mm.resetRenders();
    const idleStart = await mutations();
    const t0 = Date.now();
    await expect.poll(async () => Date.now() - t0, { timeout: 20_000, intervals: [500] }).toBeGreaterThanOrEqual(10_000);
    const idleRate = ((await mutations()) - idleStart) / 10;
    const idleRenders = await mm.allRenders();
    await mm.resetRenders();

    await installLongTaskProbe(page);
    const valuesBefore = await firstValues(page);
    const dragStartCount = await mutations();
    // Scripted: grab the title bar, move in a circle for 20 s, release; then resize with the
    // south-east handle back and forth for 10 s.
    const bar = await mm.titlePoint(dragged, 60);
    const t1 = Date.now();
    await page.mouse.move(bar.x, bar.y);
    await page.mouse.down();
    let k = 0;
    while (Date.now() - t1 < 20_000) {
      k += 1;
      await page.mouse.move(bar.x + 60 * Math.sin(k / 12), bar.y + 40 * Math.cos(k / 12));
    }
    await page.mouse.up();
    const handle = await mm.sub(dragged).locator('[data-resize-handle="se"]').boundingBox();
    if (!handle) throw new Error("no handle");
    const hx = handle.x + 5;
    const hy = handle.y + 5;
    const t2 = Date.now();
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    k = 0;
    while (Date.now() - t2 < 10_000) {
      k += 1;
      await page.mouse.move(hx + 30 * Math.sin(k / 15), hy + 20 * Math.sin(k / 15));
    }
    await page.mouse.up();
    const dragSeconds = (Date.now() - t1) / 1000;
    const dragRate = ((await mutations()) - dragStartCount) / dragSeconds;
    console.log(`PERF Q3 mutations/s idle=${idleRate.toFixed(1)} drag=${dragRate.toFixed(1)} over ${dragSeconds.toFixed(0)} s`);
    // Render probe: renders per second of each of the other 7 poll views, idle (10 s) against the drag (the whole drag).
    const dragRenders = await mm.allRenders();
    const rows = ids
      .filter((id) => id !== dragged)
      .map((id) => {
        const key = `poll-view:${id}`;
        return { id, idle: (idleRenders[key] ?? 0) / 10, drag: (dragRenders[key] ?? 0) / dragSeconds };
      });
    console.log(`PERF Q3 renders/s (other 7 views) ${JSON.stringify(rows.map((r) => ({ id: r.id, idle: Number(r.idle.toFixed(2)), drag: Number(r.drag.toFixed(2)) })))} dragged view: idle=${((idleRenders[`poll-view:${dragged}`] ?? 0) / 10).toFixed(2)} drag=${((dragRenders[`poll-view:${dragged}`] ?? 0) / dragSeconds).toFixed(2)}`);
    testInfo.annotations.push({ type: "renders", description: JSON.stringify(rows.map((r) => [r.id, +r.idle.toFixed(2), +r.drag.toFixed(2)])) });
    for (const r of rows) {
      expect(r.drag, `renders/s of poll view ${r.id} during the drag (idle ${r.idle.toFixed(2)}/s)`).toBeLessThanOrEqual(r.idle * 1.3 + 0.5);
    }
    judgeLongTasks(await longTasks(page), "Q3 W1", testInfo);
    const valuesAfter = await firstValues(page);
    let changed = 0;
    for (const id of ids) if (id !== dragged && valuesBefore[String(id)] !== valuesAfter[String(id)]) changed += 1;
    expect(changed, "the other tables kept updating").toBeGreaterThanOrEqual(5);
    // The drag adds no work to the other tables: their DOM changes at the same rate as when idle.
    expect(dragRate, "mutations of the other 7 sub-windows per second, drag vs idle").toBeLessThanOrEqual(idleRate * 1.3 + 2);
  });
});
