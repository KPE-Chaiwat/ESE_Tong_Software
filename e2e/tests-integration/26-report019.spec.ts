// REPORT-019: combined grouping/order must never encode raw register writes.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, test } from "../integration/fixtures";
import { openProfile, profileV2, writeProfile } from "../integration/profiles";

test("CHK6-C4 clicked combined group sends exact raw FC06/FC16 for both widths and all orders", async ({
	mm,
	desktop,
	sim,
}, info) => {
	test.setTimeout(180000);
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
	expect(free).toBeGreaterThanOrEqual(3_000_000_000);
	const file = writeProfile(
		desktop,
		"Raw writes",
		profileV2(
			"Raw writes",
			[
				{
					name: "Raw",
					start: 1,
					qty: 12,
					scan: 100,
					display: {
						format: "unsigned32",
						swapBytes: false,
						reverseWords: false,
					},
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
		),
	);

	const data = JSON.parse(fs.readFileSync(file, "utf8"));
	data.polls[0].colorRules = [];
	fs.writeFileSync(file, JSON.stringify(data));
	await openProfile(mm, "Raw writes");
	await mm.toolbarButton("Connect").click();
	const grid = mm.page.getByRole("grid", { name: "Register values" });
	await expect(grid).toContainText("0x0001 0x0002");
	const evidence: unknown[] = [];
	for (const width of [2, 4])
		for (const [swap, reverse] of [
			[false, false],
			[true, false],
			[false, true],
			[true, true],
		] as const) {
			const title = mm.page.locator("[data-subwindow]").first();
			// Existing setup helpers accept the profile-generated poll id.
			const id = Number(await title.getAttribute("data-subwindow"));
			if (!(await mm.setup(id).isVisible()))
				await mm.titleButton(id, /^Poll setup/).click();
			const section = mm
				.setup(id)
				.getByRole("region", { name: "Interpretation", exact: true });
			await section
				.getByLabel("Interpretation", { exact: true })
				.selectOption(width === 2 ? "float32" : "unsigned64");
			await section
				.getByLabel("Swap bytes within each register")
				.setChecked(swap);
			await section.getByLabel("Reverse register order").setChecked(reverse);
			await section
				.getByRole("button", { name: "Apply interpretation" })
				.click();
			await mm.closeSetup(id);
			const addr = 1 + width * 2;
			await sim.ctlOk(`set holding ${addr} 4660 22136 39612 57072`);
			await expect(grid.locator("tbody tr").nth(2)).toContainText("0x1234");
			for (const fc of [6, 16]) {
				const rows = grid.locator("tbody tr");
				await rows.nth(0).click();
				await rows.nth(1).click({ modifiers: ["Shift"] });
				await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
				await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
				await rows.nth(2).click({ button: "right" });
				await mm.page
					.getByRole("menuitem", { name: "Write…", exact: true })
					.click();
				const d = mm.writeDialog;
				await expect(
					d.getByLabel("Start address", { exact: true }),
				).toHaveValue(String(addr));
				await expect(
					d.getByLabel("Raw register value (16-bit)", { exact: true }),
				).toHaveValue(fc === 16 ? "4951" : "4660");
				await expect(d).toContainText(
					"Writes send individual 16-bit registers. Combined values are not encoded.",
				);
				await d
					.getByLabel("Function", { exact: true })
					.selectOption(String(fc));
				if (fc === 6)
					await d
						.getByLabel("Raw register value (16-bit)", { exact: true })
						.fill("4951");
				else await d.getByLabel(/^Values \(/).fill("4660 22136 39612 57072");
				const mark = sim.mark();
				await d.getByRole("button", { name: "Send", exact: true }).click();
				await expect(mm.page.getByTestId("write-result")).toContainText(
					"Write confirmed by slave 1:",
				);
				const writes = sim.requestsDecoded(mark).filter((r) => r.fc === fc);
				expect(writes).toHaveLength(1);
				const request = writes[0];
				expect(request?.addr).toBe(addr);
				const pdu = request?.bytes.split(" ").slice(7).join(" ");
				const address = `00 ${addr.toString(16).toUpperCase().padStart(2, "0")}`;
				expect(pdu).toBe(
					fc === 6
						? `06 ${address} 13 57`
						: `10 ${address} 00 04 08 12 34 56 78 9A BC DE F0`,
				);
				expect(await sim.get("holding", addr, fc === 6 ? 1 : 4)).toEqual(
					fc === 6 ? [4951] : [4660, 22136, 39612, 57072],
				);
				const reply = sim
					.framesSince(mark)
					.find(
						(f) =>
							f.dir === "TX" &&
							f.bytes?.startsWith(request?.bytes.slice(0, 5) ?? "missing"),
					);
				expect(reply?.bytes?.split(" ").slice(7).join(" ")).toBe(
					fc === 6 ? `06 ${address} 13 57` : `10 ${address} 00 04`,
				);
				evidence.push({
					width,
					swap,
					reverse,
					fc,
					address: addr,
					request: request?.bytes,
					reply: reply?.bytes,
				});
				await d.getByRole("button", { name: "Close", exact: true }).click();
				await expect(rows.nth(2)).toContainText(fc === 6 ? "0x1357" : "0x1234");
			}
		}
	expect(sim.linesWith("OVERLAP")).toEqual([]);
	await info.attach("raw-writes.json", {
		body: JSON.stringify({ freeBytes: free, evidence }, null, 2),
		contentType: "application/json",
	});
});
