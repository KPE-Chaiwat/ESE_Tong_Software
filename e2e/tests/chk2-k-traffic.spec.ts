// CHK-002 section K: traffic bar, panel, per-poll filter and counters.
import { expect, STANDARD_8, test, type Mm } from "../support/mm-fixtures";

const filterSelect = (mm: Mm) => mm.traffic.getByRole("combobox", { name: "Traffic filter" });
async function pollColumn(mm: Mm): Promise<string[]> {
  return mm.frameList.locator('[role="row"][id^="frame-"]').evaluateAll((rows) =>
    rows.map((r) => (r.querySelectorAll('[role="gridcell"]')[6]?.textContent ?? "").trim()),
  );
}
const counterValues = async (mm: Mm) => ({
  requests: Number(await mm.counter("requests").innerText()),
  responses: Number(await mm.counter("responses").innerText()),
  errors: Number(await mm.counter("errors").innerText()),
  timeouts: Number(await mm.counter("timeouts").innerText()),
});
const tx = async (mm: Mm, id: number) => Number((await mm.statusText(id)).match(/Tx (\d+)/)?.[1]);

async function standard8(mm: Mm, faults = true): Promise<number[]> {
  await mm.open({
    polls: STANDARD_8,
    connected: true,
    seed: (f, a: { faults: boolean }, ids) => {
      if (a.faults) f.scriptFault(ids[5], { kind: "exception", code: 2 });
    },
    seedArg: { faults },
  });
  await mm.advance(3000);
  return mm.pollIds();
}

