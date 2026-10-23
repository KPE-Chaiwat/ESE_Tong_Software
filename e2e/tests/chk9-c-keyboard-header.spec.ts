// CHK-009 sections E (keyboard and accessibility), F (header, narrow menu, shortcuts), G (FC01/FC02), QA-030.
// Browser mode, fake IPC. Real-window ([UI-R]) parts are reported separately as BLOCKED in REPORT-030.
import type { Locator } from "@playwright/test";
import { expect, test } from "../support/mm-fixtures";
import {
  applyButton,
  chooseAndApply,
  ctrlClick,
  expectClosed,
  expectTable,
  formatDialog,
  type Host,
  messages,
  openFromKeyboard,
  openFromMenu,
  openHost,
  ov,
  radio,
  select,
  storedOverrides,
  table,
  viewCalls,
  warningLines,
  infoLines,
} from "../support/chk9";

const FORMAT_NAMES = [
  "Unsigned",
  "Signed",
  "Hex",
  "Binary",
  "Signed 32-bit",
  "Unsigned 32-bit",
  "Float 32-bit",
  "Signed 64-bit",
  "Unsigned 64-bit",
  "Float 64-bit (Double)",
];

/** The accessible label of the element that has focus inside the page. */
async function activeLabel(h: Host): Promise<string> {
  return h.page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e) return "none";
    const labelled = e.getAttribute("aria-labelledby");
    if (labelled) {
      return labelled
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
    }
    return e.getAttribute("aria-label") ?? (e.textContent ?? "").trim();
  });
}

async function insideDialog(h: Host): Promise<boolean> {
  return h.page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
}

async function gridFocusState(h: Host, rowIndex: number): Promise<{ focused: boolean; activeIsRow: boolean }> {
  const rowId = await h.row(rowIndex).getAttribute("id");
  const active = await h.grid.getAttribute("aria-activedescendant");
  const focused = await h.grid.evaluate((e) => document.activeElement === e);
  return { focused, activeIsRow: active !== null && active === rowId };
}

