// CHK-001 J. invalid input. In every item nothing may be sent (no connect / startPoll / write /
// profilesSave command reaches the fake).
import type { Locator } from "@playwright/test";
import { expect, type ModbusApp, tcpProfile, test } from "../support/fixtures";

/** Types `value`, leaves the field and checks the message (or its absence). */
async function check(
  app: ModbusApp,
  field: Locator,
  value: string,
  message: string | null,
): Promise<void> {
  await field.fill(value);
  await field.blur();
  if (message === null) {
    await expect(field, `"${value}" must be accepted`).not.toHaveAttribute("aria-invalid", "true");
  } else {
    await expect(field, `"${value}" must be rejected`).toHaveAttribute("aria-invalid", "true");
    await expect(app.setup.getByText(message, { exact: true })).toBeVisible();
  }
}

async function nothingSent(app: ModbusApp): Promise<void> {
  for (const m of ["connect", "startPoll", "write", "profilesSave"]) {
    expect(await app.callCount(m), `${m} must not be called`).toBe(0);
  }
  await expect(app.page.getByTestId("traffic-empty")).toBeVisible();
}

test.describe("J. invalid input: connection", () => {
  test("CHK-J1 empty host: message, focus, header counts 1 then 2 fields", async ({ app }) => {
    await app.toolbarButton("Connect").click();
    await expect(app.setup.getByText("Enter a host name or IPv4 address.", { exact: true })).toBeVisible();
    await expect(app.host).toBeFocused();
    await expect(app.attention).toHaveText("1 field needs attention");
    await app.port.fill("abc");
    await app.toolbarButton("Connect").click();
    await expect(app.attention).toHaveText("2 fields need attention");
    await expect(app.host).toBeFocused();
    await nothingSent(app);
  });

  test("CHK-J2 host 256.1.1.1", async ({ app }) => {
    await check(
      app,
      app.host,
      "256.1.1.1",
      "Enter a valid host name or IPv4 address, for example 192.168.1.10.",
    );
    await app.toolbarButton("Connect").click();
    await nothingSent(app);
  });

  test("CHK-J3 port boundaries 0 / 1 / 65535 / 65536 / 50.5 / abc", async ({ app }) => {
    await app.host.fill("127.0.0.1");
    const msg = "Port must be a whole number from 1 to 65535.";
    for (const [v, m] of [
      ["0", msg],
      ["1", null],
      ["65535", null],
      ["65536", msg],
      ["50.5", msg],
      ["abc", msg],
    ] as const) {
      await check(app, app.port, v, m);
    }
    await app.port.fill("0");
    await app.toolbarButton("Connect").click();
    await nothingSent(app);
  });

  test("CHK-J4 timeout boundaries 49 / 50 / 10000 / 10001", async ({ app }) => {
    await app.host.fill("127.0.0.1");
    const msg = "Timeout must be a whole number from 50 to 10000 ms.";
    for (const [v, m] of [
      ["49", msg],
      ["50", null],
      ["10000", null],
      ["10001", msg],
    ] as const) {
      await check(app, app.timeout, v, m);
    }
    await app.timeout.fill("49");
    await app.toolbarButton("Connect").click();
    await nothingSent(app);
  });

  test("CHK-J5 RTU without a serial port", async ({ app }) => {
    await app.modeRtu.click();
    await app.toolbarButton("Connect").click();
    await expect(app.setup.getByText("Select a serial port.", { exact: true })).toBeVisible();
    await expect(app.field("Serial port")).toHaveAttribute("aria-invalid", "true");
    await nothingSent(app);
  });

  test("CHK-J6 RTU data bits 7 shows a warning and Connect is still allowed", async ({ app }) => {
    await app.modeRtu.click();
    await app.field("Serial port").selectOption("COM3");
    await app.field("Data bits").selectOption("7");
    await expect(
      app.setup.getByText("Modbus RTU uses 8 data bits. 7 may not work with most devices.", { exact: true }),
    ).toBeVisible();
    await expect(app.field("Data bits")).not.toHaveAttribute("aria-invalid", "true");
    await app.toolbarButton("Connect").click();
    await app.expectCalls("connect", 1);
    const [[cfg]] = (await app.calls("connect")) as [[Record<string, unknown>]];
    expect(cfg).toMatchObject({ mode: "rtu", port: "COM3", dataBits: 7 });
  });

  test("CHK-J7 RTU parity None with stop bits 1 shows the warning", async ({ app }) => {
    await app.modeRtu.click();
    await app.field("Parity").selectOption("none");
    await expect(
      app.setup.getByText("The Modbus specification uses 2 stop bits when parity is None.", { exact: true }),
    ).toBeVisible();
    await app.field("Stop bits").selectOption("2");
    await expect(
      app.setup.getByText("The Modbus specification uses 2 stop bits when parity is None."),
    ).toHaveCount(0);
  });

  test("CHK-J16 the message disappears while typing the correction (before blur)", async ({ app }) => {
    await check(app, app.port, "0", "Port must be a whole number from 1 to 65535.");
    await app.port.focus();
    await app.port.fill("5020");
    await expect(app.setup.getByText("Port must be a whole number from 1 to 65535.")).toHaveCount(0);
    await expect(app.port).not.toHaveAttribute("aria-invalid", "true");
    await expect(app.port).toBeFocused();
  });
});

