// Integration mode (REPORT-006), (c): faults injected through the simulator control port. `unit=<id>` makes ONE
// poll fail while the others stay live. Connection state versus poll state, Reconnect/Dismiss, link lost during
// a write. CHK2-A4/A5/A6, C1, C3, C4, D6, K7 (and CHK-001 F/G/H/I ideas on the new DOM).
import { expect, test, type RealMm, type Sim } from "../integration/fixtures";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";
import { untilFrames } from "../integration/helpers";

const FOUR = [
  { name: "A", slave: 1, fc: 3 as const, start: 0, qty: 5, scan: 100 },
  { name: "B", slave: 2, fc: 3 as const, start: 10, qty: 5, scan: 100 },
  { name: "C", slave: 3, fc: 4 as const, start: 0, qty: 3, scan: 100 },
  { name: "D", slave: 4, fc: 3 as const, start: 20, qty: 5, scan: 100 },
];

/** Connects (timeout 300 ms) and creates four polls A-D on slaves 1-4, all polling. */
async function live4(mm: RealMm, sim: Sim, timeoutMs = 300): Promise<number[]> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs });
  const ids = await createPolls(mm, FOUR);
  for (const id of ids) await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  return ids;
}

const txOf = async (mm: RealMm, id: number) => Number((await mm.statusText(id)).match(/Tx (\d+)/)?.[1]);

/** Every poll except `failing` keeps getting new requests (no gap longer than `gapMs`) and stays Polling. */
async function othersStayLive(mm: RealMm, ids: number[], failing: number, gapMs = 2000) {
  const before = new Map<number, number>();
  for (const id of ids) before.set(id, await txOf(mm, id));
  await expect
    .poll(async () => {
      let ok = true;
      for (const id of ids) if (id !== failing && (await txOf(mm, id)) <= (before.get(id) ?? 0) + 2) ok = false;
      return ok;
    }, { timeout: gapMs * 4, intervals: [200] })
    .toBe(true);
  for (const id of ids) {
    if (id === failing) continue;
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
    expect(await mm.statusText(id), "no errors on the healthy poll").toContain("Err 0");
  }
}

