// CHK-001 B. connecting, C. connected
import { expect, test } from "../support/fixtures";

test.describe("B. connecting", () => {
  test("CHK-B1 spinner pill, banner with Cancel, data card connecting text (UI side)", async ({
    app,
  }) => {
    await app.toState("connecting");
    await app.expectPill("Connecting…", "loader");
    await expect(app.banner).toHaveAttribute("data-variant", "neutral");
    await expect(app.banner).toContainText("Connecting to 127.0.0.1:5020…");
    await expect(app.bannerButton("Cancel")).toBeVisible();
    await expect(app.dataEmpty).toHaveText("Connecting to 127.0.0.1:5020…");
  });

  test("CHK-B2 connection fields read-only with hint", async ({ app }) => {
    await app.toState("connecting");
    for (const f of [app.host, app.port, app.timeout]) await expect(f).not.toBeEditable();
    await expect(app.modeTcp).toBeDisabled();
    await expect(app.modeRtu).toBeDisabled();
    await expect(app.setup.getByText("Disconnect to change connection settings.")).toBeVisible();
  });

  test("CHK-B3 Cancel button returns to idle without an error banner", async ({ app }) => {
    await app.toState("connecting");
    await app.bannerButton("Cancel").click();
    await app.expectCalls("cancelConnect", 1);
    await app.emitState("idle");
    await app.expectPill("Not connected", "plug");
    await app.expectNoBanner();
  });

  test("CHK-B3 Ctrl+L cancels the connect attempt", async ({ app, page }) => {
    await app.toState("connecting");
    await page.keyboard.press("Control+l");
    await app.expectCalls("cancelConnect", 1);
    await app.emitState("idle");
    await app.expectPill("Not connected", "plug");
    await app.expectNoBanner();
    expect(await app.callCount("disconnect")).toBe(0);
  });

  test("CHK-B4 reduced motion: the loader icon does not spin and the text stays", async ({
    app,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await app.toState("connecting");
    const loader = app.pill.locator('[data-icon="loader"]');
    await expect(loader).toHaveClass(/animate-spin/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(loader).not.toHaveClass(/animate-spin/);
    await expect(app.pill).toHaveText("Connecting…");
    await expect(app.banner.locator('[data-icon="loader"]')).not.toHaveClass(/animate-spin/);
    await expect(app.banner).toContainText("Connecting to 127.0.0.1:5020…");
  });
});

test.describe("C. connected", () => {
  test("CHK-C1 link icon, dark fill and light text, connected data text", async ({ app }) => {
    await app.toState("connected");
    await app.expectPill("Connected", "link");
    await expect(app.pill).toHaveAttribute("data-variant", "connected");
    await expect(app.pill).toHaveCSS("background-color", "rgb(49, 47, 46)");
    await expect(app.pill).toHaveCSS("color", "rgb(237, 239, 242)");
    await expect(app.dataEmpty).toHaveText(
      "Connected. Press Start polling (Ctrl+P) to read 10 holding registers from slave 1.",
    );
    await app.expectNoBanner();
  });

  test("CHK-C2 connection read-only, poll editable, Disconnect + Start polling + Write…", async ({
    app,
  }) => {
    await app.toState("connected");
    for (const f of [app.host, app.port, app.timeout]) await expect(f).not.toBeEditable();
    for (const f of [app.slaveId, app.start, app.quantity, app.scan]) await expect(f).toBeEditable();
    await expect(app.fn).toBeEnabled();
    await expect(app.toolbarButton("Disconnect")).toBeVisible();
    await expect(app.toolbarButton("Start polling")).toBeVisible();
    await expect(app.toolbarButton("Write…")).toBeVisible();
    await expect(app.toolbarButton("Connect")).toHaveCount(0);
  });

  test("CHK-C3 invalid poll quantity 126: fix text, Ctrl+P and Start polling send nothing", async ({
    app,
    page,
  }) => {
    await app.toState("connected");
    await app.quantity.fill("126");
    await expect(app.dataEmpty).toHaveText("Fix the poll settings to start polling.");
    await page.keyboard.press("Control+p");
    await app.toolbarButton("Start polling").click();
    await expect(app.quantity).toHaveAttribute("aria-invalid", "true");
    expect(await app.callCount("startPoll")).toBe(0);
    await expect(app.page.getByTestId("traffic-empty")).toBeVisible();
  });

  test("CHK-C4 Disconnect ends idle and shows the idle text", async ({ app }) => {
    await app.toState("connected");
    await app.toolbarButton("Disconnect").click();
    await app.expectCalls("disconnect", 1);
    await app.emitState("idle");
    await app.expectPill("Not connected", "plug");
    await expect(app.dataEmpty).toHaveText(
      "Not connected. Configure a connection and press Connect (Ctrl+L).",
    );
  });
});
