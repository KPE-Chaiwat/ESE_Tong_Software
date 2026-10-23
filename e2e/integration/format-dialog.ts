// The Format dialog D1 of REQ-009 for the real-window specs: the poll-wide Interpretation section is
// gone, so every spec that wanted "this format on every register" selects rows and uses D1.
import { expect, type Locator, type Page } from "@playwright/test";

export type DialogFormat =
	| "unsigned32"
	| "signed32"
	| "float32"
	| "unsigned64"
	| "signed64"
	| "float64"
	| "unsigned"
	| "signed"
	| "hex"
	| "binary";

/** The radio names of D1 (`VALUE_FORMAT_LABELS`). */
export const FORMAT_LABEL: Record<DialogFormat, string> = {
	unsigned: "Unsigned",
	signed: "Signed",
	hex: "Hex",
	binary: "Binary",
	signed32: "Signed 32-bit",
	unsigned32: "Unsigned 32-bit",
	float32: "Float 32-bit",
	signed64: "Signed 64-bit",
	unsigned64: "Unsigned 64-bit",
	float64: "Float 64-bit (Double)",
};

/** The order radio of the two old flags (swap bytes within each register, reverse register order). */
export function orderLabel(swapBytes: boolean, reverseWords: boolean): string {
	if (swapBytes && reverseWords) return "Little-endian";
	if (swapBytes) return "Big-endian byte swap";
	if (reverseWords) return "Little-endian byte swap";
	return "Big-endian";
}

export function formatDialog(page: Page): Locator {
	return page.getByRole("dialog", { name: "Format / endian" });
}

/** Chooses a format (and an order for 32/64-bit) in the open dialog and presses Apply. */
export async function applyInDialog(
	page: Page,
	format: DialogFormat,
	order?: { swapBytes: boolean; reverseWords: boolean },
): Promise<void> {
	const d = formatDialog(page);
	await expect(d).toBeVisible();
	await d.getByRole("radio", { name: FORMAT_LABEL[format], exact: true }).check();
	if (order) {
		await d
			.getByRole("radio", { name: orderLabel(order.swapBytes, order.reverseWords), exact: true })
			.check();
	}
	await d.getByRole("button", { name: /^Apply/ }).click();
	await expect(d).toHaveCount(0);
}

/**
 * Gives the first `count` rows of a poll sub-window a format: click the first row, extend the
 * selection with Shift+Arrow-Down (one row per key press is slow, so End and back up), then the
 * header Format… button and the dialog. `count` is a number of registers; a group row of the current
 * formats counts as the registers it covers.
 */
export async function formatFirstRegisters(
	page: Page,
	sub: Locator,
	totalRegisters: number,
	count: number,
	format: DialogFormat,
	order?: { swapBytes: boolean; reverseWords: boolean },
): Promise<void> {
	await sub.locator("[data-row]").first().click();
	await page.keyboard.press("Shift+End");
	for (let i = 0; i < totalRegisters - count; i += 1) await page.keyboard.press("Shift+ArrowUp");
	await sub.getByRole("button", { name: "Format…" }).click();
	await applyInDialog(page, format, order);
}
