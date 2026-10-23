// CHK-009 section L (revision 2, D-009-03 / D-009-04, REPORT-030 D2/D3/D5): the owner's screenshot
// scenario, group rows always whole, mixed formats, the actionable warning, the first overlay click,
// Esc keeping the focused row, the 466 x 283 layout and the poll going away. Browser mode, fake IPC,
// both hosts where the item says so.
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
  openFromMenu,
  openHost,
  openProfileHost,
  ov,
  profileWith,
  radio,
  select,
  storedOverrides,
  table,
  viewCalls,
  warningLines,
  infoLines,
} from "../support/chk9";

/** The selection summary of D1 (DES-010 4); it replaced the DES-009 scope line. */
const scopeOf = (d: ReturnType<typeof formatDialog>) => d.getByTestId("format-summary");
const NOTE = "The selected rows use different formats. The format you apply replaces all of them.";
const S32_BADC = [ov(0, 9, "signed32", true, false)];

async function expectEnabled(d: ReturnType<typeof formatDialog>) {
  await expect(applyButton(d)).not.toHaveAttribute("aria-disabled", "true");
}

/** Fixture S32 by the UI: Ctrl+A, D1, Signed 32-bit, Big-endian byte swap, Apply (CHK-009 section L). */
async function buildS32(h: Host): Promise<void> {
  await h.row(0).click();
  await h.page.keyboard.press("Control+a");
  const d = await openFromMenu(h, 0);
  await chooseAndApply(d, "Signed 32-bit", "Big-endian byte swap");
  await expectClosed(h);
  expect(await storedOverrides(h)).toEqual(S32_BADC);
}