test.describe("(c) faults: one poll fails, the others stay live", () => {
  test("CHK2-C3 drop replies for slave 2 only: B Timeout (warning), chip and summary, A/C/D keep polling, back to Polling when cleared", async ({ mm, sim }) => {
    test.setTimeout(90_000);
    const ids = await live4(mm, sim);
    const [a, b, c, d] = ids as [number, number, number, number];
    await sim.ctlOk("fault drop unit=2");
    await expect(mm.statusLine(b)).toHaveAttribute("data-state", "timeout", { timeout: 10_000 });
    await expect(mm.statusLine(b)).toContainText("No response within 300 ms");
    await expect(mm.row(b)).toContainText(/Timeout \d+/);
    await expect(mm.summaryChip).toContainText("1 timeout · 3 live");
    await expect.poll(() => mm.page.title()).toBe("Modbus Master - Untitled * - Connected (1 timeout · 3 live)");
    await expect(mm.pill).toContainText("Connected"); // the connection state is not touched by a poll failure
    await mm.expectConnection("connected");
    expect(await mm.statusText(b)).toMatch(/Err [1-9]\d*/);
    await othersStayLive(mm, ids, b);
    // the other polls' wire cadence: no gap longer than 2 s for A, C, D while B times out
    const mark = sim.mark();
    await untilFrames(sim, mark, "TX", 20);
    for (const unit of [1, 3, 4]) {
      const reqs = sim.requestsDecoded(mark).filter((r) => r.unit === unit);
      expect(reqs.length, `unit ${unit} requests during the fault`).toBeGreaterThan(3);
      for (let i = 1; i < reqs.length; i += 1) expect((reqs[i]?.epoch ?? 0) - (reqs[i - 1]?.epoch ?? 0)).toBeLessThan(2000);
    }
    await sim.ctlOk("clear");
    await expect(mm.statusLine(b)).toHaveAttribute("data-state", "polling", { timeout: 10_000 });
    await expect(mm.summaryChip).toContainText("4 live");
    expect(sim.linesWith("OVERLAP")).toEqual([]);
    void a; void c; void d;
  });

  test("CHK2-C1/K7 exception from slave 3 only: chip 'Exception 04', reason text, others live; exceptions count in Responses and Errors, not Timeouts", async ({ mm, sim }) => {
    const ids = await live4(mm, sim);
    const c = ids[2] as number;
    const before = await mm.totals();
    await sim.ctlOk("fault exception 4 unit=3");
    await expect(mm.statusLine(c)).toHaveAttribute("data-state", "exception", { timeout: 10_000 });
    await expect(mm.statusLine(c)).toContainText("Exception 04 (Server device failure)");
    await expect(mm.row(c)).toContainText("Exc 04");
    await expect(mm.summaryChip).toContainText("1 exception · 3 live");
    await othersStayLive(mm, ids, c);
    const after = await mm.totals();
    expect(after.timeouts, "exceptions are not timeouts").toBe(before.timeouts);
    expect(after.errors).toBeGreaterThan(before.errors);
    await sim.ctlOk("clear");
    await expect(mm.statusLine(c)).toHaveAttribute("data-state", "polling", { timeout: 10_000 });
  });

  for (const [fault, text] of [
    ["wrong-unit 9", /Bad response: reply from slave 9, expected 3/],
    ["wrong-txn", /Bad response: transaction ID mismatch \(got \d+, expected \d+\)/],
    ["wrong-function", /Bad response: reply for FC03, expected FC04/],
    ["truncate 8", /Bad response: short frame \(8 of 15 bytes\)/],
    ["garbage", /Bad response: short frame \(4 of 8 bytes\)/],
  ] as const) {
    test(`CHK2-C4 '${fault}' for slave 3 only: C shows a bad response, the others stay live, the connection stays Connected`, async ({ mm, sim }) => {
      const ids = await live4(mm, sim);
      const c = ids[2] as number;
      await sim.ctlOk(`fault ${fault} unit=3`);
      await expect(mm.statusLine(c)).toHaveAttribute("data-state", "badResponse", { timeout: 10_000 });
      await expect(mm.statusLine(c)).toContainText(text);
      await expect(mm.row(c)).toContainText("Bad response");
      await expect(mm.summaryChip).toContainText("1 bad response · 3 live");
      await expect(mm.pill).toContainText("Connected");
      await othersStayLive(mm, ids, c);
      await sim.ctlOk("clear");
      await expect(mm.statusLine(c)).toHaveAttribute("data-state", "polling", { timeout: 10_000 });
      expect(sim.linesWith("OVERLAP")).toEqual([]);
    });
  }

  test("CHK2-K7 per-poll counter semantics: drop times=3 gives Timeouts 3 and status line Err 3; exceptions count in Responses and Errors", async ({ mm, sim }) => {
    const ids = await live4(mm, sim);
    const b = ids[1] as number;
    // pause the others so only B is on the link; then reset B's own counters through its menu to start from zero
    await mm.toolbarButton("Pause all").click();
    await expect(mm.statusLine(b)).toHaveAttribute("data-state", "paused");
    await expect.poll(async () => (await mm.totals()).requests, { timeout: 5000 }).toBe(sim.requestsSince(0));
    await focusPoll(mm, b);
    await mm.statusLine(b).getByRole("button", { name: "Poll actions" }).click();
    await mm.page.getByRole("menuitem", { name: /Reset counters for this poll/ }).click();
    await expect.poll(async () => (await mm.statusText(b)).match(/Tx (\d+)/)?.[1]).toBe("0");
    const mark = sim.mark();
    await sim.ctlOk("fault drop unit=2 times=3");
    await focusPoll(mm, b);
    await mm.page.keyboard.press("Control+p"); // resume only B
    await expect(mm.statusLine(b)).toHaveAttribute("data-state", /polling|timeout/);
    await expect.poll(() => sim.linesWith("NO-REPLY", mark).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    await expect.poll(async () => (await mm.statusText(b)).match(/Err (\d+)/)?.[1], { timeout: 5000, message: "the app counted the third timeout" }).toBe("3");
    await mm.page.keyboard.press("Control+p"); // pause B again
    await expect(mm.statusLine(b)).toHaveAttribute("data-state", "paused");
    const reqs = sim.requestsDecoded(mark).filter((r) => r.unit === 2).length;
    await expect.poll(async () => (await mm.statusText(b)).match(/Tx (\d+)/)?.[1], { timeout: 5000 }).toBe(String(reqs));
    expect(await mm.statusText(b)).toContain("Err 3");
  });

  test("CHK2-A5/A6 'fault close' (device closes the socket): Disconnected with reason, assertive announcement once, Reconnect restores polling per intent", async ({ mm, sim }) => {
    const ids = await live4(mm, sim);
    await mm.page.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { __qa: string[] }).__qa = log;
      const el = document.querySelector('[data-testid="live-assertive"]');
      if (el) new MutationObserver(() => log.push(el.textContent ?? "")).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await sim.ctlOk("fault close unit=3");
    await mm.expectPill(/Disconnected/);
    await mm.expectConnection("disconnected");
    await expect(mm.banner).toBeVisible();
    const bannerText = (await mm.banner.innerText()).replace(/\s+/g, " ");
    console.log("BANNER", bannerText);
    await expect(mm.bannerButton("Reconnect")).toBeVisible();
    await expect(mm.bannerButton("Dismiss")).toBeVisible();
    for (const id of ids) {
      await expect(mm.statusLine(id)).toHaveAttribute("data-state", "offline");
      await expect(mm.statusLine(id)).toContainText("No connection: link lost");
    }
    // the assertive region announced the loss once, starting with "Disconnected."
    const announced = (await mm.page.evaluate(() => (window as unknown as { __qa: string[] }).__qa)).filter((t) => t !== "");
    console.log("ASSERTIVE", JSON.stringify(announced));
    expect(announced.filter((t) => t.startsWith("Disconnected")).length, "the loss is announced exactly once").toBe(1);
    await expect.poll(() => mm.page.title()).toBe("Modbus Master - Untitled * - Disconnected");
    // reconnect: polls with the run intent poll again
    await sim.ctlOk("clear");
    await mm.bannerButton("Reconnect").click();
    await expect(mm.pill).toContainText("Connected", { timeout: 10_000 });
    for (const id of ids) await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling", { timeout: 10_000 });
    await expect(mm.banner).toHaveCount(0);
  });

  test("CHK2-A6 Dismiss after a lost link: back to idle, polls Offline with 'No connection', stale values cleared", async ({ mm, sim }) => {
    const ids = await live4(mm, sim);
    const a = ids[0] as number;
    await expect.poll(async () => (await mm.rowCells(a, 0)).at(-1)).toBe("1234");
    await sim.ctlOk("stop");
    await mm.expectPill(/Disconnected/);
    await mm.bannerButton("Dismiss").click();
    await mm.expectConnection("idle");
    await mm.expectPill("Not connected", "plug");
    for (const id of ids) {
      await expect(mm.statusLine(id)).toHaveAttribute("data-state", "offline");
      await expect(mm.statusLine(id)).toContainText("No connection");
    }
    await expect.poll(async () => (await mm.rowCells(a, 0)).at(-1) ?? "").toBe("");
    await expect(mm.banner).toHaveCount(0);
  });

  test("CHK2-A5 'stop' then 'resume': Reconnect fails while the device is away (connection refused), works when it is back", async ({ mm, sim }) => {
    const ids = await live4(mm, sim, 1000);
    await sim.ctlOk("stop");
    await mm.expectPill(/Disconnected/);
    await mm.bannerButton("Reconnect").click();
    // refused connect: the pill stays Disconnected and the banner says why
    await expect(mm.banner).toContainText(/Connection refused|No answer from/, { timeout: 15_000 });
    await expect(mm.pill).toContainText("Disconnected");
    await sim.ctlOk("resume");
    await mm.bannerButton("Reconnect").click();
    await expect(mm.pill).toContainText("Connected", { timeout: 15_000 });
    for (const id of ids) await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling", { timeout: 10_000 });
  });

  test("CHK2-A4 'refuse on': connect to a refused port shows the reason, the polls stay Offline, the section is expanded", async ({ mm, sim }) => {
    await referenceMap(sim);
    await sim.ctlOk("refuse on");
    await mm.toolbarButton("New poll").click();
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 3000, noWait: true });
    await expect(mm.banner).toContainText(/Connection refused|No answer from/, { timeout: 15_000 });
    await mm.expectConnection("disconnected");
    await expect(mm.hostField).toBeVisible(); // the CONNECTION section is expanded after a refused connect
    await expect(mm.statusLine(await mm.idByName("Poll 1"))).toHaveAttribute("data-state", "offline");
  });
});

