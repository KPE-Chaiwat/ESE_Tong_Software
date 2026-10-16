// CHK-001 S. performance smoke in UI mode. This is a desktop Chromium, NOT WebView2 and not the
// packaged app: the numbers only show that the React tree does not block the main thread with the
// REQ load (125 registers at a 100 ms scan rate). The simulating fake streams 125 values and two
// traffic frames per tick over the same channel path the real backend uses.
//
// Runs in the "perf" project, after the "ui" project, so other workers do not steal CPU.
import type { Page } from "@playwright/test";
import { expect, type ModbusApp, test } from "../support/fixtures";

test.describe.configure({ mode: "serial" });

interface LongTask {
  start: number;
  duration: number;
}

interface Measurement {
  ticks: number;
  longTasks: LongTask[];
  heapStart: number | null;
  heapEnd: number | null;
  pauseMs: number;
  distinctValues: number;
}

async function startStream(app: ModbusApp): Promise<void> {
  await app.host.fill("127.0.0.1");
  await app.scan.fill("100");
  await app.quantity.fill("125");
  await app.toolbarButton("Connect").click();
  await app.expectPill("Polling", "activity");
  await expect(app.chip).toContainText("Updated");
}

async function measure(page: Page, app: ModbusApp, ticks: number): Promise<Measurement> {
  await page.evaluate(() => {
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
    const state = { longTasks: [] as { start: number; duration: number }[], heapStart: perf.memory?.usedJSHeapSize ?? null };
    window.__qa = state;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) state.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask" });
  });
  // Calibration: the instrument must see a deliberate 90 ms block, otherwise "0 long tasks" proves nothing.
  // (a timer task: code run directly by CDP evaluate is not reported as a task)
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
    .poll(() => page.evaluate(() => (window.__qa as { longTasks: unknown[] }).longTasks.length), {
      message: "the PerformanceObserver sees a deliberate 90 ms task",
    })
    .toBeGreaterThanOrEqual(1);
  await page.evaluate(() => {
    (window.__qa as { longTasks: unknown[] }).longTasks.length = 0;
  });
  const requests = async () => {
    return Number((await app.counter("Requests").innerText()).trim());
  };
  const start = await requests();
  const seen = new Set<string>();
  // Scroll the data table and the traffic list while the stream runs: scrolling must stay smooth too.
  await expect
    .poll(
      async () => {
        await app.table.evaluate((el) => {
          el.scrollTop = (el.scrollTop + 96) % Math.max(1, el.scrollHeight - el.clientHeight);
        });
        await app.frameList.evaluate((el) => {
          el.scrollTop = (el.scrollTop + 220) % Math.max(1, el.scrollHeight - el.clientHeight);
        });
        const first = await app.table.locator('[role="gridcell"]').nth(1).innerText();
        seen.add(first);
        return (await requests()) - start;
      },
      { timeout: 60_000, intervals: [200], message: "stream ticks" },
    )
    .toBeGreaterThanOrEqual(ticks);

  const pauseMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const pill = document.querySelector('[data-slot="status-pill"]') as HTMLElement;
        const button = [...document.querySelectorAll('[role="toolbar"] button')].find(
          (b) => b.textContent?.trim() === "Pause",
        ) as HTMLButtonElement;
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
  return page.evaluate(
    ({ ticksSeen, pauseMs: pause, distinct }) => {
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      const state = window.__qa as { longTasks: { start: number; duration: number }[]; heapStart: number | null };
      return {
        ticks: ticksSeen,
        longTasks: state.longTasks,
        heapStart: state.heapStart,
        heapEnd: perf.memory?.usedJSHeapSize ?? null,
        pauseMs: pause,
        distinctValues: distinct,
      };
    },
    { ticksSeen: ticks, pauseMs, distinct: seen.size },
  );
}

test.describe("S. performance (browser, not WebView2)", () => {
  test("CHK-S1/S3 smoke: 125 registers at 100 ms for 120 ticks, no long task over 200 ms", async ({
    simApp: app,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await startStream(app);
    const m = await measure(page, app, 120);
    await testInfo.attach("perf.json", {
      body: JSON.stringify(
        {
          ...m,
          longTasksOver50: m.longTasks.length,
          longTasksOver200: m.longTasks.filter((t) => t.duration > 200).length,
          maxLongTaskMs: Math.max(0, ...m.longTasks.map((t) => t.duration)),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    console.log(
      `PERF ticks=${m.ticks} longTasks(>50ms)=${m.longTasks.length} max=${Math.max(0, ...m.longTasks.map((t) => Math.round(t.duration)))}ms pause=${Math.round(m.pauseMs)}ms heap ${m.heapStart} -> ${m.heapEnd} distinctRow0Values=${m.distinctValues}`,
    );
    expect(m.distinctValues, "the table kept re-rendering new values").toBeGreaterThan(5);
    expect(
      m.longTasks.filter((t) => t.duration > 200),
      "long tasks over 200 ms",
    ).toEqual([]);
    // DES 8 / CHK-S1: Pause reacts within 100 ms.
    expect(m.pauseMs, "Pause to Paused pill in ms").toBeLessThan(100);
    await app.expectPill("Paused", "pause");
  });

  test("CHK-S3 browser smoke: 0 long tasks over 50 ms with the table and traffic list scrolled (criterion of revision 3)", async ({
    simApp: app,
    page,
  }) => {
    test.setTimeout(120_000);
    await startStream(app);
    const m = await measure(page, app, 120);
    expect(
      m.longTasks.map((t) => `${Math.round(t.duration)} ms at ${Math.round(t.start)}`),
      "long tasks (the browser reports tasks over 50 ms only)",
    ).toEqual([]);
  });
});
