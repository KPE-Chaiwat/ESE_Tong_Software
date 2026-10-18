// REPORT-007: CHK2-D10 (scan rate accuracy, simulator log as oracle), D3 (16 polls at 20 ms, saturated link) and the
// minimized-windows variant (Windows 11 ignores timeBeginPeriod while every window is minimized unless the process opts out).
// Seconds per rate: QA_SCAN_SECONDS (default 60).
import { expect, test } from "../integration/fixtures";
import { type PollProfileSpec, openProfile, profileV2, writeProfile } from "../integration/profiles";
import { diffs, intervalStats, SCAN_SECONDS, sleep } from "../integration/qa7";
import { createPolls, referenceMap } from "../integration/scenario";

const RATES = [20, 50, 100, 250, 500] as const;
const LIMIT_MEAN = (s: number) => s + 4;
const LIMIT_MIN = (s: number) => s - 2;

test.describe("CHK2-D10 scan rate accuracy, one poll, simulator log as the oracle", () => {
  for (const S of RATES) {
    test(`CHK2-D10 S=${S} ms: mean <= ${S + 4}, shortest >= ${S - 2}, no (effective ...) suffix, request count, no 15.6 ms quantization`, async ({ mm, sim }, testInfo) => {
      test.setTimeout(SCAN_SECONDS * 1000 + 120_000);
      await referenceMap(sim);
      await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
      const [id] = await createPolls(mm, [{ name: "One", slave: 1, fc: 3, start: 0, qty: 10, scan: S }]);
      await expect(mm.statusLine(id as number)).toHaveAttribute("data-state", "polling");
      await expect(mm.statusLine(id as number)).toContainText(`SR ${S} ms`);
      // let the first cycles pass, then measure
      const warm = sim.mark();
      await expect.poll(() => sim.requestsSince(warm), { timeout: 20_000 }).toBeGreaterThanOrEqual(5);
      const mark = sim.mark();
      const textMid: string[] = [];
      await expect
        .poll(
          async () => {
            const r = sim.requestsDecoded(mark);
            if (r.length % 40 === 0 && r.length > 0 && textMid.length < 6) textMid.push(await mm.statusText(id as number));
            return r.length ? (r.at(-1)?.epoch ?? 0) - (r[0]?.epoch ?? 0) : 0;
          },
          { timeout: SCAN_SECONDS * 1000 + 30_000, intervals: [250] },
        )
        .toBeGreaterThanOrEqual(SCAN_SECONDS * 1000);
      const reqs = sim.requestsDecoded(mark);
      const d = diffs(reqs.map((r) => r.epoch));
      const st = intervalStats(d);
      const statusEnd = await mm.statusText(id as number);
      const durationMs = (reqs.at(-1)?.epoch ?? 0) - (reqs[0]?.epoch ?? 0);
      const row = { binary: process.env.ESEFACT_BINARY_LABEL ?? "default", S, seconds: Math.round(durationMs / 100) / 10, requests: reqs.length, ...st, statusLine: statusEnd.match(/SR \d+ ms( \(effective \d+ ms\))?/)?.[0] };
      console.log("D10", JSON.stringify(row));
      await testInfo.attach(`d10-${S}.json`, { body: JSON.stringify({ ...row, statusMid: textMid }, null, 1), contentType: "application/json" });
      expect.soft(st.mean, `mean interval at S=${S} (limit ${LIMIT_MEAN(S)})`).toBeLessThanOrEqual(LIMIT_MEAN(S));
      expect.soft(st.min, `shortest interval at S=${S} (limit ${LIMIT_MIN(S)})`).toBeGreaterThanOrEqual(LIMIT_MIN(S));
      expect.soft(reqs.length, `request count over ${row.seconds} s (>= duration / (S + 4))`).toBeGreaterThanOrEqual(Math.floor(durationMs / (S + 4)));
      expect.soft(statusEnd, "status line shows SR without (effective ...)").not.toContain("effective");
      for (const t of textMid) expect.soft(t, "status line while running: no effective suffix").not.toContain("effective");
      if (S === 100) expect.soft(st.share107to112, "share of intervals in 107-112 ms (quantization), < 10 %").toBeLessThan(0.1);
      expect(sim.linesWith("OVERLAP")).toEqual([]);
    });
  }
});