test.describe("E keyboard and accessibility", () => {
  for (const kind of ["workspace", "native"] as const) {
    test(`CHK9-50 [UI-B ${kind}] open from the keyboard: focus on the checked radio, dialog name, description`, async ({ mm }) => {
      const h = await openHost(mm, kind, { formatOverrides: [ov(2, 5, "float32")] });
      await select(h, 2);
      await h.grid.focus();
      await h.page.keyboard.press("Shift+F10");
      const item = h.page.getByRole("menuitem", { name: "More formats…" });
      await expect(item).toBeVisible();
      await item.focus();
      await h.page.keyboard.press("Enter");
      const d = formatDialog(h);
      await expect(d).toBeVisible();
      await expect(radio(d, "Float 32-bit")).toBeFocused();
      await expect(d).toHaveAttribute("role", "dialog");
      await expect(d).toHaveAttribute("aria-modal", "true");
      await expect(d).toHaveAccessibleName("Format / endian");
      const description = await d.evaluate((e) =>
        (e.getAttribute("aria-describedby") ?? "")
          .split(" ")
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
      expect(description).toContain(
        "Applies to the selected rows only. Changes the display, nothing is sent to the device.",
      );
      expect(description).toContain("Selected 2 registers (2-3)");
      // Opening applies nothing.
      expect(await viewCalls(h)).toHaveLength(0);
    });
  }

  test("CHK9-51 [UI-B] focus trap: Close, Format group, Order group, Preview region, Cancel, Apply, wrap; 16-bit skips the Order group", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await radio(d, "Float 32-bit").check();
    await radio(d, "Float 32-bit").focus();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await h.page.keyboard.press("Tab");
      expect(await insideDialog(h), `Tab ${i + 1} stays inside`).toBe(true);
      seen.push(await activeLabel(h));
    }
    // From Float 32-bit: Order group (checked radio), Preview region, Cancel, Apply, Close, Format group (checked).
    expect(seen).toEqual(["Big-endian", "Preview", "Cancel", "Apply", "Close dialog", "Float 32-bit"]);
    const back: string[] = [];
    for (let i = 0; i < 6; i++) {
      await h.page.keyboard.press("Shift+Tab");
      expect(await insideDialog(h), `Shift+Tab ${i + 1} stays inside`).toBe(true);
      back.push(await activeLabel(h));
    }
    expect(back).toEqual(["Close dialog", "Apply", "Cancel", "Preview", "Big-endian", "Float 32-bit"]);
    // 16-bit: the Order group is skipped.
    await radio(d, "Hex").check();
    await radio(d, "Hex").focus();
    const seen16: string[] = [];
    for (let i = 0; i < 5; i++) {
      await h.page.keyboard.press("Tab");
      expect(await insideDialog(h)).toBe(true);
      seen16.push(await activeLabel(h));
    }
    expect(seen16).toEqual(["Preview", "Cancel", "Apply", "Close dialog", "Hex"]);
  });

  test("CHK9-52 [UI-B] arrow keys check the next radio, wrap, and move within the Order group", async ({ mm }) => {
    // Four registers: every width is available (a disabled radio would be skipped, see CHK10-14).
    const h = await openHost(mm, "workspace");
    await select(h, 0, 3);
    const d = await openFromMenu(h, 0);
    await expect(radio(d, "Unsigned")).toBeFocused();
    const down: string[] = [];
    for (let i = 0; i < 10; i++) {
      await h.page.keyboard.press("ArrowDown");
      down.push(await activeLabel(h));
      await expect(radio(d, down.at(-1) ?? "")).toBeChecked();
    }
    expect(down).toEqual([...FORMAT_NAMES.slice(1), "Unsigned"]);
    const up: string[] = [];
    for (let i = 0; i < 10; i++) {
      await h.page.keyboard.press("ArrowUp");
      up.push(await activeLabel(h));
    }
    expect(up).toEqual([FORMAT_NAMES[9], FORMAT_NAMES[8], FORMAT_NAMES[7], FORMAT_NAMES[6], FORMAT_NAMES[5], FORMAT_NAMES[4], FORMAT_NAMES[3], FORMAT_NAMES[2], FORMAT_NAMES[1], FORMAT_NAMES[0]]);
    // Order group with a 32-bit format.
    await radio(d, "Float 32-bit").check();
    await radio(d, "Big-endian").focus();
    const orders: string[] = [];
    for (let i = 0; i < 4; i++) {
      await h.page.keyboard.press("ArrowDown");
      orders.push(await activeLabel(h));
    }
    expect(orders).toEqual(["Little-endian", "Big-endian byte swap", "Little-endian byte swap", "Big-endian"]);
    await expect(radio(d, "Big-endian")).toBeChecked();
  });

  test("CHK9-53 [UI-B] Enter applies, Enter on Cancel cancels, Esc cancels from anywhere, overlay click cancels", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    // Enter on a radio applies.
    await select(h, 2, 5);
    let d = await openFromMenu(h, 2);
    await radio(d, "Float 32-bit").check();
    await radio(d, "Float 32-bit").focus();
    await h.page.keyboard.press("Enter");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
    // Enter on Cancel cancels.
    await select(h, 0, 1);
    d = await openFromMenu(h, 0);
    await radio(d, "Hex").check();
    await d.getByRole("button", { name: "Cancel" }).focus();
    await h.page.keyboard.press("Enter");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
    // Esc from a radio, from Apply, from the Order group.
    for (const where of ["radio", "apply", "order"] as const) {
      await select(h, 0, 1);
      d = await openFromMenu(h, 0);
      await radio(d, "Signed 32-bit").check();
      if (where === "radio") await radio(d, "Signed 32-bit").focus();
      if (where === "apply") await applyButton(d).focus();
      if (where === "order") await radio(d, "Big-endian").focus();
      await h.page.keyboard.press("Escape");
      await expectClosed(h);
    }
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
    expect(await viewCalls(h)).toHaveLength(1);
  });

  test("CHK9-53b [UI-B] clicking the overlay cancels (no pointer use inside the dialog first)", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 0, 1);
    const d = await openFromMenu(h, 0);
    await radio(d, "Signed 32-bit").focus();
    await h.page.keyboard.press("ArrowDown");
    await h.page.mouse.click(4, 4);
    await expectClosed(h);
    expect(await viewCalls(h)).toHaveLength(0);
  });

  test("CHK9-53c [UI-B] clicking the overlay cancels right after choosing a radio with the mouse", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 0, 1);
    const d = await openFromMenu(h, 0);
    await radio(d, "Signed 32-bit").check();
    await h.page.mouse.click(4, 4);
    // Expected by DES-009 4.7: one click on the overlay is Cancel.
    await expectClosed(h);
    expect(await viewCalls(h)).toHaveLength(0);
  });

  test("CHK9-54 [UI-B] focus return after Apply and Cancel (row menu), header button and Show menu", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 7);
    let d = await openFromMenu(h, 7);
    await radio(d, "Signed").check();
    await applyButton(d).click();
    await expectClosed(h);
    await expect(h.grid).toBeFocused();
    expect(await gridFocusState(h, 7)).toEqual({ focused: true, activeIsRow: true });
    d = await openFromMenu(h, 7);
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await expect(h.grid).toBeFocused();
    expect(await gridFocusState(h, 7)).toEqual({ focused: true, activeIsRow: true });
    // Narrow Show menu: focus returns to the Show menu button.
    const show = mm.statusLine(h.id).getByRole("button", { name: /^Show / });
    await show.click();
    await h.page.getByRole("menuitem", { name: "More formats…" }).click();
    d = formatDialog(h);
    await expect(d).toBeVisible();
    await h.page.keyboard.press("Escape");
    await expectClosed(h);
    await expect(show).toBeFocused();
    // Wide header (native window): focus returns to the Format… button.
    const w = await openHost(mm, "native");
    await select(w, 2, 3);
    const fb = w.page.getByRole("button", { name: "Format…" });
    await fb.click();
    d = formatDialog(w);
    await expect(d).toBeVisible();
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(w);
    await expect(fb).toBeFocused();
  });

  test("CHK9-55 [UI-B] announcements: polite region for notes, alert for errors, Format applied announced, reasons are static text, Apply focusable", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 4);
    const d = await openFromMenu(h, 2);
    await expect(messages(d)).toHaveAttribute("aria-live", "polite");
    // D-010-01: no rounding notice. The unavailable width is static text, not inside a live region.
    expect(await infoLines(d)).toEqual(["The selected rows already use this format."]);
    expect(await warningLines(d)).toEqual([]);
    const reasonInLive = await d.getByTestId("width-reason-32").evaluate((e) => !!e.closest("[aria-live]"));
    expect(reasonInLive).toBe(false);
    await applyButton(d).focus();
    await expect(applyButton(d)).toBeFocused();
    await expect(applyButton(d)).not.toHaveAttribute("aria-disabled", "true");
    await d.getByRole("button", { name: "Cancel" }).click();
    await select(h, 2, 5);
    const d2 = await openFromMenu(h, 2);
    await chooseAndApply(d2, "Float 32-bit");
    await expectClosed(h);
    await expect
      .poll(async () => (await h.announced()).includes("Format applied: Float 32-bit, Big-endian (ABCD) to 2-5."))
      .toBe(true);
    const log = await mm.announcements();
    expect(log.find((a) => a.text.startsWith("Format applied"))?.assertive).toBe(false);
  });

  test("CHK9-56 [UI-B] never color only: icons plus text for warning, error and Incomplete; group rows named by the Format column", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { start: 100, qty: 3, formatOverrides: [ov(99, 100, "float32"), ov(102, 105, "float64")], values: [1, 2, 3] });
    await h.page.emulateMedia({ forcedColors: "active", colorScheme: "light" });
    await expectTable(h, [
      ["100", "F32 ABCD", "Incomplete"],
      ["101", "U16", "2"],
      ["102", "F64 ABCDEFGH", "Incomplete"],
    ]);
    await expect(h.grid.getByRole("img", { name: "Needs 2 registers; only 1 available." })).toHaveCount(1);
    await expect(h.grid.getByRole("img", { name: "Needs 4 registers; only 1 available." })).toHaveCount(1);
    await h.row(0).click();
    let d = await openFromMenu(h, 0);
    // Row 100 is the part of the Float 32-bit value 99-100 that the poll keeps: the dialog lists the split.
    await expect(messages(d).locator('[data-icon="triangle-alert"]')).toHaveCount(1);
    await expect(messages(d)).toContainText("Also resets 99 to Unsigned");
    await expect(messages(d).locator('[data-icon="info"]')).toHaveCount(0);
    await expect(d.getByTestId("width-reason-32").locator("svg")).toHaveCount(1);
    await d.getByRole("button", { name: "Cancel" }).click();
    await h.row(1).click();
    await h.script((f) => f.failNext("setPollView", "Boom"));
    d = await openFromMenu(h, 1);
    await radio(d, "Hex").check();
    await applyButton(d).click();
    await expect(d.getByTestId("format-error").locator('[data-icon="circle-x"]')).toHaveCount(1);
    await expect(d.getByTestId("format-error")).toContainText("Boom");
    // Nonfinite value: icon plus text.
    await d.getByRole("button", { name: "Cancel" }).click();
    const n = await openHost(mm, "workspace", { qty: 2, formatOverrides: [ov(0, 1, "float32")], values: [0x7fc0, 0] });
    await expectTable(n, [["0–1", "F32 ABCD", "NaN"]]);
    await expect(n.grid.getByRole("img", { name: /Nonfinite/ })).toHaveCount(1);
  });

  test("CHK9-57 [UI-B computed style, real window BLOCKED] Apply is lime with dark text and a 1 px border; Cancel outline; warning tint; mono numerals", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await radio(d, "Float 32-bit").check();
    const css = async (l: Locator, props: string[]) =>
      l.evaluate((e, p) => {
        const s = getComputedStyle(e);
        return Object.fromEntries(p.map((k) => [k, s.getPropertyValue(k)]));
      }, props);
    const apply = await css(applyButton(d), ["background-color", "color", "border-top-width", "border-radius"]);
    expect(apply["background-color"]).toBe("rgb(215, 242, 108)"); // #d7f26c
    expect(apply.color).toBe("rgb(49, 47, 46)"); // #312f2e
    expect(apply["border-top-width"]).toBe("1px");
    expect(Number.parseFloat(apply["border-radius"] ?? "0")).toBeGreaterThan(16);
    const cancel = await css(d.getByRole("button", { name: "Cancel" }), ["background-color", "border-top-width"]);
    expect(cancel["background-color"]).not.toBe("rgb(215, 242, 108)");
    expect(cancel["border-top-width"]).toBe("1px");
    // The checked format row has the lime selected tint and dark text; values are monospace.
    const checkedRow = d.locator("label").filter({ has: h.page.getByRole("radio", { name: "Float 32-bit", exact: true }) });
    const c = await css(checkedRow, ["background-color", "color"]);
    expect(c["background-color"]).not.toBe("rgba(0, 0, 0, 0)");
    expect(c.color).toBe("rgb(49, 47, 46)");
    for (const id of ["preview-float32", "preview-hex", "order-preview-big"]) {
      const f = await css(d.getByTestId(id), ["font-family"]);
      expect(f["font-family"]?.toLowerCase()).toMatch(/mono/);
    }
    await expect(d.getByTestId("format-summary")).toHaveText("Selected 4 registers (2-5)");
    // Nothing in the open dialog is orange. The warning tint belongs to a real warning: the
    // split of a group the poll's edge cuts.
    await expect(messages(d).locator("[data-kind=warning]")).toHaveCount(0);
    await d.getByRole("button", { name: "Cancel" }).click();
    const cutHost = await openHost(mm, "workspace", {
      start: 101,
      qty: 4,
      formatOverrides: [ov(100, 101, "float32")],
      values: [1, 2, 3, 4],
    });
    await cutHost.row(0).click();
    const d2 = await openFromMenu(cutHost, 0);
    const warnBox = messages(d2).locator("[data-kind=warning]");
    const w = await css(warnBox, ["background-color", "border-left-width", "border-left-color"]);
    expect(w["border-left-width"]).toBe("3px");
    // Orange (#fa8130) is only the border of the warning box; the icon is dark.
    expect(w["border-left-color"]).toBe("rgb(250, 129, 48)");
    const icon = await css(warnBox.locator("svg"), ["color"]);
    expect(icon.color).not.toBe("rgb(250, 129, 48)");
  });

  test("CHK9-58 [UI-B 466x283 client of a 480x320 outer window, real window BLOCKED] minimum window: groups stacked, body scrolls, buttons visible, no document scroll", async ({ mm }) => {
    // The client area of a native window at its 480 x 320 outer minimum is about 466 x 283 CSS px (CHECKPOINT round 2).
    const h = await openHost(mm, "native", { viewport: { width: 466, height: 283 } });
    // The setup panel opens as a popover over the grid at this size: collapse it with its rail.
    const popover = h.page.locator('[data-slot="setup-popover"]');
    if (await popover.isVisible().catch(() => false)) {
      await h.win?.rail.click();
      await expect(popover).toBeHidden();
    }
    await select(h, 2, 5);
    await h.page.getByRole("button", { name: "Format…" }).click().catch(async () => {
      await h.row(2).click({ button: "right" });
      await h.page.getByRole("menuitem", { name: "More formats…" }).click();
    });
    const d = formatDialog(h);
    await expect(d).toBeVisible();
    await radio(d, "Float 32-bit").check();
    const box = await d.boundingBox();
    const vp = h.page.viewportSize();
    expect(box && vp && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height).toBe(true);
    // Stacked: the order group lies below the format group.
    const fmtBox = await radio(d, "Unsigned").boundingBox();
    const ordBox = await radio(d, "Big-endian").boundingBox();
    expect(fmtBox && ordBox && ordBox.y > fmtBox.y && Math.abs(ordBox.x - fmtBox.x) < 300).toBe(true);
    const sw = await d.getByTestId("format-body").evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight }));
    expect(sw.s).toBeGreaterThan(sw.c);
    await expect(applyButton(d)).toBeInViewport({ ratio: 1 });
    await expect(d.getByRole("button", { name: "Cancel" })).toBeInViewport({ ratio: 1 });
    await expect(d.getByRole("button", { name: "Close dialog" })).toBeInViewport({ ratio: 1 });
    const doc = await h.page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(doc.sh).toBeLessThanOrEqual(doc.ch);
    expect(doc.sw).toBeLessThanOrEqual(doc.cw);
  });

  test("CHK9-59 [UI-B] mixed grid keyboard: arrows move by row, Shift selects whole groups, Home/End, Ctrl+A, F2/Enter alias", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 5, "float32")] });
    const active = async () => {
      const id = await h.grid.getAttribute("aria-activedescendant");
      return h.grid.locator(`[id="${id}"]`).getAttribute("data-row");
    };
    await h.row(1).click();
    await h.page.keyboard.press("ArrowDown");
    expect(await active()).toBe("2");
    await expect(h.row(2).locator('[data-cell="address"]')).toHaveText("2–3");
    await h.page.keyboard.press("ArrowDown");
    expect(await active()).toBe("3");
    await expect(h.row(3).locator('[data-cell="address"]')).toHaveText("4–5");
    await h.page.keyboard.press("ArrowDown");
    expect(await active()).toBe("4");
    await expect(h.row(4).locator('[data-cell="address"]')).toHaveText("6");
    // Shift+ArrowDown from row 1 selects 1-3: whole group.
    await h.row(1).click();
    await h.page.keyboard.press("Shift+ArrowDown");
    await expect(h.row(1)).toHaveAttribute("aria-selected", "true");
    await expect(h.row(2)).toHaveAttribute("aria-selected", "true");
    await expect(h.row(3)).not.toHaveAttribute("aria-selected", "true");
    await expect(h.row(0)).not.toHaveAttribute("aria-selected", "true");
    // Home / End.
    await h.page.keyboard.press("Home");
    expect(await active()).toBe("0");
    await h.page.keyboard.press("End");
    expect(await active()).toBe("7");
    // Ctrl+A selects all.
    await h.page.keyboard.press("Control+a");
    for (let i = 0; i < 8; i++) await expect(h.row(i)).toHaveAttribute("aria-selected", "true");
    // F2 on 2-3 edits the alias of address 2; Enter moves to 4-5.
    await h.row(2).click();
    await h.page.keyboard.press("F2");
    const editor = h.grid.getByRole("textbox");
    await expect(editor).toBeVisible();
    await editor.fill("Flow");
    await h.page.keyboard.press("Enter");
    await expect(h.grid.getByRole("textbox")).toBeVisible();
    await expect(h.row(3).getByRole("textbox")).toBeVisible();
    await h.page.keyboard.press("Escape");
    const aliases = await h.script((f, id) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === id).config.aliases, h.id);
    expect(aliases).toEqual([{ address: 2, alias: "Flow" }]);
  });

  test("CHK9-60 [UI-B] modal lock: shortcuts do nothing while the dialog is open", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await radio(d, "Float 32-bit").check();
    const countsBefore = {
      view: (await viewCalls(h)).length,
      pause: await mm.callCount("pausePoll"),
      popOut: await mm.callCount("popOutPoll"),
      dock: await mm.callCount("dockPoll"),
      write: await mm.callCount("write"),
    };
    for (const key of ["Control+p", "Control+1", "Control+2", "Control+3", "Control+4", "Control+b", "Control+e", "Control+Shift+O", "Control+Shift+D"]) {
      await h.page.keyboard.press(key);
    }
    await expect(d).toBeVisible();
    expect(await storedOverrides(h)).toEqual([]);
    expect({
      view: (await viewCalls(h)).length,
      pause: await mm.callCount("pausePoll"),
      popOut: await mm.callCount("popOutPoll"),
      dock: await mm.callCount("dockPoll"),
      write: await mm.callCount("write"),
    }).toEqual(countsBefore);
    await expect(mm.writeDialog).toHaveCount(0);
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await expect(h.grid.getByRole("columnheader", { name: /^Address \(0-based\)/ })).toBeVisible();
  });
});

