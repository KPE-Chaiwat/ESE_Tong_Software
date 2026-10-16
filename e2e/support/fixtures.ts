import { expect, test as base } from "@playwright/test";
import { ModbusApp } from "./app";

export { expect };
export * from "./app";

/** Console warnings and errors of the page are kept as annotations (they do not fail a test). */
function noteConsole(app: ModbusApp, testInfo: import("@playwright/test").TestInfo): void {
  for (const text of new Set(app.consoleWarnings)) {
    testInfo.annotations.push({ type: "console", description: text.slice(0, 300) });
  }
}

interface Fixtures {
  /** A fresh Modbus Master window in "manual" mode (events are emitted by the test). */
  app: ModbusApp;
  /** A fresh window against the simulating fake (`setSimulate(true)`: connecting -> polling -> data stream). */
  simApp: ModbusApp;
}

export const test = base.extend<Fixtures>({
  app: async ({ page }, use, testInfo) => {
    const app = new ModbusApp(page);
    await app.open();
    await use(app);
    noteConsole(app, testInfo);
    // An uncaught exception in the page is a defect even when the assertions passed.
    expect(app.pageErrors, "uncaught page errors").toEqual([]);
  },
  simApp: async ({ page }, use, testInfo) => {
    const app = new ModbusApp(page);
    await app.open({ sim: true });
    await use(app);
    noteConsole(app, testInfo);
    expect(app.pageErrors, "uncaught page errors").toEqual([]);
  },
});
