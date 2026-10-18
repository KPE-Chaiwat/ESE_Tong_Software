import { expect, test } from "../integration/fixtures";
import { readProfile, saveProfileAs } from "../integration/profiles";
import { RealMm } from "../integration/real-mm";
import { esc } from "../support/mm";

class GridMm extends RealMm {
  override get pollList() {
    return this.page.getByRole("list", { name: "Polls", exact: true });
  }
  override row(who: number | string) {
    return typeof who === "number"
      ? this.pollList.locator(`[data-poll-id="${who}"]`)
      : this.pollList.getByRole("listitem", { name: new RegExp(`^${esc(who)}, `) });
  }
}

test("each register keeps its own static color pair", async ({ mm: base, sim, desktop }) => {
  const mm = new GridMm(base.page);
  await mm.connectTo(sim);
  const id = await mm.addPollUi(
    { name: "Per register", start: 11, qty: 10, scan: 100 },
    { closeSetup: false },
  );
  await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  const grid = mm.grid(id);
  const dialog = mm.page.getByRole("dialog", { name: "Value color rules · Per register" });

  await grid.locator('[data-row="0"]').click({ button: "right" });
  await mm.page.getByRole("menuitem", { name: "Set colors for register 11…" }).click();
  await expect(dialog.getByLabel("Addresses")).toHaveValue("single");
  await expect(dialog.getByLabel("Register address")).toHaveValue("11");
  await expect(dialog.getByLabel("Comparison")).toHaveValue("always");
  await expect(dialog.getByLabel("Threshold")).toHaveCount(0);
  await dialog.getByLabel("Background color").fill("#337bd6");
  await dialog.getByLabel("Text color").fill("#a33300");
  await dialog.getByRole("button", { name: "Apply rules" }).click();
  await expect(dialog).toHaveCount(0);

  await grid.locator('[data-row="1"]').click({ button: "right" });
  await mm.page.getByRole("menuitem", { name: "Set colors for register 12…" }).click();
  await expect(dialog.getByLabel("Register address")).toHaveValue("12");
  await dialog.getByLabel("Background color").fill("#17324d");
  await dialog.getByLabel("Text color").fill("#ffffff");
  await dialog.getByRole("button", { name: "Apply rules" }).click();
  await expect(dialog).toHaveCount(0);

  const first = grid.locator('[data-row="0"] [data-cell="raw"]');
  const second = grid.locator('[data-row="1"] [data-cell="raw"]');
  const third = grid.locator('[data-row="2"] [data-cell="raw"]');
  await expect(first).toHaveCSS("background-color", "rgb(51, 123, 214)");
  await expect(first).toHaveCSS("color", "rgb(163, 51, 0)");
  await expect(second).toHaveCSS("background-color", "rgb(23, 50, 77)");
  await expect(second).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(third.locator(".value-rule-custom")).toHaveCount(0);
  const profile = await mm.exportProfile();
  expect(profile.polls[0]?.colorRules).toMatchObject([
    { comparison: "always", range: { start: 12, end: 12 } },
    { comparison: "always", range: { start: 11, end: 11 } },
  ]);
  await saveProfileAs(mm, "RegisterColors");
  expect(readProfile(desktop, "RegisterColors").polls[0]?.colorRules).toEqual(
    profile.polls[0]?.colorRules,
  );

  await grid.locator('[data-row="0"]').click({ button: "right" });
  await mm.page.getByRole("menuitem", { name: "Set colors for register 11…" }).click();
  await expect(dialog.getByLabel("Register address")).toHaveValue("11");
  await expect(dialog.getByText("2 / 256 rules")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("row Value color rules applies a condition only to the clicked register", async ({
  mm: base,
  sim,
}) => {
  const mm = new GridMm(base.page);
  await sim.ctlOk("set holding 0 200 200");
  await mm.connectTo(sim);
  const id = await mm.addPollUi(
    { name: "Scoped rule", start: 0, qty: 10, scan: 100 },
    { closeSetup: false },
  );
  const grid = mm.grid(id);
  const first = grid.locator('[data-row="0"] [data-cell="raw"]');
  const second = grid.locator('[data-row="1"] [data-cell="raw"]');
  await expect(first).toContainText("200");
  await expect(second).toContainText("200");
  await expect(first).toHaveCSS("user-select", "none");
  await expect(second).toHaveCSS("user-select", "none");
  await grid.locator('[data-row="1"]').click({ button: "right" });
  await mm.page.getByRole("menuitem", { name: "Value color rules…" }).click();
  const dialog = mm.page.getByRole("dialog", { name: "Value color rules · Scoped rule" });
  await expect(dialog.getByLabel("Addresses")).toHaveValue("single");
  await expect(dialog.getByLabel("Register address")).toHaveValue("1");
  await dialog.getByLabel("Threshold").fill("50");
  await dialog.getByLabel("Highlight", { exact: true }).selectOption("custom");
  await dialog.getByLabel("Background color").fill("#337bd6");
  await dialog.getByLabel("Text color").fill("#ffffff");
  await dialog.getByRole("button", { name: "Apply rules" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(second).toHaveCSS("background-color", "rgb(51, 123, 214)");
  await expect(first).not.toHaveClass(/value-rule/);
  const profile = await mm.exportProfile();
  expect(profile.polls[0]?.colorRules[0]?.range).toEqual({ start: 1, end: 1 });
});

test("opening an existing whole-poll rule from a row narrows it before Apply", async ({
  mm: base,
  sim,
}) => {
  const mm = new GridMm(base.page);
  await sim.ctlOk("set holding 0 200 200");
  await mm.connectTo(sim);
  const id = await mm.addPollUi(
    { name: "Existing rule", start: 0, qty: 10, scan: 100 },
    { closeSetup: false },
  );
  const dialog = mm.page.getByRole("dialog", { name: "Value color rules · Existing rule" });
  await mm.setup(id).getByRole("button", { name: "Edit rules…" }).click();
  await dialog.getByRole("button", { name: "Add rule" }).click();
  await dialog.getByLabel("Threshold").fill("50");
  await dialog.getByRole("button", { name: "Apply rules" }).click();
  const grid = mm.grid(id);
  const first = grid.locator('[data-row="0"] [data-cell="raw"]');
  const second = grid.locator('[data-row="1"] [data-cell="raw"]');
  await expect(first).toHaveClass(/value-rule/);
  await expect(second).toHaveClass(/value-rule/);
  await grid.locator('[data-row="1"]').click({ button: "right" });
  await mm.page.getByRole("menuitem", { name: "Value color rules…" }).click();
  await expect(dialog.getByLabel("Addresses")).toHaveValue("single");
  await expect(dialog.getByLabel("Register address")).toHaveValue("1");
  await expect(dialog.getByLabel("Threshold")).toHaveValue("50");
  await dialog.getByRole("button", { name: "Apply rules" }).click();
  await expect(first).not.toHaveClass(/value-rule/);
  await expect(second).toHaveClass(/value-rule/);
});
