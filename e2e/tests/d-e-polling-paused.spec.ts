// CHK-001 D. polling and live data, E. paused
import { expect, hms, REGISTER_MAP_10, test } from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 540).getTime();

test.describe("D. polling and live data", () => {
  test("CHK-D1 Connect goes connecting -> polling by itself (auto start, simulating fake)", async ({
    simApp: app,
  }) => {
    await app.host.fill("127.0.0.1");
    await app.port.fill("5020");
    await expect(app.autoStart).toBeChecked();
    await app.toolbarButton("Connect").click();
    await app.expectPill("Polling", "activity");
    await expect(app.pill).toHaveAttribute("data-variant", "polling");
    await expect(app.pill).toHaveCSS("background-color", "rgb(34, 197, 94)");
    await expect(app.pill).toHaveCSS("color", "rgb(49, 47, 46)");
    const [connect] = (await app.calls("connect")) as [[Record<string, unknown>]];
    expect(connect[0]).toEqual({ mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 });
    const [start] = (await app.calls("startPoll")) as [[Record<string, unknown>]];
    expect(start[0]).toEqual({
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 10,
      scanRateMs: 1000,
    });
  });

  test("CHK-D2 rows 0-9 show the register map and the chip reads Updated {time}", async ({ app }) => {
    await app.toState("polling");
    await app.pollUpdate(REGISTER_MAP_10, { at: AT });
    const expected = ["1234", "65535", "32768", "0", "32767", "0"];
    for (const [i, v] of expected.entries()) await expect(app.value(i)).toHaveText(v);
    await expect(app.table.getByRole("row")).toHaveCount(11); // header + 10 rows
    await expect(app.chip).toHaveText(`Updated ${hms(AT)}`);
    await expect(app.chip.locator('[data-icon="circle-check"]')).toHaveCount(1);
  });

  test("CHK-D3 Ctrl+2 shows signed values", async ({ app, page }) => {
    await app.toLive();
    await page.keyboard.press("Control+2");
    for (const [i, v] of ["1234", "-1", "-32768", "0", "32767"].entries()) {
      await expect(app.value(i)).toHaveText(v);
    }
    await expect(app.formatGroup.getByRole("radio", { name: "Signed", exact: true })).toBeChecked();
  });

  test("CHK-D4 Ctrl+3 shows hex values", async ({ app, page }) => {
    await app.toLive();
    await page.keyboard.press("Control+3");
    for (const [i, v] of ["0x04D2", "0xFFFF", "0x8000", "0x0000", "0x7FFF"].entries()) {
      await expect(app.value(i)).toHaveText(v);
    }
  });

  test("CHK-D5 Ctrl+4 shows binary values in nibbles", async ({ app, page }) => {
    await app.toLive();
    await page.keyboard.press("Control+4");
    await expect(app.value(0)).toHaveText("0000 0100 1101 0010");
    await expect(app.value(1)).toHaveText("1111 1111 1111 1111");
  });

  test("CHK-D6 Ctrl+B toggles address base 1-based and back", async ({ app, page }) => {
    await app.toLive();
    await expect(app.table.getByRole("columnheader").first()).toContainText("Address (0-based)");
    await page.keyboard.press("Control+b");
    await expect(app.table.getByRole("columnheader").first()).toContainText("Address (1-based)");
    await expect(app.address(0)).toHaveText("1");
    await expect(app.value(0)).toHaveText("1234");
    await expect(app.value(1)).toHaveText("65535");
    await expect(app.start).toHaveValue("1");
    await expect(app.setup.getByText("Protocol address 0")).toBeVisible();
    await page.keyboard.press("Control+b");
    await expect(app.table.getByRole("columnheader").first()).toContainText("Address (0-based)");
    await expect(app.address(0)).toHaveText("0");
    await expect(app.start).toHaveValue("0");
    await expect(app.setup.getByText("Protocol address 0")).toBeVisible();
  });

  test("CHK-D7 FC01 start 0 quantity 3: values 1 0 1, Format disabled with tooltip (UI side)", async ({
    app,
  }) => {
    await app.toState("connected");
    await app.fn.selectOption("1");
    await app.quantity.fill("3");
    await app.pressAndAnswer("Start polling", "polling");
    const [[def]] = (await app.calls("startPoll")) as [[Record<string, unknown>]];
    expect(def).toMatchObject({ function: 1, startAddress: 0, quantity: 3 });
    await app.pollUpdate([1, 0, 1], { function: 1, startAddress: 0 });
    for (const [i, v] of ["1", "0", "1"].entries()) await expect(app.value(i)).toHaveText(v);
    await expect(app.formatGroup).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
    for (const r of await app.formatGroup.getByRole("radio").all()) await expect(r).toBeDisabled();
  });

  test("CHK-D8 FC02 shows 1, FC04 shows 4321 (UI side)", async ({ app }) => {
    await app.toState("polling");
    await app.fn.selectOption("2");
    await app.quantity.fill("1");
    await app.applyButton.click();
    await app.expectCalls("startPoll", 1);
    await app.emitState("polling");
    await app.pollUpdate([1], { function: 2 });
    await expect(app.value(0)).toHaveText("1");
    await app.fn.selectOption("4");
    await app.applyButton.click();
    await app.expectCalls("startPoll", 2);
    await app.emitState("polling");
    await app.pollUpdate([4321], { function: 4 });
    await expect(app.value(0)).toHaveText("4321");
    await expect(app.summary).toContainText("FC04");
  });

  test("CHK-D12 Apply with quantity 20: Waiting for first response, then 20 rows, no old row", async ({
    app,
  }) => {
    await app.toLive();
    await expect(app.value(0)).toHaveText("1234");
    await app.quantity.fill("20");
    await app.applyButton.click();
    await app.expectCalls("startPoll", 1);
    await app.emitState("polling"); // the backend restarted the poll
    await expect(app.chip).toHaveText("Waiting for first response…");
    await expect(app.table.getByRole("row")).toHaveCount(21);
    await expect(app.value(0)).toHaveText("—");
    await expect(app.value(19)).toHaveText("—");
    await app.pollUpdate(Array.from({ length: 20 }, (_, i) => 100 + i));
    await expect(app.value(0)).toHaveText("100");
    await expect(app.value(19)).toHaveText("119");
    await expect(app.chip).toContainText("Updated");
  });

  test("CHK-D13 status bar shows target, last OK and round trip", async ({ app }) => {
    await app.toState("polling");
    await app.pollUpdate(REGISTER_MAP_10, { at: AT, roundTripMs: 8 });
    await expect(app.statusBar).toContainText("TCP 127.0.0.1:5020");
    await expect(app.statusBar).toContainText(`Last OK ${hms(AT)}`);
    await expect(app.statusBar).toContainText("Round trip 8 ms");
  });
});

