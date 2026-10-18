import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The page is exactly the window and never shows a document scrollbar (REPORT-007 D6).
describe("styles.css base layer", () => {
  const css = readFileSync(resolve(import.meta.dirname, "styles.css"), "utf8");
  const rule = /html,\s*body,\s*#root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("html, body and #root are the viewport height and clip", () => {
    expect(rule).toMatch(/height:\s*100%/);
    expect(rule).toMatch(/overflow:\s*hidden/);
  });
});
