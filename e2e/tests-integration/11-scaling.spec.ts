// Integration mode (REPORT-006), (i): scaling and alias in the real app against simulator values (CHK-003). The
// registers come from the simulator `set` command, the table shows what the real backend relays; the Write dialog
// preview never changes the raw bytes (checked in the simulator log). CHK3-A (worked examples), A44, B1, C1-C8, D1, D8,
// E1-E7, F1-F4, F10, G1.
import { execFileSync } from "node:child_process";
import { expect, type RealMm, type Sim, test } from "../integration/fixtures";
import { readProfile, saveProfileAs } from "../integration/profiles";
import { createPolls, focusPoll } from "../integration/scenario";
import { twoFrames } from "../integration/status-line";

interface ScaleCase {
  id: string;
  preset: "4-20 mA" | "0-10 V" | "Divide" | "Custom linear";
  xMin?: string;
  xMax?: string;
  yMin?: string;
  yMax?: string;
  unit?: string;
  decimals?: string;
  signed?: boolean;
  outOfRange?: "Flag" | "Clamp";
  divisor?: "10" | "100" | "1000" | string;
  regs: number[];
  expect: string[];
  markers?: Array<"none" | "outOfRange" | "clamped-low" | "clamped-high">;
}

const CASES: ScaleCase[] = [
  { id: "A1-A4", preset: "4-20 mA", xMin: "0", xMax: "65535", regs: [0, 65535, 32768, 16384], expect: ["4.00", "20.00", "12.00", "8.00"] },
  { id: "A5", preset: "4-20 mA", xMin: "0", xMax: "65535", decimals: "4", regs: [32768], expect: ["12.0001"] },
  { id: "A6,A7,A9 (flag)", preset: "4-20 mA", xMin: "4000", xMax: "20000", outOfRange: "Flag", regs: [12000, 0, 3000], expect: ["12.00", "0.00", "3.00"], markers: ["none", "outOfRange", "outOfRange"] },
  { id: "A8 (clamp)", preset: "4-20 mA", xMin: "4000", xMax: "20000", outOfRange: "Clamp", regs: [0], expect: ["4.00"], markers: ["clamped-low"] },
  { id: "A10,A11", preset: "0-10 V", xMin: "0", xMax: "4095", regs: [2048, 4095], expect: ["5.00", "10.00"] },
  { id: "A12 (flag)", preset: "0-10 V", xMin: "0", xMax: "4095", outOfRange: "Flag", regs: [5000], expect: ["12.21"], markers: ["outOfRange"] },
  { id: "A13 (clamp)", preset: "0-10 V", xMin: "0", xMax: "4095", outOfRange: "Clamp", regs: [5000], expect: ["10.00"], markers: ["clamped-high"] },
  { id: "A14,A15", preset: "0-10 V", xMin: "0", xMax: "27648", outOfRange: "Flag", regs: [13824, 32767], expect: ["5.00", "11.85"], markers: ["none", "outOfRange"] },
  { id: "A16,A17 divide by 10", preset: "Divide", divisor: "10", regs: [253, 65535], expect: ["25.3", "6553.5"] },
  { id: "A18 divide by 10 signed", preset: "Divide", divisor: "10", signed: true, regs: [65535], expect: ["-0.1"] },
  { id: "A19 divide by 100", preset: "Divide", divisor: "100", regs: [1234], expect: ["12.34"] },
  { id: "A20 divide by 100 signed", preset: "Divide", divisor: "100", signed: true, regs: [65436], expect: ["-1.00"] },
  { id: "A21,A22 divide by 1000", preset: "Divide", divisor: "1000", regs: [1, 65535], expect: ["0.001", "65.535"] },
  { id: "A23-A25 ties, 0 dp", preset: "Divide", divisor: "10", decimals: "0", regs: [25, 35, 24], expect: ["3", "4", "2"] },
  { id: "A26,A27 signed ties, 0 dp", preset: "Divide", divisor: "10", decimals: "0", signed: true, regs: [65511, 65532], expect: ["-3", "0"] },
  { id: "A28 custom divisor 4", preset: "Divide", divisor: "4", regs: [10], expect: ["2.50"], decimals: "2" },
  { id: "A29 custom divisor -2", preset: "Divide", divisor: "-2", regs: [10], expect: ["-5.00"], decimals: "2" },
  { id: "A30,A31,A33 custom linear %", preset: "Custom linear", xMin: "4000", xMax: "20000", yMin: "0", yMax: "100", unit: "%", decimals: "1", outOfRange: "Flag", regs: [12000, 3000, 24000], expect: ["50.0", "-6.3", "125.0"], markers: ["none", "outOfRange", "outOfRange"] },
  { id: "A32 clamp", preset: "Custom linear", xMin: "4000", xMax: "20000", yMin: "0", yMax: "100", unit: "%", decimals: "1", outOfRange: "Clamp", regs: [3000], expect: ["0.0"], markers: ["clamped-low"] },
  { id: "A34-A35 reversed", preset: "Custom linear", xMin: "0", xMax: "1000", yMin: "100", yMax: "0", decimals: "2", outOfRange: "Flag", regs: [250, 1200], expect: ["75.00", "-20.00"], markers: ["none", "outOfRange"] },
  { id: "A36 reversed clamp", preset: "Custom linear", xMin: "0", xMax: "1000", yMin: "100", yMax: "0", decimals: "2", outOfRange: "Clamp", regs: [1200], expect: ["0.00"], markers: ["clamped-high"] },
  { id: "A37-A39 float ties", preset: "0-10 V", xMin: "0", xMax: "1000", decimals: "1", regs: [15, 5, 25], expect: ["0.2", "0.1", "0.3"] },
  { id: "A40-A42 signed custom", preset: "Custom linear", xMin: "-32768", xMax: "32767", yMin: "-100", yMax: "100", decimals: "2", signed: true, regs: [32768, 32767, 0], expect: ["-100.00", "100.00", "0.00"] },
  { id: "A45 six decimals", preset: "4-20 mA", xMin: "0", xMax: "65535", decimals: "6", regs: [717], expect: ["4.175051"] },
  { id: "A46 tie 2.675", preset: "Custom linear", xMin: "0", xMax: "4000", yMin: "0", yMax: "4", decimals: "2", regs: [2675], expect: ["2.68"] },
  { id: "A47 negative tie", preset: "Custom linear", xMin: "0", xMax: "4000", yMin: "0", yMax: "-4", decimals: "2", regs: [2675], expect: ["-2.68"] },
  { id: "A49 not a tie", preset: "Custom linear", xMin: "0", xMax: "10", yMin: "0", yMax: "10000000004", decimals: "0", regs: [1], expect: ["1000000000"] },
  { id: "A50 too large", preset: "Custom linear", xMin: "0", xMax: "2", yMin: "999999999999998", yMax: "999999999999999", decimals: "0", outOfRange: "Flag", regs: [3], expect: ["too large"], markers: ["outOfRange"] },
  { id: "A51", preset: "Custom linear", xMin: "0", xMax: "2", yMin: "999999999999998", yMax: "999999999999999", decimals: "1", outOfRange: "Flag", regs: [3], expect: ["999999999999999.5"], markers: ["outOfRange"] },
  { id: "A52", preset: "Custom linear", xMin: "0", xMax: "2", yMin: "999999999999998", yMax: "999999999999999", decimals: "0", regs: [2], expect: ["999999999999999"] },
  { id: "A55 carry", preset: "Custom linear", xMin: "0", xMax: "1000", yMin: "0", yMax: "2", decimals: "2", regs: [998], expect: ["2.00"] },
];