test.describe("J. invalid input: poll", () => {
  test("CHK-J8 slave ID 248 rejected, 247 accepted, 0 accepted on TCP", async ({ app }) => {
    const msg = "Slave ID must be a whole number from 0 to 247.";
    for (const [v, m] of [
      ["248", msg],
      ["247", null],
      ["0", null],
    ] as const) {
      await check(app, app.slaveId, v, m);
    }
  });

  test("CHK-J9 RTU slave ID 0 cannot be used for reads", async ({ app }) => {
    await app.modeRtu.click();
    await check(
      app,
      app.slaveId,
      "0",
      "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247.",
    );
    await check(app, app.slaveId, "1", null);
  });

  test("CHK-J10 start address 0 and 65535 accepted, 65536 rejected (UI side)", async ({ app }) => {
    const msg = "Start address must be a whole number from 0 to 65535.";
    await check(app, app.start, "0", null);
    await check(app, app.start, "65535", null);
    await check(app, app.quantity, "1", null);
    await check(app, app.start, "65536", msg);
    // Accepted values reach the backend command unchanged (the TX bytes FF FF need the wire).
    await app.toState("polling");
    await app.start.fill("65535");
    await app.quantity.fill("1");
    await app.applyButton.click();
    await app.expectCalls("startPoll", 1);
    const [[def]] = (await app.calls("startPoll")) as [[Record<string, unknown>]];
    expect(def).toMatchObject({ startAddress: 65535, quantity: 1 });
  });

  test("CHK-J11 1-based: start 0 rejected, 65536 accepted with helper Protocol address 65535", async ({
    app,
    page,
  }) => {
    await page.keyboard.press("Control+b");
    await expect(app.start).toHaveValue("1");
    await check(app, app.start, "0", "Start address must be a whole number from 1 to 65536.");
    await check(app, app.quantity, "1", null);
    await check(app, app.start, "65536", null);
    await expect(app.setup.getByText("Protocol address 65535")).toBeVisible();
  });

  test("CHK-J12 FC03 and FC04 quantity 0 / 1 / 125 / 126", async ({ app }) => {
    for (const fc of ["3", "4"]) {
      await app.fn.selectOption(fc);
      const msg = `Quantity for FC0${fc} must be from 1 to 125.`;
      for (const [v, m] of [
        ["0", msg],
        ["1", null],
        ["125", null],
        ["126", msg],
      ] as const) {
        await check(app, app.quantity, v, m);
      }
    }
  });

  test("CHK-J13 FC01 and FC02 quantity 2001 rejected, 2000 accepted", async ({ app }) => {
    for (const fc of ["1", "2"]) {
      await app.fn.selectOption(fc);
      const msg = `Quantity for FC0${fc} must be from 1 to 2000.`;
      await check(app, app.quantity, "2001", msg);
      await check(app, app.quantity, "2000", null);
    }
  });

  test("CHK-J14 range beyond the last address", async ({ app }) => {
    await app.start.fill("65530");
    await check(
      app,
      app.quantity,
      "10",
      "This range ends after the last address (65535). The maximum quantity from 65530 is 6.",
    );
    await check(app, app.quantity, "6", null);
  });

  test("CHK-J15 scan rate 19 / 20 / 60000 / 60001", async ({ app }) => {
    const msg = "Scan rate must be a whole number from 20 to 60000 ms.";
    for (const [v, m] of [
      ["19", msg],
      ["20", null],
      ["60000", null],
      ["60001", msg],
    ] as const) {
      await check(app, app.scan, v, m);
    }
  });
});

