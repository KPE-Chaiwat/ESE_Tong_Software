// CHK-010 (REPORT-031): the [UI-R] and [SIM] items of the redesigned Format dialog D1 and the Value format section of the row menu,
// in the REAL app (WebView2 over CDP) against the simulator. No fake IPC. Item ids are in the test titles; facts and screenshots
// are written to e2e/test-results/evidence/chk10/.
import { expect, test } from "../integration/fixtures";
import { Evidence, popOut, setClientCss, setF10, toMinimum } from "../integration/chk10";
import { RealMm } from "../integration/real-mm";
import { esc } from "../support/mm";
import { chooseAndApply, previewNotice, previewRows, previewSummary, radio, summary } from "../support/chk9";
import type { Locator, Page } from "@playwright/test";

class Fmm extends RealMm {
  override get pollList() {
    return this.page.getByRole("list", { name: "Polls", exact: true });
  }
  override row(who: number | string) {
    return typeof who === "number"
      ? this.pollList.locator(`[data-poll-id="${who}"]`)
      : this.pollList.getByRole("listitem", { name: new RegExp(`^${esc(who)}, `) });
  }
}

const dlg = (page: Page): Locator => page.getByRole("dialog", { name: "Format / endian" });

async function selectRows(row: (i: number) => Locator, a: number, b = a): Promise<void> {
  await row(a).click();
  if (b !== a) await row(b).click({ modifiers: ["Shift"] });
}

async function openFromRowMenu(page: Page, row: Locator): Promise<Locator> {
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "More formats…" }).click();
  const d = dlg(page);
  await expect(d).toBeVisible();
  return d;
}

/** Opens D1 without a grid (kept selection): the header Format… button when the layout has it, else the Show menu. */
async function openKept(page: Page, statusLine: Locator): Promise<Locator> {
  const header = page.locator('[data-slot="format-button"]');
  if (await header.isVisible().catch(() => false)) await header.click();
  else {
    await statusLine.getByRole("button", { name: /^Show / }).click();
    await page.getByRole("menuitem", { name: "More formats…" }).click();
  }
  const d = dlg(page);
  await expect(d).toBeVisible();
  return d;
}

