import { expect, test as base } from "@playwright/test";
import { Mm } from "./mm";

export { expect };
export * from "./mm";

interface Fixtures {
  /** A multi-poll window page object. The test calls `await mm.open(...)` itself. */
  mm: Mm;
}

export const test = base.extend<Fixtures>({
  mm: async ({ page }, use, testInfo) => {
    const mm = new Mm(page);
    await use(mm);
    // Console warnings and errors are kept as annotations; an uncaught exception fails the test.
    for (const text of new Set(mm.consoleMessages)) {
      testInfo.annotations.push({ type: "console", description: text.slice(0, 300) });
    }
    testInfo.annotations.push({ type: "navigations", description: String(mm.navigations.length) });
    expect(mm.pageErrors, "uncaught page errors").toEqual([]);
    const seedError = await page
      .evaluate(() => (window.__qa as { seedError?: string } | undefined)?.seedError ?? null)
      .catch(() => null);
    expect(seedError, "seed error in the page").toBeNull();
  },
});
