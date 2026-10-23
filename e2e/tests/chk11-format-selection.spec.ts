// REQ-011: UI regression for completing selected register runs with following poll registers.
import { expect, test } from "../support/mm-fixtures";
import {
  applyButton,
  expectClosed,
  infoLines,
  openFromMenu,
  openHost,
  ov,
  previewRows,
  radio,
  select,
  storedOverrides,
  summary,
  viewCalls,
  widthHeading,
} from "../support/chk9";

for (const kind of ["workspace", "native"] as const) {
  test(`CHK11-01 [UI-B ${kind}] one register forms a 32-bit value with the next register`, async ({ mm }) => {
    const h = await openHost(mm, kind, { values: [100, 200, 400, 50], qty: 4 });
    const requests = await h.script((f) => f.requestLog.length);
    await select(h, 0);
    const d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 1 register (0)");
    await expect(radio(d, "Unsigned 32-bit")).toBeEnabled();
    await radio(d, "Unsigned 32-bit").check();
    await expect(widthHeading(d, 32)).toHaveText("32-bit · 1 value (2 registers each)");
    expect(await previewRows(d)).toEqual([["0-1", "6553800"]]);
    expect(await infoLines(d)).toContain("Also includes register 1 to complete the selected values.");
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 1, "unsigned32")]);
    expect(await h.script((f) => f.requestLog.length)).toBe(requests);
  });

  test(`CHK11-02 [UI-B ${kind}] three selected registers include the fourth`, async ({ mm }) => {
    const h = await openHost(mm, kind, { values: [100, 200, 400, 50, 0, 0], qty: 6 });
    await select(h, 0, 2);
    const d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 3 registers (0-2)");
    await radio(d, "Unsigned 32-bit").check();
    await expect(widthHeading(d, 32)).toHaveText("32-bit · 2 values (2 registers each)");
    expect(await previewRows(d)).toEqual([["0-1", "6553800"], ["2-3", "26214450"]]);
    expect(await infoLines(d)).toContain("Also includes register 3 to complete the selected values.");
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 3, "unsigned32")]);
  });

  test(`CHK11-03 [UI-B ${kind}] ten selected registers form three 64-bit values`, async ({ mm }) => {
    const h = await openHost(mm, kind, { values: Array.from({ length: 12 }, (_, i) => i), qty: 12 });
    await select(h, 0, 9);
    const d = await openFromMenu(h, 0);
    await expect(summary(d)).toHaveText("Selected 10 registers (0-9)");
    await radio(d, "Unsigned 64-bit").check();
    await expect(widthHeading(d, 64)).toHaveText("64-bit · 3 values (4 registers each)");
    expect((await previewRows(d)).map(([address]) => address)).toEqual(["0-3", "4-7", "8-11"]);
    expect(await infoLines(d)).toContain("Also includes registers 10-11 to complete the selected values.");
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([ov(0, 11, "unsigned64")]);
  });

  test(`CHK11-04 [UI-B ${kind}] a final register stays 16-bit`, async ({ mm }) => {
    const h = await openHost(mm, kind, { values: [100, 200, 400, 50], qty: 4 });
    await select(h, 3);
    const d = await openFromMenu(h, 3);
    await expect(radio(d, "Float 32-bit")).toBeEnabled();
    await radio(d, "Float 32-bit").check();
    await expect(widthHeading(d, 32)).toHaveText("32-bit · 0 values (2 registers each)");
    expect(await previewRows(d)).toEqual([]);
    expect(await infoLines(d)).toContain(
      "Register 3 stays Unsigned 16-bit: there are not enough following registers in this poll.",
    );
    await applyButton(d).click();
    await expectClosed(h);
    expect(await storedOverrides(h)).toEqual([]);
    expect(await viewCalls(h)).toEqual([]);
  });
}
