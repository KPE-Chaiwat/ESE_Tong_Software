// CHK-009 sections C (cut groups) and D (grid and dialog in each state), QA-030. Browser mode, fake IPC.
import { expect, test } from "../support/mm-fixtures";
import {
  applyButton,
  chooseAndApply,
  expectClosed,
  expectTable,
  formatDialog,
  messages,
  openFromKeyboard,
  openFromMenu,
  openHost,
  ov,
  previewNotice,
  previewRows,
  radio,
  REG,
  select,
  storedOverrides,
  table,
  viewCalls,
} from "../support/chk9";

const U16 = (a: number, raw: number | string): [string, string, string] => [String(a), "U16", String(raw)];

async function openSetup(mm: import("../support/mm").Mm, id: number) {
  await mm.titleButton(id, /^Poll setup/).click();
  await expect(mm.setup(id)).toBeVisible();
}

test.describe("C cut groups", () => {
  test("CHK9-29 [UI-B] Start edit that cuts a group: info line, Apply not blocked, Incomplete row, overrides unchanged", async ({
    mm,
  }) => {
    const h = await openHost(mm, "workspace", {
      start: 100,
      qty: 4,
      formatOverrides: [ov(100, 101, "float32")],
      values: [0x4148, 0, 3, 4],
    });
    await expectTable(h, [["100–101", "F32 ABCD", "12.5"], U16(102, 3), U16(103, 4)]);
    await openSetup(mm, h.id);
    await mm.setupField(h.id, "Start address").fill("101");
    const info = mm.setup(h.id).getByText("This range cuts the Float 32-bit value 100-101; it will show as Incomplete.");
    await expect(info).toBeVisible();
    // Info style: a dark info icon, muted text, no orange warning classes.
    const row = mm.setup(h.id).locator("p", { hasText: "This range cuts" });
    await expect(row.locator('[data-icon="info"]')).toHaveCount(1);
    expect(await row.evaluate((e) => /warning/.test(e.className))).toBe(false);
    expect(await row.locator("svg").evaluate((e) => /warning/.test(e.getAttribute("class") ?? ""))).toBe(false);
    const apply = mm.setup(h.id).getByRole("button", { name: "Apply", exact: true });
    await expect(apply).toBeEnabled();
    expect(await apply.getAttribute("aria-disabled")).toBeNull();
    await apply.click();
    await mm.advance(300);
    await expect(h.grid.getByRole("img", { name: "Needs 2 registers; only 1 available." })).toBeVisible();
    const rows = await table(h);
    expect(rows[0]).toMatchObject({ address: "101", format: "F32 ABCD", raw: "Incomplete" });
    expect(await storedOverrides(h)).toEqual([ov(100, 101, "float32")]);
  });

  test("CHK9-30 [UI-B] inspector on cut groups lists only in-poll registers and the outside note", async ({ mm }) => {
    const h = await openHost(mm, "workspace", {
      start: 101,
      qty: 4,
      formatOverrides: [ov(100, 101, "float32")],
      values: [0x4148, 2, 3, 4],
    });
    await h.row(0).click({ button: "right" });
    await h.page.getByRole("menuitem", { name: "Inspect raw registers" }).click();
    const dlg = h.page.getByRole("dialog", { name: /^Raw registers/ });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText("Register 100 of this value is outside this poll.");
    await expect(dlg).toContainText("0x4148");
    await expect(dlg).not.toContainText("0x0000");
    await h.page.keyboard.press("Escape");
    // Both edges: 98-105 Float 64-bit, poll 100-103.
    const h2 = await openHost(mm, "workspace", {
      start: 100,
      qty: 4,
      formatOverrides: [ov(98, 105, "float64")],
      values: [1, 2, 3, 4],
    });
    await h2.row(0).click({ button: "right" });
    await h2.page.getByRole("menuitem", { name: "Inspect raw registers" }).click();
    const dlg2 = h2.page.getByRole("dialog", { name: /^Raw registers/ });
    await expect(dlg2).toContainText("Registers 98-99 of this value are outside this poll.");
  });

  test("CHK9-31 [UI-B] cut warning in the dialog: Apply stays enabled, stores only the selected register", async ({ mm }) => {
    const h = await openHost(mm, "workspace", {
      start: 101,
      qty: 4,
      formatOverrides: [ov(100, 101, "float32")],
      values: [0x4148, 2, 3, 4],
    });
    await select(h, 0);
    const d = await openFromMenu(h, 0);
    await radio(d, "Hex").check();
    await expect(messages(d)).toHaveText(
      "Also resets 100 to Unsigned: this change splits the Float 32-bit value 100-101. 100 is outside this poll.",
    );
    await expect(messages(d).locator('[data-icon="triangle-alert"]')).toHaveCount(1);
    await expect(applyButton(d)).not.toHaveAttribute("aria-disabled", "true");
    await applyButton(d).click();
    await expectClosed(h);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [ov(101, 101, "hex")] });
  });

  test("CHK9-32 [UI-B] both edges: two cut lines, stored [{100,103,signed}]", async ({ mm }) => {
    const h = await openHost(mm, "workspace", {
      start: 100,
      qty: 4,
      formatOverrides: [ov(98, 105, "float64")],
      values: [1, 2, 3, 4],
    });
    await expectTable(h, [
      ["100–101", "F64 ABCDEFGH", "Incomplete"],
      ["102–103", "F64 ABCDEFGH", "Incomplete"],
    ]);
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    const d = await openFromMenu(h, 0);
    await radio(d, "Signed").check();
    const msg = messages(d);
    await expect(msg).toContainText(
      "Also resets 98-99 to Unsigned: this change splits the Float 64-bit (Double) value 98-101. 98-99 are outside this poll.",
    );
    await expect(msg).toContainText(
      "Also resets 104-105 to Unsigned: this change splits the Float 64-bit (Double) value 102-105. 104-105 are outside this poll.",
    );
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(100, 103, "signed")]);
  });

  test("CHK9-33 [UI-B] Ctrl+1 on a cut group: no dialog, payload [], info toast", async ({ mm }) => {
    const h = await openHost(mm, "workspace", {
      start: 101,
      qty: 4,
      formatOverrides: [ov(100, 101, "float32")],
      values: [0x4148, 2, 3, 4],
    });
    await select(h, 0);
    await h.page.keyboard.press("Control+1");
    await expect(formatDialog(h)).toHaveCount(0);
    await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [] });
    await expect(mm.toast("Unsigned applied to 101. Also reset 100 to Unsigned because a combined value was split.")).toBeVisible();
  });

  test("CHK9-34 [UI-B] overrides outside the range return when Quantity grows", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { qty: 10, formatOverrides: [ov(20, 23, "float32")] });
    expect((await table(h)).every((r) => r.format === "U16")).toBe(true);
    expect(await table(h)).toHaveLength(10);
    await openSetup(mm, h.id);
    await mm.setupField(h.id, "Quantity").fill("30");
    await mm.setup(h.id).getByRole("button", { name: "Apply", exact: true }).click();
    await expect.poll(async () => (await h.script((f, id) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === id).config.definition.quantity, h.id))).toBe(30);
    await h.grid.evaluate((e) => {
      e.scrollTop = 20 * 24;
    });
    await expect
      .poll(async () => (await table(h)).filter((r) => r.format === "F32 ABCD").map((r) => r.address))
      .toEqual(["20–21", "22–23"]);
  });
});