test("CHK10 W1+SIM: preview equals grid, no extra frames, data states with the simulator, quick formats", async ({ mm: base, sim, desktop }, testInfo) => {
  test.setTimeout(300_000);
  const ev = new Evidence("w1-sim");
  const mm = new Fmm(base.page);
  const page = mm.page;
  await setF10(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 400 });
  const id = await mm.addPollUi({ name: "F10", qty: 10, scan: 100 });
  const state = () => mm.statusLine(id).getAttribute("data-state");
  await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  await expect(mm.gridRow(id, 0)).toBeVisible();
  const row = (i: number) => mm.gridRow(id, i);
  ev.set("subWindowWidthCss", await mm.sub(id).evaluate((e) => Math.round(e.getBoundingClientRect().width)));
  ev.set("headerFormatButtonVisible", await page.locator('[data-slot="format-button"]').isVisible().catch(() => false));
  await mm.expandTraffic();

  // ---- CHK10-31 live preview, both orders ----
  await test.step("CHK10-31", async () => {
    await selectRows(row, 0, 3);
    const d = await openFromRowMenu(page, row(0));
    await expect(summary(d)).toHaveText("Selected 4 registers (0-3)");
    await radio(d, "Float 32-bit").check();
    await expect(previewSummary(d)).toHaveText("2 Float 32-bit values, Big-endian (ABCD)");
    await expect.poll(() => previewRows(d)).toEqual([["0-1", "12.5"], ["2-3", "0"]]);
    ev.set("c31_be_rows", await previewRows(d));
    const fam = await d.getByTestId("format-preview-row").first().locator("td").first().evaluate((e) => getComputedStyle(e).fontFamily);
    ev.set("c31_preview_font", fam);
    expect(fam.toLowerCase()).toContain("jetbrains mono");
    await radio(d, "Little-endian byte swap").check();
    await expect(previewSummary(d)).toHaveText("2 Float 32-bit values, Little-endian byte swap (CDAB)");
    const rows = await previewRows(d);
    ev.set("c31_lebs_rows", rows);
    expect(rows[0]?.[0]).toBe("0-1");
    expect(rows[0]?.[1]).toMatch(/^2\.3\d*e-41$/);
    expect(rows[1]).toEqual(["2-3", "0"]);
    await ev.shot(page, "c31-dialog", d);

    // ---- CHK10-32 no request while switching every format and order ----
    const mark = sim.mark();
    const totals0 = await mm.totals();
    const t0 = Date.now();
    const formats = ["Unsigned", "Signed", "Hex", "Binary", "Signed 32-bit", "Unsigned 32-bit", "Float 32-bit", "Signed 64-bit", "Unsigned 64-bit", "Float 64-bit (Double)"];
    const orders = ["Big-endian", "Little-endian", "Big-endian byte swap", "Little-endian byte swap"];
    for (const f of formats) {
      await radio(d, f).check();
      if (/32|64/.test(f)) for (const o of orders) await radio(d, o).check();
    }
    const elapsed = Date.now() - t0;
    const req = sim.requestsDecoded(mark);
    const sigs = new Set(req.map((r) => `${r.unit}:${r.fc}@${r.addr}x${r.arg}`));
    const totals1 = await mm.totals();
    ev.set("c32", { elapsedMs: elapsed, simRequests: req.length, distinctSignatures: [...sigs], counterDeltaRequests: totals1.requests - totals0.requests, errorsDelta: totals1.errors - totals0.errors });
    expect([...sigs], "only the scan request of the poll appears").toEqual(["1:3@0x10"]);
    expect(req.length, "no more requests than the scan rate allows").toBeLessThanOrEqual(Math.floor(elapsed / 90) + 2);
    expect(totals1.errors - totals0.errors).toBe(0);
    expect(Math.abs(totals1.requests - totals0.requests - req.length), "UI counter equals simulator count").toBeLessThanOrEqual(2);
    await radio(d, "Float 32-bit").check();
    await radio(d, "Little-endian byte swap").check();

    // ---- CHK10-33 preview equals the grid after Apply ----
    const shown = await previewRows(d);
    await d.getByRole("button", { name: /^Apply/ }).click();
    await expect(d).toHaveCount(0);
    await expect.poll(async () => [await row(0).locator('[role="gridcell"]').allInnerTexts(), await row(1).locator('[role="gridcell"]').allInnerTexts()]).toBeTruthy();
    const cells0 = await row(0).locator('[role="gridcell"]').allInnerTexts();
    const cells1 = await row(1).locator('[role="gridcell"]').allInnerTexts();
    ev.set("c33_grid_rows_after_apply", [cells0, cells1]);
    expect(cells0.join(" | ")).toContain("0–1");
    expect(cells0.join(" | ")).toContain(shown[0]?.[1] ?? "?");
    expect(cells1.join(" | ")).toContain("2–3");
    expect(cells1.join(" | ")).toContain(shown[1]?.[1] ?? "?");
    // Unsigned 32-bit
    await selectRows(row, 0);
    const d2 = await openFromRowMenu(page, row(0));
    await radio(d2, "Unsigned 32-bit").check();
    await radio(d2, "Little-endian byte swap").check();
    await expect.poll(() => previewRows(d2)).toEqual([["0-1", "16712"]]);
    await radio(d2, "Big-endian").check();
    await expect.poll(() => previewRows(d2)).toEqual([["0-1", "1095237632"]]);
    await d2.getByRole("button", { name: /^Apply/ }).click();
    await expect(d2).toHaveCount(0);
    const cells = (await row(0).locator('[role="gridcell"]').allInnerTexts()).join(" | ");
    ev.set("c33_grid_u32_be", cells);
    expect(cells).toContain("1095237632");
    // Back to Unsigned on every row (Ctrl+A, Ctrl+1) so that grid row i is register i again.
    await mm.grid(id).focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+1");
    await expect(row(9)).toBeVisible();
    await expect(mm.grid(id).locator("[data-row]")).toHaveCount(10);
  });

  // ---- CHK10-41 live value update while D1 is open ----
  await test.step("CHK10-41", async () => {
    await selectRows(row, 4, 5);
    const d = await openFromRowMenu(page, row(4));
    await expect(previewNotice(d)).toHaveCount(0);
    await expect.poll(async () => (await previewRows(d))[0]).toEqual(["4", "16712"]);
    await sim.ctlOk("set holding 4 7");
    await expect.poll(async () => (await previewRows(d))[0], { message: "register 4 written by another master" }).toEqual(["4", "7"]);
    await expect(previewNotice(d)).toHaveCount(0);
    ev.set("c41", { rowsAfterWrite: await previewRows(d) });
    await d.getByRole("button", { name: "Cancel" }).click();
    await sim.ctlOk("set holding 4 16712");
  });

  // ---- CHK10-50 quick Hex: no dialog, one request-free change, profile modified ----
  await test.step("CHK10-50 traffic", async () => {
    await selectRows(row, 2, 3);
    const mark = sim.mark();
    await row(2).click({ button: "right" });
    const menu = page.getByRole("menu").last();
    await menu.getByRole("menuitemradio", { name: /^Hex/ }).click();
    await expect(dlg(page)).toHaveCount(0);
    await expect(row(2)).toContainText("HEX");
    await expect(row(2)).toContainText("0x0000");
    await expect(row(3)).toContainText("0x0000");
    ev.set("c50_modified_label", await mm.profileLabel.innerText());
    const reqs = sim.requestsDecoded(mark);
    const sigs = [...new Set(reqs.map((r) => `${r.unit}:${r.fc}@${r.addr}x${r.arg}`))];
    ev.set("c50_frames_after_quick_hex", { requests: reqs.length, signatures: sigs });
    expect(sigs.filter((x) => x !== "1:3@0x10"), "no frame other than the scan request").toEqual([]);
    expect(await mm.profileLabel.innerText()).toMatch(/Modified/);
    const titles = desktop.windows().map((w) => w.title);
    ev.set("c50_window_titles", titles);
    expect(
      titles.some((t) => t.includes("Untitled *")),
      "the window title gets ' *'",
    ).toBe(true);
  });

  // ---- CHK10-42 paused ----
  await test.step("CHK10-42 paused", async () => {
    await selectRows(row, 2, 3);
    await mm.grid(id).focus();
    await page.keyboard.press("Control+p");
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "paused");
    const mark = sim.mark();
    const d = await openFromRowMenu(page, row(2));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
    await expect(previewNotice(d)).toHaveText("Preview uses the last values received (stale).");
    await expect(previewNotice(d).locator('svg[data-icon="clock"]')).toHaveCount(1);
    ev.set("c42_stale_rows", await previewRows(d));
    for (const f of ["Signed", "Binary", "Unsigned"]) await radio(d, f).check();
    await chooseAndApply(d, "Binary");
    await expect(d).toHaveCount(0);
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "paused");
    ev.set("c42_frames_while_paused", sim.requestsDecoded(mark).length);
    expect(sim.requestsDecoded(mark), "paused: Apply and the switches send nothing and do not resume").toHaveLength(0);
    await mm.grid(id).focus();
    await page.keyboard.press("Control+p");
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  });

  // ---- CHK10-43 timeout, retained values ----
  await test.step("CHK10-43 timeout with values", async () => {
    await sim.ctlOk("fault drop");
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "timeout", { timeout: 15_000 });
    await selectRows(row, 2, 3);
    const d = await openFromRowMenu(page, row(2));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
    await expect(previewNotice(d)).toHaveText("Preview uses the last values received (stale).");
    ev.set("c43_stale_rows", await previewRows(d));
    await d.getByRole("button", { name: "Cancel" }).click();
    await sim.ctlOk("clear");
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling", { timeout: 15_000 });
  });

  // ---- CHK10-44 exception with values; Apply leaves the exception state ----
  await test.step("CHK10-44 exception with values", async () => {
    await sim.ctlOk("fault exception 2");
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "exception", { timeout: 15_000 });
    await selectRows(row, 2, 3);
    const d = await openFromRowMenu(page, row(2));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
    ev.set("c44_stale_rows", await previewRows(d));
    await chooseAndApply(d, "Hex");
    await expect(d).toHaveCount(0);
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "exception");
    ev.set("c44_state_after_apply", await state());
    await sim.ctlOk("clear");
    await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling", { timeout: 15_000 });
  });

  // ---- CHK10-45 link lost with values ----
  await test.step("CHK10-45 link lost with values", async () => {
    await selectRows(row, 2, 3);
    await sim.ctlOk("stop");
    await expect(mm.pill).not.toContainText("Connected", { timeout: 20_000 });
    ev.set("c45_pill_after_stop", await mm.pill.innerText());
    const rowVisible = await row(2).isVisible().catch(() => false);
    ev.set("c45_grid_visible_after_link_loss", rowVisible);
    const d = rowVisible ? await openFromRowMenu(page, row(2)) : await openKept(page, mm.statusLine(id));
    ev.set("c45_kind_with_values", await previewNotice(d).getAttribute("data-kind"));
    ev.set("c45_rows", await previewRows(d));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
    await d.getByRole("button", { name: "Cancel" }).click();
    await sim.ctlOk("resume");
  });

  ev.save();
  void testInfo;
});

