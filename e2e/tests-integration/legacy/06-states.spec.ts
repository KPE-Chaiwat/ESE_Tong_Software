// Integration mode: connected / paused / disconnect flows against the real backend (CHK-C, E, K2, L1).
import { expect, referenceMap, realConnect, test, withoutTxn, expectQuiet } from "../../integration/legacy/helpers-fixtures";

test.beforeEach(async ({ sim }) => {
  await referenceMap(sim);
});

test.describe("C. connected (real backend)", () => {
  test("CHK-C1/C2/C4 Connect without auto start: Connected, no request; Start polling; Disconnect closes the socket", async ({ desktop, mm, sim }) => {
    const mark = sim.mark();
    await realConnect(mm, sim, { autoStart: false, scanMs: 200 });
    await mm.expectPill("Connected", "link");
    await expect(mm.pill).toHaveCSS("background-color", "rgb(49, 47, 46)");
    await expect(mm.dataEmpty).toHaveText("Connected. Press Start polling (Ctrl+P) to read 10 holding registers from slave 1.");
    for (const f of [mm.host, mm.port, mm.timeout]) await expect(f).not.toBeEditable();
    for (const f of [mm.slaveId, mm.start, mm.quantity, mm.scan]) await expect(f).toBeEditable();
    await expect(mm.toolbarButton("Start polling")).toBeVisible();
    await expect(mm.toolbarButton("Write…")).toBeVisible();
    await expect.poll(() => desktop.establishedTo(sim.modbusPort)).toBe(1);
    await expectQuiet(sim, 800, "no request before Start polling");
    expect(sim.framesSince(mark)).toHaveLength(0);
    await mm.toolbarButton("Start polling").click();
    await mm.expectPill("Polling", "activity");
    await expect(mm.value(0)).toHaveText("1234");
    await mm.toolbarButton("Disconnect").click();
    await mm.expectPill("Not connected", "plug");
    await expect(mm.dataEmpty).toContainText("Not connected.");
    await expect.poll(() => desktop.establishedTo(sim.modbusPort)).toBe(0);
    await expect.poll(() => sim.lines.some((l) => /conn=1 CLOSE/.test(l))).toBe(true);
  });

  test("CHK-C3 invalid poll quantity 126: nothing is sent", async ({ mm, sim }) => {
    await realConnect(mm, sim, { autoStart: false, scanMs: 200 });
    await mm.expectPill("Connected", "link");
    await mm.quantity.fill("126");
    await expect(mm.dataEmpty).toHaveText("Fix the poll settings to start polling.");
    const mark = sim.mark();
    await mm.page.keyboard.press("Control+p");
    await expectQuiet(sim, 800, "no TX for an invalid poll");
    expect(sim.framesSince(mark)).toHaveLength(0);
  });
});

test.describe("E / K / L (real backend)", () => {
  test("CHK-E3 Apply while paused sends nothing; Resume polls from the new address on the wire", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 200 });
    await mm.expectPill("Polling", "activity");
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    await mm.start.fill("5");
    await mm.applyButton.click();
    await expect(mm.dataEmpty).toHaveText("Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.");
    await expectQuiet(sim, 800, "Apply while paused sends nothing");
    const mark = sim.mark();
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Polling", "activity");
    await expect.poll(() => sim.framesSince(mark).some((f) => f.dir === "RX")).toBe(true);
    const first = sim.framesSince(mark).find((f) => f.dir === "RX");
    expect(withoutTxn(first?.bytes ?? "")).toBe("00 00 00 06 01 03 00 05 00 0A");
    await expect(mm.address(0)).toHaveText("5");
    await expect(mm.value(0)).toHaveText("0"); // holding[5] of the reference map
  });

  test("CHK-K2 Ctrl+Shift+K clears the log and keeps the counters (real frames)", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 200 });
    await mm.expectPill("Polling", "activity");
    await expect.poll(async () => Number(await mm.counter("Requests").innerText())).toBeGreaterThanOrEqual(3);
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    const requests = await mm.counter("Requests").innerText();
    await mm.page.keyboard.press("Control+Shift+k");
    await expect(mm.page.getByTestId("traffic-empty")).toContainText("Log cleared at");
    await expect(mm.counter("Requests")).toHaveText(requests);
  });

  test("CHK-N6 Reset counters zeroes the counters and keeps the frames (real backend)", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 200 });
    await mm.expectPill("Polling", "activity");
    await expect.poll(async () => Number(await mm.counter("Requests").innerText())).toBeGreaterThanOrEqual(3);
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    await mm.traffic.getByRole("button", { name: "Reset counters" }).click();
    await mm.expectCounters({ requests: 0, responses: 0, errors: 0, timeouts: 0 });
    expect(await mm.frameList.locator('[id^="frame-"]').count()).toBeGreaterThan(0);
  });

  test("CHK-L1 Start polling: dashes and Waiting for first response until the first reply", async ({ mm, sim }) => {
    await sim.ctlOk("fault delay 1200");
    await realConnect(mm, sim, { autoStart: false, scanMs: 500, timeoutMs: 3000 });
    await mm.expectPill("Connected", "link");
    await mm.toolbarButton("Start polling").click();
    await expect(mm.chip).toHaveText("Waiting for first response…");
    await expect(mm.value(0)).toHaveText("—");
    await expect(mm.chip).toContainText("Updated");
    await expect(mm.value(0)).toHaveText("1234");
  });
});