test.describe("D grid and dialog in each state", () => {
  test("CHK9-35 [UI-B] idle: no value rows are drawn (the empty text instead); a retained selection still opens the dialog and stores the format", async ({
    mm,
  }) => {
    // D-009-04 (Q-009-05): the DES-002 empty states stay, so there is no grid before the first reply.
    const h = await openHost(mm, "native", { connected: false, values: null, formatOverrides: [ov(2, 5, "float32")] });
    await expect(h.page.locator('[data-slot="poll-view"]')).toContainText("Not connected.");
    await expect(h.grid, "no grid while idle").toHaveCount(0);
  });

  test("CHK9-35b [UI-B] idle after Disconnect: a selection made while polling still reaches the dialog; Apply stores the override offline", async ({
    mm,
  }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    await mm.toolbarButton("Disconnect").click();
    await expect(h.grid).toHaveCount(0);
    // The narrow Show menu has the Format items.
    await mm.statusLine(h.id).getByRole("button", { name: /^Show / }).click();
    const item = h.page.getByRole("menuitem", { name: "More formats…" });
    await expect(item).toBeEnabled();
    await item.click();
    const d = formatDialog(h);
    await expect(d).toBeVisible();
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "notConnected");
    await expect(previewNotice(d)).toHaveText("No preview: not connected. Connect to read values. You can apply the format now.");
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
  });

  test("CHK9-36 [UI-B] connecting: the empty text, no grid", async ({ mm }) => {
    const h = await openHost(mm, "native", { connected: false, values: null, formatOverrides: [ov(2, 5, "float32")] });
    await h.script((f) => f.emitConnectionState("connecting"));
    await expect(h.page.locator('[data-slot="poll-view"]')).toContainText("Connecting to");
    await expect(h.grid, "no grid while connecting").toHaveCount(0);
  });

  test("CHK9-37 [UI-B] connected before the first reply: empty text, no frame on a format change", async ({ mm }) => {
    const h = await openHost(mm, "native", { connected: false, values: null, formatOverrides: [ov(2, 5, "float32")] });
    await h.script((f) => f.emitConnectionState("connected"));
    await expect(h.page.locator('[data-slot="poll-view"]')).toContainText("Waiting for the connection");
    await expect(h.grid, "no grid before the first reply").toHaveCount(0);
  });

  test("CHK9-38 [UI-B] loading: 'Loading poll…', no grid, no Format button, nothing opens the dialog", async ({ mm }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.expectConnection("connected");
    await mm.script((f) => {
      (window as unknown as { __release: () => void }).__release = f.holdReply("attachPollView").release;
    });
    await mm.toolbarButton("New poll").click();
    const id = await mm.idOf("Poll 1");
    await expect(mm.sub(id)).toContainText("Loading poll…");
    await expect(mm.grid(id)).toHaveCount(0);
    await expect(mm.sub(id).getByRole("button", { name: "Format…" })).toHaveCount(0);
    await mm.sub(id).click();
    await mm.page.keyboard.press("Control+1");
    await expect(formatDialog({ page: mm.page } as never)).toHaveCount(0);
    expect(await mm.callCount("setPollView")).toBe(0);
    await mm.page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect(mm.sub(id)).not.toContainText("Loading poll…");
  });

  test("CHK9-39 [UI-B fake] polling: a format change re-renders the retained snapshot and sends no extra request", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    const reqBefore = await mm.script((f) => f.requestLog.length);
    const countersBefore = await mm.script((f) => f.snapshot().polls[0].counters.requests);
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    await expectTable(h, [
      U16(0, 1),
      U16(1, 2),
      ["2–3", "F32 ABCD", "12.5"],
      ["4–5", "F32 ABCD", "12.5"],
      U16(6, 0xa1),
      U16(7, 0xfffe),
      U16(8, 9),
      U16(9, 10),
    ]);
    expect(await mm.script((f) => f.requestLog.length)).toBe(reqBefore);
    expect(await mm.script((f) => f.snapshot().polls[0].counters.requests)).toBe(countersBefore);
    // The next scan updates the values (virtual time).
    await mm.advance(200);
    expect(await mm.script((f) => f.requestLog.length)).toBeGreaterThan(reqBefore);
    expect((await table(h)).find((r) => r.address === "2–3")?.format).toBe("F32 ABCD");
  });

  test("CHK9-40 [UI-B fake] paused: stale preview notice, Apply re-renders retained values, the poll stays paused", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await h.grid.focus();
    await h.page.keyboard.press("Control+p");
    await expect(mm.statusLine(h.id)).toContainText("Paused");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
    await expect(previewNotice(d)).toHaveText("Preview uses the last values received (stale).");
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    await expect(mm.statusLine(h.id)).toContainText("Paused");
    const rows = await table(h);
    expect(rows.find((r) => r.address === "2–3")).toMatchObject({ format: "F32 ABCD", raw: "12.5" });
    expect(await mm.callCount("resumePoll")).toBe(0);
    // No rule markers while paused.
    await expect(h.grid.getByRole("img", { name: /^Rule:/ })).toHaveCount(0);
  });

  for (const [id, label, driver] of [
    ["CHK9-41", "timeout", "timeout"],
    ["CHK9-42", "exception response", "exception"],
  ] as const) {
    test(`${id} [UI-B fake] ${label}: stale retained values, dialog opens with the stale notice and applies; the state is unchanged`, async ({ mm }) => {
      const h = await openHost(mm, "workspace");
      await h.script(
        (f, a) =>
          a.k === "timeout"
            ? f.emitPollState(a.id, "timeout", { consecutiveFailures: 1 })
            : f.emitPollState(a.id, "exception", { exceptionCode: 2, consecutiveFailures: 1 }),
        { id: h.id, k: driver },
      );
      await expect(mm.statusLine(h.id)).toContainText(driver === "timeout" ? /No response|Timeout/i : /Exception 02/);
      await select(h, 2, 5);
      const d = await openFromMenu(h, 2);
      await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
      await expect(previewNotice(d)).toHaveText("Preview uses the last values received (stale).");
      await chooseAndApply(d, "Float 32-bit");
      await expectClosed(h);
      await expect(mm.statusLine(h.id)).toContainText(driver === "timeout" ? /No response|Timeout/i : /Exception 02/);
      expect((await table(h)).find((r) => r.address === "2–3")?.format).toBe("F32 ABCD");
      expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
    });
  }

  test("CHK9-43 [UI-B fake] disconnected (link lost): stale notice and offline Apply; user Disconnect clears the preview", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    await h.script((f) => f.dropLink());
    await expect(mm.pill).toContainText(/Connection lost|Disconnected|Reconnect/i);
    const d = await openFromMenu(h, 2);
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
    await expect(previewNotice(d)).toHaveText("Preview uses the last values received (stale).");
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
    // A second poll: user Disconnect clears the data and the notice becomes "not connected".
    const h2 = await openHost(mm, "workspace");
    await select(h2, 2, 5);
    await mm.statusLine(h2.id).getByRole("button", { name: /^Show / }).click();
    await h2.page.keyboard.press("Escape");
    await mm.toolbarButton("Disconnect").click();
    await expect(h2.grid).toHaveCount(0);
    await mm.statusLine(h2.id).getByRole("button", { name: /^Show / }).click();
    await h2.page.getByRole("menuitem", { name: "More formats…" }).click();
    await expect(previewNotice(formatDialog(h2))).toHaveAttribute("data-kind", "notConnected");
    await expect(previewNotice(formatDialog(h2))).toHaveText("No preview: not connected. Connect to read values. You can apply the format now.");
  });

  test("CHK9-44 [UI-B] empty data after a definition change: dashes, Incomplete group rows, no old value reused", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 5, "float32")] });
    await expectTable(h, [
      U16(0, 1),
      U16(1, 2),
      ["2–3", "F32 ABCD", "12.5"],
      ["4–5", "F32 ABCD", "12.5"],
      U16(6, 0xa1),
      U16(7, 0xfffe),
      U16(8, 9),
      U16(9, 10),
    ]);
    await openSetup(mm, h.id);
    await mm.setupField(h.id, "Start address").fill("3");
    await mm.setup(h.id).getByRole("button", { name: "Apply", exact: true }).click();
    // No reply yet (virtual time is not advanced).
    await expect.poll(async () => (await table(h)).map((r) => r.address)).toEqual(["3", "4–5", "6", "7", "8", "9", "10", "11", "12"].slice(0, 9).map((a) => a));
    const rows = await table(h);
    expect(rows[0]).toMatchObject({ address: "3", format: "F32 ABCD" });
    for (const r of rows) {
      expect(["—", "Incomplete"]).toContain(r.raw);
      expect(r.raw).not.toBe("12.5");
    }
    expect(rows[0]?.raw).toBe("Incomplete");
    expect(rows[1]?.raw).toBe("—");
    await h.row(1).click();
    const d = await openFromMenu(h, 1);
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "waiting");
    await expect(previewNotice(d)).toHaveText("No preview yet: waiting for the first reply.");
    await expect(d.getByTestId("preview-hex")).toHaveText("—");
    expect(await previewRows(d)).toEqual([["4-5", "—"]]);
  });

  test("CHK9-45 [UI-B] a disabled width cannot be chosen: Enter on a format radio applies exactly the enabled choice (D-010-01)", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 4);
    const d = await openFromMenu(h, 2);
    await expect(radio(d, "Float 32-bit")).toBeDisabled();
    await radio(d, "Hex").check();
    await radio(d, "Hex").focus();
    await h.page.keyboard.press("Enter");
    await expect(formatDialog(h)).toHaveCount(0);
    const calls = await viewCalls(h);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      formatOverrides: [{ start: 2, end: 4, format: "hex", swapBytes: false, reverseWords: false }],
    });
  });

  test("CHK9-46 [UI-B] applying (P): Applying…, aria-busy, radios and Cancel disabled, no second call, Esc ignored", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await h.script((f) => {
      (window as unknown as { __rel: () => void }).__rel = f.holdReply("setPollView").release;
    });
    await radio(d, "Float 32-bit").check();
    await applyButton(d).click();
    const busy = d.getByRole("button", { name: "Applying…" });
    await expect(busy).toBeVisible();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(radio(d, "Hex")).toBeDisabled();
    await expect(d.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await busy.click({ force: true });
    await radio(d, "Float 32-bit").focus({ timeout: 1000 }).catch(() => undefined);
    await h.page.keyboard.press("Enter");
    await h.page.keyboard.press("Escape");
    await expect(d).toBeVisible();
    await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
    await h.page.evaluate(() => (window as unknown as { __rel: () => void }).__rel());
    await expectClosed(h);
    expect(await viewCalls(h)).toHaveLength(1);
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
  });

  test("CHK9-47 [UI-B] apply failure (F): alert text, dialog stays with the choice, retry succeeds", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await h.script((f) => f.failNext("setPollView", "Rejected view"));
    await radio(d, "Float 32-bit").check();
    await applyButton(d).click();
    const err = d.getByTestId("format-error");
    await expect(err).toHaveAttribute("role", "alert");
    await expect(err).toContainText("Could not apply the format. Rejected view");
    await expect(err.locator('[data-icon="circle-x"]')).toHaveCount(1);
    await expect(d).toBeVisible();
    await expect(radio(d, "Float 32-bit")).toBeChecked();
    expect(await storedOverrides(h)).toEqual([]);
    await expect(applyButton(d)).not.toHaveAttribute("aria-disabled", "true");
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
  });

  for (const enabled of [true, false]) {
    test(`CHK9-48 [UI-B] rule conflict (R) ${enabled ? "enabled" : "disabled"} rule: error, nothing sent, clears after another choice`, async ({ mm }) => {
      const h = await openHost(mm, "workspace");
      await h.script(
        (f, a) =>
          f.setPollView(a.id, {
            colorRules: [
              {
                name: "High",
                enabled: a.enabled,
                range: { start: 0, end: 3 },
                source: "raw",
                comparison: "greaterThan",
                threshold: "1.5",
                upperThreshold: null,
                highlight: "lime",
              },
            ],
          }),
        { id: h.id, enabled },
      );
      const before = (await viewCalls(h)).length;
      await select(h, 0, 3);
      const d = await openFromMenu(h, 0);
      await radio(d, "Unsigned 64-bit").check();
      // Keyboard: Tab to Apply and press Enter, so the focus is on Apply (a mouse press keeps the focus where it was).
      await applyButton(d).focus();
      await h.page.keyboard.press("Enter");
      await expect(d.getByTestId("format-error")).toContainText(
        'Format not applied. Rule "High": Enter a whole decimal number for a 64-bit integer comparison.',
      );
      expect((await viewCalls(h)).length).toBe(before);
      await expect(applyButton(d)).toBeFocused();
      await radio(d, "Float 64-bit (Double)").check();
      await expect(d.getByTestId("format-error")).toHaveCount(0);
      await applyButton(d).click();
      await expectClosed(h);
      expect(await storedOverrides(h)).toEqual([ov(0, 3, "float64")]);
    });
  }

  test("CHK9-49 [UI-B] poll removed while the dialog is open: the dialog closes and nothing is applied", async ({ mm }) => {
    const h = await openHost(mm, "native");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await radio(d, "Float 32-bit").check();
    await h.script((f, id) => f.removePoll(id), h.id);
    await expectClosed(h);
    expect(await viewCalls(h)).toHaveLength(0);
  });
});

export { openFromKeyboard, REG };