test("CHK10 W1+SIM no-values states: notConnected, failed (timeout, exception), paused, waiting, connectionLost", async ({ mm: base, sim }) => {
  test.setTimeout(300_000);
  const ev = new Evidence("w1-sim-novalues");
  const mm = new Fmm(base.page);
  const page = mm.page;
  await setF10(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 400 });
  const id = await mm.addPollUi({ name: "F10", qty: 10, scan: 100 });
  await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  await expect(mm.gridRow(id, 0)).toBeVisible();
  const row = (i: number) => mm.gridRow(id, i);
  await selectRows(row, 2, 3);
  const bar = mm.statusLine(id);

  async function reopen(): Promise<Locator> {
    const d = await openKept(page, bar);
    return d;
  }

  // CHK10-37 idle (after the user's Disconnect), no frame on Apply
  await test.step("CHK10-37 idle", async () => {
    await mm.toolbarButton("Disconnect").click();
    await expect(mm.pill).toContainText(/Disconnected|Not connected|Idle/i);
    const mark = sim.mark();
    const d = await reopen();
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "notConnected");
    await expect(previewNotice(d)).toHaveText("No preview: not connected. Connect to read values. You can apply the format now.");
    ev.set("c37_rows", await previewRows(d));
    expect(await previewRows(d)).toEqual([["2", "—"], ["3", "—"]]);
    await d.getByRole("button", { name: "Cancel" }).click();
    expect(sim.requestsDecoded(mark)).toHaveLength(0);
  });

  // CHK10-43 / 44 no values: first reply is a timeout / exception
  for (const [item, fault] of [["CHK10-43", "fault drop"], ["CHK10-44", "fault exception 2"]] as const) {
    await test.step(`${item} no values`, async () => {
      await sim.ctlOk(fault);
      await mm.toolbarButton("Connect").click();
      await expect(mm.pill).toContainText("Connected", { timeout: 15_000 });
      await expect(bar).toHaveAttribute("data-state", item === "CHK10-43" ? "timeout" : "exception", { timeout: 20_000 });
      const d = await reopen();
      const kind = await previewNotice(d).getAttribute("data-kind");
      ev.set(`${item}_no_values_kind`, kind);
      ev.set(`${item}_no_values_text`, await previewNotice(d).innerText());
      await expect(previewNotice(d)).toHaveAttribute("data-kind", "failed");
      await expect(previewNotice(d)).toHaveText("No preview: the last request got no valid reply. Values appear after the next good reply.");
      await expect(previewNotice(d).locator('svg[data-icon="octagon-x"]')).toHaveCount(1);
      ev.set(`${item}_rows`, await previewRows(d));
      await d.getByRole("button", { name: "Cancel" }).click();
      await mm.toolbarButton("Disconnect").click();
      await expect(mm.pill).toContainText(/Disconnected|Not connected|Idle/i);
      await sim.ctlOk("clear");
    });
  }

  // CHK10-39 waiting for the first reply
  await test.step("CHK10-39", async () => {
    await sim.ctlOk("fault delay 1500");
    if (!(await mm.hostField.isVisible())) await page.getByRole("button", { name: "Edit", exact: true }).click();
    await mm.timeoutField.fill("5000");
    await mm.toolbarButton("Connect").click();
    await expect(mm.pill).toContainText("Connected", { timeout: 15_000 });
    const d = await reopen();
    const kind = await previewNotice(d).getAttribute("data-kind");
    ev.set("c39_kind_before_reply", kind);
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "waiting");
    await expect(previewNotice(d)).toHaveText("No preview yet: waiting for the first reply.");
    const polite = await mm.livePolite.innerText();
    await expect(previewNotice(d), "the first reply arrives while D1 is open").toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => previewRows(d), { timeout: 10_000 }).toEqual([["2", "0"], ["3", "0"]]);
    ev.set("c39_rows_after_reply", await previewRows(d));
    ev.set("c39_politeBefore", polite);
    ev.set("c39_politeAfter", await mm.livePolite.innerText());
    await d.getByRole("button", { name: "Cancel" }).click();
    await sim.ctlOk("clear");
    await mm.toolbarButton("Disconnect").click();
    await expect(mm.pill).toContainText(/Disconnected|Not connected|Idle/i);
  });

  // CHK10-42 paused without values: connect with Auto-start off
  await test.step("CHK10-42 paused without values", async () => {
    if (!(await mm.hostField.isVisible())) await page.getByRole("button", { name: "Edit", exact: true }).click();
    await mm.autoStart.setChecked(false);
    await mm.toolbarButton("Connect").click();
    await expect(mm.pill).toContainText("Connected", { timeout: 15_000 });
    ev.set("c42_poll_state_autostart_off", await bar.getAttribute("data-state"));
    const d = await reopen();
    ev.set("c42_no_values_kind", await previewNotice(d).getAttribute("data-kind"));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "paused");
    await expect(previewNotice(d)).toHaveText("No preview: the poll is paused. Resume it (Ctrl+P) to read values.");
    await expect(previewNotice(d).locator('svg[data-icon="pause"]')).toHaveCount(1);
    await d.getByRole("button", { name: "Cancel" }).click();
    await mm.toolbarButton("Disconnect").click();
    await expect(mm.pill).toContainText(/Disconnected|Not connected|Idle/i);
  });

  // CHK10-45 link lost without values: reconnect while the device is away
  await test.step("CHK10-45 connection lost without values", async () => {
    await sim.ctlOk("stop");
    await mm.toolbarButton("Connect").click();
    await expect(mm.pill).not.toContainText("Connected", { timeout: 20_000 });
    await expect(mm.pill).not.toContainText(/Connecting/i, { timeout: 20_000 });
    ev.set("c45_pill_after_failed_connect", await mm.pill.innerText());
    const d = await reopen();
    ev.set("c45_no_values_kind", await previewNotice(d).getAttribute("data-kind"));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "connectionLost");
    await expect(previewNotice(d)).toHaveText("No preview: the connection was lost. Reconnect to read values.");
    await expect(previewNotice(d).locator('svg[data-icon="unplug"]')).toHaveCount(1);
    await d.getByRole("button", { name: "Cancel" }).click();
    await sim.ctlOk("resume");
  });

  ev.save();
});

