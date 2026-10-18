// REPORT-013: real backend/UI with approved debug-only native failure hook.
import { type Desktop, expect, test } from "../integration/fixtures";
import { invokeIn, RealMm, RealNative } from "../integration/real-mm";
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
	select(name: string) {
		return this.sidebar.getByRole("checkbox", {
			name: `Select ${name}`,
			exact: true,
		});
	}
}
async function realFocus(desktop: Desktop) {
	for (const page of desktop.pages()) {
		const session = await desktop.context.newCDPSession(page);
		await session.send("Emulation.setFocusEmulationEnabled", {
			enabled: false,
		});
		await session.detach();
	}
}
async function w1Focused(desktop: Desktop) {
	const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
	expect(w1).toBeTruthy();
	await expect.poll(() => desktop.foregroundHwnd()).toBe(w1?.hwnd);
}
async function native(mm: BulkMm, desktop: Desktop, id: number) {
	await mm
		.row(id)
		.getByRole("button", { name: /^[^,]+, / })
		.click();
	await mm.titleButton(id, /^Open in its own window/).click();
	const view = new RealNative(await desktop.w2Page(id));
	await expect(view.grid).toHaveAttribute("data-status", "live");
	return view;
}

for (const [kind, skip] of [
	["bulkCreate", 1],
	["bulkPlace", 0],
	["bulkShow", 0],
] as const) {
	test(`CHK4-B6 ${kind}: committed copies survive and Show recovers same id`, async ({
		mm: base,
		desktop,
		sim,
	}, info) => {
		test.setTimeout(120000);
		const mm = new BulkMm(base.page);
		await mm.connectTo(sim, { autoStart: true });
		const a = await mm.addPollUi({ name: "A", qty: 2 });
		const b = await mm.addPollUi({ name: "B", qty: 2 });
		const sourceA = await native(mm, desktop, a);
		const sourceB = await native(mm, desktop, b);
		await realFocus(desktop);
		await mm.select("A").check();
		await mm.select("B").check();
		const message = `REPORT013 ${kind} injected`;
		await invokeIn(mm.page, "dev_fail_next_window_op", { kind, message, skip });
		const duplicate = mm.sidebar.getByRole("button", {
			name: "Duplicate selected",
			exact: true,
		});
		await duplicate.dblclick();
		await expect.poll(() => mm.ids()).toHaveLength(4);
		const names = (await mm.exportProfile()).polls.map(
			(p: { name: string }) => p.name,
		);
		expect(names).toEqual(["A", "B", "A copy", "B copy"]);
		await expect(mm.sidebar).toContainText(message);
		await expect(duplicate).toHaveAttribute("aria-disabled", "true");
		await expect(duplicate).toBeFocused();
		await w1Focused(desktop);
		await expect(sourceA.grid).toHaveAttribute("data-status", "live");
		await expect(sourceB.grid).toHaveAttribute("data-status", "live");
		const copyName = skip ? "B copy" : "A copy";
		const failedId = await mm.idByName(copyName);
		expect(desktop.w2Pages().some((w) => w.pollId === failedId)).toBe(false);
		await mm.sidebar
			.getByRole("button", { name: `Show ${copyName}`, exact: true })
			.click();
		const recovered = new RealNative(await desktop.w2Page(failedId));
		await expect(recovered.grid).toHaveAttribute("data-status", "live");
		await expect(
			mm.sidebar.getByRole("button", { name: `Show ${copyName}`, exact: true }),
		).toHaveCount(0);
		expect(await mm.ids()).toHaveLength(4);
		await realFocus(desktop);
		await mm.row(a).getByRole("button", { name: /^A, / }).click();
		await expect(sourceA.grid).toHaveAttribute("data-status", "live");
		await info.attach("bulk-result.json", {
			body: JSON.stringify(await mm.exportProfile(), null, 2),
			contentType: "application/json",
		});
		await info.attach("recovered.png", {
			body: await recovered.page.screenshot(),
			contentType: "image/png",
		});
	});
}

test("CHK4-C5 bulkDestroy: definitions stay deleted and cleanup retry only closes orphan", async ({
	mm: base,
	desktop,
	sim,
}, info) => {
	test.setTimeout(120000);
	const mm = new BulkMm(base.page);
	await mm.connectTo(sim, { autoStart: true });
	await mm.addPollUi({ name: "A", qty: 2 });
	const b = await mm.addPollUi({ name: "B", qty: 2 });
	const c = await mm.addPollUi({ name: "C", qty: 2 });
	const removed = await native(mm, desktop, b);
	await realFocus(desktop);
	await mm.select("A").check();
	await mm.select("B").check();
	await invokeIn(mm.page, "dev_fail_next_window_op", {
		kind: "bulkDestroy",
		message: "REPORT013 destroy injected",
	});
	await mm.sidebar
		.getByRole("button", { name: "Delete selected…", exact: true })
		.click();
	const dialog = mm.page.getByRole("alertdialog", {
		name: "Delete 2 polls?",
		exact: true,
	});
	await dialog
		.getByRole("button", { name: "Delete 2 polls", exact: true })
		.dblclick();
	await expect.poll(() => mm.ids()).toEqual([c]);
	await expect(mm.statusLine(c)).toHaveAttribute("data-state", "polling");
	await expect(mm.select("C")).toBeFocused();
	await w1Focused(desktop);
	await expect(mm.sidebar).toContainText("REPORT013 destroy injected");
	const retry = mm.sidebar.getByRole("button", {
		name: "Retry window cleanup",
		exact: true,
	});
	await retry.click();
	await expect.poll(() => removed.page.isClosed()).toBe(true);
	// Native destroy acknowledgement may finish after the first cleanup reply.
	if (await retry.count()) await retry.click();
	await expect(retry).toHaveCount(0);
	expect(await mm.ids()).toEqual([c]);
	expect(
		(await mm.exportProfile()).polls.map((p: { name: string }) => p.name),
	).toEqual(["C"]);
	await mm.addPollUi({ name: "After recovery", qty: 2 });
	await expect(mm.statusLine(c)).toHaveAttribute("data-state", "polling");
	await info.attach("cleanup-results.json", {
		body: JSON.stringify(await mm.exportProfile(), null, 2),
		contentType: "application/json",
	});
	await info.attach("cleanup-recovered.png", {
		body: await mm.page.screenshot(),
		contentType: "image/png",
	});
});
