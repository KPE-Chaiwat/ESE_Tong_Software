// The W1 status bar and root never wrap or scroll the page (REPORT-007 D6, DES-002 2.2.6). jsdom
// has no layout: this pins the classes; CHK2-F17 checks the real window.
import { screen } from "@testing-library/react";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;
afterEach(() => h?.rt.dispose());

const has = (el: Element, ...names: string[]) => {
  for (const name of names) expect(el.classList.contains(name), name).toBe(true);
};

describe("W1 status bar and root", () => {
  it("is one 28 px line: nowrap, the text ends in an ellipsis, the version never shrinks", async () => {
    h = await renderWindow();
    const footer = document.querySelector('[data-region="status"]') as HTMLElement;
    has(footer, "h-7", "shrink-0", "whitespace-nowrap", "overflow-hidden");
    has(screen.getByTestId("status-text"), "min-w-0", "flex-1", "truncate");
    has(await screen.findByTestId("app-version"), "shrink-0", "whitespace-nowrap");
  });

  it("the connection window root clips instead of scrolling", async () => {
    h = await renderWindow();
    const root = document.querySelector("[data-connection-state]") as HTMLElement;
    has(root, "min-h-0", "flex-1", "flex-col", "overflow-hidden");
  });
});
