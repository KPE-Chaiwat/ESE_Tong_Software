import { expect, type Page, test as base } from "@playwright/test";
import { ModbusApp } from "../../support/app";
import { Desktop } from "../desktop";
import { Sim } from "../sim";

export { expect };
export * from "../../support/app";
export { Desktop } from "../desktop";
export { Sim, parseLog } from "../sim";

interface Fixtures {
  sim: Sim;
  desktop: Desktop;
  /** The launcher window. */
  launcher: Page;
  /** A Modbus Master window opened from the launcher (real `window_open_tool`). */
  mm: ModbusApp;
}

/** Opens a Modbus Master window from the launcher card and waits until it is ready. */
export async function openModbusWindow(desktop: Desktop, launcher: Page): Promise<ModbusApp> {
  const known = new Set(desktop.pages());
  await launcher.getByTestId("tool-card-modbus-master").getByRole("button", { name: "Open" }).click();
  const page = await desktop.newPage(known, (u) => u.includes("/tools/modbus-master"));
  const app = new ModbusApp(page);
  await expect(app.toolbarButton("Connect")).toBeEnabled({ timeout: 30_000 });
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
    }
    expect(app.pageErrors, "uncaught page errors").toEqual([]);
  },
});