/** The clipboard as the OS sees it (independent of the page's clipboard permission). */
function clipboardOs(): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8", timeout: 15_000 });
}

async function session(mm: RealMm, sim: Sim, qty = 4, name = "S"): Promise<number> {
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
  const [id] = await createPolls(mm, [{ name, slave: 1, fc: 3, start: 0, qty, scan: 100 }]);
  return id as number;
}

async function openSetup(mm: RealMm, id: number): Promise<void> {
  if (!(await mm.setup(id).isVisible())) await mm.titleButton(id, /^Poll setup/).click();
  await expect(mm.setup(id)).toBeVisible();
}

async function applyScale(mm: RealMm, id: number, c: Partial<ScaleCase>): Promise<string | null> {
  await openSetup(mm, id);
  const sc = mm.setup(id);
  await sc.getByLabel("Preset", { exact: true }).selectOption({ label: c.preset as string });
  // order matters: choosing a divisor resets the decimals, so the divisor comes first; signed is explicit (it sticks between presets)
  const signedBox = sc.getByLabel("Raw is signed");
  if ((await signedBox.isChecked()) !== (c.signed ?? false)) await signedBox.setChecked(c.signed ?? false);
  if (c.divisor !== undefined) {
    if (["10", "100", "1000"].includes(c.divisor)) await sc.getByRole("radio", { name: c.divisor, exact: true }).click();
    else {
      await sc.getByRole("radio", { name: "Custom", exact: true }).click();
      await sc.getByLabel("Custom divisor", { exact: true }).fill(c.divisor);
    }
  }
  const fill = async (label: string, v: string | undefined) => {
    if (v !== undefined) await sc.getByLabel(label, { exact: true }).fill(v);
  };
  await fill("Raw min", c.xMin);
  await fill("Raw max", c.xMax);
  await fill("Eng. min", c.yMin);
  await fill("Eng. max", c.yMax);
  await fill("Unit", c.unit);
  await fill("Decimals", c.decimals);
  if (c.outOfRange) await sc.getByRole("radio", { name: c.outOfRange, exact: true }).click();
  await sc.getByRole("button", { name: "Apply scale", exact: true }).click();
  await twoFrames(mm.page);
  if ((await sc.getByTestId("scale-not-applied").count()) > 0) return (await sc.innerText()).replace(/\s+/g, " ").slice(0, 400);
  return null;
}

