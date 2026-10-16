// Integration mode, priority 2: real connect and poll against the simulator, wire bytes, counters,
// writes and their real device effect (read back with the simulator `get` control command).
import {
  enlargeTraffic,
  expect,
  expectQuiet,
  hmsLocal,
  referenceMap,
  realConnect,
  test,
  trafficRows,
  txnOf,
  withoutTxn,
} from "../integration/helpers-fixtures";

const POLL_TX = "00 00 00 06 01 03 00 00 00 0A"; // MBAP without txn: len 6, unit 1, FC03, start 0, qty 10

test.describe("D. connect and poll (real backend)", () => {
  test.beforeEach(async ({ sim }) => {
    await referenceMap(sim);
  });

  test("CHK-D1 Connect goes connecting -> polling by itself; D2 register map; D13 status bar", async ({ mm, sim }) => {
    const mark = sim.mark();
    await realConnect(mm, sim, { scanMs: 200 });
    await mm.expectPill("Polling", "activity");
    await expect(mm.pill).toHaveCSS("background-color", "rgb(34, 197, 94)");
    for (const [i, v] of ["1234", "65535", "32768", "0", "32767", "0"].entries()) {
      await expect(mm.value(i)).toHaveText(v);
    }
    await expect(mm.chip).toHaveText(/^Updated \d{2}:\d{2}:\d{2}\.\d{3}$/);
    await expect(mm.statusBar).toContainText(`TCP 127.0.0.1:${sim.modbusPort}`);
    await expect(mm.statusBar).toContainText(/Last OK \d{2}:\d{2}:\d{2}\.\d{3}/);
    await expect(mm.statusBar).toContainText(/Round trip \d+ ms/);
    const first = sim.framesSince(mark).find((f) => f.dir === "RX");
    expect(withoutTxn(first?.bytes ?? "")).toBe(POLL_TX);
  });

  test("CHK-D3/D4/D5/D6 formats and address base on live data", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 200 });
    await mm.expectPill("Polling", "activity");
    await expect(mm.value(1)).toHaveText("65535");
    await mm.page.keyboard.press("Control+2");
    for (const [i, v] of ["1234", "-1", "-32768", "0", "32767"].entries()) await expect(mm.value(i)).toHaveText(v);
    await mm.page.keyboard.press("Control+3");
    for (const [i, v] of ["0x04D2", "0xFFFF", "0x8000", "0x0000", "0x7FFF"].entries()) await expect(mm.value(i)).toHaveText(v);
    await mm.page.keyboard.press("Control+4");
    await expect(mm.value(0)).toHaveText("0000 0100 1101 0010");
    await expect(mm.value(1)).toHaveText("1111 1111 1111 1111");
    await mm.page.keyboard.press("Control+b");
    await expect(mm.address(0)).toHaveText("1");
    await expect(mm.start).toHaveValue("1");
    await expect(mm.setup.getByText("Protocol address 0")).toBeVisible();
  });

  test("CHK-D7/D8 FC01 coils, FC02 discrete inputs, FC04 input registers", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 200, fn: "1", quantity: 3 });
    await mm.expectPill("Polling", "activity");
    for (const [i, v] of ["1", "0", "1"].entries()) await expect(mm.value(i)).toHaveText(v);
    await expect(mm.formatGroup).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
    await mm.fn.selectOption("2");
    await mm.quantity.fill("1");
    await mm.applyButton.click();
    await expect(mm.summary).toContainText("FC02");
    await expect(mm.value(0)).toHaveText("1");
    await mm.fn.selectOption("4");
    await mm.applyButton.click();
    await expect(mm.summary).toContainText("FC04");
    await expect(mm.value(0)).toHaveText("4321");
    const requests = sim.frames().filter((f) => f.dir === "RX").map((f) => withoutTxn(f.bytes ?? ""));
    expect(requests).toContain("00 00 00 06 01 01 00 00 00 03");
    expect(requests).toContain("00 00 00 06 01 02 00 00 00 01");
    expect(requests).toContain("00 00 00 06 01 04 00 00 00 01");
  });

  test("CHK-D9 scan scheduling: requests are about 1000 ms apart, each with its reply", async ({ mm, sim }) => {
    const mark = sim.mark();
    await realConnect(mm, sim, { scanMs: 1000 });
    await mm.expectPill("Polling", "activity");
    await expect.poll(() => sim.framesSince(mark).filter((f) => f.dir === "RX").length, { timeout: 15_000 }).toBeGreaterThanOrEqual(5);
    const frames = sim.framesSince(mark);
    const requests = frames.filter((f) => f.dir === "RX");
    const gaps = requests.slice(1).map((f, i) => f.epoch - (requests[i]?.epoch ?? 0));
    for (const g of gaps) {
      expect(g, `gaps ${gaps.join(", ")}`).toBeGreaterThan(900);
      expect(g, `gaps ${gaps.join(", ")}`).toBeLessThan(1150);
    }
    // every request is answered by a reply with the same transaction id, in order
    for (const [i, rx] of frames.entries()) {
      if (rx.dir !== "RX") continue;
      const reply = frames[i + 1];
      expect(reply?.dir).toBe("TX");
      expect(txnOf(reply?.bytes ?? "")).toBe(txnOf(rx.bytes ?? ""));
    }
  });

  test("CHK-D10/M12 wire bytes: the traffic panel equals the simulator log, frame for frame", async ({ mm, sim }) => {
    const mark = sim.mark();
    await realConnect(mm, sim, { scanMs: 300 });
    await mm.expectPill("Polling", "activity");
    await expect.poll(() => sim.framesSince(mark).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(8);
    await mm.toolbarButton("Pause").click();
    await mm.expectPill("Paused", "pause");
    await enlargeTraffic(mm);
    const simFrames = sim.framesSince(mark);
    const rows = await trafficRows(mm);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      const s = simFrames[row.seq - 1];
      expect(s, `sim frame for panel #${row.seq}`).toBeTruthy();
      // simulator RX = the app's TX and the other way round
      expect(row.dir).toBe(s?.dir === "RX" ? "→ TX" : "← RX");
      expect(row.bytes).toBe(s?.bytes);
      expect(row.len).toBe(s?.len);
      // the panel time is the backend's timestamp: same clock as the simulator's epoch, within 150 ms
      const panelMs = Date.parse(`1970-01-01T${row.time}`);
      expect(Number.isNaN(panelMs)).toBe(false);
      const d = new Date(s?.epoch ?? 0);
      const simOfDay = ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
      const panelOfDay = ((Number(row.time.slice(0, 2)) * 60 + Number(row.time.slice(3, 5))) * 60 + Number(row.time.slice(6, 8))) * 1000 + Number(row.time.slice(9, 12));
      expect(Math.abs(panelOfDay - simOfDay), `time ${row.time} vs ${hmsLocal(s?.epoch ?? 0)}`).toBeLessThan(150);
    }
    // counters: requests = TX frames, responses = RX frames
    const tx = simFrames.filter((f) => f.dir === "RX").length;
    const rx = simFrames.filter((f) => f.dir === "TX").length;
    await expect(mm.counter("Requests")).toHaveText(String(tx));
    await expect(mm.counter("Responses")).toHaveText(String(rx));
    await expect(mm.counter("Errors")).toHaveText("0");
    await expect(mm.counter("Timeouts")).toHaveText("0");
  });

  test("CHK-D12 Apply with quantity 20 sends the new request and shows 20 rows", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 200 });
    await mm.expectPill("Polling", "activity");
    const mark = sim.mark();
    await mm.quantity.fill("20");
    await mm.applyButton.click();
    await expect(mm.table).toHaveAttribute("aria-rowcount", "21");
    await expect(mm.value(19)).toHaveText("19"); // default simulator data: holding[n] = n
    const requests = sim.framesSince(mark).filter((f) => f.dir === "RX").map((f) => withoutTxn(f.bytes ?? ""));
    expect(requests).toContain("00 00 00 06 01 03 00 00 00 14");
  });

  test("CHK-J10 start 65535 quantity 1 is sent with FF FF; 65536 is rejected", async ({ mm, sim }) => {
    const mark = sim.mark();
    await sim.ctlOk("limit 65536");
    await realConnect(mm, sim, { scanMs: 300, start: 65535, quantity: 1 });
    await mm.expectPill("Polling", "activity");
    await expect.poll(() => sim.framesSince(mark).some((f) => f.dir === "RX")).toBe(true);
    const first = sim.framesSince(mark).find((f) => f.dir === "RX");
    expect(withoutTxn(first?.bytes ?? "")).toBe("00 00 00 06 01 03 FF FF 00 01");
    await mm.start.fill("65536");
    await mm.start.blur();
    await expect(mm.setup.getByText("Start address must be a whole number from 0 to 65535.")).toBeVisible();
  });

  test("CHK-E1/E2/E4 pause stops requests, resume restarts them, a paused write reaches the device", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 200 });
    await mm.expectPill("Polling", "activity");
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Paused", "pause");
    await expect(mm.chip).toContainText("Paused - values from");
    // a request that was already in flight may still be answered; then nothing more may arrive
    await expectQuiet(sim, 1200, "no requests while paused");
    // E4: FC06 address 3 value 7 while paused
    await mm.toolbarButton("Write…").click();
    await mm.writeDialog.getByLabel("Start address").fill("3");
    await mm.writeDialog.getByLabel("Value", { exact: true }).fill("7");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect(mm.writeResult).toHaveText("Write confirmed by slave 1: register at 3.");
    expect(await sim.get("holding", 3)).toEqual([7]);
    await mm.writeDialog.getByRole("button", { name: "Close", exact: true }).click();
    await mm.page.keyboard.press("Control+p");
    await mm.expectPill("Polling", "activity");
    await expect(mm.value(3)).toHaveText("7");
  });
});

