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
	await mm.gridRow(id, 0).click({ button: "right" });
	await mm.page.getByRole("menuitem", { name: "Format / endian…" }).click();
	const format = mm.sub(id).locator("[data-interpretation-format]");
	await expect(format).toBeFocused();
	await format.selectOption("unsigned32");
	await mm.setup(id).getByRole("button", { name: "Apply interpretation" }).click();
	await expect(mm.grid(id)).toContainText("0–1");
	await mm.setup(id).getByRole("button", { name: "Apply", exact: true }).click();
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
