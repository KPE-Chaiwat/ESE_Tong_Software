// CHK-001 F. timeout, G. exception response, H. bad response (UI side: the fake emits the events)
import { expect, hms, REGISTER_MAP_10, rxFrame, test, txFrame } from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 540).getTime();
const WARNING = "rgb(250, 129, 48)";
const DARK = "rgb(49, 47, 46)";

test.describe("F. timeout", () => {
  test("CHK-F1 slave 99 applied: Timeout pill (orange, dark text) and banner text", async ({ app }) => {
    await app.toLive();
    await app.slaveId.fill("99");
    await app.applyButton.click();
    await app.expectCalls("startPoll", 1);
    const [[def]] = (await app.calls("startPoll")) as [[Record<string, unknown>]];
    expect(def).toMatchObject({ slaveId: 99 });
    await app.emitState("timeout", { consecutiveFailures: 1 });
    await app.expectPill("Timeout", "timer-off");
    await expect(app.pill).toHaveAttribute("data-variant", "timeout");
    await expect(app.pill).toHaveCSS("background-color", WARNING);
    await expect(app.pill).toHaveCSS("color", DARK);
    await expect(app.banner).toHaveAttribute("data-variant", "warning");
    await expect(app.banner.locator('[data-icon="timer-off"]')).toHaveCount(1);
    await expect(app.banner.locator("p")).toHaveText(
      "Timeout: slave 99 did not respond within 1000 ms. Retrying every 1000 ms (1 in a row).",
    );
  });

  test("CHK-F2 three timeouts in a row: counter text, Timeouts counter, stale chip, no re-announce", async ({
    app,
  }) => {
    await app.toLive();
    await app.pollUpdate(REGISTER_MAP_10, { at: AT });
    await app.emitState("timeout", { consecutiveFailures: 1 });
    await expect(app.banner).toContainText("(1 in a row)");
    await expect(app.livePolite).toHaveText(
      "Timeout. Timeout: slave 1 did not respond within 1000 ms. Retrying every 1000 ms (1 in a row).",
    );
    await app.page.evaluate(() => {
      const target = document.querySelector('[data-testid="live-polite"]');
      window.__qa = { mutations: 0 };
      new MutationObserver((list) => {
        (window.__qa as { mutations: number }).mutations += list.length;
      }).observe(target as Element, { childList: true, subtree: true, characterData: true });
    });
    for (const n of [2, 3]) {
      await app.counters({ requests: n, responses: 0, errors: 0, timeouts: n });
      await app.emitState("timeout", { consecutiveFailures: n });
      await expect(app.banner).toContainText(`(${n} in a row)`);
      await expect(app.counter("Timeouts")).toHaveText(String(n));
    }
    await expect(app.chip).toHaveText(`No response - values from ${hms(AT)}`);
    await expect(app.value(0)).toHaveText("1234");
    expect(await app.page.evaluate(() => (window.__qa as { mutations: number }).mutations)).toBe(0);
    await expect(app.liveAssertive).toHaveText("");
  });

  test("CHK-F3 recovery: next good cycle returns to polling, banner gone, values live", async ({ app }) => {
    await app.toLive();
    await app.emitState("timeout", { consecutiveFailures: 1 });
    await expect(app.banner).toBeVisible();
    await app.emitState("polling");
    await app.pollUpdate(REGISTER_MAP_10);
    await app.expectPill("Polling", "activity");
    await app.expectNoBanner();
    await expect(app.chip).toContainText("Updated");
  });

  test("CHK-F4 timeout without any data: dashes and Waiting for first response", async ({ app }) => {
    await app.toState("timeout", { extra: { consecutiveFailures: 1 } });
    await expect(app.chip).toHaveText("Waiting for first response…");
    await expect(app.value(0)).toHaveText("—");
    await expect(app.value(9)).toHaveText("—");
  });

  test("CHK-F5 Pause during timeout: paused, banner gone", async ({ app }) => {
    await app.toState("timeout", { extra: { consecutiveFailures: 2 } });
    await app.pressAndAnswer("Pause", "paused");
    await app.expectPill("Paused", "pause");
    await app.expectNoBanner();
  });

  test("CHK-F6 timeout 50 ms shows within 50 ms (UI side)", async ({ app }) => {
    await app.toState("timeout", { timeoutMs: 50, extra: { consecutiveFailures: 1 } });
    await expect(app.banner.locator("p")).toHaveText(
      "Timeout: slave 1 did not respond within 50 ms. Retrying every 1000 ms (1 in a row).",
    );
    const [[cfg]] = (await app.calls("connect")) as [[Record<string, unknown>]];
    expect(cfg).toMatchObject({ timeoutMs: 50 });
  });
});