test.describe("F header control, narrow menu and shortcuts", () => {
  test("CHK9-61 [UI-B native] header: no Raw format group, Format… pill between Show and Address, opens the dialog for the selection or the focused row", async ({ mm }) => {
    const h = await openHost(mm, "native");
    await expect(h.page.getByRole("radiogroup", { name: "Raw format" })).toHaveCount(0);
    const btn = h.page.getByRole("button", { name: "Format…" });
    await expect(btn).toBeVisible();
    await h.row(2).click();
    await expect(btn).toHaveAttribute(
      "title",
      "Set the format of the selected rows. Ctrl+1 to Ctrl+4 set a 16-bit format directly.",
    );
    const show = await h.page.getByRole("radiogroup", { name: "Show" }).boundingBox();
    const addr = await h.page.getByRole("radiogroup", { name: "Address base" }).boundingBox();
    const b = await btn.boundingBox();
    expect(show && addr && b && show.x + show.width <= b.x + 1 && b.x + b.width <= addr.x + 1).toBe(true);
    await select(h, 2, 5);
    await btn.click();
    const d = formatDialog(h);
    await expect(d.getByTestId("format-summary")).toHaveText("Selected 4 registers (2-5)");
    await d.getByRole("button", { name: "Cancel" }).click();
    // Nothing selected, row 7 focused (Ctrl+click toggles the selected row off and keeps the focus).
    await h.row(7).click();
    await ctrlClick(h, 7);
    await expect(h.row(7)).not.toHaveAttribute("aria-selected", "true");
    await btn.click();
    await expect(d.getByTestId("format-summary")).toHaveText("Selected 1 register (7)");
  });

  test("CHK9-62 [UI-B native] header disabled cases: nothing to act on, and FC01", async ({ mm }) => {
    const h = await openHost(mm, "native");
    const btn = h.page.getByRole("button", { name: "Format…" });
    await expect(btn).toHaveAttribute("aria-disabled", "true");
    await expect(btn).toHaveAttribute("title", "Select rows in the table first.");
    await btn.click({ force: true });
    await expect(formatDialog(h)).toHaveCount(0);
    const b = await openHost(mm, "native", { fc: 1, qty: 8, values: [1, 0, 1, 0, 1, 0, 1, 0] });
    const bb = b.page.getByRole("button", { name: "Format…" });
    await b.row(0).click();
    await expect(bb).toHaveAttribute("aria-disabled", "true");
    await expect(bb).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
    await bb.click({ force: true });
    await expect(formatDialog(b)).toHaveCount(0);
  });

  test("CHK9-63 [UI-B] narrow menu: Format of selected rows radio items, More formats…, no Raw format heading; Hex stores {2,3,hex}", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 3);
    await mm.statusLine(h.id).getByRole("button", { name: /^Show / }).click();
    const menu = h.page.getByRole("menu").last();
    await expect(menu.getByText("Format of selected rows")).toBeVisible();
    await expect(menu.getByText("Raw format")).toHaveCount(0);
    for (const [label, key] of [
      ["Unsigned", "Ctrl+1"],
      ["Signed", "Ctrl+2"],
      ["Hex", "Ctrl+3"],
      ["Binary", "Ctrl+4"],
    ]) {
      const item = menu.getByRole("menuitemradio", { name: `${label} ${key}` });
      await expect(item).toBeVisible();
    }
    await expect(menu.getByRole("menuitem", { name: "More formats…" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Format \/ endian/ })).toHaveCount(0);
    await menu.getByRole("menuitemradio", { name: "Hex Ctrl+3" }).click();
    await expect.poll(() => storedOverrides(h)).toEqual([ov(2, 3, "hex")]);
    // The menu button is disabled-aware: with no rows selected and no focus the items carry the title.
    const w = await openHost(mm, "workspace");
    await mm.statusLine(w.id).getByRole("button", { name: /^Show / }).click();
    const item = w.page.getByRole("menu").last().getByRole("menuitem", { name: "More formats…" });
    await expect(item).toBeDisabled();
  });

  test("CHK9-64 [UI-B] Ctrl+1..4: selected rows, focused row, no target, and a layout-independent key event", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 6, 7);
    await h.page.keyboard.press("Control+3");
    await expect.poll(() => storedOverrides(h)).toEqual([ov(6, 7, "hex")]);
    const rows = await table(h);
    expect(rows.map((r) => r.format)).toEqual(["U16", "U16", "U16", "U16", "U16", "U16", "HEX", "HEX", "U16", "U16"]);
    // Nothing selected, row 7 focused: Ctrl+2 makes row 7 Signed.
    await h.row(7).click();
    await ctrlClick(h, 7);
    await expect(h.row(7)).not.toHaveAttribute("aria-selected", "true");
    await h.page.keyboard.press("Control+2");
    await expect.poll(() => storedOverrides(h)).toEqual([ov(6, 6, "hex"), ov(7, 7, "signed")]);
    await expect(h.row(7).locator('[data-cell="raw"]')).toHaveText("-2");
    // AZERTY-like event: Ctrl + '"' on the physical Digit3 key.
    await h.row(0).click();
    await h.grid.evaluate((e) => {
      e.dispatchEvent(new KeyboardEvent("keydown", { key: '"', code: "Digit3", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await expect.poll(async () => (await storedOverrides(h)).some((o) => o.start === 0 && o.format === "hex")).toBe(true);
    // Thai-like event: a Thai character with the physical Digit4 key.
    await h.row(1).click();
    await h.grid.evaluate((e) => {
      e.dispatchEvent(new KeyboardEvent("keydown", { key: "ภ", code: "Digit4", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await expect.poll(async () => (await storedOverrides(h)).some((o) => o.start === 1 && o.format === "binary")).toBe(true);
  });

  test("CHK9-64b [UI-B] Ctrl+1..4 with no selection and no focus do nothing", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await h.grid.focus();
    for (const k of ["Control+1", "Control+2", "Control+3", "Control+4"]) await h.page.keyboard.press(k);
    expect(await viewCalls(h)).toHaveLength(0);
    expect(await storedOverrides(h)).toEqual([]);
  });

  test("CHK9-65 [UI-B] Ctrl+1 on a Float 32-bit group row makes two U16 rows", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
    await select(h, 2);
    await h.page.keyboard.press("Control+1");
    await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [] });
    const rows = await table(h);
    expect(rows.map((r) => `${r.address}:${r.format}`)).toEqual(["0:U16", "1:U16", "2:U16", "3:U16", "4:U16", "5:U16", "6:U16", "7:U16", "8:U16", "9:U16"]);
  });
});

test.describe("G FC01 and FC02", () => {
  test("CHK9-66 [UI-B] FC01 keeps overrides inert; Format disabled; back to FC03 shows them again", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 5, "float32")] });
    await mm.titleButton(h.id, /^Poll setup/).click();
    await mm.setupField(h.id, "Function").selectOption("1");
    await mm.setup(h.id).getByRole("button", { name: "Apply", exact: true }).click();
    await mm.advance(300);
    await expect(h.grid.getByRole("columnheader", { name: /^Format/ })).toHaveCount(0);
    const rows = await h.grid.locator("[data-row]").count();
    expect(rows).toBe(10);
    await expect(h.grid.locator('[data-cell="format"]')).toHaveCount(0);
    await h.row(2).click({ button: "right" });
    const item = h.page.getByRole("menuitem", { name: "More formats…" });
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
    await h.page.keyboard.press("Escape");
    await h.row(2).click();
    const before = (await viewCalls(h)).length;
    for (const k of ["Control+1", "Control+2", "Control+3", "Control+4"]) await h.page.keyboard.press(k);
    expect((await viewCalls(h)).length).toBe(before);
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
    // Back to FC03.
    if (!(await mm.setup(h.id).isVisible())) await mm.titleButton(h.id, /^Poll setup/).click();
    await mm.setupField(h.id, "Function").selectOption("3");
    await mm.setup(h.id).getByRole("button", { name: "Apply", exact: true }).click();
    await mm.advance(300);
    await expect.poll(async () => (await table(h)).filter((r) => r.format === "F32 ABCD").map((r) => r.address)).toEqual(["2–3", "4–5"]);
  });

  test("CHK9-66b [UI-B] FC02 poll shows 0/1 without a Format column", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { fc: 2, qty: 8, formatOverrides: [ov(0, 3, "float32")], values: [1, 0, 1, 0, 1, 1, 0, 0] });
    await expect(h.grid.locator('[data-cell="format"]')).toHaveCount(0);
    await expect(h.grid.getByRole("columnheader", { name: /^Format/ })).toHaveCount(0);
    expect(await h.grid.locator("[data-row]").count()).toBe(8);
  });
});

export { ctrlClick };