test.describe("CHK2-D10 repeated at S=100 with 2, 4 and 7 polls running", () => {
  test("Poll 1 and every running poll keep mean <= 104 ms with 2, 4 and 7 polls", async ({ mm, sim }, testInfo) => {
    test.setTimeout(400_000);
    const seconds = Math.min(SCAN_SECONDS, 30);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: false, timeoutMs: 1000 });
    const specs = Array.from({ length: 7 }, (_, i) => ({ name: `T${i + 1}`, slave: 1, fc: 3 as const, start: 10 * i, qty: 2, scan: 100 }));
    const ids = await createPolls(mm, specs);
    const table: Array<Record<string, unknown>> = [];
    let running = 0;
    for (const n of [2, 4, 7]) {
      while (running < n) {
        const id = ids[running] as number;
        await mm.row(id).click();
        await mm.grid(id).focus().catch(() => undefined);
        await mm.page.keyboard.press("Control+p");
        await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
        running += 1;
      }
      await sleep(1500);
      const mark = sim.mark();
      await expect
        .poll(() => {
          const r = sim.requestsDecoded(mark);
          return r.length ? (r.at(-1)?.epoch ?? 0) - (r[0]?.epoch ?? 0) : 0;
        }, { timeout: seconds * 1000 + 30_000, intervals: [250] })
        .toBeGreaterThanOrEqual(seconds * 1000);
      const perPoll: Record<string, unknown> = {};
      for (let k = 0; k < n; k += 1) {
        const reqs = sim.requestsDecoded(mark).filter((r) => r.addr === 10 * k);
        const st = intervalStats(diffs(reqs.map((r) => r.epoch)));
        perPoll[`T${k + 1}`] = { n: st.n, mean: st.mean, min: st.min, max: st.max };
        expect.soft(st.mean, `${n} polls running: T${k + 1} mean interval (limit 104)`).toBeLessThanOrEqual(104);
        expect.soft(st.min, `${n} polls running: T${k + 1} shortest interval (limit 98)`).toBeGreaterThanOrEqual(98);
      }
      table.push({ pollsRunning: n, seconds, perPoll });
    }
    console.log("D10 MULTI", JSON.stringify(table));
    await testInfo.attach("d10-multi.json", { body: JSON.stringify(table, null, 1), contentType: "application/json" });
    expect(sim.linesWith("OVERLAP")).toEqual([]);
  });
});

test.describe("CHK2-D10 with every ESEfact window minimized (timer resolution opt-out)", () => {
  for (const [S, secs] of [[20, SCAN_SECONDS], [100, Math.min(SCAN_SECONDS, 30)]] as const) {
    test(`S=${S} ms with the launcher and W1 minimized for ${secs} s: mean <= ${S + 4}, shortest >= ${S - 2}`, async ({ desktop, mm, sim }, testInfo) => {
      test.setTimeout(secs * 1000 + 120_000);
      await referenceMap(sim);
      await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
      const [id] = await createPolls(mm, [{ name: "One", slave: 1, fc: 3, start: 0, qty: 10, scan: S }]);
      await expect(mm.statusLine(id as number)).toHaveAttribute("data-state", "polling");
      // minimize every top-level window of the app
      for (const w of desktop.windows()) desktop.showWindow(w.hwnd, "min");
      await expect
        .poll(() => desktop.windows().filter((w) => w.cls === "Tauri Window").every((w) => w.iconic), { message: "all ESEfact windows minimized" })
        .toBe(true);
      await sleep(2000);
      const mark = sim.mark();
      await expect
        .poll(() => {
          const r = sim.requestsDecoded(mark);
          return r.length ? (r.at(-1)?.epoch ?? 0) - (r[0]?.epoch ?? 0) : 0;
        }, { timeout: secs * 1000 + 30_000, intervals: [250] })
        .toBeGreaterThanOrEqual(secs * 1000);
      const stillMinimized = desktop.windows().filter((w) => w.cls === "Tauri Window").every((w) => w.iconic);
      const reqs = sim.requestsDecoded(mark);
      const st = intervalStats(diffs(reqs.map((r) => r.epoch)));
      const row = { binary: process.env.ESEFACT_BINARY_LABEL ?? "default", S, minimized: true, stillMinimized, seconds: secs, requests: reqs.length, ...st };
      console.log("D10 MIN", JSON.stringify(row));
      await testInfo.attach(`d10-minimized-${S}.json`, { body: JSON.stringify(row, null, 1), contentType: "application/json" });
      expect(stillMinimized, "the windows stayed minimized during the measurement").toBe(true);
      expect.soft(st.mean, `minimized, S=${S}: mean`).toBeLessThanOrEqual(LIMIT_MEAN(S));
      expect.soft(st.min, `minimized, S=${S}: shortest`).toBeGreaterThanOrEqual(LIMIT_MIN(S));
      for (const w of desktop.windows()) desktop.showWindow(w.hwnd, "restore");
    });
  }
});

