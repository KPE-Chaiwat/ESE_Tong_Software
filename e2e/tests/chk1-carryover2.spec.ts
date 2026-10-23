// CHK-001 carry-over, part 2: formats and bit polls, banner texts (now the status line tooltip),
// the closing question with an invalid field, the traffic ring and auto-scroll.
import { expect, type Mm, test } from "../support/mm-fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 532).getTime();

async function live(mm: Mm, spec: Record<string, unknown> = {}): Promise<number> {
  await mm.open({ polls: [{ name: "Poll 1", scan: 1000, ...spec }], connected: true });
  const [id] = (await mm.pollIds()) as [number];
  await expect(mm.grid(id)).toHaveAttribute("data-status", "live");
  return id;
}

test.describe("D/F/G/H (carry-over) formats, bit polls, banner texts", () => {
  test("CHK-D3..D6 Ctrl+1..4 switch the raw format, Ctrl+B the address base (in the focused sub-window)", async ({ mm, page }) => {
    const id = await live(mm);
    await mm.script((f, i) => f.emitPollUpdate(i, { values: [1234, 65535, 32768, 0, 32767, 0, 0, 0, 0, 0] }), id);
    const raw = (row: number) => mm.gridRow(id, row).locator('[data-cell="raw"]');
    // REQ-009: Ctrl+1..4 set the format of the selected rows; Ctrl+A selects every row (the old poll-wide behavior).
    await mm.gridRow(id, 0).click();
    await page.keyboard.press("Control+a");
    await expect(raw(1)).toHaveText("65535");
    await page.keyboard.press("Control+2");
    await expect(raw(1)).toHaveText("-1");
    await expect(raw(2)).toHaveText("-32768");
    await page.keyboard.press("Control+3");
    await expect(raw(1)).toHaveText("0xFFFF");
    await expect(raw(0)).toHaveText("0x04D2");
    await page.keyboard.press("Control+4");
    await expect(raw(1)).toHaveText("1111 1111 1111 1111");
    await page.keyboard.press("Control+1");
    await expect(raw(1)).toHaveText("65535");
    await expect(mm.gridRow(id, 0).locator('[data-cell="address"]')).toHaveText("0");
    await page.keyboard.press("Control+b");
    await expect(mm.gridRow(id, 0).locator('[data-cell="address"]')).toHaveText("1");
    await expect(mm.grid(id).getByRole("columnheader", { name: /^Address \(1-based\)/ })).toBeVisible();
    await page.keyboard.press("Control+b");
    await expect(mm.gridRow(id, 0).locator('[data-cell="address"]')).toHaveText("0");
  });

  test("CHK-D7 a coil poll shows 1 0 1; the format controls are disabled with the tooltip; Ctrl+1..4 do nothing", async ({ mm, page }) => {
    const id = await live(mm, { fc: 1, qty: 3 });
    await mm.script((f, i) => f.emitPollUpdate(i, { values: [1, 0, 1] }), id);
    const raw = (row: number) => mm.gridRow(id, row).locator('[data-cell="raw"]');
    await expect(raw(0)).toHaveText("1");
    await expect(raw(1)).toHaveText("0");
    await mm.gridRow(id, 0).click();
    await page.keyboard.press("Control+3");
    await expect(raw(0)).toHaveText("1");
    await mm.statusLine(id).getByRole("button", { name: /^Show / }).click();
    // REQ-009: the narrow menu has plain "Format of selected rows" items instead of the Raw format radio items.
    const item = page.getByRole("menuitemradio", { name: /^Hex/ });
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
  });

  const TIPS: Array<{ name: string; state: string; extra: Record<string, unknown>; text: RegExp; icon: string }> = [
    { name: "timeout", state: "timeout", icon: "timer-off", extra: { consecutiveFailures: 3 }, text: /^Timeout: slave 1 did not respond within 1000 ms\. Retrying every 1000 ms \(3 in a row\)\.$/ },
    { name: "exception", state: "exception", icon: "octagon-x", extra: { consecutiveFailures: 1, exceptionCode: 2 }, text: /^Exception 02 \(Illegal data address\) from slave 1 for FC03 at 0-9\. Retrying every 1000 ms \(1 in a row\)\.$/ },
    { name: "unknown exception", state: "exception", icon: "octagon-x", extra: { consecutiveFailures: 1, exceptionCode: 12 }, text: /^Exception 0C \(Unknown exception\) from slave 1/ },
    { name: "crc", state: "badResponse", icon: "triangle-alert", extra: { consecutiveFailures: 1, badResponseKind: "crc", badResponseDetail: { expected: null, got: null, message: "" } }, text: /^Bad response from slave 1: CRC mismatch\. Retrying every 1000 ms \(1 in a row\)\.$/ },
    { name: "short frame", state: "badResponse", icon: "triangle-alert", extra: { consecutiveFailures: 1, badResponseKind: "shortFrame", badResponseDetail: { expected: 29, got: 20, message: "" } }, text: /^Bad response from slave 1: short frame \(20 of 29 bytes\)\./ },
    { name: "wrong slave", state: "badResponse", icon: "triangle-alert", extra: { consecutiveFailures: 1, badResponseKind: "wrongSlave", badResponseDetail: { expected: 1, got: 2, message: "" } }, text: /^Bad response from slave 1: reply from slave 2, expected 1\./ },
    { name: "wrong function", state: "badResponse", icon: "triangle-alert", extra: { consecutiveFailures: 1, badResponseKind: "wrongFunction", badResponseDetail: { expected: 3, got: 4, message: "" } }, text: /^Bad response from slave 1: reply for FC04, expected FC03\./ },
    { name: "transaction", state: "badResponse", icon: "triangle-alert", extra: { consecutiveFailures: 1, badResponseKind: "transactionMismatch", badResponseDetail: { expected: 5, got: 6, message: "" } }, text: /^Bad response from slave 1: transaction ID mismatch \(got 6, expected 5\)\./ },
    { name: "malformed", state: "badResponse", icon: "triangle-alert", extra: { consecutiveFailures: 1, badResponseKind: "malformed", badResponseDetail: { expected: null, got: null, message: "byte count 7 for 10 registers" } }, text: /^Bad response from slave 1: malformed frame \(byte count 7 for 10 registers\)\./ },
  ];
  for (const t of TIPS) {
    test(`CHK-F/G/H (banner text) ${t.name}: the status line tooltip carries the DES-001 2.3 text and the right icon`, async ({ mm }) => {
      const id = await live(mm);
      await mm.script((f, a) => f.emitPollState(a.id, a.state, a.extra), { id, state: t.state, extra: t.extra });
      const chip = mm.statusLine(id).locator('[data-slot="status-pill"]');
      await expect(chip).toHaveAttribute("title", t.text);
      await expect(chip.locator(`[data-icon="${t.icon}"]`)).toHaveCount(1);
    });
  }

  test("CHK-A3 with the link down Write… does nothing: no dialog from Ctrl+E", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await page.keyboard.press("Control+e");
    await expect(mm.writeDialog).toHaveCount(0);
    const [id] = (await mm.pollIds()) as [number];
    await mm.titleBar(id).focus();
    await page.keyboard.press("Control+e");
    await expect(mm.writeDialog).toHaveCount(0);
  });

  test("CHK-J28 closing with unsaved changes and an invalid connection field: Save is blocked, toast, the window stays", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }], seed: (f) => f.setProfileName("Bench A") });
    await mm.hostField.fill("not a host!");
    await mm.portField.fill("5020");
    await mm.toolbarButton("New poll").click();
    await expect(mm.profileLabel).toContainText("Modified");
    await mm.requestClose();
    await expect(mm.confirm).toContainText("Save changes?");
    await mm.confirm.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mm.toast("Fix the highlighted fields before saving.")).toBeVisible();
    expect(await mm.callCount("profilesSave")).toBe(0);
    expect(await mm.closeOutcome()).not.toBe("closed");
  });
});

