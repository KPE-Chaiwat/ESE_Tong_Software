// State-by-state coverage of DES 2.3 for all 9 session states (CHK state coverage index + R2).
// One test per state: pill, banner, toolbar actions, setup panel, data view. A grayscale screenshot
// of each state is attached as evidence for CHK-R2.
import { expect, hms, REGISTER_MAP_10, type SessionState, test } from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 540).getTime();

const SESSION_BUTTONS = ["Connect", "Reconnect", "Cancel", "Disconnect", "Start polling", "Pause", "Resume", "Write…"];

async function toolbarActions(app: import("../support/fixtures").ModbusApp): Promise<string[]> {
  const present: string[] = [];
  for (const name of SESSION_BUTTONS) {
    if ((await app.toolbarButton(name).count()) > 0) present.push(name);
  }
  return present;
}

async function grayscaleShot(
  app: import("../support/fixtures").ModbusApp,
  testInfo: import("@playwright/test").TestInfo,
  state: string,
) {
  await app.page.addStyleTag({ content: "html{filter:grayscale(1)}" });
  await testInfo.attach(`grayscale-${state}`, {
    body: await app.page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 300 } }),
    contentType: "image/png",
  });
}

const reason = { kind: "closedByPeer", phase: "linkLost" as const, message: "closed" };

