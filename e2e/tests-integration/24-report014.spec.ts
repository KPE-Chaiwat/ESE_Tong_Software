// REPORT-014: normal real desktop, UI mutations and read-only profile observations.
import { expect, test } from "../integration/fixtures";
import { RealMm } from "../integration/real-mm";
import { esc } from "../support/mm";

class BulkMm extends RealMm {
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
	box(name: string) {
		return this.sidebar.getByRole("checkbox", {
			name: `Select ${name}`,
			exact: true,
		});
	}
	async names() {
		return (await this.exportProfile()).polls.map(
			(p: { name: string }) => p.name,
		) as string[];
	}
	async duplicate() {
		await this.sidebar
			.getByRole("button", { name: "Duplicate selected", exact: true })
			.click();
		await expect(
			this.sidebar.getByRole("button", {
				name: "Duplicate selected",
				exact: true,
			}),
		).toHaveAttribute("aria-disabled", "false");
	}
	async remove(count: number) {
		await this.sidebar
			.getByRole("button", { name: "Delete selected…", exact: true })
			.click();
		const dialog = this.page.getByRole("alertdialog");
		await expect(
			dialog.getByRole("button", { name: "Cancel", exact: true }),
		).toBeFocused();
		await dialog
			.getByRole("button", {
				name: `Delete ${count} ${count === 1 ? "poll" : "polls"}`,
				exact: true,
			})
			.click();
	}
}

test("CHK4-A3/A4/A5/C4 keyboard scope, retained anchor and deletion boundaries", async ({
	mm: base,
}) => {
	const mm = new BulkMm(base.page);
	await mm.hostField.fill("127.0.0.1");
	for (const name of ["A", "B", "C", "D"]) await mm.addPollUi({ name, qty: 1 });
	await mm.box("B").click();
	await mm.box("D").click({ modifiers: ["Control"] });
	await mm.box("C").click({ modifiers: ["Shift"] });
	await mm.box("A").click({ modifiers: ["Shift"] });
	for (const name of ["A", "B", "C", "D"])
		await expect(mm.box(name)).toBeChecked();
	await mm.box("B").focus();
	await mm.page.keyboard.press("Control+Shift+a");
	await mm.page.keyboard.press("End");
	await expect(mm.box("D")).toBeFocused();
	await mm.page.keyboard.press("Home");
	await expect(mm.box("A")).toBeFocused();
	await mm.page.keyboard.press("ArrowDown");
	await expect(mm.box("B")).toBeFocused();
	for (const name of ["A", "B", "C", "D"])
		await expect(mm.box(name)).not.toBeChecked();
	await mm.page.keyboard.press("Space");
	await mm.page.keyboard.press("Shift+ArrowDown");
	await expect(mm.box("B")).toBeChecked();
	await expect(mm.box("C")).toBeChecked();
	await mm.hostField.focus();
	await mm.page.keyboard.press("Control+a");
	await expect(mm.box("A")).not.toBeChecked();
	await expect(mm.box("D")).not.toBeChecked();
	await mm.box("A").focus();
	await mm.page.keyboard.press("Control+Shift+a");
	await mm.box("A").check();
	await mm.box("C").check();
	await mm.remove(2);
	await expect.poll(() => mm.names()).toEqual(["B", "D"]);
	await expect(mm.box("D")).toBeFocused();
	await mm.box("D").check();
	await mm.remove(1);
	await expect(mm.box("B")).toBeFocused();
	await mm.box("B").check();
	await mm.remove(1);
	await expect.poll(() => mm.names()).toEqual([]);
	await expect(mm.page.getByText(/^No polls yet\./).first()).toBeVisible();
	await expect(mm.toolbarButton("New poll")).toBeFocused();
	await expect(mm.toolbarButton("Connect")).toBeEnabled();
});

test("CHK4-B2/B4 copy naming and atomic UI capacity boundaries", async ({
	mm: base,
}, info) => {
	test.setTimeout(180000);
	const mm = new BulkMm(base.page);
	const long = "L".repeat(48);
	for (const name of ["A", "a COPY", long])
		await mm.addPollUi({ name, qty: 1 });
	await mm.box("A").check();
	await mm.box(long).check();
	await mm.duplicate();
	await expect.poll(() => mm.names()).toHaveLength(5);
	const names = await mm.names();
	expect(names).toContain("A copy 2");
	expect(names.every((name) => name.length <= 48)).toBe(true);
	expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(5);
	for (let i = 5; i < 15; i++) await mm.addPollUi({ name: `P${i}`, qty: 1 });
	await mm.duplicate();
	await expect(mm.sidebar).toContainText(
		"Cannot duplicate 2 polls. This connection has room for 1 more (maximum 16).",
	);
	expect(await mm.names()).toHaveLength(15);
	await mm.box(long).uncheck();
	await mm.duplicate();
	await expect.poll(() => mm.names()).toHaveLength(16);
	await mm.duplicate();
	await expect(mm.sidebar).toContainText(
		"Cannot duplicate 1 polls. This connection has room for 0 more (maximum 16).",
	);
	expect(await mm.names()).toHaveLength(16);
	await info.attach("capacity-profile.json", {
		body: JSON.stringify(await mm.exportProfile()),
		contentType: "application/json",
	});
});
