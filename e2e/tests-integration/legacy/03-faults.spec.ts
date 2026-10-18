// Integration mode, priority 3: faults injected through the simulator control port, against the
// real backend. Texts are those of DES-001 / CHK-001 revision 3.
import type { Locator } from "@playwright/test";
import {
  expect,
  expectQuiet,
  referenceMap,
  realConnect,
  test,
  trafficRows,
  enlargeTraffic,
  txnOf,
  withoutTxn,
  type ModbusApp,
  type Sim,
} from "../../integration/legacy/helpers-fixtures";

const SCAN = 150;
const TIMEOUT = 300;

async function startPolling(mm: ModbusApp, sim: Sim, extra: Parameters<typeof realConnect>[2] = {}): Promise<void> {
  await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: TIMEOUT, ...extra });
  await mm.expectPill("Polling", "activity");
  await expect(mm.chip).toContainText("Updated");
}

test.beforeEach(async ({ sim }) => {
  await referenceMap(sim);
});

test.describe("F. timeout (fault drop)", () => {
  test("CHK-F1/F2/F3 drop: Timeout pill and banner, counters, stale values, no re-announce, recovery", async ({ mm, sim }) => {
    await startPolling(mm, sim);
    await sim.ctlOk("fault drop");
    await mm.expectPill("Timeout", "timer-off");
    await expect(mm.pill).toHaveCSS("background-color", "rgb(250, 129, 48)");
    await expect(mm.banner.locator("p")).toContainText(
      `Timeout: slave 1 did not respond within ${TIMEOUT} ms. Retrying every ${SCAN} ms (`,
    );
    await expect(mm.chip).toContainText("No response - values from");
    await expect(mm.value(0)).toHaveText("1234");
    // the polite live region is written once for the transition, not for every repeat
    await expect(mm.livePolite).toContainText("Timeout.");
    await mm.page.evaluate(() => {
      const el = document.querySelector('[data-testid="live-polite"]') as Element;
      window.__qa = { mutations: 0 };
      new MutationObserver((l) => {
        (window.__qa as { mutations: number }).mutations += l.length;
      }).observe(el, { childList: true, subtree: true, characterData: true });
    });
    await expect
      .poll(async () => Number(/\((\d+) in a row\)/.exec(await mm.banner.locator("p").innerText())?.[1] ?? 0))
      .toBeGreaterThanOrEqual(6);
    expect(await mm.page.evaluate(() => (window.__qa as { mutations: number }).mutations)).toBe(0);
    const dropped = sim.entries().filter((e) => e.dir === "NO-REPLY").length;
    await expect.poll(async () => Number(await mm.counter("Timeouts").innerText())).toBeGreaterThanOrEqual(4);
    expect(dropped).toBeGreaterThanOrEqual(4);
    await sim.ctlOk("clear");
    await mm.expectPill("Polling", "activity");
    await mm.expectNoBanner();
    await expect(mm.chip).toContainText("Updated");
  });

  test("CHK-F4 timeout from the first cycle: dashes and Waiting for first response", async ({ mm, sim }) => {
    await sim.ctlOk("fault drop");
    await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: TIMEOUT });
    await mm.expectPill("Timeout", "timer-off");
    await expect(mm.chip).toHaveText("Waiting for first response…");
    await expect(mm.value(0)).toHaveText("—");
  });

  test("CHK-F5 Pause during timeout: paused, banner gone", async ({ mm, sim }) => {
    await startPolling(mm, sim);
    await sim.ctlOk("fault drop");
    await mm.expectPill("Timeout", "timer-off");
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await mm.expectNoBanner();
  });

  test("CHK-F6 timeout 50 ms with a 100 ms delayed reply: Timeout within 50 ms; the late bytes are noted and discarded", async ({
    mm,
    sim,
  }) => {
    await sim.ctlOk("fault delay 100");
    await realConnect(mm, sim, { scanMs: 200, timeoutMs: 50 });
    await mm.expectPill("Timeout", "timer-off");
    await expect(mm.banner.locator("p")).toContainText("did not respond within 50 ms");
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await enlargeTraffic(mm);
    await expect
      .poll(async () => (await trafficRows(mm)).some((r) => /Unexpected bytes while no request was pending \(discarded\)/.test(r.info)))
      .toBe(true);
    await expect(mm.counter("Timeouts")).not.toHaveText("0");
  });

  test("CHK-F (BE-001 change 7) a late reply that arrives while the next request waits is logged as 'Late reply to transaction N (discarded)'", async ({
    mm,
    sim,
  }) => {
    // One cycle is timeout 50 ms + scan 20 ms = 70 ms: a request waits during [0, 50) and the line is idle
    // during [50, 70). A reply delayed by 95 ms lands at 25 ms into a later cycle, in the middle of that
    // request's wait window, whatever the jitter (a 100 ms delay sits near the window edge and
    // sometimes landed in the idle gap, which is the other note: "Unexpected bytes while no request was pending").
    await sim.ctlOk(`fault delay ${process.env.LATE_DELAY ?? 95}`);
    await realConnect(mm, sim, { scanMs: 20, timeoutMs: 50 });
    await mm.expectPill("Timeout", "timer-off");
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await enlargeTraffic(mm);
    await expect
      .poll(async () => (await trafficRows(mm)).some((r) => /Late reply to transaction \d+ \(discarded\)/.test(r.info)))
      .toBe(true);
  });
});

