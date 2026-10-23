// CHK-009 sections H (interactions), I (persistence, migration, hosts), J (no traffic, Modified), QA-030.
// Browser mode, fake IPC. [UI-R] and [SIM] parts are reported separately as BLOCKED in REPORT-030.
import { expect, type Mm, test } from "../support/mm-fixtures";
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
} from "../support/chk9";

const DIVIDE10 = {
  preset: "divide",
  rawSigned: false,
  xMin: 0,
  xMax: 65535,
  yMin: 0,
  yMax: 100,
  divisor: 10,
  decimals: 1,
  unit: "",
  outOfRange: "flag",
};
const FLOAT_2_5 = [ov(2, 5, "float32")];

async function setView(h: Host, patch: Record<string, unknown>) {
  await h.script((f, a) => f.setPollView(a.id, a.patch), { id: h.id, patch });
}

async function openSetupPopover(mm: Mm, id: number) {
  if (!(await mm.setup(id).isVisible())) await mm.titleButton(id, /^Poll setup/).click();
  await expect(mm.setup(id)).toBeVisible();
}

const clip = async (h: Host, fn: () => Promise<void>): Promise<string> => {
  await h.mm.setClipboard("");
  await fn();
  await expect.poll(() => h.mm.clipboardText()).not.toBe("");
  return h.mm.clipboardText();
};