async function scaled(mm: RealMm, id: number, row: number) {
  const cell = mm.gridRow(id, row).locator('[data-cell="scaled"]');
  return {
    text: ((await cell.locator("span").count()) > 0 ? await cell.locator("span").first().innerText() : await cell.innerText()).trim(),
    marker: (await cell.getAttribute("data-marker")) ?? "none",
    label: await cell.getAttribute("aria-label"),
    title: await cell.getAttribute("title"),
  };
}

test.describe("(i) scaling and alias in the real app", () => {
  test("CHK3-A worked examples: the scaled cell text and the out-of-range marker against registers set on the simulator (33 cases)", async ({ mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    const id = await session(mm, sim, 4);
    const results: Array<Record<string, unknown>> = [];
    const failures: string[] = [];
    for (const c of CASES) {
      await sim.ctlOk(`set holding 0 ${c.regs.join(" ")}`);
      const refused = await applyScale(mm, id, c);
      if (refused) {
        failures.push(`${c.id}: the scale was refused: ${refused}`);
        continue;
      }
      await mm.closeSetup(id);
      // wait until the raw cells carry the registers
      await expect
        .poll(async () => (await mm.rowCells(id, c.regs.length - 1)).join("|"), { message: `${c.id}: rows`, timeout: 8000 })
        .toContain(String(c.regs[c.regs.length - 1]));
      for (const [i, want] of c.expect.entries()) {
        let got = await scaled(mm, id, i);
        // the next poll cycle may still show the previous scale: re-read for up to 2 s
        for (let k = 0; k < 20 && got.text !== want; k += 1) {
          await new Promise((r) => setTimeout(r, 100));
          got = await scaled(mm, id, i);
        }
        const wantMarker = c.markers?.[i] ?? "none";
        results.push({ case: c.id, row: i, raw: c.regs[i], want, got: got.text, wantMarker, marker: got.marker, label: got.label });
        if (got.text !== want) failures.push(`${c.id} row ${i} raw ${c.regs[i]}: want "${want}" got "${got.text}"`);
        if (got.marker !== wantMarker && !(wantMarker === "none" && got.marker === "none")) failures.push(`${c.id} row ${i}: marker want ${wantMarker} got ${got.marker}`);
      }
    }
    await testInfo.attach("scaling-results.json", { body: JSON.stringify(results, null, 1), contentType: "application/json" });
    console.log("SCALING RESULTS", results.length, "rows, failures", failures.length, JSON.stringify(failures));
    expect(failures, "worked examples that differ").toEqual([]);
  });

  test("CHK3-A7/A8/H1 tooltips and accessible names of the out-of-range and clamp markers", async ({ mm, sim }) => {
    const id = await session(mm, sim, 2);
    await sim.ctlOk("set holding 0 0 3000");
    await applyScale(mm, id, { preset: "4-20 mA", xMin: "4000", xMax: "20000", outOfRange: "Flag", decimals: "2" });
    await mm.closeSetup(id);
    await expect.poll(async () => (await scaled(mm, id, 0)).marker).toBe("outOfRange");
    const flagged = await scaled(mm, id, 0);
    expect(flagged.title).toBe("Raw 0 is outside the raw range 4000-20000.");
    expect(flagged.label).toBe("0.00 mA, out of range");
    await applyScale(mm, id, { preset: "4-20 mA", xMin: "4000", xMax: "20000", outOfRange: "Clamp", decimals: "2" });
    await mm.closeSetup(id);
    await expect.poll(async () => (await scaled(mm, id, 0)).marker).toBe("clamped-low");
    expect((await scaled(mm, id, 0)).label).toBe("4.00 mA, clamped");
    // the amber tint is only on the Scaled cell, the text stays dark: no orange text on a light surface
    const cell = mm.gridRow(id, 0).locator('[data-cell="scaled"]');
    expect(await cell.evaluate((el) => getComputedStyle(el).color)).not.toMatch(/250, 129, 48/);
  });

  test("CHK3-C1-C8 validation: the real messages, the scale is not applied and 'Applied:' is unchanged", async ({ mm, sim }) => {
    const id = await session(mm, sim, 2);
    await applyScale(mm, id, { preset: "4-20 mA", xMin: "0", xMax: "65535" });
    const sc = mm.setup(id);
    await expect(sc.getByTestId("applied-scale")).toContainText("Applied: 4-20 mA (raw 0-65535)");
    // Tab first: the field message appears on blur and moves the button; a click that is already under way would be lost
    const apply = async () => {
      await mm.page.keyboard.press("Tab");
      await twoFrames(mm.page);
      await sc.getByRole("button", { name: "Apply scale", exact: true }).click();
    };
    const cases: Array<[string, string, string, string]> = [
      ["Raw min", "-1", "Raw min", "Raw min must be a whole number from 0 to 65535."],
      ["Raw max", "65536", "Raw max", "Raw max must be a whole number from 0 to 65535."],
      ["Decimals", "7", "Decimals", "Decimals must be a whole number from 0 to 6."],
    ];
    for (const [label, value, , message] of cases) {
      const field = sc.getByLabel(label, { exact: true });
      const old = await field.inputValue();
      await field.fill(value);
      await apply();
      await expect(sc).toContainText(message);
      console.log("C-NOTAPPLIED", label, JSON.stringify((await sc.innerText()).replace(/\s+/g, " ").slice(0, 500)));
      await expect(sc.getByTestId("scale-not-applied")).toContainText("Scale not applied. Fix the highlighted fields.");
      await expect(sc.getByTestId("applied-scale")).toContainText("Applied: 4-20 mA (raw 0-65535)");
      await field.fill(old);
    }
    // Custom linear
    await sc.getByLabel("Preset", { exact: true }).selectOption({ label: "Custom linear" });
    await sc.getByLabel("Raw min", { exact: true }).fill("100");
    await sc.getByLabel("Raw max", { exact: true }).fill("100");
    await apply();
    await expect(sc).toContainText("Raw min and raw max must be different.");
    await sc.getByLabel("Raw max", { exact: true }).fill("200");
    await sc.getByLabel("Eng. min", { exact: true }).fill("abc");
    await apply();
    await expect(sc).toContainText("Engineering min must be a number, for example 4 or -12.5.");
    await sc.getByLabel("Eng. min", { exact: true }).fill("4,5");
    await apply();
    await expect(sc).toContainText("Use a dot as the decimal separator.");
    await sc.getByLabel("Eng. min", { exact: true }).fill("5");
    await sc.getByLabel("Eng. max", { exact: true }).fill("5");
    await apply();
    await expect(sc).toContainText("Engineering min and max must be different.");
    await sc.getByLabel("Eng. max", { exact: true }).fill("1e3");
    await apply();
    await expect(sc).toContainText("Engineering max must be a number, for example 20 or 100.5.");
    await sc.getByLabel("Preset", { exact: true }).selectOption({ label: "Divide" });
    await sc.getByRole("radio", { name: "Custom", exact: true }).click();
    await sc.getByLabel("Custom divisor", { exact: true }).fill("0");
    await apply();
    await expect(sc).toContainText("Divisor must be a number other than 0.");
    await expect(sc.getByTestId("applied-scale")).toContainText("Applied: 4-20 mA (raw 0-65535)");
    // the table still uses the old scale
    await sim.ctlOk("set holding 0 32768 0");
    await mm.closeSetup(id);
    await expect.poll(async () => (await scaled(mm, id, 0)).text).toBe("12.00");
  });

  test("CHK3-D1/D8 overrides: Ctrl+Shift+E on rows 0-1, Divide by 10 with unit; poll scale None; 'temperature /10 and pressure /100 in one poll'", async ({ mm, sim }) => {
    test.setTimeout(120_000);
    const id = await session(mm, sim, 12);
    await sim.ctlOk("set holding 0 253 254 0 0 0 0 0 0 1234 0 0 0");
    await focusPoll(mm, id);
    await mm.gridRow(id, 0).click();
    await mm.gridRow(id, 3).click({ modifiers: ["Shift"] });
    await mm.page.keyboard.press("Control+Shift+E");
    const dlg = mm.page.getByTestId("override-dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId("applies-to")).toContainText("Applies to 0-3");
    await dlg.getByLabel("Preset", { exact: true }).selectOption({ label: "Divide" });
    await dlg.getByRole("radio", { name: "10", exact: true }).click();
    await dlg.getByLabel("Unit", { exact: true }).fill("°C");
    await dlg.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dlg).toHaveCount(0);
    await mm.gridRow(id, 8).click();
    await mm.page.keyboard.press("Control+Shift+E");
    await dlg.getByLabel("Preset", { exact: true }).selectOption({ label: "Divide" });
    await dlg.getByRole("radio", { name: "100", exact: true }).click();
    await dlg.getByLabel("Unit", { exact: true }).fill("bar");
    await dlg.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await scaled(mm, id, 0)).text).toBe("25.3");
    const r0 = mm.gridRow(id, 0).locator('[data-cell="scaled"]');
    await expect(r0).toContainText("°C");
    expect((await scaled(mm, id, 8)).text).toBe("12.34");
    await expect(mm.gridRow(id, 8).locator('[data-cell="scaled"]')).toContainText("bar");
    expect((await scaled(mm, id, 5)).text, "row 5 has no scale").toBe("—");
    // the traffic is unchanged by scaling: the replies carry raw 253 and 1234 (00 FD / 04 D2)
    const reply = sim.frames().filter((f) => f.dir === "TX").at(-1)?.bytes ?? "";
    expect(reply).toContain("00 FD 00 FE");
    expect(reply).toContain("04 D2");
  });

  test("CHK3-E1/E2/E7 copy: Ctrl+C gives `address TAB raw TAB scaled`; with alias in copy `alias TAB ...`", async ({ mm, sim }) => {
    test.setTimeout(120_000);
    const id = await session(mm, sim, 3);
    await sim.ctlOk("set holding 0 0 65535 32768");
    await applyScale(mm, id, { preset: "4-20 mA", xMin: "0", xMax: "65535" });
    await mm.closeSetup(id);
    await expect.poll(async () => (await scaled(mm, id, 1)).text).toBe("20.00");
    await focusPoll(mm, id);
    await mm.gridRow(id, 0).click();
    await mm.gridRow(id, 1).click({ modifiers: ["Shift"] });
    await mm.page.keyboard.press("Control+c");
    let clip = "";
    try {
      clip = clipboardOs().replace(/\r\n/g, "\n").replace(/\n$/, "");
    } catch (e) {
      test.info().annotations.push({ type: "clipboard", description: `navigator.clipboard.readText failed in WebView2: ${String(e).slice(0, 120)}` });
    }
    console.log("CLIPBOARD after Ctrl+C", JSON.stringify(clip));
    expect(clip, "Ctrl+C on rows 0-1 (Both)").toBe("0\t0\t4.00\n1\t65535\t20.00");
  });

  test("CHK3-F1/F2/F3/F4/F10 Write dialog: scaled preview, raw bytes on the wire unchanged", async ({ mm, sim }) => {
    test.setTimeout(120_000);
    const id = await session(mm, sim, 2);
    await applyScale(mm, id, { preset: "4-20 mA", xMin: "0", xMax: "65535" });
    await mm.closeSetup(id);
    await focusPoll(mm, id);
    await mm.page.keyboard.press("Control+e");
    await expect(mm.writeDialog).toBeVisible();
    const f = (l: string) => mm.writeDialog.getByLabel(l, { exact: true });
    await f("Function").selectOption("6");
    await f("Start address").fill("0");
    await f("Value").fill("32768");
    await expect(mm.page.getByTestId("write-preview")).toContainText("Scaled: 12.00 mA");
    const mark = sim.mark();
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect(mm.page.getByTestId("write-result")).toContainText("Write confirmed by slave 1: register at 0.");
    const w = sim.requestsDecoded(mark).filter((r) => r.fc === 6);
    expect(w[0]?.bytes.slice(6), "raw 32768 on the wire, whatever the scale says").toBe("00 00 00 06 01 06 00 00 80 00");
    // out of range value: error and no preview
    await f("Value").fill("70000");
    await expect(mm.page.getByTestId("write-preview")).toHaveCount(0);
  });

  test("CHK3-G1 scale, overrides, value columns and alias round trip through Save and the file uses JSON numbers", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    const id = await session(mm, sim, 6);
    await applyScale(mm, id, { preset: "Custom linear", xMin: "4000", xMax: "20000", yMin: "0", yMax: "100", unit: "%", decimals: "1", outOfRange: "Clamp" });
    await mm.closeSetup(id);
    await saveProfileAs(mm, "Scaled");
    const file = readProfile(desktop, "Scaled");
    const poll = file.polls[0];
    console.log("G1 FILE scale", JSON.stringify(poll.scale), "valueColumns", poll.valueColumns);
    expect(typeof poll.scale.xMin, "xMin is a JSON number").toBe("number");
    expect(typeof poll.scale.yMax, "yMax is a JSON number").toBe("number");
    expect(poll.scale).toMatchObject({ preset: "linear", xMin: 4000, xMax: 20000, yMin: 0, yMax: 100, decimals: 1, unit: "%", outOfRange: "clamp" });
    expect(["scaled", "both"]).toContain(poll.valueColumns);
  });
});

