// QA additions for CHK-010 (REPORT-031). These tests do not replace anything in chk10-format-redesign.spec.ts; they
// cover parts of an item that the frontend spec leaves out: every disabled radio (CHK10-15), the header `Format…`
// button after Disconnect (CHK10-37), the exception state after Apply (CHK10-44), Enter on a quick item and a disabled
// menu entry in the arrow order (CHK10-67), the literal dialog height at 900 x 700 (CHK10-29) and the width of the
// narrow host (CHK10-58). Browser mode with the fake IPC.
import type { Locator } from "@playwright/test";
import { expect, test } from "../support/mm-fixtures";
import {
  applyButton,
  chooseAndApply,
  expectClosed,
  formatDialog,
  type Host,
  openFromMenu,
  openHost,
  ov,
  previewNotice,
  previewRows,
  radio,
  select,
  storedOverrides,
  viewCalls,
  widthHeading,
  widthReason,
} from "../support/chk9";

const F10 = [0x4148, 0x0000, 0x0000, 0x0000, 0x4148, 0x0000, 0x00a1, 0xfffe, 0x0009, 0x000a];

async function describedBy(el: Locator): Promise<string> {
  return el.evaluate((e) =>
    (e.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" | "),
  );
}

test("CHK10-15x [QA] all six disabled radios of one row carry disabled, the heading and the reason; the ten radios share one name", async ({
  mm,
}) => {
  const h = await openHost(mm, "workspace", { values: F10 });
  await select(h, 0);
  const d = await openFromMenu(h, 0);
  const wanted = [
    ["Signed 32-bit", "32-bit · unavailable (2 registers each)", "Needs a multiple of 2 registers; 1 selected."],
    ["Unsigned 32-bit", "32-bit · unavailable (2 registers each)", "Needs a multiple of 2 registers; 1 selected."],
    ["Float 32-bit", "32-bit · unavailable (2 registers each)", "Needs a multiple of 2 registers; 1 selected."],
    ["Signed 64-bit", "64-bit · unavailable (4 registers each)", "Needs a multiple of 4 registers; 1 selected."],
    ["Unsigned 64-bit", "64-bit · unavailable (4 registers each)", "Needs a multiple of 4 registers; 1 selected."],
    ["Float 64-bit (Double)", "64-bit · unavailable (4 registers each)", "Needs a multiple of 4 registers; 1 selected."],
  ] as const;
  for (const [name, heading, reason] of wanted) {
    const el = radio(d, name);
    await expect(el, name).toHaveAttribute("disabled", "");
    const text = await describedBy(el);
    expect(text, name).toContain(heading);
    expect(text, name).toContain(reason);
  }
  const names = await d.getByRole("radio").evaluateAll((els) => new Set(els.map((e) => (e as HTMLInputElement).name)).size);
  // Format radios share one name; the order group (absent here) is another name.
  expect(names).toBe(1);
  // Every width section is a role=group named by its heading text.
  for (const bits of [16, 32, 64] as const) {
    const heading = (await widthHeading(d, bits).textContent()) ?? "";
    await expect(d.getByRole("group", { name: heading })).toBeVisible();
  }
});

test("CHK10-37h [QA] idle after Disconnect: the header Format… button opens the dialog with the notConnected notice (native host, wide header)", async ({
  mm,
}) => {
  const h = await openHost(mm, "native", { values: F10 });
  await select(h, 2, 3);
  await h.script((f) => f.disconnect());
  await expect(h.grid).toHaveCount(0);
  const button = h.page.locator('[data-slot="format-button"]');
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  const before = await h.script((f) => f.requestLog.length);
  await button.click();
  const d = formatDialog(h);
  await expect(d).toBeVisible();
  await expect(previewNotice(d)).toHaveAttribute("data-kind", "notConnected");
  await expect(previewNotice(d)).toHaveText("No preview: not connected. Connect to read values. You can apply the format now.");
  await expect(previewNotice(d).locator('svg[data-icon="plug"]')).toHaveCount(1);
  expect(await previewRows(d)).toEqual([
    ["2", "—"],
    ["3", "—"],
  ]);
  await chooseAndApply(d, "Hex");
  await expectClosed(h);
  expect(await storedOverrides(h)).toEqual([ov(2, 3, "hex")]);
  expect(await h.script((f) => f.requestLog.length)).toBe(before);
});