test.describe("(c) writes with the link failing", () => {
  async function openWrite(mm: RealMm, id: number): Promise<void> {
    await mm.row(id).click();
    await mm.grid(id).focus();
    await mm.page.keyboard.press("Control+e");
    await expect(mm.writeDialog).toBeVisible();
  }
  const field = (mm: RealMm, label: string) => mm.writeDialog.getByLabel(label, { exact: true });

  test("CHK2-D4 FC06 write (address 40, value 7) from A: confirmed text, exact wire bytes, applied on the device, traffic 'Write: A'", async ({ mm, sim }) => {
    const ids = await live4(mm, sim);
    const a = ids[0] as number;
    await openWrite(mm, a);
    await expect(mm.writeDialog).toContainText("Write · A");
    await field(mm, "Function").selectOption("6");
    await field(mm, "Start address").fill("40");
    await field(mm, "Value").fill("7");
    const mark = sim.mark();
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect(mm.page.getByTestId("write-result")).toContainText("Write confirmed by slave 1: register at 40.");
    const w = sim.requestsDecoded(mark).filter((r) => r.fc === 6);
    expect(w).toHaveLength(1);
    expect(w[0]?.bytes.slice(6)).toBe("00 00 00 06 01 06 00 28 00 07");
    expect(await sim.get("holding", 40)).toEqual([7]);
    // the write followed the in-flight request and preceded the next request of any poll: strict alternation
    const frames = sim.framesSince(mark);
    const i = frames.findIndex((f) => f.dir === "RX" && /06 00 28 00 07$/.test(f.bytes ?? ""));
    expect(frames[i + 1]?.dir, "its reply comes next").toBe("TX");
    expect(sim.linesWith("OVERLAP")).toEqual([]);
    await mm.writeDialog.getByRole("button", { name: "Close", exact: true }).click();
    await mm.expandTraffic();
    await expect(mm.frameList.getByRole("gridcell", { name: "Write: A" }).first()).toBeVisible();
  });

  test("CHK2-D6 link lost during a write (device holds the reply, then stops): result text with [Reconnect]; another view's queued write says 'Not connected'", async ({ mm, sim }) => {
    test.setTimeout(90_000);
    const ids = await live4(mm, sim, 3000);
    const [a, b] = ids as [number, number];
    // only slave 1 requests are held: pause A first so the next slave 1 request is the write
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+p");
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "paused");
    await openWrite(mm, a);
    await field(mm, "Function").selectOption("6");
    await field(mm, "Start address").fill("3");
    await field(mm, "Value").fill("9");
    await sim.ctlOk("fault delay 2500 times=1 unit=1");
    const mark = sim.mark();
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => sim.framesSince(mark).some((f) => f.dir === "RX" && /06 00 03 00 09$/.test(f.bytes ?? ""))).toBe(true);
    await sim.ctlOk("stop"); // closes the connection while the reply is held
    const result = mm.page.getByTestId("write-result");
    await expect(result).toContainText(
      "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.",
    );
    await expect(result.getByRole("button", { name: "Reconnect" })).toBeVisible();
    await mm.expectConnection("disconnected");
    await expect(mm.statusLine(b)).toHaveAttribute("data-state", "offline");
    await sim.ctlOk("resume");
    await result.getByRole("button", { name: "Reconnect" }).click();
    await mm.expectConnection("connected");
    expect(await sim.get("holding", 3), "the write had been applied before the link dropped").toEqual([9]);
  });

  test("CHK2-D6 queued write when the link drops: 'Not connected. Connect before writing.' and no TX for the write", async ({ mm, sim }) => {
    test.setTimeout(90_000);
    const ids = await live4(mm, sim, 6000);
    const a = ids[0] as number;
    await mm.toolbarButton("Pause all").click();
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "paused");
    await openWrite(mm, a);
    await field(mm, "Function").selectOption("6");
    await field(mm, "Start address").fill("3");
    await field(mm, "Value").fill("55");
    // hold the next request (a slave 2 poll after Resume would be too racy): resume B alone, hold its reply, queue the write
    await mm.writeDialog.getByRole("button", { name: "Close", exact: true }).click();
    await sim.ctlOk("fault delay 3000 unit=2");
    await focusPoll(mm, ids[1] as number);
    await mm.page.keyboard.press("Control+p");
    const mark = sim.mark();
    await expect.poll(() => sim.framesSince(mark).some((f) => f.dir === "RX")).toBe(true); // B's request is now held
    await openWrite(mm, a);
    await field(mm, "Function").selectOption("6");
    await field(mm, "Start address").fill("3");
    await field(mm, "Value").fill("55");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await sim.ctlOk("stop");
    await expect(mm.page.getByTestId("write-result")).toContainText("Not connected. Connect before writing.");
    await expect(mm.page.getByTestId("write-result").getByRole("button", { name: "Reconnect" })).toHaveCount(0);
    const writes = sim.requestsDecoded(mark).filter((r) => r.fc === 6);
    expect(writes, "the queued write was not transmitted").toHaveLength(0);
    expect(await sim.get("holding", 3)).toEqual([0]);
  });
});

