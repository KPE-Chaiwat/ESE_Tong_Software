// CHK-002 section J: aliases (edit, validation, follow the address, paste, clear, column, copy).
import { expect, test, type Mm, type PollSpec } from "../support/mm-fixtures";

/** A connected window with live values; poll 1 first, optionally with aliases. */
async function live(mm: Mm, specs: PollSpec[] = [{ name: "Poll 1" }]): Promise<number[]> {
  await mm.open({ polls: specs, connected: true });
  const ids = await mm.pollIds();
  await expect(mm.grid(ids[0] as number)).toHaveAttribute("data-status", "live");
  return ids;
}
const aliasCell = (mm: Mm, id: number, row: number) => mm.gridRow(id, row).locator('[data-cell="alias"]');
const editor = (mm: Mm, id: number) => mm.sub(id).getByRole("textbox", { name: /^Alias for address/ });
async function storedAliases(mm: Mm, id: number): Promise<Array<{ address: number; alias: string }>> {
  return mm.script((f, i) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === i).config.aliases, id);
}

test.describe("J alias", () => {
  test("CHK2-J1 double click, type, Enter: saved, the next row's editor opens, Esc leaves it empty; the profile is Modified", async ({ mm, page }) => {
    const [id] = (await live(mm)) as [number];
    expect(await mm.modified()).toBe(false);
    await aliasCell(mm, id, 0).dblclick();
    await expect(editor(mm, id)).toHaveAttribute("aria-label", "Alias for address 0");
    await editor(mm, id).fill("Tank top");
    await page.keyboard.press("Enter");
    await expect.poll(() => storedAliases(mm, id)).toEqual([{ address: 0, alias: "Tank top" }]);
    await expect(aliasCell(mm, id, 0)).toHaveText("Tank top");
    await expect(editor(mm, id)).toHaveAttribute("aria-label", "Alias for address 1");
    await expect(editor(mm, id)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(editor(mm, id)).toHaveCount(0);
    expect(await storedAliases(mm, id)).toEqual([{ address: 0, alias: "Tank top" }]);
    await expect(mm.profileLabel).toContainText("Modified");
  });

  test("CHK2-J2 F2 with the grid focus edits the focused row; F2 on the title bar renames the poll", async ({ mm, page }) => {
    const [id] = (await live(mm)) as [number];
    await mm.gridRow(id, 3).click();
    await page.keyboard.press("F2");
    await expect(editor(mm, id)).toHaveAttribute("aria-label", "Alias for address 3");
    await page.keyboard.press("Escape");
    await mm.titleBar(id).focus();
    await page.keyboard.press("F2");
    await expect(mm.titleBar(id).getByRole("textbox", { name: "Poll name" })).toBeFocused();
    await expect(editor(mm, id)).toHaveCount(0);
  });

  test("CHK2-J3 validation: 33 characters, a leading space, a tab; 32 characters are accepted; spaces only removes the alias", async ({ mm, page }) => {
    const [id] = (await live(mm)) as [number];
    await aliasCell(mm, id, 0).dblclick();
    const message = mm.sub(id).getByText(/^Alias /);
    await editor(mm, id).fill("x".repeat(33));
    await expect(message).toHaveText("Alias must be at most 32 characters.");
    await expect(editor(mm, id)).toHaveAttribute("aria-invalid", "true");
    await page.keyboard.press("Enter");
    await expect(editor(mm, id)).toHaveAttribute("aria-label", "Alias for address 0");
    expect(await storedAliases(mm, id), "Enter is blocked").toEqual([]);
    await editor(mm, id).fill(" a");
    await expect(message).toHaveText("Alias cannot start or end with a space.");
    await editor(mm, id).fill("a\tb");
    await expect(message).toHaveText("Alias cannot contain control characters.");
    await editor(mm, id).fill("y".repeat(32));
    await expect(message).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect.poll(() => storedAliases(mm, id)).toEqual([{ address: 0, alias: "y".repeat(32) }]);
    // Spaces only removes the alias.
    await page.keyboard.press("Escape");
    await aliasCell(mm, id, 0).dblclick();
    await editor(mm, id).fill("   ");
    await page.keyboard.press("Enter");
    await expect.poll(() => storedAliases(mm, id)).toEqual([]);
  });

  test("CHK2-J4 aliases follow the address when Start changes, and come back", async ({ mm }) => {
    const [id] = (await live(mm, [
      { name: "Poll 1", aliases: [{ address: 0, alias: "A0" }, { address: 1, alias: "A1" }, { address: 2, alias: "A2" }] },
    ])) as [number];
    await expect(aliasCell(mm, id, 0)).toHaveText("A0");
    await mm.titleButton(id, /^Poll setup/).click();
    await mm.setupField(id, "Start address").fill("1");
    await mm.setup(id).getByRole("button", { name: "Apply", exact: true }).click();
    await mm.advance(300);
    await expect(aliasCell(mm, id, 0)).toHaveText("A1");
    await expect(aliasCell(mm, id, 1)).toHaveText("A2");
    await mm.setupField(id, "Start address").fill("0");
    await mm.setup(id).getByRole("button", { name: "Apply", exact: true }).click();
    await mm.advance(300);
    await expect(aliasCell(mm, id, 0)).toHaveText("A0");
    await expect(aliasCell(mm, id, 2)).toHaveText("A2");
  });

  test("CHK2-J5 changing FC03 to FC04 keeps the aliases", async ({ mm }) => {
    const [id] = (await live(mm, [{ name: "Poll 1", aliases: [{ address: 0, alias: "A0" }] }])) as [number];
    await mm.titleButton(id, /^Poll setup/).click();
    await mm.setupField(id, "Function").selectOption("4");
    await mm.setup(id).getByRole("button", { name: "Apply", exact: true }).click();
    await mm.advance(300);
    await expect(mm.statusLine(id)).toContainText("F 04");
    await expect(aliasCell(mm, id, 0)).toHaveText("A0");
    expect(await storedAliases(mm, id)).toEqual([{ address: 0, alias: "A0" }]);
  });

  test("CHK2-J6 paste aliases: A, B, empty, C from row 8 of a 0-9 poll", async ({ mm, page }) => {
    const [id] = (await live(mm)) as [number];
    await mm.setClipboard("A\nB\n\nC");
    await mm.gridRow(id, 8).click();
    await page.keyboard.press("Control+v");
    await expect(mm.toast("Pasted 2 aliases. 2 lines were beyond the poll range.")).toBeVisible();
    await expect(aliasCell(mm, id, 8)).toHaveText("A");
    await expect(aliasCell(mm, id, 9)).toHaveText("B");
    expect(await storedAliases(mm, id)).toEqual([{ address: 8, alias: "A" }, { address: 9, alias: "B" }]);
  });

  test("CHK2-J6 a line with a control character is skipped and counted", async ({ mm, page }) => {
    const [id] = (await live(mm)) as [number];
    await mm.setClipboard("A\n\u0001x\nC");
    await mm.gridRow(id, 7).click();
    await page.keyboard.press("Control+v");
    await expect(mm.toast("Pasted 2 aliases. Skipped 1 invalid lines.")).toBeVisible();
    await expect(aliasCell(mm, id, 7)).toHaveText("A");
    await expect(aliasCell(mm, id, 8)).toHaveText("");
    await expect(aliasCell(mm, id, 9)).toHaveText("C");
  });

  test("CHK2-J7 Clear alias on three selected rows removes all three", async ({ mm }) => {
    const [id] = (await live(mm, [
      { name: "Poll 1", aliases: [{ address: 0, alias: "A0" }, { address: 1, alias: "A1" }, { address: 2, alias: "A2" }, { address: 5, alias: "A5" }] },
    ])) as [number];
    await mm.gridRow(id, 0).click();
    await mm.gridRow(id, 2).click({ modifiers: ["Shift"] });
    await mm.gridRow(id, 1).click({ button: "right" });
    await mm.page.getByRole("menuitem", { name: /^Clear alias/ }).click();
    await expect.poll(() => storedAliases(mm, id)).toEqual([{ address: 5, alias: "A5" }]);
    await expect(aliasCell(mm, id, 0)).toHaveText("");
  });

  test("CHK2-J8 'Alias column' off hides the column in that poll only, marks Modified, is saved with the profile", async ({ mm }) => {
    const [a, b] = (await live(mm, [{ name: "Poll 1" }, { name: "Poll 2" }])) as [number, number];
    await expect(mm.grid(a).getByRole("columnheader", { name: /^Alias/ })).toBeVisible();
    expect(await mm.modified()).toBe(false);
    await mm.row(a).click();
    await mm.statusLine(a).getByRole("button", { name: /^Show / }).click();
    await mm.page.getByRole("menuitemcheckbox", { name: "Alias column" }).click();
    await expect(mm.grid(a).getByRole("columnheader", { name: /^Alias/ })).toHaveCount(0);
    await expect(mm.grid(b).getByRole("columnheader", { name: /^Alias/ })).toBeVisible();
    await expect(mm.profileLabel).toContainText("Modified");
    const saved = await mm.script(async (f) => (await f.exportProfile("x", null)).polls.map((p: { display: { showAlias: boolean } }) => p.display.showAlias));
    expect(saved).toEqual([false, true]);
    // The native window (second page) of that poll shows no alias column either.
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1", display: { showAlias: false } }] });
    await expect(w2.grid.getByRole("columnheader", { name: /^Alias/ })).toHaveCount(0);
    await expect(w2.grid.getByRole("columnheader", { name: /^Address/ })).toBeVisible();
  });

  test("CHK2-J9 duplicate aliases in one poll are allowed without a message", async ({ mm, page }) => {
    const [id] = (await live(mm)) as [number];
    for (const row of [0, 1]) {
      await aliasCell(mm, id, row).dblclick();
      await editor(mm, id).fill("Same");
      await page.keyboard.press("Tab");
      await expect(editor(mm, id)).toHaveCount(0);
    }
    expect(await storedAliases(mm, id)).toEqual([{ address: 0, alias: "Same" }, { address: 1, alias: "Same" }]);
    await expect(mm.sub(id).getByText(/^Alias (must|cannot)/)).toHaveCount(0);
  });

  test("CHK2-J10 aliases survive pop out and dock", async ({ mm }) => {
    const [id] = (await live(mm, [{ name: "Poll 1", aliases: [{ address: 0, alias: "Tank top" }] }])) as [number];
    await mm.titleButton(id, /^Open in its own window/).click();
    await mm.expectCalls("popOutPoll", 1);
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1", aliases: [{ address: 0, alias: "Tank top" }] }] });
    await expect(w2.gridRow(0).locator('[data-cell="alias"]')).toHaveText("Tank top");
    await w2.toolbarButton("Dock to workspace").click();
    const dock = (await w2.calls("dockPoll"))[0] as [number, string];
    await mm.page.bringToFront();
    await mm.script((f, a) => f.dockPoll(a.id, a.h, false, null), { id, h: dock[1] });
    await expect(mm.sub(id)).toBeVisible();
    await expect(aliasCell(mm, id, 0)).toHaveText("Tank top");
  });

  test("CHK2-J (copy) 'Include alias in copy' puts the alias in the copied rows", async ({ mm, page }) => {
    const [id] = (await live(mm, [{ name: "Poll 1", aliases: [{ address: 0, alias: "Tank top" }] }])) as [number];
    await mm.gridRow(id, 0).click();
    await page.keyboard.press("Control+c");
    await expect(mm.toast(/^Copied 1 row/)).toBeVisible();
    expect(await mm.clipboardText()).not.toContain("Tank top");
    await mm.gridRow(id, 0).click({ button: "right" });
    await page.getByRole("menuitemcheckbox", { name: /^Include alias in copy/ }).click();
    await expect.poll(() => mm.script((f, i) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === i).config.display.copyAlias, id)).toBe(true);
    await mm.gridRow(id, 0).click();
    await page.keyboard.press("Control+c");
    await expect.poll(() => mm.clipboardText()).toContain("Tank top");
  });
});
