// CHK-010 (FE-010 task 08): the redesigned Format dialog D1 (selection summary, computed width headings,
// disabled widths with reasons, order group only for 32/64-bit, Preview section) and the Value format
// section of the row menu G2. Browser mode with the fake IPC; the [UI-B] items of CHK-010 only.
// [UI-R] real-window and [SIM] simulator parts are not covered here. Item ids are in the test titles.
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
  infoLines,
  messages,
  openFromKeyboard,
  openFromMenu,
  openHost,
  ov,
  previewNotice,
  previewRows,
  previewSummary,
  radio,
  select,
  storedOverrides,
  summary,
  table,
  viewCalls,
  warningLines,
  widthHeading,
  widthReason,
} from "../support/chk9";

/** Fixture F10: registers 0-9 of CHK-010. Rows 0-1 and 4-5 decode to 12.5 as Float 32-bit Big-endian. */
const F10 = [0x4148, 0x0000, 0x0000, 0x0000, 0x4148, 0x0000, 0x00a1, 0xfffe, 0x0009, 0x000a];
const HOSTS = ["workspace", "native"] as const;

/** Selects runs of rows (grid row index = register offset while no format override exists). */
async function pick(h: Host, ...runs: Array<[number, number]>): Promise<void> {
  const [first, ...rest] = runs;
  if (!first) return;
  await h.row(first[0]).click();
  if (first[1] !== first[0]) await h.row(first[1]).click({ modifiers: ["Shift"] });
  for (const [a, b] of rest) for (let i = a; i <= b; i++) await ctrlClick(h, i);
}

const openF10 = (mm: Parameters<typeof openHost>[0], kind: (typeof HOSTS)[number] = "workspace", extra = {}) =>
  openHost(mm, kind, { values: F10, ...extra });

async function enabled(d: Locator) {
  await expect(applyButton(d)).not.toHaveAttribute("aria-disabled", "true");
}

/** Right-clicks a grid row and returns the open row menu. */
async function rowMenu(h: Host, row: number): Promise<Locator> {
  await h.row(row).click({ button: "right" });
  const menu = h.page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  return menu;
}

/** The accessible label of the element that has focus. */
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

/** Text of the elements an `aria-describedby` points at. */
async function describedBy(el: Locator): Promise<string> {
  return el.evaluate((e) =>
    (e.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" | "),
  );
}

async function collapseSetupPopover(h: Host): Promise<void> {
  const popover = h.page.locator('[data-slot="setup-popover"]');
  if (await popover.isVisible().catch(() => false)) {
    await h.win?.rail.click();
    await expect(popover).toBeHidden();
  }
}

// ---------------------------------------------------------------------------------------------
// A. Selection summary (AC 1)
// ---------------------------------------------------------------------------------------------
test.describe("A selection summary", () => {
  for (const kind of HOSTS) {
    test(`CHK10-01 [UI-B ${kind}] 10 rows: Selected 10 registers (0-9), part of the dialog description`, async ({ mm }) => {
      const h = await openF10(mm, kind);
      await h.row(0).click();
      await h.page.keyboard.press("Control+a");
      const d = await openFromMenu(h, 0);
      await expect(summary(d)).toHaveText("Selected 10 registers (0-9)");
      expect(await describedBy(d)).toContain("Selected 10 registers (0-9)");
      expect(await describedBy(d)).toContain("Applies to the selected rows only.");
    });
  }

  test("CHK10-02 [UI-B] address base 1: Selected 10 registers (1-10) and Address (1-based)", async ({ mm }) => {
    const h = await openF10(mm);
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    let d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 10 registers (0-9)");
    await expect(d.getByRole("columnheader", { name: "Address (0-based)" })).toBeVisible();
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await h.page.keyboard.press("Control+b");
    await expect(h.grid.getByRole("columnheader", { name: /^Address \(1-based\)/ })).toBeVisible();
    d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 10 registers (1-10)");
    await expect(d.getByRole("columnheader", { name: "Address (1-based)" })).toBeVisible();
  });

  test("CHK10-03 [UI-B] non-contiguous rows 0-1 and 4-6 list both blocks, in base 1 too", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 1], [4, 6]);
    let d = await openFromMenu(h, 4);
    await expect(summary(d)).toHaveText("Selected 5 registers (0-1, 4-6)");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await h.page.keyboard.press("Control+b");
    d = await openFromMenu(h, 4);
    await expect(summary(d)).toHaveText("Selected 5 registers (1-2, 5-7)");
  });

  test("CHK10-04 [UI-B] a Float 32-bit group row counts both registers", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
    await h.row(2).click();
    const d = await openFromMenu(h, 2);
    await expect(summary(d)).toHaveText("Selected 2 registers (2-3)");
    await expect(summary(d)).not.toContainText("1 register");
  });

  test("CHK10-05 [UI-B] a single row 7", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 7);
    const d = await openFromMenu(h, 7);
    await expect(summary(d)).toHaveText("Selected 1 register (7)");
  });

  test("CHK10-06 [UI-B] a long list of blocks is shortened after four", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { qty: 12, values: Array.from({ length: 12 }, (_, i) => i) });
    await pick(h, [0, 0], [2, 2], [4, 4], [6, 6], [8, 8], [10, 10]);
    let d = await openFromMenu(h, 10);
    await expect(summary(d)).toHaveText("Selected 6 registers (0, 2, 4, 6 and 2 more blocks)");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await pick(h, [0, 0], [2, 2], [4, 4], [6, 6], [8, 8]);
    d = await openFromMenu(h, 8);
    await expect(summary(d)).toHaveText("Selected 5 registers (0, 2, 4, 6 and 1 more block)");
  });

  test("CHK10-07 [UI-B] edge addresses: 65535 (65536 in base 1) and 0, never address 0 by mistake", async ({ mm }) => {
    let h = await openHost(mm, "workspace", { start: 65535, qty: 1, values: [1] });
    await select(h, 0);
    let d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 1 register (65535)");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    h = await openHost(mm, "workspace", { start: 65535, qty: 1, values: [1], display: { addressBase: 1 } });
    await select(h, 0);
    d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 1 register (65536)");
    await expect(d).not.toContainText("(0)");
    await d.getByRole("button", { name: "Cancel" }).click();
    h = await openHost(mm, "workspace", { start: 0, qty: 1, values: [1] });
    await select(h, 0);
    d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 1 register (0)");
  });

  test("CHK10-08 [UI-B] quantity 125, Ctrl+A", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { qty: 125, values: Array.from({ length: 125 }, (_, i) => i) });
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    const d = await openFromKeyboard(h);
    await expect(summary(d)).toHaveText("Selected 125 registers (0-124)");
  });
});

// ---------------------------------------------------------------------------------------------
// B. Width headings and disabled widths (AC 2, AC 3)
// ---------------------------------------------------------------------------------------------
const W16 = (n: number) => `16-bit · ${n} ${n === 1 ? "value" : "values"} (1 register each)`;
const W32 = (n: number) => `32-bit · ${n} ${n === 1 ? "value" : "values"} (2 registers each)`;
const W64 = (n: number) => `64-bit · ${n} ${n === 1 ? "value" : "values"} (4 registers each)`;
const OFF32 = "32-bit · unavailable (2 registers each)";
const OFF64 = "64-bit · unavailable (4 registers each)";

