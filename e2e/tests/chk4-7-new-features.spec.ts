import { expect, type Mm, test } from "../support/mm-fixtures";

const vectors = [
	["signed32", [0xffff, 0xfffe], "-2"],
	["unsigned32", [0xffff, 0xffff], "4294967295"],
	["signed64", [0x8000, 0, 0, 0], "-9223372036854775808"],
	["unsigned64", [0xffff, 0xffff, 0xffff, 0xffff], "18446744073709551615"],
	["unsigned64", [0x20, 0, 0, 1], "9007199254740993"],
	["float32", [0x3dcc, 0xcccd], "0.10000000149011612"],
	["float64", [0x3fb9, 0x9999, 0x9999, 0x999a], "0.1"],
] as const;

for (const [comparison, expected] of [
	["equals", [false, true, false]],
	["notEquals", [true, false, true]],
	["lessThan", [true, false, false]],
	["lessThanOrEqual", [true, true, false]],
	["greaterThan", [false, false, true]],
	["greaterThanOrEqual", [false, true, true]],
] as const) {
	test(`CHK5-A1 live rule vector ${comparison}`, async ({ mm, page }) => {
		const id = await setup(mm, 3);
		await mm.script(
			(f, i) => f.emitPollUpdate(i, { values: [24, 25, 26] }),
			id,
		);
		await mm.setup(id).getByRole("button", { name: "Edit rules…" }).click();
		const dialog = page.getByRole("dialog", {
			name: "Value color rules · Vectors",
		});
		await dialog.getByRole("button", { name: "Add rule", exact: true }).click();
		await dialog
			.getByLabel("Comparison", { exact: true })
			.selectOption(comparison);
		await dialog.getByLabel("Threshold", { exact: true }).fill("25");
		await dialog
			.getByRole("button", { name: "Apply rules", exact: true })
			.click();
		await expect(dialog).toBeHidden();
		for (let row = 0; row < 3; row++) {
			await expect(
				mm.gridRow(id, row).getByRole("img", { name: /^Rule: Rule 1/ }),
			).toHaveCount(expected[row] ? 1 : 0);
		}
	});
}

for (const [format, words, expected] of vectors) {
	test(`CHK6-A1/A3 numeric UI/copy ${format} ${expected}`, async ({
		mm,
		page,
	}) => {
		const id = await setup(mm, words.length);
		await mm.script((f, a) => f.emitPollUpdate(a.id, { values: a.words }), {
			id,
			words,
		});
		const section = mm
			.setup(id)
			.getByRole("region", { name: "Interpretation", exact: true });
		await section
			.getByLabel("Interpretation", { exact: true })
			.selectOption(format);
		await section.getByRole("button", { name: "Apply interpretation" }).click();
		await expect(
			mm.grid(id).getByRole("cell", { name: expected, exact: true }),
		).toBeVisible();
		await mm.grid(id).focus();
		await page.keyboard.press("Control+c");
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(`1\t${expected}`);
	});
}