test.describe("G. exception (device)", () => {
  test("CHK-G1/G2/G3/G4 beyond the map: Exception 02 pill, banner, RX row, Errors, recovery", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: TIMEOUT, start: 95, quantity: 10 });
    await mm.expectPill("Exception 02", "octagon-x");
    await expect(mm.banner.locator("p")).toContainText(
      "Exception 02 (Illegal data address) from slave 1 for FC03 at 95-104. Retrying every 150 ms (",
    );
    await expect(mm.dataEmpty).toHaveText("No data: the device answered with exception 02 (Illegal data address).");
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await enlargeTraffic(mm);
    const rows = await trafficRows(mm);
    const rx = rows.find((r) => r.dir === "← RX");
    expect(rx?.info).toBe("Exception 02 Illegal data address");
    expect(rx?.bytes).toContain("83 02");
    const errors = Number(await mm.counter("Errors").innerText());
    expect(errors).toBeGreaterThanOrEqual(1);
    expect(await mm.counter("Responses").innerText()).toBe(await mm.counter("Requests").innerText());
    // G4: back to 0 and Apply while paused, then resume
    await mm.start.fill("0");
    await mm.applyButton.click();
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Polling", "activity");
    await mm.expectNoBanner();
  });

  test("CHK-G5 unknown exception code 0x0C", async ({ mm, sim }) => {
    await sim.ctlOk("fault exception 0x0C");
    await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: TIMEOUT });
    await mm.expectPill("Exception 0C", "octagon-x");
    await expect(mm.banner.locator("p")).toContainText("Exception 0C (Unknown exception) from slave 1 for FC03 at 0-9.");
  });

  test("CHK-G6 exception then timeout: the counter text restarts at 1 in a row", async ({ mm, sim }) => {
    await sim.ctlOk("fault exception 2");
    await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: TIMEOUT });
    await mm.expectPill("Exception 02", "octagon-x");
    await expect(mm.banner).toContainText("(3 in a row)");
    await mm.page.evaluate(() => {
      const texts: string[] = [];
      window.__qa = { texts };
      const read = () => {
        const t = document.querySelector('[data-slot="state-banner"] p')?.textContent;
        if (t && texts.at(-1) !== t) texts.push(t);
      };
      new MutationObserver(read).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await sim.ctlOk("fault drop");
    await mm.expectPill("Timeout", "timer-off");
    const texts = () => mm.page.evaluate(() => (window.__qa as { texts: string[] }).texts);
    await expect.poll(async () => (await texts()).some((t) => t.startsWith("Timeout:"))).toBe(true);
    const firstTimeout = (await texts()).find((t) => t.startsWith("Timeout:"));
    expect(firstTimeout, "the first Timeout banner after an exception").toContain("(1 in a row)");
  });
});