test.describe("B width headings and disabled widths", () => {
  for (const kind of HOSTS) {
    test(`CHK10-09 [UI-B ${kind}] 10 rows: 10 / 5 / unavailable, the 64-bit radios are disabled with an info icon and reason`, async ({ mm }) => {
      const h = await openF10(mm, kind);
      await h.row(0).click();
      await h.page.keyboard.press("Control+a");
      const d = await openFromMenu(h, 0);
      await expect(widthHeading(d, 16)).toHaveText(W16(10));
      await expect(widthHeading(d, 32)).toHaveText(W32(5));
      await expect(widthHeading(d, 64)).toHaveText(OFF64);
      await expect(widthReason(d, 64)).toHaveText("Needs a multiple of 4 registers; 10 selected.");
      await expect(widthReason(d, 64).locator('svg[data-icon="info"]')).toHaveCount(1);
      await expect(widthReason(d, 32)).toHaveCount(0);
      for (const name of ["Signed 64-bit", "Unsigned 64-bit", "Float 64-bit (Double)"]) {
        await expect(radio(d, name)).toBeDisabled();
      }
      await expect(radio(d, "Float 32-bit")).toBeEnabled();
    });
  }

  test("CHK10-10 [UI-B] 4 rows give 4 / 2 / 1 values and every radio is enabled; 8 rows give 8 / 4 / 2", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    let d = await openFromMenu(h, 0);
    await expect(widthHeading(d, 16)).toHaveText(W16(4));
    await expect(widthHeading(d, 32)).toHaveText(W32(2));
    await expect(widthHeading(d, 64)).toHaveText(W64(1));
    await expect(d.locator('[data-testid^="width-reason-"]')).toHaveCount(0);
    for (const radioEl of await d.getByRole("radio").all()) await expect(radioEl).toBeEnabled();
    await expect(d.getByRole("radio")).toHaveCount(10);
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await pick(h, [0, 7]);
    d = await openFromMenu(h, 0);
    await expect(widthHeading(d, 16)).toHaveText(W16(8));
    await expect(widthHeading(d, 32)).toHaveText(W32(4));
    await expect(widthHeading(d, 64)).toHaveText(W64(2));
  });

  test("CHK10-11 [UI-B] only the selection changes the headings; no static 'registers per value' text", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    let d = await openFromMenu(h, 0);
    await expect(widthHeading(d, 32)).toHaveText(W32(2));
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    d = await openFromMenu(h, 0);
    await expect(widthHeading(d, 16)).toHaveText(W16(10));
    await expect(widthHeading(d, 32)).toHaveText(W32(5));
    await expect(widthHeading(d, 64)).toHaveText(OFF64);
    await expect(d.getByText("32-bit · 2 registers per value")).toHaveCount(0);
    await expect(d.getByText("64-bit · 4 registers per value")).toHaveCount(0);
    await expect(d).not.toContainText("registers per value");
  });

  const MATRIX: Array<{ n: number; h32: string; r32?: string; h64: string; r64?: string }> = [
    { n: 1, h32: OFF32, r32: "Needs a multiple of 2 registers; 1 selected.", h64: OFF64, r64: "Needs a multiple of 4 registers; 1 selected." },
    { n: 2, h32: W32(1), h64: OFF64, r64: "Needs a multiple of 4 registers; 2 selected." },
    { n: 3, h32: OFF32, r32: "Needs a multiple of 2 registers; 3 selected.", h64: OFF64, r64: "Needs a multiple of 4 registers; 3 selected." },
    { n: 4, h32: W32(2), h64: W64(1) },
    { n: 5, h32: OFF32, r32: "Needs a multiple of 2 registers; 5 selected.", h64: OFF64, r64: "Needs a multiple of 4 registers; 5 selected." },
    { n: 10, h32: W32(5), h64: OFF64, r64: "Needs a multiple of 4 registers; 10 selected." },
  ];
  test("CHK10-12 [UI-B] edge matrix 1, 2, 3, 4, 5, 10 registers: headings, reasons and icons", async ({ mm }) => {
    for (const row of MATRIX) {
      const h = await openF10(mm);
      await pick(h, [0, row.n - 1]);
      const d = await openFromMenu(h, 0);
      await expect(widthHeading(d, 16), `${row.n} registers`).toHaveText(W16(row.n));
      await expect(widthHeading(d, 32), `${row.n} registers`).toHaveText(row.h32);
      await expect(widthHeading(d, 64), `${row.n} registers`).toHaveText(row.h64);
      for (const [bits, reason] of [
        [32, row.r32],
        [64, row.r64],
      ] as const) {
        if (reason) {
          await expect(widthReason(d, bits), `${row.n} registers, ${bits}-bit`).toHaveText(reason);
          await expect(widthReason(d, bits).locator("svg")).toHaveCount(1);
        } else {
          await expect(widthReason(d, bits)).toHaveCount(0);
        }
      }
    }
  });

  test("CHK10-13 [UI-B] a disabled width cannot be chosen by mouse", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 0);
    const d = await openFromMenu(h, 0);
    const before = await previewSummary(d).textContent();
    await d.getByText("Float 32-bit", { exact: true }).click({ force: true });
    await radio(d, "Float 32-bit").click({ force: true });
    await expect(radio(d, "Unsigned")).toBeChecked();
    await expect(radio(d, "Float 32-bit")).not.toBeChecked();
    await expect(d.getByTestId("order-group")).toHaveCount(0);
    await expect(previewSummary(d)).toHaveText(before ?? "");
  });

  test("CHK10-14 [UI-B] a disabled width cannot be chosen by keyboard: arrows skip it and wrap", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 0);
    let d = await openFromMenu(h, 0);
    await radio(d, "Binary").check();
    await radio(d, "Binary").focus();
    await h.page.keyboard.press("ArrowDown");
    await expect(radio(d, "Unsigned")).toBeChecked();
    await expect(radio(d, "Unsigned")).toBeFocused();
    await h.page.keyboard.press("ArrowUp");
    await expect(radio(d, "Binary")).toBeChecked();
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await pick(h, [0, 1]);
    d = await openFromMenu(h, 0);
    await radio(d, "Float 32-bit").check();
    await radio(d, "Float 32-bit").focus();
    await h.page.keyboard.press("ArrowDown");
    await expect(radio(d, "Unsigned")).toBeChecked();
  });

  test("CHK10-15 [UI-B] disabled radios are announced with the heading and the reason; sections are named groups", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 0);
    const d = await openFromMenu(h, 0);
    for (const [name, heading, reason] of [
      ["Signed 32-bit", OFF32, "Needs a multiple of 2 registers; 1 selected."],
      ["Float 32-bit", OFF32, "Needs a multiple of 2 registers; 1 selected."],
      ["Unsigned 64-bit", OFF64, "Needs a multiple of 4 registers; 1 selected."],
      ["Float 64-bit (Double)", OFF64, "Needs a multiple of 4 registers; 1 selected."],
    ] as const) {
      const el = radio(d, name);
      await expect(el).toHaveAttribute("disabled", "");
      const text = await describedBy(el);
      expect(text, name).toContain(heading);
      expect(text, name).toContain(reason);
    }
    await expect(d.getByRole("group", { name: W16(1) })).toBeVisible();
    await expect(d.getByRole("group", { name: OFF32 })).toBeVisible();
    await expect(d.getByRole("group", { name: OFF64 })).toBeVisible();
  });

  test("CHK10-16 [UI-B] non-contiguous reasons name the blocks, in base 1 too", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 1], [4, 6]);
    let d = await openFromMenu(h, 4);
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers in each block; rows 4-6 have 3.");
    await expect(widthReason(d, 64)).toHaveText(
      "Needs a multiple of 4 registers in each block; rows 0-1 have 2, rows 4-6 have 3.",
    );
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await h.page.keyboard.press("Control+b");
    d = await openFromMenu(h, 4);
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers in each block; rows 5-7 have 3.");
  });

  test("CHK10-17 [UI-B] blocks whose total fits but a block does not", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 1], [4, 5]);
    const d = await openFromMenu(h, 4);
    await expect(widthHeading(d, 32)).toHaveText(W32(2));
    await expect(widthReason(d, 64)).toHaveText(
      "Needs a multiple of 4 registers in each block; rows 0-1 have 2, rows 4-5 have 2.",
    );
  });

  test("CHK10-18 [UI-B] many bad blocks are shortened after three", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 0], [2, 2], [4, 4], [6, 6], [8, 8]);
    const d = await openFromMenu(h, 8);
    await expect(widthReason(d, 32)).toHaveText(
      "Needs a multiple of 2 registers in each block; row 0 has 1, row 2 has 1, row 4 has 1, and 2 more blocks.",
    );
  });

  test("CHK10-19 [UI-B] non-contiguous blocks that are each a multiple: 8 / 4 / 2 values, Float 64-bit stores two entries", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3], [6, 9]);
    const d = await openFromMenu(h, 6);
    await expect(widthHeading(d, 16)).toHaveText(W16(8));
    await expect(widthHeading(d, 32)).toHaveText(W32(4));
    await expect(widthHeading(d, 64)).toHaveText(W64(2));
    await chooseAndApply(d, "Float 64-bit (Double)");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 3, "float64"), ov(6, 9, "float64")]);
  });

  test("CHK10-20 [UI-B] edge addresses: 65535 has no wider width; 65532-65535 gives one 64-bit value; base 1 preview", async ({ mm }) => {
    let h = await openHost(mm, "workspace", { start: 65535, qty: 1, values: [1] });
    await select(h, 0);
    let d = await openFromMenu(h, 0);
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers; 1 selected.");
    await expect(widthReason(d, 64)).toHaveText("Needs a multiple of 4 registers; 1 selected.");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    h = await openHost(mm, "workspace", { start: 65532, qty: 4, values: [0x3ff0, 0, 0, 0], display: { addressBase: 1 } });
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    d = await openFromMenu(h, 0);
    await expect(widthHeading(d, 64)).toHaveText(W64(1));
    await radio(d, "Float 64-bit (Double)").check();
    expect(await previewRows(d)).toEqual([["65533-65536", "1"]]);
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(65532, 65535, "float64")]);
    h = await openHost(mm, "workspace", { start: 0, qty: 1, values: [1] });
    await select(h, 0);
    d = await openFromMenu(h, 0);
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers; 1 selected.");
  });

  for (const fc of [3, 4] as const) {
    test(`CHK10-21 [UI-B FC0${fc}] quantity 125: 125 selected disables both widths and Apply works; 124 rows give 124 / 62 / 31`, async ({ mm }) => {
      const h = await openHost(mm, "workspace", { fc, qty: 125, values: Array.from({ length: 125 }, (_, i) => i) });
      await h.row(0).click();
      await h.page.keyboard.press("Control+a");
      let d = await openFromKeyboard(h);
      await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers; 125 selected.");
      await expect(widthReason(d, 64)).toHaveText("Needs a multiple of 4 registers; 125 selected.");
      await enabled(d);
      await expect(radio(d, "Unsigned")).toBeChecked();
      await d.getByRole("button", { name: "Cancel" }).click();
      await expectClosed(h);
      // Rows 0-123: click row 0, Shift+End selects to the end, Shift+ArrowUp drops the last row.
      await h.row(0).click();
      await h.page.keyboard.press("Shift+End");
      await h.page.keyboard.press("Shift+ArrowUp");
      d = await openFromKeyboard(h);
      await expect(widthHeading(d, 16)).toHaveText(W16(124));
      await expect(widthHeading(d, 32)).toHaveText(W32(62));
      await expect(widthHeading(d, 64)).toHaveText(W64(31));
    });
  }

  test("CHK10-22 [UI-B] no rounding: 3 rows 2-4 never add a row and every enabled format stays inside 2-4", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [2, 4]);
    const d = await openFromMenu(h, 2);
    for (const name of ["Unsigned", "Signed", "Hex", "Binary"]) {
      await radio(d, name).check();
      await expect(d).not.toContainText(/were added|was added|stays? Unsigned 16-bit/);
      await expect(summary(d)).toHaveText("Selected 3 registers (2-4)");
      expect((await infoLines(d)).join(" ")).not.toMatch(/added|stay/);
      expect(await warningLines(d)).toEqual([]);
    }
    await radio(d, "Hex").check();
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 4, "hex")]);
  });

  test("CHK10-23 [UI-B] never stuck: Apply is on and the checked radio is enabled right after opening", async ({ mm }) => {
    const h = await openF10(mm);
    const selections: Array<Array<[number, number]>> = [
      [[0, 0]],
      [[0, 1]],
      [[0, 2]],
      [[0, 3]],
      [[0, 4]],
      [[0, 9]],
      [
        [0, 1],
        [4, 6],
      ],
      [
        [0, 0],
        [2, 2],
        [4, 4],
      ],
    ];
    for (const runs of selections) {
      await pick(h, ...runs);
      const d = await openFromMenu(h, runs.at(-1)?.[0] ?? 0);
      await enabled(d);
      await expect(d.getByRole("radio", { checked: true })).toBeEnabled();
      for (const name of ["Unsigned", "Signed", "Hex", "Binary"]) await expect(radio(d, name)).toBeEnabled();
      await d.getByRole("button", { name: "Cancel" }).click();
      await expectClosed(h);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// C. Order visibility (AC 4)
// ---------------------------------------------------------------------------------------------
const ORDERS = [
  ["Big-endian", "ABCD"],
  ["Little-endian", "DCBA"],
  ["Big-endian byte swap", "BADC"],
  ["Little-endian byte swap", "CDAB"],
] as const;

test.describe("C order visibility", () => {
  test("CHK10-25 [UI-B] Unsigned: no order group, no order radio and no help text in the DOM", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    const d = await openFromMenu(h, 0);
    await expect(radio(d, "Unsigned")).toBeChecked();
    await expect(d.getByTestId("order-group")).toHaveCount(0);
    await expect(d.getByRole("radio", { name: "Big-endian", exact: true })).toHaveCount(0);
    await expect(d.getByText("A is the high byte of the first register.")).toHaveCount(0);
    await expect(d.getByText("Order applies to 32-bit and 64-bit formats.")).toHaveCount(0);
    await expect(d.getByText("Byte and word order")).toHaveCount(0);
  });

  for (const kind of HOSTS) {
    test(`CHK10-26 [UI-B ${kind}] Float 32-bit shows four orders, Hex hides them, Signed 64-bit shows them with the last order`, async ({ mm }) => {
      const h = await openF10(mm, kind);
      await pick(h, [0, 3]);
      const d = await openFromMenu(h, 0);
      await radio(d, "Float 32-bit").check();
      const group = d.getByTestId("order-group");
      for (const [name, pattern] of ORDERS) {
        await expect(group.locator("label").filter({ has: h.page.getByRole("radio", { name, exact: true }) })).toContainText(pattern);
      }
      await expect(radio(d, "Big-endian")).toBeChecked();
      await radio(d, "Little-endian byte swap").check();
      await radio(d, "Hex").check();
      await expect(group).toHaveCount(0);
      await radio(d, "Signed 64-bit").check();
      await expect(group).toBeVisible();
      await expect(radio(d, "Little-endian byte swap")).toBeChecked();
      await expect(
        group.locator("label").filter({ has: h.page.getByRole("radio", { name: "Little-endian byte swap", exact: true }) }),
      ).toContainText("GHEFCDAB");
      await applyButton(d).click();
      await expectClosed(h);
      expect((await viewCalls(h)).at(-1)?.[1]).toEqual({
        formatOverrides: [{ start: 0, end: 3, format: "signed64", swapBytes: false, reverseWords: true }],
      });
    });
  }

  test("CHK10-27 [UI-B] applying Hex after an order was chosen stores both flags false", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    const d = await openFromMenu(h, 0);
    await radio(d, "Float 32-bit").check();
    await radio(d, "Little-endian").check();
    await chooseAndApply(d, "Hex");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 3, "hex", false, false)]);
  });

  test("CHK10-28 [UI-B] keyboard only: the focus stays on the checked Format radio and stays visible", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    const d = await openFromMenu(h, 0);
    await expect(radio(d, "Unsigned")).toBeFocused();
    const steps = ["Signed", "Hex", "Binary", "Signed 32-bit", "Unsigned 32-bit", "Float 32-bit"];
    for (const name of steps) {
      await h.page.keyboard.press("ArrowDown");
      await expect(radio(d, name)).toBeChecked();
      await expect(radio(d, name)).toBeFocused();
      await expect(radio(d, name)).toBeInViewport();
      expect(await activeLabel(h)).toBe(name);
    }
    await expect(d.getByTestId("order-group")).toBeVisible();
    for (const name of ["Unsigned 32-bit", "Signed 32-bit", "Binary"]) {
      await h.page.keyboard.press("ArrowUp");
      await expect(radio(d, name)).toBeFocused();
    }
    await expect(d.getByTestId("order-group")).toHaveCount(0);
  });

  test("CHK10-29 [UI-B] 466 x 283: title and buttons stay visible while the order group comes and goes", async ({ mm }) => {
    const h = await openF10(mm, "native", { viewport: { width: 466, height: 283 } });
    await collapseSetupPopover(h);
    await pick(h, [0, 3]);
    const d = await openFromMenu(h, 3);
    const vp = h.page.viewportSize() ?? { width: 466, height: 283 };
    for (const name of ["Unsigned", "Float 32-bit", "Hex", "Float 64-bit (Double)", "Unsigned"]) {
      await radio(d, name).check();
      for (const el of [
        d.getByRole("heading", { name: "Format / endian" }),
        d.getByRole("button", { name: "Close dialog" }),
        d.getByRole("button", { name: "Cancel" }),
        applyButton(d),
      ]) {
        const box = await el.boundingBox();
        expect(box, name).not.toBeNull();
        expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= vp.height, name).toBe(true);
        expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= vp.width, name).toBe(true);
      }
      expect(
        await h.page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight),
        `no document scrollbar after ${name}`,
      ).toBe(true);
    }
    expect(await d.getByTestId("format-body").evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  });

  test("CHK10-29b [UI-B] 900 x 700 (two columns): showing or hiding the order group does not change the dialog height", async ({ mm }) => {
    // The footer message area (for example the "already use this format" note) may change the dialog
    // height by its own height; the order group, the columns and the preview must not.
    const h = await openF10(mm, "workspace", { viewport: { width: 900, height: 700 } });
    await pick(h, [0, 3]);
    const d = await openFromMenu(h, 0);
    const sizes = new Set<number>();
    const grids = new Set<number>();
    for (const name of ["Unsigned", "Float 32-bit", "Hex", "Float 64-bit (Double)", "Unsigned"]) {
      await radio(d, name).check();
      const m = await d.evaluate((el) => ({
        dialog: el.getBoundingClientRect().height,
        message: (el.querySelector('[data-testid="format-message-area"]') as HTMLElement).getBoundingClientRect().height,
        grid: (el.querySelector('[data-testid="format-body"] .grid') as HTMLElement).getBoundingClientRect().height,
      }));
      sizes.add(Math.round(m.dialog - m.message));
      grids.add(Math.round(m.grid));
    }
    expect([...grids], "height of the two columns").toHaveLength(1);
    expect([...sizes], "dialog height without the message area").toHaveLength(1);
  });

  test("CHK10-30 [UI-B] a reopened dialog forgets the order of the last session", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    let d = await openFromMenu(h, 0);
    await radio(d, "Float 32-bit").check();
    await radio(d, "Little-endian byte swap").check();
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    d = await openFromMenu(h, 0);
    await radio(d, "Float 32-bit").check();
    await expect(radio(d, "Big-endian")).toBeChecked();
  });
});

