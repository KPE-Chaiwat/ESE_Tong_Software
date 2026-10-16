// Integration mode, CHK-001 revision 4: CHK-N7 worked example, CHK-I11, CHK-J29, CHK-N8.
import {
  enlargeTraffic,
  expect,
  type ModbusApp,
  parseLog,
  referenceMap,
  realConnect,
  test,
  trafficRows,
} from "../integration/helpers-fixtures";

test.beforeEach(async ({ sim }) => {
  await referenceMap(sim);
});

const rxCount = (sim: import("../integration/helpers-fixtures").Sim, mark: number) =>
  sim.framesSince(mark).filter((f) => f.dir === "RX").length;

test("CHK-N7 worked example on the real backend: 15 requests = 5 normal + 3 dropped + 3 exception 02 + 2 wrong unit + 2 truncated -> Requests 15, Responses 8, Errors 7, Timeouts 3, 12 RX rows, no (discarded) rows", async ({
  mm,
  sim,
}, testInfo) => {
  test.setTimeout(120_000);
  const mark = sim.mark();
  // scan 1000 ms and timeout 300 ms: a reply can never arrive after the next request was sent
  await realConnect(mm, sim, { scanMs: 1000, timeoutMs: 300 });
  await mm.expectPill("Polling", "activity");
  // wait for the OUTCOME of the last faulted request before the next fault replaces the active one
  const replies = () => sim.framesSince(mark).filter((f) => f.dir === "TX").length;
  const dropped = () => sim.lines.slice(mark).map(parseLog).filter((e) => e?.dir === "NO-REPLY").length;
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
  // the 15th request has its outcome; pause before the 16th request is sent (scan 1000 ms)
  await mm.toolbarButton("Pause").click();
  await mm.expectPill("Paused", "pause");
  expect(rxCount(sim, mark), "exactly 15 requests reached the device").toBe(15);

  const read = async () => ({
    requests: Number(await mm.counter("Requests").innerText()),
    responses: Number(await mm.counter("Responses").innerText()),
    errors: Number(await mm.counter("Errors").innerText()),
    timeouts: Number(await mm.counter("Timeouts").innerText()),
  });
  // counters arrive at most every 100 ms and the latest wins: wait for them to settle, then compare
  await expect.poll(read, { timeout: 5000, intervals: [100] }).toEqual({ requests: 15, responses: 8, errors: 7, timeouts: 3 });
  const got = await read();
  await testInfo.attach("n7-counters.json", { body: JSON.stringify(got, null, 2), contentType: "application/json" });
  expect(got).toEqual({ requests: 15, responses: 8, errors: 7, timeouts: 3 });

  await expect(mm.frameList).toHaveAttribute("aria-rowcount", "28"); // 15 TX + 12 RX + header
  await enlargeTraffic(mm, 30);
  const seen = new Map<number, { dir: string; info: string }>();
  await mm.frameList.evaluate((el) => {
    el.scrollTop = 0;
  });
  for (let i = 0; i < 30; i += 1) {
    for (const r of await trafficRows(mm)) seen.set(r.seq, r);
    const atEnd = await mm.frameList.evaluate((el) => {
      const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      el.scrollTop += Math.max(40, el.clientHeight - 60);
      return end;
    });
    if (atEnd) break;
  }
  const rows = [...seen.values()];
  expect(rows).toHaveLength(27);
  expect(rows.filter((r) => r.dir === "← RX")).toHaveLength(12);
  expect(rows.filter((r) => r.dir === "→ TX")).toHaveLength(15);
  expect(rows.filter((r) => r.info.includes("(discarded)")), "late replies").toEqual([]);
});

