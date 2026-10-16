// CHK-001 N. Communication Traffic panel (UI side: the fake emits frames and counters)
import { expect, type Frame, hex, hms, rxFrame, test, txFrame } from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 532).getTime();

function bulkFrames(from: number, to: number): Frame[] {
  const out: Frame[] = [];
  for (let seq = from; seq <= to; seq += 1) {
    out.push(
      seq % 2 === 1
        ? txFrame(seq, AT + seq, [0, seq & 0xff, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10])
        : rxFrame(seq, AT + seq, [0, (seq - 1) & 0xff, 0, 0, 0, 5, 1, 3, 2, 4, 210]),
    );
  }
  return out;
}

test.describe("N. traffic panel", () => {
  test("CHK-N1 each frame shows #, time, arrow plus TX/RX, length and uppercase hex pairs", async ({
    app,
  }) => {
    await app.toState("polling");
    const txBytes = [0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x01, 0x03, 0x00, 0x00, 0x00, 0x0a];
    const rxBytes = [0x00, 0x01, 0x00, 0x00, 0x00, 0x17, 0x01, 0x03, 0x14, 0xab, 0xcd, 0xef, 0x0f];
    await app.frames([
      txFrame(2401, AT, txBytes),
      rxFrame(2402, AT + 8, rxBytes),
    ]);
    const tx = app.frameRow(2401).getByRole("gridcell");
    await expect(tx.nth(0)).toHaveText("2401");
    await expect(tx.nth(1)).toHaveText(hms(AT));
    await expect(tx.nth(1)).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    await expect(tx.nth(2)).toHaveText("→ TX");
    await expect(tx.nth(3)).toHaveText(String(txBytes.length));
    await expect(tx.nth(4)).toHaveText("00 01 00 00 00 06 01 03 00 00 00 0A");
    await expect(tx.nth(5)).toHaveText("FC03 slave 1");
    const rx = app.frameRow(2402).getByRole("gridcell");
    await expect(rx.nth(2)).toHaveText("← RX");
    await expect(rx.nth(3)).toHaveText(String(rxBytes.length));
    await expect(rx.nth(4)).toHaveText(hex(rxBytes));
    await expect(rx.nth(4)).toHaveText(/^([0-9A-F]{2} )*[0-9A-F]{2}$/);
  });

  test("CHK-N2 more than 5,000 frames: exactly 5,000 are kept, # stays absolute, counters keep counting", async ({
    app,
  }) => {
    await app.toState("polling");
    for (let from = 1; from <= 6000; from += 1000) await app.frames(bulkFrames(from, from + 999));
    await app.counters({ requests: 3000, responses: 3000, errors: 0, timeouts: 0 });
    await expect(app.frameList).toHaveAttribute("aria-rowcount", "5001"); // 5,000 frames + header
    await expect(app.counter("Requests")).toHaveText("3000");
    await app.frameList.evaluate((el) => {
      el.scrollTop = 0;
    });
    // newest = 6000, so the oldest is 6000 - 4999 = 1001
    const first = app.frameList.locator('[id^="frame-"]').first();
    await expect(first).toHaveAttribute("id", "frame-1001");
    await expect(first.getByRole("gridcell").first()).toHaveText("1001");
    await app.frameList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(app.frameRow(6000)).toBeInViewport();
    await app.counters({ requests: 4000, responses: 4000, errors: 0, timeouts: 0 });
    await expect(app.counter("Requests")).toHaveText("4000");
  });

  test("CHK-N3 scrolling up unchecks Auto-scroll and keeps the view; re-checking jumps to the newest", async ({
    app,
  }) => {
    await app.toState("polling");
    await app.frames(bulkFrames(1, 300));
    const autoScroll = app.traffic.getByRole("checkbox", { name: "Auto-scroll" });
    await expect(autoScroll).toBeChecked();
    await expect(app.frameRow(300)).toBeInViewport();
    await app.frameList.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(autoScroll).not.toBeChecked();
    await expect(app.frameRow(1)).toBeInViewport();
    await app.frames(bulkFrames(301, 400));
    await expect(app.frameList).toHaveAttribute("aria-rowcount", "401");
    await expect(app.frameRow(1)).toBeInViewport();
    expect(await app.frameList.evaluate((el) => el.scrollTop)).toBe(0);
    await autoScroll.check();
    await expect(app.frameRow(400)).toBeInViewport();
  });

  test("CHK-N4 detail strip: offsets, 16 bytes per line, Copy bytes copies spaced hex", async ({ app }) => {
    await app.toState("polling");
    const bytes = [
      0x00, 0x05, 0x00, 0x00, 0x00, 0x1d, 0x01, 0x10, 0x00, 0x0a, 0x00, 0x0a, 0x14,
      ...Array.from({ length: 20 }, (_, i) => 0xa0 + i),
    ];
    await app.frames([txFrame(7, AT, bytes, { function: 16 })]);
    await app.frameRow(7).click();
    const detail = app.frameDetail;
    await expect(detail).toBeVisible();
    const lines = (await detail.locator("pre").innerText()).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`0000  ${hex(bytes.slice(0, 16))}`);
    expect(lines[1]).toBe(`0010  ${hex(bytes.slice(16, 32))}`);
    expect(lines[2]).toBe(`0020  ${hex(bytes.slice(32))}`);
    await detail.getByRole("button", { name: "Copy bytes" }).click();
    expect(await app.clipboardText()).toBe(hex(bytes));
  });

  test("CHK-N5 Ctrl+C copies exactly one frame line; with nothing selected it copies nothing", async ({
    app,
    page,
  }) => {
    await app.toState("polling");
    const bytes = [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10];
    await app.frames([txFrame(1, AT, bytes), rxFrame(2, AT + 8, [0, 1, 0, 0, 0, 3, 1, 0x83, 2], { exceptionCode: 2 })]);
    await app.setClipboard("sentinel");
    await app.frameRow(1).click(); // focuses the list and selects the frame
    await app.frameList.press("Escape"); // clear the selection again
    await expect(app.frameRow(1)).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("Control+c");
    expect(await app.clipboardText()).toBe("sentinel");
    await expect(app.toast("Copied 1 frame.")).toHaveCount(0);

    await app.frameRow(1).click();
    await page.keyboard.press("Control+c");
    await expect(app.toast("Copied 1 frame.")).toBeVisible();
    expect(await app.clipboardText()).toBe(`${hms(AT)}\tTX\t${hex(bytes)}\tFC03 slave 1`);

    await app.frameRow(2).click();
    await page.keyboard.press("Control+c");
    expect(await app.clipboardText()).toBe(
      `${hms(AT + 8)}\tRX\t00 01 00 00 00 03 01 83 02\tException 02 Illegal data address`,
    );
  });

  test("CHK-N6 Reset counters sets the four counters to 0 and keeps the frames", async ({ app }) => {
    await app.toState("polling");
    await app.frames(bulkFrames(1, 4));
    await app.counters({ requests: 12, responses: 10, errors: 1, timeouts: 1 });
    await app.expectCounters({ requests: 12, responses: 10, errors: 1, timeouts: 1 });
    await app.traffic.getByRole("button", { name: "Reset counters" }).click();
    await app.expectCalls("resetCounters", 1);
    await app.expectCounters({ requests: 0, responses: 0, errors: 0, timeouts: 0 });
    await expect(app.frameRow(4)).toBeVisible();
    await expect(app.frameList).toHaveAttribute("aria-rowcount", "5");
  });
});
