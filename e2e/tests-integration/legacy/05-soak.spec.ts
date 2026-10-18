// Integration mode, priority 5: long-task observation and memory on WebView2 through CDP.
// CHK-S3 (WebView2, recorded separately from the browser smoke), CHK-S1 (2-minute soak instead of
// 10 minutes), CHK-S2 (two windows), CHK-N2 (5,000-frame ring against the real backend).
import type { CDPSession, Page } from "@playwright/test";
import { Desktop, expect, ModbusApp, openModbusWindow, referenceMap, realConnect, Sim, test } from "../../integration/legacy/helpers-fixtures";

interface LongTask {
  start: number;
  duration: number;
}

async function observe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { longTasks: [] as { start: number; duration: number }[] };
    window.__qa = state;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) state.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask" });
  });
  // Calibration: the observer must see a deliberate 90 ms task, otherwise "0 long tasks" proves nothing.
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
  await expect.poll(() => page.evaluate(() => (window.__qa as { longTasks: unknown[] }).longTasks.length), { message: "observer sees a 90 ms task" }).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => {
    (window.__qa as { longTasks: unknown[] }).longTasks.length = 0;
  });
}

const longTasks = (page: Page): Promise<LongTask[]> => page.evaluate(() => [...(window.__qa as { longTasks: LongTask[] }).longTasks]);

async function heapBytes(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  return metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0;
}

async function scrollBoth(mm: ModbusApp): Promise<void> {
  await mm.table.evaluate((el) => {
    el.scrollTop = (el.scrollTop + 96) % Math.max(1, el.scrollHeight - el.clientHeight);
  });
  await mm.frameList.evaluate((el) => {
    el.scrollTop = (el.scrollTop + 220) % Math.max(1, el.scrollHeight - el.clientHeight);
  });
}

const requests = async (mm: ModbusApp) => Number((await mm.counter("Requests").innerText()).trim());

async function pauseLatencyMs(mm: ModbusApp): Promise<number> {
  return mm.page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const pill = document.querySelector('[data-slot="status-pill"]') as HTMLElement;
        const button = [...document.querySelectorAll('[role="toolbar"] button')].find((b) => b.textContent?.trim() === "Pause") as HTMLButtonElement;
        const t0 = performance.now();
        const obs = new MutationObserver(() => {
          if (pill.textContent?.includes("Paused")) {
            obs.disconnect();
            resolve(performance.now() - t0);
          }
        });
        obs.observe(pill, { childList: true, subtree: true, characterData: true });
        button.click();
      }),
  );
}

async function startStream(mm: ModbusApp, sim: Sim, scanMs: number): Promise<void> {
  await realConnect(mm, sim, { scanMs, quantity: 125, timeoutMs: 1000 });
  await mm.expectPill("Polling", "activity");
  await expect(mm.chip).toContainText("Updated");
}

test.beforeEach(async ({ sim }) => {
  await referenceMap(sim);
  await sim.ctlOk("limit 65536"); // 125 registers from address 0 must stay inside the map
});

