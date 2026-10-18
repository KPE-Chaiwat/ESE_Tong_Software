import { expect, LAYOUT_SEED, type Mm, test } from "../support/mm-fixtures";

const toggle = (mm: Mm, name: string) =>
	mm.toolbar.getByRole("button", { name, exact: true });

test("CHK7-A2 the W1 toolbar toggle covers two subwindows and leaves native W2 setup alone", async ({
	mm,
	page,
}) => {
	await mm.open({
		polls: [{ name: "First" }, { name: "Second" }],
		seed: LAYOUT_SEED,
		seedArg: {
			items: [
				{ index: 0, x: 8, y: 8, width: 600, height: 368 },
				{ index: 1, x: 620, y: 8, width: 600, height: 368 },
			],
		},
	});
	const [first, second] = (await mm.pollIds()) as [number, number];
	await mm.titleButton(first, /^Poll setup/).click();
	await mm.titleButton(second, /^Poll setup/).click();
	await expect(mm.setup(first)).toBeVisible();
	await expect(mm.setup(second)).toBeVisible();

	const native = await mm.openNative({ polls: [{ name: "Native" }] });
	await expect(native.setupPanel).toBeVisible();
	await expect(native.root).toHaveAttribute("data-prefs", /"compact":false/);

	await toggle(mm, "Hide sidebar").click();
	await expect(mm.sidebar).toBeHidden();
	await expect(mm.rail).toBeVisible();
	await expect(mm.sub(first)).toBeVisible();
	await expect(mm.sub(second)).toBeVisible();
	await expect(mm.setup(first)).toBeVisible();
	await expect(mm.setup(second)).toBeVisible();
	await expect(native.setupPanel).toBeVisible();

	// Ctrl+Backslash remains scoped to the focused subwindow setup in W1.
	await mm.titleBar(second).focus();
	await page.keyboard.press("Control+Backslash");
	await expect(mm.setup(second)).toHaveCount(0);
	await expect(mm.setup(first)).toBeVisible();
	await expect(mm.sidebar).toBeHidden();
	await expect(native.setupPanel).toBeVisible();

	await toggle(mm, "Show sidebar").click();
	await expect(mm.sidebar).toBeVisible();
	await expect(mm.setup(second)).toHaveCount(0);
	await expect(native.setupPanel).toBeVisible();
	await expect(native.root).toHaveAttribute("data-prefs", /"compact":false/);
	await expect(
		native.page.getByRole("button", { name: "Show sidebar" }),
	).toHaveCount(0);
});

for (const collapsed of [false, true]) {
	test(`CHK7-A3 compact peek can be hidden and exit restores collapsed=${collapsed}`, async ({
		mm,
	}) => {
		await mm.open();
		if (collapsed) await toggle(mm, "Hide sidebar").click();
		await mm.windowMenu("Collapse setup panels", "menuitemcheckbox");
		await expect(mm.sidebar).toBeHidden();
		await expect(toggle(mm, "Show sidebar")).toHaveAttribute(
			"aria-expanded",
			"false",
		);

		await toggle(mm, "Show sidebar").click();
		await expect(mm.sidebar).toBeVisible();
		await expect(toggle(mm, "Hide sidebar")).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		await toggle(mm, "Hide sidebar").click();
		await expect(mm.sidebar).toBeHidden();
		await expect(toggle(mm, "Show sidebar")).toHaveAttribute(
			"aria-expanded",
			"false",
		);

		// Reopen the transient peek, then leave compact mode while it is open.
		await toggle(mm, "Show sidebar").click();
		await expect(mm.sidebar).toBeVisible();
		await mm.windowMenu("Collapse setup panels", "menuitemcheckbox");
		await expect(mm.rail).toHaveCount(collapsed ? 1 : 0);
		if (collapsed) {
			await expect(mm.sidebar).toBeHidden();
			await expect(toggle(mm, "Show sidebar")).toHaveAttribute(
				"aria-expanded",
				"false",
			);
		} else {
			await expect(mm.sidebar).toBeVisible();
			await expect(toggle(mm, "Hide sidebar")).toHaveAttribute(
				"aria-expanded",
				"true",
			);
		}
	});
}

test("CHK7-A8 resize and collapse settings round-trip through a saved profile", async ({
	mm,
}) => {
	await mm.open({ polls: [{ name: "Profile poll" }] });
	const separator = mm.page.getByRole("separator", { name: "Resize sidebar" });
	await separator.focus();
	for (let i = 0; i < 3; i++) await mm.page.keyboard.press("ArrowRight");
	await expect(separator).toHaveAttribute("aria-valuenow", "328");
	await toggle(mm, "Hide sidebar").click();
	await expect(mm.sidebar).toBeHidden();
	expect(
		await mm.modified(),
		"layout-only changes do not mark the profile modified",
	).toBe(false);

	// Save as validates the connection form; those fields are outside the layout-only assertion.
	await toggle(mm, "Show sidebar").click();
	await mm.hostField.fill("127.0.0.1");
	await mm.portField.fill("5020");
	await toggle(mm, "Hide sidebar").click();
	await mm.page.keyboard.press("Control+Shift+S");
	await expect(mm.saveAsDialog).toBeVisible();
	await mm.saveAsDialog.getByLabel("Name").fill("Sidebar width QA");
	await mm.saveAsDialog
		.getByRole("button", { name: "Save", exact: true })
		.click();
	await expect(mm.profileLabel).toContainText("Sidebar width QA");
	const saved = (await mm.lastCall("profilesSave")) as [
		{
			workspace: {
				sidebarWidth: number;
				sidebarCollapsed: boolean;
				compact: boolean;
			};
		},
		boolean,
	];
	expect(saved[0].workspace).toMatchObject({
		sidebarWidth: 328,
		sidebarCollapsed: true,
		compact: false,
	});

	await toggle(mm, "Show sidebar").click();
	await expect(mm.sidebar).toBeVisible();
	await separator.focus();
	for (let i = 0; i < 3; i++) await mm.page.keyboard.press("ArrowLeft");
	await expect(separator).toHaveAttribute("aria-valuenow", "280");
	await toggle(mm, "Hide sidebar").click();
	await mm.openMenu("File");
	await mm.menuItem("Open profile…").click();
	await mm.openDialog.getByRole("row", { name: /Sidebar width QA/ }).dblclick();
	await expect(mm.openDialog).toHaveCount(0);
	await expect(mm.sidebar).toBeHidden();
	await expect(toggle(mm, "Show sidebar")).toHaveAttribute(
		"aria-expanded",
		"false",
	);
	await toggle(mm, "Show sidebar").click();
	await expect(mm.sidebar).toBeVisible();
	await expect(
		mm.page.getByRole("separator", { name: "Resize sidebar" }),
	).toHaveAttribute("aria-valuenow", "328");
	expect(await mm.modified()).toBe(false);
});