test("CHK-I11 Timeout 300 ms against a refused loopback port: either text passes, the app does not hang (3 attempts recorded)", async ({
  mm,
  sim,
}, testInfo) => {
  await sim.ctlOk("stop");
  const outcomes: { text: string; ms: number }[] = [];
  await realConnect(mm, sim, { scanMs: 150, timeoutMs: 300 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const t0 = Date.now();
    await mm.expectPill("Disconnected", "unplug");
    const text = (await mm.banner.locator("p").innerText()).trim();
    outcomes.push({ text, ms: Date.now() - t0 });
    expect([
      `No answer from 127.0.0.1:${sim.modbusPort} within 300 ms.`,
      `Connection refused by 127.0.0.1:${sim.modbusPort}.`,
    ]).toContain(text);
    if (attempt < 2) {
      await mm.bannerButton("Reconnect").click();
      // not stuck in connecting: the state leaves it within a few seconds
      await expect(mm.pill).not.toHaveText("Connecting…", { timeout: 5000 });
    }
  }
  console.log(`I11 ${JSON.stringify(outcomes)}`);
  await testInfo.attach("i11-outcomes.json", { body: JSON.stringify(outcomes, null, 2), contentType: "application/json" });
});

test.describe("CHK-J29 binary values list against the device", () => {
  test("CHK-J29 `0000 0100 1101 0010` writes four registers 0, 4, 13, 2; `0000010011010010` writes 1234", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 500 });
    await mm.expectPill("Polling", "activity");
    await mm.toolbarButton("Write…").click();
    const d = mm.writeDialog;
    await d.getByLabel("Function").selectOption("16");
    await d.getByLabel("Start address").fill("10");
    await d.getByRole("radio", { name: "Binary", exact: true }).click();
    await d.getByLabel(/^Values \(/).fill("0000 0100 1101 0010");
    await expect(d.getByText("Values (4)", { exact: true })).toBeVisible();
    await expect(d.getByText("Writes addresses 10-13.", { exact: true })).toBeVisible();
    await d.getByRole("button", { name: "Send" }).click();
    await expect(mm.writeResult).toHaveText("Write confirmed by slave 1: 4 registers at 10-13.");
    expect(await sim.get("holding", 10, 4)).toEqual([0, 4, 13, 2]);
    await d.getByLabel(/^Values \(/).fill("0000010011010010");
    await expect(d.getByText("Values (1)", { exact: true })).toBeVisible();
    await d.getByRole("button", { name: "Send" }).click();
    await expect(mm.writeResult).toHaveText("Write confirmed by slave 1: register at 10.");
    expect(await sim.get("holding", 10)).toEqual([1234]);
  });
});

test.describe("CHK-N8 clipboard refused in WebView2", () => {
  async function deny(mm: ModbusApp): Promise<void> {
    await mm.page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      });
    });
  }

  test("CHK-N8 data table copy, traffic frame copy and Copy bytes all show the refusal toast, never 'Copied'", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 300 });
    await mm.expectPill("Polling", "activity");
    await expect(mm.value(0)).toHaveText("1234");
    await deny(mm);
    const refused = mm.toast("Could not copy to the clipboard.");
    // data table
    await mm.row(0).click();
    await mm.page.keyboard.press("Control+c");
    await expect(refused).toBeVisible();
    await expect(refused.locator('[data-icon="circle-x"]')).toHaveCount(1);
    await expect(refused).toHaveAttribute("data-tone", "error");
    await expect(mm.toast(/^Copied/)).toHaveCount(0);
    await expect(refused).toHaveCount(0, { timeout: 8000 });
    // traffic frame, then Copy bytes
    await mm.frameList.locator('[id^="frame-"]').first().click();
    await mm.page.keyboard.press("Control+c");
    await expect(refused).toBeVisible();
    await expect(mm.toast(/^Copied/)).toHaveCount(0);
    await expect(refused).toHaveCount(0, { timeout: 8000 });
    await mm.frameDetail.getByRole("button", { name: "Copy bytes" }).click();
    await expect(refused).toBeVisible();
    await expect(mm.toast(/^Copied/)).toHaveCount(0);
  });
});