// ---------------------------------------------------------------------------------------------------------------------------
// Native poll window (W2) at its minimum size, hardware keyboard (SendInput) for the keyboard items.
// ---------------------------------------------------------------------------------------------------------------------------
async function nativeAtMinimum(desktop: import("../integration/fixtures").Desktop, base: RealMm, sim: import("../integration/sim").Sim, name: string) {
  const mm = new Fmm(base.page);
  await setF10(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 400 });
  const id = await mm.addPollUi({ name, qty: 10, scan: 100 });
  await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  await expect(mm.gridRow(id, 0)).toBeVisible();
  const { nw, hwnd } = await popOut(desktop, mm, id, name);
  await expect(nw.statusLine).toHaveAttribute("data-state", "polling");
  await expect(nw.gridRow(0)).toBeVisible();
  const min = await toMinimum(desktop, hwnd, nw.page);
  const popover = nw.page.locator('[data-slot="setup-popover"]');
  if (await popover.isVisible().catch(() => false)) {
    await nw.rail.click();
    await expect(popover).toBeHidden();
  }
  return { mm, id, nw, hwnd, min };
}

test("CHK10 W2 minimum: row menu fits (59), keyboard open (64) and menu keyboard (67) with hardware keys", async ({ mm: base, sim, desktop }) => {
  test.setTimeout(240_000);
  const ev = new Evidence("w2-menu");
  const { nw, hwnd, min } = await nativeAtMinimum(desktop, base, sim, "Men");
  const page = nw.page;
  ev.set("minimumWindow", min);
  expect([min.w, min.h], "client of the minimum native poll window in css px").toEqual([466, 283]);
  const key = (seq: string) => desktop.nativeKey(hwnd, seq);

  // CHK10-59: the whole menu is reachable
  await nw.gridRow(2).click({ button: "right" });
  let menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  const m = await menu.evaluate((e) => ({ scrollH: e.scrollHeight, clientH: e.clientHeight, overflowY: getComputedStyle(e).overflowY, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom, innerH: window.innerHeight }));
  ev.set("c59_menu_metrics", m);
  expect(m.overflowY).toBe("auto");
  expect(m.scrollH).toBeGreaterThan(m.clientH);
  expect(m.top).toBeGreaterThanOrEqual(0);
  expect(m.bottom).toBeLessThanOrEqual(m.innerH);
  await ev.shot(page, "c59-menu-top");
  key("end");
  const lastItem = menu.getByRole("menuitem").last();
  await expect(lastItem).toBeFocused();
  ev.set("c59_last_item_after_End", await lastItem.innerText());
  await expect(lastItem).toBeInViewport();
  await ev.shot(page, "c59-menu-end");
  key("home");
  await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
  await expect(menu.getByRole("menuitemradio").first()).toBeInViewport();
  ev.set("c59_menu_top_visible_after_Home", await menu.evaluate((e) => ({ scrollTop: e.scrollTop, headingTop: (e.querySelector('[role="presentation"]') as HTMLElement | null)?.getBoundingClientRect().top ?? null })));
  key("esc");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // CHK10-67: menu keyboard
  await nw.gridRow(2).click();
  await nw.gridRow(3).click({ modifiers: ["Shift"] });
  const activeRow = await nw.grid.getAttribute("aria-activedescendant");
  key("shift+f10");
  menu = page.getByRole("menu").last();
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  key("down");
  await expect(menu.getByRole("menuitemradio", { name: /^Signed/ })).toBeFocused();
  key("up");
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  key("end");
  await expect(menu.getByRole("menuitem").last()).toBeFocused();
  key("home");
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  key("esc");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(nw.grid).toBeFocused();
  expect(await nw.grid.getAttribute("aria-activedescendant")).toBe(activeRow);
  expect(await nw.page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
  await expect(nw.gridRow(2)).not.toContainText("HEX");
  // Enter on a quick item
  key("shift+f10");
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  key("down");
  key("down");
  await expect(menu.getByRole("menuitemradio", { name: /^Hex/ })).toBeFocused();
  key("enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(nw.gridRow(2)).toContainText("HEX");
  await expect(nw.gridRow(3)).toContainText("HEX");
  await expect(nw.grid).toBeFocused();
  expect(await nw.grid.getAttribute("aria-activedescendant")).toBe(activeRow);
  // Space on a quick item
  key("shift+f10");
  await expect(menu.getByRole("menuitemradio", { name: /^Hex/ })).toBeVisible();
  key("down");
  key("down");
  key("down");
  await expect(menu.getByRole("menuitemradio", { name: /^Binary/ })).toBeFocused();
  key("space");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(nw.gridRow(2)).toContainText("BIN");
  await expect(nw.grid).toBeFocused();
  ev.set("c67", { activeRow, afterEnter: "HEX", afterSpace: "BIN" });

  // CHK10-64: Shift+F10 then 4 x ArrowDown reaches More formats…, Enter opens D1 with the checked radio focused
  await nw.gridRow(2).click();
  key("shift+f10");
  menu = page.getByRole("menu").last();
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  for (let i = 0; i < 4; i++) key("down");
  await expect(menu.getByRole("menuitem", { name: "More formats…" })).toBeFocused();
  key("enter");
  const d = dlg(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole("radio", { checked: true })).toBeFocused();
  ev.set("c64_shift_f10", { focusedInDialog: await d.getByRole("radio", { checked: true }).getAttribute("aria-label") ?? (await d.getByRole("radio", { checked: true }).evaluate((e) => (e.closest("label")?.textContent ?? "").trim())) });
  key("esc");
  await expect(d).toHaveCount(0);
  // The Menu (ContextMenu) key: the winhelper has no APPS key, so it is sent through CDP (DOM keydown), noted in the report.
  await nw.grid.focus();
  await page.keyboard.press("ContextMenu");
  menu = page.getByRole("menu").last();
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "More formats…" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(d).toBeVisible();
  await expect(d.getByRole("radio", { checked: true })).toBeFocused();
  ev.save();
});

/** No label, heading or reason is cut (no ellipsis, nothing wider than its box). Returns the checked count. */
async function nothingCut(d: Locator): Promise<{ checked: number; cut: Array<string | null> }> {
  return d.evaluate((root) => {
    const els = Array.from(
      root.querySelectorAll<HTMLElement>("label > span:not([data-testid]), [data-testid^='width-heading-'], [data-testid^='width-reason-'], legend, [data-testid='format-summary']"),
    );
    const cut = els.filter((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === "ellipsis").map((el) => el.textContent);
    return { checked: els.length, cut };
  });
}

test("CHK10 W2 dialog: 466 x 283 (29, 74, 69) and 900 x 700 (29, 69), real window", async ({ mm: base, sim, desktop }) => {
  test.setTimeout(240_000);
  const ev = new Evidence("w2-dialog");
  const { nw, hwnd, min } = await nativeAtMinimum(desktop, base, sim, "Dlg");
  const page = nw.page;
  ev.set("minimumWindow", min);
  expect([min.w, min.h]).toEqual([466, 283]);
  const inside = async (el: Locator, vp: { w: number; h: number }, what: string) => {
    const box = await el.boundingBox();
    expect(box, what).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.y ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= vp.w && (box?.y ?? 0) + (box?.height ?? 0) <= vp.h, `${what} inside the viewport`).toBe(true);
  };
  await selectRows((i) => nw.gridRow(i), 2, 5);
  const d = await openFromRowMenu(page, nw.gridRow(2));
  await expect(summary(d)).toHaveText("Selected 4 registers (2-5)");

  // CHK10-74 + CHK10-29 at 466 x 283, rows 2-5
  await radio(d, "Float 32-bit").check();
  const order = (await d.getByTestId("order-group").boundingBox()) as { x: number; y: number };
  const preview = (await d.getByTestId("format-preview").boundingBox()) as { x: number; y: number };
  ev.set("c74_stacked", { orderX: order.x, previewX: preview.x, orderY: order.y, previewY: preview.y });
  expect(Math.abs(order.x - preview.x)).toBeLessThan(2);
  expect(preview.y).toBeGreaterThan(order.y);
  const body = d.getByTestId("format-body");
  const bm = await body.evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight, oy: getComputedStyle(e).overflowY }));
  ev.set("c74_body", bm);
  expect(bm.oy).toBe("auto");
  expect(bm.s).toBeGreaterThan(bm.c);
  await ev.shot(page, "c74-466x283-float32", undefined);
  const states: Array<Record<string, unknown>> = [];
  for (const name of ["Unsigned", "Float 32-bit", "Hex", "Float 64-bit (Double)", "Unsigned"]) {
    await radio(d, name).check();
    for (const [what, el] of [
      ["title", d.getByRole("heading", { name: "Format / endian" })],
      ["Close", d.getByRole("button", { name: "Close dialog" })],
      ["Cancel", d.getByRole("button", { name: "Cancel" })],
      ["Apply", d.getByRole("button", { name: /^Apply/ })],
    ] as const) {
      await inside(el, { w: min.w, h: min.h }, `${what} after ${name}`);
    }
    const docScroll = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(docScroll.sh <= docScroll.ch && docScroll.sw <= docScroll.cw, `no document scrollbar after ${name}`).toBe(true);
    states.push({ name, docScroll, bodyScrolls: await body.evaluate((e) => e.scrollHeight > e.clientHeight) });
  }
  ev.set("c29_466x283_states", states);
  await ev.shot(page, "c29-466x283-unsigned");
  // keyboard: Float 64-bit (Double) scrolls into view inside the body
  await radio(d, "Float 32-bit").check();
  await radio(d, "Float 32-bit").focus();
  for (let i = 0; i < 3; i++) desktop.nativeKey(hwnd, "down");
  const f64 = radio(d, "Float 64-bit (Double)");
  await expect(f64).toBeChecked();
  await expect(f64).toBeFocused();
  const bb = (await body.boundingBox()) as { y: number; height: number };
  const fb = (await f64.boundingBox()) as { y: number; height: number };
  ev.set("c74_float64_visible", { radioY: fb.y, radioBottom: fb.y + fb.height, bodyY: bb.y, bodyBottom: bb.y + bb.height });
  expect(fb.y).toBeGreaterThanOrEqual(bb.y - 1);
  expect(fb.y + fb.height).toBeLessThanOrEqual(bb.y + bb.height + 1);
  await ev.shot(page, "c74-466x283-float64");

  // CHK10-69 at 466 x 283
  await radio(d, "Float 32-bit").check();
  ev.set("c69_466x283", await nothingCut(d));
  const cut466 = await nothingCut(d);
  expect(cut466.cut).toEqual([]);
  expect(cut466.checked).toBeGreaterThan(10);
  // preview values may truncate and then carry the full text in title
  const cells = await d.getByTestId("format-preview-row").locator("td:last-child").evaluateAll((els) => els.map((e) => ({ text: e.textContent, truncated: (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1, title: e.getAttribute("title") })));
  ev.set("c69_preview_cells_466", cells);
  for (const c of cells) if (c.truncated) expect(c.title, "a truncated value carries its text").toBe(c.text);

  // 900 x 700 (two columns)
  const dims = await setClientCss(desktop, hwnd, page, 900, 700);
  ev.set("c29_900x700_window", dims);
  await expect(d).toBeVisible();
  const sizes: Array<{ name: string; dialog: number; message: number; columns: number; orderVisible: boolean }> = [];
  for (const name of ["Unsigned", "Float 32-bit", "Hex", "Float 64-bit (Double)", "Unsigned"]) {
    await radio(d, name).check();
    const r = await d.evaluate((el) => ({
      dialog: el.getBoundingClientRect().height,
      message: (el.querySelector('[data-testid="format-message-area"]') as HTMLElement).getBoundingClientRect().height,
      columns: (el.querySelector('[data-testid="format-body"] .grid') as HTMLElement).getBoundingClientRect().height,
      orderVisible: !!el.querySelector('[data-testid="order-group"]'),
    }));
    sizes.push({ name, ...r });
  }
  ev.set("c29_900x700_sizes", sizes);
  expect(new Set(sizes.map((s) => Math.round(s.columns))).size, "the two columns never change height").toBe(1);
  expect(new Set(sizes.map((s) => Math.round(s.dialog - s.message))).size, "dialog height without the message area").toBe(1);
  ev.set("c29_900x700_literal_heights", [...new Set(sizes.map((s) => Math.round(s.dialog)))]);
  await ev.shot(page, "c29-900x700");
  // two columns really
  await radio(d, "Float 32-bit").check();
  const fmtBox = (await d.getByRole("group", { name: /^16-bit/ }).boundingBox()) as { x: number };
  const ordBox = (await d.getByTestId("order-group").boundingBox()) as { x: number };
  ev.set("c29_900x700_columns_x", { format: fmtBox.x, order: ordBox.x });
  expect(ordBox.x).toBeGreaterThan(fmtBox.x + 100);
  // CHK10-69 at 900 x 700, also with Float 64-bit
  const cut900 = await nothingCut(d);
  ev.set("c69_900x700", cut900);
  expect(cut900.cut).toEqual([]);
  await radio(d, "Float 64-bit (Double)").check();
  expect((await nothingCut(d)).cut).toEqual([]);
  ev.save();
});

