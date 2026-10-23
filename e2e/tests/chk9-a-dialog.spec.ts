// CHK-009 sections A and B (QA-030): the Format dialog, grouping and per-row format, edge addresses.
// Browser mode with the fake IPC. Item ids are in the test titles.
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
  REG,
  select,
  storedOverrides,
  table,
  viewCalls,
  warningLines,
  infoLines,
  previewRows,
  previewSummary,
  summary,
  widthHeading,
  widthReason,
} from "../support/chk9";

const U16 = (a: number, raw: number): [string, string, string] => [String(a), "U16", String(raw)];
const BASE_ROWS: Array<[string, string, string]> = REG.map((w, i) => U16(i, w));

async function expectDisabled(d: ReturnType<typeof formatDialog>) {
  await expect(applyButton(d)).toHaveAttribute("aria-disabled", "true");
}
async function expectEnabled(d: ReturnType<typeof formatDialog>) {
  await expect(applyButton(d)).not.toHaveAttribute("aria-disabled", "true");
}

test.describe("A dialog, grouping and per-row format", () => {
  for (const kind of ["workspace", "native"] as const) {
    test(`CHK9-01 [UI-B ${kind}] rows 2-5 become two Float 32-bit rows, the others are unchanged`, async ({ mm }) => {
      const h = await openHost(mm, kind);
      await expectTable(h, BASE_ROWS);
      const before = await table(h);
      await select(h, 2, 5);
      const d = await openFromMenu(h, 2);
      await radio(d, "Float 32-bit").check();
      await expect(radio(d, "Big-endian")).toBeChecked();
      await applyButton(d).click();
      await expectClosed(h);
      await expectTable(h, [
        U16(0, 1),
        U16(1, 2),
        ["2–3", "F32 ABCD", "12.5"],
        ["4–5", "F32 ABCD", "12.5"],
        U16(6, 0x00a1),
        U16(7, 0xfffe),
        U16(8, 9),
        U16(9, 10),
      ]);
      const after = await table(h);
      for (const [i, j] of [
        [0, 0],
        [1, 1],
        [6, 4],
        [7, 5],
        [8, 6],
        [9, 7],
      ] as const) {
        expect(after[j], `row ${i} is unchanged`).toEqual(before[i]);
      }
    });
  }

  test("CHK9-02 [UI-B] exactly one setPollView with only formatOverrides", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    const calls = await viewCalls(h);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      formatOverrides: [{ start: 2, end: 5, format: "float32", swapBytes: false, reverseWords: false }],
    });
    expect(Object.keys(calls[0]?.[1] ?? {})).toEqual(["formatOverrides"]);
  });

  test("CHK9-03 [UI-B] 3 rows + Float 32-bit: the 32-bit width is disabled with a reason, 16-bit formats still apply (D-010-01)", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 4);
    const d = await openFromMenu(h, 2);
    await expect(summary(d)).toHaveText("Selected 3 registers (2-4)");
    await expect(widthHeading(d, 32)).toHaveText("32-bit · unavailable (2 registers each)");
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers; 3 selected.");
    await expect(widthReason(d, 32).locator("svg")).toHaveCount(1);
    await expect(radio(d, "Float 32-bit")).toBeDisabled();
    await expect(radio(d, "Unsigned")).toBeChecked();
    expect(await warningLines(d)).toEqual([]);
    // Unsigned on Unsigned rows: only the "already use this format" note, never a rounding notice.
    expect(await infoLines(d)).toEqual(["The selected rows already use this format."]);
    await expectEnabled(d);
    await radio(d, "Hex").check();
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 4, "hex")]);
  });

  test("CHK9-05 [UI-B] 64-bit: 4 rows fit as they are, 5 rows disable the width", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 0, 4);
    let d = await openFromMenu(h, 0);
    await expect(widthReason(d, 64)).toHaveText("Needs a multiple of 4 registers; 5 selected.");
    await expect(radio(d, "Unsigned 64-bit")).toBeDisabled();
    await expectEnabled(d);
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await select(h, 0, 3);
    d = await openFromMenu(h, 0);
    await expect(widthHeading(d, 64)).toHaveText("64-bit · 1 value (4 registers each)");
    await radio(d, "Unsigned 64-bit").check();
    await expectEnabled(d);
    expect(await infoLines(d)).toEqual([]);
    await expect(previewSummary(d)).toHaveText("1 Unsigned 64-bit value, Big-endian (ABCDEFGH)");
  });

  test("CHK9-06 [UI-B] single row 7: both wider widths are disabled, Signed applies and shows -2", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 7);
    const d = await openFromMenu(h, 7);
    await expect(radio(d, "Float 32-bit")).toBeDisabled();
    await expect(radio(d, "Float 64-bit (Double)")).toBeDisabled();
    await radio(d, "Signed").check();
    await expectEnabled(d);
    await expect(previewSummary(d)).toHaveText("1 Signed value");
    await applyButton(d).click();
    await expectClosed(h);
    const rows = await table(h);
    expect(rows[7]).toEqual({ address: "7", format: "S16", raw: "-2" });
  });

  for (const kind of ["workspace", "native"] as const) {
    test(`CHK9-07 [UI-B ${kind}] Ctrl+A then Hex applies to every row`, async ({ mm }) => {
      const h = await openHost(mm, kind);
      await h.row(0).click();
      await h.page.keyboard.press("Control+a");
      const d = await openFromMenu(h, 0);
      await chooseAndApply(d, "Hex");
      await expectClosed(h);
      const rows = await table(h);
      expect(rows).toHaveLength(10);
      for (const r of rows) {
        expect(r.format).toBe("HEX");
        expect(r.raw).toMatch(/^0x[0-9A-F]{4}$/);
      }
      expect((await viewCalls(h))[0]?.[1]).toEqual({
        formatOverrides: [{ start: 0, end: 9, format: "hex", swapBytes: false, reverseWords: false }],
      });
    });
  }

  test("CHK9-09 [UI-B] Ctrl+A on 125 registers: 32/64-bit are unavailable, 124 rows give 62 values", async ({ mm }) => {
    const values = Array.from({ length: 125 }, (_, i) => i);
    const h = await openHost(mm, "workspace", { qty: 125, values });
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    let d = await openFromKeyboard(h);
    await expect(summary(d)).toHaveText("Selected 125 registers (0-124)");
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers; 125 selected.");
    await expect(widthReason(d, 64)).toHaveText("Needs a multiple of 4 registers; 125 selected.");
    await expectEnabled(d);
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    // Rows 0-123: click row 0 and extend with Shift+ArrowDown 123 times.
    await h.row(0).click();
    for (let i = 0; i < 123; i++) await h.page.keyboard.press("Shift+ArrowDown");
    d = await openFromKeyboard(h);
    await expect(widthHeading(d, 32)).toHaveText("32-bit · 62 values (2 registers each)");
    await radio(d, "Float 32-bit").check();
    await expectEnabled(d);
    await expect(previewSummary(d)).toHaveText("62 Float 32-bit values, Big-endian (ABCD)");
    await expect(d.getByTestId("format-preview-more")).toHaveText("… and 54 more values");
  });

  test("CHK9-10 [UI-B] non-contiguous valid selection makes two overrides, not merged", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await h.row(2).click();
    await h.row(3).click({ modifiers: ["Shift"] });
    await ctrlClick(h, 6);
    await ctrlClick(h, 7);
    await ctrlClick(h, 8);
    await ctrlClick(h, 9);
    const d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    const rows = await table(h);
    expect(rows.map((r) => `${r.address}:${r.format}`)).toEqual([
      "0:U16",
      "1:U16",
      "2–3:F32 ABCD",
      "4:U16",
      "5:U16",
      "6–7:F32 ABCD",
      "8–9:F32 ABCD",
    ]);
    expect(rows[2]?.raw).toBe("12.5");
    expect(rows[3]?.raw).toBe("16712");
    expect(await storedOverrides(h)).toEqual([ov(2, 3, "float32"), ov(6, 9, "float32")]);
  });

  test("CHK9-11 [UI-B] non-contiguous selection: every block must be a multiple, the reason names the blocks", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await h.row(1).click();
    await h.row(3).click({ modifiers: ["Shift"] });
    await ctrlClick(h, 6);
    await ctrlClick(h, 7);
    await ctrlClick(h, 8);
    const d = await openFromMenu(h, 1);
    await expect(summary(d)).toHaveText("Selected 6 registers (1-3, 6-8)");
    await expect(widthReason(d, 32)).toHaveText(
      "Needs a multiple of 2 registers in each block; rows 1-3 have 3, rows 6-8 have 3.",
    );
    expect(await warningLines(d)).toEqual([]);
    expect(await infoLines(d)).toEqual(["The selected rows already use this format."]);
    await expectEnabled(d);
  });

  test("CHK9-12 [UI-B] Ctrl+click of adjacent rows is one block", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await h.row(2).click();
    await ctrlClick(h, 3);
    const d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    const rows = await table(h);
    expect(rows.filter((r) => r.address === "2–3")).toEqual([{ address: "2–3", format: "F32 ABCD", raw: "12.5" }]);
    expect(await storedOverrides(h)).toEqual([ov(2, 3, "float32")]);
  });

  test("CHK9-13 [UI-B] selections containing group rows regroup the whole block", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 5, "float32")] });
    await expectTable(h, [
      U16(0, 1),
      U16(1, 2),
      ["2–3", "F32 ABCD", "12.5"],
      ["4–5", "F32 ABCD", "12.5"],
      U16(6, 0x00a1),
      U16(7, 0xfffe),
      U16(8, 9),
      U16(9, 10),
    ]);
    await select(h, 2, 3);
    let d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 64-bit (Double)");
    await expectClosed(h);
    const rows = await table(h);
    expect(rows.filter((r) => r.address === "2–5")).toHaveLength(1);
    expect(rows.find((r) => r.address === "2–5")?.format).toBe("F64 ABCDEFGH");
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float64")]);
    // Second case on a fresh page: 2-3, 4-5, 6 and 7 selected, then Hex.
    const h2 = await openHost(mm, "workspace", { formatOverrides: [ov(2, 5, "float32")] });
    await select(h2, 2, 5);
    d = await openFromMenu(h2, 2);
    await chooseAndApply(d, "Hex");
    await expectClosed(h2);
    const rows2 = await table(h2);
    expect(rows2.map((r) => r.address)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(rows2.slice(2, 8).map((r) => r.format)).toEqual(Array(6).fill("HEX"));
  });

  test("CHK9-14 [UI-B] a Hex format inside one Float 32-bit override splits it", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(0, 7, "float32")] });
    await select(h, 1);
    const d = await openFromMenu(h, 1);
    await radio(d, "Hex").check();
    await expect(previewSummary(d)).toHaveText("2 Hex values");
    expect(await previewRows(d)).toEqual([
      ["2", "0x4148"],
      ["3", "0x0000"],
    ]);
    await applyButton(d).click();
    await expectClosed(h);
    const rows = await table(h);
    expect(rows.map((r) => `${r.address}:${r.format}`)).toEqual([
      "0–1:F32 ABCD",
      "2:HEX",
      "3:HEX",
      "4–5:F32 ABCD",
      "6–7:F32 ABCD",
      "8:U16",
      "9:U16",
    ]);
    expect((await viewCalls(h))[0]?.[1]).toEqual({
      formatOverrides: [ov(0, 1, "float32"), ov(2, 3, "hex"), ov(4, 7, "float32")],
    });
  });

  test("CHK9-15 [UI-B] the default format is not stored", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(0, 9, "hex")] });
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    const d = await openFromMenu(h, 0);
    await chooseAndApply(d, "Unsigned");
    await expectClosed(h);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [] });
    await expectTable(h, BASE_ROWS);
  });

  test("CHK9-16 [UI-B] merge of equal neighbours; different flags do not merge", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(0, 1, "float32"), ov(4, 5, "float32")] });
    await select(h, 1, 2);
    const d = await openFromMenu(h, 1);
    await chooseAndApply(d, "Float 32-bit", "Big-endian");
    await expectClosed(h);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [ov(0, 5, "float32")] });
    const h2 = await openHost(mm, "workspace", { formatOverrides: [ov(0, 1, "float32"), ov(4, 5, "float32")] });
    await select(h2, 1, 2);
    const d2 = await openFromMenu(h2, 1);
    await chooseAndApply(d2, "Float 32-bit", "Little-endian");
    await expectClosed(h2);
    expect((await viewCalls(h2))[0]?.[1]).toEqual({
      formatOverrides: [ov(0, 1, "float32"), ov(2, 3, "float32", true, true), ov(4, 5, "float32")],
    });
  });

  test("CHK9-17 [UI-B] unchanged: info text, Apply closes without IPC, profile not Modified", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
    expect(await mm.modified()).toBe(false);
    await select(h, 2);
    const d = await openFromMenu(h, 2);
    await expect(radio(d, "Float 32-bit")).toBeChecked();
    await expect(radio(d, "Big-endian")).toBeChecked();
    await expect(messages(d)).toContainText("The selected rows already use this format.");
    await applyButton(d).click();
    await expectClosed(h);
    expect(await viewCalls(h)).toHaveLength(0);
    expect(await mm.modified()).toBe(false);
    // Control: a real change marks the profile Modified.
    await select(h, 3);
    const d2 = await openFromMenu(h, 3);
    await chooseAndApply(d2, "Hex");
    await expectClosed(h);
    await expect.poll(() => mm.modified()).toBe(true);
  });

  test("CHK9-18 [UI-B] mixed scope: opens on the common 16-bit format with the mixed note and Apply on (no state N)", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
    await select(h, 1, 2);
    const d = await openFromMenu(h, 1);
    await expect(messages(d)).toHaveText(
      "The selected rows use different formats. The format you apply replaces all of them.",
    );
    // Row 1 is Unsigned and rows 2-3 are one Float 32-bit group: Unsigned is the common 16-bit format.
    await expect(radio(d, "Unsigned")).toBeChecked();
    await expect(radio(d, "Unsigned")).toBeFocused();
    await expectEnabled(d);
    await radio(d, "Hex").check();
    await expectEnabled(d);
  });

  test("CHK9-19 [UI-B] order choices per width; a 16-bit format hides the order and stores no flags", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 0, 3);
    const d = await openFromMenu(h, 0);
    const order = d.getByTestId("order-group");
    await expect(order).toHaveCount(0);
    await radio(d, "Unsigned 32-bit").check();
    const names32 = [
      ["Big-endian", "ABCD"],
      ["Little-endian", "DCBA"],
      ["Big-endian byte swap", "BADC"],
      ["Little-endian byte swap", "CDAB"],
    ] as const;
    for (const [name, pattern] of names32) {
      await expect(radio(d, name)).toBeVisible();
      await expect(order.locator("label").filter({ has: h.page.getByRole("radio", { name, exact: true }) })).toContainText(pattern);
    }
    await radio(d, "Unsigned 64-bit").check();
    const patterns64 = ["ABCDEFGH", "HGFEDCBA", "BADCFEHG", "GHEFCDAB"];
    for (const [i, [name]] of names32.entries()) {
      await expect(order.locator("label").filter({ has: h.page.getByRole("radio", { name, exact: true }) })).toContainText(patterns64[i] ?? "");
    }
    // Little-endian chosen, then a 16-bit format: the order group is gone (not greyed) and stores no flags.
    await radio(d, "Little-endian").check();
    await radio(d, "Hex").check();
    await expect(order).toHaveCount(0);
    await expect(radio(d, "Little-endian")).toHaveCount(0);
    await expect(d.getByText("Order applies to 32-bit and 64-bit formats.")).toHaveCount(0);
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 3, "hex", false, false)]);
  });

  test("CHK9-20 [UI-B fake data] order mapping of 0x1234 0x5678 and the stored flags", async ({ mm }) => {
    const cases: Array<[string, string, boolean, boolean]> = [
      ["Big-endian", "305419896", false, false],
      ["Little-endian", "2018915346", true, true],
      ["Big-endian byte swap", "873625686", true, false],
      ["Little-endian byte swap", "1450709556", false, true],
    ];
    for (const [order, value, swapBytes, reverseWords] of cases) {
      const h = await openHost(mm, "workspace", { qty: 4, values: [0x0000, 0x0000, 0x1234, 0x5678] });
      await select(h, 2, 3);
      const d = await openFromMenu(h, 2);
      await chooseAndApply(d, "Unsigned 32-bit", order);
      await expectClosed(h);
      await expectTable(h, [U16(0, 0), U16(1, 0), ["2–3", `U32 ${patternOf(order)}`, value]]);
      expect(await storedOverrides(h), order).toEqual([ov(2, 3, "unsigned32", swapBytes, reverseWords)]);
    }
  });

  test("CHK9-22 [UI-B] preview section and inline values", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    // Four 16-bit rows: the 16-bit format is checked, one preview line per register.
    await expect(previewSummary(d)).toHaveText("4 Unsigned values");
    await radio(d, "Float 32-bit").check();
    await expect(previewSummary(d)).toHaveText("2 Float 32-bit values, Big-endian (ABCD)");
    expect(await previewRows(d)).toEqual([
      ["2-3", "12.5"],
      ["4-5", "12.5"],
    ]);
    await expect(d.getByTestId("preview-float32")).toHaveText("12.5");
    await expect(d.getByTestId("preview-hex")).toHaveText("0x4148");
    await expect(d.getByTestId("preview-unsigned")).toHaveText("16712");
    await radio(d, "Unsigned 32-bit").check();
    await expect(d.getByTestId("order-preview-big")).toHaveText("1095237632");
    await expect(d.getByTestId("order-preview-little")).not.toHaveText("1095237632");
    // Previews are not inside a live region.
    for (const id of ["preview-float32", "order-preview-big", "format-preview"]) {
      const inLive = await d.getByTestId(id).evaluate((e) => !!e.closest("[aria-live]"));
      expect(inLive, id).toBe(false);
    }
  });

  test("CHK9-24 [UI-B] 256 cap shows the error with the circle-x icon and disables Apply", async ({ mm }) => {
    const many = Array.from({ length: 255 }, (_, i) => ov(1000 + 2 * i, 1000 + 2 * i, "hex"));
    const h = await openHost(mm, "workspace", { formatOverrides: many });
    await h.row(0).click();
    await ctrlClick(h, 2);
    const d = await openFromMenu(h, 0);
    await radio(d, "Hex").check();
    const err = d.getByText("A poll can have at most 256 format overrides. This change would create 257. Select fewer separate blocks.");
    await expect(err).toBeVisible();
    await expect(d.locator('[role="alert"] [data-icon="circle-x"]')).toHaveCount(1);
    await expectDisabled(d);
    await applyButton(d).click({ force: true });
    expect(await viewCalls(h)).toHaveLength(0);
  });
});