test.describe("H interactions", () => {
  test("CHK9-67 [UI-B] scale on a mixed poll: 16-bit rows scaled as before, group rows n/a, scale untouched, Scale note", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await setView(h, { scale: DIVIDE10, valueColumns: "both" });
    await expect(h.grid.getByRole("columnheader", { name: /^Scaled/ })).toBeVisible();
    const scaledOf = async (): Promise<string[]> =>
      h.grid.locator("[data-row]").evaluateAll((rows) => rows.map((r) => (r.querySelector('[data-cell="scaled"]')?.textContent ?? "").trim()));
    const before = await scaledOf();
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    await expectTable(h, [
      ["0", "U16", "1"],
      ["1", "U16", "2"],
      ["2", "F32 ABCD", "12.5"],
      ["3", "--", "--"],
      ["4", "F32 ABCD", "12.5"],
      ["5", "--", "--"],
      ["6", "U16", "161"],
      ["7", "U16", "65534"],
      ["8", "U16", "9"],
      ["9", "U16", "10"],
    ]);
    const after = await scaledOf();
    for (const i of [0, 1, 6, 7, 8, 9]) expect(after[i], `scaled of row ${i}`).toBe(before[i]);
    expect(after[2]).toBe("n/a");
    expect(after[3]).toBe("--");
    expect(after[4]).toBe("n/a");
    expect(after[5]).toBe("--");
    await expect(h.grid.getByLabel("Scaling is unavailable for combined values.")).toHaveCount(2);
    const cfg = await h.script((f, id) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === id).config, h.id);
    expect(cfg.scale).toMatchObject({ preset: "divide", divisor: 10 });
    expect(cfg.scaleOverrides).toEqual([]);
    await openSetupPopover(mm, h.id);
    await expect(mm.setup(h.id)).toContainText("Scaling applies to 16-bit rows. 2 combined values in this poll are not scaled.");
  });

  test("CHK9-68 [UI-B] Set scale with group rows is disabled; U16 rows open the override dialog; saved scale kept and noted in the inspector", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
    await setView(h, { scale: DIVIDE10, valueColumns: "both", scaleOverrides: [{ start: 2, end: 3, scale: { ...DIVIDE10, divisor: 100 } }] });
    await select(h, 2);
    await h.row(2).click({ button: "right" });
    const item = h.page.getByRole("menuitem", { name: /^Set scale for selected rows…/ });
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute("title", "Scaling is unavailable for combined values.");
    await h.page.getByRole("menuitem", { name: "Inspect raw registers" }).click();
    const dlg = h.page.getByRole("dialog", { name: /^Raw registers/ });
    await expect(dlg).toContainText("Saved scales apply again when these registers use a 16-bit format.");
    await h.page.keyboard.press("Escape");
    await h.page.keyboard.press("Control+Shift+e");
    await expect(h.page.getByRole("dialog", { name: /Scale override/ })).toHaveCount(0);
    // U16 rows 6-7 open S8 as before.
    await select(h, 4, 5);
    await h.page.keyboard.press("Control+Shift+e");
    await expect(h.page.getByRole("dialog", { name: /Scale override/ })).toBeVisible();
    const cfg = await h.script((f, id) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === id).config.scaleOverrides, h.id);
    expect(cfg).toHaveLength(1);
  });

  test("CHK9-69 [UI-B] Raw is signed pre-check follows the format of the 16-bit rows", async ({ mm }) => {
    const signedAll = [ov(0, 9, "signed")];
    // All Signed, no saved scale: the poll scale editor starts checked.
    let h = await openHost(mm, "workspace", { formatOverrides: signedAll });
    await openSetupPopover(mm, h.id);
    const editor = mm.setup(h.id).getByRole("region", { name: "Scale" });
    await editor.getByLabel("Preset").selectOption("divide");
    await expect(editor.getByLabel("Raw is signed")).toBeChecked();
    // One row Unsigned: unchecked.
    h = await openHost(mm, "workspace", { formatOverrides: [ov(0, 5, "signed"), ov(7, 9, "signed")] });
    await openSetupPopover(mm, h.id);
    const editor2 = mm.setup(h.id).getByRole("region", { name: "Scale" });
    await editor2.getByLabel("Preset").selectOption("divide");
    await expect(editor2.getByLabel("Raw is signed")).not.toBeChecked();
    // A new override on Signed rows 6-7 starts checked.
    h = await openHost(mm, "workspace", { formatOverrides: [ov(6, 7, "signed")] });
    await select(h, 6, 7);
    await h.page.keyboard.press("Control+Shift+e");
    const dlg = h.page.getByRole("dialog", { name: /Scale override/ });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel("Preset").selectOption("divide");
    await expect(dlg.getByLabel("Raw is signed")).toBeChecked();
  });

  test("CHK9-70 [UI-B] Show Scaled: group rows show only n/a; the dialog notes it and Apply stays enabled", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: FLOAT_2_5 });
    await setView(h, { scale: DIVIDE10, valueColumns: "scaled" });
    const cells = await h.grid.locator("[data-row]").evaluateAll((rows) => rows.map((r) => (r.querySelector('[data-cell="raw"]')?.textContent ?? "").trim()));
    expect(cells.length).toBe(10);
    await select(h, 0, 1);
    const d = await openFromMenu(h, 0);
    await radio(d, "Unsigned 32-bit").check();
    await expect(messages(d)).toContainText(
      "This poll shows Scaled values only. Combined values have no scaled value; choose Show Both or Raw to see them.",
    );
    await expect(applyButton(d)).not.toHaveAttribute("aria-disabled", "true");
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 1, "unsigned32"), ov(2, 5, "float32")].sort((a, b) => a.start - b.start));
  });

  test("CHK9-71 [UI-B] color rules per row: U16 row 7 highlighted, not after Signed; group rows at their first address; marker text", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: FLOAT_2_5 });
    await setView(h, {
      colorRules: [{ name: "Rule 1", enabled: true, range: null, source: "raw", comparison: "greaterThan", threshold: "10", upperThreshold: null, highlight: "lime" }],
    });
    const marker = (i: number) => h.row(i).getByRole("img", { name: /^Rule: Rule 1/ });
    // Every register has a row; only group heads 2 and 4 carry decoded markers.
    await expect(marker(2)).toHaveCount(1);
    await expect(marker(3)).toHaveCount(0);
    await expect(marker(4)).toHaveCount(1);
    await expect(marker(6)).toHaveCount(1); // register 6 = 161
    await expect(marker(7)).toHaveCount(1); // register 7 = 65534
    await expect(marker(0)).toHaveCount(0);
    await expect(marker(8)).toHaveCount(0);
    // Highlighted at the first address only: one marker per group row.
    await expect(h.row(2).getByRole("img", { name: /^Rule:/ })).toHaveCount(1);
    await select(h, 7);
    await h.page.keyboard.press("Control+2");
    await expect.poll(async () => (await storedOverrides(h)).some((o) => o.start === 7 && o.format === "signed")).toBe(true);
    await expect(marker(7)).toHaveCount(0);
    await expect(marker(2)).toHaveCount(1);
    // A rule on the Displayed value names the column "Interpreted" on group rows (the CHK text).
    await setView(h, {
      colorRules: [{ name: "Shown", enabled: true, range: null, source: "displayed", comparison: "greaterThan", threshold: "10", upperThreshold: null, highlight: "lime" }],
    });
    const shown = h.row(2).getByRole("img", { name: /^Rule: Shown/ });
    await expect(shown).toHaveCount(1);
    expect(await shown.getAttribute("aria-label")).toContain("Displayed → Interpreted");
  });

  test("CHK9-72 [UI-B] 64-bit integer rule: exact threshold validates for range 0-3 and 0-4; 1.5 on 0-3 is rejected", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(0, 3, "unsigned64")] });
    await openSetupPopover(mm, h.id);
    await mm.setup(h.id).getByRole("button", { name: "Edit rules…" }).click();
    const dlg = h.page.getByRole("dialog", { name: /^Value color rules/ });
    await dlg.getByRole("button", { name: "Add rule", exact: true }).click();
    await dlg.getByLabel("Source", { exact: true }).selectOption("raw");
    await dlg.getByLabel("Comparison", { exact: true }).selectOption("equals");
    await dlg.getByRole("combobox", { name: /^Addresses/ }).selectOption("range");
    await dlg.getByLabel("Start address", { exact: true }).fill("0");
    await dlg.getByLabel("End address", { exact: true }).fill("3");
    await dlg.getByLabel("Threshold", { exact: true }).fill("18446744073709551615");
    await dlg.getByRole("button", { name: "Apply rules", exact: true }).click();
    await expect(dlg).toBeHidden();
    expect(((await storedRules(h))[0] as { threshold: string }).threshold).toBe("18446744073709551615");
    // Range 0-4 also validates (meets Unsigned too).
    await mm.setup(h.id).getByRole("button", { name: "Edit rules…" }).click();
    await dlg.getByLabel("End address", { exact: true }).fill("4");
    await dlg.getByRole("button", { name: "Apply rules", exact: true }).click();
    await expect(dlg).toBeHidden();
    expect(((await storedRules(h))[0] as { range: { end: number } }).range.end).toBe(4);
    // 1.5 on 0-3 is rejected with the integer message.
    await mm.setup(h.id).getByRole("button", { name: "Edit rules…" }).click();
    await dlg.getByLabel("End address", { exact: true }).fill("3");
    await dlg.getByLabel("Threshold", { exact: true }).fill("1.5");
    await dlg.getByRole("button", { name: "Apply rules", exact: true }).click();
    await expect(dlg).toContainText("Enter a whole decimal number for a 64-bit integer comparison.");
    await expect(dlg).toBeVisible();
  });

  test("CHK9-73 [UI-B] copy: Mixed / Unsigned / Interpreted headers, raw registers, alias, toast", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: FLOAT_2_5 });
    // Rows 1 and 2-3 selected: Copy with header.
    await select(h, 1, 2);
    await h.row(1).click({ button: "right" });
    let text = await clip(h, () => h.page.getByRole("menuitem", { name: "Copy with header" }).click());
    expect(text).toBe("Address (0-based)\tRaw (Mixed)\n1\t2\n2\t12.5\n3\t--");
    await expect(mm.toast("Copied 3 rows.")).toBeVisible();
    // Rows 6-7 (both U16).
    await select(h, 6, 7);
    await h.row(6).click({ button: "right" });
    text = await clip(h, () => h.page.getByRole("menuitem", { name: "Copy with header" }).click());
    expect(text.split("\n")[0]).toBe("Address (0-based)\tRaw (Unsigned)");
    // 2-3 and 4-5 only.
    await select(h, 2, 4);
    await h.row(2).click({ button: "right" });
    text = await clip(h, () => h.page.getByRole("menuitem", { name: "Copy with header" }).click());
    expect(text).toBe("Address (0-based)\tInterpreted (Float 32-bit)\n2\t12.5\n3\t--\n4\t12.5\n5\t--");
    // Copy raw registers on 2-3.
    await select(h, 2);
    await h.row(2).click({ button: "right" });
    text = await clip(h, () => h.page.getByRole("menuitem", { name: "Copy raw registers" }).click());
    expect(text).toBe("2\t16712\n3\t0");
    await expect(mm.toast("Copied 2 rows.").first()).toBeVisible();
    // Include alias: each line starts with that register's alias.
    await setView(h, { aliases: [{ address: 2, alias: "Flow" }, { address: 3, alias: "Flow low" }], display: { addressBase: 0, showAlias: true, copyAlias: true } });
    await select(h, 2);
    await h.row(2).click({ button: "right" });
    text = await clip(h, () => h.page.getByRole("menuitem", { name: "Copy raw registers" }).click());
    expect(text).toBe("Flow\t2\t16712\nFlow low\t3\t0");
  });

  test("CHK9-74 [UI-B] copy with Both: empty scaled field for a group row; Copy scaled disabled on a group row only", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: FLOAT_2_5 });
    await setView(h, { scale: DIVIDE10, valueColumns: "both" });
    await select(h, 1, 2);
    await h.row(1).click({ button: "right" });
    const text = await clip(h, () => h.page.getByRole("menuitem", { name: "Copy Ctrl+C", exact: true }).click());
    expect(text.split("\n")).toEqual(["1\t2\t0.2", "2\t12.5\t", "3\t--\t--"]);
    await select(h, 2);
    await h.row(2).click({ button: "right" });
    const scaled = h.page.getByRole("menuitem", { name: "Copy scaled", exact: true });
    await expect(scaled).toBeDisabled();
    await expect(scaled).toHaveAttribute("title", "Scaling is unavailable for combined values.");
  });

  test("CHK9-75 [UI-B fake, SIM BLOCKED] Write from rows: prefill by row format, group target and notes, FC06 and FC16 requests", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: FLOAT_2_5 });
    await select(h, 6);
    await h.page.keyboard.press("Control+3");
    await expect.poll(async () => (await storedOverrides(h)).some((o) => o.start === 6 && o.format === "hex")).toBe(true);
    await h.row(6).click({ button: "right" });
    await h.page.getByRole("menuitem", { name: /^Write…/ }).click();
    const w = mm.writeDialog;
    await expect(w).toBeVisible();
    await expect(w.getByLabel("Value", { exact: true })).toHaveValue("0x00A1");
    await expect(w.getByRole("radio", { name: "Hex", exact: true })).toBeChecked();
    await h.page.keyboard.press("Escape");
    await expect(w).toHaveCount(0);
    // From the group head at register 4.
    await h.row(4).click({ button: "right" });
    await h.page.getByRole("menuitem", { name: /^Write…/ }).click();
    await expect(w).toBeVisible();
    await expect(w.getByLabel("Start address")).toHaveValue("4");
    await expect(w.getByLabel("Raw register value (16-bit)")).toHaveValue("16712");
    await expect(w.getByText("Writes send individual 16-bit registers. Combined values are not encoded.")).toBeVisible();
    await w.getByRole("button", { name: /^Send/ }).click();
    await expect.poll(async () => (await mm.calls("write")).length).toBe(1);
    expect((await mm.calls("write"))[0]?.[0]).toMatchObject({ function: 6, address: 4, values: [16712] });
    // The write is served in virtual time.
    await mm.advance(300);
    await expect(w.getByRole("button", { name: /^Send/ })).toBeEnabled();
    // FC16.
    await w.getByLabel("Function").selectOption("16");
    await w.getByLabel(/^Values/).fill("16712");
    await w.getByRole("button", { name: /^Send/ }).click();
    await expect.poll(async () => (await mm.calls("write")).length).toBe(2);
    expect((await mm.calls("write"))[1]?.[0]).toMatchObject({ function: 16, address: 4, values: [16712] });
  });

  test("CHK9-76 [UI-B] aliases: group row shows the first alias, nothing is lost, Clear alias and Paste go by row", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { aliases: [{ address: 2, alias: "Flow" }, { address: 3, alias: "Flow low" }] });
    await select(h, 2, 3);
    const d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    await expect(h.row(2)).toContainText("Flow");
    await expect(h.row(3)).toContainText("Flow low");
    await h.row(2).click({ button: "right" });
    await h.page.getByRole("menuitem", { name: "Inspect raw registers" }).click();
    const dlg = h.page.getByRole("dialog", { name: /^Raw registers/ });
    await expect(dlg).toContainText("Flow");
    await expect(dlg).toContainText("Flow low");
    await h.page.keyboard.press("Escape");
    // Back to U16: both aliases again.
    await select(h, 2);
    await h.page.keyboard.press("Control+1");
    await expect.poll(async () => (await table(h)).length).toBe(10);
    await expect(h.row(2)).toContainText("Flow");
    await expect(h.row(3)).toContainText("Flow low");
    // Group again, Clear alias on the group row clears only "Flow".
    await select(h, 2, 3);
    const d2 = await openFromMenu(h, 2);
    await chooseAndApply(d2, "Float 32-bit");
    await expectClosed(h);
    await select(h, 2);
    await h.row(2).click({ button: "right" });
    await h.page.getByRole("menuitem", { name: "Clear alias" }).click();
    const aliases = () => h.script((f, id) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === id).config.aliases, h.id);
    await expect.poll(aliases).toEqual([{ address: 3, alias: "Flow low" }]);
    // Paste three lines from row 1: addresses 1, 2 and continuation 3.
    await mm.setClipboard("A\nB\nC");
    await select(h, 1);
    await h.page.keyboard.press("Control+v");
    await expect
      .poll(aliases)
      .toEqual([
        { address: 1, alias: "A" },
        { address: 2, alias: "B" },
        { address: 3, alias: "C" },
      ]);
  });

  test("CHK9-77 [UI-B] Format column: min width 64, double-click auto-fit, Alias toggle, no column on FC01/02", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: FLOAT_2_5 });
    const handle = h.grid.locator('[data-resize-handle="format"]');
    await expect(handle).toHaveAttribute("aria-valuemin", "64");
    const start = Number(await handle.getAttribute("aria-valuenow"));
    expect(start).toBe(96);
    const box = await handle.boundingBox();
    if (!box) throw new Error("no handle");
    await h.page.mouse.move(box.x + 2, box.y + 8);
    await h.page.mouse.down();
    await h.page.mouse.move(box.x - 200, box.y + 8, { steps: 6 });
    await h.page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "64");
    await handle.dblclick();
    const fit = Number(await handle.getAttribute("aria-valuenow"));
    expect(fit).toBeGreaterThanOrEqual(64);
    expect(fit).toBeLessThan(200);
    // Alias column toggle still works.
    await expect(h.grid.getByRole("columnheader", { name: /^Alias/ })).toBeVisible();
    await mm.statusLine(h.id).getByRole("button", { name: /^Show / }).click();
    await h.page.getByRole("menuitemcheckbox", { name: "Alias column" }).click();
    await expect(h.grid.getByRole("columnheader", { name: /^Alias/ })).toHaveCount(0);
    await expect(h.grid.getByRole("columnheader", { name: /^Format/ })).toBeVisible();
  });
});