test.describe("N (carry-over) traffic ring and auto-scroll", () => {
  test("CHK-N2 more than 5,000 frames: exactly 5,000 are kept, # stays absolute", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await mm.page.keyboard.press("Control+j");
    for (let from = 1; from <= 6000; from += 1000) {
      await mm.script(
        (f, a) => {
          const list = [];
          for (let seq = a.from; seq < a.from + 1000; seq += 1) {
            list.push({
              seq,
              at: a.at + seq,
              direction: seq % 2 === 1 ? "tx" : "rx",
              bytes: seq % 2 === 1 ? [0, seq & 0xff, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10] : [0, (seq - 1) & 0xff, 0, 0, 0, 5, 1, 3, 2, 4, 210],
              slaveId: 1,
              function: 3,
              exceptionCode: null,
              note: null,
              origin: { kind: "poll", pollId: 1 },
            });
          }
          f.emitFrames(list);
        },
        { from, at: AT },
      );
    }
    await expect(mm.frameList).toHaveAttribute("aria-rowcount", "5001");
    await mm.frameList.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(mm.frameList.locator('[id^="frame-"]').first()).toHaveAttribute("id", "frame-1001");
    await mm.frameList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(mm.frameList.locator("#frame-6000")).toBeInViewport();
  });

  test("CHK-N3 scrolling up unchecks Auto-scroll and keeps the view; re-checking jumps to the newest", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await mm.page.keyboard.press("Control+j");
    const burst = (from: number, to: number) =>
      mm.script(
        (f, a) => {
          const list = [];
          for (let seq = a.from; seq <= a.to; seq += 1) {
            list.push({
              seq,
              at: a.at + seq,
              direction: seq % 2 === 1 ? "tx" : "rx",
              bytes: [0, seq & 0xff, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10],
              slaveId: 1,
              function: 3,
              exceptionCode: null,
              note: null,
              origin: { kind: "poll", pollId: 1 },
            });
          }
          f.emitFrames(list);
        },
        { from, to, at: AT },
      );
    await burst(1, 300);
    const auto = mm.traffic.getByRole("checkbox", { name: "Auto-scroll" });
    await expect(auto).toBeChecked();
    await expect(mm.frameList.locator("#frame-300")).toBeInViewport();
    await mm.frameList.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(auto).not.toBeChecked();
    await burst(301, 400);
    await expect(mm.frameList).toHaveAttribute("aria-rowcount", "401");
    expect(await mm.frameList.evaluate((el) => el.scrollTop)).toBe(0);
    await auto.check();
    await expect(mm.frameList.locator("#frame-400")).toBeInViewport();
  });
});
