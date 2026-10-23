import { applyInDialog } from "../integration/format-dialog";
import { expect, test } from "../integration/fixtures";
import { RealMm } from "../integration/real-mm";
import { esc } from "../support/mm";

class ScrollMm extends RealMm {
	override get pollList() {
		return this.page.getByRole("list", { name: "Polls", exact: true });
	}
	override row(who: number | string) {
		return typeof who === "number"
			? this.pollList.locator(`[data-poll-id="${who}"]`)
			: this.pollList.getByRole("listitem", { name: new RegExp(`^${esc(who)}, `) });
	}
}

test("Format / endian Apply keeps the poll title and data in view", async ({ mm: base, sim }) => {
	const mm = new ScrollMm(base.page);
	await mm.connectTo(sim, { autoStart: true });
	const id = await mm.addPollUi({ name: "Format scroll", qty: 10, scan: 100 });
	await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
	await expect(mm.gridRow(id, 0)).toBeVisible();
	const title = mm.titleBar(id);
	const before = await title.boundingBox();
	// D-010-01: a 32-bit format needs a selection that is a multiple of 2, so select rows 0-1 first.
	await mm.gridRow(id, 0).click();
	await mm.gridRow(id, 1).click({ modifiers: ["Shift"] });
	await mm.gridRow(id, 0).click({ button: "right" });
	await mm.page.getByRole("menuitem", { name: "More formats…" }).click();
	// REQ-009: the row menu opens the Format dialog (no Interpretation section any more). Its Apply
	// must not move the poll title or scroll the workspace either.
	const dialog = mm.page.getByRole("dialog", { name: "Format / endian" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("radio", { name: "Unsigned", exact: true })).toBeFocused();
	await applyInDialog(mm.page, "unsigned32");
	await expect(mm.grid(id)).toContainText("0–1");
	const after = await title.boundingBox();
	const workspace = await mm.workspace.boundingBox();
	expect(before).not.toBeNull();
	expect(after).not.toBeNull();
	expect(workspace).not.toBeNull();
	expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
	expect(after?.y ?? 0).toBeGreaterThanOrEqual(workspace?.y ?? 0);
	expect(await mm.workspace.evaluate((el) => el.scrollTop)).toBe(0);
	expect(await mm.sub(id).evaluate((el) => el.scrollTop)).toBe(0);
});