test.describe("H. bad responses", () => {
  const retry = (n: number) => `Retrying every ${SCAN} ms (${n} in a row).`;

  test("CHK-H1 TCP wrong unit 2: reply from slave 2, expected 1; H4; H3 recovery", async ({ mm, sim }) => {
    await startPolling(mm, sim);
    await sim.ctlOk("fault wrong-unit 2");
    await mm.expectPill("Bad response", "triangle-alert");
    await expect(mm.pill.locator('[data-icon="timer-off"]')).toHaveCount(0);
    await expect(mm.banner.locator("p")).toContainText("Bad response from slave 1: reply from slave 2, expected 1. Retrying every");
    await sim.ctlOk("clear");
    await mm.expectPill("Polling", "activity");
  });

  test("CHK-H2/H5 truncate 20: short frame (20 of 29 bytes), RX row Len 20 and the raw bytes, Errors +1 per cycle, Timeouts 0", async ({
    mm,
    sim,
  }) => {
    await startPolling(mm, sim);
    const mark = sim.mark();
    await sim.ctlOk("fault truncate 20");
    await mm.expectPill("Bad response", "triangle-alert");
    await expect(mm.banner.locator("p")).toContainText("Bad response from slave 1: short frame (20 of 29 bytes). Retrying every");
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await enlargeTraffic(mm);
    const rows = await trafficRows(mm);
    const bad = rows.filter((r) => r.dir === "← RX" && r.len === 20);
    expect(bad.length).toBeGreaterThanOrEqual(1);
    const simTx = sim.framesSince(mark).filter((f) => f.dir === "TX" && f.len === 20);
    expect(bad[0]?.bytes).toBe(simTx[0]?.bytes);
    expect(bad[0]?.info).toContain("short frame");
    await expect(mm.counter("Timeouts")).toHaveText("0");
    await expect
      .poll(async () => Number(await mm.counter("Errors").innerText()))
      .toBe(sim.framesSince(mark).filter((f) => f.dir === "TX" && f.len === 20).length);
  });

  test("CHK-H8 wrong function: reply for FC04, expected FC03", async ({ mm, sim }) => {
    await sim.ctlOk("fault wrong-function");
    await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: TIMEOUT });
    await mm.expectPill("Bad response", "triangle-alert");
    await expect(mm.banner.locator("p")).toContainText("Bad response from slave 1: reply for FC04, expected FC03.");
  });

  test("CHK-H (txn) wrong transaction id: transaction ID mismatch (got N, expected N-1)", async ({ mm, sim }) => {
    await sim.ctlOk("fault wrong-txn");
    await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: TIMEOUT });
    await mm.expectPill("Bad response", "triangle-alert");
    await expect(mm.banner.locator("p")).toContainText(/Bad response from slave 1: transaction ID mismatch \(got \d+, expected \d+\)\./);
  });

  test("CHK-H7 consistent MBAP length but wrong byte count: malformed frame, not short frame", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 400, timeoutMs: TIMEOUT, quantity: 2, autoStart: true });
    await mm.expectPill("Polling", "activity");
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    const lastReq = sim.frames().filter((f) => f.dir === "RX").at(-1);
    const txn = Number.parseInt((lastReq?.bytes ?? "00 00").split(" ").slice(0, 2).join(""), 16) + 1;
    const hi = (txn >> 8).toString(16).padStart(2, "0").toUpperCase();
    const lo = (txn & 0xff).toString(16).padStart(2, "0").toUpperCase();
    // reply for FC03 quantity 2 whose MBAP length (4) is complete but whose byte count (4) is not
    await sim.ctlOk(`fault garbage ${hi} ${lo} 00 00 00 04 01 03 04 00 times=1`);
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Bad response", "triangle-alert");
    await expect(mm.banner.locator("p")).toContainText("Bad response from slave 1: malformed frame");
    await expect(mm.banner).not.toContainText("short frame");
  });

  test("CHK-H (garbage) garbage bytes DE AD BE EF are a bad response, shown raw", async ({ mm, sim }) => {
    await sim.ctlOk("fault garbage");
    await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: TIMEOUT });
    // The state is Polling until the first cycle ends, so wait for the outcome of the garbage reply.
    await expect.poll(async () => (await mm.pill.innerText()).trim(), { message: "outcome of the garbage reply" }).toMatch(/^(Bad response|Timeout)$/);
    const pill = (await mm.pill.innerText()).trim();
    console.log(`GARBAGE pill=${pill}`);
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await enlargeTraffic(mm);
    const rows = await trafficRows(mm);
    expect(rows.some((r) => r.bytes === "DE AD BE EF")).toBe(true);
  });
});

