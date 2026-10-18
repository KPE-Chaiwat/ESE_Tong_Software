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
	const section = mm
		.setup(id)
		.getByRole("region", { name: "Interpretation", exact: true });
	await section
		.getByLabel("Interpretation", { exact: true })
		.selectOption("float32");
	await section.getByRole("button", { name: "Apply interpretation" }).click();
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
