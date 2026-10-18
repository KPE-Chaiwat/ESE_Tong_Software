// Integration mode (REPORT-006), (b): real connect to the simulator with several polls. Values, no request
// overlap (simulator log), scan rates honored, Traffic panel equals the simulator log frame for frame,
// counters per poll and totals. CHK2-A2, A3, C1, C7, D1, D2, K1-K3, CHK3-A44.
import { expect, test } from "../integration/fixtures";
import { hmsLocal, stats } from "../integration/helpers";
import { alternation, bySignature, createPolls, intervals, pauseAll, referenceMap, signature, STANDARD_8 } from "../integration/scenario";

// 60 s as the checklist says; IT_D1_MS shortens it for debugging only.
const D1_MS = Number(process.env.IT_D1_MS ?? 60_000);

test.describe("(b) connect and poll", () => {
  test("CHK2-A2/A3/C7 connect with auto start off: polls stay Paused and silent, sidebar collapses to the summary, then values after Resume all", async ({ mm, sim }) => {
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: false });
    await expect(mm.pill).toContainText(`127.0.0.1:${sim.modbusPort}`);
    // CHK2-A3: the connection section collapsed to the summary with [Edit], fields are not editable
    await expect(mm.connectionSection).toContainText(`TCP 127.0.0.1:${sim.modbusPort}`);
    await expect(mm.connectionSection.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    const mark = sim.mark();
    const ids = await createPolls(mm, [{ name: "Poll 1", fc: 3, start: 0, qty: 5, scan: 100 }, { name: "Poll 2", fc: 4, start: 0, qty: 3, scan: 200, slave: 2 }]);
    for (const id of ids) {
      await expect(mm.row(id)).toContainText("Paused");
      await expect(mm.statusLine(id)).toContainText("Paused");
    }
    expect(sim.requestsSince(mark), "no request while every poll is paused").toBe(0);
    await mm.toolbarButton("Resume all").click();
    await expect(mm.statusLine(ids[0] as number)).toContainText("Polling");
    // values from the reference map: P1 = HR0..4, P2 = IR0 (slave 2 answers the same map)
    await expect.poll(async () => (await mm.rowCells(ids[0] as number, 1)).at(-1)).toBe("65535");
    expect((await mm.rowCells(ids[0] as number, 0)).at(-1)).toBe("1234");
    expect((await mm.rowCells(ids[0] as number, 2)).at(-1)).toBe("32768");
    expect((await mm.rowCells(ids[0] as number, 4)).at(-1)).toBe("32767");
    await expect.poll(async () => (await mm.rowCells(ids[1] as number, 0)).at(-1)).toBe("4321");
    expect((await mm.rowCells(ids[1] as number, 1)).at(-1)).toBe("65534");
    await expect(mm.statusLine(ids[1] as number)).toContainText("ID 2 · F 04 · SR 200 ms");
    // the wire: unit 1 FC03 0x5 and unit 2 FC04 0x3, nothing else
    const sigs = new Set(sim.requestsDecoded(mark).map((r) => `${r.unit}:${r.fc}@${r.addr}x${r.arg}`));
    expect([...sigs].sort()).toEqual(["1:3@0x5", "2:4@0x3"]);
  });

  test("CHK2-D1/D2/K1-K3 standard 8 polls for 60 s: no overlap, scan rates honored, Traffic == simulator log frame for frame, counters per poll and total", async ({ mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: false });
    const ids = await createPolls(mm, STANDARD_8);
    expect(ids.length).toBe(8);
    const t0 = Date.now();
    const mark = sim.mark();
    await mm.toolbarButton("Resume all").click();
    // wait for 60 s of traffic measured by the simulator's own epoch stamps
    await expect
      .poll(
        () => {
          const f = sim.framesSince(mark);
          return f.length ? (f[f.length - 1]?.epoch ?? 0) - (f[0]?.epoch ?? 0) : 0;
        },
        { timeout: 90_000, intervals: [500] },
      )
      .toBeGreaterThanOrEqual(D1_MS);
    // CHK2-D2 rev 10: no status line shows (effective ...) while the link is not saturated
    for (const [i, spec] of STANDARD_8.entries()) expect(await mm.statusText(ids[i] as number), `no (effective ...) suffix on ${spec.name}`).not.toContain("effective");
    await pauseAll(mm);
    // let the in-flight request finish and the counters (100 ms coalescing) settle
    await expect.poll(async () => (await mm.statusText(ids[0] as number)).includes("Paused"), { message: "P1 Paused" }).toBe(true);
    await expect.poll(() => sim.entries().length, { timeout: 5000, intervals: [300] }).toBe(sim.entries().length);
    const all = sim.requestsDecoded(0);
    const groups = bySignature(all);

    // --- D1: no overlap, strict request/reply alternation on the link, unique outstanding txn
    expect(sim.linesWith("OVERLAP"), "OVERLAP lines in the simulator log").toEqual([]);
    expect(sim.linesWith("ABANDONED"), "ABANDONED lines (no delay fault was used)").toEqual([]);
    const alt = alternation(sim);
    expect(alt.ok, alt.firstBad ?? "").toBe(true);
    const frames = sim.frames();
    for (let i = 0; i + 1 < frames.length; i += 1) {
      const a = frames[i];
      const b = frames[i + 1];
      if (a?.dir === "RX" && b?.dir === "TX") expect((b.bytes ?? "").slice(0, 5), `reply ${i} has its request's transaction id`).toBe((a.bytes ?? "").slice(0, 5));
    }
    expect(new Set(all.map((r) => r.conn)).size, "one TCP connection for all polls").toBe(1);

    // --- D2: every poll served at about its scan rate
    const duration = (frames.at(-1)?.epoch ?? 0) - (frames.find((f) => f.dir === "RX")?.epoch ?? 0);
    const table: Array<Record<string, unknown>> = [];
    for (const [i, spec] of STANDARD_8.entries()) {
      const list = groups.get(signature(spec)) ?? [];
      const scan = spec.scan ?? 100;
      const d = intervals(list);
      const st = stats(d);
      const expected = duration / scan;
      table.push({ poll: spec.name, scan, requests: list.length, expected: Math.round(expected), minInterval: st.min, meanInterval: st.mean, maxInterval: st.max, p95: st.p95 });
      expect(list.length, `${spec.name} requests >= 80% of ${Math.round(expected)}`).toBeGreaterThanOrEqual(Math.floor(expected * 0.8));
      expect(st.min, `${spec.name} min interval (scan ${scan} ms)`).toBeGreaterThanOrEqual(scan - 15);
      expect(st.mean, `${spec.name} mean interval`).toBeGreaterThanOrEqual(scan - 5);
      expect(st.mean, `${spec.name} mean interval`).toBeLessThanOrEqual(scan * 1.15 + 10);
      // revision 10 (D-002-20): the link is not saturated, so the accuracy rule applies to every poll: mean <= S + 4
      expect(st.mean, `CHK2-D2 rev 10: ${spec.name} mean interval <= scan + 4 ms (REPORT-006: 109 ms)`).toBeLessThanOrEqual(scan + 4);
    }
    await testInfo.attach("scan-table.json", { body: JSON.stringify({ durationMs: duration, wallMs: Date.now() - t0, table }, null, 1), contentType: "application/json" });
    console.log("SCAN TABLE", JSON.stringify({ durationMs: duration, table }));
    const p8 = groups.get(signature(STANDARD_8[7] as never)) ?? [];
    expect(p8.length, "P8 (1000 ms) about duration/1000 requests").toBeGreaterThanOrEqual(Math.floor(duration / 1000) - 5);
    expect(p8.length).toBeLessThanOrEqual(Math.ceil(duration / 1000) + 2);

    // --- counters per poll (status line `Tx`) and totals (traffic bar) equal the simulator log
    const nameCount = (i: number) => (groups.get(signature(STANDARD_8[i] as never)) ?? []).length;
    for (const [i, spec] of STANDARD_8.entries()) {
      const id = ids[i] as number;
      await expect.poll(async () => (await mm.statusText(id)).match(/Tx (\d+)/)?.[1], { message: `${spec.name} Tx`, timeout: 5000 }).toBe(String(nameCount(i)));
    }
    const rx = sim.frames().filter((f) => f.dir === "RX").length;
    const tx = sim.frames().filter((f) => f.dir === "TX").length;
    expect(tx, "every request was answered").toBe(rx);
    const exceptions = nameCount(5);
    console.log("TOTALS", JSON.stringify(await mm.totals()), "rx", rx, "tx", tx, "exceptions", exceptions);
    await expect.poll(() => mm.totals(), { timeout: 5000 }).toEqual({ requests: rx, responses: tx, errors: exceptions, timeouts: 0 });
    // P6: exception 02 on its status line, the others live (CHK2-C1)
    await expect(mm.statusLine(ids[5] as number)).toContainText("Err " + exceptions);

    // --- Traffic panel == simulator log, frame for frame (the panel keeps the newest 5000)
    await mm.expandTraffic();
    await expect.poll(async () => Number(await mm.frameList.getAttribute("aria-rowcount")), { timeout: 5000 }).toBe(Math.min(5000, rx + tx) + 1);
    const rows = await mm.readTrafficAll();
    expect(rows.length, "rows read from the panel").toBe(Math.min(5000, rx + tx));
    const simFrames = sim.frames();
    const first = rows[0]?.seq ?? 0;
    expect(rows.at(-1)?.seq, "newest # = number of frames on the wire").toBe(rx + tx);
    expect(first, "oldest # = newest - 4999").toBe(Math.max(1, rx + tx - 4999));
    let mismatches = 0;
    let timeSkew = 0;
    for (const r of rows) {
      const f = simFrames[r.seq - 1];
      const want = f?.dir === "RX" ? "→ TX" : "← RX";
      if (!f || r.dir !== want || r.bytes !== f.bytes || r.len !== f.len) {
        mismatches += 1;
        if (mismatches <= 3) console.log("MISMATCH", JSON.stringify(r), f?.raw);
      } else {
        const sample = hmsLocal(f.epoch);
        const toMs = (s: string) => {
          const m = /(\d+):(\d+):(\d+)\.(\d+)/.exec(s);
          return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]) : 0;
        };
        timeSkew = Math.max(timeSkew, Math.abs(toMs(r.time) - toMs(sample)));
      }
    }
    await testInfo.attach("traffic-compare.json", { body: JSON.stringify({ rows: rows.length, mismatches, maxTimeSkewMs: timeSkew }), contentType: "application/json" });
    console.log("TRAFFIC COMPARE", JSON.stringify({ rows: rows.length, mismatches, maxTimeSkewMs: timeSkew }));
    expect(mismatches, "traffic rows that differ from the simulator log").toBe(0);
    expect(timeSkew, "max difference between a row time and the simulator epoch (ms)").toBeLessThanOrEqual(150);
    // the Poll column names the poll
    const p3rows = rows.filter((r) => r.poll === "Poll 3");
    expect(p3rows.length).toBeGreaterThan(0);
    // K2: filter "Poll 3" shows only P3 frames and its counters equal P3's Tx
    await mm.traffic.getByRole("combobox", { name: "Traffic filter" }).selectOption({ label: "Poll 3" });
    await expect.poll(async () => Number(await mm.counter("requests").innerText())).toBe(nameCount(2));
    expect(mm.pageErrors).toEqual([]);
  });

  test("CHK3-A44 values from the simulator and scaling do not change the bytes: HR0 = 1234 reads RX `04 D2`", async ({ mm, sim }) => {
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true });
    const id = await mm.addPollUi({ name: "Poll 1", qty: 3, scan: 100 }, { closeSetup: false });
    await expect.poll(async () => (await mm.rowCells(id, 0)).at(-1)).toBe("1234");
    const reply = sim.frames().find((f) => f.dir === "TX");
    expect(reply?.bytes).toMatch(/ 04 D2 FF FF 80 00 /);
  });
});