test.describe("I. disconnected (device goes away)", () => {
  test("CHK-I4/I5/I6 stop: closed by peer, values kept, Reconnect fails while stopped, resume + Reconnect, Dismiss", async ({
    mm,
    sim,
  }) => {
    await startPolling(mm, sim, { timeoutMs: 3000 });
    await sim.ctlOk("stop");
    await mm.expectPill("Disconnected", "unplug");
    await expect(mm.banner.locator("p")).toHaveText(`The device at 127.0.0.1:${sim.modbusPort} closed the connection.`);
    await expect(mm.value(0)).toHaveText("1234");
    await expect(mm.chip).toContainText("Disconnected - values from");
    await expect(mm.liveAssertive).toContainText("Disconnected. The device at");
    // I1: the reconnect is refused while the device is away
    await mm.bannerButton("Reconnect").click();
    await mm.expectPill("Disconnected", "unplug");
    await expect(mm.banner.locator("p")).toHaveText(`Connection refused by 127.0.0.1:${sim.modbusPort}.`);
    // I5
    await sim.ctlOk("resume");
    await mm.bannerButton("Reconnect").click();
    await mm.expectPill("Polling", "activity");
    await expect(mm.chip).toContainText("Updated");
    // I6: Dismiss goes through mm_disconnect and ends idle
    await sim.ctlOk("stop");
    await mm.expectPill("Disconnected", "unplug");
    await mm.bannerButton("Dismiss").click();
    await mm.expectPill("Not connected", "plug");
    await mm.expectNoBanner();
    await expect(mm.dataEmpty).toContainText("Not connected.");
  });

  test("CHK-I1 connect to a stopped device: refused", async ({ mm, sim }) => {
    await sim.ctlOk("stop");
    // Windows reports a refused loopback connect only after about a second: a 300 ms timeout would win.
    await realConnect(mm, sim, { scanMs: SCAN, timeoutMs: 3000 });
    await mm.expectPill("Disconnected", "unplug");
    await expect(mm.banner.locator("p")).toHaveText(`Connection refused by 127.0.0.1:${sim.modbusPort}.`);
    await expect(mm.bannerButton("Reconnect")).toBeVisible();
    await expect(mm.bannerButton("Dismiss")).toBeVisible();
    await expect(mm.dataEmpty).toHaveText("Connection lost. Press Reconnect to continue.");
    for (const f of [mm.host, mm.port, mm.timeout]) await expect(f).toBeEditable(); // I10
  });

  test("CHK-I (refuse on) established connections keep working while new ones are refused", async ({ mm, sim }) => {
    await startPolling(mm, sim);
    await sim.ctlOk("refuse on");
    await expect(mm.chip).toContainText("Updated");
    await mm.expectPill("Polling", "activity");
    await sim.ctlOk("refuse off");
  });

  test("CHK-F (close fault) half a reply then a closed socket: link lost, no hang", async ({ mm, sim }) => {
    await startPolling(mm, sim);
    await sim.ctlOk("fault close times=1");
    await expect(mm.pill).toHaveText(/Disconnected|Bad response/);
    const label = (await mm.pill.innerText()).trim();
    expect(["Disconnected", "Bad response"]).toContain(label);
  });
});