test("CHK10-44x [QA] exception response: Apply leaves the exception state of the poll as it was", async ({ mm }) => {
  const h = await openHost(mm, "workspace", { values: F10 });
  await h.script((f, id) => f.emitPollState(id, "exception", { exceptionCode: 2, consecutiveFailures: 1 }), h.id);
  await expect(mm.statusLine(h.id)).toContainText(/Exception|exception/);
  const stateBefore = await mm.statusText(h.id);
  await select(h, 2, 3);
  const d = await openFromMenu(h, 2);
  await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
  await chooseAndApply(d, "Hex");
  await expectClosed(h);
  expect(await storedOverrides(h)).toEqual([ov(2, 3, "hex")]);
  expect(await mm.statusText(h.id)).toBe(stateBefore);
  await expect(mm.statusLine(h.id)).toContainText(/Exception|exception/);
  expect(await mm.callCount("resumePoll")).toBe(0);
  expect(await mm.callCount("pausePoll")).toBe(0);
});

test("CHK10-67x [QA] Enter applies a quick item and closes the menu with the focus back on the row", async ({ mm }) => {
  const h = await openHost(mm, "workspace", { values: F10 });
  await select(h, 2, 3);
  await h.grid.focus();
  const focusedRow = await h.grid.getAttribute("aria-activedescendant");
  expect(focusedRow).not.toBeNull();
  await h.page.keyboard.press("Shift+F10");
  const menu = h.page.getByRole("menu").last();
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  await h.page.keyboard.press("ArrowDown");
  await h.page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: /^Hex/ })).toBeFocused();
  await h.page.keyboard.press("Enter");
  await expect(h.page.getByRole("menu")).toHaveCount(0);
  await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
  expect((await viewCalls(h))[0]?.[1]).toEqual({
    formatOverrides: [{ start: 2, end: 3, format: "hex", swapBytes: false, reverseWords: false }],
  });
  await expect(h.grid).toBeFocused();
  expect(await h.grid.getAttribute("aria-activedescendant")).toBe(focusedRow);
});

test("CHK10-67y [QA] a disabled entry stays in the arrow order and its title is readable (bit poll)", async ({ mm }) => {
  const h = await openHost(mm, "workspace", { fc: 1, qty: 8, values: [1, 0, 1, 0, 1, 0, 1, 0] });
  await select(h, 2);
  await h.grid.focus();
  await h.page.keyboard.press("Shift+F10");
  const menu = h.page.getByRole("menu").last();
  const more = menu.getByRole("menuitem", { name: "More formats…" });
  await expect(more).toHaveAttribute("aria-disabled", "true");
  // Focus lands on the first enabled entry; ArrowUp or Home reaches the disabled one.
  await h.page.keyboard.press("Home");
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
  await h.page.keyboard.press("Enter");
  await expect(formatDialog(h)).toHaveCount(0);
});

test("CHK10-29L [QA] 900 x 700: the dialog height only differs by the footer note of state U (DES-010 8); columns never change", async ({
  mm,
}, testInfo) => {
  const h = await openHost(mm, "workspace", { values: F10, viewport: { width: 900, height: 700 } });
  await h.row(0).click();
  await h.row(3).click({ modifiers: ["Shift"] });
  const d = await openFromMenu(h, 0);
  const rows: Array<{ name: string; dialog: number; message: number; columns: number }> = [];
  for (const name of ["Unsigned", "Float 32-bit", "Hex", "Float 64-bit (Double)", "Unsigned"]) {
    await radio(d, name).check();
    const m = await d.evaluate((el) => ({
      dialog: el.getBoundingClientRect().height,
      message: (el.querySelector('[data-testid="format-message-area"]') as HTMLElement).getBoundingClientRect().height,
      columns: (el.querySelector('[data-testid="format-body"] .grid') as HTMLElement).getBoundingClientRect().height,
    }));
    rows.push({ name, ...m });
  }
  await testInfo.attach("dialog-heights.json", { body: JSON.stringify(rows, null, 1), contentType: "application/json" });
  console.log(`CHK10-29L ${JSON.stringify(rows)}`);
  // The literal CHK10-29 text ("height does not change") is not met: the note "The selected rows already use this format."
  // (DES-010 8, state U) adds its own height whenever the checked format equals the current one. REPORT-031 records the
  // literal numbers (633 vs 613.5 px) and Q-010-05. What must hold under DES-010: the two columns never change, and the dialog
  // height without the message area is constant.
  expect(new Set(rows.map((r) => Math.round(r.columns))).size, "columns").toBe(1);
  expect(new Set(rows.map((r) => Math.round(r.dialog - r.message))).size, "dialog height without the message area").toBe(1);
  const withNote = rows.filter((r) => r.message > 0);
  expect(withNote.map((r) => r.name), "only state U has a footer message here").toEqual(["Unsigned", "Unsigned"]);
  await expect(applyButton(d)).toBeVisible();
});

