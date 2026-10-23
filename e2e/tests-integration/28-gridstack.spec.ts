import { expect, test } from "../integration/fixtures";
import {
	openProfile,
	readProfile,
	saveProfileAs,
} from "../integration/profiles";
import { RealMm, RealNative } from "../integration/real-mm";
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

test("GridStack keeps live polls usable while moving, resizing and scrolling", async ({
	mm: base,
	sim,
	desktop,
}) => {
	const mm = new GridMm(base.page);
	await mm.connectTo(sim);
	const ids: number[] = [];
	for (let i = 0; i < 8; i++) {
		ids.push(
			await mm.addPollUi({ name: `Grid ${i + 1}`, start: i * 10, scan: 100 }),
		);
	}
	const widget = (id: number) =>
		mm.workspace.locator(`.grid-stack-item[gs-id="${id}"]`);
	await expect(mm.statusLine(ids[0] as number)).toHaveAttribute(
		"data-state",
		"polling",
	);
	await expect(mm.workspace.locator(".grid-stack-item")).toHaveCount(8);
	expect(
		await mm.workspace.locator(".grid-stack-item").evaluateAll((elements) => {
			const cells = elements.map((el) => ({
				x: Number(el.getAttribute("gs-x")),
				y: Number(el.getAttribute("gs-y")),
				w: Number(el.getAttribute("gs-w")),
				h: Number(el.getAttribute("gs-h")),
			}));
			return cells.every((a, i) =>
				cells.every(
					(b, j) =>
						i === j ||
						!(
							a.x < b.x + b.w &&
							b.x < a.x + a.w &&
							a.y < b.y + b.h &&
							b.y < a.y + a.h
						),
				),
			);
		}),
	).toBe(true);
	const window = desktop
		.windows()
		.find((entry) => entry.title.startsWith("Modbus Master"));
	if (!window) throw new Error("Modbus Master window not found");
	const originalGridClass = await mm.workspace
		.locator(".grid-stack")
		.getAttribute("class");
	desktop.moveWindow(
		window.hwnd,
		window.rect.x,
		window.rect.y,
		1250,
		window.rect.h,
	);
	await expect
		.poll(() => mm.workspace.locator(".grid-stack").getAttribute("class"))
		.not.toBe(originalGridClass);
	const narrowed = await mm.workspace
		.locator(".grid-stack-item")
		.evaluateAll((elements) => {
			const cells = elements.map((el) => ({
				x: Number(el.getAttribute("gs-x")),
				y: Number(el.getAttribute("gs-y")),
				w: Number(el.getAttribute("gs-w")),
				h: Number(el.getAttribute("gs-h")),
			}));
			return cells.every((a, i) =>
				cells.every(
					(b, j) =>
						i === j ||
						!(
							a.x < b.x + b.w &&
							b.x < a.x + a.w &&
							a.y < b.y + b.h &&
							b.y < a.y + a.h
						),
				),
			);
		});
	expect(narrowed).toBe(true);
	desktop.moveWindow(
		window.hwnd,
		window.rect.x,
		window.rect.y,
		window.rect.w,
		window.rect.h,
	);
	await expect
		.poll(() => mm.workspace.locator(".grid-stack").getAttribute("class"))
		.toBe(originalGridClass);
	const scroll = mm.page.getByTestId("workspace-scroll");
	await expect
		.poll(async () =>
			scroll.evaluate((el) => el.scrollHeight > el.clientHeight),
		)
		.toBe(true);
	expect(
		await mm.page.evaluate(
			() =>
				document.documentElement.scrollHeight ===
				document.documentElement.clientHeight,
		),
	).toBe(true);

	const first = ids[0] as number;
	await mm
		.row(first)
		.getByRole("button", { name: /^Grid 1,/ })
		.click();
	await expect(mm.titleBar(first)).toBeVisible();
	const before = await widget(first).getAttribute("gs-x");
	const title = await mm.titleBar(first).boundingBox();
	expect(title).not.toBeNull();
	await mm.page.mouse.move((title?.x ?? 0) + 70, (title?.y ?? 0) + 14);
	await mm.page.mouse.down();
	await mm.page.mouse.move((title?.x ?? 0) + 600, (title?.y ?? 0) + 14, {
		steps: 12,
	});
	await mm.page.mouse.up();
	await expect.poll(() => widget(first).getAttribute("gs-x")).not.toBe(before);

	const resizeHandle = widget(first).locator(".ui-resizable-se");
	await widget(first).scrollIntoViewIfNeeded();
	await widget(first).hover();
	await resizeHandle.waitFor({ state: "visible" });
	await resizeHandle.scrollIntoViewIfNeeded();
	const handle = await resizeHandle.boundingBox();
	expect(handle).not.toBeNull();
	const oldH = await widget(first).getAttribute("gs-h");
	await mm.page.mouse.move(
		(handle?.x ?? 0) + (handle?.width ?? 0) / 2,
		(handle?.y ?? 0) + (handle?.height ?? 0) / 2,
	);
	await mm.page.mouse.down();
	await mm.page.mouse.move(
		(handle?.x ?? 0) + (handle?.width ?? 0) / 2,
		(handle?.y ?? 0) + (handle?.height ?? 0) / 2 + 110,
		{
			steps: 8,
		},
	);
	await mm.page.mouse.up();
	await expect.poll(() => widget(first).getAttribute("gs-h")).not.toBe(oldH);
	const gridHeight = Number(await widget(first).getAttribute("gs-h"));
	await expect
		.poll(async () => {
			const profile = await mm.exportProfile();
			return profile.polls.find(
				(poll: { name: string }) => poll.name === "Grid 1",
			)?.view.workspace?.grid?.h;
		})
		.toBe(gridHeight);
	await expect(mm.statusLine(first)).toHaveAttribute("data-state", "polling");

	await mm
		.row(ids[7] as number)
		.getByRole("button", { name: /^Grid 8,/ })
		.click();
	await expect
		.poll(async () => scroll.evaluate((el) => el.scrollTop))
		.toBeGreaterThan(0);
	await expect(mm.titleBar(ids[7] as number)).toBeVisible();

	await saveProfileAs(mm, "Grid layout");
	const saved = readProfile(desktop, "Grid layout");
	expect(saved.schemaVersion).toBe(6);
	const firstGrid = saved.polls.find(
		(poll: { name: string }) => poll.name === "Grid 1",
	)?.view.workspace?.grid;
	if (!firstGrid) throw new Error("saved Grid 1 has no grid rectangle");
	expect(firstGrid).toMatchObject({
		x: Number(await widget(first).getAttribute("gs-x")),
		h: gridHeight,
	});
	await openProfile(mm, "Grid layout");
	await mm.page
		.getByRole("alertdialog", { name: "Disconnect and load?" })
		.getByRole("button", { name: "Disconnect and load", exact: true })
		.click();
	await expect
		.poll(async () => widget(await mm.idByName("Grid 1")).count())
		.toBe(1);
	const restored = await mm.idByName("Grid 1");
	await expect(widget(restored)).toHaveAttribute("gs-x", String(firstGrid.x));
	await expect(widget(restored)).toHaveAttribute("gs-h", String(firstGrid.h));
	await mm.titleButton(restored, /^Open in its own window/).click();
	const native = new RealNative(await desktop.w2Page(restored));
	await expect(widget(restored)).toHaveCount(0);
	await native.toolbarButton("Dock to workspace").click();
	await expect(widget(restored)).toHaveCount(1);
});