test.describe("E. paused", () => {
  test("CHK-E1 Ctrl+P pauses: pill, muted values, stale chip, no restart", async ({ app, page }) => {
    await app.toLive();
    await app.pollUpdate(REGISTER_MAP_10, { at: AT });
    await expect(app.chip).toHaveText(`Updated ${hms(AT)}`);
    await app.expectGridStatus("live");
    await page.keyboard.press("Control+p");
    await app.expectCalls("stopPoll", 1);
    await app.emitState("paused");
    await app.expectPill("Paused", "pause");
    await app.expectGridStatus("stale");
    await expect(app.chip).toHaveText(`Paused - values from ${hms(AT)}`);
    await expect(app.chip.locator('[data-icon="clock"]')).toHaveCount(1);
    await expect(app.value(0)).toHaveText("1234");
    expect(await app.callCount("startPoll")).toBe(0);
  });

  test("CHK-E2 Ctrl+P resumes: Polling pill and normal text again", async ({ app, page }) => {
    await app.toLive();
    await page.keyboard.press("Control+p");
    await app.expectCalls("stopPoll", 1);
    await app.emitState("paused");
    await app.expectPill("Paused", "pause");
    await app.expectGridStatus("stale");
    await page.keyboard.press("Control+p");
    await app.expectCalls("startPoll", 1);
    await app.emitState("polling");
    await app.expectPill("Polling", "activity");
    await app.pollUpdate(REGISTER_MAP_10);
    await expect(app.chip).toContainText("Updated");
    await app.expectGridStatus("live");
  });

  test("CHK-E3 Apply while paused sends nothing; text; Resume polls from the new address", async ({
    app,
  }) => {
    await app.toLive();
    await app.toolbarButton("Pause").click();
    await app.expectCalls("stopPoll", 1);
    await app.emitState("paused");
    await app.start.fill("5");
    await app.applyButton.click();
    await expect(app.dataEmpty).toHaveText(
      "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.",
    );
    expect(await app.callCount("startPoll")).toBe(0);
    await app.toolbarButton("Resume").click();
    await app.expectCalls("startPoll", 1);
    const [[def]] = (await app.calls("startPoll")) as [[Record<string, unknown>]];
    expect(def).toMatchObject({ startAddress: 5 });
    await app.emitState("polling");
    await app.pollUpdate([7, 8, 9, 10, 11, 12, 13, 14, 15, 16], { startAddress: 5 });
    await expect(app.address(0)).toHaveText("5");
    await expect(app.value(0)).toHaveText("7");
  });

  test("CHK-E4 write FC06 address 3 value 7 while paused succeeds, row 3 reads 7 after Resume (UI side)", async ({
    app,
  }) => {
    await app.toLive();
    await app.toolbarButton("Pause").click();
    await app.emitState("paused");
    await app.expectPill("Paused", "pause");
    await app.toolbarButton("Write…").click();
    const dlg = app.writeDialog;
    await expect(dlg.getByLabel("Function")).toHaveValue("6");
    await dlg.getByLabel("Start address").fill("3");
    await dlg.getByLabel("Value", { exact: true }).fill("7");
    await dlg.getByRole("button", { name: "Send" }).click();
    // The exact wording is asserted by CHK-M1; here only that the write succeeded.
    await expect(app.writeResult).toHaveText(/^Write confirmed by slave 1: /);
    const [[req]] = (await app.calls("write")) as [[Record<string, unknown>]];
    expect(req).toEqual({ slaveId: 1, function: 6, address: 3, values: [7] });
    await dlg.getByRole("button", { name: "Close", exact: true }).click();
    await app.toolbarButton("Resume").click();
    await app.emitState("polling");
    await app.pollUpdate([1234, 65535, 32768, 7, 32767, 0, 0, 0, 0, 0]);
    await expect(app.value(3)).toHaveText("7");
  });
});