test.describe("M. write faults and link loss (real backend)", () => {
  async function dialog(mm: ModbusApp, f: { slave?: string; address: string; value: string }) {
    await mm.toolbarButton("Write…").click();
    const d = mm.writeDialog;
    if (f.slave !== undefined) await d.getByLabel("Slave ID").fill(f.slave);
    await d.getByLabel("Start address").fill(f.address);
    await d.getByLabel("Value", { exact: true }).fill(f.value);
    return d;
  }
  const send = (d: Locator) => d.getByRole("button", { name: "Send" });

  test("CHK-M6 dropped write reply: timeout text; the device did apply the write", async ({ mm, sim }) => {
    await startPolling(mm, sim, { scanMs: 1000 });
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    const d = await dialog(mm, { address: "3", value: "77" });
    await sim.ctlOk("fault drop times=1");
    await send(d).click();
    await expect(mm.writeResult).toHaveText(`No response within ${TIMEOUT} ms. The write may or may not have been applied.`);
    expect(await sim.get("holding", 3)).toEqual([77]); // "may or may not": it did
  });

  test("CHK-M7 corrupted write reply (TCP unit rewritten to 2)", async ({ mm, sim }) => {
    await startPolling(mm, sim, { scanMs: 1000 });
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    const d = await dialog(mm, { address: "3", value: "78" });
    await sim.ctlOk("fault wrong-unit 2 times=1");
    await send(d).click();
    await expect(mm.writeResult).toHaveText(
      "Bad response: reply from slave 2, expected 1. The write may or may not have been applied.",
    );
  });

  test("CHK-M16 TCP unit 0 answered with exception 02: never Broadcast sent", async ({ mm, sim }) => {
    await startPolling(mm, sim, { scanMs: 1000 });
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    const d = await dialog(mm, { slave: "0", address: "3", value: "79" });
    await sim.ctlOk("fault exception 2 times=1");
    await send(d).click();
    await expect(mm.writeResult).toHaveText("Exception 02 (Illegal data address). Nothing was confirmed.");
    await expect(mm.writeResult).not.toContainText("Broadcast sent");
  });

  test("CHK-M17 link lost during a write (device stops while holding the reply): result, Reconnect, failed and successful reconnect", async ({
    mm,
    sim,
  }) => {
    await startPolling(mm, sim, { scanMs: 1000, timeoutMs: 3000 });
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    const d = await dialog(mm, { address: "3", value: "9" });
    await sim.ctlOk("fault delay 2500 times=1");
    const mark = sim.mark();
    await send(d).click();
    await expect.poll(() => sim.framesSince(mark).some((f) => f.dir === "RX" && /06 00 03 00 09$/.test(f.bytes ?? ""))).toBe(true);
    await sim.ctlOk("stop"); // closes the connection while the reply is held
    await expect(mm.writeResult.locator("p")).toHaveText(
      "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.",
    );
    await mm.expectPill("Disconnected", "unplug");
    const reconnect = mm.writeResult.getByRole("button", { name: "Reconnect", exact: true });
    await expect(reconnect).toBeVisible();
    await expect(send(d)).toBeDisabled();
    await expect(d.getByLabel("Start address")).toHaveValue("3");
    await expect(d.getByLabel("Value", { exact: true })).toHaveValue("9");
    // path 1b: the device is still away
    await reconnect.click();
    await expect(mm.writeResult.locator("p")).toHaveText(`Reconnect failed: Connection refused by 127.0.0.1:${sim.modbusPort}.`);
    await expect(reconnect).not.toHaveAttribute("aria-disabled", "true");
    // path 1: the device is back
    await sim.ctlOk("resume");
    await reconnect.click();
    await mm.expectPill("Polling", "activity");
    await expect(mm.writeResult).toHaveText("");
    await expect(send(d)).toBeEnabled();
    await expect(send(d)).toBeFocused();
    expect(await sim.get("holding", 3)).toEqual([9]); // the write had been applied before the link dropped
    await mm.page.keyboard.press("Escape");
    await expect(mm.value(3)).toHaveText("9");
  });

  test("CHK-M17 path 2: Esc, then Ctrl+L reconnects", async ({ mm, sim }) => {
    await startPolling(mm, sim, { scanMs: 1000 });
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    const d = await dialog(mm, { address: "3", value: "9" });
    await sim.ctlOk("fault delay 2000 times=1");
    const mark = sim.mark();
    await send(d).click();
    await expect.poll(() => sim.framesSince(mark).some((f) => f.dir === "RX")).toBe(true);
    await sim.ctlOk("stop");
    await expect(mm.writeResult.locator("p")).toContainText("Connection lost during the write.");
    await sim.ctlOk("resume");
    await mm.page.keyboard.press("Escape");
    await mm.page.keyboard.press("Control+l");
    await mm.expectPill("Polling", "activity");
  });

  test("CHK-M18 queued write when the link drops: Not connected, no TX frame for the write", async ({ mm, sim }) => {
    await startPolling(mm, sim, { scanMs: 1000, timeoutMs: 6000 });
    await sim.ctlOk("fault delay 3000"); // the held poll reply gives the test time to queue a write and stop
    const d = await dialog(mm, { address: "3", value: "55" });
    const mark = sim.mark();
    await expect.poll(() => sim.framesSince(mark).some((f) => f.dir === "RX")).toBe(true); // a poll is now held
    await send(d).click(); // queued behind the held poll
    await sim.ctlOk("stop");
    await expect(mm.writeResult.locator("p")).toHaveText("Not connected. Connect before writing.");
    await expect(mm.writeResult.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
    await mm.expectPill("Disconnected", "unplug");
    const writes = sim.framesSince(mark).filter((f) => f.dir === "RX" && withoutTxn(f.bytes ?? "").startsWith("00 00 00 06 01 06"));
    expect(writes, "the queued write must not have been transmitted").toHaveLength(0);
    expect(await sim.get("holding", 3)).toEqual([0]);
  });
});

test.describe("N7. counters under mixed faults", () => {
  // OBSOLETE (CHK-001 revision 4): the old wording "Responses = RX frames" lost to the BE-001 contract.
  // The real tests are "CHK-N7 (BE-001 contract wording)" below and the worked example in 07-rev4.spec.ts.
  test.skip("CHK-N7 (obsolete wording) Requests = TX frames, Responses = RX frames, Timeouts = dropped replies, Errors = exception + bad responses", async ({
    mm,
    sim,
  }) => {
    const mark = sim.mark();
    await startPolling(mm, sim, { scanMs: 120, timeoutMs: 200 });
    const step = async (cmd: string, expectedCalls: number) => {
      const before = sim.framesSince(mark).filter((f) => f.dir === "RX").length;
      await sim.ctlOk(cmd);
      await expect.poll(() => sim.framesSince(mark).filter((f) => f.dir === "RX").length, { timeout: 15_000 }).toBeGreaterThanOrEqual(before + expectedCalls);
    };
    await step("fault drop times=3", 3);
    await step("fault exception 2 times=3", 3);
    await step("fault wrong-unit 2 times=2", 2);
    await step("fault truncate 20 times=2", 2);
    await expect.poll(() => sim.ctl("status"), { timeout: 10_000 }).toContain("ok");
    await expect(mm.pill).toHaveText("Polling"); // faults used up, back to normal
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await enlargeTraffic(mm, 30);
    const frames = sim.framesSince(mark);
    const requests = frames.filter((f) => f.dir === "RX").length;
    const replies = frames.filter((f) => f.dir === "TX").length;
    const dropped = sim.entries().filter((e) => e.dir === "NO-REPLY").length;
    await expect.poll(async () => Number(await mm.counter("Requests").innerText())).toBe(requests);
    const got = {
      requests: Number(await mm.counter("Requests").innerText()),
      responses: Number(await mm.counter("Responses").innerText()),
      errors: Number(await mm.counter("Errors").innerText()),
      timeouts: Number(await mm.counter("Timeouts").innerText()),
    };
    await test.info().attach("counters.json", { body: JSON.stringify({ got, requests, replies, dropped }, null, 2), contentType: "application/json" });
    expect.soft(got.requests, "Requests = TX frames").toBe(requests);
    expect.soft(got.timeouts, "Timeouts = dropped replies").toBe(dropped);
    expect.soft(got.responses, "Responses = RX frames (CHK-N7 wording)").toBe(replies);
    expect.soft(got.errors, "Errors = exception replies + bad responses").toBe(3 + 2 + 2);
    void txnOf;
  });

  test("CHK-N7 (BE-001 contract wording) Responses = valid replies including exception replies", async ({ mm, sim }) => {
    const mark = sim.mark();
    await startPolling(mm, sim, { scanMs: 120, timeoutMs: 200 });
    await sim.ctlOk("fault exception 2 times=3");
    await sim.ctlOk("fault wrong-unit 2 times=2");
    await expect
      .poll(() => sim.framesSince(mark).filter((f) => f.dir === "RX").length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(12);
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    const replies = sim.framesSince(mark).filter((f) => f.dir === "TX").length;
    const valid = replies - 2; // two wrong-unit replies are bad responses
    await expect.poll(async () => Number(await mm.counter("Responses").innerText())).toBe(valid);
  });
});
