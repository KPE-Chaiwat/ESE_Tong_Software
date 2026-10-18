// CHK-002 section B: poll lifecycle (new, name, rename, duplicate, delete, pause, apply).
import { expect, test, type Mm } from "../support/mm-fixtures";

const LIMIT = "A connection can have at most 16 polls.";

async function clickWorkspaceBackground(mm: Mm): Promise<void> {
  // An empty corner of the workspace: it takes the focus without activating a sub-window.
  const box = await mm.workspace.boundingBox();
  if (!box) throw new Error("workspace not rendered");
  await mm.page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
}

test.describe("B poll lifecycle", () => {
  test("CHK2-B1 New poll (button): Poll 1 at (8, 8), setup open with Name focused and selected, Paused with auto start off", async ({
    mm,
  }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: false });
    await mm.expectConnection("connected");
    await mm.toolbarButton("New poll").click();
    await expect(mm.row("Poll 1")).toBeVisible();
    const id = await mm.idOf("Poll 1");
    await expect(mm.sub(id)).toBeVisible();
    await expect(mm.sub(id)).toHaveAttribute("data-active", "true");
    // Revision 8: the default frame is 640 x 368 and a frame of 640 px opens the DOCK, not the popover.
    await mm.expectDomRect(id, { x: 8, y: 8, width: 640, height: 368 });
    await expect(mm.row(id)).toHaveAttribute("aria-selected", "true");
    await expect(mm.setup(id)).toBeVisible();
    await expect(mm.setupDock(id)).toBeVisible();
    await expect(mm.setupPopover(id)).toHaveCount(0);
    expect((await mm.setupDock(id).boundingBox())?.width).toBeCloseTo(300, 0);
    const name = mm.setupField(id, "Name");
    await expect(name).toBeFocused();
    expect(
      await name.evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length),
      "the text of Name is selected",
    ).toBe(true);
    await expect(mm.row(id)).toContainText("Paused");
    await expect(mm.statusLine(id)).toContainText("Paused");
  });

  test("CHK2-B1 Ctrl+Shift+N creates the poll too; with auto start on it polls", async ({ mm, page }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.expectConnection("connected");
    await clickWorkspaceBackground(mm);
    await page.keyboard.press("Control+Shift+N");
    await expect(mm.row("Poll 1")).toBeVisible();
    const id = await mm.idOf("Poll 1");
    await mm.expectDomRect(id, { x: 8, y: 8, width: 640, height: 368 });
    await expect(mm.setupDock(id)).toBeVisible();
    await mm.advance(300);
    await expect(mm.row(id)).toContainText("Polling");
    await expect(mm.setupField(id, "Name")).toBeFocused();
  });

  test("CHK2-B2 with Poll 1 and Poll 3, New poll gives Poll 2", async ({ mm }) => {
    await mm.open();
    await mm.addPolls([{ name: "Poll 1" }, { name: "Poll 3" }]);
    await mm.toolbarButton("New poll").click();
    await expect(mm.row("Poll 2")).toBeVisible();
    await expect(mm.pollList.getByRole("option")).toHaveCount(3);
    expect(
      await mm.script((f) => f.snapshot().polls.map((p: { config: { name: string } }) => p.config.name)),
    ).toEqual(["Poll 1", "Poll 3", "Poll 2"]);
  });

  test("CHK2-B3 16 polls: header, New poll disabled with its title, Ctrl+Shift+N shows the toast, nothing is created", async ({
    mm,
    page,
  }) => {
    await mm.open();
    await mm.addPolls(Array.from({ length: 16 }, (_, i) => ({ name: `Poll ${i + 1}` })));
    await expect(page.getByRole("heading", { name: "Polls · 16 of 16" })).toBeVisible();
    const button = mm.toolbarButton("New poll");
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", LIMIT);
    const before = await mm.callCount("addPoll");
    expect(before).toBe(16);
    await clickWorkspaceBackground(mm);
    await page.keyboard.press("Control+Shift+N");
    await expect(mm.toast(LIMIT)).toBeVisible();
    expect(await mm.callCount("addPoll"), "no poll was created").toBe(16);
    await expect(page.getByRole("heading", { name: "Polls · 16 of 16" })).toBeVisible();
  });

  test("CHK2-B4 rename with F2 on a sidebar row: messages and a valid name", async ({ mm, page }) => {
    await mm.open();
    const [tank] = await mm.addPolls([{ name: "Tank" }, { name: "Pump" }]);
    await mm.row(tank as number).focus();
    await page.keyboard.press("F2");
    const input = mm.row(tank as number).getByRole("textbox", { name: "Poll name" });
    await expect(input).toBeFocused();
    const alert = mm.row(tank as number).getByRole("alert");
    const cases: Array<[string, string]> = [
      ["Pump", 'A poll named "Pump" already exists on this connection.'],
      ["pump", 'A poll named "pump" already exists on this connection.'],
      ["", "Enter a poll name."],
      ["a".repeat(49), "Poll name must be at most 48 characters."],
      [" a", "Poll name cannot start or end with a space."],
    ];
    for (const [text, message] of cases) {
      await input.fill(text);
      await input.press("Enter");
      await expect(alert, `message for "${text}"`).toHaveText(message);
      await expect(input).toBeVisible();
    }
    await input.fill("a".repeat(48));
    await input.press("Enter");
    await expect(mm.row("a".repeat(48))).toBeVisible();
  });

  test("CHK2-B4 rename with F2 on the sub-window title bar updates sidebar, title, Window menu and traffic filter", async ({
    mm,
    page,
  }) => {
    await mm.open();
    const [tank] = await mm.addPolls([{ name: "Tank" }, { name: "Pump" }]);
    await mm.titleBar(tank as number).focus();
    await page.keyboard.press("F2");
    const input = mm.titleBar(tank as number).getByRole("textbox", { name: "Poll name" });
    await expect(input).toBeFocused();
    await input.fill("pump");
    await input.press("Enter");
    await expect(mm.titleBar(tank as number).getByRole("alert")).toHaveText(
      'A poll named "pump" already exists on this connection.',
    );
    await input.fill("Boiler 7");
    await input.press("Enter");
    await expect(mm.titleBar(tank as number)).toContainText("Boiler 7");
    await expect(mm.row(tank as number)).toContainText("Boiler 7");
    await expect(mm.sub(tank as number)).toHaveAttribute("aria-label", /^Boiler 7, /);
    await mm.openMenu("Window");
    await expect(mm.page.getByRole("menuitemcheckbox", { name: /^1 Boiler 7/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await mm.page.keyboard.press("Control+j");
    await expect(mm.traffic).toBeVisible();
    await expect(mm.traffic.getByRole("combobox", { name: "Traffic filter" }).locator("option", { hasText: "Boiler 7" })).toHaveCount(1);
  });

  // CHK2-B5 (revision 8): a duplicate follows the new-poll rule, not the state of its source.
  async function duplicateTank(mm: Mm, copy = "Tank copy 2"): Promise<void> {
    await mm.row("Tank").hover();
    await mm.row("Tank").getByRole("button", { name: "Actions for Tank" }).click();
    await mm.page.getByRole("menuitem", { name: /^Duplicate/ }).click();
    await expect(mm.row(copy)).toBeVisible();
  }
  async function setAutoStart(mm: Mm, on: boolean): Promise<void> {
    await mm.openMenu("Connection");
    const item = mm.menuItem("Start polling when connected", "menuitemcheckbox");
    if ((await item.getAttribute("aria-checked")) === String(on)) await mm.page.keyboard.press("Escape");
    else await item.click();
    await mm.openMenu("Connection");
    await expect(mm.menuItem("Start polling when connected", "menuitemcheckbox")).toHaveAttribute(
      "aria-checked",
      String(on),
    );
    await mm.page.keyboard.press("Escape");
  }

  test("CHK2-B5 Duplicate Tank with 'Tank copy' present gives 'Tank copy 2' right after Tank, same host kind", async ({
    mm,
  }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: false });
    await mm.addPolls([{ name: "Tank" }, { name: "Pump" }, { name: "Tank copy" }]);
    await duplicateTank(mm);
    const names = await mm.script((f) =>
      f.snapshot().polls.map((p: { config: { name: string }; host: string }) => `${p.config.name}|${p.host}`),
    );
    expect(names).toEqual(["Tank|workspace", "Tank copy 2|workspace", "Pump|workspace", "Tank copy|workspace"]);
    await expect(mm.sub("Tank copy 2")).toBeVisible();
  });

  test("CHK2-B5 connected, 'Start polling when connected' OFF, Tank Polling: the copy is Paused", async ({ mm }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.addPolls([{ name: "Tank" }]);
    await mm.advance(500);
    await expect(mm.row("Tank")).toContainText("Live");
    await setAutoStart(mm, false);
    await duplicateTank(mm, "Tank copy");
    await mm.advance(500);
    await expect(mm.row("Tank copy")).toContainText("Paused");
    await expect(mm.statusLine("Tank copy")).toContainText("Paused");
    await expect(mm.statusLine("Tank")).toContainText("Polling");
  });

  test("CHK2-B5 connected, 'Start polling when connected' ON, Tank Polling: the copy shows Waiting… then Polling", async ({
    mm,
  }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.addPolls([{ name: "Tank" }]);
    await mm.advance(500);
    await duplicateTank(mm, "Tank copy");
    await expect(mm.statusLine("Tank copy")).toContainText("Waiting…");
    await expect(mm.row("Tank copy")).toContainText("Waiting");
    await mm.advance(500);
    await expect(mm.statusLine("Tank copy")).toContainText("Polling");
    await expect(mm.row("Tank copy")).toContainText("Live");
  });

  test("CHK2-B5 connected, ON, Tank Paused: the copy polls", async ({ mm }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.addPolls([{ name: "Tank" }]);
    await mm.advance(500);
    await mm.row("Tank").click();
    await mm.page.keyboard.press("Control+p");
    await expect(mm.statusLine("Tank")).toContainText("Paused");
    await duplicateTank(mm, "Tank copy");
    await mm.advance(500);
    await expect(mm.statusLine("Tank copy")).toContainText("Polling");
    await expect(mm.statusLine("Tank")).toContainText("Paused");
  });

  test("CHK2-B5 not connected (idle), Tank Offline: the copy is Offline whatever the checkbox", async ({ mm }) => {
    await mm.open();
    await mm.addPolls([{ name: "Tank" }]);
    for (const on of [true, false]) {
      await mm.autoStart.setChecked(on);
      const copy = on ? "Tank copy" : "Tank copy 2";
      await duplicateTank(mm, copy);
      await expect(mm.row(copy)).toContainText("Offline");
      await expect(mm.statusLine(copy)).toContainText("Offline");
    }
  });

  test("CHK2-B6 Delete: confirm text, default focus Cancel, removes row and sub-window; other polls keep their pace", async ({
    mm,
    page,
  }) => {
    await mm.open();
    const [a, b, c] = await mm.addPolls([
      { name: "Poll 1", scan: 100 },
      { name: "Poll 2", scan: 100 },
      { name: "Poll 3", scan: 100 },
    ]);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(1000);
    await mm.row(b as number).focus();
    await page.keyboard.press("Delete");
    const dialog = mm.confirm;
    await expect(dialog).toContainText("Delete poll?");
    await expect(dialog).toContainText(
      'Delete "Poll 2"? Its window closes and its settings are removed from this connection.',
    );
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(mm.row(b as number)).toBeVisible();
    // Again, from the row menu, and confirm.
    await mm.row(b as number).hover();
    await mm.row(b as number).getByRole("button", { name: "Actions for Poll 2" }).click();
    await page.getByRole("menuitem", { name: /^Delete/ }).click();
    await expect(mm.confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await mm.confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(mm.row(b as number)).toHaveCount(0);
    await expect(mm.sub(b as number)).toHaveCount(0);
    await mm.advance(1000);
    // No gap longer than two scan periods for the polls that stayed (the model's request log).
    const log = (await mm.script((f) => JSON.parse(JSON.stringify(f.requestLog)))) as Array<{
      pollId: number;
      start: number;
    }>;
    for (const id of [a, c] as number[]) {
      const starts = log.filter((r) => r.pollId === id).map((r) => r.start);
      const gaps = starts.slice(1).map((s, i) => s - (starts[i] as number));
      expect(Math.max(...gaps), `largest gap of poll ${id}`).toBeLessThanOrEqual(200);
    }
    await expect(mm.statusLine(a as number)).toContainText("Polling");
  });

  test("CHK2-B7 Ctrl+P in a sub-window pauses only that poll; again resumes", async ({ mm, page }) => {
    await mm.open();
    const [p1, p2] = await mm.addPolls([{ name: "Poll 1" }, { name: "Poll 2" }]);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(500);
    const tx = async (id: number) => (await mm.statusText(id)).match(/Tx (\d+)/)?.[1];
    // P2 is in front and overlaps P1: the sidebar row activates P1 and moves the focus into its grid.
    await mm.row(p1 as number).click();
    await expect(mm.grid(p1 as number)).toBeFocused();
    await page.keyboard.press("Control+p");
    await expect(mm.statusLine(p1 as number)).toContainText("Paused");
    await expect(mm.row(p1 as number)).toContainText("Paused");
    const frozen = await tx(p1 as number);
    const other = await tx(p2 as number);
    await mm.advance(1000);
    await expect.poll(() => tx(p2 as number)).not.toBe(other);
    expect(await tx(p1 as number)).toBe(frozen);
    await expect(mm.statusLine(p2 as number)).toContainText("Polling");
    await page.keyboard.press("Control+p");
    await expect(mm.statusLine(p1 as number)).not.toContainText("Paused");
    await mm.advance(500);
    await expect(mm.statusLine(p1 as number)).toContainText("Polling");
  });

  test("CHK2-B8 Ctrl+Shift+P pauses all, again resumes all; the toolbar button follows", async ({ mm, page }) => {
    await mm.open();
    const ids = await mm.addPolls([{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }]);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(500);
    await expect(mm.toolbarButton("Pause all")).toBeVisible();
    await clickWorkspaceBackground(mm);
    await page.keyboard.press("Control+Shift+P");
    for (const id of ids) await expect(mm.row(id)).toContainText("Paused");
    await expect(mm.toolbarButton("Resume all")).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await mm.advance(300);
    for (const id of ids) await expect(mm.row(id)).toContainText("Polling");
    await expect(mm.toolbarButton("Pause all")).toBeVisible();
    // The toolbar button does the same.
    await mm.toolbarButton("Pause all").click();
    for (const id of ids) await expect(mm.row(id)).toContainText("Paused");
    await mm.toolbarButton("Resume all").click();
    await mm.advance(300);
    for (const id of ids) await expect(mm.row(id)).toContainText("Polling");
  });

  test("CHK2-B9 Apply with Quantity 10 -> 20 restarts only that poll; the others do not flicker", async ({ mm }) => {
    await mm.open();
    const [p1, p2, p3] = await mm.addPolls([{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }]);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(500);
    await expect(mm.grid(p1 as number)).toHaveAttribute("data-status", "live");
    // Record every `data-status` value and state the other polls pass through from now on.
    await mm.page.evaluate((ids) => {
      const seen: string[] = [];
      (window as unknown as { __seen: string[] }).__seen = seen;
      for (const id of ids) {
        const frame = document.querySelector(`[data-subwindow="${id}"]`);
        if (!frame) continue;
        new MutationObserver((records) => {
          for (const r of records) {
            const el = r.target as HTMLElement;
            if (r.attributeName) seen.push(`${id}:${r.attributeName}=${el.getAttribute(r.attributeName)}`);
          }
        }).observe(frame, { subtree: true, attributes: true, attributeFilter: ["data-status", "data-state"] });
      }
    }, [p2, p3]);
    await mm.titleButton(p1 as number, /^Poll setup/).click();
    const qty = mm.setupField(p1 as number, "Quantity");
    await qty.fill("20");
    await mm.setup(p1 as number).getByRole("button", { name: "Apply", exact: true }).click();
    await expect(mm.statusLine(p1 as number)).toContainText("Waiting");
    await expect(mm.sub(p1 as number)).toContainText("Waiting for first response…");
    expect(await mm.callCount("updatePoll")).toBe(1);
    expect((await mm.lastCall("updatePoll"))?.[0]).toBe(p1);
    await mm.advance(500);
    await expect(mm.statusLine(p1 as number)).toContainText("Polling");
    await expect(mm.grid(p1 as number)).toHaveAttribute("aria-rowcount", "21");
    const seen = await mm.page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    expect(seen.filter((s) => /loading|waiting/i.test(s)), `the other polls never reload: ${seen.join(", ")}`).toEqual([]);
  });

  test("CHK2-B10 Apply on a paused poll sends no request and shows 'Poll settings changed.'", async ({ mm }) => {
    await mm.open();
    const [p1] = await mm.addPolls([{ name: "Poll 1" }, { name: "Poll 2" }]);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: false });
    await mm.expectConnection("connected");
    await expect(mm.statusLine(p1 as number)).toContainText("Paused");
    await mm.titleButton(p1 as number, /^Poll setup/).click();
    await mm.setupField(p1 as number, "Start address").fill("5");
    await mm.setup(p1 as number).getByRole("button", { name: "Apply", exact: true }).click();
    await expect(mm.sub(p1 as number)).toContainText(
      "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.",
    );
    await mm.advance(1000);
    const requests = await mm.script((f, id) => f.requestLog.filter((r: { pollId: number }) => r.pollId === id).length, p1 as number);
    expect(requests, "no request for the paused poll").toBe(0);
    await expect(mm.statusLine(p1 as number)).toContainText("Paused");
  });
});