// ---------------------------------------------------------------------------------------------
// D. Preview (AC 5) and data states
// ---------------------------------------------------------------------------------------------
test.describe("D preview", () => {
  test("CHK10-31 [UI-B] 12.5 and 0 before Apply; another order updates the preview with no request", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    const d = await openFromMenu(h, 0);
    await radio(d, "Float 32-bit").check();
    await expect(previewSummary(d)).toHaveText("2 Float 32-bit values, Big-endian (ABCD)");
    expect(await previewRows(d)).toEqual([
      ["0-1", "12.5"],
      ["2-3", "0"],
    ]);
    const family = await d.getByTestId("format-preview-row").first().locator("td").first().evaluate((e) => getComputedStyle(e).fontFamily);
    expect(family.toLowerCase()).toMatch(/mono/);
    const before = await h.script((f) => ({ log: f.requestLog.length, calls: f.calls.length }));
    await radio(d, "Little-endian byte swap").check();
    await expect(previewSummary(d)).toHaveText("2 Float 32-bit values, Little-endian byte swap (CDAB)");
    const rows = await previewRows(d);
    expect(rows[0]?.[0]).toBe("0-1");
    expect(rows[0]?.[1]).not.toBe("12.5");
    expect(rows[0]?.[1]).toMatch(/e-41/);
    expect(rows[1]).toEqual(["2-3", "0"]);
    expect(await h.script((f) => ({ log: f.requestLog.length, calls: f.calls.length }))).toEqual(before);
  });

  test("CHK10-33 [UI-B] after Apply the grid shows exactly the values of the preview", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    let d = await openFromMenu(h, 0);
    await radio(d, "Float 32-bit").check();
    await radio(d, "Little-endian byte swap").check();
    const shown = await previewRows(d);
    await applyButton(d).click();
    await expectClosed(h);
    const rows = await table(h);
    expect(rows.slice(0, 2).map((r) => [r.address.replace("–", "-"), r.raw])).toEqual(shown);
    // Unsigned 32-bit: Little-endian byte swap gives 16712, Big-endian 1095237632.
    await h.row(0).click();
    d = await openFromMenu(h, 0);
    await radio(d, "Unsigned 32-bit").check();
    await radio(d, "Little-endian byte swap").check();
    expect(await previewRows(d)).toEqual([["0-1", "16712"]]);
    await radio(d, "Big-endian").check();
    expect(await previewRows(d)).toEqual([["0-1", "1095237632"]]);
    await applyButton(d).click();
    await expectClosed(h);
    expect((await table(h))[0]?.raw).toBe("1095237632");
  });

  test("CHK10-34 [UI-B] at most eight lines, then how many more", async ({ mm }) => {
    const h = await openF10(mm);
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    let d = await openFromMenu(h, 0);
    expect(await previewRows(d)).toEqual([
      ["0", "16712"],
      ["1", "0"],
      ["2", "0"],
      ["3", "0"],
      ["4", "16712"],
      ["5", "0"],
      ["6", "161"],
      ["7", "65534"],
    ]);
    await expect(d.getByTestId("format-preview-more")).toHaveText("… and 2 more values");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await pick(h, [0, 8]);
    d = await openFromMenu(h, 0);
    await expect(d.getByTestId("format-preview-more")).toHaveText("… and 1 more value");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await pick(h, [0, 7]);
    d = await openFromMenu(h, 0);
    await radio(d, "Float 32-bit").check();
    expect(await previewRows(d)).toHaveLength(4);
    await expect(d.getByTestId("format-preview-more")).toHaveCount(0);
  });

  test("CHK10-34b [UI-B] quantity 125, Ctrl+A: 117 more values", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { qty: 125, values: Array.from({ length: 125 }, (_, i) => i) });
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    const d = await openFromKeyboard(h);
    expect(await previewRows(d)).toHaveLength(8);
    await expect(d.getByTestId("format-preview-more")).toHaveText("… and 117 more values");
  });

  test("CHK10-35 [UI-B] inline option previews; disabled widths show no value", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    let d = await openFromMenu(h, 0);
    await expect(d.getByTestId("preview-float32")).toHaveText("12.5");
    await expect(d.getByTestId("preview-hex")).toHaveText("0x4148");
    await expect(d.getByTestId("preview-float64")).toHaveText("3145728");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await select(h, 0);
    d = await openFromMenu(h, 0);
    await expect(d.getByTestId("preview-float32")).toHaveText("");
    await expect(d.getByTestId("preview-float64")).toHaveText("");
    await expect(d.getByTestId("preview-hex")).toHaveText("0x4148");
  });

  test("CHK10-36 [UI-B] the preview, its notice and its table are not live; the mixed and unchanged notes are", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { formatOverrides: [ov(0, 1, "float32")] });
    await h.grid.focus();
    await h.page.keyboard.press("Control+p");
    await expect(mm.statusLine(h.id)).toContainText("Paused");
    await h.row(0).click();
    const d = await openFromMenu(h, 0);
    await expect(previewNotice(d)).toBeVisible();
    for (const id of ["format-preview", "format-preview-notice", "format-preview-table", "format-preview-summary"]) {
      expect(await d.getByTestId(id).evaluate((e) => !!e.closest("[aria-live]")), id).toBe(false);
    }
    const note = messages(d).locator("[data-kind=info]");
    await expect(note).toHaveText("The selected rows already use this format.");
    expect(await note.evaluate((e) => !!e.closest("[aria-live]"))).toBe(true);
  });

  test("CHK10-37 [UI-B] idle after Disconnect: not-connected notice, dashes, Apply stores the format with no frame", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 2, 3);
    await mm.toolbarButton("Disconnect").click();
    await expect(h.grid).toHaveCount(0);
    const before = await h.script((f) => f.requestLog.length);
    await mm.statusLine(h.id).getByRole("button", { name: /^Show / }).click();
    await h.page.getByRole("menuitem", { name: "More formats…" }).click();
    const d = formatDialog(h);
    await expect(d).toBeVisible();
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "notConnected");
    await expect(previewNotice(d)).toHaveText("No preview: not connected. Connect to read values. You can apply the format now.");
    await expect(previewNotice(d).locator('svg[data-icon="plug"]')).toHaveCount(1);
    expect(await previewRows(d)).toEqual([
      ["2", "—"],
      ["3", "—"],
    ]);
    await chooseAndApply(d, "Hex");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 3, "hex")]);
    expect(await h.script((f) => f.requestLog.length)).toBe(before);
  });

  /** Selects rows 2-3, disconnects (the data goes), then lets the test drive the state; opens D1 from the Show menu. */
  async function offlineDialog(
    mm: Parameters<typeof openHost>[0],
    drive: (h: Host) => Promise<void>,
    rows: [number, number] = [2, 3],
  ) {
    const h = await openF10(mm);
    await select(h, rows[0], rows[1]);
    await mm.toolbarButton("Disconnect").click();
    await expect(h.grid).toHaveCount(0);
    await drive(h);
    await mm.statusLine(h.id).getByRole("button", { name: /^Show / }).click();
    await h.page.getByRole("menuitem", { name: "More formats…" }).click();
    const d = formatDialog(h);
    await expect(d).toBeVisible();
    return { h, d };
  }

  test("CHK10-38 [UI-B] connecting: the notice says so (loader icon)", async ({ mm }) => {
    const { d } = await offlineDialog(mm, (h) => h.script((f) => f.emitConnectionState("connecting")));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "connecting");
    await expect(previewNotice(d)).toHaveText("No preview yet: connecting to the device.");
    await expect(previewNotice(d).locator('svg[data-icon="loader"]')).toHaveCount(1);
  });

  test("CHK10-39 [UI-B] connected before the first reply: waiting; the first reply fills the values without an announcement", async ({ mm }) => {
    const { h, d } = await offlineDialog(mm, (host) => host.script((f) => f.emitConnectionState("connected")));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "waiting");
    await expect(previewNotice(d)).toHaveText("No preview yet: waiting for the first reply.");
    const announced = (await h.announced()).length;
    // The first good reply: the poll is polling and the snapshot arrives.
    await h.script(
      (f, id) => {
        f.emitPollState(id, "polling");
        f.emitPollUpdate(id, { values: [1, 2, 0x4148, 0x0000, 5, 6, 7, 8, 9, 10] });
      },
      h.id,
    );
    await expect(previewNotice(d)).toHaveCount(0);
    await expect.poll(() => previewRows(d)).toEqual([
      ["2", "16712"],
      ["3", "0"],
    ]);
    expect((await h.announced()).length).toBe(announced);
  });

  test("CHK10-40 [UI-B] loading: no grid, no Format… button, nothing opens the dialog", async ({ mm }) => {
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
    await mm.sub(id).click({ button: "right" });
    await expect(mm.page.getByRole("menuitem", { name: "More formats…" })).toHaveCount(0);
    await mm.page.keyboard.press("Escape");
    await expect(mm.page.getByRole("dialog", { name: "Format / endian" })).toHaveCount(0);
    await mm.page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  });

  test("CHK10-41 [UI-B] polling: live values update in the open preview and no notice is shown", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    const d = await openFromMenu(h, 0);
    expect(await previewRows(d)).toEqual([
      ["0", "16712"],
      ["1", "0"],
      ["2", "0"],
      ["3", "0"],
    ]);
    await expect(previewNotice(d)).toHaveCount(0);
    await h.script((f, id) => f.emitPollUpdate(id, { values: [7, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), h.id);
    await expect.poll(async () => (await previewRows(d))[0]).toEqual(["0", "7"]);
    await expect(previewNotice(d)).toHaveCount(0);
  });

  test("CHK10-42 [UI-B] paused: stale notice with the retained values; paused without values says how to resume", async ({ mm }) => {
    const h = await openF10(mm);
    await h.grid.focus();
    await h.page.keyboard.press("Control+p");
    await expect(mm.statusLine(h.id)).toContainText("Paused");
    await pick(h, [0, 3]);
    let d = await openFromMenu(h, 0);
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
    await expect(previewNotice(d)).toHaveText("Preview uses the last values received (stale).");
    await expect(previewNotice(d).locator('svg[data-icon="clock"]')).toHaveCount(1);
    expect((await previewRows(d))[0]).toEqual(["0", "16712"]);
    await chooseAndApply(d, "Hex");
    await expectClosed(h);
    await expect(mm.statusLine(h.id)).toContainText("Paused");
    expect(await mm.callCount("resumePoll")).toBe(0);
    // Without values: a kept selection, the data cleared by Disconnect, then a paused state.
    ({ d } = await offlineDialog(mm, async (host) => {
      await host.script((f) => f.emitConnectionState("connected"));
      await host.script((f, id) => f.emitPollState(id, "paused"), host.id);
    }));
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "paused");
    await expect(previewNotice(d)).toHaveText("No preview: the poll is paused. Resume it (Ctrl+P) to read values.");
    await expect(previewNotice(d).locator('svg[data-icon="pause"]')).toHaveCount(1);
  });

  for (const [id, driver] of [
    ["CHK10-43", "timeout"],
    ["CHK10-44", "exception"],
  ] as const) {
    test(`${id} [UI-B] ${driver}: stale with retained values, failed without values (octagon icon)`, async ({ mm }) => {
      const drive = (host: Host) =>
        host.script(
          (f, a) =>
            a.k === "timeout"
              ? f.emitPollState(a.id, "timeout", { consecutiveFailures: 1 })
              : f.emitPollState(a.id, "exception", { exceptionCode: 2, consecutiveFailures: 1 }),
          { id: host.id, k: driver },
        );
      const h = await openF10(mm);
      await drive(h);
      await select(h, 2, 3);
      let d = await openFromMenu(h, 2);
      await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
      await expect(previewNotice(d)).toHaveText("Preview uses the last values received (stale).");
      expect((await previewRows(d))[0]).toEqual(["2", "0"]);
      await d.getByRole("button", { name: "Cancel" }).click();
      await expectClosed(h);
      ({ d } = await offlineDialog(mm, async (host) => {
        await host.script((f) => f.emitConnectionState("connected"));
        await drive(host);
      }));
      await expect(previewNotice(d)).toHaveAttribute("data-kind", "failed");
      await expect(previewNotice(d)).toHaveText(
        "No preview: the last request got no valid reply. Values appear after the next good reply.",
      );
      await expect(previewNotice(d).locator('svg[data-icon="octagon-x"]')).toHaveCount(1);
    });
  }

  test("CHK10-45 [UI-B] link lost: stale with retained values, connection lost without values (unplug icon)", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 2, 3);
    await h.script((f) => f.dropLink());
    await expect(mm.pill).toContainText(/Connection lost|Disconnected|Reconnect/i);
    const d = await openFromMenu(h, 2);
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "stale");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    const second = await offlineDialog(mm, (host) => host.script((f) => f.emitConnectionState("disconnected")));
    await expect(previewNotice(second.d)).toHaveAttribute("data-kind", "connectionLost");
    await expect(previewNotice(second.d)).toHaveText("No preview: the connection was lost. Reconnect to read values.");
    await expect(previewNotice(second.d).locator('svg[data-icon="unplug"]')).toHaveCount(1);
  });

  test("CHK10-46 [UI-B] empty data after a definition change: waiting notice, dashes, no value of the old definition", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { formatOverrides: [ov(2, 5, "float32")] });
    await expectTable(h, [
      ["0", "U16", "16712"],
      ["1", "U16", "0"],
      ["2–3", "F32 ABCD", "0"],
      ["4–5", "F32 ABCD", "12.5"],
      ["6", "U16", "161"],
      ["7", "U16", "65534"],
      ["8", "U16", "9"],
      ["9", "U16", "10"],
    ]);
    await mm.titleButton(h.id, /^Poll setup/).click();
    await mm.setupField(h.id, "Start address").fill("3");
    await mm.setup(h.id).getByRole("button", { name: "Apply", exact: true }).click();
    await expect.poll(async () => (await table(h)).map((r) => r.address)).toContain("4–5");
    await h.row(1).click();
    const d = await openFromMenu(h, 1);
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "waiting");
    expect(await previewRows(d)).toEqual([["4-5", "—"]]);
    await expect(d).not.toContainText("12.5");
  });

  test("CHK10-48 [UI-B] an unavailable width and an empty preview are distinct messages", async ({ mm }) => {
    const { d } = await offlineDialog(mm, async () => {}, [0, 0]);
    await expect(widthReason(d, 32)).toHaveText("Needs a multiple of 2 registers; 1 selected.");
    await expect(previewNotice(d)).toHaveAttribute("data-kind", "notConnected");
    await expect(widthReason(d, 32)).not.toContainText("No preview");
    await expect(previewNotice(d)).not.toContainText("Needs a multiple");
    await expect(d.getByTestId("format-preview").getByText("Needs a multiple")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------
// E. Quick formats in the row menu (AC 6)
// ---------------------------------------------------------------------------------------------
test.describe("E quick formats", () => {
  for (const kind of HOSTS) {
    test(`CHK10-49 [UI-B ${kind}] the row menu starts with the Value format section and has no Format / endian…`, async ({ mm }) => {
      const h = await openF10(mm, kind);
      await select(h, 2);
      const menu = await rowMenu(h, 2);
      await expect(menu.getByText("Value format", { exact: true })).toBeVisible();
      const items = menu.getByRole("menuitemradio", { name: /^(Unsigned|Signed|Hex|Binary)/ });
      await expect(items).toHaveCount(4);
      for (const [i, [label, key]] of [
        ["Unsigned", "Ctrl+1"],
        ["Signed", "Ctrl+2"],
        ["Hex", "Ctrl+3"],
        ["Binary", "Ctrl+4"],
      ].entries()) {
        const item = items.nth(i);
        await expect(item).toContainText(label ?? "");
        await expect(item).toContainText(key ?? "");
        await expect(item).toHaveAttribute("aria-checked", label === "Unsigned" ? "true" : "false");
      }
      await expect(items.first().locator("svg")).toHaveCount(1);
      await expect(items.nth(1).locator("svg")).toHaveCount(0);
      // Order in the menu: the four items, More formats…, then a separator, then the rest.
      const roles = await menu.locator('[role="menuitemradio"], [role="menuitem"], [role="separator"]').evaluateAll((els) =>
        els.slice(0, 6).map((e) => `${e.getAttribute("role")}:${(e.textContent ?? "").trim().match(/^(Unsigned|Signed|Hex|Binary|More)?/)?.[0] ?? ""}`),
      );
      expect(roles).toEqual([
        "menuitemradio:Unsigned",
        "menuitemradio:Signed",
        "menuitemradio:Hex",
        "menuitemradio:Binary",
        "menuitem:More",
        "separator:",
      ]);
      await expect(menu.getByRole("menuitem", { name: "More formats…" })).toBeVisible();
      await expect(menu.getByText(/Format \/ endian/)).toHaveCount(0);
    });
  }

  test("CHK10-50 [UI-B] Hex on rows 2-3: no dialog, one setPollView, Modified, no frame", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 2, 3);
    const reqBefore = await h.script((f) => f.requestLog.length);
    const menu = await rowMenu(h, 2);
    await menu.getByRole("menuitemradio", { name: /^Hex/ }).click();
    await expect(formatDialog(h)).toHaveCount(0);
    await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
    expect((await viewCalls(h))[0]?.[1]).toEqual({
      formatOverrides: [{ start: 2, end: 3, format: "hex", swapBytes: false, reverseWords: false }],
    });
    await expect.poll(() => mm.modified()).toBe(true);
    const rows = await table(h);
    expect(rows.slice(2, 4).map((r) => [r.format, r.raw])).toEqual([
      ["HEX", "0x0000"],
      ["HEX", "0x0000"],
    ]);
    expect(await h.script((f) => f.requestLog.length)).toBe(reqBefore);
  });

  test("CHK10-51 [UI-B] each quick item sends the payload of its Ctrl+N shortcut", async ({ mm }) => {
    const items = [
      ["Unsigned", "Control+1"],
      ["Signed", "Control+2"],
      ["Hex", "Control+3"],
      ["Binary", "Control+4"],
    ] as const;
    for (const [label, key] of items) {
      const a = await openF10(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
      await select(a, 2);
      const menu = await rowMenu(a, 2);
      await menu.getByRole("menuitemradio", { name: new RegExp(`^${label}`) }).click();
      await expect.poll(async () => (await viewCalls(a)).length).toBe(1);
      const viaMenu = (await viewCalls(a)).map((c) => c[1]);
      const b = await openF10(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
      await select(b, 2);
      await b.page.keyboard.press(key);
      await expect.poll(async () => (await viewCalls(b)).length).toBe(1);
      const viaKey = (await viewCalls(b)).map((c) => c[1]);
      expect(viaMenu, label).toEqual(viaKey);
    }
  });

  test("CHK10-52 [UI-B] an edge-cut group row: Signed splits like Ctrl+2 and names the reset register", async ({ mm }) => {
    const opts = { start: 101, qty: 4, formatOverrides: [ov(100, 101, "float32")], values: [0x4148, 2, 3, 4] };
    const h = await openHost(mm, "workspace", opts);
    await select(h, 0);
    const menu = await rowMenu(h, 0);
    await menu.getByRole("menuitemradio", { name: /^Signed/ }).click();
    await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [ov(101, 101, "signed")] });
    await expect(mm.toast("Signed applied to 101. Also reset 100 to Unsigned because a combined value was split.")).toBeVisible();
    const k = await openHost(mm, "workspace", opts);
    await select(k, 0);
    await k.page.keyboard.press("Control+2");
    await expect.poll(async () => (await viewCalls(k)).length).toBe(1);
    expect((await viewCalls(k))[0]?.[1]).toEqual({ formatOverrides: [ov(101, 101, "signed")] });
    await expect(mm.toast("Signed applied to 101. Also reset 100 to Unsigned because a combined value was split.")).toBeVisible();
  });

  test("CHK10-53 [UI-B] a group row: heading names its format, nothing checked, Signed makes two Signed rows without a toast", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
    await h.row(2).click();
    const menu = await rowMenu(h, 2);
    await expect(menu.getByText("Value format: F32 ABCD", { exact: true })).toBeVisible();
    await expect(menu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(0);
    await menu.getByRole("menuitemradio", { name: /^Signed/ }).click();
    await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [ov(2, 3, "signed")] });
    await expect.poll(async () => (await table(h)).slice(2, 4).map((r) => r.format)).toEqual(["S16", "S16"]);
    await expect(mm.toast(/Also reset/)).toHaveCount(0);
  });

  test("CHK10-54 [UI-B] checked state: the common format is checked, choosing it again sends nothing, mixed checks none", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { formatOverrides: [ov(0, 9, "hex")] });
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    let menu = await rowMenu(h, 0);
    await expect(menu.getByRole("menuitemradio", { name: /^Hex/ })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: /^Hex/ }).click();
    await expect(menu).toHaveCount(0);
    expect(await viewCalls(h)).toHaveLength(0);
    const mixed = await openF10(mm, "workspace", { formatOverrides: [ov(6, 6, "signed")] });
    await pick(mixed, [6, 7]);
    menu = await rowMenu(mixed, 6);
    await expect(menu.getByText("Value format: mixed", { exact: true })).toBeVisible();
    await expect(menu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(0);
  });

  test("CHK10-55 [UI-B] a right-click outside the selection formats the clicked row only", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 2, 3);
    const menu = await rowMenu(h, 7);
    await menu.getByRole("menuitemradio", { name: /^Binary/ }).click();
    await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [ov(7, 7, "binary")] });
  });

  test("CHK10-56 [UI-B] More formats… opens the dialog for the selection; Cancel returns the focus to the grid", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    const menu = await rowMenu(h, 0);
    await menu.getByRole("menuitem", { name: "More formats…" }).click();
    const d = formatDialog(h);
    await expect(summary(d)).toHaveText("Selected 4 registers (0-3)");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await expect(h.grid).toBeFocused();
    const rowId = await h.row(0).getAttribute("id");
    expect(await h.grid.getAttribute("aria-activedescendant")).toBe(rowId);
  });

  for (const fc of [1, 2] as const) {
    test(`CHK10-57 [UI-B FC0${fc}] bit poll: only a disabled More formats… with the reason, shortcuts do nothing`, async ({ mm }) => {
      const h = await openHost(mm, "workspace", { fc, qty: 8, values: [1, 0, 1, 0, 1, 0, 1, 0], formatOverrides: [ov(0, 3, "float32")] });
      const menu = await rowMenu(h, 2);
      await expect(menu.getByText(/^Value format/)).toHaveCount(0);
      await expect(menu.getByRole("menuitemradio", { name: /^(Unsigned|Signed|Hex|Binary)/ })).toHaveCount(0);
      const more = menu.getByRole("menuitem", { name: "More formats…" });
      await expect(more).toHaveAttribute("aria-disabled", "true");
      await expect(more).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
      await more.click({ force: true }).catch(() => undefined);
      await expect(formatDialog(h)).toHaveCount(0);
      await h.page.keyboard.press("Escape");
      await h.row(2).click();
      for (const k of ["Control+1", "Control+2", "Control+3", "Control+4"]) await h.page.keyboard.press(k);
      expect(await viewCalls(h)).toHaveLength(0);
    });
  }

  test("CHK10-58 [UI-B] narrow Show menu: radio items with the checked format, More formats… last, no Format / endian…", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { formatOverrides: [ov(2, 3, "hex")] });
    await select(h, 2, 3);
    await mm.statusLine(h.id).getByRole("button", { name: /^Show / }).click();
    const menu = h.page.getByRole("menu").last();
    await expect(menu.getByText("Format of selected rows")).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /^Hex/ })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemradio", { name: /^Signed/ })).toHaveAttribute("aria-checked", "false");
    await expect(menu.getByRole("menuitem", { name: /Format \/ endian/ })).toHaveCount(0);
    const more = menu.getByRole("menuitem", { name: "More formats…" });
    await more.click();
    await expect(formatDialog(h)).toBeVisible();
    await expect(summary(formatDialog(h))).toHaveText("Selected 2 registers (2-3)");
  });

  test("CHK10-59 [UI-B] 466 x 283: the whole row menu is reachable, the list scrolls inside the window", async ({ mm }) => {
    const h = await openF10(mm, "native", { viewport: { width: 466, height: 283 } });
    await collapseSetupPopover(h);
    await h.row(2).click({ button: "right" });
    const menu = h.page.getByRole("menu").last();
    await expect(menu).toBeVisible();
    const m = await menu.evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight, overflowY: getComputedStyle(e).overflowY }));
    expect(m.overflowY).toBe("auto");
    expect(m.s).toBeGreaterThan(m.c);
    const box = await menu.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(283);
    await h.page.keyboard.press("End");
    const last = menu.getByRole("menuitem").last();
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport();
    await h.page.keyboard.press("Home");
    await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
    await expect(menu.getByRole("menuitemradio").first()).toBeInViewport();
  });
});