test.describe("(b) scan rate versus number of polls (observation)", () => {
  test("INT-B-OBS the measured request interval of 100 ms polls for 1, 2, 4 and 7 polls (timer granularity on Windows)", async ({ mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: false, timeoutMs: 1000 });
    const specs = Array.from({ length: 7 }, (_, i) => ({ name: `T${i + 1}`, slave: i + 1, fc: 3 as const, start: 0, qty: 2, scan: 100 }));
    const ids = await createPolls(mm, specs);
    const table: Array<Record<string, unknown>> = [];
    let running = 0;
    for (const n of [1, 2, 4, 7]) {
      // start polls up to n (Ctrl+P on each newly added poll), then measure 8 s on the wire
      while (running < n) {
        await mm.row(ids[running] as number).click();
        await mm.grid(ids[running] as number).focus().catch(() => undefined);
        await mm.page.keyboard.press("Control+p");
        await expect(mm.statusLine(ids[running] as number)).toHaveAttribute("data-state", /polling|paused/);
        running += 1;
      }
      await expect.poll(async () => (await mm.statusLine(ids[n - 1] as number).getAttribute("data-state")) === "polling", { timeout: 10_000 }).toBe(true);
      await new Promise((r) => setTimeout(r, 1000));
      const mark = sim.mark();
      await new Promise((r) => setTimeout(r, 8000));
      const reqs = sim.requestsDecoded(mark).filter((r) => r.unit === 1);
      const d = intervals(reqs);
      const s = stats(d);
      table.push({ pollsRunning: n, requestsOfPoll1: reqs.length, minMs: s.min, meanMs: s.mean, maxMs: s.max });
    }
    console.log("SCAN VS POLLS", JSON.stringify(table));
    await testInfo.attach("scan-vs-polls.json", { body: JSON.stringify(table, null, 1), contentType: "application/json" });
    expect(table.every((r) => Number(r.meanMs) >= 95), "no poll is served faster than its scan rate").toBe(true);
  });
});