test.describe("G. exception response", () => {
  test("CHK-G1 start 95 qty 10 applied: Exception 02 pill and banner (error border, dark text)", async ({
    app,
  }) => {
    await app.toLive();
    await app.start.fill("95");
    await app.applyButton.click();
    await app.expectCalls("startPoll", 1);
    await app.emitState("exception", { exceptionCode: 2, consecutiveFailures: 1 });
    await app.expectPill("Exception 02", "octagon-x");
    await expect(app.pill).toHaveAttribute("data-variant", "exception");
    await expect(app.banner).toHaveAttribute("data-variant", "error");
    await expect(app.banner.locator("p")).toHaveText(
      "Exception 02 (Illegal data address) from slave 1 for FC03 at 95-104. Retrying every 1000 ms (1 in a row).",
    );
    await expect(app.banner).toHaveCSS("border-left-width", "4px");
    await expect(app.banner).toHaveCSS("border-left-color", "rgb(239, 68, 68)");
    await expect(app.banner.locator("p")).toHaveCSS("color", DARK);
  });

  test("CHK-G2 exception RX row: Info text with icon, bytes contain 83 02, Errors counts per cycle", async ({
    app,
  }) => {
    await app.toState("exception", { extra: { exceptionCode: 2, consecutiveFailures: 1 } });
    await app.frames([
      txFrame(1, AT, [0, 1, 0, 0, 0, 6, 1, 3, 0, 95, 0, 10]),
      rxFrame(2, AT + 8, [0, 1, 0, 0, 0, 3, 1, 0x83, 2], { exceptionCode: 2 }),
    ]);
    await app.counters({ requests: 1, responses: 1, errors: 1, timeouts: 0 });
    const rx = app.frameRow(2);
    await expect(rx).toContainText("Exception 02 Illegal data address");
    await expect(rx.locator('[data-icon="octagon-x"]')).toHaveCount(1);
    await expect(rx).toContainText("83 02");
    await expect(app.counter("Errors")).toHaveText("1");
    await app.frames([
      txFrame(3, AT + 1000, [0, 2, 0, 0, 0, 6, 1, 3, 0, 95, 0, 10]),
      rxFrame(4, AT + 1008, [0, 2, 0, 0, 0, 3, 1, 0x83, 2], { exceptionCode: 2 }),
    ]);
    await app.counters({ requests: 2, responses: 2, errors: 2, timeouts: 0 });
    await expect(app.counter("Errors")).toHaveText("2");
  });

  test("CHK-G3 exception before any data: No data text", async ({ app }) => {
    await app.toState("connected");
    await app.pressAndAnswer("Start polling", "polling");
    await app.emitState("exception", { exceptionCode: 2, consecutiveFailures: 1 });
    await expect(app.dataEmpty).toHaveText(
      "No data: the device answered with exception 02 (Illegal data address).",
    );
  });

  test("CHK-G4 recovery after setting the start address back to 0", async ({ app }) => {
    await app.toLive();
    await app.start.fill("95");
    await app.applyButton.click();
    await app.emitState("exception", { exceptionCode: 2, consecutiveFailures: 1 });
    await expect(app.banner).toBeVisible();
    await app.start.fill("0");
    await app.applyButton.click();
    await app.expectCalls("startPoll", 2);
    const second = ((await app.calls("startPoll")) as [[Record<string, unknown>]][])[1];
    expect(second?.[0]).toMatchObject({ startAddress: 0 });
    await app.emitState("polling");
    await app.pollUpdate(REGISTER_MAP_10);
    await app.expectPill("Polling", "activity");
    await app.expectNoBanner();
  });

  test("CHK-G5 unknown exception code 0x0C (UI side)", async ({ app }) => {
    await app.toState("exception", { extra: { exceptionCode: 12, consecutiveFailures: 1 } });
    await app.expectPill("Exception 0C", "octagon-x");
    await expect(app.banner.locator("p")).toHaveText(
      /^Exception 0C \(Unknown exception\) from slave 1 for FC03 at 0-9\./,
    );
  });

  test("CHK-G6 exception then timeout: counter text restarts at 1 in a row", async ({ app }) => {
    await app.toLive();
    await app.emitState("exception", { exceptionCode: 2 });
    await app.emitState("exception", { exceptionCode: 2 });
    await expect(app.banner).toContainText("(2 in a row)");
    await app.emitState("timeout");
    await app.expectPill("Timeout", "timer-off");
    await expect(app.banner).toContainText("Timeout: slave 1 did not respond");
    await expect(app.banner).toContainText("(1 in a row)");
  });
});