/** The label of the focused element, like a screen reader name (aria-labelledby, aria-label or text). */
async function activeLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e) return "none";
    const ids = e.getAttribute("aria-labelledby");
    if (ids)
      return ids
        .split(" ")
        .map((i) => document.getElementById(i)?.textContent ?? "")
        .join(" ")
        .trim();
    const input = e as HTMLInputElement;
    const l = input.labels?.[0]?.querySelector("span")?.textContent;
    return e.getAttribute("aria-label") ?? l ?? (e.textContent ?? "").trim();
  });
}

async function keyboardSuite(
  desktop: import("../integration/fixtures").Desktop,
  hwnd: number,
  page: Page,
  grid: Locator,
  row: (i: number) => Locator,
  ev: Evidence,
  host: string,
): Promise<void> {
  const key = (seq: string) => desktop.nativeKey(hwnd, seq);
  // CHK10-64 via the hardware Shift+F10: menu on Unsigned, 4 x Down, Enter -> D1 with the checked radio focused
  await selectRows(row, 2, 3);
  const focusedRow = await grid.getAttribute("aria-activedescendant");
  key("shift+f10");
  let menu = page.getByRole("menu").last();
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  for (let i = 0; i < 4; i++) key("down");
  await expect(menu.getByRole("menuitem", { name: "More formats…" })).toBeFocused();
  key("enter");
  const d = dlg(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole("radio", { checked: true })).toBeFocused();
  ev.set(`${host}_c64`, { focusLabel: await activeLabel(page), summary: await summary(d).innerText() });

  // CHK10-65 Tab order with Float 32-bit checked
  await radio(d, "Float 32-bit").check();
  await radio(d, "Float 32-bit").focus();
  const forward: string[] = [];
  for (let i = 0; i < 7; i++) {
    key("tab");
    await expect.poll(async () => (await activeLabel(page)) !== (forward.at(-1) ?? "\u0000") || i === 0, { timeout: 3000 }).toBe(true);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), "focus stays in the dialog").toBe(true);
    forward.push(await activeLabel(page));
  }
  ev.set(`${host}_c65_forward_from_Float32`, forward);
  expect(forward).toEqual(["Big-endian", "Preview", "Cancel", "Apply", "Close dialog", "Float 32-bit", "Big-endian"]);
  await expect(d.getByRole("region", { name: "Preview" })).toBeVisible();
  const back: string[] = [];
  for (let i = 0; i < 3; i++) {
    key("shift+tab");
    await expect.poll(async () => (await activeLabel(page)) !== (back.at(-1) ?? (i === 0 ? "Big-endian" : "")), { timeout: 3000 }).toBe(true);
    back.push(await activeLabel(page));
  }
  ev.set(`${host}_c65_back`, back);
  expect(back).toEqual(["Float 32-bit", "Close dialog", "Apply"]);
  await radio(d, "Hex").check();
  await radio(d, "Hex").focus();
  key("tab");
  await expect.poll(() => activeLabel(page)).toBe("Preview");
  ev.set(`${host}_c65_16bit_next_after_format`, await activeLabel(page));

  // CHK10-66 Enter from the Preview region applies; Esc cancels; overlay click cancels
  key("enter");
  await expect(d).toHaveCount(0);
  await expect(row(2)).toContainText("HEX");
  await expect(grid).toBeFocused();
  expect(await grid.getAttribute("aria-activedescendant"), "focus returns to the originating row").toBe(focusedRow);
  ev.set(`${host}_c66_enter_from_preview`, { grid: await row(2).innerText() });
  // Enter from a radio
  await selectRows(row, 2, 3);
  await openFromRowMenu(page, row(2));
  await radio(d, "Binary").check();
  await radio(d, "Binary").focus();
  key("enter");
  await expect(d).toHaveCount(0);
  await expect(row(2)).toContainText("BIN");
  // Esc cancels
  await selectRows(row, 2, 3);
  await openFromRowMenu(page, row(2));
  await radio(d, "Signed").check();
  key("esc");
  await expect(d).toHaveCount(0);
  await expect(row(2)).toContainText("BIN");
  await expect(grid).toBeFocused();
  // The dialog was opened from the context menu of row 2, so the focus returns to the row of that origin address.
  expect(await grid.getAttribute("aria-activedescendant")).toBe(await row(2).getAttribute("id"));
  // one overlay click cancels, also right after clicking a radio (real mouse)
  await selectRows(row, 2, 3);
  await openFromRowMenu(page, row(2));
  await radio(d, "Signed").check();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const w = desktop.windows().find((x) => x.hwnd === hwnd) as import("../integration/desktop").NativeWindow;
  desktop.mouseClick(Math.round(w.client.x + 4 * dpr), Math.round(w.client.y + 4 * dpr));
  await expect(d).toHaveCount(0);
  await expect(row(2)).toContainText("BIN");
  ev.set(`${host}_c66`, { overlayClickClosed: true, esc: true, enterFromRadio: "BIN" });

  // CHK10-67 menu keyboard (Home/End/Esc/Enter/Space) on this host
  await selectRows(row, 2, 3);
  key("shift+f10");
  menu = page.getByRole("menu").last();
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  key("end");
  await expect(menu.getByRole("menuitem").last()).toBeFocused();
  key("home");
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
  key("esc");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(grid).toBeFocused();
  await expect(row(2)).toContainText("BIN");
  key("shift+f10");
  key("down");
  await expect(menu.getByRole("menuitemradio", { name: /^Signed/ })).toBeFocused();
  key("enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(row(2)).toContainText("S16");
  await expect(grid).toBeFocused();
  key("shift+f10");
  key("down");
  key("down");
  key("space");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(row(2)).toContainText("HEX");
  await expect(grid).toBeFocused();
  expect(await grid.getAttribute("aria-activedescendant")).toBe(focusedRow);
  ev.set(`${host}_c67`, { enterApplied: "S16", spaceApplied: "HEX" });
}