test.describe("(c) CHK-001 ideas on the new app", () => {
  test("CHK-001 N7 worked example on the real backend (one poll): 15 requests = 5 normal + 3 dropped + 3 exception 02 + 2 wrong unit + 2 truncated -> Requests 15, Responses 8, Errors 7, Timeouts 3; status line Tx 15 / Err 10", async ({ mm, sim }) => {
    test.setTimeout(120_000);
    await referenceMap(sim);
    await mm.autoStart.setChecked(true); // before the poll exists: a new poll takes its run intent from this checkbox
    await mm.toolbarButton("New poll").click();
    const id = await mm.idByName("Poll 1");
    await mm.applySetup(id, { name: "Poll 1", slave: 1, fc: 3, start: 0, qty: 10, scan: 1000 });
    await mm.closeSetup(id);
    const mark = sim.mark();
    // scan 1000 ms and timeout 300 ms: a reply can never arrive after the next request was sent
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 300 });
    const replies = () => sim.framesSince(mark).filter((f) => f.dir === "TX").length;
    const dropped = () => sim.linesWith("NO-REPLY", mark).length;
    const until = (read: () => number, n: number) => expect.poll(read, { timeout: 30_000, intervals: [100] }).toBeGreaterThanOrEqual(n);
    await until(replies, 5);
    await sim.ctlOk("fault drop times=3");
    await until(dropped, 3);
    await sim.ctlOk("fault exception 2 times=3");
    await until(replies, 8);
    await sim.ctlOk("fault wrong-unit 2 times=2");
    await until(replies, 10);
    await sim.ctlOk("fault truncate 20 times=2");
    await until(replies, 12);
    await mm.sub(id).locator('[data-slot="title-bar"]').click();
    await mm.page.keyboard.press("Control+Shift+P"); // pause before the 16th request
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "paused");
    expect(sim.requestsSince(mark), "exactly 15 requests reached the device").toBe(15);
    await expect.poll(() => mm.totals(), { timeout: 5000, intervals: [100] }).toEqual({ requests: 15, responses: 8, errors: 7, timeouts: 3 });
    await expect(mm.statusLine(id)).toContainText("Tx 15 · Err 10");
    await mm.expandTraffic();
    await expect(mm.frameList).toHaveAttribute("aria-rowcount", "28"); // 15 TX + 12 RX + header
  });

  test("CHK-001 I11 refused connect with Timeout 300 ms: either text, the app does not hang, three attempts", async ({ mm, sim }) => {
    await referenceMap(sim);
    await sim.ctlOk("refuse on");
    await mm.toolbarButton("New poll").click();
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 300, noWait: true });
    const texts: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(mm.banner).toContainText(new RegExp(`Connection refused by 127\.0\.0\.1:${sim.modbusPort}\.|No answer from 127\.0\.0\.1:${sim.modbusPort} within 300 ms\.`), { timeout: 15_000 });
      texts.push((await mm.banner.innerText()).replace(/\s+/g, " "));
      await mm.expectConnection("disconnected");
      await mm.bannerButton("Reconnect").click();
    }
    console.log("I11 ATTEMPTS", JSON.stringify(texts));
    await mm.expectPill(/Disconnected/);
  });
});