test.describe("L.1 the owner's scenario", () => {
  for (const kind of ["workspace", "native"] as const) {
    test(`CHK9-94 [UI-B ${kind}] fixture S32 by the UI: row 0-1 opens on its own format, whole-row scope, Apply on`, async ({
      mm,
    }) => {
      const h = await openHost(mm, kind);
      await buildS32(h);
      const callsBefore = (await viewCalls(h)).length;
      // click, then More formats… from the menu of the same row
      await h.row(0).click();
      let d = await openFromMenu(h, 0);
      await expect(scopeOf(d)).toHaveText("Selected 2 registers (0-1)");
      await expect(radio(d, "Signed 32-bit")).toBeChecked();
      await expect(radio(d, "Big-endian byte swap")).toBeChecked();
      await expect(d.getByText("The selected rows already use this format.")).toBeVisible();
      expect(await warningLines(d)).toEqual([]);
      await expectEnabled(d);
      await expect(d).not.toContainText("1 register is selected");
      await applyButton(d).click();
      await expectClosed(h);
      expect(await viewCalls(h)).toHaveLength(callsBefore);
      // a right-click on row 0-1 without clicking first
      await h.row(3).click();
      d = await openFromMenu(h, 0);
      await expect(scopeOf(d)).toHaveText("Selected 2 registers (0-1)");
      await expectEnabled(d);
    });
  }

  test("CHK9-94 [UI-B] a screenshot of the dialog for the report", async ({ mm }, info) => {
    const h = await openHost(mm, "workspace", { formatOverrides: S32_BADC });
    await h.row(0).click();
    const d = await openFromMenu(h, 0);
    await info.attach("owner-scenario-fixed", {
      body: await d.screenshot(),
      contentType: "image/png",
    });
  });

  for (const kind of ["workspace", "native"] as const) {
    test(`CHK9-95 [UI-B ${kind}] one register: Unsigned, 32-bit is disabled with its reason, it fits with row 1; base 1 text`, async ({
      mm,
    }) => {
      const h = await openHost(mm, kind, { formatOverrides: S32_BADC });
      // row 0-1 gets Unsigned: the registers are separate rows again
      await h.row(0).click();
      let d = await openFromMenu(h, 0);
      await chooseAndApply(d, "Unsigned");
      await expectClosed(h);
      const rows = await table(h);
      expect(rows.slice(0, 3).map((r) => [r.address, r.format])).toEqual([
        ["0", "U16"],
        ["1", "U16"],
        ["2–3", "S32 BADC"],
      ]);
      // row 0 alone
      await h.row(0).click();
      d = await openFromMenu(h, 0);
      await expect(radio(d, "Unsigned")).toBeChecked();
      await expectEnabled(d);
      // D-010-01: the 32-bit width is disabled with the reason (no rounding up, no added row)
      await expect(scopeOf(d)).toHaveText("Selected 1 register (0)");
      await expect(d.getByTestId("width-reason-32")).toHaveText("Needs a multiple of 2 registers; 1 selected.");
      await expect(d.getByTestId("width-reason-32").locator("svg")).toHaveCount(1);
      await expect(radio(d, "Signed 32-bit")).toBeDisabled();
      expect(await warningLines(d)).toEqual([]);
      expect(await infoLines(d)).toEqual(["The selected rows already use this format."]);
      await d.getByRole("button", { name: "Cancel" }).click();
      await expectClosed(h);
      // Shift+click row 1, reopen, Signed 32-bit: fits
      await select(h, 0, 1);
      d = await openFromMenu(h, 1);
      await expect(radio(d, "Signed 32-bit")).toBeEnabled();
      await radio(d, "Signed 32-bit").check();
      expect(await warningLines(d)).toEqual([]);
      await expectEnabled(d);
      await d.getByRole("button", { name: "Cancel" }).click();
      await expectClosed(h);
      // address base 1: the summary says register 1
      await h.page.keyboard.press("Control+b");
      await h.row(0).click();
      d = await openFromMenu(h, 0);
      await expect(scopeOf(d)).toHaveText("Selected 1 register (1)");
      await expect(d.getByTestId("width-reason-32")).toHaveText("Needs a multiple of 2 registers; 1 selected.");
    });
  }

  test("CHK9-96 [UI-B] every path leaves the D1 scope at whole rows", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await buildS32(h);
    const scopeAfter = async (open: () => Promise<ReturnType<typeof formatDialog>>) => {
      const d = await open();
      const text = (await scopeOf(d).textContent()) ?? "";
      await expect(d).not.toContainText("1 register is selected");
      await h.page.keyboard.press("Escape");
      await expectClosed(h);
      return text;
    };
    // click 0-1
    await h.row(0).click();
    expect(await scopeAfter(() => openFromMenu(h, 0))).toBe(
      "Selected 2 registers (0-1)",
    );
    // right-click 4-5 while 0-1 is selected
    expect(await scopeAfter(() => openFromMenu(h, 2))).toBe(
      "Selected 2 registers (4-5)",
    );
    // Shift+click from 0-1 to 2-3
    await select(h, 0, 1);
    expect(await scopeAfter(() => openFromMenu(h, 1))).toBe(
      "Selected 4 registers (0-3)",
    );
    // Ctrl+click 0-1 and 4-5
    await h.row(0).click();
    await ctrlClick(h, 2);
    expect(await scopeAfter(() => openFromMenu(h, 2))).toBe(
      "Selected 4 registers (0-1, 4-5)",
    );
    // Ctrl+A
    await h.row(0).click();
    await h.page.keyboard.press("Control+a");
    expect(await scopeAfter(() => openFromMenu(h, 0))).toBe(
      "Selected 10 registers (0-9)",
    );
  });

  test("CHK9-96 [UI-B native] Format… in the header after a Signed 32-bit BADC Apply, without touching the grid", async ({
    mm,
  }) => {
    const h = await openHost(mm, "native");
    await select(h, 0, 1);
    await h.page.getByRole("button", { name: "Format…" }).click();
    const d = formatDialog(h);
    await chooseAndApply(d, "Signed 32-bit", "Big-endian byte swap");
    await expectClosed(h);
    await h.page.getByRole("button", { name: "Format…" }).click();
    await expect(scopeOf(formatDialog(h))).toHaveText(
      "Selected 2 registers (0-1)",
    );
    await expectEnabled(formatDialog(h));
  });

  test("CHK9-96 [UI-B] a schema 5 profile with poll-wide Signed 32-bit and swapBytes opens on whole rows", async ({
    mm,
  }) => {
    const profile = profileWith("OwnerV5", 5, {
      name: "Migrated",
      display: { format: "signed32", swapBytes: true, reverseWords: false },
    });
    const h = await openProfileHost(mm, profile);
    await h.row(0).click();
    const d = await openFromMenu(h, 0);
    await expect(scopeOf(d)).toHaveText("Selected 2 registers (0-1)");
    await expect(radio(d, "Signed 32-bit")).toBeChecked();
    await expect(radio(d, "Big-endian byte swap")).toBeChecked();
    await expectEnabled(d);
  });

  test("CHK9-96 [UI-B native] Esc, then Format… with the focus on 2-3", async ({ mm }) => {
    const h = await openHost(mm, "native", { formatOverrides: S32_BADC });
    await h.row(1).click();
    await h.page.keyboard.press("Escape");
    await h.page.getByRole("button", { name: "Format…" }).click();
    await expect(scopeOf(formatDialog(h))).toHaveText(
      "Selected 2 registers (2-3)",
    );
  });
});