test.describe("H. bad response", () => {
  const retry = "Retrying every 1000 ms (1 in a row).";

  test("CHK-H1 TCP: unit ID rewritten to 2 (UI side)", async ({ app }) => {
    await app.toLive();
    await app.emitState("badResponse", {
      badResponseKind: "wrongSlave",
      badResponseDetail: { expected: 1, got: 2, message: "" },
      consecutiveFailures: 1,
    });
    await app.expectPill("Bad response", "triangle-alert");
    await expect(app.pill).toHaveAttribute("data-variant", "badResponse");
    await expect(app.pill).toHaveCSS("background-color", WARNING);
    await expect(app.banner).toHaveAttribute("data-variant", "warning");
    await expect(app.banner.locator("p")).toHaveText(
      `Bad response from slave 1: reply from slave 2, expected 1. ${retry}`,
    );
  });

  test("CHK-H1 RTU: CRC byte flipped (UI side)", async ({ app }) => {
    await app.toState("badResponse", {
      rtu: "COM3",
      extra: {
        badResponseKind: "crc",
        badResponseDetail: { expected: null, got: null, message: "" },
        consecutiveFailures: 1,
      },
    });
    await expect(app.banner.locator("p")).toHaveText(
      `Bad response from slave 1: CRC mismatch. ${retry}`,
    );
  });

  test("CHK-H2 corrupted RX row shows raw bytes, note in Info, Errors increments (UI side)", async ({
    app,
  }) => {
    const bytes = [1, 3, 4, 0, 1, 0, 2, 0xde, 0xad];
    await app.toState("badResponse", {
      extra: { badResponseKind: "crc", badResponseDetail: null, consecutiveFailures: 1 },
    });
    await app.frames([rxFrame(1, AT, bytes, { note: "CRC mismatch" })]);
    await app.counters({ requests: 1, responses: 0, errors: 1, timeouts: 0 });
    const row = app.frameRow(1);
    await expect(row).toContainText("01 03 04 00 01 00 02 DE AD");
    await expect(row).toContainText("CRC mismatch");
    await expect(row.getByRole("gridcell").nth(3)).toHaveText("9");
    await expect(app.counter("Errors")).toHaveText("1");
  });

  test("CHK-H3 corruption stops: back to polling", async ({ app }) => {
    await app.toState("badResponse", {
      extra: { badResponseKind: "crc", badResponseDetail: null, consecutiveFailures: 1 },
    });
    await app.emitState("polling");
    await app.pollUpdate(REGISTER_MAP_10);
    await app.expectPill("Polling", "activity");
    await app.expectNoBanner();
  });

  test("CHK-H4 timeout then bad response: triangle icon, never the timer icon", async ({ app }) => {
    await app.toLive();
    await app.emitState("timeout", { consecutiveFailures: 1 });
    await app.expectPill("Timeout", "timer-off");
    await app.emitState("badResponse", {
      badResponseKind: "malformed",
      badResponseDetail: { expected: null, got: null, message: "bad byte count" },
      consecutiveFailures: 1,
    });
    await app.expectPill("Bad response", "triangle-alert");
    await expect(app.pill.locator('[data-icon="timer-off"]')).toHaveCount(0);
    await expect(app.banner.locator('[data-icon="timer-off"]')).toHaveCount(0);
    await expect(app.banner.locator('[data-icon="triangle-alert"]')).toHaveCount(1);
  });

  test("CHK-H5 TCP short frame 20 of 29 bytes (UI side)", async ({ app }) => {
    await app.toLive();
    await app.emitState("badResponse", {
      badResponseKind: "shortFrame",
      badResponseDetail: { expected: 29, got: 20, message: "" },
      consecutiveFailures: 1,
    });
    await expect(app.banner.locator("p")).toHaveText(
      `Bad response from slave 1: short frame (20 of 29 bytes). ${retry}`,
    );
    const bytes = Array.from({ length: 20 }, (_, i) => i);
    await app.frames([rxFrame(1, AT, bytes, { note: "short frame" })]);
    await expect(app.frameRow(1).getByRole("gridcell").nth(3)).toHaveText("20");
    await app.counters({ requests: 1, responses: 0, errors: 1, timeouts: 0 });
    await app.counters({ requests: 2, responses: 0, errors: 2, timeouts: 0 });
    await expect(app.counter("Errors")).toHaveText("2");
    await expect(app.counter("Timeouts")).toHaveText("0");
  });

  test("CHK-H6 RTU short frame 20 of 25 bytes (UI side)", async ({ app }) => {
    await app.toState("badResponse", {
      rtu: "COM3",
      extra: {
        badResponseKind: "shortFrame",
        badResponseDetail: { expected: 25, got: 20, message: "" },
        consecutiveFailures: 1,
      },
    });
    await expect(app.banner.locator("p")).toHaveText(
      `Bad response from slave 1: short frame (20 of 25 bytes). ${retry}`,
    );
  });

  test("CHK-H7 consistent byte count mismatch is malformed, not short frame (UI side)", async ({ app }) => {
    await app.toState("badResponse", {
      extra: {
        badResponseKind: "malformed",
        badResponseDetail: { expected: null, got: null, message: "byte count 4 but 1 byte follows" },
        consecutiveFailures: 1,
      },
    });
    await expect(app.banner.locator("p")).toHaveText(
      /^Bad response from slave 1: malformed frame/,
    );
    await expect(app.banner).not.toContainText("short frame");
  });

  test("CHK-H8 function code rewritten to 04 (UI side)", async ({ app }) => {
    await app.toState("badResponse", {
      extra: {
        badResponseKind: "wrongFunction",
        badResponseDetail: { expected: 3, got: 4, message: "" },
        consecutiveFailures: 1,
      },
    });
    await expect(app.banner.locator("p")).toHaveText(
      `Bad response from slave 1: reply for FC04, expected FC03. ${retry}`,
    );
  });
});
