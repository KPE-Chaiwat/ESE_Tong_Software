import { expect, type Mm, test } from "../support/mm-fixtures";

test("CHK5-A7 nonfinite and stale values never match Not equals", async ({
	mm,
	page,
}) => {
	const id = await setup(mm, 6);
	const edit = mm.setup(id).getByRole("button", { name: "Edit rules…" });
	await edit.click();
	const dialog = page.getByRole("dialog", {
		name: "Value color rules · Vectors",
	});
	await dialog.getByRole("button", { name: "Add rule", exact: true }).click();
	await dialog
		.getByLabel("Comparison", { exact: true })
		.selectOption("notEquals");
	await dialog.getByLabel("Threshold", { exact: true }).fill("0");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(dialog).toBeHidden();
	await mm.script(
		(f, i) =>
			f.emitPollUpdate(i, {
				values: [0x7f80, 0, 0xff80, 0, 0x7fc0, 0],
			}),
		id,
	);
	// Rows 1-6 as three Float 32-bit values (REQ-009: the format is set on the selected rows).
	await mm.gridRow(id, 0).click();
	await mm.gridRow(id, 5).click({ modifiers: ["Shift"] });
	await mm.gridRow(id, 0).click({ button: "right" });
	await page.getByRole("menuitem", { name: "More formats…" }).click();
	const format = page.getByRole("dialog", { name: "Format / endian" });
	await format.getByRole("radio", { name: "Float 32-bit", exact: true }).check();
	await format.getByRole("button", { name: "Apply", exact: true }).click();
	await expect(format).toHaveCount(0);
	await expect(mm.grid(id)).toContainText("+Infinity");
	await expect(mm.grid(id)).toContainText("-Infinity");
	await expect(mm.grid(id)).toContainText("NaN");
	for (let row = 0; row < 3; row++)
		await expect(
			mm.gridRow(id, row).getByRole("img", { name: /^Rule: Rule 1/ }),
		).toHaveCount(0);
	await mm.script((f, i) => f.emitPollState(i, "timeout"), id);
	for (let row = 0; row < 3; row++)
		await expect(
			mm.gridRow(id, row).getByRole("img", { name: /^Rule: Rule 1/ }),
		).toHaveCount(0);
});

async function setup(mm: Mm, qty: number) {
	await mm.open({
		polls: [
			{
				name: "Vectors",
				start: 1,
				qty,
				display: { swapBytes: false, reverseWords: false },
			},
		],
		connected: true,
	});
	const [id] = (await mm.pollIds()) as [number];
	await mm.titleButton(id, /^Poll setup/).click();
	await expect(mm.setup(id)).toBeVisible();
	return id;
}