test.describe("CHK2-D10 standard 8 polls (7 x 100 ms, 1 x 1000 ms)", () => {
  test("covered by CHK2-D1/D2 in 02-connect-polls.spec.ts (rev 10 bounds: every mean <= S + 4, no (effective ...) suffix)", () => {
    expect(true).toBe(true);
  });
});

test.describe("CHK2-D3 saturated link: 16 polls at 20 ms with fault delay 3", () => {
  test("traffic bar link load >= 90 %, SR 20 ms (effective n ms) with n > 30 and n agrees with the log, round robin, no OVERLAP, clear removes the suffix within 2 s", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(SCAN_SECONDS * 1000 + 240_000);
    await referenceMap(sim);
    await sim.ctlOk("master-timeout 1000");
    await sim.ctlOk("fault delay 3");
    const polls: PollProfileSpec[] = Array.from({ length: 16 }, (_, i) => ({ name: `Poll ${i + 1}`, slave: 1, fc: 3, start: 5 * i, qty: 5, scan: 20, workspace: null }));
    writeProfile(desktop, "D3", profileV2("D3", polls, { connection: { mode: "tcp", host: "127.0.0.1", port: sim.modbusPort, timeoutMs: 1000 } }));
    await openProfile(mm, "D3");
    await expect(mm.pollList.getByRole("option")).toHaveCount(16);
    const mark = sim.mark();
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    await expect(mm.statusLine(await mm.idByName("Poll 1"))).toHaveAttribute("data-state", "polling", { timeout: 30_000 });
    await sleep(5000);
    const mid = sim.mark();
    const samples: Array<Record<string, unknown>> = [];
    const t0 = Date.now();
    const ids = await mm.ids();
    for (let k = 0; k < 3; k += 1) {
      await sleep(Math.floor((SCAN_SECONDS * 1000) / 4));
      const row: Record<string, unknown> = { atS: Math.round((Date.now() - t0) / 100) / 10 };
      for (const [pi, id] of ids.slice(0, 3).entries()) {
        const text = await mm.statusText(id);
        const n = Number(/effective (\d+) ms/.exec(text)?.[1] ?? NaN);
        const starts = sim.requestsDecoded(mark).filter((r) => r.addr === 5 * pi).map((r) => r.epoch);
        const last = starts.slice(-11);
        const m = diffs(last).reduce((a, b) => a + b, 0) / Math.max(1, last.length - 1);
        row[`P${pi + 1}`] = { effective: n, logMeanLast10: Math.round(m * 10) / 10 };
        expect.soft(n, `Poll ${pi + 1} shows (effective n ms) with n > 30 (${text})`).toBeGreaterThan(30);
        expect.soft(Math.abs(n - m), `Poll ${pi + 1}: effective ${n} agrees with the log mean ${m.toFixed(1)} within 10 % or 3 ms`).toBeLessThanOrEqual(Math.max(0.1 * m, 3));
      }
      const bar = (await mm.trafficBar.innerText()).replace(/\s+/g, " ");
      const load = Number(/link load (\d+)%/.exec(bar)?.[1] ?? NaN);
      row.linkLoad = load;
      row.bar = bar;
      samples.push(row);
      expect.soft(load, "link load >= 90 %").toBeGreaterThanOrEqual(90);
      expect.soft(bar, "polls are slowed down text").toContain("polls are slowed down");
    }
    await expect(mm.trafficBar.locator('[data-icon="gauge"]'), "gauge icon").toHaveCount(1);
    const everyLine = await Promise.all(ids.map((id) => mm.statusText(id)));
    everyLine.forEach((t, i) => expect.soft(t, `Poll ${i + 1}: SR 20 ms (effective n ms)`).toMatch(/SR 20 ms \(effective \d+ ms\)/));
    // run out the remaining time of the minute
    const doneBy = t0 + SCAN_SECONDS * 1000;
    if (Date.now() < doneBy) await sleep(doneBy - Date.now());
    // round robin and gaps from the log
    const reqs = sim.requestsDecoded(mid);
    const pollOf = (r: { addr: number }) => Math.floor(r.addr / 5);
    let violations = 0;
    let firstViolation = "";
    for (let i = 0; i + 16 <= reqs.length; i += 1) {
      const seen = new Set(reqs.slice(i, i + 16).map(pollOf));
      if (seen.size < 16) {
        violations += 1;
        if (!firstViolation) firstViolation = `window at request ${i}: polls ${[...seen].sort((a, b) => a - b).join(",")}`;
      }
    }
    let maxGap = 0;
    for (let p = 0; p < 16; p += 1) {
      const g = diffs(reqs.filter((r) => pollOf(r) === p).map((r) => r.epoch));
      maxGap = Math.max(maxGap, ...g);
    }
    const overlap = sim.linesWith("OVERLAP");
    const result = { requests: reqs.length, windowsOf16WithMissingPoll: violations, firstViolation, maxGapBetweenRequestsOfOnePollMs: maxGap, overlapLines: overlap.length, samples };
    console.log("D3", JSON.stringify(result));
    await testInfo.attach("d3.json", { body: JSON.stringify(result, null, 1), contentType: "application/json" });
    expect.soft(violations, `every window of 16 consecutive requests contains all 16 polls (${firstViolation})`).toBe(0);
    expect.soft(maxGap, "no poll waits more than 2 s between two requests").toBeLessThanOrEqual(2000);
    expect.soft(overlap, "no OVERLAP lines").toEqual([]);
    // clear the delay: the suffix goes away within 2 s
    await sim.ctlOk("clear");
    const tClear = Date.now();
    let gone: number | null = null;
    while (Date.now() - tClear < 6000) {
      const lines = await Promise.all(ids.map((id) => mm.statusText(id)));
      if (lines.every((t) => !t.includes("effective"))) {
        gone = Date.now() - tClear;
        break;
      }
      await sleep(100);
    }
    const afterBar = (await mm.trafficBar.innerText()).replace(/\s+/g, " ");
    const afterReqs = sim.requestsDecoded(sim.mark() - 1);
    void afterReqs;
    console.log("D3 CLEAR", JSON.stringify({ suffixGoneAfterMs: gone, barAfter: afterBar }));
    await testInfo.attach("d3-clear.json", { body: JSON.stringify({ suffixGoneAfterMs: gone, barAfter: afterBar }), contentType: "application/json" });
    expect.soft(gone, "the (effective ...) suffix disappears from every status line within 2 s of clear (null = never within 6 s)").not.toBeNull();
    expect.soft(gone ?? 99999, "suffix gone within 2 s").toBeLessThanOrEqual(2000);
    expect(test.info().errors.length).toBe(0);
  });
});