function setClipboardOs(text: string): void {
  execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", "Set-Clipboard -Value $env:QA_CLIP"], { encoding: "utf8", timeout: 15_000, env: { ...process.env, QA_CLIP: text } });
}

test.describe("(i) alias and clipboard in the real WebView2", () => {
  test("CHK2-J1/J3 alias editor: double-click, Enter opens the next row, validation messages, the profile becomes Modified", async ({ mm, sim }) => {
    test.setTimeout(90_000);
    const id = await session(mm, sim, 5);
    await focusPoll(mm, id);
    const cell = (row: number) => mm.gridRow(id, row).locator('[data-cell="alias"]');
    await cell(0).dblclick();
    await mm.page.keyboard.type("Tank top");
    await mm.page.keyboard.press("Enter");
    await expect(cell(0)).toContainText("Tank top");
    await expect(cell(1).locator("input")).toBeFocused(); // Enter opens the next row's editor
    await mm.page.keyboard.type("x".repeat(33));
    await expect(mm.page.getByText("Alias must be at most 32 characters.")).toBeVisible();
    await mm.page.keyboard.press("Control+a");
    await mm.page.keyboard.type(" a");
    await expect(mm.page.getByText("Alias cannot start or end with a space.")).toBeVisible();
    await mm.page.keyboard.press("Control+a");
    await mm.page.keyboard.type("y".repeat(32));
    await mm.page.keyboard.press("Enter");
    await expect(cell(1)).toContainText("y".repeat(32));
    await expect(mm.profileLabel).toContainText("Modified");
  });

  test("CHK2-J6 / CHK3-I4 clipboard in the real WebView2: paste aliases (Ctrl+V reads the clipboard through the page permission) and Ctrl+Shift+V in a dialog field pastes text", async ({ mm, sim }) => {
    test.setTimeout(90_000);
    const id = await session(mm, sim, 10);
    await focusPoll(mm, id);
    setClipboardOs("A\nB\n\nC");
    await mm.gridRow(id, 8).click();
    await mm.page.keyboard.press("Control+v");
    await expect(mm.toast(/Pasted 2 aliases\./)).toBeVisible({ timeout: 10_000 });
    await expect(mm.toast(/2 lines were beyond the poll range\./)).toBeVisible();
    await expect(mm.gridRow(id, 8).locator('[data-cell="alias"]')).toContainText("A");
    await expect(mm.gridRow(id, 9).locator('[data-cell="alias"]')).toContainText("B");
    // CHK3-I4: Ctrl+Shift+V pastes plain text into the Write dialog value field and does not cycle the Show control
    setClipboardOs("1234");
    await mm.grid(id).focus();
    await mm.page.keyboard.press("Control+e");
    await expect(mm.writeDialog).toBeVisible();
    await mm.writeDialog.getByLabel("Function", { exact: true }).selectOption("6");
    const value = mm.writeDialog.getByLabel("Value", { exact: true });
    await value.fill("");
    await value.focus();
    await mm.page.keyboard.press("Control+Shift+v");
    await expect(value, "Ctrl+Shift+V pasted the clipboard text").toHaveValue("1234", { timeout: 10_000 });
  });
});

