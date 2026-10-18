import { expect, type Page, test as base } from "@playwright/test";
import { Desktop } from "./desktop";
import { RealMm } from "./real-mm";
import { Sim } from "./sim";

export { expect };
export { Desktop } from "./desktop";
export { RealMm, RealNative } from "./real-mm";
export { Sim, parseLog } from "./sim";

interface Fixtures {
  sim: Sim;
  desktop: Desktop;
  /** The launcher window. */
  launcher: Page;
  /** A Modbus Master window (W1) opened from the launcher (real `window_open_tool`). */
  mm: RealMm;
}

/** Opens a Modbus Master window from the launcher card and waits until it is ready. */
export async function openModbusWindow(desktop: Desktop, launcher: Page): Promise<RealMm> {
  const known = new Set(desktop.pages());
  await launcher.getByTestId("tool-card-modbus-master").getByRole("button", { name: "Open" }).click();
  const page = await desktop.newPage(known, (u) => /\/tools\/modbus-master(\/)?(\?|#|$)/.test(u));
  const app = new RealMm(page);
  await expect(app.toolbar.getByRole("button", { name: /^(Connect|Disconnect|Reconnect|Cancel)$/ }).first()).toBeEnabled({
    timeout: 30_000,
  });
  return app;
}

export const test = base.extend<Fixtures>({
  sim: async ({}, use, testInfo) => {
    const sim = await Sim.start();
    await use(sim);
    await testInfo.attach("simulator.log", { body: sim.lines.join("\n"), contentType: "text/plain" });
    await sim.stop();
  },
  desktop: async ({}, use, testInfo) => {
    const desktop = await Desktop.start();
    await use(desktop);
    await testInfo.attach("app-stdout.log", { body: desktop.log.join("\n"), contentType: "text/plain" });
    await desktop.stop();
  },
  launcher: async ({ desktop }, use) => {
    await use(await desktop.launcherPage());
  },
  mm: async ({ desktop, launcher }, use, testInfo) => {
    const app = await openModbusWindow(desktop, launcher);
    await use(app);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("window.png", { body: await app.page.screenshot(), contentType: "image/png" }).catch(() => {});
      await testInfo.attach("window-state.txt", {
        body: JSON.stringify(desktop.windows(), null, 2),
        contentType: "text/plain",
      }).catch(() => {});
    }
    expect(app.pageErrors, "uncaught page errors in W1").toEqual([]);
  },
});