test.describe("L.1 mixed acceptance", () => {
  test("CHK9-97 [UI-B] four Applies from a fresh poll, each leaving the other rows unchanged", async ({
    mm,
  }) => {
    const h = await openHost(mm, "workspace");
    const callsAt = async () => (await viewCalls(h)).length;
    // 1. rows 0-1 Float 32-bit Big-endian
    await select(h, 0, 1);
    const first = await openFromMenu(h, 1);
    await expect(radio(first, "Unsigned")).toBeChecked();
    await expectEnabled(first);
    expect(await warningLines(first)).toEqual([]);
    await chooseAndApply(first, "Float 32-bit", "Big-endian");
    await expectClosed(h);
    expect((await viewCalls(h)).at(-1)?.[1]).toEqual({
      formatOverrides: [{ start: 0, end: 1, format: "float32", swapBytes: false, reverseWords: false }],
    });
    // 2. row 2 Unsigned (preselected): nothing is sent
    const before = await callsAt();
    await select(h, 1, 1); // grid row 1 is register 2 now
    let d = await openFromMenu(h, 1);
    await expect(radio(d, "Unsigned")).toBeChecked();
    await applyButton(d).click();
    await expectClosed(h);
    expect(await callsAt()).toBe(before);
    // 3. rows 3-6 Signed 32-bit Big-endian (grid rows: 3 is row index 2 after the 0-1 group)
    await select(h, 2, 5);
    d = await openFromMenu(h, 5);
    await expect(radio(d, "Unsigned")).toBeChecked();
    await chooseAndApply(d, "Signed 32-bit", "Big-endian");
    await expectClosed(h);
    expect((await viewCalls(h)).at(-1)?.[1]).toEqual({
      formatOverrides: [
        { start: 0, end: 1, format: "float32", swapBytes: false, reverseWords: false },
        { start: 3, end: 6, format: "signed32", swapBytes: false, reverseWords: false },
      ],
    });
    // 4. rows 7-9 Hex
    await select(h, 4, 6); // registers 7-9
    d = await openFromMenu(h, 6);
    await expect(radio(d, "Unsigned")).toBeChecked();
    await chooseAndApply(d, "Hex");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([
      ov(0, 1, "float32"),
      ov(3, 6, "signed32"),
      ov(7, 9, "hex"),
    ]);
    const rows = await table(h);
    expect(rows.map((r) => [r.address, r.format])).toEqual([
      ["0–1", "F32 ABCD"],
      ["2", "U16"],
      ["3–4", "S32 ABCD"],
      ["5–6", "S32 ABCD"],
      ["7", "HEX"],
      ["8", "HEX"],
      ["9", "HEX"],
    ]);
    // the rows outside each selection kept their values (CHK-009: 16712, 16712, 161, then the Hex words)
    expect(rows.slice(1).map((r) => r.raw)).toEqual(["16712", "16712", "161", "0xFFFE", "0x0009", "0x000A"]);
  });

  test("CHK9-98 [UI-B] from fixture S32 without a reset: rows 3 to 6 open on Unsigned with the mixed note", async ({
    mm,
  }) => {
    const h = await openHost(mm, "workspace", {
      formatOverrides: [
        ov(0, 1, "float32"),
        ov(4, 5, "signed32", true, false),
        ov(6, 7, "hex"),
        ov(8, 9, "signed32", true, false),
      ],
    });
    // grid rows: 0-1 (0), 2 (1), 3 (2), 4-5 (3), 6 (4), 7 (5), 8-9 (6)
    await select(h, 2, 4);
    const d = await openFromMenu(h, 4);
    await expect(scopeOf(d)).toHaveText("Selected 4 registers (3-6) · mixed formats");
    await expect(radio(d, "Unsigned")).toBeChecked();
    await expect(d.getByText(NOTE)).toBeVisible();
    expect(await warningLines(d)).toEqual([]);
    await expectEnabled(d);
    await chooseAndApply(d, "Signed 32-bit", "Big-endian");
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([
      ov(0, 1, "float32"),
      ov(3, 6, "signed32"),
      ov(7, 7, "hex"),
      ov(8, 9, "signed32", true, false),
    ]);
  });
});