test.describe("K traffic and counters", () => {
  test("CHK2-K1 the collapsed bar shows the counters and link load; Ctrl+J expands", async ({ mm, page }) => {
    await standard8(mm);
    await expect(mm.trafficBar).toHaveText(/^Traffic\s*Requests \d+ · Responses \d+ · Errors \d+ · Timeouts \d+ · link load \d+%\s*Expand$/);
    await expect(mm.traffic).toHaveCount(0);
    await page.keyboard.press("Control+j");
    await expect(mm.traffic).toBeVisible();
    await expect(mm.trafficBar).toHaveCount(0);
    await expect(filterSelect(mm)).toHaveValue(/.+/);
    await page.keyboard.press("Control+j");
    await expect(mm.traffic).toHaveCount(0);
  });

  test("CHK2-K1 the expanded state is saved in the profile without marking it Modified, and comes back on open", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await mm.hostField.fill("127.0.0.1");
    await mm.portField.fill("5020");
    await mm.openMenu("File");
    await mm.menuItem("Save as…").click();
    await mm.saveAsDialog.getByLabel("Name").fill("Traffic test");
    await mm.saveAsDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mm.profileLabel).toContainText("Traffic test");
    expect(await mm.modified()).toBe(false);
    await page.keyboard.press("Control+j");
    await expect(mm.traffic).toBeVisible();
    expect(await mm.modified(), "expanding is not an edit").toBe(false);
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await mm.calls("profilesSave")).length).toBeGreaterThanOrEqual(2);
    const saved = (await mm.lastCall("profilesSave")) as [{ workspace: { trafficExpanded: boolean } }, boolean];
    expect(saved[0].workspace.trafficExpanded).toBe(true);
    await page.keyboard.press("Control+j");
    await expect(mm.traffic).toHaveCount(0);
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await mm.openDialog.getByRole("row", { name: /Traffic test/ }).dblclick();
    await expect(mm.traffic).toBeVisible();
    expect(await mm.modified()).toBe(false);
  });

  test("CHK2-K2 filter 'Poll 3' shows only its frames; the counters equal its status line Tx", async ({ mm, page }) => {
    const ids = await standard8(mm);
    await page.keyboard.press("Control+j");
    await filterSelect(mm).selectOption({ label: "Poll 3" });
    await expect.poll(async () => (await pollColumn(mm)).length).toBeGreaterThan(0);
    expect(new Set(await pollColumn(mm))).toEqual(new Set(["Poll 3"]));
    const c = await counterValues(mm);
    expect(c.requests).toBe(await tx(mm, ids[2] as number));
    expect(c.responses).toBe(c.requests);
    await expect(mm.counter("requests")).toHaveText(String(c.requests));
    // "All polls" shows frames of several polls.
    await filterSelect(mm).selectOption({ label: "All polls" });
    await expect.poll(async () => new Set(await pollColumn(mm)).size).toBeGreaterThan(1);
  });

  test("CHK2-K3 'Writes' shows only writes; the total equals the polls plus the writes", async ({ mm, page }) => {
    const ids = await standard8(mm, false);
    await mm.row(ids[0] as number).click();
    await mm.grid(ids[0] as number).focus();
    await page.keyboard.press("Control+e");
    await mm.writeDialog.getByLabel("Value", { exact: true }).fill("7");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await mm.advance(200);
    await expect(page.getByTestId("write-result")).toContainText("Write confirmed");
    await mm.writeDialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.keyboard.press("Control+j");
    await filterSelect(mm).selectOption({ label: "Writes" });
    await expect.poll(async () => (await pollColumn(mm)).length).toBeGreaterThan(0);
    expect(new Set(await pollColumn(mm))).toEqual(new Set(["Write: Poll 1"]));
    const writes = await counterValues(mm);
    expect(writes.requests).toBe(1);
    await filterSelect(mm).selectOption({ label: "All polls" });
    const total = await counterValues(mm);
    let sum = 0;
    for (const id of ids) sum += await tx(mm, id);
    expect(total.requests, "total = sum of the polls + writes").toBe(sum + writes.requests);
  });

  test("CHK2-K4 a filter without frames: 'No frames for Poll 2 yet.'", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }] });
    await page.keyboard.press("Control+j");
    await expect(mm.traffic).toBeVisible();
    await filterSelect(mm).selectOption({ label: "Poll 2" });
    await expect(mm.page.getByTestId("traffic-empty")).toHaveText("No frames for Poll 2 yet.");
  });

  test("CHK2-K5 'Show traffic for this poll' from a sub-window expands the panel with that filter", async ({ mm }) => {
    const ids = await standard8(mm, false);
    await mm.row(ids[1] as number).click();
    await mm.statusLine(ids[1] as number).getByRole("button", { name: "Poll actions" }).click();
    await mm.page.getByRole("menuitem", { name: /^Show traffic for this poll/ }).click();
    await expect(mm.traffic).toBeVisible();
    await expect(filterSelect(mm).locator("option:checked")).toHaveText("Poll 2");
    await mm.expectCalls("showTraffic", 0);
  });

  test("CHK2-K5 from a native window the command asks W1; W1 expands the panel with the filter", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }], connected: true });
    const [, p2] = (await mm.pollIds()) as [number, number];
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }], index: 1 });
    await w2.page.getByRole("button", { name: "Poll actions" }).click();
    await w2.page.getByRole("menuitem", { name: /^Show traffic for this poll/ }).click();
    await w2.expectCalls("showTraffic", 1);
    expect((await w2.calls("showTraffic"))[0]).toEqual([2]);
    // What Rust does: W1 gets `ShowTraffic` and comes to the front.
    await mm.page.bringToFront();
    await mm.script((f, id) => f.showTraffic(id), p2);
    await expect(mm.traffic).toBeVisible();
    await expect(filterSelect(mm).locator("option:checked")).toHaveText("Poll 2");
  });

  test("CHK2-K6 deleting the filtered poll switches the filter to 'All polls'", async ({ mm, page }) => {
    const ids = await standard8(mm, false);
    await page.keyboard.press("Control+j");
    await filterSelect(mm).selectOption({ label: "Poll 4" });
    await expect(filterSelect(mm).locator("option:checked")).toHaveText("Poll 4");
    await mm.script((f, id) => f.removePoll(id), ids[3]);
    await expect(filterSelect(mm).locator("option:checked")).toHaveText("All polls");
    await expect(filterSelect(mm).locator("option", { hasText: "Poll 4" })).toHaveCount(0);
  });

  test("CHK2-K7 (UI side) P7 with 3 drops: Timeouts 3 and Err 3; P6 exceptions count in Responses and Errors", async ({ mm, page }) => {
    const ids = await standard8(mm, true);
    await mm.script((f) => f.scriptSlaveFault(2, { kind: "timeout" }, 3));
    await mm.advance(8000);
    await page.keyboard.press("Control+j");
    await filterSelect(mm).selectOption({ label: "Poll 7" });
    await expect(mm.counter("timeouts")).toHaveText("3");
    expect((await mm.statusText(ids[6] as number)).match(/Err (\d+)/)?.[1]).toBe("3");
    await filterSelect(mm).selectOption({ label: "Poll 6" });
    const c = await counterValues(mm);
    expect(c.requests).toBeGreaterThan(0);
    expect(c.responses).toBe(c.requests);
    expect(c.errors).toBe(c.requests);
    expect(c.timeouts).toBe(0);
  });
});