test.describe("(b) scan rate table for one poll (observation)", () => {
  test("INT-B-OBS2 one poll: configured scan rate versus the measured request interval (20, 50, 100, 250, 500 ms)", async ({ mm, sim }, testInfo) => {
    test.setTimeout(180_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const [id] = await createPolls(mm, [{ name: "One", slave: 1, fc: 3, start: 0, qty: 2, scan: 20 }]);
    const table: Array<Record<string, unknown>> = [];
    for (const scan of [20, 50, 100, 250, 500]) {
      await mm.titleButton(id as number, /^Poll setup/).click().catch(() => undefined);
      await mm.setupField(id as number, "Scan rate (ms)").fill(String(scan));
      await mm.setup(id as number).getByRole("button", { name: "Apply", exact: true }).click();
      await mm.closeSetup(id as number);
      await expect(mm.statusLine(id as number)).toContainText(`SR ${scan} ms`);
      await new Promise((r) => setTimeout(r, 1500));
      const mark = sim.mark();
      await new Promise((r) => setTimeout(r, scan >= 250 ? 12_000 : 6000));
      const reqs = sim.requestsDecoded(mark);
      const s = stats(intervals(reqs));
      table.push({ scanMs: scan, requests: reqs.length, minMs: s.min, meanMs: s.mean, maxMs: s.max, slowerPct: Math.round(((s.mean - scan) / scan) * 1000) / 10, statusLine: (await mm.statusText(id as number)).match(/SR [^U]*?ms( \(effective \d+ ms\))?/)?.[0] });
    }
    console.log("SCAN TABLE ONE POLL", JSON.stringify(table));
    await testInfo.attach("scan-one-poll.json", { body: JSON.stringify(table, null, 1), contentType: "application/json" });
    for (const r of table) expect(Number(r.meanMs), `scan ${r.scanMs} ms is never served faster than configured`).toBeGreaterThanOrEqual(Number(r.scanMs) - 2);
  });
});
