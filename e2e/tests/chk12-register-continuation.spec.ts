import { expect, test } from "../support/mm-fixtures";
import { applyButton, openFromMenu, openHost, radio, select, storedOverrides, summary } from "../support/chk9";

for (const kind of ["workspace", "native"] as const) {
  test(`CHK12 [UI-B ${kind}] combined values keep every register row with continuations`, async ({ mm }) => {
    const h = await openHost(mm, kind, {
      values: [100, 200, 1, 2, 3, 4],
      qty: 6,
      formatOverrides: [
        { start: 0, end: 1, format: "unsigned32", swapBytes: false, reverseWords: false },
        { start: 2, end: 5, format: "unsigned64", swapBytes: false, reverseWords: false },
      ],
    });
    await expect(h.grid).toHaveAttribute("aria-rowcount", "7");
    await expect(h.row(0).locator('[data-cell="address"]')).toHaveText("0");
    await expect(h.row(0).locator('[data-cell="raw"]')).toContainText("6553800");
    await expect(h.row(1).locator('[data-cell="address"]')).toHaveText("1");
    await expect(h.row(1).locator('[data-cell="raw"]')).toHaveText("--");
    for (const i of [3, 4, 5]) {
      await expect(h.row(i)).toHaveAttribute("data-row-kind", "continuation");
      await expect(h.row(i).locator('[data-cell="raw"]')).toHaveText("--");
    }
    await select(h, 1);
    await expect(h.row(0)).toHaveAttribute("aria-selected", "true");
    await expect(h.row(1)).toHaveAttribute("aria-selected", "true");
    await expect(h.grid).toHaveAttribute("aria-activedescendant", /-row-0$/);
    await h.row(1).click({ button: "right" });
    await expect(h.page.getByRole("menuitem", { name: "Set colors for register 1…" })).toBeVisible();
    await h.page.keyboard.press("Escape");
    const d = await openFromMenu(h, 1);
    await expect(summary(d)).toHaveText("Selected 2 registers (0-1)");
    await expect(radio(d, "Unsigned 32-bit")).toBeChecked();
    await radio(d, "Signed 32-bit").check();
    await applyButton(d).click();
    expect(await storedOverrides(h)).toMatchObject([
      { start: 0, end: 1, format: "signed32" },
      { start: 2, end: 5, format: "unsigned64" },
    ]);
    await expect(h.row(1).locator('[data-cell="raw"]')).toHaveText("--");
  });
}

test("CHK12-06 [UI-B workspace] 125 registers remain individually addressable after virtual scroll", async ({ mm }) => {
  const h = await openHost(mm, "workspace", {
    qty: 125,
    values: Array.from({ length: 125 }, (_, i) => i),
    formatOverrides: [{ start: 120, end: 123, format: "unsigned64", swapBytes: false, reverseWords: false }],
  });
  await expect(h.grid).toHaveAttribute("aria-rowcount", "126");
  await h.grid.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(h.row(124).locator('[data-cell="address"]')).toHaveText("124");
  await expect(h.row(123).locator('[data-cell="raw"]')).toHaveText("--");
  await expect(h.row(124)).toHaveAttribute("aria-rowindex", "126");
});
