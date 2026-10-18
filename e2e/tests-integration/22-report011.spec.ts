// REPORT-011: real Tauri/WebView2 + TCP simulator. No fake IPC/product state injection.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, test } from "../integration/fixtures";
import {
	openProfile,
	profileV2,
	readProfile,
	saveProfileAs,
	writeProfile,
} from "../integration/profiles";
import { RealMm, RealNative } from "../integration/real-mm";
import { esc } from "../support/mm";

// REQ-004 replaces the former listbox/options with a semantic list and listitems.
class FeatureMm extends RealMm {
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
const clip = () =>
	execFileSync(
		"powershell.exe",
		["-NoProfile", "-STA", "-Command", "Get-Clipboard -Raw"],
		{ encoding: "utf8", timeout: 15000 },
	).trimEnd();
async function interpretation(
	mm: FeatureMm,
	id: number,
	format: string,
	swap = false,
	reverse = false,
) {
	if (!(await mm.setup(id).isVisible()))
		await mm.titleButton(id, /^Poll setup/).click();
	const section = mm
		.setup(id)
		.getByRole("region", { name: "Interpretation", exact: true });
	await section
		.getByLabel("Interpretation", { exact: true })
		.selectOption(format);
	if (/32|64/.test(format)) {
		await section
			.getByLabel("Swap bytes within each register")
			.setChecked(swap);
		await section.getByLabel("Reverse register order").setChecked(reverse);
	}
	await section.getByRole("button", { name: "Apply interpretation" }).click();
	await expect(section).toContainText("Applied:");
}
async function disableFocusEmulation(
	desktop: import("../integration/desktop").Desktop,
) {
	for (const page of desktop.pages()) {
		const session = await desktop.context.newCDPSession(page);
		await session.send("Emulation.setFocusEmulationEnabled", {
			enabled: false,
		});
		await session.detach();
	}
}

test("CHK6-A1/A2/A3/C3 + CHK5-A5/C2 live exact values, rules, freshness, native handoff", async ({
	mm: base,
	desktop,
	sim,
}, info) => {
	test.setTimeout(180000);
	const mm = new FeatureMm(base.page);
	await mm.connectTo(sim, { autoStart: true, timeoutMs: 200 });
	const id = await mm.addPollUi({ name: "Exact", start: 1, qty: 4, scan: 100 });
	await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
	const requestStart = sim.requestsDecoded().length;
	const vectors = [
		["signed32", [0xffff, 0xfffe, 0, 0], "-2"],
		["unsigned32", [0xffff, 0xffff, 0, 0], "4294967295"],
		["signed64", [0x8000, 0, 0, 0], "-9223372036854775808"],
		["unsigned64", [0xffff, 0xffff, 0xffff, 0xffff], "18446744073709551615"],
		["unsigned64", [0x20, 0, 0, 1], "9007199254740993"],
		["float32", [0x3dcc, 0xcccd, 0, 0], "0.10000000149011612"],
		["float64", [0x3fb9, 0x9999, 0x9999, 0x999a], "0.1"],
		["float32", [0x7f80, 0, 0, 0], "+Infinity"],
		["float32", [0xff80, 0, 0, 0], "-Infinity"],
		["float32", [0x7fc0, 0, 0, 0], "NaN"],
	] as const;
	for (const [format, words, text] of vectors) {
		await sim.ctlOk(`set holding 1 ${words.join(" ")}`);
		await interpretation(mm, id, format);
		await expect(
			mm.grid(id).getByText(text, { exact: true }).first(),
		).toBeVisible();
		await mm.grid(id).focus();
		await mm.page.keyboard.press("Home");
		await mm.page.keyboard.press("Control+c");
		await expect.poll(clip).toBe(`1\t${text}`);
		console.log("VECTOR", format, text, "UI+clipboard pass");
	}
	await sim.ctlOk("set holding 1 4660 22136 1 2");
	for (const [swap, reverse, text] of [
		[false, false, "305419896"],
		[true, false, "873625686"],
		[false, true, "1450709556"],
		[true, true, "2018915346"],
	] as const) {
		await interpretation(mm, id, "unsigned32", swap, reverse);
		await expect(mm.grid(id)).toContainText(text);
		await expect(mm.grid(id)).toContainText("0x1234 0x5678");
	}
	await sim.ctlOk("set holding 1 32 0 0 1");
	await interpretation(mm, id, "unsigned64");
	await expect(mm.grid(id)).toContainText("9007199254740993");
	await mm.setup(id).getByRole("button", { name: "Edit rules…" }).click();
	const dialog = mm.page.getByRole("dialog", {
		name: "Value color rules · Exact",
	});
	await dialog.getByRole("button", { name: "Add rule", exact: true }).click();
	await dialog.getByLabel("Name", { exact: true }).fill("Exact boundary");
	await dialog.getByLabel("Comparison", { exact: true }).selectOption("equals");
	await dialog
		.getByLabel("Threshold", { exact: true })
		.fill("9007199254740993");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	const marker = mm
		.grid(id)
		.getByRole("img", { name: /^Rule: Exact boundary/ });
	await expect(marker).toHaveCount(1);
	await sim.ctlOk("set holding 1 32 0 0 0");
	await expect(mm.grid(id)).toContainText("9007199254740992");
	await expect(marker).toHaveCount(0);
	await sim.ctlOk("set holding 1 32 0 0 1");
	await expect(marker).toHaveCount(1);
	await mm.toolbarButton("Pause all").click();
	await expect(mm.statusLine(id)).toHaveAttribute("data-state", "paused");
	await expect(marker).toHaveCount(0);
	const requests = sim.requestsDecoded().length;
	await interpretation(mm, id, "unsigned64", true, true);
	await interpretation(mm, id, "unsigned64");
	expect(sim.requestsDecoded()).toHaveLength(requests);
	await mm.toolbarButton("Resume all").click();
	await expect(marker).toHaveCount(1);
	await sim.ctlOk("fault drop");
	await expect(mm.statusLine(id)).toHaveAttribute("data-state", "timeout");
	await expect(marker).toHaveCount(0);
	await expect(mm.grid(id)).toHaveAttribute("data-status", "stale");
	await sim.ctlOk("clear");
	await expect(marker).toHaveCount(1);
	await sim.ctlOk("fault exception 4");
	await expect(mm.statusLine(id)).toHaveAttribute("data-state", "exception");
	await expect(marker).toHaveCount(0);
	await sim.ctlOk("clear");
	await expect(marker).toHaveCount(1);
	await mm.closeSetup(id);
	await mm.titleButton(id, /^Open in its own window/).click();
	const native = new RealNative(await desktop.w2Page(id));
	await expect(native.grid).toContainText("9007199254740993");
	await expect(
		native.grid.getByRole("img", { name: /^Rule: Exact boundary/ }),
	).toHaveCount(1);
	await info.attach("exact-native.png", {
		body: await native.page.screenshot(),
		contentType: "image/png",
	});
	const profile = await mm.exportProfile();
	expect(profile.polls[0].display.format).toBe("unsigned64");
	expect(profile.polls[0].colorRules[0].threshold).toBe("9007199254740993");
	await saveProfileAs(mm, "Exact64");
	expect(readProfile(desktop, "Exact64").polls[0].colorRules[0].threshold).toBe(
		"9007199254740993",
	);
	await openProfile(mm, "Exact64");
	const reload = mm.page.getByRole("alertdialog", {
		name: "Disconnect and load?",
	});
	await reload
		.getByRole("button", { name: "Disconnect and load", exact: true })
		.click();
	await expect(reload).toHaveCount(0);
	expect((await mm.exportProfile()).polls[0].colorRules[0].threshold).toBe(
		"9007199254740993",
	);
	await expect(mm.toolbarButton("Connect")).toBeEnabled();
	expect(readProfile(desktop, "Exact64").connection.port).toBe(sim.modbusPort);
	await mm.toolbarButton("Connect").click();
	await expect(mm.pill).toContainText("Connected");
	const restoredId = await mm.idByName("Exact");
	const restoredNative = new RealNative(await desktop.w2Page(restoredId));
	await expect(restoredNative.grid).toContainText("9007199254740993");
	await expect(
		restoredNative.grid.getByRole("img", { name: /^Rule: Exact boundary/ }),
	).toHaveCount(1);
	expect(
		sim
			.requestsDecoded()
			.slice(requestStart)
			.filter((r) => r.fc === 3)
			.every((r) => r.addr === 1 && r.arg === 4),
	).toBe(true);
	expect(sim.lines.filter((l) => l.includes("OVERLAP"))).toHaveLength(0);
});

test("CHK4-B1/B5/C1/C2/C4/D2 + CHK7-A5/A8 native bulk copy/delete, cancel, profile roundtrip", async ({
	mm: base,
	desktop,
	sim,
}, info) => {
	test.setTimeout(150000);
	const mm = new FeatureMm(base.page);
	await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
	const ids: number[] = [];
	for (const name of ["A", "B", "C", "D"])
		ids.push(await mm.addPollUi({ name, qty: 4, scan: 100 }));
	const [a, b, c] = ids as [number, number, number, number];
	await interpretation(mm, a, "unsigned32", true, false);
	await mm.closeSetup(a);
	await mm.row(c).getByRole("button", { name: /^C, / }).click();
	await mm.titleButton(c, /^Open in its own window/).click();
	const native = new RealNative(await desktop.w2Page(c));
	await expect(native.grid).toHaveAttribute("data-status", "live");
	await disableFocusEmulation(desktop);
	await mm.sidebar
		.getByRole("checkbox", { name: "Select A", exact: true })
		.check();
	await mm.sidebar
		.getByRole("checkbox", { name: "Select C", exact: true })
		.check();
	await mm.toolbar
		.getByRole("button", { name: "Hide sidebar", exact: true })
		.click();
	await mm.toolbar
		.getByRole("button", { name: "Show sidebar", exact: true })
		.click();
	await expect(
		mm.sidebar.getByRole("checkbox", { name: "Select A", exact: true }),
	).toBeChecked();
	await mm.sidebar
		.getByRole("button", { name: "Duplicate selected", exact: true })
		.click();
	await expect.poll(() => mm.ids()).toHaveLength(6);
	const profile = await mm.exportProfile();
	expect(profile.polls.map((p: { name: string }) => p.name)).toEqual([
		"A",
		"B",
		"C",
		"A copy",
		"C copy",
		"D",
	]);
	expect(profile.polls[3].display).toEqual(profile.polls[0].display);
	expect(profile.polls[4].view.host).toBe("native");
	const copyId = await mm.idByName("C copy");
	const copyNative = new RealNative(await desktop.w2Page(copyId));
	await expect(copyNative.grid).toHaveAttribute("data-status", "live");
	await expect(
		mm.sidebar.getByRole("checkbox", { name: "Select A copy", exact: true }),
	).not.toBeChecked();
	await expect(
		mm.sidebar.getByRole("checkbox", { name: "Select C copy", exact: true }),
	).not.toBeChecked();
	await disableFocusEmulation(desktop);
	await mm.sidebar
		.getByRole("button", { name: "Delete selected…", exact: true })
		.click();
	const confirmation = mm.page.getByRole("alertdialog", {
		name: "Delete 2 polls?",
	});
	await expect(confirmation).toContainText("own window");
	await expect(
		confirmation.getByRole("button", { name: "Cancel", exact: true }),
	).toBeFocused();
	await confirmation
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	expect(await mm.ids()).toHaveLength(6);
	await expect(native.grid).toHaveAttribute("data-status", "live");
	await mm.sidebar
		.getByRole("button", { name: "Delete selected…", exact: true })
		.click();
	await confirmation
		.getByRole("button", { name: "Delete 2 polls", exact: true })
		.click();
	await expect.poll(() => mm.ids()).toHaveLength(4);
	await expect.poll(() => native.page.isClosed()).toBe(true);
	await expect(copyNative.grid).toHaveAttribute("data-status", "live");
	expect(
		(await mm.exportProfile()).polls.map((p: { name: string }) => p.name),
	).toEqual(["B", "A copy", "C copy", "D"]);
	await expect(
		// Copies precede D: A copy is the first survivor after the deleted C position.
		mm.sidebar.getByRole("checkbox", { name: "Select A copy", exact: true }),
	).toBeFocused();
	await expect(mm.statusLine(b)).toHaveAttribute("data-state", "polling");
	const beforeLoadIds = await mm.ids();
	await mm.toolbar
		.getByRole("button", { name: "Hide sidebar", exact: true })
		.click();
	await saveProfileAs(mm, "BulkRoundtrip");
	const saved = readProfile(desktop, "BulkRoundtrip");
	expect(saved.schemaVersion).toBe(3);
	expect(saved.workspace.sidebarCollapsed).toBe(true);
	expect(JSON.stringify(saved)).not.toMatch(
		/selectedIds|thresholdValue|lastUpdate/,
	);
	await openProfile(mm, "BulkRoundtrip");
	const disconnectLoad = mm.page.getByRole("alertdialog", {
		name: "Disconnect and load?",
	});
	await expect(disconnectLoad).toBeVisible();
	await disconnectLoad
		.getByRole("button", { name: "Disconnect and load", exact: true })
		.click();
	await expect(disconnectLoad).toHaveCount(0);
	await expect(mm.profileLabel).not.toContainText("Modified");
	await expect
		.poll(() =>
			mm.page
				.locator('[data-slot="poll-row"]')
				.evaluateAll((rows) =>
					rows.map((row) => Number(row.getAttribute("data-poll-id"))),
				),
		)
		.not.toEqual(beforeLoadIds);
	console.log(
		"LAYOUT ROUNDTRIP",
		JSON.stringify({
			saved: saved.workspace,
			loaded: (await mm.exportProfile()).workspace,
		}),
	);
	await info.attach("loaded-sidebar.png", {
		body: await mm.page.screenshot(),
		contentType: "image/png",
	});
	await expect(
		mm.toolbar.getByRole("button", { name: "Show sidebar", exact: true }),
	).toHaveAttribute("aria-expanded", "false");
	await mm.toolbar
		.getByRole("button", { name: "Show sidebar", exact: true })
		.click();
	await expect.poll(() => mm.ids()).toHaveLength(4);
	for (const box of await mm.pollList.getByRole("checkbox").all())
		await expect(box).not.toBeChecked();
	expect(
		(await mm.exportProfile()).polls.map((p: { name: string }) => p.name),
	).toEqual(saved.polls.map((p: { name: string }) => p.name));
	const persisted = (poll: Record<string, unknown>) =>
		Object.fromEntries(
			[
				"name",
				"definition",
				"display",
				"colorRules",
				"scale",
				"scaleOverrides",
				"valueColumns",
				"aliases",
			].map((key) => [key, poll[key]]),
		);
	expect((await mm.exportProfile()).polls.map(persisted)).toEqual(
		saved.polls.map(persisted),
	);
	await expect(mm.profileLabel).not.toContainText("Modified");
	await info.attach("bulk-roundtrip.png", {
		body: await mm.page.screenshot(),
		contentType: "image/png",
	});
});

test("CHK5-D1/CHK6-C5/B6 schema1/2 migration, invalid/newer profiles preserve workspace", async ({
	mm: base,
	desktop,
}) => {
	const mm = new FeatureMm(base.page);
	const legacy = profileV2("Legacy2", [
		{
			name: "Legacy",
			display: { format: "hex", addressBase: 1 },
			aliases: [{ address: 1, alias: "Pressure" }],
		},
	]);
	const file = writeProfile(desktop, "Legacy2", legacy);
	const before = fs.readFileSync(file, "utf8");
	await openProfile(mm, "Legacy2");
	await expect.poll(() => mm.ids()).toHaveLength(1);
	await expect(mm.profileLabel).not.toContainText("Modified");
	const exported = await mm.exportProfile();
	expect(exported.polls[0].display).toMatchObject({
		format: "hex",
		addressBase: 1,
		swapBytes: false,
		reverseWords: false,
	});
	expect(exported.polls[0].colorRules).toEqual([]);
	expect(exported.polls[0].aliases).toEqual([
		{ address: 1, alias: "Pressure" },
	]);
	expect(fs.readFileSync(file, "utf8")).toBe(before);
	const invalid = structuredClone(exported);
	invalid.name = "BadOrder";
	invalid.polls[0].display.swapBytes = "false";
	writeProfile(desktop, "BadOrder", invalid);
	const newer = structuredClone(exported);
	newer.name = "Newer";
	newer.schemaVersion = 6;
	writeProfile(desktop, "Newer", newer);
	await mm.openMenu("File");
	await mm.menuItem("Open profile…").click();
	for (const name of ["BadOrder", "Newer"]) {
		const row = mm.openDialog.getByRole("row", { name: new RegExp(name) });
		await expect(row).toContainText("Cannot be opened");
		await row.click();
		await expect(
			mm.openDialog.getByRole("button", { name: "Open", exact: true }),
		).toBeDisabled();
	}
	await mm.page.keyboard.press("Escape");
	expect((await mm.exportProfile()).polls).toEqual(exported.polls);
	writeProfile(desktop, "Legacy1", {
		schemaVersion: 1,
		name: "Legacy1",
		connection: { mode: "tcp", host: "127.0.0.1", port: 502, timeoutMs: 1000 },
		poll: {
			slaveId: 1,
			function: 3,
			startAddress: 0,
			quantity: 2,
			scanRateMs: 1000,
		},
		display: { format: "signed", addressBase: 0 },
		autoStartPoll: true,
	});
	await openProfile(mm, "Legacy1");
	await expect(mm.profileLabel).not.toContainText("Modified");
	const v1 = await mm.exportProfile();
	expect(v1.polls[0].display).toMatchObject({
		format: "signed",
		swapBytes: false,
		reverseWords: false,
	});
	expect(v1.polls[0].colorRules).toEqual([]);
});

test("CHK7-A1/A3/A7 W1 minimum toolbar toggle and compact peek", async ({
	mm: base,
	desktop,
}, info) => {
	const mm = new FeatureMm(base.page);
	const win = desktop
		.windows()
		.find((w) => w.title.startsWith("Modbus Master"));
	expect(win).toBeTruthy();
	if (!win) throw new Error("Missing W1");
	const dpr = await mm.page.evaluate(() => devicePixelRatio);
	desktop.moveWindow(
		win.hwnd,
		30,
		30,
		Math.round(960 * dpr + win.rect.w - win.client.w),
		Math.round(600 * dpr + win.rect.h - win.client.h),
	);
	await expect.poll(() => mm.page.evaluate(() => innerWidth)).toBe(960);
	for (const compact of [false, true]) {
		if (compact)
			await mm.windowMenu("Collapse setup panels", "menuitemcheckbox");
		const toggle = mm.toolbar.getByRole("button", {
			name: /^(Show|Hide) sidebar$/,
		});
		for (let i = 0; i < 2; i++) {
			await expect(toggle).toBeVisible();
			const metrics = await toggle.evaluate((el) => {
				const r = el.getBoundingClientRect();
				const doc = document.documentElement;
				return {
					left: r.left,
					right: r.right,
					top: r.top,
					bottom: r.bottom,
					width: doc.clientWidth,
					scroll: doc.scrollWidth,
					height: doc.clientHeight,
					hscroll: doc.scrollHeight,
				};
			});
			expect(metrics.left).toBeGreaterThanOrEqual(0);
			expect(metrics.right).toBeLessThanOrEqual(metrics.width);
			expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);
			expect(metrics.hscroll).toBeLessThanOrEqual(metrics.height);
			await toggle.click();
			const expanded = await toggle.getAttribute("aria-expanded");
			if (expanded === "true") await expect(mm.sidebar).toBeVisible();
			else await expect(mm.sidebar).toBeHidden();
			console.log(
				"MINIMUM SIDEBAR",
				JSON.stringify({ compact, expanded, metrics }),
			);
		}
	}
	// At 960 CSS px the profile label is intentionally hidden; title still exposes Modified as *.
	expect(
		desktop.windows().find((w) => w.hwnd === win.hwnd)?.title,
	).not.toContain("*");
	await info.attach("sidebar-minimum.png", {
		body: await mm.page.screenshot(),
		contentType: "image/png",
	});
});