async function storedRules(h: Host): Promise<unknown[]> {
  return h.script((f, id) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === id).config.colorRules, h.id);
}

const V5_LE = (over: Record<string, unknown> = {}, def: Record<string, unknown> = {}) =>
  profileWith(
    "Legacy",
    5,
    {
      definition: { startAddress: 100, quantity: 5, ...def },
      display: { format: "float32", swapBytes: true, reverseWords: true, ...over },
    },
    { migratedFrom: 5 },
  );

test.describe("I persistence, migration and hosts", () => {
  test("CHK9-78 [UI-B fake migration] schema 5 Float32 little-endian, Start 100, Quantity 5 looks as before", async ({ mm }) => {
    // Words for 12.5 in Little-endian (DCBA): 0x0000 0x4841. Third value is cut by the poll end.
    const h = await openProfileHost(mm, V5_LE(), [0x0000, 0x4841, 0x0000, 0x4841, 0x1234]);
    expect(await mm.modified()).toBe(false);
    expect(await mm.callCount("profilesSave")).toBe(0);
    expect(await storedOverrides(h)).toEqual([ov(100, 105, "float32", true, true)]);
    await expectTable(h, [
      ["100", "F32 DCBA", "12.5"],
      ["101", "--", "--"],
      ["102", "F32 DCBA", "12.5"],
      ["103", "--", "--"],
      ["104", "F32 DCBA", "Incomplete"],
    ]);
    await expect(h.grid.getByRole("img", { name: "Needs 2 registers; only 1 available." })).toBeVisible();
    expect(await mm.modified()).toBe(false);
    expect(await mm.callCount("profilesSave")).toBe(0);
  });

  test("CHK9-79 [UI-B fake migration] schema 5 default format loads with no override and U16 rows", async ({ mm }) => {
    const h = await openProfileHost(mm, V5_LE({ format: "unsigned", swapBytes: false, reverseWords: false }), [1, 2, 3, 4, 5]);
    expect(await storedOverrides(h)).toEqual([]);
    await expectTable(h, [100, 101, 102, 103, 104].map((a, i) => [String(a), "U16", String(i + 1)] as [string, string, string]));
    expect(await mm.modified()).toBe(false);
  });

  test("CHK9-80 [UI-B fake migration] schema 5 other cases (the Rust migration itself is BLOCKED here)", async ({ mm }) => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, unknown[]]> = [
      ["hex", { format: "hex", swapBytes: false, reverseWords: false }, { startAddress: 0, quantity: 10 }, [ov(0, 9, "hex")]],
      ["float64 at 65533", { format: "float64", swapBytes: false, reverseWords: false }, { startAddress: 65533, quantity: 3 }, []],
      ["signed64 q8", { format: "signed64", swapBytes: false, reverseWords: false }, { startAddress: 0, quantity: 8 }, [ov(0, 7, "signed64")]],
      ["hex with swapBytes", { format: "hex", swapBytes: true, reverseWords: false }, { startAddress: 0, quantity: 4 }, [ov(0, 3, "hex")]],
    ];
    for (const [label, display, def, want] of cases) {
      const h = await openProfileHost(mm, V5_LE(display, def), null);
      expect(await storedOverrides(h), label).toEqual(want);
    }
  });

  test("CHK9-82 [UI-B fake] round trip: schema 6 file, reopen shows the same rows and orders", async ({ mm }) => {
    const overrides = [ov(0, 1, "float32", true, true), ov(2, 2, "hex"), ov(4, 7, "unsigned64", true, false)];
    const h = await openHost(mm, "workspace", { formatOverrides: overrides });
    await expect
      .poll(async () => (await table(h)).map((r) => `${r.address}:${r.format}`))
      .toEqual(["0:F32 DCBA", "1:--", "2:HEX", "3:U16", "4:U64 BADCFEHG", "5:--", "6:--", "7:--", "8:U16", "9:U16"]);
    await mm.openMenu("File");
    await mm.menuItem("Save as…").click();
    await mm.saveAsDialog.getByLabel("Name").fill("Round trip");
    await mm.saveAsDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mm.profileLabel).toContainText("Round trip");
    const saved = ((await mm.lastCall("profilesSave")) as [Record<string, unknown>, boolean])[0];
    expect(saved.schemaVersion).toBe(6);
    expect((saved.polls as Array<{ formatOverrides: unknown }>)[0]?.formatOverrides).toEqual(overrides);
    const rowsBefore = await table(h);
    // "Close and reopen": a new window whose backend has only the saved file.
    const page2 = await mm.page.context().newPage();
    const mm2 = new (mm.constructor as typeof Mm)(page2);
    await mm2.open({ seed: (f, a) => f.seedProfiles([a]), seedArg: saved });
    await page2.bringToFront();
    await mm2.openMenu("File");
    await mm2.menuItem("Open profile…").click();
    await mm2.openDialog.getByRole("row", { name: /Round trip/ }).dblclick();
    const id2 = await mm2.idOf("Fmt");
    await mm2.connectVirtual();
    await mm2.script((f, a) => f.emitPollUpdate(a.id, { values: a.values }), { id: id2, values: [1, 2, 0x4148, 0, 0x4148, 0, 0xa1, 0xfffe, 9, 10] });
    const h2: Host = { kind: "workspace", page: page2, id: id2, grid: mm2.grid(id2), row: (i) => mm2.gridRow(id2, i), calls: (m) => mm2.calls(m), script: (fn, arg) => mm2.script(fn, arg), announced: async () => [], mm: mm2, win: null };
    expect((await table(h2)).map((r) => `${r.address}:${r.format}`)).toEqual(rowsBefore.map((r) => `${r.address}:${r.format}`));
    expect(await storedOverrides(h2)).toEqual(overrides);
  });

  test("CHK9-83 [UI-B] duplicate (single and bulk) copies the overrides exactly; the copy is independent", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { name: "Tank", formatOverrides: [ov(0, 1, "float32"), ov(4, 7, "unsigned64", true, true)] });
    const tank = mm.page.getByRole("listitem", { name: /^Tank, / });
    // The row's show button covers the actions button for the pointer: open it from the keyboard.
    await tank.getByRole("button", { name: "Actions for Tank" }).focus();
    await mm.page.keyboard.press("Enter");
    await mm.page.getByRole("menuitem", { name: /^Duplicate/ }).click();
    await expect(mm.page.getByRole("listitem", { name: /^Tank copy, / })).toBeVisible();
    const copyId = await mm.idOf("Tank copy");
    const get = (id: number) => mm.script((f, i) => f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === i).config.formatOverrides, id);
    expect(await get(copyId)).toEqual(await get(h.id));
    // Changing the copy does not change the original.
    const hc: Host = { ...h, id: copyId, grid: mm.grid(copyId), row: (i) => mm.gridRow(copyId, i) };
    await expect(hc.grid).toBeVisible();
    await hc.row(0).click();
    await mm.page.keyboard.press("Control+a");
    await mm.page.keyboard.press("Control+3");
    await expect.poll(async () => (await get(copyId)).some((o: { format: string }) => o.format === "hex")).toBe(true);
    expect(await get(h.id)).toEqual([ov(0, 1, "float32"), ov(4, 7, "unsigned64", true, true)]);
    // Bulk duplicate: select the sidebar checkboxes and press Duplicate selected.
    await tank.getByRole("checkbox", { name: "Select Tank" }).check();
    await mm.page.getByRole("button", { name: "Duplicate selected" }).click();
    const confirm = mm.page.getByRole("dialog");
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.getByRole("button", { name: /Duplicate/ }).click();
    }
    await expect.poll(async () => (await mm.pollIds()).length).toBeGreaterThanOrEqual(3);
    const created = (await mm.pollIds()).filter((i) => i !== h.id && i !== copyId);
    expect(created).toHaveLength(1);
    expect(await get(created[0] as number)).toEqual(await get(h.id));
  });

  test("CHK9-84 [UI-B handoff only, pop out and dock in a real window BLOCKED] the handoff carries no format draft and the overrides stay in Rust", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: FLOAT_2_5 });
    await select(h, 2);
    await h.page.keyboard.press("Control+Shift+o");
    await expect.poll(async () => (await mm.calls("popOutPoll")).length).toBeGreaterThan(0);
    const handoff = JSON.stringify((await mm.calls("popOutPoll"))[0]);
    expect(handoff).not.toContain("interpretationDraft");
    expect(handoff).not.toContain("groupWidth");
    expect(handoff.length).toBeGreaterThan(2);
    expect(await storedOverrides(h)).toEqual(FLOAT_2_5);
  });
});

