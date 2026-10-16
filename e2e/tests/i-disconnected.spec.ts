// CHK-001 I. disconnected (UI side: the fake emits the backend events)
import { expect, hms, REGISTER_MAP_10, test } from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 540).getTime();

const refused = { kind: "refused", phase: "connectFailed" as const, message: "refused" };

test.describe("I. disconnected", () => {
  test("CHK-I1 connect refused: Disconnected pill, banner text, Reconnect and Dismiss", async ({ app }) => {
    await app.toState("disconnected", { reason: refused });
    await app.expectPill("Disconnected", "unplug");
    await expect(app.pill).toHaveAttribute("data-variant", "disconnected");
    await expect(app.banner).toHaveAttribute("data-variant", "error");
    await expect(app.banner.locator("p")).toHaveText("Connection refused by 127.0.0.1:5020.");
    await expect(app.bannerButton("Reconnect")).toBeVisible();
    await expect(app.bannerButton("Dismiss")).toBeVisible();
    await expect(app.dataEmpty).toHaveText("Connection lost. Press Reconnect to continue.");
  });

  test("CHK-I2 unknown host: could not be resolved", async ({ app }) => {
    await app.toState("disconnected", {
      host: "no-such-host.invalid",
      reason: { kind: "hostNotFound", phase: "connectFailed", message: "dns" },
    });
    await expect(app.banner.locator("p")).toHaveText(
      'Host "no-such-host.invalid" could not be resolved.',
    );
  });

  test("CHK-I3 host that never answers: No answer within 1000 ms (UI text)", async ({ app }) => {
    await app.toState("disconnected", {
      host: "10.255.255.1",
      port: 502,
      reason: { kind: "connectTimeout", phase: "connectFailed", message: "timed out" },
    });
    await expect(app.banner.locator("p")).toHaveText("No answer from 10.255.255.1:502 within 1000 ms.");
  });

  test("CHK-I4 link lost while polling: banner, kept values with chip, announced once, assertive", async ({
    app,
  }) => {
    await app.toLive();
    await app.pollUpdate(REGISTER_MAP_10, { at: AT });
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    await app.expectPill("Disconnected", "unplug");
    await expect(app.banner.locator("p")).toHaveText(
      "The device at 127.0.0.1:5020 closed the connection.",
    );
    await expect(app.value(0)).toHaveText("1234");
    await expect(app.chip).toHaveText(`Disconnected - values from ${hms(AT)}`);
    await expect(app.liveAssertive).toHaveText(
      "Disconnected. The device at 127.0.0.1:5020 closed the connection.",
    );
    await expect(app.livePolite).toHaveText("");
  });

  test("CHK-I5 Reconnect resumes polling without restarting the app", async ({ app }) => {
    await app.toLive();
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    await app.bannerButton("Reconnect").click();
    await app.expectCalls("connect", 2);
    await app.emitState("connecting");
    await app.expectPill("Connecting…", "loader");
    await app.emitState("connected");
    await app.emitState("polling");
    await app.pollUpdate(REGISTER_MAP_10);
    await app.expectPill("Polling", "activity");
    await app.expectNoBanner();
    await expect(app.chip).toContainText("Updated");
  });

  test("CHK-I5 Ctrl+L also reconnects", async ({ app, page }) => {
    await app.toState("disconnected", { reason: refused });
    await page.keyboard.press("Control+l");
    await app.expectCalls("connect", 2);
  });

  test("CHK-I6 Dismiss shows a spinner until the backend reports idle, no local reset", async ({ app }) => {
    await app.toLive();
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    await app.script((f) => {
      window.__qa = { held: f.hold("disconnect") };
    });
    const dismiss = app.bannerButton("Dismiss");
    await dismiss.click();
    await app.expectCalls("disconnect", 1);
    await expect(dismiss).toBeDisabled();
    await expect(dismiss.locator('[data-icon="loader"]')).toHaveCount(1);
    // Even after the command returned, nothing resets until the backend says idle.
    await app.script(() => (window.__qa as { held: { release(): void } }).held.release());
    await expect(app.banner).toBeVisible();
    await app.expectPill("Disconnected", "unplug");
    await expect(app.value(0)).toHaveText("1234");
    await app.emitState("idle");
    await app.expectPill("Not connected", "plug");
    await app.expectNoBanner();
    await expect(app.dataEmpty).toHaveText(
      "Not connected. Configure a connection and press Connect (Ctrl+L).",
    );
  });

  test("CHK-I7 RTU: banner reads COM3 was removed (UI text)", async ({ app }) => {
    await app.toState("polling", { rtu: "COM3" });
    await app.emitState("disconnected", {
      reason: { kind: "portRemoved", phase: "linkLost", message: "removed" },
    });
    await expect(app.banner.locator("p")).toHaveText("COM3 was removed.");
  });

  test("CHK-I8 COM3 in use by another window (UI text)", async ({ app }) => {
    await app.toState("disconnected", {
      rtu: "COM3",
      reason: { kind: "portBusy", phase: "connectFailed", message: "busy" },
    });
    await expect(app.banner.locator("p")).toHaveText(
      "COM3 is in use by another application or window.",
    );
  });

  test("CHK-I9 port disappeared: not available, refresh the port list (UI text)", async ({ app }) => {
    await app.toState("disconnected", {
      rtu: "COM3",
      reason: { kind: "portNotFound", phase: "connectFailed", message: "gone" },
    });
    await expect(app.banner.locator("p")).toHaveText("COM3 is not available. Refresh the port list.");
  });

  test("CHK-I10 disconnected: connection fields editable again", async ({ app }) => {
    await app.toState("disconnected", { reason: refused });
    for (const f of [app.host, app.port, app.timeout]) await expect(f).toBeEditable();
    await expect(app.modeRtu).toBeEnabled();
    await expect(app.setup.getByText("Disconnect to change connection settings.")).toHaveCount(0);
  });

  test("CHK-I (ioError) other errors show the technical message", async ({ app }) => {
    await app.toState("disconnected", {
      reason: { kind: "ioError", phase: "linkLost", message: "connection reset by peer (os error 10054)" },
    });
    await expect(app.banner.locator("p")).toHaveText(
      "Connection error: connection reset by peer (os error 10054)",
    );
  });
});
