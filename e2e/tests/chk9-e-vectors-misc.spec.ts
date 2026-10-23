// CHK-009 CHK9-08 (no Interpretation section), CHK9-21 (DES-006 decode vectors per group row, through the dialog),
// and a workspace variant of CHK9-49. QA-030, browser mode with the fake IPC.
import { expect, LAYOUT_SEED, test } from "../support/mm-fixtures";
import {
  chooseAndApply,
  expectClosed,
  formatDialog,
  openFromMenu,
  openHost,
  radio,
  select,
  storedOverrides,
  table,
  viewCalls,
} from "../support/chk9";

test.describe("CHK9-08 Poll setup has no Interpretation section", () => {
  const gone = async (scope: import("@playwright/test").Locator) => {
    await expect(scope.getByRole("region", { name: /Interpretation/i })).toHaveCount(0);
    await expect(scope.getByRole("button", { name: /Apply interpretation/i })).toHaveCount(0);
    await expect(scope.getByLabel("Byte order")).toHaveCount(0);
    await expect(scope.getByText(/Interpretation/)).toHaveCount(0);
    await expect(scope.getByText("Byte order")).toHaveCount(0);
  };

  test("CHK9-08 [UI-B] workspace sub-window setup (popover or dock)", async ({ mm }) => {
    const h = await openHost(mm, "workspace");
    await mm.titleButton(h.id, /^Poll setup/).click();
    await expect(mm.setup(h.id)).toBeVisible();
    await expect(mm.setupPopover(h.id).or(mm.setupDock(h.id))).toBeVisible();
    await gone(mm.setup(h.id));
    // The other sections are still there.
    await expect(mm.setup(h.id).getByRole("region", { name: "Scale" })).toBeVisible();
    await expect(mm.setup(h.id).getByRole("region", { name: "Value color rules" })).toBeVisible();
  });

  test("CHK9-08 [UI-B] workspace dock", async ({ mm }) => {
    await mm.open({
      polls: [{ name: "Fmt" }],
      connected: true,
      seed: LAYOUT_SEED,
      seedArg: { items: [{ index: 0, x: 8, y: 8, width: 1200, height: 640 }] },
    });
    const [id] = (await mm.pollIds()) as [number];
    await mm.titleButton(id, /^Poll setup/).click();
    await expect(mm.setupDock(id)).toBeVisible();
    await gone(mm.setup(id));
  });

  test("CHK9-08 [UI-B] native panel", async ({ mm }) => {
    const h = await openHost(mm, "native", { viewport: { width: 1000, height: 700 } });
    const panel = h.win?.setupPanel;
    if (!panel) throw new Error("no native window");
    if (!(await panel.isVisible())) await h.win?.rail.click();
    await expect(panel).toBeVisible();
    await gone(panel);
    await gone(h.page.locator("body"));
  });
});