// ---------------------------------------------------------------------------------------------
// F. Mixed formats (AC 7)
// ---------------------------------------------------------------------------------------------
const MIXED = [ov(0, 1, "float32"), ov(2, 2, "hex"), ov(3, 3, "hex")];
test.describe("F mixed formats", () => {
  test("CHK10-60 [UI-B] mixed: opens on Unsigned with the mixed note and summary, Apply on", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { formatOverrides: MIXED });
    await pick(h, [0, 2]);
    const d = await openFromMenu(h, 0);
    await expect(radio(d, "Unsigned")).toBeChecked();
    await expect(summary(d)).toHaveText("Selected 4 registers (0-3) · mixed formats");
    await expect(widthHeading(d, 16)).toHaveText(W16(4));
    await expect(widthHeading(d, 32)).toHaveText(W32(2));
    await expect(widthHeading(d, 64)).toHaveText(W64(1));
    expect(await infoLines(d)).toEqual(["The selected rows use different formats. The format you apply replaces all of them."]);
    await expect(messages(d).locator('[data-kind="info"] svg[data-icon="info"]')).toHaveCount(1);
    expect(await warningLines(d)).toEqual([]);
    await enabled(d);
  });

  test("CHK10-61 [UI-B] the row menu of the same selection says mixed and checks nothing", async ({ mm }) => {
    const h = await openF10(mm, "workspace", { formatOverrides: MIXED });
    await pick(h, [0, 2]);
    const menu = await rowMenu(h, 0);
    await expect(menu.getByText("Value format: mixed", { exact: true })).toBeVisible();
    await expect(menu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(0);
  });

  test("CHK10-62 [UI-B] a mixed selection is replaced by what is applied", async ({ mm }) => {
    let h = await openF10(mm, "workspace", { formatOverrides: MIXED });
    await pick(h, [0, 2]);
    let d = await openFromMenu(h, 0);
    await chooseAndApply(d, "Float 64-bit (Double)");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 3, "float64")]);
    h = await openF10(mm, "workspace", { formatOverrides: MIXED });
    await pick(h, [0, 2]);
    d = await openFromMenu(h, 0);
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([]);
  });

  test("CHK10-63 [UI-B] cut lines are listed before Apply (orange box with the triangle icon)", async ({ mm }) => {
    const h = await openHost(mm, "workspace", {
      start: 100,
      qty: 4,
      formatOverrides: [ov(98, 105, "float64")],
      values: [1, 2, 3, 4],
    });
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    const d = await openFromMenu(h, 0);
    await expect(widthHeading(d, 64)).toHaveText(W64(1));
    await radio(d, "Signed").check();
    const box = messages(d).locator('[data-kind="warning"]');
    await expect(box.locator("p")).toHaveCount(2);
    await expect(box).toContainText("Also resets 98-99 to Unsigned");
    await expect(box).toContainText("Also resets 104-105 to Unsigned");
    await expect(box.locator('svg[data-icon="triangle-alert"]')).toHaveCount(1);
    await enabled(d);
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(100, 103, "signed")]);
  });
});

