// CHK-001 items that need the fake window IPC (window.__ESEFACT_FAKE_WINDOW_IPC__): the close request
// (CHK-J28, CHK-P4), Ctrl+N (CHK-P1) and the titles sent to the native window.
import { expect, type ModbusApp, REGISTER_MAP_10, tcpProfile, test } from "../support/fixtures";

const BENCH_A = tcpProfile("Bench A");

async function loadBenchA(app: ModbusApp): Promise<void> {
  await app.seedProfiles([BENCH_A]);
  await app.page.keyboard.press("Control+o");
  await app.openDialog.getByRole("row", { name: /Bench A/ }).dblclick();
  await expect(app.openDialog).toHaveCount(0);
  await expect(app.profile).toContainText("Bench A");
}

const outcome = (app: ModbusApp, want: string) =>
  expect.poll(() => app.closeOutcome(), { message: "close request outcome" }).toBe(want);

test.describe("close request", () => {
  test("CHK-J28 close with unsaved changes and an invalid field: Save is blocked, toast, window stays open", async ({
    app,
  }) => {
    await app.host.fill("127.0.0.1");
    await app.quantity.fill("126");
    await app.requestClose();
    const confirm = app.confirmDialog;
    await expect(confirm.getByText("Save changes?", { exact: true })).toBeVisible();
    await expect(confirm).toContainText("Save this setup as a profile before closing?");
    await confirm.getByRole("button", { name: "Save", exact: true }).click();
    await expect(app.toast("Fix the highlighted fields before saving.")).toBeVisible();
    await expect(app.quantity).toBeFocused();
    await outcome(app, "kept");
    expect(await app.callCount("profilesSave")).toBe(0);
    await expect(app.saveAsDialog).toHaveCount(0);
    await expect(app.confirmDialog).toHaveCount(0);
  });

  test("CHK-P4 unsaved changes: Cancel keeps the window open", async ({ app }) => {
    await app.host.fill("127.0.0.1");
    await app.requestClose();
    const confirm = app.confirmDialog;
    await expect(confirm.getByText("Save changes?", { exact: true })).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    await expect(confirm.getByRole("button", { name: "Don't save" })).toBeVisible();
    expect(await app.closeOutcome()).toBe("pending");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await outcome(app, "kept");
    await expect(app.host).toHaveValue("127.0.0.1");
  });

  test("CHK-P4 unsaved changes: Don't save closes the window", async ({ app }) => {
    await app.host.fill("127.0.0.1");
    await app.requestClose();
    await app.confirmDialog.getByRole("button", { name: "Don't save" }).click();
    await outcome(app, "closed");
    expect(await app.callCount("profilesSave")).toBe(0);
  });

  test("CHK-P4 unsaved changes of a named profile: Save saves it and closes", async ({ app }) => {
    await loadBenchA(app);
    await app.quantity.fill("12");
    await expect(app.profile).toContainText("Modified");
    await app.requestClose();
    await expect(app.confirmDialog).toContainText('Save changes to "Bench A" before closing?');
    await app.confirmDialog.getByRole("button", { name: "Save", exact: true }).click();
    await outcome(app, "closed");
    const [[saved]] = (await app.calls("profilesSave")) as [[Record<string, unknown>]];
    expect(saved).toMatchObject({ name: "Bench A", poll: { quantity: 12 } });
  });

  test("CHK-P4 a polling window without changes closes immediately, with no question (UI side)", async ({
    app,
  }) => {
    await loadBenchA(app);
    await app.toolbarButton("Connect").click();
    await app.expectCalls("connect", 1);
    await app.emitState("connecting");
    await app.emitState("connected");
    await app.emitState("polling");
    await app.pollUpdate(REGISTER_MAP_10);
    await app.expectPill("Polling", "activity");
    await expect(app.profile).not.toContainText("Modified");
    await app.requestClose();
    await outcome(app, "closed");
    await expect(app.confirmDialog).toHaveCount(0);
  });
});

test.describe("Ctrl+N and titles", () => {
  test("CHK-P1 Ctrl+N asks the window IPC to open a new modbus-master window (UI side)", async ({
    app,
    page,
  }) => {
    expect(await app.openedTools()).toEqual([]);
    await page.keyboard.press("Control+n");
    await expect.poll(() => app.openedTools()).toEqual(["modbus-master"]);
    await page.keyboard.press("Control+n");
    await expect.poll(() => app.openedTools()).toEqual(["modbus-master", "modbus-master"]);
  });

  test("CHK-P1 Ctrl+N does nothing while a modal is open", async ({ app, page }) => {
    await page.keyboard.press("Control+o");
    await expect(app.openDialog).toBeVisible();
    await page.keyboard.press("Control+n");
    expect(await app.openedTools()).toEqual([]);
  });

  test("CHK-P1 a failing window open shows 'Could not open a new window: {message}'", async ({ app, page }) => {
    await page.evaluate(() => {
      const w = window.__ESEFACT_FAKE_WINDOW_IPC__;
      if (w) w.openError = "Unknown tool";
    });
    await page.keyboard.press("Control+n");
    await expect(app.toast("Could not open a new window: Unknown tool")).toBeVisible();
  });

  test("CHK-A1 window title sent to the native window equals the document title", async ({ app, page }) => {
    await expect(page).toHaveTitle("Modbus Master - Untitled - Not connected");
    await expect.poll(async () => (await app.windowTitles()).at(-1)).toBe(
      "Modbus Master - Untitled - Not connected",
    );
  });

  test("CHK-O1 title follows profile name, modified marker and state (document and native window)", async ({
    app,
    page,
  }) => {
    await loadBenchA(app);
    const last = async () => (await app.windowTitles()).at(-1);
    await expect.poll(last).toBe("Modbus Master - Bench A - Not connected");
    await app.quantity.fill("12");
    await expect.poll(last).toBe("Modbus Master - Bench A * - Not connected");
    await page.keyboard.press("Control+s");
    await expect.poll(last).toBe("Modbus Master - Bench A - Not connected");
    await app.toolbarButton("Connect").click();
    await app.emitState("connecting");
    await expect.poll(last).toBe("Modbus Master - Bench A - Connecting…");
    await app.emitState("connected");
    await app.emitState("polling");
    await expect.poll(last).toBe("Modbus Master - Bench A - Polling");
    await app.emitState("exception", { exceptionCode: 2, consecutiveFailures: 1 });
    await expect.poll(last).toBe("Modbus Master - Bench A - Exception 02");
    await expect(page).toHaveTitle("Modbus Master - Bench A - Exception 02");
  });
});