test.describe("B edge addresses and quantities", () => {
  test("CHK9-25 [UI-B] address 0: Signed stores {0,0,signed}; the 1-register poll has no 32/64-bit width", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { qty: 1, values: [0xfffe] });
    await select(h, 0);
    let d = await openFromMenu(h, 0);
    await chooseAndApply(d, "Signed");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 0, "signed")]);
    await expectTable(h, [["0", "S16", "-2"]]);
    d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 1 register (0)");
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers; 1 selected.");
    await expect(radio(d, "Float 32-bit")).toBeDisabled();
    await expectEnabled(d);
  });

  test("CHK9-26 [UI-B fake] address 65535: no wrap, edge groups apply", async ({ mm }) => {
    let h = await openHost(mm, "workspace", { start: 65534, qty: 2, values: [0x4148, 0] });
    await select(h, 0, 1);
    let d = await openFromMenu(h, 0);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(65534, 65535, "float32")]);
    await expectTable(h, [["65534–65535", "F32 ABCD", "12.5"]]);
    h = await openHost(mm, "workspace", { start: 65532, qty: 4, values: [0x3ff0, 0, 0, 0] });
    await select(h, 0, 3);
    d = await openFromMenu(h, 0);
    await chooseAndApply(d, "Float 64-bit (Double)");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(65532, 65535, "float64")]);
    await expectTable(h, [["65532–65535", "F64 ABCDEFGH", "1"]]);
    h = await openHost(mm, "workspace", { start: 65535, qty: 1, values: [1] });
    await select(h, 0);
    d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 1 register (65535)");
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers; 1 selected.");
    await expect(radio(d, "Float 32-bit")).toBeDisabled();
    expect(await warningLines(d)).toEqual([]);
    await expectEnabled(d);
    expect(await storedOverrides(h)).toEqual([]);
  });

  test("CHK9-27 [UI-B] address base 1 shows 1-based ranges, stored overrides unchanged", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 2, 5);
    let d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    await h.grid.focus();
    await h.page.keyboard.press("Control+b");
    await expect(h.grid.getByRole("columnheader", { name: /^Address \(1-based\)/ })).toBeVisible();
    const rows = await table(h);
    expect(rows.map((r) => r.address)).toContain("3–4");
    expect(rows.map((r) => r.address)).toContain("5–6");
    await select(h, 2, 3);
    d = await openFromMenu(h, 2);
    await expect(summary(d)).toHaveText("Selected 4 registers (3-6)");
    await expect(d.getByRole("columnheader", { name: "Address (1-based)" })).toBeVisible();
    await d.getByRole("button", { name: "Cancel" }).click();
    expect(await storedOverrides(h)).toEqual([ov(2, 5, "float32")]);
  });

  test("CHK9-28 [UI-B] Quantity 125: 63 rows; FC04 the same; Quantity 1 with a 64-bit override is Incomplete", async ({ mm }) => {
    const overrides = [ov(0, 123, "float32")];
    for (const fc of [3, 4] as const) {
      const h = await openHost(mm, "workspace", {
        fc,
        qty: 125,
        formatOverrides: overrides,
        values: Array.from({ length: 125 }, (_, i) => i),
      });
      await expect(h.grid).toHaveAttribute("aria-rowcount", "64"); // header + 63 rows
    }
    const h = await openHost(mm, "workspace", { start: 10, qty: 1, formatOverrides: [ov(10, 13, "unsigned64")], values: [1] });
    await expectTable(h, [["10", "U64 ABCDEFGH", "Incomplete"]]);
    await expect(h.grid.getByRole("img", { name: "Needs 4 registers; only 1 available." })).toBeVisible();
  });
});

// ---- helpers local to this file ----
function patternOf(order: string): string {
  return { "Big-endian": "ABCD", "Little-endian": "DCBA", "Big-endian byte swap": "BADC", "Little-endian byte swap": "CDAB" }[order] ?? "";
}

export type { Host };