test.describe("J. invalid input: write dialog", () => {
  async function openWrite(app: ModbusApp) {
    await app.toState("polling");
    await app.toolbarButton("Write…").click();
    await expect(app.writeDialog).toBeVisible();
    return app.writeDialog;
  }
  const send = (d: Locator) => d.getByRole("button", { name: "Send" }).click();

  test("CHK-J17 FC06 value ranges in all four formats", async ({ app }) => {
    const d = await openWrite(app);
    const value = d.getByLabel("Value", { exact: true });
    await value.fill("65536");
    await send(d);
    await expect(d.getByText("Value must be from 0 to 65535.", { exact: true })).toBeVisible();
    await d.getByRole("radio", { name: "Signed", exact: true }).click();
    await value.fill("-32769");
    await expect(d.getByText("Value must be from -32768 to 32767.", { exact: true })).toBeVisible();
    await d.getByRole("radio", { name: "Hex", exact: true }).click();
    await value.fill("0x10000");
    await expect(d.getByText("Enter a hex value from 0x0000 to 0xFFFF.", { exact: true })).toBeVisible();
    await d.getByRole("radio", { name: "Binary", exact: true }).click();
    await value.fill("10101010101010101");
    await expect(
      d.getByText("Enter up to 16 binary digits (0 or 1).", { exact: true }),
    ).toBeVisible();
    await expect(value).toHaveAttribute("aria-invalid", "true");
    expect(await app.callCount("write")).toBe(0);
  });

  test("CHK-J18 FC16 124 values rejected, 123 accepted", async ({ app }) => {
    const d = await openWrite(app);
    await d.getByLabel("Function").selectOption("16");
    const values = d.getByLabel(/^Values \(/);
    await values.fill(Array.from({ length: 124 }, () => "1").join(" "));
    await send(d);
    await expect(
      d.getByText("Enter from 1 to 123 values (you entered 124).", { exact: true }),
    ).toBeVisible();
    expect(await app.callCount("write")).toBe(0);
    await values.fill(Array.from({ length: 123 }, () => "1").join(" "));
    await send(d);
    await app.expectCalls("write", 1);
    const [[req]] = (await app.calls("write")) as [[{ values: number[] }]];
    expect(req.values).toHaveLength(123);
  });

  test("CHK-J19 FC16 values 1 2 70000: item message", async ({ app }) => {
    const d = await openWrite(app);
    await d.getByLabel("Function").selectOption("16");
    await d.getByLabel(/^Values \(/).fill("1 2 70000");
    await send(d);
    await expect(
      d.getByText('Value 3 ("70000") is not valid: Value must be from 0 to 65535.', { exact: true }),
    ).toBeVisible();
    expect(await app.callCount("write")).toBe(0);
  });

  test("CHK-J20 FC15 1969 values and 1 0 2", async ({ app }) => {
    const d = await openWrite(app);
    await d.getByLabel("Function").selectOption("15");
    const values = d.getByLabel(/^Values \(/);
    await values.fill(Array.from({ length: 1969 }, () => "0").join(" "));
    await send(d);
    await expect(
      d.getByText("Enter from 1 to 1968 values (you entered 1969).", { exact: true }),
    ).toBeVisible();
    await values.fill("1 0 2");
    await expect(
      d.getByText('Value 3 ("2") is not valid: enter 0 or 1.', { exact: true }),
    ).toBeVisible();
    expect(await app.callCount("write")).toBe(0);
  });

  test("CHK-J21 FC16 at address 65534 with 3 values", async ({ app }) => {
    const d = await openWrite(app);
    await d.getByLabel("Function").selectOption("16");
    await d.getByLabel("Start address").fill("65534");
    await d.getByLabel(/^Values \(/).fill("1 2 3");
    await send(d);
    await expect(
      d.getByText(
        "These values end after the last address (65535). At most 2 values fit from 65534.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await app.callCount("write")).toBe(0);
  });

  test("CHK-J22 FC16 with an empty values box", async ({ app }) => {
    const d = await openWrite(app);
    await d.getByLabel("Function").selectOption("16");
    await d.getByLabel(/^Values \(/).fill("");
    await send(d);
    await expect(
      d.getByText("Enter from 1 to 123 values (you entered 0).", { exact: true }),
    ).toBeVisible();
    expect(await app.callCount("write")).toBe(0);
  });
});

test.describe("J. invalid input: profiles", () => {
  const RESERVED = (n: string) => `"${n}" is reserved by Windows and cannot be used as a profile name.`;
  const NAME_CASES: [string, string][] = [
    ["", "Enter a profile name."],
    ["x".repeat(65), "Profile name must be at most 64 characters."],
    ["a/b", 'Profile name cannot contain \\ / : * ? " < > |'],
    [".hidden", "Profile name cannot start with a dot."],
    ["bench.", "Profile name cannot end with a dot."],
    [" bench", "Profile name cannot start or end with a space."],
    ["bench ", "Profile name cannot start or end with a space."],
    ["a\tb", "Profile name cannot contain control characters."],
    ["CON", RESERVED("CON")],
    ["nul", RESERVED("nul")],
    ["com1", RESERVED("com1")],
    ["LPT9", RESERVED("LPT9")],
    ["con.backup", RESERVED("con.backup")],
  ];

  test("CHK-J23 Save as: empty, 65 characters and a/b", async ({ app, page }) => {
    await app.host.fill("127.0.0.1");
    await page.keyboard.press("Control+Shift+s");
    const d = app.saveAsDialog;
    await expect(d).toBeVisible();
    for (const [name, msg] of NAME_CASES.slice(0, 3)) {
      await d.getByLabel("Name").fill(name);
      await d.getByRole("button", { name: "Save" }).click();
      await expect(d.getByText(msg, { exact: true })).toBeVisible();
    }
    expect(await app.callCount("profilesSave")).toBe(0);
  });

  test("CHK-J26 Save as: every extra name rule", async ({ app, page }) => {
    await app.host.fill("127.0.0.1");
    await page.keyboard.press("Control+Shift+s");
    const d = app.saveAsDialog;
    for (const [name, msg] of NAME_CASES) {
      await test.step(`name ${JSON.stringify(name)}`, async () => {
        await d.getByLabel("Name").fill(name);
        await d.getByRole("button", { name: "Save" }).click();
        await expect(d.getByText(msg, { exact: true })).toBeVisible();
        await expect(d.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
      });
    }
    expect(await app.callCount("profilesSave")).toBe(0);
  });

  for (const ok of ["COM10", "CONSOLE"]) {
    test(`CHK-J26 Save as accepts ${ok}`, async ({ app, page }) => {
      await app.host.fill("127.0.0.1");
      await page.keyboard.press("Control+Shift+s");
      await app.saveAsDialog.getByLabel("Name").fill(ok);
      await app.saveAsDialog.getByRole("button", { name: "Save" }).click();
      await expect(app.saveAsDialog).toHaveCount(0);
      await app.expectCalls("profilesSave", 1);
      await expect(app.profile).toContainText(ok);
    });
  }

  test("CHK-J26 Rename: every extra name rule, and the accepted ones", async ({ app, page }) => {
    await app.seedProfiles([tcpProfile("Bench A")]);
    await page.keyboard.press("Control+o");
    const d = app.openDialog;
    await d.getByRole("row", { name: /Bench A/ }).click();
    await d.getByRole("button", { name: "Rename" }).click();
    const input = d.getByLabel("New profile name");
    for (const [name, msg] of NAME_CASES) {
      await test.step(`rename to ${JSON.stringify(name)}`, async () => {
        await input.fill(name);
        await input.press("Enter");
        await expect(d.getByText(msg, { exact: true })).toBeVisible();
      });
    }
    expect(await app.callCount("profilesRename")).toBe(0);
    for (const ok of ["COM10", "CONSOLE"]) {
      await input.fill(ok);
      await input.press("Enter");
      await expect(d.getByRole("row", { name: new RegExp(ok) })).toBeVisible();
      await d.getByRole("row", { name: new RegExp(ok) }).click();
      await d.getByRole("button", { name: "Rename" }).click();
    }
    await expect(app.openDialog.getByLabel("New profile name")).toBeVisible();
  });

  test("CHK-J24 rename to a name that differs only in case", async ({ app, page }) => {
    await app.seedProfiles([tcpProfile("Bench A"), tcpProfile("Bench B")]);
    await page.keyboard.press("Control+o");
    const d = app.openDialog;
    await d.getByRole("row", { name: /Bench B/ }).click();
    await d.getByRole("button", { name: "Rename" }).click();
    await d.getByLabel("New profile name").fill("bench a");
    await d.getByLabel("New profile name").press("Enter");
    await expect(d.getByText('A profile named "bench a" already exists.', { exact: true })).toBeVisible();
    expect(await app.callCount("profilesRename")).toBe(0);
  });

  test("CHK-J25 hand-edited profile: unsupported RTU values show as invalid, Connect sends nothing", async ({
    app,
    page,
  }) => {
    await app.seedProfiles([
      tcpProfile("Edited", {
        connection: {
          mode: "rtu",
          port: "COM3",
          baud: 250000,
          dataBits: 6,
          parity: "even",
          stopBits: 3,
          timeoutMs: 1000,
        },
      }),
    ]);
    await page.keyboard.press("Control+o");
    await app.openDialog.getByRole("row", { name: /Edited/ }).dblclick();
    await expect(app.openDialog).toHaveCount(0);
    await app.expectPill("Not connected", "plug");
    await expect(app.field("Baud").locator("option:checked")).toHaveText("250000 (not supported)");
    await expect(app.setup.getByText("Choose a baud rate from the list.", { exact: true })).toBeVisible();
    await expect(app.setup.getByText("Data bits must be 7 or 8.", { exact: true })).toBeVisible();
    await expect(app.setup.getByText("Stop bits must be 1 or 2.", { exact: true })).toBeVisible();
    await app.toolbarButton("Connect").click();
    expect(await app.callCount("connect")).toBe(0);
    await app.expectPill("Not connected", "plug");
  });

  const SAVE_PATHS: [string, (app: ModbusApp) => Promise<void>][] = [
    ["Ctrl+S", (app) => app.page.keyboard.press("Control+s")],
    ["toolbar Save", (app) => app.toolbarButton("Save").click()],
    ["Ctrl+Shift+S", (app) => app.page.keyboard.press("Control+Shift+s")],
    ["toolbar Save as…", (app) => app.toolbarButton("Save as…").click()],
  ];
  for (const [name, act] of SAVE_PATHS) {
    test(`CHK-J27 invalid setup blocks ${name}: toast, focus, nothing saved`, async ({ app }) => {
      await app.host.fill("127.0.0.1");
      await app.quantity.fill("126");
      const message = "Fix the highlighted fields before saving.";
      await app.host.focus(); // move focus away so the focus jump is observable
      await act(app);
      await expect(app.toast(message)).toBeVisible();
      await expect(app.toast(message).locator('[data-icon="circle-x"]')).toHaveCount(1);
      await expect(app.quantity).toBeFocused();
      await expect(app.saveAsDialog).toHaveCount(0);
      await expect(
        app.setup.getByText("Quantity for FC03 must be from 1 to 125.", { exact: true }),
      ).toBeVisible();
      expect(await app.callCount("profilesSave")).toBe(0);
      expect(await app.script((f) => f.profilesList())).toEqual([]);
      await expect(app.toolbarButton("Save")).toBeEnabled();
      await expect(app.toolbarButton("Save as…")).toBeEnabled();
    });
  }

  test("CHK-J28 unsaved + invalid: Save in 'Save changes?' is blocked (profile-load path)", async ({
    app,
    page,
  }) => {
    // The window-close path needs the Tauri close event, which UI mode cannot trigger (see report).
    // The same "Save changes?" confirm appears when another profile is loaded.
    await app.seedProfiles([tcpProfile("Bench A")]);
    await app.host.fill("127.0.0.1");
    await app.quantity.fill("126");
    await page.keyboard.press("Control+o");
    await app.openDialog.getByRole("row", { name: /Bench A/ }).dblclick();
    await expect(app.confirmDialog).toBeVisible();
    await expect(app.confirmDialog.getByText("Save changes?", { exact: true })).toBeVisible();
    await expect(app.confirmDialog).toContainText(
      "Save this setup as a profile before closing?",
    );
    await app.confirmDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(app.toast("Fix the highlighted fields before saving.")).toBeVisible();
    await expect(app.quantity).toBeFocused();
    expect(await app.callCount("profilesGet")).toBe(0);
    expect(await app.callCount("profilesSave")).toBe(0);
    await expect(app.profile).toContainText("Untitled");
  });
});