test.describe("J no traffic, Modified", () => {
  test("CHK9-86 [UI-B fake, SIM BLOCKED] four ways to change a format send no request and no frame", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    const snap = () => mm.script((f) => ({ log: f.requestLog.length, req: f.snapshot().polls[0].counters.requests, err: f.snapshot().polls[0].counters.errors, calls: f.calls.filter((c: { method: string }) => !["setPollView"].includes(c.method)).length }));
    const before = await snap();
    // 1. D1
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    // 2. Ctrl+3
    await select(h, 0);
    await h.page.keyboard.press("Control+3");
    // 3. Narrow Show menu
    await select(h, 1);
    await mm.statusLine(h.id).getByRole("button", { name: /^Show / }).click();
    await h.page.getByRole("menuitemradio", { name: "Binary Ctrl+4" }).click();
    await expect.poll(async () => (await storedOverrides(h)).length).toBeGreaterThanOrEqual(3);
    // 4. Header button (native window)
    const w = await openHost(mm, "native");
    const wBefore = await w.script((f) => ({ log: f.requestLog.length, req: f.snapshot().polls[0].counters.requests }));
    await select(w, 2, 3);
    await w.page.getByRole("button", { name: "Format…" }).click();
    await chooseAndApply(formatDialog(w), "Hex");
    await expectClosed(w);
    const after = await snap();
    expect(after.log).toBe(before.log);
    expect(after.req).toBe(before.req);
    expect(after.err).toBe(before.err);
    expect(after.calls).toBe(before.calls);
    expect(await w.script((f) => ({ log: f.requestLog.length, req: f.snapshot().polls[0].counters.requests }))).toEqual(wBefore);
  });

  test("CHK9-87 [UI-B] Modified: Apply marks it; Cancel, an unchanged Apply, opening and new data do not", async ({ mm }) => {
    const h = await openHost(mm, "workspace", { formatOverrides: [ov(2, 3, "float32")] });
    expect(await mm.modified()).toBe(false);
    await select(h, 2);
    let d = await openFromMenu(h, 2);
    expect(await mm.modified()).toBe(false);
    await radio(d, "Hex").check();
    await d.getByRole("button", { name: "Cancel" }).click();
    await expectClosed(h);
    expect(await mm.modified()).toBe(false);
    d = await openFromMenu(h, 2);
    await applyButton(d).click(); // unchanged
    await expectClosed(h);
    expect(await mm.modified()).toBe(false);
    await mm.script((f, id) => f.emitPollUpdate(id, { values: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9] }), h.id);
    await mm.advance(200);
    expect(await mm.modified()).toBe(false);
    d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Hex");
    await expectClosed(h);
    await expect.poll(() => mm.modified()).toBe(true);
    await expect(mm.profileLabel).toContainText("Modified");
    await expect.poll(async () => (await mm.windowTitles()).at(-1) ?? "").toContain("*");
  });

  test("CHK9-88 [UI-B fake, SIM BLOCKED] paused: a format change sends nothing and the poll stays paused", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await h.grid.focus();
    await h.page.keyboard.press("Control+p");
    await expect(mm.statusLine(h.id)).toContainText("Paused");
    const before = await mm.script((f) => ({ log: f.requestLog.length, req: f.snapshot().polls[0].counters.requests }));
    const resumes = await mm.callCount("resumePoll");
    await select(h, 2, 5);
    const d = await openFromMenu(h, 2);
    await chooseAndApply(d, "Float 32-bit");
    await expectClosed(h);
    await mm.advance(500);
    expect(await mm.script((f) => ({ log: f.requestLog.length, req: f.snapshot().polls[0].counters.requests }))).toEqual(before);
    expect(await mm.callCount("resumePoll")).toBe(resumes);
    await expect(mm.statusLine(h.id)).toContainText("Paused");
  });
});

export { ctrlClick, viewCalls };