test("CHK10 keyboard on both hosts, hardware keys: 64, 65, 66, 67 (native window at minimum)", async ({ mm: base, sim, desktop }) => {
  test.setTimeout(300_000);
  const ev = new Evidence("keyboard-native");
  const { nw, hwnd } = await nativeAtMinimum(desktop, base, sim, "Kbd");
  await keyboardSuite(desktop, hwnd, nw.page, nw.grid, (i) => nw.gridRow(i), ev, "native466x283");
  ev.save();
});

test("CHK10 keyboard on both hosts, hardware keys: 64, 65, 66, 67 (workspace sub-window W1)", async ({ mm: base, sim, desktop }) => {
  test.setTimeout(300_000);
  const ev = new Evidence("keyboard-w1");
  const mm = new Fmm(base.page);
  await setF10(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 400 });
  const id = await mm.addPollUi({ name: "Kb1", qty: 10, scan: 100 });
  await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  await expect(mm.gridRow(id, 0)).toBeVisible();
  const hwnd = desktop.windows().find((w) => w.title.startsWith("Modbus Master"))?.hwnd ?? 0;
  expect(hwnd).not.toBe(0);
  await keyboardSuite(desktop, hwnd, mm.page, mm.grid(id), (i) => mm.gridRow(id, i), ev, "w1");
  ev.save();
});