test.describe("(i) scale editor with a real mouse", () => {
  for (const [label, value, message] of [
    ["Decimals", "7", "Decimals must be a whole number from 0 to 6."],
    ["Raw min", "-1", "Raw min must be a whole number from 0 to 65535."],
  ] as const) {
    test(`CHK3-C ${label} '${value}' then a plain click on [Apply scale] (no Tab): the header 'Scale not applied. Fix the highlighted fields.' shows after that one click`, async ({ mm, sim }) => {
      const id = await session(mm, sim, 2);
      await applyScale(mm, id, { preset: "4-20 mA", xMin: "0", xMax: "65535" });
      const sc = mm.setup(id);
      await sc.getByLabel(label, { exact: true }).fill(value);
      // exactly what a user does: type, then press the button with the mouse
      await sc.getByRole("button", { name: "Apply scale", exact: true }).click();
      await expect(sc).toContainText(message);
      await twoFrames(mm.page);
      const afterOne = await sc.getByTestId("scale-not-applied").count();
      expect.soft(afterOne, `the header 'Scale not applied...' is shown after ONE click on [Apply scale] with ${label} '${value}'`).toBeGreaterThan(0);
      if (afterOne === 0) {
        // diagnosis for the report: is it a lost click (layout shift on blur) or a missing header?
        const box = await sc.getByRole("button", { name: "Apply scale", exact: true }).boundingBox();
        await sc.getByRole("button", { name: "Apply scale", exact: true }).click();
        await twoFrames(mm.page);
        console.log(`C-LOST-CLICK ${label}: header after the first click: ${afterOne}; after a second click: ${await sc.getByTestId("scale-not-applied").count()}; button box before the 2nd click ${JSON.stringify(box)}`);
      }
      await expect(sc.getByTestId("scale-not-applied"), "the header after ONE click").toContainText("Scale not applied. Fix the highlighted fields.", { timeout: 3000 });
    });
  }
});
