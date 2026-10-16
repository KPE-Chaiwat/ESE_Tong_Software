// CHK-001 M. Write dialog results (UI side: the fake answers the write command)
import type { Locator } from "@playwright/test";
import { expect, type ModbusApp, REGISTER_MAP_10, test } from "../support/fixtures";

interface WriteSetup {
  fn?: string;
  slave?: string;
  address?: string;
  value?: string;
  values?: string;
}

/** Opens the write dialog (the link must be up) and fills it. */
async function openAndFill(app: ModbusApp, w: WriteSetup): Promise<Locator> {
  await app.toolbarButton("Write…").click();
  const d = app.writeDialog;
  await expect(d).toBeVisible();
  if (w.fn) await d.getByLabel("Function").selectOption(w.fn);
  if (w.slave !== undefined) await d.getByLabel("Slave ID").fill(w.slave);
  if (w.address !== undefined) await d.getByLabel("Start address").fill(w.address);
  if (w.value !== undefined) await d.getByLabel("Value", { exact: true }).fill(w.value);
  if (w.values !== undefined) await d.getByLabel(/^Values \(/).fill(w.values);
  return d;
}

const sendButton = (d: Locator) => d.getByRole("button", { name: "Send" });

async function lastWrite(app: ModbusApp): Promise<Record<string, unknown>> {
  const calls = (await app.calls("write")) as [Record<string, unknown>][];
  const last = calls.at(-1);
  if (!last) throw new Error("no write command was sent");
  return last[0];
}

test.describe("M. write dialog results", () => {
  test("CHK-M1 FC06 address 3 value 500: confirmation text and request", async ({ app }) => {
    await app.toLive();
    const d = await openAndFill(app, { fn: "6", address: "3", value: "500" });
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText("Write confirmed by slave 1: register at 3.");
    expect(await lastWrite(app)).toEqual({ slaveId: 1, function: 6, address: 3, values: [500] });
    await app.pollUpdate([1234, 65535, 32768, 500, 32767, 0, 0, 0, 0, 0]);
    await expect(app.value(3)).toHaveText("500");
  });

  test("CHK-M2 FC16 address 10 values 10 20 30: helper text, confirmation and request", async ({ app }) => {
    await app.toLive();
    const d = await openAndFill(app, { fn: "16", address: "10", values: "10 20 30" });
    await expect(d.getByText("Writes addresses 10-12.", { exact: true })).toBeVisible();
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText("Write confirmed by slave 1: 3 registers at 10-12.");
    expect(await lastWrite(app)).toEqual({
      slaveId: 1,
      function: 16,
      address: 10,
      values: [10, 20, 30],
    });
  });

  test("CHK-M3 FC05 address 1 ON", async ({ app }) => {
    await app.toLive();
    const d = await openAndFill(app, { fn: "5", address: "1" });
    await expect(d.getByRole("radio", { name: "ON", exact: true })).toBeChecked();
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText("Write confirmed by slave 1: coil at 1.");
    expect(await lastWrite(app)).toEqual({ slaveId: 1, function: 5, address: 1, values: [1] });
  });

  test("CHK-M4 FC15 address 0 values 0 1 0 1", async ({ app }) => {
    await app.toLive();
    const d = await openAndFill(app, { fn: "15", address: "0", values: "0 1 0 1" });
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText("Write confirmed by slave 1: 4 coils at 0-3.");
    expect(await lastWrite(app)).toEqual({
      slaveId: 1,
      function: 15,
      address: 0,
      values: [0, 1, 0, 1],
    });
  });

  test("CHK-M5 FC06 address 200: exception 02 (UI side)", async ({ app }) => {
    await app.toLive();
    await app.script((f) => f.setResult("write", { status: "exception", code: 2 }));
    const d = await openAndFill(app, { fn: "6", address: "200", value: "1" });
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText("Exception 02 (Illegal data address). Nothing was confirmed.");
    await expect(app.writeResult.locator('[data-icon="octagon-x"]')).toHaveCount(1);
  });

  test("CHK-M6 dropped write reply: timeout text (UI side)", async ({ app }) => {
    await app.toLive();
    await app.script((f) => f.setResult("write", { status: "timeout" }));
    const d = await openAndFill(app, { fn: "6", address: "3", value: "1" });
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText(
      "No response within 1000 ms. The write may or may not have been applied.",
    );
    await expect(app.writeResult.locator('[data-icon="timer-off"]')).toHaveCount(1);
  });

  test("CHK-M7 corrupted write reply, TCP: unit ID 2 (UI side)", async ({ app }) => {
    await app.toLive();
    await app.script((f) =>
      f.setResult("write", {
        status: "badResponse",
        kind: "wrongSlave",
        detail: { expected: 1, got: 2, message: "" },
      }),
    );
    const d = await openAndFill(app, { fn: "6", address: "3", value: "1" });
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText(
      "Bad response: reply from slave 2, expected 1. The write may or may not have been applied.",
    );
    await expect(app.writeResult.locator('[data-icon="triangle-alert"]')).toHaveCount(1);
  });

  test("CHK-M7 corrupted write reply, RTU: CRC (UI side)", async ({ app }) => {
    await app.toState("polling", { rtu: "COM3" });
    await app.script((f) =>
      f.setResult("write", {
        status: "badResponse",
        kind: "crc",
        detail: { expected: null, got: null, message: "" },
      }),
    );
    const d = await openAndFill(app, { fn: "6", address: "3", value: "1" });
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText(
      "Bad response: CRC mismatch. The write may or may not have been applied.",
    );
  });

  test("CHK-M8 RTU slave 0: broadcast warning, Send enabled, Broadcast sent text (UI side)", async ({
    app,
  }) => {
    await app.toState("polling", { rtu: "COM3" }); // the fake answers broadcastSent for RTU slave 0
    const d = await openAndFill(app, { fn: "6", slave: "0", address: "3", value: "500" });
    const warning = d.getByText("Broadcast: devices do not reply, so the result cannot be confirmed.", {
      exact: true,
    });
    await expect(warning).toBeVisible();
    await expect(warning.locator("xpath=..").locator('[data-icon="triangle-alert"]')).toHaveCount(1);
    await expect(sendButton(d)).toBeEnabled();
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText(
      "Broadcast sent. Devices do not reply to slave ID 0, so the write cannot be confirmed.",
    );
    expect(await lastWrite(app)).toEqual({ slaveId: 0, function: 6, address: 3, values: [500] });
    await app.expectPill("Polling", "activity");
  });

  test("CHK-M9 Enter on selected row 1 (FC03, Hex) opens FC06 prefilled", async ({ app, page }) => {
    await app.toLive();
    await page.keyboard.press("Control+3");
    await app.row(1).click();
    await page.keyboard.press("Enter");
    const d = app.writeDialog;
    await expect(d).toBeVisible();
    await expect(d.getByLabel("Function")).toHaveValue("6");
    await expect(d.getByLabel("Start address")).toHaveValue("1");
    await expect(d.getByLabel("Slave ID")).toHaveValue("1");
    await expect(d.getByRole("radio", { name: "Hex", exact: true })).toBeChecked();
    await expect(d.getByLabel("Value", { exact: true })).toHaveValue("0xFFFF");
  });

  test("CHK-M10 double-click a row of an FC04 poll: read-only toast, no dialog", async ({ app }) => {
    await app.toState("connected");
    await app.fn.selectOption("4");
    await app.pressAndAnswer("Start polling", "polling");
    await app.pollUpdate(REGISTER_MAP_10, { function: 4 });
    await expect(app.value(0)).toHaveText("1234");
    await app.row(0).dblclick();
    await expect(app.toast("Discrete inputs and input registers are read-only.")).toBeVisible();
    await expect(app.page.getByRole("dialog")).toHaveCount(0);
  });

  test("CHK-M11 dialog opened with Enter on row 3: second Send repeats, Esc returns focus to the data grid", async ({
    app,
    page,
  }) => {
    await app.toLive();
    await app.row(3).click();
    await page.keyboard.press("Enter");
    const d = app.writeDialog;
    await expect(d).toBeVisible();
    await sendButton(d).click();
    await expect(app.writeResult).toContainText("Write confirmed by slave 1:");
    await expect(d).toBeVisible(); // stays open after a send
    await sendButton(d).click();
    await app.expectCalls("write", 2);
    const calls = (await app.calls("write")) as [Record<string, unknown>][];
    expect(calls[1]).toEqual(calls[0]);
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    // Revision 3: document.activeElement is the grid itself, and its active descendant is row 3.
    await expect(app.table).toBeFocused();
    await expect(app.table).toHaveAttribute("aria-activedescendant", "data-row-3");
  });

  test("CHK-M11 dialog opened from the toolbar Write… button: Esc returns focus to that button", async ({
    app,
    page,
  }) => {
    await app.toLive();
    await app.toolbarButton("Write…").click();
    await expect(app.writeDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(app.writeDialog).toHaveCount(0);
    await expect(app.toolbarButton("Write…")).toBeFocused();
  });

  test("CHK-M13 20 consecutive FC06 writes while a 100 ms stream runs (UI side, simulating fake)", async ({
    simApp: app,
  }) => {
    await app.host.fill("127.0.0.1");
    await app.scan.fill("100");
    await app.toolbarButton("Connect").click();
    await app.expectPill("Polling", "activity");
    await app.toolbarButton("Write…").click();
    const d = app.writeDialog;
    await d.getByLabel("Start address").fill("3");
    for (let i = 1; i <= 20; i += 1) {
      await d.getByLabel("Value", { exact: true }).fill(String(i));
      await sendButton(d).click();
      await app.expectCalls("write", i);
      await expect(app.writeResult).toContainText("Write confirmed by slave 1:");
      await expect(sendButton(d)).toBeEnabled();
    }
    await expect(app.pill).toHaveText("Polling");
    const calls = (await app.calls("write")) as [{ values: number[] }][];
    expect(calls.map((c) => c[0].values[0])).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test("CHK-M14 pasting a spreadsheet column gives Values (3)", async ({ app }) => {
    await app.toLive();
    const d = await openAndFill(app, { fn: "16" });
    const values = d.getByLabel(/^Values \(/);
    await values.fill("1\n2\n3");
    await expect(d.getByText("Values (3)", { exact: true })).toBeVisible();
    await values.fill("1\t2\t3\t4");
    await expect(d.getByText("Values (4)", { exact: true })).toBeVisible();
    await values.fill("1, 2,, 3");
    await expect(d.getByText("Values (3)", { exact: true })).toBeVisible();
  });

  test("CHK-M15 TCP unit ID 0 is not a broadcast: no warning, normal confirmation, 5 repeats (UI side)", async ({
    app,
  }) => {
    await app.toLive();
    const d = await openAndFill(app, { fn: "6", slave: "0", address: "3", value: "500" });
    await expect(d.getByText(/^Broadcast:/)).toHaveCount(0);
    for (let i = 1; i <= 5; i += 1) {
      await sendButton(d).click();
      await app.expectCalls("write", i);
      await expect(app.writeResult).toHaveText("Write confirmed by slave 0: register at 3.");
    }
    expect(await lastWrite(app)).toEqual({ slaveId: 0, function: 6, address: 3, values: [500] });
    await app.expectPill("Polling", "activity");
    await app.expectNoBanner();
  });

  test("CHK-M16 TCP unit 0 answered with exception 02: never Broadcast sent (UI side)", async ({ app }) => {
    await app.toLive();
    await app.script((f) => f.setResult("write", { status: "exception", code: 2 }));
    const d = await openAndFill(app, { fn: "6", slave: "0", address: "3", value: "1" });
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText("Exception 02 (Illegal data address). Nothing was confirmed.");
    await expect(app.writeResult).not.toContainText("Broadcast sent");
  });

  /** Polling, the Write dialog open with FC06 address 3 value 9, the write answered `linkLost`. */
  async function linkLostDuringWrite(app: ModbusApp): Promise<Locator> {
    await app.toLive();
    await app.script((f) => {
      window.__qa = { held: f.hold("write") };
    });
    const d = await openAndFill(app, { fn: "6", address: "3", value: "9" });
    await sendButton(d).click();
    await expect(app.writeResult).toHaveText("Writing…");
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    await app.script(() => {
      (window.__qa as { held: { release(v: unknown): void } }).held.release({ status: "linkLost" });
    });
    return d;
  }
  const reconnectButton = (app: ModbusApp) =>
    app.writeResult.getByRole("button", { name: "Reconnect", exact: true });

  test("CHK-M17 link lost during a write: text, icon, [Reconnect], pill, Send disabled, draft kept, Ctrl+L inert (UI side)", async ({
    app,
    page,
  }) => {
    const d = await linkLostDuringWrite(app);
    await expect(app.writeResult.locator("p")).toHaveText(
      "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.",
    );
    await expect(app.writeResult.locator('p [data-icon="unplug"]')).toHaveCount(1);
    await expect(reconnectButton(app)).toBeVisible();
    await expect(reconnectButton(app)).not.toHaveAttribute("aria-disabled", "true");
    await app.expectPill("Disconnected", "unplug");
    await app.expectSessionState("disconnected");
    await expect(sendButton(d)).toBeDisabled();
    await expect(d.getByLabel("Start address")).toHaveValue("3");
    await expect(d.getByLabel("Value", { exact: true })).toHaveValue("9");
    const connects = await app.callCount("connect");
    await page.keyboard.press("Control+l");
    expect(await app.callCount("connect")).toBe(connects); // Ctrl+L stays off in modals
    await expect(d).toBeVisible();
  });

  test("CHK-M17 path 1: [Reconnect] in the dialog shows a spinner, then the result clears and Send is focused", async ({
    app,
    page,
  }) => {
    const d = await linkLostDuringWrite(app);
    const before = await app.callCount("connect");
    await reconnectButton(app).click();
    await app.expectCalls("connect", before + 1);
    const [config] = ((await app.calls("connect")) as unknown[][]).at(-1) ?? [];
    expect(config).toMatchObject({ mode: "tcp", host: "127.0.0.1", port: 5020 });
    await app.emitState("connecting");
    await expect(reconnectButton(app)).toHaveAttribute("aria-disabled", "true");
    await expect(reconnectButton(app).locator('[data-icon="loader"]')).toHaveCount(1);
    await expect(app.writeResult.locator("p")).toContainText("Connection lost during the write.");
    await expect(d).toBeVisible();
    await expect(d.getByLabel("Value", { exact: true })).toHaveValue("9");
    await app.emitState("connected");
    await app.emitState("polling");
    await app.pollUpdate([1234, 65535, 32768, 4, 32767, 0, 0, 0, 0, 0]);
    await expect(app.writeResult).toHaveText(""); // no text and no Reconnect button
    await expect(reconnectButton(app)).toHaveCount(0);
    await expect(sendButton(d)).toBeEnabled();
    await expect(sendButton(d)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    await expect(app.value(3)).toHaveText("4"); // the device's actual value
  });

  test("CHK-M17 path 1b: failed reconnect shows 'Reconnect failed: ...' and [Reconnect] is enabled again (UI side)", async ({
    app,
  }) => {
    const d = await linkLostDuringWrite(app);
    await reconnectButton(app).click();
    await app.emitState("connecting");
    await expect(reconnectButton(app)).toHaveAttribute("aria-disabled", "true");
    await app.emitState("disconnected", {
      reason: { kind: "refused", phase: "connectFailed", message: "refused" },
    });
    await expect(app.writeResult.locator("p")).toHaveText(
      "Reconnect failed: Connection refused by 127.0.0.1:5020.",
    );
    await expect(reconnectButton(app)).not.toHaveAttribute("aria-disabled", "true");
    await expect(reconnectButton(app)).toBeFocused();
    await expect(sendButton(d)).toBeDisabled();
    // and it can be pressed again
    const before = await app.callCount("connect");
    await reconnectButton(app).click();
    await app.expectCalls("connect", before + 1);
  });

  test("CHK-M17 path 2: Esc closes the dialog, Ctrl+L reconnects, polling resumes (UI side)", async ({
    app,
    page,
  }) => {
    await linkLostDuringWrite(app);
    await page.keyboard.press("Escape");
    await expect(app.writeDialog).toHaveCount(0);
    await page.keyboard.press("Control+l");
    await app.expectCalls("connect", 2);
    await app.emitState("connecting");
    await app.emitState("connected");
    await app.emitState("polling");
    await app.pollUpdate(REGISTER_MAP_10);
    await app.expectPill("Polling", "activity");
    await app.expectNoBanner();
  });

  test("CHK-M18 queued write when the link drops: Not connected text (UI side)", async ({ app }) => {
    await app.toLive();
    await app.script((f) => {
      window.__qa = { held: f.hold("write") };
    });
    const d = await openAndFill(app, { fn: "6", address: "3", value: "9" });
    await sendButton(d).click();
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    await app.script(() => {
      (window.__qa as { held: { release(v: unknown): void } }).held.release({ status: "notConnected" });
    });
    await expect(app.writeResult).toHaveText("Not connected. Connect before writing.");
    await expect(reconnectButton(app)).toHaveCount(0); // DES 2.5: only for link lost
    await expect(sendButton(d)).toBeDisabled();
    await app.expectPill("Disconnected", "unplug");
    await expect(app.page.getByTestId("traffic-empty")).toBeVisible(); // no TX frame for the write
  });
});
