// CHK-001 A. idle
import { test, expect } from "../support/fixtures";

test.describe("A. idle", () => {
  test("CHK-A1 new window: pill, title, idle text, no banner", async ({ app, page }) => {
    await app.expectPill("Not connected", "plug");
    await expect(page).toHaveTitle("Modbus Master - Untitled - Not connected");
    await expect(app.dataEmpty).toHaveText(
      "Not connected. Configure a connection and press Connect (Ctrl+L).",
    );
    await app.expectNoBanner();
  });

  test("CHK-A2 all fields editable, toolbar shows Connect with tooltip", async ({ app }) => {
    for (const f of [app.host, app.port, app.timeout, app.slaveId, app.start, app.quantity, app.scan]) {
      await expect(f).toBeEditable();
    }
    await expect(app.fn).toBeEnabled();
    await expect(app.autoStart).toBeEnabled();
    await expect(app.modeTcp).toBeEnabled();
    const connect = app.toolbarButton("Connect");
    await expect(connect).toBeEnabled();
    await expect(connect).toHaveAttribute("title", "Connect (Ctrl+L)");
  });

  test("CHK-A3 no Write button in idle and Ctrl+E opens nothing", async ({ app, page }) => {
    await expect(app.toolbarButton("Write…")).toHaveCount(0);
    await page.keyboard.press("Control+e");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("CHK-A4 traffic panel empty text and all counters 0", async ({ app }) => {
    await expect(app.page.getByTestId("traffic-empty")).toHaveText(
      "No frames yet. Requests and responses appear here.",
    );
    await app.expectCounters({ requests: 0, responses: 0, errors: 0, timeouts: 0 });
  });

  test("CHK-A5 write dialog open while connected, link lost: Send disabled and Not connected text", async ({
    app,
  }) => {
    await app.toState("polling");
    await app.toolbarButton("Write…").click();
    await expect(app.writeDialog).toBeVisible();
    await expect(app.writeDialog.getByRole("button", { name: "Send" })).toBeEnabled();
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    await expect(app.writeDialog.getByRole("button", { name: "Send" })).toBeDisabled();
    await expect(app.writeResult).toHaveText("Not connected. Connect before writing.");
  });
});