test("CHK10-58w [QA] the host of CHK10-58 is narrow (Show menu button visible, wide header absent)", async ({ mm }, testInfo) => {
  const h = await openHost(mm, "workspace", { values: F10, formatOverrides: [ov(2, 3, "hex")] });
  const box = await mm.sub(h.id).boundingBox();
  console.log(`CHK10-58w sub-window width ${box?.width}`);
  await testInfo.attach("sub-window-width.txt", { body: String(box?.width), contentType: "text/plain" });
  await expect(mm.statusLine(h.id).getByRole("button", { name: /^Show / })).toBeVisible();
  await expect(h.page.locator('[data-slot="format-button"]')).toHaveCount(0);
});

export type { Host };

test("CHK10-74 [QA] minimum window 466 x 283, rows 2-5: groups are stacked, the body scrolls, the keyboard brings Float 64-bit (Double) into view", async ({
  mm,
}) => {
  const h = await openHost(mm, "native", { values: F10, viewport: { width: 466, height: 283 } });
  const popover = h.page.locator('[data-slot="setup-popover"]');
  if (await popover.isVisible().catch(() => false)) {
    await h.win?.rail.click();
    await expect(popover).toBeHidden();
  }
  await select(h, 2, 5);
  const d = await openFromMenu(h, 5);
  await radio(d, "Float 32-bit").check();
  const vp = h.page.viewportSize() ?? { width: 466, height: 283 };
  const x = async (id: string) => (await d.getByTestId(id).boundingBox()) ?? { x: -1, y: -1, width: 0, height: 0 };
  const order = await x("order-group");
  const preview = await x("format-preview");
  const body = await d.getByTestId("format-body").boundingBox();
  expect(Math.abs(order.x - preview.x), "order group and preview share a left edge (stacked)").toBeLessThan(2);
  expect(preview.y, "preview below the order group").toBeGreaterThan(order.y);
  const metrics = await d.getByTestId("format-body").evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight, oy: getComputedStyle(e).overflowY }));
  expect(metrics.oy).toBe("auto");
  expect(metrics.s, "the body has to scroll").toBeGreaterThan(metrics.c);
  for (const el of [
    d.getByRole("heading", { name: "Format / endian" }),
    d.getByRole("button", { name: "Close dialog" }),
    d.getByRole("button", { name: "Cancel" }),
    applyButton(d),
  ]) {
    const box = await el.boundingBox();
    expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= vp.height).toBe(true);
  }
  // Keyboard only: from Float 32-bit move down to Float 64-bit (Double).
  await radio(d, "Float 32-bit").focus();
  for (let i = 0; i < 3; i++) await h.page.keyboard.press("ArrowDown");
  const f64 = radio(d, "Float 64-bit (Double)");
  await expect(f64).toBeChecked();
  await expect(f64).toBeFocused();
  const box = await f64.boundingBox();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(body?.y ?? 0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((body?.y ?? 0) + (body?.height ?? 0) + 1);
  expect(await h.page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight)).toBe(true);
});

test("CHK10-63q [QA] edge-cut Float 64-bit fixture: which radio is checked when D1 opens (evidence for Q-010-04)", async ({ mm }, testInfo) => {
  const h = await openHost(mm, "workspace", { start: 100, qty: 4, formatOverrides: [ov(98, 105, "float64")], values: [1, 2, 3, 4] });
  await h.row(0).click();
  await h.page.keyboard.press("Control+a");
  const d = await openFromMenu(h, 0);
  const checked = await d.getByRole("radio", { checked: true }).evaluateAll((els) => els.map((e) => (e.closest("label")?.textContent ?? "").trim()));
  const rows = await h.grid.locator("[data-row]").evaluateAll((rs) => rs.map((r) => (r.textContent ?? "").trim().replace(/\s+/g, " ")));
  console.log(`CHK10-63q checked on open: ${JSON.stringify(checked)}; grid rows: ${JSON.stringify(rows)}`);
  await testInfo.attach("checked-on-open.json", { body: JSON.stringify({ checked, rows }), contentType: "application/json" });
  await expect(widthHeading(d, 64)).toHaveText("64-bit · 1 value (4 registers each)");
  // CHK10-63 says "Float 64-bit preselected": the product does that (initialChoice keeps the current format when its plan is ok).
  expect(checked[0]).toContain("Float 64-bit (Double)");
});
