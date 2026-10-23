// CHK-010 (REPORT-031) visual identity in the REAL window: CHK10-70 (never colour only, grayscale), CHK10-71 (orange only for warnings,
// pixel counts of screenshots), CHK10-72 (contrast and fonts), plus the CHK10-63 fixture in the real window.
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { contrast, countNear, EVIDENCE_DIR, Evidence, pixel, readPng } from "../integration/chk10";
import { parseColor } from "../integration/chk10-color";
import { expect, test } from "../integration/fixtures";
import { RealMm } from "../integration/real-mm";
import { chooseAndApply, previewNotice, radio, summary, widthHeading, widthReason } from "../support/chk9";
import { esc } from "../support/mm";

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
const ORANGE: [number, number, number] = [0xfa, 0x81, 0x30];

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

async function box(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

test("CHK10 visual W1: grayscale (70), orange only in the cut box (71), contrast and fonts (72), CHK10-63 fixture", async ({ mm: base, sim }) => {
  test.setTimeout(300_000);
  const ev = new Evidence("visual");
  const mm = new Fmm(base.page);
  const page = mm.page;
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 400 });
  const id = await mm.addPollUi({ name: "Vis", start: 98, qty: 8, scan: 100 });
  await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  const row = (i: number) => mm.gridRow(id, i);
  await expect(row(7)).toBeVisible();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  ev.set("dpr", dpr);
  ev.set("cssWarningVar", await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ese-warning").trim()));
  const shotOf = async (name: string, el: Locator) => {
    const file = await ev.shot(page, name, el);
    return readPng(fs.readFileSync(file));
  };
  const setGray = (on: boolean) => page.evaluate((v) => document.documentElement.classList.toggle("qa-gray", v), on);
  await page.addStyleTag({ content: "html.qa-gray{filter:grayscale(1)}" });
  const gray = async (name: string, el: Locator) => {
    await setGray(true);
    const file = await ev.shot(page, `${name}-gray`, el);
    await setGray(false);
    const g = readPng(fs.readFileSync(file));
    let colored = 0;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const [r, gg, b] = pixel(g, x, y);
        if (Math.max(Math.abs(r - gg), Math.abs(gg - b)) > 2) colored++;
      }
    }
    return colored;
  };

  // ---- CHK10-63 in the real window: Float 64-bit over 98-105, then the poll window moves to 100-103 ----
  await row(0).click();
  await page.keyboard.press("Control+a");
  let d = await openFromRowMenu(page, row(0));
  await expect(summary(d)).toHaveText("Selected 8 registers (98-105)");
  await chooseAndApply(d, "Float 64-bit (Double)");
  await expect(d).toHaveCount(0);
  await expect(mm.grid(id).locator("[data-row]")).toHaveCount(2);
  await mm.titleButton(id, /^Poll setup/).click();
  await mm.applySetup(id, { name: "Vis", start: 100, qty: 4, scan: 100 });
  await mm.closeSetup(id);
  await expect(mm.grid(id).locator("[data-row]")).toHaveCount(2);
  await row(0).click();
  await page.keyboard.press("Control+a");
  d = await openFromRowMenu(page, row(0));
  const checkedOnOpen = await d.getByRole("radio", { checked: true }).evaluateAll((els) => els.map((e) => (e.closest("label")?.textContent ?? "").trim()));
  const cutAtOpen = await d.getByTestId("format-messages").locator("[data-kind]").allInnerTexts();
  ev.set("c63_real_window", { checkedOnOpen, messagesAtOpen: cutAtOpen, heading64: await widthHeading(d, 64).innerText(), summary: await summary(d).innerText() });
  await radio(d, "Signed").check();
  const warn = d.getByTestId("format-messages").locator('[data-kind="warning"]');
  await expect(warn).toBeVisible();
  const warnLines = await warn.locator("p").allInnerTexts();
  ev.set("c63_cut_lines", warnLines);
  expect(warnLines).toHaveLength(2);
  await expect(warn.locator('svg[data-icon="triangle-alert"]')).toHaveCount(1);
  await expect(d.getByRole("button", { name: /^Apply/ })).not.toHaveAttribute("aria-disabled", "true");

  // ---- CHK10-71: orange only in the cut box ----
  const png = await shotOf("cut-state-dialog", d);
  const dBox = await box(d);
  const wBox = await box(warn);
  const wRect = { x: (wBox.x - dBox.x) * dpr, y: (wBox.y - dBox.y) * dpr, w: wBox.width * dpr, h: wBox.height * dpr };
  const strongInside = countNear(png, ORANGE, 24, wRect);
  const strongTotal = countNear(png, ORANGE, 24);
  const tintSample = pixel(png, Math.round(wRect.x + wRect.w - 10), Math.round(wRect.y + wRect.h / 2));
  const tintInside = countNear(png, tintSample, 4, wRect);
  const tintTotal = countNear(png, tintSample, 4);
  ev.set("c71_cut_state", { strongInside, strongTotal, tintSample, tintInside, tintTotal, warnRectPx: wRect });
  expect(strongInside, "the 3 px orange border is inside the warning box").toBeGreaterThan(5);
  expect(strongTotal - strongInside, "no strong orange outside the warning box").toBe(0);
  expect(tintTotal - tintInside, "no orange tint outside the warning box").toBe(0);
  ev.set("c70_cut_state_colored_pixels_in_grayscale", await gray("cut-state", d));
  await d.getByRole("button", { name: "Cancel" }).click();
  await expect(d).toHaveCount(0);

  // reset to Unsigned on every row so that grid row i is register 100 + i
  await mm.grid(id).focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+1");
  await expect(mm.grid(id).locator('[data-cell="format"]').first()).toContainText("U16");
  const states: Record<string, { orangeStrong: number; tint: number }> = {};
  const orangeCheck = async (name: string, el: Locator) => {
    const p = await shotOf(name, el);
    states[name] = { orangeStrong: countNear(p, ORANGE, 24), tint: countNear(p, tintSample, 4) };
    return p;
  };

  // S1: one register: unavailable widths with reasons (text 'unavailable', info icon, reason)
  await selectRows(row, 1);
  d = await openFromRowMenu(page, row(1));
  await expect(widthHeading(d, 32)).toContainText("unavailable");
  await expect(widthHeading(d, 64)).toContainText("unavailable");
  await expect(widthReason(d, 32).locator("svg")).toHaveCount(1);
  await expect(widthReason(d, 64).locator("svg")).toHaveCount(1);
  ev.set("c70_s1_texts", { h32: await widthHeading(d, 32).innerText(), r32: await widthReason(d, 32).innerText(), h64: await widthHeading(d, 64).innerText(), r64: await widthReason(d, 64).innerText() });
  const s1 = await orangeCheck("s1-unavailable", d);
  ev.set("c70_s1_colored_pixels_in_grayscale", await gray("s1-unavailable", d));
  const facts = await d.evaluate((root) => {
    const cs = (el: Element | null) => (el ? getComputedStyle(el) : null);
    const q = (s: string) => root.querySelector(s);
    const buttons = Array.from(root.querySelectorAll("button"));
    const apply = buttons.find((b) => /^Apply/.test(b.textContent ?? "")) as HTMLElement;
    const cancel = buttons.find((b) => b.textContent?.trim() === "Cancel") as HTMLElement;
    const checkedLabel = (q("input[type=radio]:checked") as HTMLElement).closest("label") as HTMLElement;
    const lab = checkedLabel.querySelector("span") as HTMLElement;
    const reason = q("[data-testid=width-reason-32]") as HTMLElement;
    const heading = q("[data-testid=width-heading-32]") as HTMLElement;
    const summaryEl = q("[data-testid=format-summary]") as HTMLElement;
    const inline = q("[data-testid=preview-hex]") as HTMLElement;
    const info = (el: HTMLElement) => {
      const s = cs(el);
      return { color: s?.color ?? "", bg: s?.backgroundColor ?? "", font: s?.fontFamily ?? "", size: s?.fontSize ?? "", bw: s?.borderTopWidth ?? "", radius: s?.borderTopLeftRadius ?? "", rect: el.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number } };
    };
    return {
      dialog: info(root as HTMLElement),
      apply: info(apply),
      cancel: info(cancel),
      checkedRow: info(checkedLabel),
      checkedLabel: info(lab),
      reason: info(reason),
      heading: info(heading),
      summary: info(summaryEl),
      summaryHTML: summaryEl.innerHTML,
      inline: info(inline),
      tableCellFont: cs(q("[data-testid=format-preview-row] td"))?.fontFamily ?? "",
      patternFont: cs(q("[data-testid=format-preview-table]"))?.fontFamily ?? "",
    };
  });
  ev.set("c72_facts", facts);
  const dBox0 = await box(d);
  const at = (r: { x: number; y: number }, dx: number, dy: number) => pixel(s1, Math.round((r.x - dBox0.x + dx) * dpr), Math.round((r.y - dBox0.y + dy) * dpr));
  const applyBg = at(facts.apply.rect, 10, facts.apply.rect.height / 2);
  const cardBg = at(facts.reason.rect, 1, 1);
  const checkedBg = at(facts.checkedRow.rect, 3, facts.checkedRow.rect.height / 2);
  const col = (s: string) => parseColor(s) ?? ([0, 0, 0] as [number, number, number]);
  const ratios = {
    applyText: contrast(col(facts.apply.color), applyBg),
    applyBgPixel: applyBg,
    cardBgPixel: cardBg,
    checkedRowText: contrast(col(facts.checkedLabel.color), checkedBg),
    checkedRowBgPixel: checkedBg,
    reasonText: contrast(col(facts.reason.color), cardBg),
    widthHeadingMuted: contrast(col(facts.heading.color), cardBg),
    inlinePreviewMuted: contrast(col(facts.inline.color), cardBg),
    summaryText: contrast(col(facts.summary.color), cardBg),
  };
  ev.set("c72_contrast", ratios);
  expect.soft(ratios.applyText, "Apply text on lime").toBeGreaterThanOrEqual(10);
  expect.soft(ratios.checkedRowText, "checked radio row").toBeGreaterThanOrEqual(7);
  expect.soft(ratios.reasonText, "reason on card").toBeGreaterThanOrEqual(4.5);
  expect.soft(ratios.widthHeadingMuted, "muted heading").toBeGreaterThanOrEqual(4.5);
  expect.soft(ratios.inlinePreviewMuted, "muted inline preview").toBeGreaterThanOrEqual(4.5);
  expect.soft(Number.parseFloat(facts.apply.bw) * dpr, "Apply border is 1 css px (1 device px at this DPR)").toBeCloseTo(1, 1);
  expect.soft(Number.parseFloat(facts.apply.radius), "Apply is a pill").toBeGreaterThanOrEqual(facts.apply.rect.height / 2 - 1);
  expect.soft(Number.parseFloat(facts.cancel.bw) * dpr, "Cancel border is 1 css px").toBeCloseTo(1, 1);
  expect.soft(Number.parseFloat(facts.cancel.radius), "Cancel is an outline pill").toBeGreaterThanOrEqual(facts.cancel.rect.height / 2 - 1);
  expect.soft(facts.dialog.radius).toBe("16px");
  expect.soft(facts.checkedLabel.font).toMatch(/Afacad/);
  expect.soft(facts.inline.font).toMatch(/JetBrains Mono/);
  expect.soft(facts.tableCellFont).toMatch(/JetBrains Mono/);
  ev.set("c72_summary_font", { family: facts.summary.font, html: facts.summaryHTML });
  expect.soft(facts.summaryHTML, "DES-010 4 and 13: the run list of the summary is font-mono (CHK10-72)").toMatch(/font-mono/);
  await d.getByRole("button", { name: "Cancel" }).click();

  // S4 mixed: rows 0-1 Hex, then rows 0-3
  await selectRows(row, 0, 1);
  await row(0).click({ button: "right" });
  await page.getByRole("menu").last().getByRole("menuitemradio", { name: /^Hex/ }).click();
  await expect(row(0)).toContainText("HEX");
  await selectRows(row, 0, 3);
  d = await openFromRowMenu(page, row(0));
  await expect(d.getByTestId("format-messages").locator('[data-kind="info"]')).toContainText("The selected rows use different formats.");
  await expect(d.getByTestId("format-messages").locator('[data-kind="info"] svg[data-icon="info"]')).toHaveCount(1);
  await orangeCheck("s4-mixed", d);
  ev.set("c70_s4_colored_pixels_in_grayscale", await gray("s4-mixed", d));
  // S2: Float 32-bit with order group and preview
  await radio(d, "Float 32-bit").check();
  await orangeCheck("s2-float32", d);
  const patternFonts = await d.getByTestId("order-group").evaluate((el) => Array.from(el.querySelectorAll("span")).filter((s) => /^[A-H]{4,8}$/.test((s.textContent ?? "").trim())).map((s) => getComputedStyle(s).fontFamily));
  ev.set("c72_pattern_fonts", patternFonts);
  expect.soft(patternFonts.length, "four patterns found").toBe(4);
  for (const f of patternFonts) expect.soft(f).toMatch(/JetBrains Mono/);
  ev.set("c70_s2_colored_pixels_in_grayscale", await gray("s2-float32", d));
  await d.getByRole("button", { name: "Cancel" }).click();

  // S3: stale notice (paused)
  await mm.grid(id).focus();
  await page.keyboard.press("Control+p");
  await expect(mm.statusLine(id)).toHaveAttribute("data-state", "paused");
  await selectRows(row, 0, 3);
  d = await openFromRowMenu(page, row(0));
  await expect(previewNotice(d).locator('svg[data-icon="clock"]')).toHaveCount(1);
  await orangeCheck("s3-stale", d);
  ev.set("c70_s3_colored_pixels_in_grayscale", await gray("s3-stale", d));
  await d.getByRole("button", { name: "Cancel" }).click();
  await mm.grid(id).focus();
  await page.keyboard.press("Control+p");

  // S5: row menu with a checked item
  await selectRows(row, 2, 3);
  await row(2).click({ button: "right" });
  const menu = page.getByRole("menu").last();
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ }).locator('svg[data-icon="check"]')).toHaveCount(1);
  await orangeCheck("s5-row-menu", menu);
  ev.set("c70_s5_colored_pixels_in_grayscale", await gray("s5-row-menu", menu));
  await page.keyboard.press("Escape");

  ev.set("c71_states", states);
  for (const [name, s] of Object.entries(states)) {
    expect(s.orangeStrong, `${name}: strong orange pixels`).toBe(0);
    expect(s.tint, `${name}: orange tint pixels`).toBe(0);
  }
  ev.save();
  void path;
  void EVIDENCE_DIR;
});