test.describe("L.2 preselection", () => {
  test("CHK9-99 [UI-B] mixed with a 16-bit format still opens on Unsigned (D-009-05)", async ({ mm }) => {
    const h = await openHost(mm, "workspace", {
      formatOverrides: [ov(0, 1, "float32", true, true), ov(2, 2, "hex")],
    });
    await select(h, 0, 1);
    const d = await openFromMenu(h, 1);
    await expect(radio(d, "Unsigned")).toBeChecked();
    await expect(radio(d, "Hex")).not.toBeChecked();
    await expect(d.getByText(NOTE)).toBeVisible();
    await expectEnabled(d);
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([]);
  });

  test("CHK9-100 [UI-B] the edge-cut row opens on Unsigned with the cut listed", async ({ mm }) => {
    const h = await openHost(mm, "workspace", {
      start: 101,
      qty: 4,
      formatOverrides: [ov(100, 101, "float32")],
      values: [1, 2, 3, 4],
    });
    await h.row(0).click();
    const d = await openFromMenu(h, 0);
    await expect(radio(d, "Unsigned")).toBeChecked();
    expect(await warningLines(d)).toEqual([
      "Also resets 100 to Unsigned: this change splits the Float 32-bit value 100-101. 100 is outside this poll.",
    ]);
    await expectEnabled(d);
  });

  test("CHK9-101 [UI-B] 254 outside overrides plus two blocks: the cap, not the preselection, blocks", async ({
    mm,
  }) => {
    const outside = Array.from({ length: 254 }, (_, i) => ov(1000 + 2 * i, 1000 + 2 * i, "hex"));
    const h = await openHost(mm, "workspace", {
      formatOverrides: [ov(0, 4, "hex"), ov(5, 9, "binary"), ...outside].sort(
        (a, b) => a.start - b.start,
      ),
    });
    await h.row(2).click();
    await ctrlClick(h, 7);
    const d = await openFromMenu(h, 7);
    await expect(radio(d, "Unsigned")).toBeChecked();
    await expect(d.getByRole("alert")).toContainText(
      "A poll can have at most 256 format overrides. This change would create 258. Select fewer separate blocks.",
    );
    await expect(applyButton(d)).toHaveAttribute("aria-disabled", "true");
  });
});

// CHK9-102 to CHK9-106 (rounding up, tails, the actionable warning) are retired: D-010-01 removed the
// behaviour. Their replacements are CHK10-12, 16, 17, 18, 20, 21 and 22 in chk10-format-redesign.spec.ts.