test.describe("state by state (DES 2.3)", () => {
  test("CHK-STATE idle", async ({ app }, testInfo) => {
    await app.expectPill("Not connected", "plug");
    await app.expectSessionState("idle");
    await app.expectNoBanner();
    expect(await toolbarActions(app)).toEqual(["Connect"]);
    for (const f of [app.host, app.port, app.timeout, app.slaveId, app.start, app.quantity, app.scan]) {
      await expect(f).toBeEditable();
    }
    await expect(app.dataEmpty).toContainText("Not connected.");
    await grayscaleShot(app, testInfo, "idle");
  });

  test("CHK-STATE connecting", async ({ app }, testInfo) => {
    await app.toState("connecting");
    await app.expectPill("Connecting…", "loader");
    await app.expectSessionState("connecting");
    await expect(app.banner).toHaveAttribute("data-variant", "neutral");
    await expect(app.banner.locator("p")).toHaveText("Connecting to 127.0.0.1:5020…");
    expect(await toolbarActions(app)).toEqual(["Cancel"]);
    for (const f of [app.host, app.port, app.timeout]) await expect(f).not.toBeEditable();
    await expect(app.dataEmpty).toHaveText("Connecting to 127.0.0.1:5020…");
    await grayscaleShot(app, testInfo, "connecting");
  });

  test("CHK-STATE connected", async ({ app }, testInfo) => {
    await app.toState("connected");
    await app.expectPill("Connected", "link");
    await app.expectSessionState("connected");
    await app.expectNoBanner();
    expect(await toolbarActions(app)).toEqual(["Disconnect", "Start polling", "Write…"]);
    for (const f of [app.host, app.port, app.timeout]) await expect(f).not.toBeEditable();
    for (const f of [app.slaveId, app.start, app.quantity, app.scan]) await expect(f).toBeEditable();
    await expect(app.dataEmpty).toContainText("Connected. Press Start polling");
    await grayscaleShot(app, testInfo, "connected");
  });

  test("CHK-STATE polling (loading, then live)", async ({ app }, testInfo) => {
    await app.toState("polling");
    await app.expectPill("Polling", "activity");
    await app.expectSessionState("polling");
    await app.expectNoBanner();
    expect(await toolbarActions(app)).toEqual(["Disconnect", "Pause", "Write…"]);
    for (const f of [app.host, app.port, app.timeout]) await expect(f).not.toBeEditable();
    for (const f of [app.slaveId, app.start, app.quantity, app.scan]) await expect(f).toBeEditable();
    await expect(app.applyButton).toBeEnabled();
    await expect(app.chip).toHaveText("Waiting for first response…");
    await app.expectGridStatus("loading");
    await app.pollUpdate(REGISTER_MAP_10, { at: AT });
    await expect(app.chip).toHaveText(`Updated ${hms(AT)}`);
    await app.expectGridStatus("live");
    await grayscaleShot(app, testInfo, "polling");
  });

  test("CHK-STATE paused", async ({ app }, testInfo) => {
    await app.toLive();
    await app.emitState("paused");
    await app.expectPill("Paused", "pause");
    await app.expectSessionState("paused");
    await app.expectNoBanner();
    expect(await toolbarActions(app)).toEqual(["Disconnect", "Resume", "Write…"]);
    await expect(app.chip).toContainText("Paused - values from");
    await app.expectGridStatus("stale");
    await expect(app.value(0)).toHaveText("1234");
    await grayscaleShot(app, testInfo, "paused");
  });

  test("CHK-STATE timeout", async ({ app }, testInfo) => {
    await app.toLive();
    await app.emitState("timeout", { consecutiveFailures: 1 });
    await app.expectPill("Timeout", "timer-off");
    await app.expectSessionState("timeout");
    await expect(app.banner).toHaveAttribute("data-variant", "warning");
    await expect(app.banner.locator('[data-icon="timer-off"]')).toHaveCount(1);
    expect(await toolbarActions(app)).toEqual(["Disconnect", "Pause", "Write…"]);
    await expect(app.chip).toContainText("No response - values from");
    await app.expectGridStatus("stale");
    await grayscaleShot(app, testInfo, "timeout");
  });

  test("CHK-STATE exception", async ({ app }, testInfo) => {
    await app.toLive();
    await app.emitState("exception", { exceptionCode: 2, consecutiveFailures: 1 });
    await app.expectPill("Exception 02", "octagon-x");
    await app.expectSessionState("exception");
    await expect(app.banner).toHaveAttribute("data-variant", "error");
    await expect(app.banner.locator('[data-icon="octagon-x"]')).toHaveCount(1);
    expect(await toolbarActions(app)).toEqual(["Disconnect", "Pause", "Write…"]);
    await expect(app.chip).toContainText("Exception - values from");
    await app.expectGridStatus("stale");
    await expect(app.bannerButton("Reconnect")).toHaveCount(0); // only disconnected offers Reconnect
    await grayscaleShot(app, testInfo, "exception");
  });

  test("CHK-STATE badResponse", async ({ app }, testInfo) => {
    await app.toLive();
    await app.emitState("badResponse", {
      badResponseKind: "crc",
      badResponseDetail: null,
      consecutiveFailures: 1,
    });
    await app.expectPill("Bad response", "triangle-alert");
    await app.expectSessionState("badResponse");
    await expect(app.banner).toHaveAttribute("data-variant", "warning");
    await expect(app.banner.locator('[data-icon="triangle-alert"]')).toHaveCount(1);
    expect(await toolbarActions(app)).toEqual(["Disconnect", "Pause", "Write…"]);
    await expect(app.chip).toContainText("Bad response - values from");
    await app.expectGridStatus("stale");
    await grayscaleShot(app, testInfo, "badResponse");
  });

  test("CHK-STATE disconnected", async ({ app }, testInfo) => {
    await app.toLive();
    await app.emitState("disconnected", { reason });
    await app.expectPill("Disconnected", "unplug");
    await app.expectSessionState("disconnected");
    await expect(app.banner).toHaveAttribute("data-variant", "error");
    await expect(app.banner.locator('[data-icon="unplug"]')).toHaveCount(1);
    expect(await toolbarActions(app)).toEqual(["Reconnect"]);
    await expect(app.bannerButton("Reconnect")).toBeVisible();
    await expect(app.bannerButton("Dismiss")).toBeVisible();
    for (const f of [app.host, app.port, app.timeout]) await expect(f).toBeEditable();
    await expect(app.chip).toContainText("Disconnected - values from");
    await app.expectGridStatus("stale");
    await grayscaleShot(app, testInfo, "disconnected");
  });

  test("CHK-R2 every one of the 9 states is told apart by icon plus label alone", async ({ app }) => {
    const seen: { state: string; icon: string; label: string }[] = [];
    const snap = async (state: string) => {
      const icon = (await app.pill.locator("[data-icon]").getAttribute("data-icon")) ?? "";
      const label = (await app.pill.innerText()).trim();
      seen.push({ state, icon, label });
      // DES 2.3: the window title ends with the pill label ("*" once the setup differs from the defaults).
      const star = state === "idle" ? "" : " *";
      const title = `Modbus Master - Untitled${star} - ${label}`;
      await expect(app.page).toHaveTitle(title);
      await expect.poll(async () => (await app.windowTitles()).at(-1), { message: "native title" }).toBe(title);
      await app.expectSessionState(state as SessionState);
    };
    await snap("idle");
    await app.pressConnect();
    await app.emitState("connecting");
    await expect(app.pill).toHaveAttribute("data-variant", "connecting");
    await snap("connecting");
    await app.emitState("connected");
    await expect(app.pill).toHaveAttribute("data-variant", "connected");
    await snap("connected");
    await app.emitState("polling");
    await expect(app.pill).toHaveAttribute("data-variant", "polling");
    await snap("polling");
    await app.emitState("paused");
    await expect(app.pill).toHaveAttribute("data-variant", "paused");
    await snap("paused");
    await app.emitState("polling");
    await app.emitState("timeout", { consecutiveFailures: 1 });
    await expect(app.pill).toHaveAttribute("data-variant", "timeout");
    await snap("timeout");
    await app.emitState("exception", { exceptionCode: 2, consecutiveFailures: 1 });
    await expect(app.pill).toHaveAttribute("data-variant", "exception");
    await snap("exception");
    await app.emitState("badResponse", { badResponseKind: "crc", consecutiveFailures: 1 });
    await expect(app.pill).toHaveAttribute("data-variant", "badResponse");
    await snap("badResponse");
    await app.emitState("disconnected", { reason });
    await expect(app.pill).toHaveAttribute("data-variant", "disconnected");
    await snap("disconnected");
    expect(seen).toHaveLength(9);
    for (const s of seen) {
      expect(s.icon, `${s.state} has an icon`).not.toBe("");
      expect(s.label, `${s.state} has a label`).not.toBe("");
    }
    expect(new Set(seen.map((s) => s.label)).size, "labels are unique").toBe(9);
    expect(new Set(seen.map((s) => s.icon)).size, "icons are unique").toBe(9);
  });
});