// ---------------------------------------------------------------------------------------------
// G. Keyboard and accessibility (AC 8)
// ---------------------------------------------------------------------------------------------
test.describe("G keyboard and accessibility", () => {
  for (const kind of HOSTS) {
    for (const key of ["Shift+F10", "ContextMenu"] as const) {
      test(`CHK10-64 [UI-B ${kind}] ${key} opens the menu on Unsigned; ArrowDown x4 reaches More formats…; Enter opens the dialog`, async ({ mm }) => {
        const h = await openF10(mm, kind);
        await select(h, 2, 3);
        await h.grid.focus();
        await h.page.keyboard.press(key);
        const menu = h.page.getByRole("menu").last();
        await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
        for (let i = 0; i < 4; i++) await h.page.keyboard.press("ArrowDown");
        await expect(menu.getByRole("menuitem", { name: "More formats…" })).toBeFocused();
        await h.page.keyboard.press("Enter");
        const d = formatDialog(h);
        await expect(d).toBeVisible();
        await expect(d.getByRole("radio", { checked: true })).toBeFocused();
      });
    }
  }

  test("CHK10-65 [UI-B] Tab order: Close, Format group, Order group, Preview region, Cancel, Apply; 16-bit skips the Order group", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [0, 3]);
    const d = await openFromMenu(h, 0);
    await radio(d, "Float 32-bit").check();
    await radio(d, "Float 32-bit").focus();
    const forward: string[] = [];
    for (let i = 0; i < 7; i++) {
      await h.page.keyboard.press("Tab");
      expect(await h.page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
      forward.push(await activeLabel(h));
    }
    expect(forward).toEqual(["Big-endian", "Preview", "Cancel", "Apply", "Close dialog", "Float 32-bit", "Big-endian"]);
    await expect(d.getByRole("region", { name: "Preview" })).toBeVisible();
    const back: string[] = [];
    for (let i = 0; i < 3; i++) {
      await h.page.keyboard.press("Shift+Tab");
      back.push(await activeLabel(h));
    }
    expect(back).toEqual(["Float 32-bit", "Close dialog", "Apply"]);
    await radio(d, "Hex").check();
    await radio(d, "Hex").focus();
    await h.page.keyboard.press("Tab");
    expect(await activeLabel(h)).toBe("Preview");
  });

  test("CHK10-66 [UI-B] Enter applies from a radio and from the Preview region; Esc cancels; the focus returns to the row", async ({ mm }) => {
    const h = await openF10(mm);
    await pick(h, [2, 3]);
    let d = await openFromMenu(h, 2);
    await radio(d, "Hex").check();
    await d.getByRole("region", { name: "Preview" }).focus();
    await h.page.keyboard.press("Enter");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 3, "hex")]);
    await pick(h, [2, 3]);
    d = await openFromMenu(h, 2);
    await radio(d, "Binary").check();
    await radio(d, "Binary").focus();
    await h.page.keyboard.press("Escape");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 3, "hex")]);
    await expect(h.grid).toBeFocused();
    const rowId = await h.row(2).getAttribute("id");
    expect(await h.grid.getAttribute("aria-activedescendant")).toBe(rowId);
    // One overlay click cancels, also right after clicking a radio.
    d = await openFromMenu(h, 2);
    await radio(d, "Signed").check();
    await h.page.mouse.click(4, 4);
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(2, 3, "hex")]);
  });

  test("CHK10-67 [UI-B] menu keyboard: arrows, Home/End, Space applies and closes, Esc returns to the row unchanged", async ({ mm }) => {
    const h = await openF10(mm);
    await select(h, 2, 3);
    await h.grid.focus();
    await h.page.keyboard.press("Shift+F10");
    const menu = h.page.getByRole("menu").last();
    await h.page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name: /^Signed/ })).toBeFocused();
    await h.page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
    await h.page.keyboard.press("End");
    await expect(menu.getByRole("menuitem").last()).toBeFocused();
    await h.page.keyboard.press("Home");
    await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ })).toBeFocused();
    await h.page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(h.grid).toBeFocused();
    expect(await viewCalls(h)).toHaveLength(0);
    await h.page.keyboard.press("Shift+F10");
    await h.page.keyboard.press("ArrowDown");
    await h.page.keyboard.press("ArrowDown");
    await h.page.keyboard.press("Space");
    await expect(h.page.getByRole("menu")).toHaveCount(0);
    await expect.poll(async () => (await viewCalls(h)).length).toBe(1);
    expect((await viewCalls(h))[0]?.[1]).toEqual({ formatOverrides: [ov(2, 3, "hex")] });
    await expect(h.grid).toBeFocused();
  });

  /** No label, heading or reason is cut (no ellipsis, nothing wider than its box). */
  async function expectNothingCut(d: Locator) {
    const cut = await d.evaluate((root) =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          "label > span:not([data-testid]), [data-testid^='width-heading-'], [data-testid^='width-reason-'], legend, [data-testid='format-summary']",
        ),
      )
        .filter((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === "ellipsis")
        .map((el) => el.textContent),
    );
    expect(cut, "texts that are cut").toEqual([]);
  }

  test("CHK10-69 [UI-B] labels are complete at 466 x 283 and at 900 x 700; only preview values may truncate (with a title)", async ({ mm }) => {
    for (const viewport of [
      { width: 466, height: 283 },
      { width: 900, height: 700 },
    ]) {
      const h = await openF10(mm, "native", { viewport });
      await collapseSetupPopover(h);
      await pick(h, [0, 4]);
      const d = await openFromMenu(h, 4);
      await expectNothingCut(d);
      await d.getByRole("button", { name: "Cancel" }).click();
      await pick(h, [0, 3]);
      await openFromMenu(h, 3);
      await radio(d, "Float 64-bit (Double)").check();
      await expectNothingCut(d);
      for (const cell of await d.getByTestId("format-preview-row").locator("td:last-child").all()) {
        await expect(cell).toHaveAttribute("title", /.+/);
      }
    }
  });

  test("CHK10-70 [UI-B] never colour only: icons and text with forced colours", async ({ mm }) => {
    const h = await openF10(mm);
    await h.page.emulateMedia({ forcedColors: "active", colorScheme: "light" });
    await select(h, 0);
    let menu = await rowMenu(h, 0);
    await expect(menu.getByRole("menuitemradio", { name: /^Unsigned/ }).locator('svg[data-icon="check"]')).toHaveCount(1);
    await h.page.keyboard.press("Escape");
    const d = await openFromMenu(h, 0);
    await expect(widthHeading(d, 32)).toContainText("unavailable");
    await expect(widthReason(d, 32).locator("svg")).toHaveCount(1);
    await expect(widthReason(d, 32)).toContainText("Needs a multiple of 2 registers");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    await mm.toolbarButton("Disconnect").click();
    await expect(h.grid).toHaveCount(0);
    await mm.statusLine(h.id).getByRole("button", { name: /^Show / }).click();
    menu = h.page.getByRole("menu").last();
    await menu.getByRole("menuitem", { name: "More formats…" }).click();
    const d2 = formatDialog(h);
    await expect(previewNotice(d2).locator("svg")).toHaveCount(1);
    await expect(previewNotice(d2)).toContainText("not connected");
  });
});
