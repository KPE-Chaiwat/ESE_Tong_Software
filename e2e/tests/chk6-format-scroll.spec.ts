import { expect, test } from "../support/mm-fixtures";

test("Format / endian and Apply keep the poll header inside the workspace", async ({ mm, page }) => {
	await mm.open({
		route: process.env.ESEFACT_UI_ROUTE ?? "/tools/modbus-master",
		polls: [{ name: "Format scroll", qty: 10 }],
		connected: true,
	});
	const [id] = (await mm.pollIds()) as [number];
	await mm.script(
		(f, pollId) => f.emitPollUpdate(pollId, { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
		id,
	);
	const frame = mm.sub(id);
	const title = mm.titleBar(id);
	const before = await title.boundingBox();
	// Rows 0-1 are selected; the row menu opens the Format dialog (REQ-009).
	await mm.gridRow(id, 0).click();
	await mm.gridRow(id, 1).click({ modifiers: ["Shift"] });
	await mm.gridRow(id, 0).click({ button: "right" });
	await page.getByRole("menuitem", { name: "More formats…" }).click();
	const dialog = page.getByRole("dialog", { name: "Format / endian" });
	await expect(dialog.getByRole("radio", { name: "Unsigned", exact: true })).toBeFocused();
	await dialog.getByRole("radio", { name: "Unsigned 32-bit" }).check();
	await dialog.getByRole("button", { name: "Apply" }).click();
	await expect(dialog).toHaveCount(0);
	await expect(mm.grid(id)).toContainText("0–1");
	const after = await title.boundingBox();
	const workspace = await mm.workspace.boundingBox();
	expect(before).not.toBeNull();
	expect(after).not.toBeNull();
	expect(workspace).not.toBeNull();
	expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
	expect(after?.y ?? 0).toBeGreaterThanOrEqual(workspace?.y ?? 0);
	expect(await mm.workspace.evaluate((el) => el.scrollTop)).toBe(0);
	expect(await frame.evaluate((el) => el.scrollTop)).toBe(0);
});
