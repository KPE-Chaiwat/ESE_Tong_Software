// REPORT-017: real WebView2, calibrated long tasks and simulator wire cadence.
import { execFileSync } from "node:child_process";
import { expect, test } from "../integration/fixtures";
import { formatFirstRegisters, type DialogFormat } from "../integration/format-dialog";
import { openProfile, profileV2, writeProfile } from "../integration/profiles";
import { RealMm } from "../integration/real-mm";
import { esc } from "../support/mm";

class PerfMm extends RealMm {
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
const formats = [
	"unsigned32",
	"signed32",
	"float32",
	"unsigned64",
	"signed64",
	"float64",
];

test("CHK5-D2/CHK6-D1 125 registers at100ms, sixteen rules, all combined modes and orders", async ({
	mm: base,
	desktop,
	sim,
}, info) => {
	test.setTimeout(240000);
	const free = Number(
		execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				"[System.IO.DriveInfo]::new('C').AvailableFreeSpace",
			],
			{ encoding: "utf8" },
		).trim(),
	);
	expect(free, "3GB disk guard").toBeGreaterThanOrEqual(3_000_000_000);
	const mm = new PerfMm(base.page);
	// Fixture files exercise the production profile loader; no backend state mutation hook.
	const profile = profileV2(
		"Performance",
		[
			{
				name: "Perf",
				qty: 125,
				scan: 100,
				workspace: {
					x: 0,
					y: 0,
					width: 800,
					height: 600,
					z: 1,
					state: "maximized",
				},
			},
		],
		{
			schemaVersion: 3,
			connection: {
				mode: "tcp",
				host: "127.0.0.1",
				port: sim.modbusPort,
				timeoutMs: 1000,
			},
		},
	);
	const poll = (profile.polls as Record<string, unknown>[])[0] as Record<
		string,
		unknown
	>;
	poll.display = {
		...(poll.display as object),
		swapBytes: false,
		reverseWords: false,
	};
	poll.colorRules = Array.from({ length: 16 }, (_, i) => ({
		name: `Rule ${i + 1}`,
		enabled: true,
		range: null,
		source: "raw",
		comparison: "greaterThan",
		threshold: String(65535 - i),
		upperThreshold: null,
		highlight: "lime",
	}));
	writeProfile(desktop, "Performance", profile);
	await openProfile(mm, "Performance");
	await expect.poll(() => mm.ids()).toHaveLength(1);
	const id = (await mm.ids())[0] as number;
	await mm.toolbarButton("Connect").click();
	await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
	const cdp = await mm.page.context().newCDPSession(mm.page);
	await cdp.send("Performance.enable");
	await mm.page.evaluate(() => {
		const w = window as unknown as { perfTasks: number[] };
		w.perfTasks = [];
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) w.perfTasks.push(entry.duration);
		}).observe({ type: "longtask" });
	});
	await mm.page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				setTimeout(() => {
					const t = performance.now();
					while (performance.now() - t < 90) {
						/* calibrate */
					}
					resolve();
				}, 0),
			),
	);
	await expect
		.poll(() =>
			mm.page.evaluate(
				() => (window as unknown as { perfTasks: number[] }).perfTasks.length,
			),
		)
		.toBeGreaterThan(0);
	const calibration = await mm.page.evaluate(
		() => (window as unknown as { perfTasks: number[] }).perfTasks,
	);
	const records: unknown[] = [];
	async function capture(label: string, ms: number) {
		await mm.page.evaluate(() => {
			(window as unknown as { perfTasks: number[] }).perfTasks = [];
		});
		const mark = sim.mark();
		const before = await cdp.send("Performance.getMetrics");
		const started = Date.now();
		await expect
			.poll(() => Date.now() - started, {
				timeout: ms + 5000,
				intervals: [250],
			})
			.toBeGreaterThanOrEqual(ms);
		const elapsed = Date.now() - started;
		const after = await cdp.send("Performance.getMetrics");
		const requests = sim.requestsDecoded(mark);
		const intervals = requests
			.slice(1)
			.map((r, i) => r.epoch - (requests[i]?.epoch ?? r.epoch));
		const tasks = await mm.page.evaluate(
			() => (window as unknown as { perfTasks: number[] }).perfTasks,
		);
		const metric = (name: string) =>
			(after.metrics.find((m) => m.name === name)?.value ?? 0) -
			(before.metrics.find((m) => m.name === name)?.value ?? 0);
		const data = {
			label,
			elapsed,
			requests: requests.length,
			intervals: {
				min: Math.min(...intervals),
				mean: intervals.reduce((a, b) => a + b, 0) / intervals.length,
				max: Math.max(...intervals),
			},
			taskMs: metric("TaskDuration") * 1000,
			layoutMs: metric("LayoutDuration") * 1000,
			styleMs: metric("RecalcStyleDuration") * 1000,
			longTasks: tasks,
		};
		records.push(data);
		expect(requests.length, "poll progresses").toBeGreaterThan(5);
		expect(
			requests.every((r) => r.fc === 3 && r.addr === 0 && r.arg === 125),
		).toBe(true);
		expect(
			tasks.filter((t) => t > 50),
			label,
		).toEqual([]);
		return data;
	}
	await capture("16 rules unsigned16", 12000);
	// REQ-009: the poll-wide Interpretation section is gone. 124 of the 125 registers take the
	// combined format through the Format dialog (a multiple of 2 and of 4); the last one stays Unsigned.
	async function interpretation(
		format: string,
		swap: boolean,
		reverse: boolean,
	) {
		await formatFirstRegisters(
			mm.page,
			mm.sub(id),
			125,
			124,
			format as DialogFormat,
			{ swapBytes: swap, reverseWords: reverse },
		);
	}
	for (const format of formats)
		for (const [swap, reverse] of [
			[false, false],
			[true, false],
			[false, true],
			[true, true],
		] as const) {
			await interpretation(format, swap, reverse);
			await capture(`${format} swap=${swap} reverse=${reverse}`, 2000);
		}
	await mm.toolbarButton("Pause all").click();
	await expect(mm.statusLine(id)).toHaveAttribute("data-state", "paused");
	const mark = sim.mark();
	for (const format of formats) await interpretation(format, true, true);
	await mm.titleButton(id, /^Poll setup/).click();
	await mm.setup(id).getByRole("button", { name: "Edit rules…" }).click();
	const dialog = mm.page.getByRole("dialog", {
		name: "Value color rules · Perf",
	});
	await dialog
		.getByLabel("Name", { exact: true })
		.first()
		.fill("Edited while paused");
	await dialog
		.getByRole("button", { name: "Apply rules", exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
	expect(
		sim.requestsSince(mark),
		"paused display/rule Apply emits zero requests",
	).toBe(0);
	expect(sim.linesWith("OVERLAP")).toEqual([]);
	const data = {
		freeBytes: free,
		calibration,
		records,
		pausedDisplayEditRequests: sim.requestsSince(mark),
		binary: process.env.ESEFACT_BINARY_LABEL,
	};
	await info.attach("performance.json", {
		body: JSON.stringify(data, null, 2),
		contentType: "application/json",
	});
	console.log("REPORT017", JSON.stringify(data));
});