async function setup(mm: Mm, qty = 5) {
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

test("CHK7-A1/A4 persistent toggle changes full sidebar and retains keyboard focus", async ({
	mm,
	page,
}) => {
	await mm.open({ polls: [{ name: "A" }] });
	const width = (await mm.sidebar.boundingBox())?.width;
	const before = (await mm.workspace.boundingBox())?.width ?? 0;
	const hide = mm.toolbar.getByRole("button", {
		name: "Hide sidebar",
		exact: true,
	});
	await hide.focus();
	await page.keyboard.press("Enter");
	const show = mm.toolbar.getByRole("button", {
		name: "Show sidebar",
		exact: true,
	});
	await expect(show).toBeFocused();
	await expect(show).toHaveAttribute("aria-expanded", "false");
	await expect(mm.sidebar).toBeHidden();
	await expect(mm.rail).toBeVisible();
	expect((await mm.rail.boundingBox())?.width).toBe(44);
	expect((await mm.workspace.boundingBox())?.width).toBeGreaterThan(before);
	await page.keyboard.press("Space");
	await expect(hide).toBeFocused();
	await expect(hide).toHaveAttribute("aria-expanded", "true");
	await expect(mm.sidebar).toBeVisible();
	expect((await mm.sidebar.boundingBox())?.width).toBe(width);
	expect(await mm.modified()).toBe(false);
});

for (const collapsed of [false, true]) {
	test(`CHK7-A3 compact peek restores durable collapsed=${collapsed}`, async ({
		mm,
	}) => {
		await mm.open();
		if (collapsed)
			await mm.toolbar
				.getByRole("button", { name: "Hide sidebar", exact: true })
				.click();
		await mm.windowMenu("Collapse setup panels", "menuitemcheckbox");
		await expect(mm.sidebar).toBeHidden();
		await mm.toolbar
			.getByRole("button", { name: "Show sidebar", exact: true })
			.click();
		await expect(mm.sidebar).toBeVisible();
		await mm.windowMenu("Collapse setup panels", "menuitemcheckbox");
		if (collapsed) await expect(mm.sidebar).toBeHidden();
		else await expect(mm.sidebar).toBeVisible();
		expect(await mm.modified()).toBe(false);
	});
}

test("CHK4-A1/A3/A4 selection range, keyboard navigation and hide/show retention", async ({
	mm,
	page,
}) => {
	await mm.open({ polls: ["A", "B", "C", "D"].map((name) => ({ name })) });
	const boxes = mm.sidebar.getByRole("checkbox", { name: /^Select [ABCD]$/ });
	await expect(boxes).toHaveCount(4);
	for (const box of await boxes.all()) await expect(box).not.toBeChecked();
	await boxes.nth(1).click();
	await boxes.nth(3).click();
	await boxes.nth(2).click({ modifiers: ["Shift"] });
	await expect(boxes.nth(0)).not.toBeChecked();
	for (const index of [1, 2, 3]) await expect(boxes.nth(index)).toBeChecked();
	await boxes.nth(1).focus();
	await page.keyboard.press("Home");
	await expect(boxes.nth(0)).toBeFocused();
	await expect(boxes.nth(0)).not.toBeChecked();
	await page.keyboard.press("Control+a");
	for (const box of await boxes.all()) await expect(box).toBeChecked();
	await mm.toolbar
		.getByRole("button", { name: "Hide sidebar", exact: true })
		.click();
	await mm.toolbar
		.getByRole("button", { name: "Show sidebar", exact: true })
		.click();
	for (const box of await boxes.all()) await expect(box).toBeChecked();
	await boxes.nth(0).focus();
	await page.keyboard.press("Control+Shift+a");
	for (const box of await boxes.all()) await expect(box).not.toBeChecked();
	expect(await mm.modified()).toBe(false);
});

test("CHK6-A4/B4/C2 draft interpretation groups current words only after Apply; inspector remainder", async ({
	mm,
	page,
}) => {
	const id = await setup(mm);
	await mm.script(
		(f, i) => f.emitPollUpdate(i, { values: [0x1234, 0x5678, 1, 2, 3] }),
		id,
	);
	const section = mm
		.setup(id)
		.getByRole("region", { name: "Interpretation", exact: true });
	await section
		.getByLabel("Interpretation", { exact: true })
		.selectOption("unsigned32");
	await expect(
		mm.grid(id).getByRole("columnheader", { name: /Interpreted/ }),
	).toHaveCount(0);
	await section.getByRole("button", { name: "Apply interpretation" }).click();
	await expect(mm.grid(id)).toContainText("305419896");
	await expect(mm.grid(id)).toContainText("0x1234 0x5678");
	await expect(mm.grid(id)).toContainText("Incomplete");
	const inspect = mm
		.grid(id)
		.getByRole("button", { name: "Inspect raw registers 5", exact: true });
	await inspect.click();
	const dialog = page.getByRole("dialog", {
		name: "Raw registers · 5",
		exact: true,
	});
	await expect(dialog.getByRole("row")).toHaveCount(2);
	await expect(dialog).toContainText("0x0003");
	await page.keyboard.press("Escape");
	await expect(inspect).toBeFocused();
	await section
		.getByLabel("Interpretation", { exact: true })
		.selectOption("unsigned64");
	await section.getByRole("button", { name: "Apply interpretation" }).click();
	await expect(
		mm
			.grid(id)
			.getByRole("button", { name: "Inspect raw registers 1–4", exact: true }),
	).toBeVisible();
	await expect(
		mm
			.grid(id)
			.getByRole("img", { name: "Needs 4 registers; only 1 available." }),
	).toBeVisible();
});

test("CHK6-A2 four byte/word orders decode exact values without changing wire words", async ({
	mm,
}) => {
	const id = await setup(mm, 2);
	await mm.script(
		(f, i) => f.emitPollUpdate(i, { values: [0x1234, 0x5678] }),
		id,
	);
	const section = mm
		.setup(id)
		.getByRole("region", { name: "Interpretation", exact: true });
	await section
		.getByLabel("Interpretation", { exact: true })
		.selectOption("unsigned32");
	for (const [order, value] of [
		["big", "305419896"],
		["bigByteSwap", "873625686"],
		["littleByteSwap", "1450709556"],
		["little", "2018915346"],
	] as const) {
		await section.getByLabel("Byte order").selectOption(order);
		await section.getByRole("button", { name: "Apply interpretation" }).click();
		await expect(mm.grid(id)).toContainText(value);
		await expect(mm.grid(id)).toContainText("0x1234 0x5678");
	}
});

test("CHK6-A2 all four 64-bit byte/word orders stay exact in UI and clipboard", async ({
	mm,
	page,
}) => {
	const id = await setup(mm, 4);
	const words = [0x0123, 0x4567, 0x89ab, 0xcdef];
	await mm.script((f, a) => f.emitPollUpdate(a.id, { values: a.words }), {
		id,
		words,
	});
	const section = mm
		.setup(id)
		.getByRole("region", { name: "Interpretation", exact: true });
	await section
		.getByLabel("Interpretation", { exact: true })
		.selectOption("unsigned64");
	const orders = [
		["big", "81985529216486895"],
		["bigByteSwap", "2522410815232536525"],
		["littleByteSwap", "14839230665905864995"],
		["little", "17279655951921914625"],
	] as const;
	for (const [order, expected] of orders) {
		await section.getByLabel("Byte order").selectOption(order);
		await section.getByRole("button", { name: "Apply interpretation" }).click();
		const cell = mm.grid(id).getByRole("cell", { name: expected, exact: true });
		await expect(cell).toBeVisible();
		await expect(mm.grid(id)).toContainText("0x0123 0x4567 0x89AB 0xCDEF");
		await mm.grid(id).focus();
		await page.keyboard.press("Control+c");
		await expect.poll(() => mm.clipboardText()).toBe(`1\t${expected}`);
	}
});

test("CHK5-A1/A8 Between bounds are inclusive and first matching rule wins after reorder", async ({
	mm,
	page,
}) => {
	const id = await setup(mm, 5);
	await mm.script(
		(f, i) => f.emitPollUpdate(i, { values: [23, 24, 25, 26, 27] }),
		id,
	);
	const edit = mm.setup(id).getByRole("button", { name: "Edit rules…" });
	await edit.click();
	const dialog = page.getByRole("dialog", {
		name: "Value color rules · Vectors",
	});
	await dialog.getByRole("button", { name: "Add rule", exact: true }).click();
	await dialog
		.getByLabel("Comparison", { exact: true })
		.selectOption("between");
	await dialog.getByLabel("Lower", { exact: true }).fill("24");
	await dialog.getByLabel("Upper", { exact: true }).fill("26");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(dialog).toBeHidden();
	for (const row of [1, 2, 3]) {
		await expect(
			mm.gridRow(id, row).getByRole("img", { name: /^Rule: Rule 1/ }),
		).toHaveCount(1);
	}
	for (const row of [0, 4]) {
		await expect(
			mm.gridRow(id, row).getByRole("img", { name: /^Rule: Rule 1/ }),
		).toHaveCount(0);
	}

	await edit.click();
	await dialog.getByRole("button", { name: "Add rule", exact: true }).click();
	await dialog.getByLabel("Name", { exact: true }).fill("Second rule");
	await dialog
		.getByLabel("Comparison", { exact: true })
		.selectOption("greaterThan");
	await dialog.getByLabel("Threshold", { exact: true }).fill("22");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(
		mm.gridRow(id, 2).getByRole("img", { name: /^Rule: Rule 1/ }),
	).toHaveCount(1);

	await edit.click();
	await dialog.getByRole("button", { name: "Up", exact: true }).last().click();
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(
		mm.gridRow(id, 2).getByRole("img", { name: /^Rule: Second rule/ }),
	).toHaveCount(1);
});

test("CHK5-B2 Between upper bound validation preserves the applied rule", async ({
	mm,
	page,
}) => {
	const id = await setup(mm, 3);
	await mm.script((f, i) => f.emitPollUpdate(i, { values: [24, 25, 26] }), id);
	const edit = mm.setup(id).getByRole("button", { name: "Edit rules…" });
	await edit.click();
	const dialog = page.getByRole("dialog", {
		name: "Value color rules · Vectors",
	});
	await dialog.getByRole("button", { name: "Add rule", exact: true }).click();
	await dialog
		.getByLabel("Comparison", { exact: true })
		.selectOption("between");
	await dialog.getByLabel("Lower", { exact: true }).fill("26");
	await dialog.getByLabel("Upper", { exact: true }).fill("25");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(dialog).toContainText(
		"Upper threshold must be greater than or equal to lower threshold.",
	);
	await expect(dialog.getByLabel("Upper", { exact: true })).toBeFocused();
	for (let row = 0; row < 3; row++) {
		await expect(
			mm.gridRow(id, row).getByRole("img", { name: /^Rule: Rule 1/ }),
		).toHaveCount(0);
	}
});

test("CHK5-B1/B2/B4 empty editor, invalid draft, apply and cancel", async ({
	mm,
	page,
}) => {
	const id = await setup(mm);
	await expect(mm.setup(id)).toContainText("No value color rules.");
	const edit = mm.setup(id).getByRole("button", { name: "Edit rules…" });
	await edit.click();
	const dialog = page.getByRole("dialog", {
		name: "Value color rules · Vectors",
	});
	await dialog.getByRole("button", { name: "Add rule", exact: true }).click();
	await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
		"Rule 1",
	);
	await expect(dialog.getByLabel("Source", { exact: true })).toHaveValue(
		"displayed",
	);
	await expect(dialog.getByLabel("Threshold", { exact: true })).toHaveValue("");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(dialog).toContainText(
		"Rules not applied. Fix the highlighted fields.",
	);
	await expect(dialog).toContainText(
		"Enter a finite decimal number, for example -12.5 or 1e3.",
	);
	await expect(dialog.getByLabel("Threshold", { exact: true })).toBeFocused();
	await dialog.getByLabel("Threshold", { exact: true }).fill("1,5");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(dialog).toContainText("Use a dot as the decimal separator.");
	await dialog.getByLabel("Threshold", { exact: true }).fill("25");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(dialog).toBeHidden();
	await expect(mm.setup(id)).toContainText("1 rules · 1 enabled");
	await edit.click();
	await dialog.getByLabel("Name", { exact: true }).fill("Discard me");
	await page.keyboard.press("Escape");
	await expect(edit).toBeFocused();
	await edit.click();
	await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
		"Rule 1",
	);
});

test("CHK4-A4 checkbox arrows move focus without selection and text Ctrl+A stays local", async ({
	mm,
	page,
}) => {
	await mm.open({ polls: ["A", "B", "C", "D"].map((name) => ({ name })) });
	const boxes = mm.sidebar.getByRole("checkbox", { name: /^Select [ABCD]$/ });
	await boxes.nth(1).click();
	await boxes.nth(1).focus();
	await page.keyboard.press("ArrowDown");
	await expect(boxes.nth(2)).toBeFocused();
	await expect(boxes.nth(1)).toBeChecked();
	await expect(boxes.nth(2)).not.toBeChecked();
	await page.keyboard.press("Shift+ArrowDown");
	await expect(boxes.nth(1)).toBeChecked();
	await expect(boxes.nth(2)).toBeChecked();
	await expect(boxes.nth(3)).toBeChecked();
	const host = mm.hostField;
	await host.fill("127.0.0.1");
	await host.focus();
	await page.keyboard.press("Control+a");
	await expect(host).toHaveJSProperty("selectionStart", 0);
	await expect(host).toHaveJSProperty("selectionEnd", 9);
	await expect(boxes.nth(1)).toBeChecked();
	await expect(boxes.nth(2)).toBeChecked();
});
