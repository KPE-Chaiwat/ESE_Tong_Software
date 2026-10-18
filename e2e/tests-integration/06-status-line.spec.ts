// Integration mode (REPORT-006), (f): CHK2-E12, E13, E16-E26 in the REAL WebView2 at the machine's real scale factor
// (125 %) with DirectWrite metrics. One poll reaches Tx >= 1000 (4 digits, like the reference content), then the
// frame width is driven with REAL mouse input on the east resize handle: reference frames, every boundary frame and
// width sweeps (900 -> 320 -> 900), active and inactive, Polling and Timeout. All numbers are measured from the DOM.
import { expect, test } from "../integration/fixtures";
import type { RealMm } from "../integration/fixtures";
import { createPolls, referenceMap } from "../integration/scenario";
import { FIT_FRAME, flat, type Kind, measure, type Measure, row, twoFrames, validate } from "../integration/status-line";

const TIMEOUT_MS = 5000;

async function grabEast(mm: RealMm, id: number): Promise<{ x: number; y: number }> {
  const b = await mm.sub(id).locator('[data-resize-handle="e"]').boundingBox();
  if (!b) throw new Error("east resize handle not rendered");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Frame width with real input: a mouse drag of the east handle gets close (a CSS px is 1.25 device px at this
 * scale, so the pointer cannot land on every width), then Ctrl+Alt+Shift+Arrow (1 px) makes it exact.
 */
async function setWidth(mm: RealMm, id: number, target: number): Promise<void> {
  const w0 = (await mm.domRect(id)).width;
  if (Math.abs(target - w0) > 12) {
    const p = await grabEast(mm, id);
    await mm.page.mouse.move(p.x, p.y);
    await mm.page.mouse.down();
    await mm.page.mouse.move(p.x + (target - w0), p.y, { steps: 4 });
    await twoFrames(mm.page);
    await mm.page.mouse.up();
    await twoFrames(mm.page);
  }
  for (let guard = 0; guard < 40; guard += 1) {
    const w = (await mm.domRect(id)).width;
    if (w === target) break;
    await mm.grid(id).focus();
    await mm.page.keyboard.press(w < target ? "Control+Alt+Shift+ArrowRight" : "Control+Alt+Shift+ArrowLeft");
    await twoFrames(mm.page);
  }
  await expect.poll(async () => (await mm.domRect(id)).width, { message: `frame width ${target}` }).toBe(target);
  await twoFrames(mm.page);
}

async function deactivate(mm: RealMm, a: number, b: number): Promise<void> {
  await mm.titleBar(b).click({ position: { x: 40, y: 15 } });
  await expect(mm.sub(a)).not.toHaveAttribute("aria-current", "true");
}

async function settle(mm: RealMm, id: number, kind: Kind): Promise<Measure> {
  let m = await measure(mm.page, id);
  for (let i = 0; i < 8; i += 1) {
    const v = validate(m, kind, false, TIMEOUT_MS);
    if (v.step.length === 0 && v.structure.length === 0) break;
    await twoFrames(mm.page);
    m = await measure(mm.page, id);
  }
  return m;
}

interface Result {
  m: Measure;
  issues: string[];
  cutDocumented: boolean;
}

function check(m: Measure, kind: Kind): Result {
  const frame = m.frameOffsetWidth;
  const must = frame >= FIT_FRAME[kind];
  const v = validate(m, kind, must, TIMEOUT_MS);
  return { m, issues: flat(v), cutDocumented: v.cutDocumented };
}

const REF = [640, 600, 560, 430];
// frame boundaries of E20-E25 (active: L + 4)
const BOUNDARY = [724, 723, 814, 813, 624, 623, 610, 609, 504, 503, 469, 468];

test.describe("(f) status line in the real WebView2 (E12, E13, E16-E26)", () => {
  test("CHK2-E16..E26 reference frames, boundaries and width sweeps at the real scale factor, Polling then Timeout, active and inactive", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(900_000);
    // maximized W1: room for B at the far right so no edge of B is within snapping range of A's right edge
    const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    desktop.showWindow(w1?.hwnd as number, "max");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.zoomed).toBe(true);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: TIMEOUT_MS });
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    const [a, b] = await createPolls(mm, [
      { name: "A", slave: 1, fc: 3, start: 0, qty: 10, scan: 20 },
      { name: "B", slave: 2, fc: 3, start: 0, qty: 5, scan: 1000 },
    ]) as [number, number];
    // B sits below A (a real drag of its title bar) so it never covers A's status line
    const tb = await mm.titlePoint(b, 60);
    await mm.page.mouse.move(tb.x, tb.y);
    await mm.page.mouse.down();
    await mm.page.mouse.move(tb.x + 1500, tb.y + 380, { steps: 8 });
    await mm.page.mouse.up();
    await expect.poll(async () => (await mm.domRect(b)).x).toBeGreaterThan(900);
    // Tx must have four digits (reference content): A polls at 20 ms until 1000, then scan 100 ms
    await expect
      .poll(async () => Number((await mm.statusText(a)).match(/Tx (\d+)/)?.[1]), { timeout: 120_000, intervals: [1000], message: "Tx >= 1000" })
      .toBeGreaterThanOrEqual(1000);
    await mm.titleButton(a, /^Poll setup/).click();
    await mm.setupField(a, "Scan rate (ms)").fill("100");
    await mm.setup(a).getByRole("button", { name: "Apply", exact: true }).click();
    await mm.closeSetup(a);
    await expect.poll(async () => /SR 100 ms(?! \(effective)/.test(await mm.statusText(a)) && !(await mm.statusText(a)).includes("effective"), { timeout: 20_000 }).toBe(true);
    await mm.sub(a).click({ position: { x: 300, y: 200 } });
    await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");

    const all: Array<Record<string, unknown>> = [];
    const failures: string[] = [];
    const notes: string[] = [];
    const record = (label: string, r: Result, kind: Kind) => {
      all.push({ label, ...row(r.m, kind) });
      if (r.issues.length) failures.push(`${label} frame ${r.m.frameOffsetWidth} L ${r.m.L} step ${r.m.step}: ${r.issues.join(" | ")}`);
    };

    const phase = async (kind: Kind) => {
      // ---- reference frames (E16-E19) and boundary frames (E20-E25), active
      for (const w of [...REF, ...BOUNDARY]) {
        await setWidth(mm, a, w);
        record(`${kind}-active-${w}`, check(await settle(mm, a, kind), kind), kind);
      }
      // ---- boundary and reference frames, inactive
      for (const w of [...REF, ...BOUNDARY]) {
        await setWidth(mm, a, w);
        await deactivate(mm, a, b);
        record(`${kind}-inactive-${w}`, check(await settle(mm, a, kind), kind), kind);
        await mm.sub(a).click({ position: { x: 300, y: 200 } });
      }
      // ---- sweep active, 900 -> 320 -> 900 in 4 px steps with ONE press of the handle
      await setWidth(mm, a, 900);
      const p = await grabEast(mm, a);
      await mm.page.mouse.move(p.x, p.y);
      await mm.page.mouse.down();
      const sweep: Result[] = [];
      for (let w = 900; w >= 320; w -= 4) {
        await mm.page.mouse.move(p.x - (900 - w), p.y);
        await twoFrames(mm.page);
        const r = check(await settle(mm, a, kind), kind);
        sweep.push(r);
        record(`${kind}-sweep-active-down-${w}`, r, kind);
      }
      for (let w = 324; w <= 900; w += 4) {
        await mm.page.mouse.move(p.x - (900 - w), p.y);
        await twoFrames(mm.page);
        const r = check(await settle(mm, a, kind), kind);
        sweep.push(r);
        record(`${kind}-sweep-active-up-${w}`, r, kind);
      }
      await mm.page.mouse.up();
      await twoFrames(mm.page);
      // summary of the active sweep: step by frame, counters complete from which frame, clips
      const byStep = new Map<string, number[]>();
      for (const r of sweep) byStep.set(String(r.m.step), [...(byStep.get(String(r.m.step)) ?? []), r.m.frameOffsetWidth]);
      const ranges = [...byStep.entries()].map(([s, f]) => `step ${s}: frames ${Math.min(...f)}-${Math.max(...f)}`);
      const completeFrom = Math.min(...sweep.filter((r) => r.m.counters.need - r.m.counters.width <= 0.5).map((r) => r.m.frameOffsetWidth));
      const maxCut = Math.max(...sweep.map((r) => r.m.counters.need - r.m.counters.width));
      const clips = sweep.filter((r) => Math.max(r.m.pill.clipped, r.m.fresh.clipped, r.m.show.clipped, r.m.actions.clipped) > 0.5).length;
      notes.push(`${kind} active sweep (${sweep.length} frames): ${ranges.join("; ")}; counters complete from frame ${completeFrom}; widest cut ${Math.round(maxCut * 10) / 10} px; frames with a clipped control: ${clips}`);
      // ---- sweep inactive (8 px steps, press B before each measure)
      const inactive: Result[] = [];
      for (let w = 900; w >= 320; w -= 8) {
        await setWidth(mm, a, w);
        await deactivate(mm, a, b);
        const r = check(await settle(mm, a, kind), kind);
        inactive.push(r);
        record(`${kind}-sweep-inactive-${w}`, r, kind);
        await mm.sub(a).click({ position: { x: 300, y: 200 } });
      }
      const iclips = inactive.filter((r) => Math.max(r.m.pill.clipped, r.m.fresh.clipped, r.m.show.clipped, r.m.actions.clipped) > 0.5).length;
      notes.push(`${kind} inactive sweep (${inactive.length} frames, 8 px): border ${[...new Set(inactive.map((r) => r.m.borderPx))].join("/")} px; frames with a clipped control: ${iclips}`);
    };

    await phase("polling");
    // ---- Timeout case: the device stops answering slave 1; wait for Timeout with Err >= 3
    await setWidth(mm, a, 640);
    await sim.ctlOk("fault drop unit=1");
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "timeout", { timeout: 60_000 });
    await expect.poll(async () => Number((await mm.statusText(a)).match(/Err (\d+)/)?.[1]), { timeout: 60_000, intervals: [500], message: "Err >= 3" }).toBeGreaterThanOrEqual(3);
    await phase("timeout");
    await sim.ctlOk("clear");

    await testInfo.attach("status-line-table.json", { body: JSON.stringify({ dpr, rows: all, notes, failures }, null, 1), contentType: "application/json" });
    console.log("STATUS-LINE NOTES", JSON.stringify(notes));
    console.log("STATUS-LINE REF", JSON.stringify(all.filter((r) => /-active-(640|600|560|430)$/.test(String(r.label)))));
    console.log("STATUS-LINE BOUNDARY", JSON.stringify(all.filter((r) => /-(active|inactive)-(7\d\d|8\d\d|6[02]\d|5\d\d|4[67]\d)$/.test(String(r.label)))));
    console.log("STATUS-LINE FAILURES", failures.length, JSON.stringify(failures.slice(0, 40)));
    expect(failures, "status line items that failed the validator").toEqual([]);
  });
});

