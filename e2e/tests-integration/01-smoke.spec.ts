// Integration mode, priority 1: the real app starts, the launcher offers Modbus Master, Open creates
// a real second window (CHK-P1), and the window titles are real native titles.
import { expect, ModbusApp, openModbusWindow, test } from "../integration/fixtures";
import { realConnect } from "../integration/helpers";

test.describe("smoke", () => {
  test("INT-SMOKE-1 app starts and the launcher shows the Modbus Master card", async ({ desktop, launcher }) => {
    await expect(launcher.getByRole("heading", { name: "ESEfact" })).toBeVisible();
    const card = launcher.getByTestId("tool-card-modbus-master");
    await expect(card).toBeVisible();
    await expect(card.getByText("Modbus Master")).toBeVisible();
    await expect(card.getByRole("button", { name: "Open" })).toBeEnabled();
    const windows = desktop.windows();
    expect(windows.map((w) => w.title)).toContain("ESEfact");
  });

  test("CHK-P1 Open creates a real second window, idle, Untitled, offset 24 px", async ({ desktop, launcher }, testInfo) => {
    const t0 = Date.now();
    const timeline: string[] = [];
    const snap = (what: string) => {
      const w = desktop.windows().map((x) => `${x.hwnd}:"${x.title}" @${x.x},${x.y} ${x.w}x${x.h}`);
      timeline.push(`+${Date.now() - t0} ms ${what}: ${w.join(" | ")}`);
      return desktop.windows();
    };
    try {
      const before = snap("before click");
      const launcherWindow = before.find((w) => w.title === "ESEfact");
      expect(launcherWindow, "launcher window").toBeTruthy();
      const dpr = await launcher.evaluate(() => window.devicePixelRatio);

      const mm = await openModbusWindow(desktop, launcher);
      snap("page ready");
      await mm.expectPill("Not connected", "plug");
      await expect(mm.page).toHaveTitle("Modbus Master - Untitled - Not connected");
      await expect(mm.profile).toHaveText("Untitled");
      await expect(mm.dataEmpty).toContainText("Not connected.");
      await mm.expectNoBanner();

      await expect
        .poll(() => desktop.windows().map((w) => w.title), { message: "native window titles" })
        .toContain("Modbus Master - Untitled - Not connected");
      const after = snap("native title visible");
      const mmWindow = after.find((w) => w.title === "Modbus Master - Untitled - Not connected");
      expect(mmWindow, "modbus master native window").toBeTruthy();
      expect(after.length).toBe(before.length + 1);
      // DES 5.4 / BE-001: opened 24 px (logical) from the calling window.
      const launcherNow = after.find((w) => w.title === "ESEfact");
      expect(mmWindow && launcherNow ? mmWindow.x - launcherNow.x : null, "x offset").toBeCloseTo(24 * dpr, 0);
      expect(mmWindow && launcherNow ? mmWindow.y - launcherNow.y : null, "y offset").toBeCloseTo(24 * dpr, 0);
    } catch (e) {
      snap("at failure");
      await testInfo.attach("p1-timeline.txt", { body: timeline.join("\n"), contentType: "text/plain" });
      throw e;
    } finally {
      await testInfo.attach("p1-timeline-always.txt", { body: timeline.join("\n"), contentType: "text/plain" });
    }
  });

  test("CHK-P1 Ctrl+N in a Modbus Master window opens another real window offset from it", async ({
    desktop,
    mm,
  }) => {
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    const first = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    expect(first).toBeTruthy();
    const count = desktop.windows().length;
    const known = new Set(desktop.pages());
    await mm.page.keyboard.press("Control+n");
    await expect.poll(() => desktop.windows().length).toBe(count + 1);
    const second = desktop
      .windows()
      .find((w) => w.title.startsWith("Modbus Master") && w.hwnd !== first?.hwnd);
    expect(second).toBeTruthy();
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBeCloseTo(24 * dpr, 0);
    expect((second?.y ?? 0) - (first?.y ?? 0)).toBeCloseTo(24 * dpr, 0);
    const page2 = await desktop.newPage(known, (u) => u.includes("/tools/modbus-master"));
    const app2 = new ModbusApp(page2);
    await expect(app2.toolbarButton("Connect")).toBeEnabled();
    await app2.expectPill("Not connected", "plug");
    await expect(page2).toHaveTitle("Modbus Master - Untitled - Not connected");
  });

  test("INT-SMOKE-2 native window title follows the state and the profile marker", async ({ desktop, mm, sim }) => {
    await realConnect(mm, sim, { autoStart: false });
    await mm.expectPill("Connected", "link");
    // The setup now differs from the defaults, so the title carries the modified marker.
    await expect
      .poll(() => desktop.windows().map((w) => w.title), { message: "native title" })
      .toContain("Modbus Master - Untitled * - Connected");
    await mm.page.keyboard.press("Control+l");
    await expect
      .poll(() => desktop.windows().map((w) => w.title))
      .toContain("Modbus Master - Untitled * - Not connected");
  });
});
