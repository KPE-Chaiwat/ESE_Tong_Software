// REPORT-007: D4 of REPORT-006 (the first click on an action button was lost when the blur message of a field moved the button).
// A REAL mouse (OS input: move, press, release in one helper process) clicks once on [Apply scale] (Decimals 7), [Apply] (Quantity 200
// with a second invalid field untouched), Save profile as [Save] (empty name), the override dialog [Save] (Decimals 7) and the Write
// dialog [Send] (Slave ID 300). Evidence: a page-side recorder (capture phase) proves that exactly one `click` event reached the
// button, that the mousedown was default-prevented (focus kept) and the visible outcome where there is one.
import { type Desktop, expect, type RealMm, test } from "../integration/fixtures";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";
import { hwClick, hwndByTitle, installRecorder, readRecorder } from "../integration/qa7";
import type { Page } from "@playwright/test";
import type { Sim } from "../integration/sim";

async function session(mm: RealMm, sim: Sim, qty = 4): Promise<number> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
  const [id] = await createPolls(mm, [{ name: "S", slave: 1, fc: 3, start: 0, qty, scan: 100 }]);
  await expect(mm.statusLine(id as number)).toHaveAttribute("data-state", "polling");
  return id as number;
}

const clicksOn = (rec: Awaited<ReturnType<typeof readRecorder>>, text: RegExp) => rec.filter((r) => r.ev === "click" && text.test(r.t));
const downOn = (rec: Awaited<ReturnType<typeof readRecorder>>, text: RegExp) => rec.filter((r) => r.ev === "mousedown" && text.test(r.t));

