// CHK-001 K. empty data, L. loading
import { expect, hms, rxFrame, tcpProfile, test, txFrame } from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 540).getTime();

test.describe("K. empty data", () => {
  test("CHK-K1 every data card empty text appears verbatim in its state", async ({ app }) => {
    await expect(app.dataEmpty).toHaveText(
      "Not connected. Configure a connection and press Connect (Ctrl+L).",
    ); // A1
    await app.pressConnect();
    await app.emitState("connecting");
    await expect(app.dataEmpty).toHaveText("Connecting to 127.0.0.1:5020…"); // B1
    await app.emitState("connected");
    await expect(app.dataEmpty).toHaveText(
      "Connected. Press Start polling (Ctrl+P) to read 10 holding registers from slave 1.",
    ); // C1
    await app.quantity.fill("126");
    await expect(app.dataEmpty).toHaveText("Fix the poll settings to start polling."); // C3
    await app.quantity.fill("10");
    await app.pressAndAnswer("Start polling", "polling");
    await app.emitState("exception", { exceptionCode: 2, consecutiveFailures: 1 });
    await expect(app.dataEmpty).toHaveText(
      "No data: the device answered with exception 02 (Illegal data address).",
    ); // G3
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    await expect(app.dataEmpty).toHaveText("Connection lost. Press Reconnect to continue."); // I4, no data
  });

  test("CHK-K1 E3 text after Apply with changed settings while paused", async ({ app }) => {
    await app.toLive();
    await app.emitState("paused");
    await app.start.fill("5");
    await app.applyButton.click();
    await expect(app.dataEmpty).toHaveText(
      "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.",
    );
  });

  test("CHK-K2 Ctrl+Shift+K clears the log and keeps the counters", async ({ app, page }) => {
    await app.toState("polling");
    await app.frames([
      txFrame(1, AT, [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10]),
      rxFrame(2, AT + 8, [0, 1, 0, 0, 0, 5, 1, 3, 2, 4, 210]),
    ]);
    await app.counters({ requests: 1, responses: 1, errors: 0, timeouts: 0 });
    await expect(app.frameRow(2)).toBeVisible();
    await page.keyboard.press("Control+Shift+k");
    await expect(app.page.getByTestId("traffic-empty")).toHaveText(
      /^Log cleared at \d{2}:\d{2}:\d{2}\.\d{3}\. New frames appear here\.$/,
    );
    await app.expectCounters({ requests: 1, responses: 1, errors: 0, timeouts: 0 });
    // New frames show up again.
    await app.frames([txFrame(3, AT + 1000, [0, 2, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10])]);
    await expect(app.frameRow(3)).toBeVisible();
    await expect(app.page.getByTestId("traffic-empty")).toHaveCount(0);
  });

  test("CHK-K3 no saved profiles: text and Open disabled", async ({ app, page }) => {
    await page.keyboard.press("Control+o");
    await expect(app.openDialog.getByText("No saved profiles yet. Use Save as (Ctrl+Shift+S) to create one.")).toBeVisible();
    await expect(app.openDialog.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
  });

  test("CHK-K4 filter without a match", async ({ app, page }) => {
    await app.seedProfiles([tcpProfile("Bench A"), tcpProfile("Pump")]);
    await page.keyboard.press("Control+o");
    await expect(app.openDialog.getByRole("row", { name: /Bench A/ })).toBeVisible();
    await app.openDialog.getByLabel("Filter profiles").fill("zzz");
    await expect(app.openDialog.getByText('No profiles match "zzz".', { exact: true })).toBeVisible();
  });

  test("CHK-K5 RTU without serial ports", async ({ app }) => {
    await app.script((f) => {
      f.ports = [];
    });
    await app.modeRtu.click();
    await expect(
      app.setup.getByText("No serial ports found. Connect a device and press Refresh.", { exact: true }),
    ).toBeVisible();
    await expect(app.field("Serial port").locator("option:checked")).toHaveText("No serial ports found");
  });
});

test.describe("L. loading", () => {
  test("CHK-L1 Start polling: dashes and Waiting for first response until the first response", async ({
    app,
  }) => {
    await app.toState("connected");
    await app.pressAndAnswer("Start polling", "polling");
    await expect(app.chip).toHaveText("Waiting for first response…");
    await expect(app.chip.locator('[data-icon="loader"]')).toHaveCount(1);
    await expect(app.value(0)).toHaveText("—");
    await expect(app.table.getByRole("row")).toHaveCount(11);
    await app.pollUpdate([1234, 65535, 32768, 0, 32767, 0, 0, 0, 0, 0], { at: AT });
    await expect(app.chip).toHaveText(`Updated ${hms(AT)}`);
    await expect(app.value(0)).toHaveText("1234");
  });

  test("CHK-L2 slow profile list: Loading profiles… and Open disabled", async ({ app, page }) => {
    await app.seedProfiles([tcpProfile("Bench A")]);
    await app.script((f) => {
      window.__qa = { held: f.hold("profilesList") };
    });
    await page.keyboard.press("Control+o");
    await expect(app.openDialog.getByText("Loading profiles…")).toBeVisible();
    await expect(app.openDialog.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
    await app.script((f) => {
      const held = (window.__qa as { held: { release(v: unknown): void } }).held;
      held.release([
        { name: "Bench A", modifiedAt: Date.now(), connectionSummary: "TCP 127.0.0.1:5020", readable: true },
      ]);
    });
    await expect(app.openDialog.getByRole("row", { name: /Bench A/ })).toBeVisible();
    await expect(app.openDialog.getByText("Loading profiles…")).toHaveCount(0);
  });

  test("CHK-L3 slow port list: Loading ports… and the select is disabled", async ({ app }) => {
    await app.script((f) => {
      window.__qa = { held: f.hold("listSerialPorts") };
    });
    await app.modeRtu.click();
    const select = app.field("Serial port");
    await expect(select).toBeDisabled();
    await expect(select.locator("option:checked")).toHaveText("Loading ports…");
    await app.script(() => {
      (window.__qa as { held: { release(v: unknown): void } }).held.release([
        { name: "COM3", description: "USB Serial Device" },
      ]);
    });
    await expect(select).toBeEnabled();
    await expect(select.locator("option", { hasText: "COM3 - USB Serial Device" })).toHaveCount(1);
  });

  test("CHK-L4 slow write: Writing… and Send disabled until the result arrives (UI side)", async ({
    app,
  }) => {
    await app.toState("polling");
    await app.script((f) => {
      window.__qa = { held: f.hold("write") };
    });
    await app.toolbarButton("Write…").click();
    const send = app.writeDialog.getByRole("button", { name: "Send" });
    await send.click();
    await expect(app.writeResult).toHaveText("Writing…");
    await expect(app.writeResult.locator('[data-icon="loader"]')).toHaveCount(1);
    await expect(send).toBeDisabled();
    await expect(app.writeDialog.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
    await app.script(() => {
      (window.__qa as { held: { release(v: unknown): void } }).held.release({ status: "ok" });
    });
    await expect(app.writeResult).toContainText("Write confirmed by slave 1:");
    await expect(send).toBeEnabled();
  });

  test("CHK-L5 failing profile list: error text and Retry reloads", async ({ app, page }) => {
    await app.script((f) => f.failNext("profilesList", "disk unavailable"));
    await page.keyboard.press("Control+o");
    await expect(
      app.openDialog.getByText("Could not load profiles: disk unavailable", { exact: true }),
    ).toBeVisible();
    await app.openDialog.getByRole("button", { name: "Retry" }).click();
    await expect(
      app.openDialog.getByText("No saved profiles yet. Use Save as (Ctrl+Shift+S) to create one."),
    ).toBeVisible();
    expect(await app.callCount("profilesList")).toBe(2);
  });

  test("CHK-L (DES 2.4) failing port list: error text and Refresh", async ({ app }) => {
    await app.script((f) => f.failNext("listSerialPorts", "driver missing"));
    await app.modeRtu.click();
    await expect(
      app.setup.getByText("Could not list serial ports: driver missing", { exact: true }),
    ).toBeVisible();
    await app.setup.getByRole("button", { name: "Refresh serial ports" }).click();
    await expect(app.field("Serial port")).toBeEnabled();
    await expect(app.field("Serial port").locator("option", { hasText: "COM3" })).toHaveCount(1);
  });
});