// DES-006 section 3 vectors: [format, words, expected text].
type Vec = [string, string, number[], string];
const FFFF = 0xffff;
const VECTORS: Vec[] = [
  ["Signed 32-bit", "i32 -2", [FFFF, 0xfffe], "-2"],
  ["Unsigned 32-bit", "u32 4294967294", [FFFF, 0xfffe], "4294967294"],
  ["Signed 32-bit", "i32 min", [0x8000, 0], "-2147483648"],
  ["Signed 32-bit", "i32 max", [0x7fff, FFFF], "2147483647"],
  ["Unsigned 32-bit", "u32 max", [FFFF, FFFF], "4294967295"],
  ["Signed 64-bit", "i64 -1", [FFFF, FFFF, FFFF, FFFF], "-1"],
  ["Unsigned 64-bit", "u64 max", [FFFF, FFFF, FFFF, FFFF], "18446744073709551615"],
  ["Signed 64-bit", "i64 min", [0x8000, 0, 0, 0], "-9223372036854775808"],
  ["Signed 64-bit", "i64 max", [0x7fff, FFFF, FFFF, FFFF], "9223372036854775807"],
  ["Unsigned 64-bit", "u64 2^53", [0x0020, 0, 0, 0], "9007199254740992"],
  ["Unsigned 64-bit", "u64 2^53+1", [0x0020, 0, 0, 1], "9007199254740993"],
  ["Float 32-bit", "f32 one", [0x3f80, 0], "1"],
  ["Float 32-bit", "f32 1.5", [0x3fc0, 0], "1.5"],
  ["Float 32-bit", "f32 -1.5", [0xbfc0, 0], "-1.5"],
  ["Float 32-bit", "f32 subnormal", [0, 1], "1.401298464324817e-45"],
  ["Float 32-bit", "f32 zero", [0, 0], "0"],
  ["Float 32-bit", "f32 negative zero", [0x8000, 0], "0"],
  ["Float 32-bit", "f32 NaN", [0x7fc0, 0], "NaN"],
  ["Float 32-bit", "f32 +Infinity", [0x7f80, 0], "+Infinity"],
  ["Float 32-bit", "f32 -Infinity", [0xff80, 0], "-Infinity"],
  ["Float 64-bit (Double)", "f64 one", [0x3ff0, 0, 0, 0], "1"],
  ["Float 64-bit (Double)", "f64 1.5", [0x3ff8, 0, 0, 0], "1.5"],
  ["Float 64-bit (Double)", "f64 -1.5", [0xbff8, 0, 0, 0], "-1.5"],
  ["Float 64-bit (Double)", "f64 subnormal", [0, 0, 0, 1], "5e-324"],
  ["Float 64-bit (Double)", "f64 zero", [0, 0, 0, 0], "0"],
  ["Float 64-bit (Double)", "f64 negative zero", [0x8000, 0, 0, 0], "0"],
  ["Float 64-bit (Double)", "f64 NaN", [0x7ff8, 0, 0, 0], "NaN"],
  ["Float 64-bit (Double)", "f64 +Infinity", [0x7ff0, 0, 0, 0], "+Infinity"],
  ["Float 64-bit (Double)", "f64 -Infinity", [0xfff0, 0, 0, 0], "-Infinity"],
];

test.describe("CHK9-21 decode vectors per group row", () => {
  for (const [format, label, words, expected] of VECTORS) {
    test(`CHK9-21 [UI-B fake data, SIM BLOCKED] ${label} -> ${expected}`, async ({ mm }) => {
      const n = words.length;
      const h = await openHost(mm, "workspace", { qty: n + 2, values: [0x1111, ...words, 0x2222] });
      await select(h, 1, n);
      const d = await openFromMenu(h, 1);
      await chooseAndApply(d, format);
      await expectClosed(h);
      await expect
        .poll(async () => {
          const rows = await table(h);
          return rows.length === 3 ? rows[1]?.raw : `rows=${rows.length}`;
        })
        .toBe(expected);
      const rows = await table(h);
      // The neighbouring rows are unchanged.
      expect(rows[0]).toEqual({ address: "0", format: "U16", raw: "4369" });
      expect(rows[2]).toEqual({ address: String(n + 1), format: "U16", raw: "8738" });
      if (["NaN", "+Infinity", "-Infinity"].includes(expected)) {
        await expect(h.grid.getByRole("img", { name: /Nonfinite/ })).toHaveCount(1);
      }
    });
  }
});

test("CHK9-49 [UI-B workspace] poll removed while the dialog is open: the sub-window and dialog go away, nothing applied", async ({ mm }) => {
  const h = await openHost(mm, "workspace");
  await select(h, 2, 5);
  const d = await openFromMenu(h, 2);
  await radio(d, "Float 32-bit").check();
  await h.script((f, id) => f.removePoll(id), h.id);
  await expectClosed(h);
  await expect(mm.sub(h.id)).toHaveCount(0);
  expect(await viewCalls(h)).toHaveLength(0);
  void storedOverrides;
  void formatDialog;
});