test.describe("L.4 split, Esc and QA fixes", () => {
  for (const kind of ["workspace", "native"] as const) {
    test(`CHK9-108 [UI-B ${kind}] one click on the overlay closes the dialog after pointer use inside`, async ({
      mm,
    }) => {
      const h = await openHost(mm, kind);
      const overlay = h.page.locator('[data-slot="dialog-overlay"]');
      const sequences: Array<[string, (d: ReturnType<typeof formatDialog>) => Promise<void>]> = [
        ["a format radio", async (d) => radio(d, "Hex").click()],
        [
          "an order radio",
          async (d) => {
            await radio(d, "Float 32-bit").click();
            await radio(d, "Little-endian").click();
          },
        ],
        ["the background of the body", async (d) => d.getByTestId("format-body").click({ position: { x: 4, y: 4 } })],
        [
          "a dragged text selection",
          async (d) => {
            const box = await scopeOf(d).boundingBox();
            if (!box) throw new Error("no scope line");
            await h.page.mouse.move(box.x + 2, box.y + box.height / 2);
            await h.page.mouse.down();
            await h.page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 4 });
            await h.page.mouse.up();
          },
        ],
        [
          "the reason of a disabled width",
          async (d) => {
            // two registers are selected, so the 64-bit width is disabled and says why
            await d.getByTestId("width-reason-64").click();
          },
        ],
      ];
      for (const [name, prepare] of sequences) {
        await select(h, 0, 1);
        const d = await openFromMenu(h, 0);
        await prepare(d);
        await expect(d, `still open after ${name}`).toBeVisible();
        const calls = (await viewCalls(h)).length;
        await overlay.click({ position: { x: 6, y: 6 } });
        await expect(formatDialog(h), `one overlay click closes it after ${name}`).toHaveCount(0);
        expect(await viewCalls(h)).toHaveLength(calls);
        await expect(h.grid, "focus returns to the grid").toBeFocused();
      }
    });
  }

  test("CHK9-108 [UI-B] an overlay click while Apply is pending does nothing", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await h.row(0).click();
    const d = await openFromMenu(h, 0);
    await radio(d, "Hex").check();
    await h.script((f) => {
      (window as unknown as { __rel: () => void }).__rel = f.holdReply("setPollView").release;
    });
    await applyButton(d).click();
    await expect(d.getByRole("button", { name: "Applying…" })).toBeVisible();
    await h.page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 6, y: 6 } });
    await expect(d).toBeVisible();
    await h.page.evaluate(() => (window as unknown as { __rel: () => void }).__rel());
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 0, "hex")]);
  });

  test("CHK9-109 [UI-B native] Esc keeps the focused row; Ctrl+2 and Format… act on it", async ({ mm }) => {
    const h = await openHost(mm, "native");
    await select(h, 2, 5);
    const active = await h.grid.getAttribute("aria-activedescendant");
    expect(active).not.toBeNull();
    await h.page.keyboard.press("Escape");
    await expect(h.grid).toHaveAttribute("aria-activedescendant", active as string);
    await expect(h.grid.locator("[aria-selected='true']")).toHaveCount(0);
    await h.page.keyboard.press("Control+2");
    await expect.poll(async () => storedOverrides(h)).toEqual([ov(5, 5, "signed")]);
    const button = h.page.getByRole("button", { name: "Format…" });
    await expect(button).not.toHaveAttribute("aria-disabled", "true");
    await button.click();
    await expect(scopeOf(formatDialog(h))).toHaveText("Selected 1 register (5)");
    // Esc inside D1 closes D1 only
    await h.page.keyboard.press("Escape");
    await expectClosed(h);
    await expect(h.grid).toHaveAttribute("aria-activedescendant", active as string);
    // a second Esc changes nothing
    await h.grid.focus();
    await h.page.keyboard.press("Escape");
    await expect(h.grid).toHaveAttribute("aria-activedescendant", active as string);
  });

  test("CHK9-111 [UI-B] a backend Format not applied text reaches the error box unchanged", async ({
    mm,
  }) => {
    const h = await openHost(mm, "workspace");
    await h.row(0).click();
    const d = await openFromMenu(h, 0);
    await radio(d, "Hex").check();
    const text = 'Format not applied. Rule "High" requires whole-number thresholds for 64-bit integers.';
    await h.script((f, t) => f.failNext("setPollView", t), text);
    await applyButton(d).click();
    const alert = d.getByTestId("format-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveText(text);
    await h.script((f) => f.failNext("setPollView", "Rejected view"));
    await radio(d, "Signed").check();
    await applyButton(d).click();
    await expect(alert).toHaveText("Could not apply the format. Rejected view");
  });

  for (const kind of ["workspace", "native"] as const) {
    test(`CHK9-116 [UI-B ${kind}] the poll is deleted while Apply is pending: D1 closes at once, nothing shows later`, async ({
      mm,
    }) => {
      const h = await openHost(mm, kind);
      await h.row(0).click();
      const d = await openFromMenu(h, 0);
      await radio(d, "Hex").check();
      await h.script((f) => {
        (window as unknown as { __rel: () => void }).__rel = f.holdReply("setPollView").release;
      });
      await applyButton(d).click();
      await expect(d.getByRole("button", { name: "Applying…" })).toBeVisible();
      await h.script((f, id) => f.removePoll(id), h.id);
      await expect(formatDialog(h)).toHaveCount(0);
      await h.page.evaluate(() => (window as unknown as { __rel: () => void }).__rel());
      await expect(formatDialog(h)).toHaveCount(0);
      expect(await h.announced()).not.toContain("Format applied: Hex to 0.");
      await expect(h.page.getByText(/Could not apply the format|Format not applied/)).toHaveCount(0);
      await expect(h.page.getByTestId("format-error")).toHaveCount(0);
    });
  }
});

