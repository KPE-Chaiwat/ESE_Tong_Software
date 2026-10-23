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
			: this.pollList.getByRole("listitem", {
					name: new RegExp(`^${esc(who)}, `),
				});
	}
}

test("custom value colors apply to live register cells and survive profile save", async ({
	mm: base,
	sim,
	desktop,
}) => {
	const mm = new GridMm(base.page);
	await mm.connectTo(sim);
	const showSidebar = mm.toolbarButton("Show sidebar");
	if (await showSidebar.isVisible()) await showSidebar.click();
	const id = await mm.addPollUi(
		{ name: "Colors", start: 11, qty: 10, scan: 100 },
		{ closeSetup: false },
	);
	await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
	await mm.setup(id).getByRole("button", { name: "Edit rules…" }).click();
	const dialog = mm.page.getByRole("dialog", {
		name: "Value color rules · Colors",
	});
	await dialog.getByRole("button", { name: "Add rule" }).click();
	await dialog.getByLabel("Name", { exact: true }).fill("All values");
	await dialog.getByLabel("Threshold", { exact: true }).fill("-1");
	await dialog.getByLabel("Highlight", { exact: true }).selectOption("custom");
	await dialog.getByLabel("Background color").fill("#337bd6");
	await dialog.getByLabel("Text color").fill("#a33300");
	await expect(
		dialog.getByText("Low contrast may make values hard to read. You can still apply this rule."),
	).toBeVisible();
	const preview = dialog
		.locator("span.value-rule-custom")
		.filter({ hasText: "25.3" });
	await expect(preview).toHaveCSS("background-color", "rgb(51, 123, 214)");
	await dialog.getByRole("button", { name: "Apply rules" }).click();
	await expect(dialog).toHaveCount(0);
	const marker = mm
		.grid(id)
		.getByRole("img", { name: /^Rule: All values/ })
		.first();
	await expect(marker).toBeVisible();
	const cell = marker.locator("xpath=ancestor::*[@data-cell='raw'][1]");
	await expect(cell).toHaveCSS("background-color", "rgb(51, 123, 214)");
	await expect(cell).toHaveCSS("color", "rgb(163, 51, 0)");
	const profile = await mm.exportProfile();
	expect(profile.polls[0]?.colorRules[0]?.colors).toEqual({
		background: "#337bd6",
		foreground: "#a33300",
	});
	await saveProfileAs(mm, "ColorsProfile");
	const saved = readProfile(desktop, "ColorsProfile");
	expect(saved.schemaVersion).toBe(6);
	expect(saved.polls[0]?.colorRules[0]?.colors).toEqual(
		profile.polls[0]?.colorRules[0]?.colors,
	);
});
