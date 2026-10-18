// CHK-002 section F: host model (workspace, own window, closed): pop out, dock, show, failures.
// The native window is a second page with its own seeded fake; Rust's routing between the two is
// replayed by the test: the handoff string of `popOutPoll` seeds the native page, and the handoff of
// the native page's `dockPoll` is given to the connection window's fake with `dockPoll`.
import type { Page } from "@playwright/test";
import { expect, LAYOUT_SEED, test, type Mm, type PollSpec } from "../support/mm-fixtures";

const POLL: PollSpec = { name: "Poll 1", qty: 40 };
const ROW = 24;

async function frames(mm: { page: Page }): Promise<void> {
  await mm.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** A connected window with one polling poll of 40 registers. Returns its id. */
async function connectedWithOne(mm: Mm, extra: Partial<PollSpec> = {}): Promise<number> {
  await mm.open({ polls: [{ ...POLL, ...extra }] });
  const [id] = (await mm.pollIds()) as [number];
  await mm.useVirtual();
  await mm.pressConnect({ autoStart: true });
  await mm.advance(500);
  await expect(mm.grid(id)).toHaveAttribute("data-status", "live");
  return id;
}

interface Handoff {
  version: number;
  setupOpen: boolean;
  selection: Array<{ start: number; end: number }>;
  anchorAddress: number | null;
  focusAddress: number | null;
  topAddress: number | null;
  pollDraft: { quantity: string; dirty: string[]; errors: Record<string, string> } | null;
}

async function popOutCall(mm: Mm): Promise<{ id: number; anchor: { kind: string; rect: { x: number; y: number; width: number; height: number } }; handoff: string; parsed: Handoff }> {
  const call = (await mm.lastCall("popOutPoll")) as [number, never, string];
  const handoff = call[2];
  return { id: call[0], anchor: call[1], handoff, parsed: JSON.parse(handoff) as Handoff };
}

test.describe("F pop out and dock", () => {
  test("CHK2-F1 pop out by button: the sub-window goes, the handoff carries selection, scroll and the invalid draft; the native window shows it all at once", async ({
    mm,
  }) => {
    const id = await connectedWithOne(mm);
    // Rows 3-5 selected, address 2 on top, Quantity "200" typed (invalid).
    await mm.gridRow(id, 3).click();
    await mm.gridRow(id, 5).click({ modifiers: ["Shift"] });
    await mm.grid(id).evaluate((el, top) => { el.scrollTop = top; }, 2 * ROW);
    await frames(mm);
    await mm.titleButton(id, /^Poll setup/).click();
    await mm.setupField(id, "Quantity").fill("200");
    await mm.setupField(id, "Quantity").blur();
    await expect(mm.setup(id)).toContainText("Quantity for FC03 must be from 1 to 125.");
    const rect = await mm.domRect(id);
    const ws = await mm.workspace.boundingBox();

    await mm.titleButton(id, /^Open in its own window/).click();
    await mm.expectCalls("popOutPoll", 1);
    await expect(mm.sub(id)).toHaveCount(0);
    await expect(mm.row(id)).toContainText("own window");
    await expect(mm.statusBar).toContainText("1 in its own window");
    const { anchor, handoff, parsed } = await popOutCall(mm);
    // The native window opens where the sub-window was (client coordinates of W1).
    expect(anchor.kind).toBe("rect");
    expect(anchor.rect).toMatchObject({ x: (ws?.x ?? 0) + rect.x, y: (ws?.y ?? 0) + rect.y, width: rect.width, height: rect.height });
    // Hook: the placement Rust holds for the native window (fake `nativePlacement`) is that rectangle.
    expect(await mm.script((f, pid) => f.nativePlacement(pid), id)).toMatchObject(anchor.rect);
    expect(parsed.selection).toEqual([{ start: 3, end: 5 }]);
    expect(parsed.topAddress).toBe(2);
    expect(parsed.pollDraft?.quantity).toBe("200");
    expect(parsed.pollDraft?.dirty).toContain("quantity");
    expect(parsed.pollDraft?.errors.quantity).toBe("Quantity for FC03 must be from 1 to 125.");

    // The native window (another page) attaches with that handoff.
    const w2 = await mm.openNative({ polls: [{ ...POLL }], handoff });
    await expect(w2.grid).toHaveAttribute("data-status", "live");
    await expect(w2.page.locator('[data-slot="poll-view"]')).not.toContainText("Waiting for first response");
    for (const row of [3, 4, 5]) await expect(w2.gridRow(row)).toHaveAttribute("aria-selected", "true");
    await expect(w2.gridRow(2)).toHaveAttribute("aria-selected", "false");
    await expect(w2.field("Quantity")).toHaveValue("200");
    await expect(w2.page.getByTestId("poll-setup")).toContainText("Quantity for FC03 must be from 1 to 125.");
  });

  test("CHK2-F1 pop out from the ⋯ menu and with Ctrl+Shift+O", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }] });
    const [a, b] = (await mm.pollIds()) as [number, number];
    await mm.row(a).click();
    await mm.statusLine(a).getByRole("button", { name: "Poll actions" }).click();
    await page.getByRole("menuitem", { name: /^Pop out to own window/ }).click();
    await mm.expectCalls("popOutPoll", 1);
    await expect(mm.sub(a)).toHaveCount(0);
    await mm.row(b).click();
    await mm.titleBar(b).focus();
    await page.keyboard.press("Control+Shift+O");
    await mm.expectCalls("popOutPoll", 2);
    await expect(mm.sub(b)).toHaveCount(0);
    expect((await mm.lastCall("popOutPoll"))?.[0]).toBe(b);
    await expect(mm.statusBar).toContainText("2 in their own windows");
  });

  test("CHK2-F2 dock back: the native window closes without S6; the sub-window returns at its rectangle with selection, scroll and draft", async ({
    mm,
  }) => {
    const id = await connectedWithOne(mm);
    await mm.gridRow(id, 3).click();
    await mm.gridRow(id, 5).click({ modifiers: ["Shift"] });
    await mm.grid(id).evaluate((el, top) => { el.scrollTop = top; }, 2 * ROW);
    await frames(mm);
    await mm.titleButton(id, /^Poll setup/).click();
    await mm.setupField(id, "Quantity").fill("200");
    await mm.setupField(id, "Quantity").blur();
    // Move it first so "its previous rectangle" is not the default slot.
    await mm.titleButton(id, /^Poll setup/).click();
    const before = await mm.domRect(id);
    await mm.titleButton(id, /^Open in its own window/).click();
    await mm.expectCalls("popOutPoll", 1);
    const out = await popOutCall(mm);
    const w2 = await mm.openNative({ polls: [{ ...POLL }], handoff: out.handoff });
    await expect(w2.grid).toHaveAttribute("data-status", "live");

    // Dock in the native window (button): the command carries the handoff; no S6.
    await w2.toolbarButton("Dock to workspace").click();
    await w2.expectCalls("dockPoll", 1);
    const dock = (await w2.calls("dockPoll"))[0] as [number, string, boolean, unknown];
    expect(dock[2], "requestHandoff is false for the window's own dock").toBe(false);
    const back = JSON.parse(dock[1]) as Handoff;
    expect(back.selection).toEqual([{ start: 3, end: 5 }]);
    expect(back.pollDraft?.quantity).toBe("200");
    await expect(w2.confirm).toHaveCount(0);
    await expect(w2.page.getByTestId("native-detached")).toBeVisible();

    // W1 receives what Rust does after the dock: the poll is a workspace poll again.
    await mm.script((f, a) => f.dockPoll(a.id, a.handoff, false, null), { id, handoff: dock[1] });
    await expect(mm.sub(id)).toBeVisible();
    await mm.expectDomRect(id, before);
    await expect(mm.sub(id)).toHaveAttribute("aria-current", "true");
    await expect(mm.row(id)).not.toContainText("own window");
    for (const row of [3, 4, 5]) await expect(mm.gridRow(id, row)).toHaveAttribute("aria-selected", "true");
    await expect(mm.grid(id)).toBeFocused();
    await mm.titleButton(id, /^Poll setup/).click();
    await expect(mm.setupField(id, "Quantity")).toHaveValue("200");
    await expect(mm.setup(id)).toContainText("Quantity for FC03 must be from 1 to 125.");
  });

  for (const withFocus of [true, false]) {
    const how = withFocus ? "rows 3-5 selected (a focused row), as in the checklist" : "no focused row (control)";
    test(`CHK2-F1 (scroll) the native window shows address 2 on top after a pop out: ${how}`, async ({ mm }) => {
      const id = await connectedWithOne(mm);
      if (withFocus) {
        await mm.gridRow(id, 3).click();
        await mm.gridRow(id, 5).click({ modifiers: ["Shift"] });
      }
      await mm.grid(id).evaluate((el, top) => { el.scrollTop = top; }, 2 * ROW);
      await frames(mm);
      await mm.titleButton(id, /^Open in its own window/).click();
      await mm.expectCalls("popOutPoll", 1);
      const { handoff, parsed } = await popOutCall(mm);
      expect(parsed.topAddress).toBe(2);
      const w2 = await mm.openNative({ polls: [{ ...POLL }], handoff });
      await expect(w2.grid).toHaveAttribute("data-status", "live");
      await frames(w2);
      await expect
        .poll(() => w2.grid.evaluate((el) => Math.round(el.scrollTop / 24)), { message: "first visible address in the native window" })
        .toBe(2);
    });

    test(`CHK2-F2 (scroll) the docked sub-window shows the address of the native window on top: ${how}`, async ({ mm }) => {
      const id = await connectedWithOne(mm);
      await mm.titleButton(id, /^Open in its own window/).click();
      await mm.expectCalls("popOutPoll", 1);
      const handoff = JSON.stringify({
        version: 1, setupOpen: false, setupOverride: false,
        selection: withFocus ? [{ start: 3, end: 5 }] : [],
        anchorAddress: withFocus ? 3 : null, focusAddress: withFocus ? 5 : null,
        topAddress: 2, columnWidths: { alias: 160, address: 120, raw: 160, scaled: 160 }, pollDraft: null, scaleDraft: null,
      });
      await mm.script((f, a) => f.dockPoll(a.id, a.handoff, false, null), { id, handoff });
      await expect(mm.grid(id)).toHaveAttribute("data-status", "live");
      await frames(mm);
      await expect
        .poll(() => mm.grid(id).evaluate((el) => Math.round(el.scrollTop / 24)), { message: "first visible address after the dock" })
        .toBe(2);
    });
  }

  test("CHK2-F2 dock with Ctrl+Shift+D in the native window", async ({ mm }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await w2.page.getByTestId("poll-setup").waitFor();
    await w2.grid.focus();
    await w2.page.keyboard.press("Control+Shift+D");
    await w2.expectCalls("dockPoll", 1);
  });

  test("CHK2-F3 five pop out / dock cycles leave state, Tx and Pause untouched and send no other command", async ({
    mm,
  }) => {
    const id = await connectedWithOne(mm, { qty: 10 });
    await mm.grid(id).click({ position: { x: 20, y: 40 } });
    await mm.page.keyboard.press("Control+p");
    await expect(mm.statusLine(id)).toContainText("Paused");
    const text = await mm.statusText(id);
    const tx = text.match(/Tx \d+/)?.[0];
    const before = (await mm.script((f) => f.calls.map((c: { method: string }) => c.method))) as string[];
    for (let i = 1; i <= 5; i++) {
      await mm.titleButton(id, /^Open in its own window/).click();
      await mm.expectCalls("popOutPoll", i);
      await expect(mm.sub(id)).toHaveCount(0);
      const out = await popOutCall(mm);
      await mm.script((f, a) => f.dockPoll(a.id, a.handoff, false, null), { id, handoff: out.handoff });
      await expect(mm.sub(id)).toBeVisible();
      await expect(mm.statusLine(id)).toContainText("Paused");
    }
    expect((await mm.statusText(id)).match(/Tx \d+/)?.[0]).toBe(tx);
    const after = (await mm.script((f) => f.calls.map((c: { method: string }) => c.method))) as string[];
    const added = after.slice(before.length).filter((m) => !["popOutPoll", "dockPoll", "attachPollView", "detachPollView", "setWorkspaceLayout"].includes(m));
    expect(added, "no command besides the host moves").toEqual([]);
    expect(await mm.callCount("setPollActive")).toBe(1);
  });

  test("CHK2-F5 a popped-out poll is never shown twice: a click in the sidebar focuses its window and no sub-window appears", async ({
    mm,
  }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }] });
    const [a] = (await mm.pollIds()) as [number, number];
    await mm.titleButton(a, /^Open in its own window/).click();
    await expect(mm.sub(a)).toHaveCount(0);
    await mm.row(a).click();
    await mm.expectCalls("showPoll", 1);
    expect(await mm.script((f) => f.focused)).toEqual([a]);
    await expect(mm.sub(a)).toHaveCount(0);
    await mm.row(a).press("Enter");
    await mm.expectCalls("showPoll", 2);
    await expect(mm.sub(a)).toHaveCount(0);
  });

  test("CHK2-F6 Show reopens a closed poll in its last host: workspace at its previous rectangle, or its own window", async ({
    mm,
  }) => {
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }],
      seed: LAYOUT_SEED,
      seedArg: { items: [{ index: 0, x: 120, y: 90, width: 560, height: 330 }, { index: 1, x: 700, y: 40 }] },
    });
    const [a, b] = (await mm.pollIds()) as [number, number];
    // Closed from the workspace -> sub-window at its previous rectangle.
    await mm.titleButton(a, /^Close/).click();
    await mm.confirm.getByRole("button", { name: "Keep poll" }).click();
    await expect(mm.sub(a)).toHaveCount(0);
    await expect(mm.row(a)).toContainText("closed");
    await mm.row(a).click();
    await expect(mm.sub(a)).toBeVisible();
    await mm.expectDomRect(a, { x: 120, y: 90, width: 560, height: 330 });
    // Closed from a native window -> its own window (the fake only moves the host).
    await mm.titleButton(b, /^Open in its own window/).click();
    await expect(mm.sub(b)).toHaveCount(0);
    await mm.script((f, id) => f.closePollView(id, true), b);
    await expect(mm.row(b)).toContainText("closed");
    await mm.row(b).click();
    await mm.expectCalls("showPoll", 2);
    await expect(mm.sub(b)).toHaveCount(0);
    await expect(mm.row(b)).toContainText("own window");
    expect(await mm.script((f) => f.focused)).toContain(b);
  });

  test("CHK2-F7 Ctrl+Shift+N in a native window asks for a new poll in a native host", async ({ mm }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await w2.grid.focus();
    await w2.page.keyboard.press("Control+Shift+N");
    await expect.poll(() => w2.callCount("addPoll")).toBeGreaterThanOrEqual(2);
    const calls = (await w2.calls("addPoll")) as Array<[{ name: string }, string]>;
    // The seed made Poll 1; the window tries "Poll 1" (taken), "Poll 2", ... as a native poll.
    expect(calls.at(-1)?.[1]).toBe("native");
    expect(calls.at(-1)?.[0].name).toBe("Poll 2");
  });

  test("CHK2-F8 pop out failure: the sub-window stays and the toast shows; dock failure: toast in the native window", async ({
    mm,
  }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    const [a] = (await mm.pollIds()) as [number];
    await mm.script((f) => f.scriptPopOutFailure("boom"));
    await mm.titleButton(a, /^Open in its own window/).click();
    await expect(mm.toast("Could not open the poll window: boom")).toBeVisible();
    await expect(mm.sub(a)).toBeVisible();
    await expect(mm.row(a)).not.toContainText("own window");
    await expect(mm.titleButton(a, /^Open in its own window/)).toBeEnabled();
    // Dock failure in a native window.
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await w2.script((f) => f.failNext("dockPoll", "boom"));
    await w2.toolbarButton("Dock to workspace").click();
    await expect(w2.toasts.filter({ hasText: "Could not dock the poll: boom" })).toBeVisible();
    await expect(w2.toolbarButton("Dock to workspace")).toBeEnabled();
  });

  test("CHK2-F9 with the Write dialog open in a sub-window pop out is unavailable (button and Ctrl+Shift+O)", async ({
    mm,
    page,
  }) => {
    const id = await connectedWithOne(mm, { qty: 10 });
    await mm.grid(id).focus();
    await page.keyboard.press("Control+e");
    await expect(mm.writeDialog).toBeVisible();
    await page.keyboard.press("Control+Shift+O");
    expect(await mm.callCount("popOutPoll")).toBe(0);
    await titleButtonBlocked(mm, id);
    expect(await mm.callCount("popOutPoll")).toBe(0);
    await expect(mm.sub(id)).toBeVisible();
  });

  test("CHK2-F10 an open alias editor is committed when valid (and appears in the native window) and reverted when invalid on pop out", async ({
    mm,
  }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }] });
    const [a, b] = (await mm.pollIds()) as [number, number];
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(500);
    // Valid text.
    await mm.row(a).click();
    await mm.gridRow(a, 0).locator('[data-cell="alias"]').dblclick();
    const editor = mm.sub(a).getByRole("textbox", { name: /^Alias for address/ });
    await expect(editor).toBeFocused();
    await editor.fill("Tank top");
    await mm.titleButton(a, /^Open in its own window/).click();
    await mm.expectCalls("popOutPoll", 1);
    const view = (await mm.calls("setPollView")).map((c) => c[1] as { aliases?: Array<{ address: number; alias: string }> });
    expect(view.some((v) => v.aliases?.some((x) => x.address === 0 && x.alias === "Tank top"))).toBe(true);
    const w2 = await mm.openNative({
      polls: [{ name: "Poll 1", aliases: [{ address: 0, alias: "Tank top" }] }],
    });
    await expect(w2.gridRow(0).locator('[data-cell="alias"]')).toHaveText("Tank top");
    // Invalid text (33 characters) is reverted.
    await mm.row(b).click();
    await mm.gridRow(b, 0).locator('[data-cell="alias"]').dblclick();
    const editorB = mm.sub(b).getByRole("textbox", { name: /^Alias for address/ });
    await editorB.fill("x".repeat(33));
    const aliasCallsBefore = (await mm.calls("setPollView")).length;
    await mm.titleButton(b, /^Open in its own window/).click();
    await mm.expectCalls("popOutPoll", 2);
    const after = (await mm.calls("setPollView")).slice(aliasCallsBefore).map((c) => c[1] as { aliases?: Array<{ alias: string }> });
    expect(after.some((v) => v.aliases?.some((x) => x.alias.length > 32))).toBe(false);
    expect((await mm.script((f, id) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === id).config.aliases, b)) as unknown[]).toEqual([]);
  });

  test("CHK2-F11 native window title, status bar and profile rename", async ({ mm }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Pump 2" }], advanceMs: 500 });
    await expect(w2.name).toHaveText("Pump 2");
    await expect.poll(async () => (await w2.windowTitles()).at(-1)).toBe("Pump 2 - Untitled - Polling");
    await expect(w2.statusBar).toHaveText(/^Last OK \d\d:\d\d:\d\d\.\d{3} · Round trip \d+ ms · Resp \d+ · Timeouts 0$/);
    await expect(w2.statusBar).not.toContainText("Tx");
    await w2.script((f) => f.setProfileName("Boiler-PLC"));
    await expect.poll(async () => (await w2.windowTitles()).at(-1)).toBe("Pump 2 - Boiler-PLC - Polling");
    await w2.script((f) => f.dropLink());
    await expect.poll(async () => (await w2.windowTitles()).at(-1)).toBe("Pump 2 - Boiler-PLC - Offline");
  });

  test("CHK2-F13 native window: no Disconnect; Ctrl+L only connects when idle or disconnected; Ctrl+Shift+M focuses W1; narrow window uses the rail", async ({
    mm,
  }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }], viewport: { width: 900, height: 700 } });
    await expect(w2.toolbar.getByRole("button", { name: /Disconnect/ })).toHaveCount(0);
    await w2.grid.focus();
    const seeded = await w2.callCount("connect");
    await w2.page.keyboard.press("Control+l");
    expect(await w2.callCount("connect"), "Ctrl+L does nothing while connected").toBe(seeded);
    await w2.script((f) => f.dropLink());
    await expect(w2.banner).toBeVisible();
    await w2.page.keyboard.press("Control+l");
    await w2.expectCalls("connect", seeded + 1);
    await w2.page.keyboard.press("Control+Shift+m");
    await w2.expectCalls("focusConnectionWindow", 1);
    // Panel at 900 px, rail below 640 px.
    await expect(w2.setupPanel).toBeVisible();
    await w2.page.setViewportSize({ width: 600, height: 700 });
    await expect(w2.rail).toBeVisible();
    await expect(w2.setupPanel).toHaveCount(0);
  });

  test("CHK2-F13 idle native window: Ctrl+L connects", async ({ mm }) => {
    // Idle again after a Disconnect in the connection window: the target is still known.
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }], connect: "idle" });
    await expect(w2.connectionPill).toContainText("Not connected");
    const seeded = await w2.callCount("connect");
    await w2.page.keyboard.press("Control+l");
    await w2.expectCalls("connect", seeded + 1);
  });
});

/** The modal blocks the pointer: a click on the title bar button must not reach it. */
async function titleButtonBlocked(mm: Mm, id: number): Promise<void> {
  const box = await mm.titleBar(id).locator('button[aria-label^="Open in its own window"]').boundingBox();
  if (!box) return;
  await mm.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