/** D-009-05: no format or order name is cut (no ellipsis, no clipped overflow). */
async function expectLabelsNotCut(d: ReturnType<typeof formatDialog>) {
  const cut = await d.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("label > span:not([data-testid])"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === "ellipsis")
      .map((el) => el.textContent),
  );
  expect(cut, "labels that are cut").toEqual([]);
}

test.describe("CHK9-109b labels are never truncated", () => {
  test("CHK9-109b [UI-B] format and order names are complete at the normal width", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await select(h, 0, 3);
    const d = await openFromMenu(h, 0);
    await radio(d, "Float 64-bit (Double)").check();
    await expectLabelsNotCut(d);
    for (const name of ["Big-endian byte swap", "Little-endian byte swap", "Little-endian", "Big-endian"]) {
      await expect(d.getByText(name, { exact: true }).first()).toBeVisible();
    }
  });
});

test.describe("CHK9-58 the dialog fits a 466 x 283 client", () => {
  for (const kind of ["workspace", "native"] as const) {
      test(`CHK9-58 [UI-B ${kind}] title, Close, Cancel and Apply stay visible; only the body scrolls`, async ({
        mm,
      }) => {
        const h = await openHost(mm, kind, { viewport: { width: 466, height: 283 } });
        // A native window this small opens its setup as a popover over the grid: collapse it first.
        const popover = h.page.locator('[data-slot="setup-popover"]');
        if (await popover.isVisible().catch(() => false)) {
          await h.win?.rail.click();
          await expect(popover).toBeHidden();
        }
        // Rows 0-3 and 6-9: two blocks of four keep every width available, so the order group and the
        // preview are shown (the tallest content of the dialog).
        await select(h, 0, 3);
        await ctrlClick(h, 6);
        await ctrlClick(h, 7);
        await ctrlClick(h, 8);
        await ctrlClick(h, 9);
        const d = await openFromMenu(h, 9);
        await radio(d, "Unsigned 64-bit").check();
        await expect(d.getByTestId("format-preview")).toBeVisible();
        const vp = h.page.viewportSize() ?? { width: 466, height: 283 };
        for (const el of [
          d.getByRole("heading", { name: "Format / endian" }),
          d.getByRole("button", { name: "Close dialog" }),
          d.getByRole("button", { name: "Cancel" }),
          applyButton(d),
        ]) {
          const box = await el.boundingBox();
          expect(box).not.toBeNull();
          expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
          expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
          expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp.width);
          expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(vp.height);
        }
        const dialogBox = await d.boundingBox();
        expect((dialogBox?.y ?? -1) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(vp.height);
        // compact spacing below 480 px of viewport height (DES-009 11.10)
      expect(await d.evaluate((el) => getComputedStyle(el).paddingTop)).toBe("12px");
      expect(
        await d.getByRole("heading", { name: "Format / endian" }).evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("16px");
      expect(await d.getByTestId("format-body").evaluate((el) => getComputedStyle(el).overflowY)).toBe(
          "auto",
        );
        expect(
          await h.page.evaluate(
            () => document.documentElement.scrollHeight <= document.documentElement.clientHeight,
          ),
          "the document has no scrollbar",
        ).toBe(true);
        await expectLabelsNotCut(d);
        // a long radio near the bottom scrolls into view inside the body when focused
        await radio(d, "Float 64-bit (Double)").focus();
        const radioBox = await radio(d, "Float 64-bit (Double)").boundingBox();
        expect((radioBox?.y ?? 0) + (radioBox?.height ?? 0)).toBeLessThanOrEqual(vp.height);
      });
  }
});

test.describe("CHK9-113 the scale note", () => {
  test("CHK9-113 [UI-B] one combined value says in this poll, with the singular", async ({ mm }) => {
    const h = await openHost(mm, "workspace", {
      formatOverrides: [ov(2, 3, "float32")],
    });
    await h.script(
      (f, id) =>
        f.setPollView(id, {
          scale: {
            preset: "divide",
            rawSigned: false,
            xMin: 0,
            xMax: 65535,
            yMin: 0,
            yMax: 1,
            divisor: 10,
            decimals: 1,
            unit: "",
            outOfRange: "flag",
          },
        }),
      h.id,
    );
    if (!(await mm.setup(h.id).isVisible())) await mm.titleButton(h.id, /^Poll setup/).click();
    await expect(mm.setup(h.id)).toContainText(
      "Scaling applies to 16-bit rows. 1 combined value in this poll is not scaled.",
    );
  });
});