test.describe("M. writes (real backend)", () => {
  test.beforeEach(async ({ sim }) => {
    await referenceMap(sim);
  });

  async function openWrite(mm: import("../integration/fixtures").ModbusApp, fields: { fn?: string; slave?: string; address?: string; value?: string; values?: string }) {
    await mm.toolbarButton("Write…").click();
    const d = mm.writeDialog;
    if (fields.fn) await d.getByLabel("Function").selectOption(fields.fn);
    if (fields.slave !== undefined) await d.getByLabel("Slave ID").fill(fields.slave);
    if (fields.address !== undefined) await d.getByLabel("Start address").fill(fields.address);
    if (fields.value !== undefined) await d.getByLabel("Value", { exact: true }).fill(fields.value);
    if (fields.values !== undefined) await d.getByLabel(/^Values \(/).fill(fields.values);
    return d;
  }

  test("CHK-M1/M12 FC06 and FC16: confirmation, wire bytes and the device value", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 500 });
    await mm.expectPill("Polling", "activity");
    let d = await openWrite(mm, { fn: "6", address: "3", value: "500" });
    let mark = sim.mark();
    await d.getByRole("button", { name: "Send" }).click();
    await expect(mm.writeResult).toHaveText("Write confirmed by slave 1: register at 3.");
    let write = sim.framesSince(mark).find((f) => f.dir === "RX" && (f.bytes ?? "").includes(" 06 00 03 "));
    expect(withoutTxn(write?.bytes ?? "")).toBe("00 00 00 06 01 06 00 03 01 F4");
    expect(await sim.get("holding", 3)).toEqual([500]);
    await expect(mm.value(3)).toHaveText("500");

    await d.getByLabel("Function").selectOption("16");
    await d.getByLabel("Start address").fill("10");
    await d.getByLabel(/^Values \(/).fill("10 20 30");
    await expect(d.getByText("Writes addresses 10-12.", { exact: true })).toBeVisible();
    mark = sim.mark();
    await d.getByRole("button", { name: "Send" }).click();
    await expect(mm.writeResult).toHaveText("Write confirmed by slave 1: 3 registers at 10-12.");
    write = sim.framesSince(mark).find((f) => f.dir === "RX" && (f.bytes ?? "").includes(" 10 00 0A 00 03 06"));
    expect(withoutTxn(write?.bytes ?? "")).toBe("00 00 00 0D 01 10 00 0A 00 03 06 00 0A 00 14 00 1E");
    expect(await sim.get("holding", 10, 3)).toEqual([10, 20, 30]);
  });

  test("CHK-M3/M4 FC05 and FC15 coils reach the device", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 500, fn: "1", quantity: 4 });
    await mm.expectPill("Polling", "activity");
    const d = await openWrite(mm, { fn: "5", address: "1" });
    await d.getByRole("button", { name: "Send" }).click();
    await expect(mm.writeResult).toHaveText("Write confirmed by slave 1: coil at 1.");
    expect(await sim.get("coils", 1)).toEqual([1]);
    await d.getByLabel("Function").selectOption("15");
    await d.getByLabel("Start address").fill("0");
    await d.getByLabel(/^Values \(/).fill("0 1 0 1");
    await d.getByRole("button", { name: "Send" }).click();
    await expect(mm.writeResult).toHaveText("Write confirmed by slave 1: 4 coils at 0-3.");
    expect(await sim.get("coils", 0, 4)).toEqual([0, 1, 0, 1]);
  });

  test("CHK-M5 write outside the map: exception 02 from the device", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 500 });
    await mm.expectPill("Polling", "activity");
    const d = await openWrite(mm, { fn: "6", address: "200", value: "1" });
    await d.getByRole("button", { name: "Send" }).click();
    await expect(mm.writeResult).toHaveText("Exception 02 (Illegal data address). Nothing was confirmed.");
    // a write exception is a write result, not a session state
    await mm.expectPill("Polling", "activity");
  });

  test("CHK-M13 20 consecutive FC06 writes while polling at 100 ms", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 100 });
    await mm.expectPill("Polling", "activity");
    const d = await openWrite(mm, { fn: "6", address: "3", value: "1" });
    for (let i = 1; i <= 20; i += 1) {
      await d.getByLabel("Value", { exact: true }).fill(String(i));
      await d.getByRole("button", { name: "Send" }).click();
      await expect(mm.writeResult).toHaveText("Write confirmed by slave 1: register at 3.");
      await expect(d.getByRole("button", { name: "Send" })).toBeEnabled();
    }
    expect(await sim.get("holding", 3)).toEqual([20]);
    await mm.expectPill("Polling", "activity");
    await mm.expectNoBanner();
    await expect(mm.counter("Timeouts")).toHaveText("0");
  });

  test("CHK-M15 TCP unit ID 0 is a normal unit: no warning, echo reply, bytes, 5 repeats at 100 ms", async ({ mm, sim }) => {
    await realConnect(mm, sim, { scanMs: 100 });
    await mm.expectPill("Polling", "activity");
    const d = await openWrite(mm, { fn: "6", slave: "0", address: "3", value: "500" });
    await expect(d.getByText(/^Broadcast:/)).toHaveCount(0);
    const mark = sim.mark();
    for (let i = 0; i < 5; i += 1) {
      await d.getByRole("button", { name: "Send" }).click();
      await expect(mm.writeResult).toHaveText("Write confirmed by slave 0: register at 3.");
      await expect(d.getByRole("button", { name: "Send" })).toBeEnabled();
    }
    const frames = sim.framesSince(mark);
    const writes = frames.filter((f) => f.dir === "RX" && withoutTxn(f.bytes ?? "") === "00 00 00 06 00 06 00 03 01 F4");
    expect(writes).toHaveLength(5);
    for (const w of writes) {
      const reply = frames[frames.indexOf(w) + 1];
      expect(reply?.dir).toBe("TX");
      expect(reply?.bytes).toBe(w.bytes); // FC06 echo, same transaction id
    }
    await mm.expectPill("Polling", "activity");
    await mm.expectNoBanner();
    await expect(mm.counter("Errors")).toHaveText("0");
  });
});