/** Sets an input's value like a paste without moving the focus (no blur of the field that has it). */
async function setNoFocus(page: Page, el: import("@playwright/test").Locator, value: string): Promise<void> {
  await el.evaluate((node, v) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function report(label: string, page: Page, btn: RegExp, extra: Record<string, unknown>, testInfo: import("@playwright/test").TestInfo): Promise<void> {
  const rec = await readRecorder(page);
  const downs = downOn(rec, btn);
  const clicks = clicksOn(rec, btn);
  const row = { label, clicks: clicks.length, mousedowns: downs.length, focusouts: rec.filter((r) => r.ev === "focusout").map((r) => r.t), ...extra };
  console.log("D4", JSON.stringify(row));
  await testInfo.attach(`d4-${label.replace(/\W+/g, "_")}.json`, { body: JSON.stringify({ ...row, events: rec }, null, 1), contentType: "application/json" });
  expect.soft(clicks.length, `${label}: exactly one click event reached the button after ONE real click (events ${JSON.stringify(rec.map((r) => `${r.ev}:${r.t}`))})`).toBe(1);
}

test.describe("D4 the first real click on an action button is not lost", () => {
  test("CHK3-C [Apply scale] with Decimals 7 (the REPORT-006 case): one click shows 'Scale not applied. Fix the highlighted fields.'", async ({ desktop, mm, sim }, testInfo) => {
    const id = await session(mm, sim, 2);
    await focusPoll(mm, id);
    await mm.titleButton(id, /^Poll setup/).click();
    const sc = mm.setup(id);
    await sc.getByLabel("Preset", { exact: true }).selectOption({ label: "4-20 mA" });
    await sc.getByLabel("Raw min", { exact: true }).fill("0");
    await sc.getByLabel("Raw max", { exact: true }).fill("65535");
    await sc.getByRole("button", { name: "Apply scale", exact: true }).click();
    await expect(sc.getByTestId("scale-not-applied")).toHaveCount(0);
    await sc.getByLabel("Decimals", { exact: true }).fill("7");
    await installRecorder(mm.page);
    const w1 = hwndByTitle(desktop, "Modbus Master");
    await hwClick(desktop, w1, mm.page, sc.getByRole("button", { name: "Apply scale", exact: true }));
    await expect(sc.getByTestId("scale-not-applied"), "the header after ONE real click").toContainText("Scale not applied. Fix the highlighted fields.", { timeout: 4000 });
    await expect(sc).toContainText("Decimals must be a whole number from 0 to 6.");
    await report("Apply scale", mm.page, /Apply scale/, { focusKept: await mm.page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("id") ?? "") }, testInfo);
    expect(test.info().errors.length).toBe(0);
  });

  test("[Apply] of the POLL section: Quantity 200 (focused) with Slave ID 248 set without focus: one click validates everything (the Slave ID message appears)", async ({ desktop, mm, sim }, testInfo) => {
    const id = await session(mm, sim, 4);
    await focusPoll(mm, id);
    await mm.titleButton(id, /^Poll setup/).click();
    await expect(mm.setup(id)).toBeVisible();
    await setNoFocus(mm.page, mm.setupField(id, "Slave ID"), "248");
    const pre = await mm.setup(id).innerText();
    await mm.setupField(id, "Quantity").fill("200");
    await installRecorder(mm.page);
    const mark = sim.mark();
    const w1 = hwndByTitle(desktop, "Modbus Master");
    await hwClick(desktop, w1, mm.page, mm.setup(id).getByRole("button", { name: "Apply", exact: true }));
    await expect(mm.setup(id), "the submit validated the untouched Slave ID too").toContainText("Slave ID must be a whole number from 0 to 247.", { timeout: 4000 });
    await expect(mm.setup(id)).toContainText("Quantity for FC03 must be from 1 to 125.");
    await report("Apply (poll)", mm.page, /^BUTTON:Apply$/, { slaveMessageBeforeClick: /Slave ID must be/.test(pre), sentToTheWire: sim.requestsDecoded(mark).filter((r) => r.arg === 200).length }, testInfo);
    expect(sim.requestsDecoded(mark).filter((r) => r.arg === 200 || r.unit === 248)).toEqual([]);
    expect(test.info().errors.length).toBe(0);
  });

  test("Save profile as [Save] with an empty name: one real click on [Save] reaches the button; the dialog stays with its message", async ({ desktop, mm, sim }, testInfo) => {
    await session(mm, sim, 2);
    await mm.openMenu("File");
    await mm.menuItem("Save as…").click();
    const dlg = mm.saveAsDialog;
    await expect(dlg).toBeVisible();
    await dlg.getByLabel("Name").focus();
    await installRecorder(mm.page);
    const w1 = hwndByTitle(desktop, "Modbus Master");
    await hwClick(desktop, w1, mm.page, dlg.getByRole("button", { name: "Save", exact: true }));
    await report("Save as", mm.page, /^BUTTON:Save$/, { dialogText: (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 200) }, testInfo);
    await expect(dlg, "the dialog stays open with its message").toBeVisible();
    await expect(dlg.locator('[aria-invalid="true"]')).toHaveCount(1);
    await dlg.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(test.info().errors.length).toBe(0);
  });

  test("override dialog [Save] with Decimals 7: one real click reaches the button", async ({ desktop, mm, sim }, testInfo) => {
    const id = await session(mm, sim, 6);
    await focusPoll(mm, id);
    await mm.gridRow(id, 0).click();
    await mm.page.keyboard.press("Control+Shift+E");
    const dlg = mm.page.getByTestId("override-dialog");
    await expect(dlg).toBeVisible();
    await dlg.getByLabel("Preset", { exact: true }).selectOption({ label: "Divide" });
    await dlg.getByRole("radio", { name: "10", exact: true }).click();
    await dlg.getByLabel("Decimals", { exact: true }).fill("7");
    await installRecorder(mm.page);
    const w1 = hwndByTitle(desktop, "Modbus Master");
    await hwClick(desktop, w1, mm.page, dlg.getByRole("button", { name: "Save", exact: true }));
    await report("Override Save", mm.page, /^BUTTON:Save$/, { dialogText: (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 300) }, testInfo);
    await expect(dlg, "invalid Decimals: the dialog stays open").toBeVisible();
    await expect(dlg).toContainText(/Decimals must be a whole number from 0 to 6\./);
    await dlg.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(test.info().errors.length).toBe(0);
  });

  test("Write dialog [Send] with Slave ID 300: one real click reaches the button and nothing is sent", async ({ desktop, mm, sim }, testInfo) => {
    const id = await session(mm, sim, 2);
    await focusPoll(mm, id);
    await mm.page.keyboard.press("Control+e");
    await expect(mm.writeDialog).toBeVisible();
    const f = (l: string) => mm.writeDialog.getByLabel(l, { exact: true });
    await f("Function").selectOption("6");
    await f("Start address").fill("41");
    await f("Value").fill("11");
    await f("Slave ID").fill("300");
    await installRecorder(mm.page);
    const mark = sim.mark();
    const w1 = hwndByTitle(desktop, "Modbus Master");
    await hwClick(desktop, w1, mm.page, mm.writeDialog.getByRole("button", { name: "Send", exact: true }));
    await report("Write Send", mm.page, /^BUTTON:Send$/, { dialogText: (await mm.writeDialog.innerText()).replace(/\s+/g, " ").slice(0, 300) }, testInfo);
    await expect(mm.writeDialog).toContainText(/Slave ID must be a whole number from 0 to 247\./);
    expect(sim.requestsDecoded(mark).filter((r) => r.fc === 6), "nothing was written").toEqual([]);
    // the same dialog with a valid Slave ID: a real click on [Send] writes (regression check for KEEP_FOCUS_ON_PRESS)
    await f("Slave ID").fill("1");
    await hwClick(desktop, w1, mm.page, mm.writeDialog.getByRole("button", { name: "Send", exact: true }));
    await expect(mm.page.getByTestId("write-result")).toContainText("Write confirmed by slave 1: register at 41.", { timeout: 8000 });
    expect(await sim.get("holding", 41, 1)).toEqual([11]);
    expect(test.info().errors.length).toBe(0);
  });
});

void (null as unknown as Desktop);
