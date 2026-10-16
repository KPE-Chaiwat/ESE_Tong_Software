// CHK-001 O. Profiles (UI side: the fake keeps the profile store in memory)
import { expect, type ModbusApp, tcpProfile, test } from "../support/fixtures";

const BENCH_A = tcpProfile("Bench A", {
  poll: { slaveId: 1, function: 4, startAddress: 4, quantity: 10, scanRateMs: 1000 },
  display: { format: "hex", addressBase: 1 },
  autoStartPoll: true,
});

/** Loads a profile through Ctrl+O (a clean window: nothing to save first). */
async function loadProfile(app: ModbusApp, name: string): Promise<void> {
  await app.page.keyboard.press("Control+o");
  await app.openDialog.getByRole("row", { name: new RegExp(name) }).dblclick();
  await expect(app.openDialog).toHaveCount(0);
  await expect(app.profile).toContainText(name);
}

test.describe("O. profiles", () => {
  test("CHK-O1 Save as 'Bench A' (FC04, start 5, Hex, 1-based): saved, title without marker", async ({
    app,
    page,
  }) => {
    await page.keyboard.press("Control+b"); // 1-based
    await page.keyboard.press("Control+3"); // Hex
    await app.fn.selectOption("4");
    await app.start.fill("5");
    await app.toState("polling");
    await page.keyboard.press("Control+Shift+s");
    await app.saveAsDialog.getByLabel("Name").fill("Bench A");
    await app.saveAsDialog.getByRole("button", { name: "Save" }).click();
    await expect(app.saveAsDialog).toHaveCount(0);
    await expect(page).toHaveTitle("Modbus Master - Bench A - Polling");
    await expect(app.profile).toHaveText("Bench A");
    await expect(app.profile).not.toContainText("Modified");
    const saved = await app.script((f) => f.profilesGet("Bench A"));
    expect(saved).toMatchObject({
      name: "Bench A",
      schemaVersion: 1,
      connection: { mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 },
      poll: { function: 4, startAddress: 4 },
      display: { format: "hex", addressBase: 1 },
    });
  });

  test("CHK-O2 a change marks the profile Modified; Ctrl+S saves without a dialog and clears it", async ({
    app,
    page,
  }) => {
    await app.seedProfiles([BENCH_A]);
    await loadProfile(app, "Bench A");
    await expect(app.profile).not.toContainText("Modified");
    await app.quantity.fill("12");
    await expect(app.profile).toContainText("Modified");
    await expect(page).toHaveTitle("Modbus Master - Bench A * - Not connected");
    await page.keyboard.press("Control+s");
    await app.expectCalls("profilesSave", 1);
    const [[saved, overwrite]] = (await app.calls("profilesSave")) as [[Record<string, unknown>, boolean]];
    expect(saved).toMatchObject({ name: "Bench A", poll: { quantity: 12 } });
    expect(overwrite).toBe(true);
    await expect(app.saveAsDialog).toHaveCount(0);
    await expect(app.profile).not.toContainText("Modified");
    await expect(page).toHaveTitle("Modbus Master - Bench A - Not connected");
  });

  test("CHK-O3 opening 'Bench A' restores everything, stays idle, Connect polls FC04 from 5 in Hex 1-based", async ({
    app,
  }) => {
    await app.seedProfiles([BENCH_A]);
    await loadProfile(app, "Bench A");
    await app.expectPill("Not connected", "plug");
    expect(await app.callCount("connect")).toBe(0);
    await expect(app.host).toHaveValue("127.0.0.1");
    await expect(app.port).toHaveValue("5020");
    await expect(app.fn).toHaveValue("4");
    await expect(app.start).toHaveValue("5");
    await expect(app.formatGroup.getByRole("radio", { name: "Hex", exact: true })).toBeChecked();
    await expect(app.baseGroup.getByRole("radio", { name: "1", exact: true })).toBeChecked();
    await expect(app.autoStart).toBeChecked();
    await app.toolbarButton("Connect").click();
    await app.expectCalls("connect", 1);
    await app.emitState("connecting");
    await app.emitState("connected");
    await app.expectCalls("startPoll", 1);
    const [[def]] = (await app.calls("startPoll")) as [[Record<string, unknown>]];
    expect(def).toMatchObject({ function: 4, startAddress: 4, quantity: 10 });
    await app.emitState("polling");
    await app.pollUpdate(Array.from({ length: 10 }, (_, i) => i + 1), { function: 4, startAddress: 4 });
    await expect(app.address(0)).toHaveText("5"); // 1-based display of protocol address 4
    await expect(app.value(0)).toHaveText("0x0001"); // Hex
  });

  test("CHK-O4 loading while polling asks 'Disconnect and load?'; Cancel keeps polling", async ({ app, page }) => {
    await app.seedProfiles([BENCH_A, tcpProfile("Pump", { connection: { mode: "tcp", host: "10.0.0.7", port: 502, timeoutMs: 500 } })]);
    await loadProfile(app, "Bench A");
    await app.script((f) =>
      f.setResult("disconnect", () => {
        f.emitState("idle");
      }),
    );
    await app.toolbarButton("Connect").click();
    await app.expectCalls("connect", 1);
    await app.emitState("connecting");
    await app.emitState("connected");
    await app.emitState("polling");
    await page.keyboard.press("Control+o");
    await app.openDialog.getByRole("row", { name: /Pump/ }).dblclick();
    const confirm = app.confirmDialog;
    await expect(confirm.getByText("Disconnect and load?", { exact: true })).toBeVisible();
    await expect(confirm).toContainText('Loading "Pump" will disconnect from TCP 127.0.0.1:5020.');
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await app.expectPill("Polling", "activity");
    expect(await app.callCount("disconnect")).toBe(0);
    await expect(app.profile).toContainText("Bench A");

    await page.keyboard.press("Control+o");
    await app.openDialog.getByRole("row", { name: /Pump/ }).dblclick();
    await app.confirmDialog.getByRole("button", { name: "Disconnect and load" }).click();
    await app.expectCalls("disconnect", 1);
    await app.expectPill("Not connected", "plug");
    await expect(app.profile).toContainText("Pump");
    await expect(app.host).toHaveValue("10.0.0.7");
    await expect(app.timeout).toHaveValue("500");
  });

  test("CHK-O5 Save as with an existing name asks 'Replace profile?' with Cancel focused", async ({
    app,
    page,
  }) => {
    await app.seedProfiles([BENCH_A]);
    await app.host.fill("127.0.0.1");
    await page.keyboard.press("Control+Shift+s");
    await app.saveAsDialog.getByLabel("Name").fill("Bench A");
    await app.saveAsDialog.getByRole("button", { name: "Save" }).click();
    const confirm = app.confirmDialog;
    await expect(confirm.getByText("Replace profile?", { exact: true })).toBeVisible();
    await expect(confirm).toContainText('A profile named "Bench A" already exists. Replace it?');
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    const saves = (await app.calls("profilesSave")) as [unknown, boolean][];
    expect(saves.every(([, overwrite]) => overwrite === false)).toBe(true);
  });

  test("CHK-O5 Replace overwrites", async ({ app, page }) => {
    await app.seedProfiles([BENCH_A]);
    await app.host.fill("10.1.1.1");
    await page.keyboard.press("Control+Shift+s");
    await app.saveAsDialog.getByLabel("Name").fill("Bench A");
    await app.saveAsDialog.getByRole("button", { name: "Save" }).click();
    await app.confirmDialog.getByRole("button", { name: "Replace" }).click();
    await expect(app.saveAsDialog).toHaveCount(0);
    const saved = await app.script((f) => f.profilesGet("Bench A"));
    expect(saved).toMatchObject({ connection: { host: "10.1.1.1" } });
    await expect(app.profile).toContainText("Bench A");
  });

  test("CHK-O6 Delete asks for confirmation; the profile is gone, also from a reopened list", async ({
    app,
    page,
  }) => {
    await app.seedProfiles([BENCH_A]);
    await page.keyboard.press("Control+o");
    const d = app.openDialog;
    await d.getByRole("row", { name: /Bench A/ }).click();
    await d.getByRole("button", { name: "Delete" }).click();
    const confirm = app.confirmDialog;
    await expect(confirm.getByText("Delete profile?", { exact: true })).toBeVisible();
    await expect(confirm).toContainText('Delete "Bench A"? This cannot be undone.');
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(d.getByText("No saved profiles yet.", { exact: false })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    await page.keyboard.press("Control+o");
    await expect(
      app.openDialog.getByText("No saved profiles yet. Use Save as (Ctrl+Shift+S) to create one."),
    ).toBeVisible();
  });

  test("CHK-O7 renaming the loaded profile renames the toolbar and the title; Ctrl+S saves under the new name", async ({
    app,
    page,
  }) => {
    await app.seedProfiles([BENCH_A]);
    await loadProfile(app, "Bench A");
    await page.keyboard.press("Control+o");
    const d = app.openDialog;
    await d.getByRole("row", { name: /Bench A/ }).click();
    await d.getByRole("button", { name: "Rename" }).click();
    await d.getByLabel("New profile name").fill("Bench B");
    await d.getByLabel("New profile name").press("Enter");
    await expect(d.getByRole("row", { name: /Bench B/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    await expect(app.profile).toHaveText("Bench B");
    await expect(page).toHaveTitle("Modbus Master - Bench B - Not connected");
    await page.keyboard.press("Control+s");
    await app.expectCalls("profilesSave", 1);
    const [[saved]] = (await app.calls("profilesSave")) as [[Record<string, unknown>]];
    expect(saved).toMatchObject({ name: "Bench B" });
  });

  test("CHK-O9 'Bench A' deleted in another window: Ctrl+S creates it again without an error", async ({
    app,
    page,
  }) => {
    await app.seedProfiles([BENCH_A]);
    await loadProfile(app, "Bench A");
    await app.script((f) => f.profilesDelete("Bench A")); // what another window did
    await page.keyboard.press("Control+s");
    await expect
      .poll(async () => (await app.script((f) => f.profilesList())) as { name: string }[], {
        message: "profile list after Ctrl+S",
      })
      .toEqual([expect.objectContaining({ name: "Bench A" })]);
    await expect(app.anyToast).toHaveCount(0);
    await expect(app.profile).toContainText("Bench A");
    await expect(app.profile).not.toContainText("Modified");
  });

  test("CHK-O10 unreadable profile: listed with triangle-alert text, Open disabled", async ({ app, page }) => {
    await app.script((f) =>
      f.setResult("profilesList", [
        { name: "Future", modifiedAt: Date.now(), connectionSummary: "schemaVersion 9", readable: false },
        { name: "Bench A", modifiedAt: Date.now(), connectionSummary: "TCP 127.0.0.1:5020", readable: true },
      ]),
    );
    await page.keyboard.press("Control+o");
    const d = app.openDialog;
    const row = d.getByRole("row", { name: /Future/ });
    await expect(row).toContainText("Cannot be opened (newer or damaged file)");
    await expect(row.locator('[data-icon="triangle-alert"]')).toHaveCount(1);
    await row.click();
    await expect(d.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
    await expect(d.getByRole("button", { name: "Rename" })).toBeEnabled();
    await expect(d.getByRole("button", { name: "Delete" })).toBeEnabled();
    await row.dblclick();
    await expect(d).toBeVisible();
    expect(await app.callCount("profilesGet")).toBe(0);
  });

  test("CHK-P4 unsaved changes: 'Save changes?' offers Save / Don't save / Cancel (profile-load path)", async ({
    app,
    page,
  }) => {
    // Closing a window needs the Tauri close event (integration mode). The same confirm guards loading.
    await app.seedProfiles([BENCH_A]);
    await app.host.fill("127.0.0.1");
    await page.keyboard.press("Control+o");
    await app.openDialog.getByRole("row", { name: /Bench A/ }).dblclick();
    const confirm = app.confirmDialog;
    await expect(confirm.getByText("Save changes?", { exact: true })).toBeVisible();
    await expect(confirm).toContainText("Save this setup as a profile before closing?");
    await expect(confirm.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    await expect(confirm.getByRole("button", { name: "Don't save" })).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(app.host).toHaveValue("127.0.0.1"); // Cancel keeps everything
    expect(await app.callCount("profilesGet")).toBe(0);
    await page.keyboard.press("Control+o");
    await app.openDialog.getByRole("row", { name: /Bench A/ }).dblclick();
    await app.confirmDialog.getByRole("button", { name: "Don't save" }).click();
    await expect(app.profile).toContainText("Bench A");
    expect(await app.callCount("profilesSave")).toBe(0);
  });
});