test.describe("S. performance on WebView2", () => {
  test("CHK-S3 WebView2: 125 registers at 100 ms for 120 ticks, table and traffic list scrolled: 0 long tasks over 50 ms", async ({ mm, sim }, testInfo) => {
    await startStream(mm, sim, 100);
    await observe(mm.page);
    const start = await requests(mm);
    await expect
      .poll(async () => {
        await scrollBoth(mm);
        return (await requests(mm)) - start;
      }, { timeout: 60_000, intervals: [200] })
      .toBeGreaterThanOrEqual(120);
    const pause = await pauseLatencyMs(mm);
    const tasks = await longTasks(mm.page);
    const summary = { environment: "WebView2 (real app, debug build)", ticks: 120, longTasksOver50ms: tasks.length, maxMs: Math.max(0, ...tasks.map((t) => Math.round(t.duration))), pauseMs: Math.round(pause) };
    console.log(`S3 ${JSON.stringify(summary)}`);
    await testInfo.attach("s3-webview2.json", { body: JSON.stringify({ ...summary, tasks }, null, 2), contentType: "application/json" });
    expect(tasks.map((t) => `${Math.round(t.duration)} ms at ${Math.round(t.start)}`), "long tasks over 50 ms").toEqual([]);
    expect(pause, "Pause reaches the Paused pill within 100 ms").toBeLessThan(100);
  });

  test("CHK-S1 (2-minute soak) 125 registers at 100 ms: responsive, no long tasks, memory stable between 30 s and 120 s", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    await startStream(mm, sim, 100);
    const cdp = await mm.page.context().newCDPSession(mm.page);
    await cdp.send("Performance.enable");
    await observe(mm.page);
    const t0 = Date.now();
    const base = await requests(mm);
    const sample = async () => ({
      tSec: Math.round((Date.now() - t0) / 1000),
      jsHeap: await heapBytes(cdp),
      workingSet: desktop.workingSetBytes(),
      requests: (await requests(mm)) - base,
    });
    // wait on the stream itself: 300 ticks (30 s), then 1200 ticks (120 s)
    const until = (ticks: number) =>
      expect
        .poll(async () => {
          await scrollBoth(mm);
          return (await requests(mm)) - base;
        }, { timeout: 200_000, intervals: [250] })
        .toBeGreaterThanOrEqual(ticks);
    await until(300);
    const early = await sample();
    await until(1200);
    const late = await sample();
    const tasks = await longTasks(mm.page);
    const pause = await pauseLatencyMs(mm);
    // the app is still alive and the pill agrees
    await mm.expectPill("Paused", "pause");
    const summary = {
      early,
      late,
      heapGrowthPct: Math.round(((late.jsHeap - early.jsHeap) / early.jsHeap) * 1000) / 10,
      workingSetGrowthPct: Math.round(((late.workingSet - early.workingSet) / early.workingSet) * 1000) / 10,
      longTasksOver50ms: tasks.length,
      maxLongTaskMs: Math.max(0, ...tasks.map((t) => Math.round(t.duration))),
      pauseMs: Math.round(pause),
    };
    console.log(`S1 ${JSON.stringify(summary)}`);
    await testInfo.attach("s1-soak.json", { body: JSON.stringify({ ...summary, tasks }, null, 2), contentType: "application/json" });
    expect(tasks.filter((t) => t.duration > 200), "long tasks over 200 ms").toEqual([]);
    expect(tasks.length, "long tasks over 50 ms").toBe(0);
    expect(pause).toBeLessThan(100);
    // The ring buffer (5,000 frames) is still filling during these 2 minutes (about 660 -> 2,400 frames),
    // so the JS heap is expected to grow; the 10 % comparison is made beyond the cap in the next test.
    expect(summary.workingSetGrowthPct, "working set growth 30 s -> 120 s").toBeLessThan(10);
  });

  test("CHK-S1 (memory beyond the 5,000-frame cap, 20 ms scan) JS heap and working set stay within 10 % once the ring is full", async ({
    desktop,
    mm,
    sim,
  }, testInfo) => {
    test.setTimeout(300_000);
    await startStream(mm, sim, 20);
    const cdp = await mm.page.context().newCDPSession(mm.page);
    await cdp.send("Performance.enable");
    const base = await requests(mm);
    const reach = (n: number) =>
      expect.poll(async () => (await requests(mm)) - base, { timeout: 200_000, intervals: [500] }).toBeGreaterThanOrEqual(n);
    await reach(3000); // 6,000 frames: the ring has been full for a while
    const early = { jsHeap: await heapBytes(cdp), workingSet: desktop.workingSetBytes() };
    await reach(7000); // another 8,000 frames
    const late = { jsHeap: await heapBytes(cdp), workingSet: desktop.workingSetBytes() };
    const summary = {
      early,
      late,
      heapGrowthPct: Math.round(((late.jsHeap - early.jsHeap) / early.jsHeap) * 1000) / 10,
      workingSetGrowthPct: Math.round(((late.workingSet - early.workingSet) / early.workingSet) * 1000) / 10,
    };
    console.log(`S1cap ${JSON.stringify(summary)}`);
    await testInfo.attach("s1-memory-beyond-cap.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
    expect(summary.heapGrowthPct, "JS heap growth beyond the cap").toBeLessThan(10);
    expect(summary.workingSetGrowthPct, "working set growth beyond the cap").toBeLessThan(10);
  });

  test("CHK-S2 two windows polling at 100 ms at the same time stay responsive", async ({ desktop, launcher, sim }, testInfo) => {
    test.setTimeout(180_000);
    const w1 = await openModbusWindow(desktop, launcher);
    const w2 = await openModbusWindow(desktop, launcher);
    await startStream(w1, sim, 100);
    await startStream(w2, sim, 100);
    await observe(w1.page);
    await observe(w2.page);
    const b1 = await requests(w1);
    const b2 = await requests(w2);
    await expect
      .poll(async () => {
        await scrollBoth(w1);
        await scrollBoth(w2);
        return Math.min((await requests(w1)) - b1, (await requests(w2)) - b2);
      }, { timeout: 90_000, intervals: [250] })
      .toBeGreaterThanOrEqual(300);
    const p1 = await pauseLatencyMs(w1);
    const p2 = await pauseLatencyMs(w2);
    const t1 = await longTasks(w1.page);
    const t2 = await longTasks(w2.page);
    const summary = { ticksEach: 300, window1: { longTasks: t1.length, maxMs: Math.max(0, ...t1.map((t) => Math.round(t.duration))), pauseMs: Math.round(p1) }, window2: { longTasks: t2.length, maxMs: Math.max(0, ...t2.map((t) => Math.round(t.duration))), pauseMs: Math.round(p2) } };
    console.log(`S2 ${JSON.stringify(summary)}`);
    await testInfo.attach("s2-two-windows.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
    expect(t1.length + t2.length, "long tasks over 50 ms in both windows").toBe(0);
    expect(p1).toBeLessThan(100);
    expect(p2).toBeLessThan(100);
  });

  test("CHK-N2 against the real backend: after more than 5,000 frames the list holds exactly 5,000 and # stays absolute", async ({ mm, sim }) => {
    test.setTimeout(240_000);
    await realConnect(mm, sim, { scanMs: 20, timeoutMs: 1000 });
    await mm.expectPill("Polling", "activity");
    // 20 ms poll -> about 100 frames a second; wait for the sequence number of the newest frame
    await expect
      .poll(async () => Number((await mm.counter("Requests").innerText()).trim()), { timeout: 150_000, intervals: [500] })
      .toBeGreaterThanOrEqual(3200); // 3200 requests + 3200 replies = 6400 frames
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await expect(mm.frameList).toHaveAttribute("aria-rowcount", "5001");
    const rowIndex = async (which: "first" | "last") => {
      const loc = mm.frameList.locator('[id^="frame-"]');
      return Number(await (which === "first" ? loc.first() : loc.last()).getAttribute("aria-rowindex"));
    };
    const seqOf = async (which: "first" | "last") => {
      const loc = mm.frameList.locator('[id^="frame-"]');
      const id = await (which === "first" ? loc.first() : loc.last()).getAttribute("id");
      return Number((id ?? "").replace("frame-", ""));
    };
    // The last reply of the poll that was in flight when Pause was pressed can still arrive and shift the
    // ring by one frame between two reads: read newest, oldest and newest again until they are consistent.
    let newestSeq = 0;
    let oldestSeq = 0;
    await expect(async () => {
      await mm.frameList.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect.poll(() => rowIndex("last"), { timeout: 3000 }).toBe(5001);
      const newest1 = await seqOf("last");
      await mm.frameList.evaluate((el) => {
        el.scrollTop = 0;
      });
      await expect.poll(() => rowIndex("first"), { timeout: 3000 }).toBe(2);
      oldestSeq = await seqOf("first");
      await mm.frameList.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect.poll(() => rowIndex("last"), { timeout: 3000 }).toBe(5001);
      newestSeq = await seqOf("last");
      expect(newestSeq, "the ring did not move between the reads").toBe(newest1);
    }).toPass({ timeout: 20_000 });
    console.log(`N2 oldest=${oldestSeq} newest=${newestSeq} requests=${await requests(mm)}`);
    expect(newestSeq - oldestSeq, "the list spans exactly 5,000 frames").toBe(4999);
    expect(newestSeq).toBeGreaterThan(5000);
    expect(await requests(mm)).toBeGreaterThan(2500); // counters keep counting beyond the cap
    void Desktop;
  });
});