test.describe("(f) setup presentation and the wide layout at the real DPI (E12, E13)", () => {
  test("CHK2-E12 setup dock at frame 640 and 900, popover at 639 and 600, for an active and an inactive frame; the presentation does not change when the frame is deactivated", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    desktop.showWindow(w1?.hwnd as number, "max");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.zoomed).toBe(true);
    const [a, b] = await createPolls(mm, [
      { name: "A", slave: 1, fc: 3, start: 0, qty: 10, scan: 200 },
      { name: "B", slave: 2, fc: 3, start: 0, qty: 5, scan: 1000 },
    ]) as [number, number];
    const tb = await mm.titlePoint(b, 60);
    await mm.page.mouse.move(tb.x, tb.y);
    await mm.page.mouse.down();
    await mm.page.mouse.move(tb.x + 1500, tb.y + 380, { steps: 8 });
    await mm.page.mouse.up();
    const rows: Array<Record<string, unknown>> = [];
    const presentation = () => mm.sub(a).locator('[data-slot="poll-view"]').getAttribute("data-presentation");
    for (const [frame, want] of [[900, "dock"], [641, "dock"], [640, "dock"], [639, "popover"], [600, "popover"]] as const) {
      await mm.sub(a).click({ position: { x: 300, y: 200 } });
      await setWidth(mm, a, frame);
      // open the setup (⚙) when it is closed
      if ((await mm.setup(a).count()) === 0) await mm.titleButton(a, /^Poll setup/).click();
      await expect(mm.setup(a)).toBeVisible();
      const active = await presentation();
      const offsetWidth = (await mm.domRect(a)).width;
      await deactivate(mm, a, b);
      const inactive = await presentation();
      const stillOpen = (await mm.setup(a).count()) > 0;
      await mm.sub(a).click({ position: { x: 300, y: 200 } });
      const reactivated = await presentation();
      rows.push({ frame, offsetWidth, want, active, inactive, reactivated, stillOpenWhenInactive: stillOpen });
      await mm.titleButton(a, /^Poll setup/).click(); // close it again
      await expect(mm.setup(a)).toHaveCount(0);
    }
    console.log("E12 REAL", JSON.stringify(rows));
    await testInfo.attach("e12.json", { body: JSON.stringify(rows, null, 1), contentType: "application/json" });
    for (const r of rows) {
      expect(r.active, `frame ${r.frame} active`).toBe(r.want);
      expect(r.inactive, `frame ${r.frame} inactive`).toBe(r.want);
      expect(r.reactivated, `frame ${r.frame} re-activated`).toBe(r.want);
      expect(r.stillOpenWhenInactive, `frame ${r.frame}: the setup stays open while inactive`).toBe(true);
    }
  });

  test("CHK2-E13 boundary: frame 724 has the segmented controls in the data card, frame 723 the Show menu in the status line", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    desktop.showWindow(w1?.hwnd as number, "max");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.zoomed).toBe(true);
    const [a] = await createPolls(mm, [{ name: "A", slave: 1, fc: 3, start: 0, qty: 10, scan: 200 }]) as [number];
    for (const [frame, wide] of [[724, true], [723, false]] as const) {
      await mm.sub(a).click({ position: { x: 300, y: 200 } });
      await setWidth(mm, a, frame);
      await twoFrames(mm.page);
      const m = await measure(mm.page, a);
      console.log("E13 REAL", JSON.stringify({ frame, L: m.L, step: m.step, radiogroups: m.radiogroups, showInLine: m.show.present }));
      if (wide) {
        expect(m.radiogroups, `frame ${frame} (L ${m.L}): segmented controls`).toBeGreaterThan(0);
        expect(m.show.present, "no Show menu in the line").toBe(false);
      } else {
        expect(m.radiogroups, `frame ${frame} (L ${m.L}): no segmented controls`).toBe(0);
        expect(m.show.present, "Show menu in the line").toBe(true);
      }
    }
  });
});
