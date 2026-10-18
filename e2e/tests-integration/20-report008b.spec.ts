// REPORT-008 round 2 (completion of the targeted re-run) on the rebuilt frontend:
//   (1) CHK2-F17 / D10 native minimum: toolbar rows (two groups), icon-only buttons, grid rows, sweep, drag across 640, W1 minimum
//   (2) CHK2-R8 Thai: Ctrl+\ and Ctrl+Shift+\ with focus in the sidebar (W1), key/code pairs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { type Desktop, expect, type RealMm, RealNative, test } from "../integration/fixtures";
import { ensureWinHelper, type NativeWindow } from "../integration/desktop";
import { saveProfileAs } from "../integration/profiles";
import { createPolls, focusPoll, referenceMap, STANDARD_8 } from "../integration/scenario";
import { hwndByTitle, sleep, visibleFrame } from "../integration/qa7";
import type { Sim } from "../integration/sim";
import {
  type DocMetrics,
  docMetrics,
  f17Failures,
  gridMetrics,
  installDragRecorder,
  nativeToolbarMetrics,
  readDragRecorder,
  toolbarFailures,
  w1ToolbarMetrics,
} from "../integration/f17b";

const winTool = (args: string[]) => execFileSync(ensureWinHelper(), args, { encoding: "utf8", timeout: 20_000 }).trim();
const layoutOf = (hwnd: number) => JSON.parse(winTool(["layout", String(hwnd)])) as { top: string; focus: string; hwndFocus: number };
const fgHwnd = () => Number(winTool(["foreground"]));
const THAI = "041E041E";
const EN = "04090409";
const START_FOREGROUND_LAYOUT = layoutOf(fgHwnd()).focus;
const evidenceDir = path.join(process.cwd(), "test-results", "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const winOf = (d: Desktop, hwnd: number) => d.windows().find((w) => w.hwnd === hwnd) as NativeWindow;
const w1Hwnd = (d: Desktop) => hwndByTitle(d, "Modbus Master");

async function liveOne(mm: RealMm, sim: Sim, name = "A", qty = 10): Promise<number> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
  const [a] = await createPolls(mm, [{ name, slave: 1, fc: 3, start: 0, qty, scan: 100 }]);
  await expect(mm.statusLine(a as number)).toHaveAttribute("data-state", "polling");
  return a as number;
}

async function popOutByButton(desktop: Desktop, mm: RealMm, id: number, title: string): Promise<{ nw: RealNative; hwnd: number }> {
  await mm.titleButton(id, /^Open in its own window/).click();
  const nw = new RealNative(await desktop.w2Page(id));
  await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect(nw.view).toHaveAttribute("data-attach", "attached", { timeout: 20_000 });
  await expect.poll(() => hwndByTitle(desktop, title), { timeout: 15_000 }).not.toBe(0);
  return { nw, hwnd: hwndByTitle(desktop, title) };
}

/** Real OS edge drags (SendInput) from a large window to the smallest size the window allows. */
async function dragToMinimum(desktop: Desktop, hwnd: number): Promise<{ outer: string; client: string; w: number; h: number }> {
  const get = () => winOf(desktop, hwnd);
  desktop.moveWindow(hwnd, 100, 60, 1400, 900);
  await expect.poll(() => get().rect.w).toBe(1400);
  desktop.showWindow(hwnd, "focus");
  let f = visibleFrame(get());
  const w0 = get().rect.w;
  desktop.mouseDrag(f.x + f.w - 1, get().rect.y + 300, get().rect.x + 150, get().rect.y + 300, 30, 15);
  await expect.poll(() => get().rect.w, { message: "narrowed by the right-edge drag" }).toBeLessThan(w0);
  f = visibleFrame(get());
  const h0 = get().rect.h;
  desktop.mouseDrag(get().rect.x + 300, f.y + f.h - 1, get().rect.x + 300, get().rect.y + 60, 30, 15);
  await expect.poll(() => get().rect.h, { message: "shortened by the bottom-edge drag" }).toBeLessThan(h0);
  await sleep(600);
  const w = get();
  return { outer: `${w.rect.w}x${w.rect.h}`, client: `${w.client.w}x${w.client.h}`, w: w.rect.w, h: w.rect.h };
}

const j = (o: unknown) => JSON.stringify(o);

test.describe("REPORT-008 round 2 (1) CHK2-F17 / D10 native window toolbar squeeze", () => {
  test("CHK2-F17 REAL drag to the native minimum: toolbar rows, icon-only buttons, pills, grid rows, wheel/End, popover, focus order", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    const a = await liveOne(mm, sim);
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    await focusPoll(mm, a);
    const { nw, hwnd } = await popOutByButton(desktop, mm, a, "A - ");
    const reached = await dragToMinimum(desktop, hwnd);
    await expect(nw.view).toHaveAttribute("data-attach", "attached");
    const O = { status: "native-status-text", view: true } as const;
    const tm = await nativeToolbarMetrics(nw.page);
    const gm = await gridMetrics(nw.page);
    const dm = await docMetrics(nw.page, O);
    const tf = toolbarFailures(tm, "Pause");
    console.log("D10 real drag minimum", j({ dpr, reached, window: winOf(desktop, hwnd).client, tm, gm, doc: dm, toolbarFailures: tf }));
    fs.writeFileSync(path.join(evidenceDir, "d10-native-min-real-drag.json"), j({ dpr, reached, tm, gm, doc: dm, tf }));
    fs.writeFileSync(path.join(evidenceDir, "d10-native-min-real-drag.png"), await nw.page.screenshot());
    await testInfo.attach("d10-native-min.png", { body: await nw.page.screenshot(), contentType: "image/png" });

    // Resume state: pause with Ctrl+P (page key), the label becomes Resume
    await nw.gridRow(0).click();
    await nw.page.keyboard.press("Control+p");
    await expect(nw.statusLine).toHaveAttribute("data-state", "paused");
    const tmPaused = await nativeToolbarMetrics(nw.page);
    const tfPaused = toolbarFailures(tmPaused, "Resume");
    await nw.page.keyboard.press("Control+p");
    await expect(nw.statusLine).toHaveAttribute("data-state", "polling");

    // hover tooltip: native title only (not observable through CDP); the attribute is checked above. Focus order and ring.
    const focusOrder = async () => {
      await nw.page.evaluate(() => (document.querySelector('[data-slot="native-toolbar"] button') as HTMLElement).focus());
      await nw.page.keyboard.press("Tab");
      await nw.page.keyboard.press("Shift+Tab");
      const seq: Array<{ name: string; ring: boolean }> = [];
      for (let i = 0; i < 9; i += 1) {
        const s = await nw.page.evaluate(() => {
          const e = document.activeElement as HTMLElement;
          const cs = getComputedStyle(e);
          const inTb = !!e.closest('[data-slot="native-toolbar"]');
          return { inTb, name: e.getAttribute("aria-label") ?? e.innerText.trim(), ring: (cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== "none" && cs.boxShadow !== "") };
        });
        if (!s.inTb) break;
        seq.push({ name: s.name, ring: s.ring });
        await nw.page.keyboard.press("Tab");
      }
      return seq;
    };
    const orderIcon = await focusOrder();
    console.log("D10 focus order at the minimum (icon mode)", j(orderIcon));

    // wheel and End reach address 9
    await nw.grid.evaluate((g) => {
      g.scrollTop = 0;
    });
    await nw.grid.hover();
    await nw.page.mouse.wheel(0, 2000);
    await expect.poll(() => nw.grid.locator('[data-row="9"]').count(), { message: "wheel reaches row 9" }).toBeGreaterThan(0);
    const gWheel = await gridMetrics(nw.page);
    await nw.grid.evaluate((g) => {
      g.scrollTop = 0;
    });
    await nw.gridRow(0).click();
    await nw.page.keyboard.press("End");
    await sleep(300);
    const gEnd = await gridMetrics(nw.page);
    console.log("D10 wheel/End at the minimum", j({ wheelRows: gWheel.completeStrict, endRows: gEnd.completeStrict }));
    await nw.grid.evaluate((g) => {
      g.scrollTop = 0;
    });

    // setup popover at the minimum
    await nw.rail.click();
    const pop = nw.page.locator('[data-slot="setup-popover"]');
    await expect(pop).toBeVisible();
    await sleep(300);
    const mPop = await docMetrics(nw.page, O);
    const popTb = await nativeToolbarMetrics(nw.page);
    const popFail = f17Failures(mPop, { statusH: dm.statusTextH, versionH: dm.versionH }, { view: true, footer28: true });
    console.log("D10 popover at the minimum", j({ docFailures: popFail, toolbarRows: popTb.rows }));
    await nw.page.keyboard.press("Escape");

    // widen to 900 outer: full labels, focus order the same
    desktop.moveWindow(hwnd, 100, 60, 900, 640);
    await expect.poll(() => winOf(desktop, hwnd).rect.w).toBe(900);
    await expect(nw.page.locator('[data-slot="native-toolbar"]')).toHaveAttribute("data-label-mode", "full");
    const tm900 = await nativeToolbarMetrics(nw.page);
    const orderFull = await focusOrder();
    console.log("D10 at 900 x 640", j({ rows: tm900.rows, h: tm900.toolbarH, f: toolbarFailures(tm900), orderFull }));
    const namesIcon = orderIcon.map((o) => o.name.replace(/ \(.*\)$/, ""));
    const namesFull = orderFull.map((o) => o.name.replace(/ \(.*\)$/, ""));

    expect.soft(reached.outer, "real drag reached the native minimum").toBe("600x400");
    expect.soft(tm.rows, `toolbar rows at the minimum (offsetTops ${tm.offsets.join(",")})`).toBeLessThanOrEqual(2);
    expect.soft(tf, "toolbar rules at the minimum").toEqual([]);
    expect.soft(tfPaused, "toolbar rules at the minimum while paused (Resume)").toEqual([]);
    expect.soft(gm.completeStrict.length, `complete grid rows at the minimum (${j(gm)})`).toBeGreaterThanOrEqual(2);
    expect.soft(f17Failures(dm, { statusH: dm.statusTextH, versionH: dm.versionH }, { view: true, footer28: true }), "document checks at the minimum").toEqual([]);
    expect.soft(gWheel.completeStrict.includes(9), "wheel brings row 9 fully into view").toBe(true);
    expect.soft(gEnd.completeStrict.includes(9), "End brings row 9 fully into view").toBe(true);
    expect.soft(popFail, "document checks with the popover open").toEqual([]);
    expect.soft(orderIcon.every((o) => o.ring), `each toolbar control shows a focus ring (${j(orderIcon)})`).toBe(true);
    expect.soft(namesIcon, "focus order icon-only equals full").toEqual(namesFull);
    expect.soft(tm900.rows, "rows at 900 wide").toBeLessThanOrEqual(2);
  });

  test("CHK2-F17 sweep with SetWindowPos 900 -> 600 (10 px, then 1 px, plus 1 px steps around 640 css px) at heights 640 and 400: document, toolbar rows, icon-only, pills, name, grid rows", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(900_000);
    const a = await liveOne(mm, sim);
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    await focusPoll(mm, a);
    const { nw, hwnd } = await popOutByButton(desktop, mm, a, "A - ");
    const O = { status: "native-status-text", view: true } as const;
    desktop.moveWindow(hwnd, 100, 60, 900, 640);
    await expect.poll(() => winOf(desktop, hwnd).rect.w).toBe(900);
    await sleep(600);
    const m0 = await docMetrics(nw.page, O);
    const base = { statusH: m0.statusTextH, versionH: m0.versionH };
    // 640 css px = 800 client px = outer 818 at 125 %: add the neighbours
    const around = Array.from({ length: 13 }, (_, i) => 824 - i).filter((w) => w % 10 !== 0);
    const widths = [...new Set([...Array.from({ length: 21 }, (_, i) => 900 - 10 * i), ...around, ...Array.from({ length: 100 }, (_, i) => 699 - i)])].sort((x, y) => y - x);
    const table: Array<Record<string, unknown>> = [];
    const failures: string[] = [];
    let firstIcon: { outer: number; inner: number } | null = null;
    let lastFull: { outer: number; inner: number } | null = null;
    let maxRows = 0;
    let minComplete = 99;
    const minCompleteByH: Record<number, { rows: number; at: string }> = {};
    for (const H of [640, 400]) {
      minCompleteByH[H] = { rows: 99, at: "" };
      for (const W of widths) {
        desktop.moveWindow(hwnd, 100, 60, W, H);
        const deadline = Date.now() + 8000;
        let w = winOf(desktop, hwnd);
        while ((w.rect.w !== W || w.rect.h !== H) && Date.now() < deadline) {
          await sleep(30);
          w = winOf(desktop, hwnd);
        }
        const wantInner = w.client.w / dpr;
        let m = await docMetrics(nw.page, O);
        const d2 = Date.now() + 5000;
        while (Math.abs(m.inner - wantInner) > 1.01 && Date.now() < d2) {
          await sleep(30);
          m = await docMetrics(nw.page, O);
        }
        // the label mode follows the width one render later: wait for the mode that fits
        let tm = await nativeToolbarMetrics(nw.page);
        const d3 = Date.now() + 3000;
        while (tm.mode !== (tm.toolbarW >= 640 ? "full" : "icon") && Date.now() < d3) {
          await sleep(30);
          tm = await nativeToolbarMetrics(nw.page);
        }
        const gm = await gridMetrics(nw.page);
        const fl = [...f17Failures(m, base, { view: true, footer28: true }), ...toolbarFailures(tm, "Pause")];
        if (w.rect.w !== W || w.rect.h !== H) fl.push(`window is ${w.rect.w}x${w.rect.h}, wanted ${W}x${H}`);
        if (H === 640) {
          if (tm.mode === "icon" && !firstIcon) firstIcon = { outer: W, inner: m.inner };
          if (tm.mode === "full") lastFull = { outer: W, inner: m.inner };
        }
        maxRows = Math.max(maxRows, tm.rows);
        const nc = gm.completeStrict.length;
        minComplete = Math.min(minComplete, nc);
        const rec = minCompleteByH[H] as { rows: number; at: string };
        if (nc < rec.rows) minCompleteByH[H] = { rows: nc, at: `${W}x${H}` };
        table.push({ H, outer: `${w.rect.w}x${w.rect.h}`, inner: m.inner, client: m.clientW, view: m.viewOffsetWidth, scrollH: m.scrollH, clientH: m.clientH, gutter: m.gutterX, statusH: m.statusTextH, versionH: m.versionH, footerH: m.footerH, cut: m.statusCut, mode: tm.mode, toolbarW: tm.toolbarW, rows: tm.rows, toolbarH: tm.toolbarH, gridH: gm.gridH, complete: nc, nameCut: tm.name?.cut });
        if (fl.length) failures.push(`outer ${W}x${H} (inner ${m.inner}): ${fl.join("; ")}`);
      }
    }
    fs.writeFileSync(path.join(evidenceDir, "d10-native-sweep.json"), j({ dpr, base, firstIcon, lastFull, maxRows, minCompleteByH, failures, table }));
    await testInfo.attach("d10-sweep.json", { body: j({ dpr, base, firstIcon, lastFull, maxRows, minCompleteByH, table }), contentType: "application/json" });
    console.log("D10 sweep", j({ steps: table.length, failures: failures.length, firstIcon, lastFull, maxRows, minCompleteByH }));
    console.log("D10 sweep sample", j([table[0], table.find((t) => t.H === 640 && t.outer === "820x640"), table.find((t) => t.H === 640 && t.outer === "810x640"), table.find((t) => t.H === 640 && t.outer === "600x640"), table.find((t) => t.H === 400 && t.outer === "900x400"), table.find((t) => t.H === 400 && t.outer === "600x400")]));
    if (failures.length) console.log("D10 sweep FAILURES", failures.length, failures.slice(0, 15).join(" || "));
    expect(failures, `CHK2-F17 / D10 failures in the sweep (${failures.length} of ${table.length})`).toEqual([]);
    expect.soft(minComplete, `complete grid rows over the sweep (${j(minCompleteByH)})`).toBeGreaterThanOrEqual(2);
  });

  test("CHK2-D10 no flicker and no resize loop while dragging across 640 css px (real drag, slow, narrowing then widening)", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    const a = await liveOne(mm, sim);
    await focusPoll(mm, a);
    const { nw, hwnd } = await popOutByButton(desktop, mm, a, "A - ");
    desktop.moveWindow(hwnd, 100, 60, 960, 640);
    await expect.poll(() => winOf(desktop, hwnd).rect.w).toBe(960);
    desktop.showWindow(hwnd, "focus");
    await sleep(500);
    await installDragRecorder(nw.page);
    const results: Array<Record<string, unknown>> = [];
    const analyse = async (label: string, dir: "narrow" | "widen") => {
      const log = await readDragRecorder(nw.page);
      const frames = log.frames;
      const transitions = frames.filter((f, i) => i > 0 && f.mode !== (frames[i - 1] as typeof f).mode);
      // frames whose mode disagrees with the width (render lag)
      const wrong = frames.filter((f) => f.mode !== (f.w >= 640 ? "full" : "icon"));
      // height reversals while the width moves monotonically
      const hs = frames.map((f) => f.h);
      let reversals = 0;
      let lastDir = 0;
      for (let i = 1; i < hs.length; i += 1) {
        const d = Math.sign((hs[i] as number) - (hs[i - 1] as number));
        if (d !== 0) {
          if (lastDir !== 0 && d !== lastDir) reversals += 1;
          lastDir = d;
        }
      }
      const distinctHeights = [...new Set(hs)];
      const row = { label, dir, frames: frames.length, widthFrom: frames[0]?.w, widthTo: frames.at(-1)?.w, modeTransitions: transitions.length, transitionsAt: transitions.map((t) => `${t.mode}@${t.w}css t=${t.t}`), modeMutations: log.modeMut.length, framesWithModeNotMatchingWidth: wrong.length, wrongSample: wrong.slice(0, 4), heightSequence: hs.filter((h, i) => i === 0 || h !== hs[i - 1]), distinctHeights, heightReversals: reversals, framesWithDocumentScrollbar: frames.filter((f) => f.docOver).length };
      results.push(row);
      console.log("D10 drag", j(row));
      return row;
    };
    for (let rep = 0; rep < 2; rep += 1) {
      let w = winOf(desktop, hwnd);
      let f = visibleFrame(w);
      // narrow: right edge from 960 to 640 outer (slow: 120 steps x 20 ms)
      desktop.mouseDrag(f.x + f.w - 1, w.rect.y + 300, f.x + f.w - 1 - 320, w.rect.y + 300, 120, 20);
      await sleep(400);
      const n = await analyse(`narrow ${rep}`, "narrow");
      w = winOf(desktop, hwnd);
      f = visibleFrame(w);
      desktop.mouseDrag(f.x + f.w - 1, w.rect.y + 300, f.x + f.w - 1 + 320, w.rect.y + 300, 120, 20);
      await sleep(400);
      const wd = await analyse(`widen ${rep}`, "widen");
      expect.soft(n.modeTransitions, `narrow ${rep}: exactly one label-mode change`).toBe(1);
      expect.soft(wd.modeTransitions, `widen ${rep}: exactly one label-mode change`).toBe(1);
      expect.soft(n.framesWithDocumentScrollbar, `narrow ${rep}: no document scrollbar frame`).toBe(0);
      expect.soft(wd.framesWithDocumentScrollbar, `widen ${rep}: no document scrollbar frame`).toBe(0);
      expect.soft(n.heightReversals, `narrow ${rep}: toolbar height reversals (${j(n.heightSequence)})`).toBeLessThanOrEqual(1);
      expect.soft(wd.heightReversals, `widen ${rep}: toolbar height reversals (${j(wd.heightSequence)})`).toBeLessThanOrEqual(1);
    }
    // idle: no further layout events (resize loop)
    await readDragRecorder(nw.page);
    await sleep(2000);
    const idle = await readDragRecorder(nw.page);
    console.log("D10 idle after the drags", j({ frameChanges: idle.frames.length, modeMutations: idle.modeMut.length }));
    fs.writeFileSync(path.join(evidenceDir, "d10-drag-640.json"), j({ results, idle }));
    await testInfo.attach("d10-drag.json", { body: j({ results, idle }), contentType: "application/json" });
    expect.soft(idle.frames.length, "no layout change while idle (no resize loop)").toBeLessThanOrEqual(1);
    expect.soft(idle.modeMut.length, "no label-mode change while idle").toBe(0);
  });
});

test.describe("REPORT-008 round 2 (1c) label-mode threshold scan", () => {
  test("CHK2-F17 where the toolbar switches between full and icon-only: 1 px steps narrowing then widening (outer 880 <-> 800 at 125 %)", async ({ desktop, mm, sim }) => {
    test.setTimeout(300_000);
    const a = await liveOne(mm, sim);
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    await focusPoll(mm, a);
    const { nw, hwnd } = await popOutByButton(desktop, mm, a, "A - ");
    const scan = async (list: number[]) => {
      const out: Array<{ outer: number; css: number; toolbarW: number; mode: string | null; h: number }> = [];
      for (const W of list) {
        desktop.moveWindow(hwnd, 100, 60, W, 640);
        const d = Date.now() + 8000;
        while (winOf(desktop, hwnd).rect.w !== W && Date.now() < d) await sleep(30);
        const want = winOf(desktop, hwnd).client.w / dpr;
        let m = await nativeToolbarMetrics(nw.page);
        const d2 = Date.now() + 5000;
        while (Math.abs(m.inner - want) > 1.01 && Date.now() < d2) {
          await sleep(30);
          m = await nativeToolbarMetrics(nw.page);
        }
        // settle: the mode must not change for 300 ms
        await sleep(300);
        m = await nativeToolbarMetrics(nw.page);
        out.push({ outer: W, css: m.inner, toolbarW: m.toolbarW, mode: m.mode, h: m.toolbarH });
      }
      return out;
    };
    desktop.moveWindow(hwnd, 100, 60, 900, 640);
    await expect.poll(() => winOf(desktop, hwnd).rect.w).toBe(900);
    const down = await scan(Array.from({ length: 81 }, (_, i) => 880 - i));
    const up = await scan(Array.from({ length: 81 }, (_, i) => 800 + i));
    const edges = (rows: typeof down) => rows.filter((r, i) => i > 0 && r.mode !== (rows[i - 1] as typeof r).mode).map((r, i, all) => ({ outer: r.outer, toolbarW: r.toolbarW, mode: r.mode, prev: rows[rows.indexOf(r) - 1]?.toolbarW }));
    console.log("D10 threshold down", JSON.stringify(edges(down)));
    console.log("D10 threshold up", JSON.stringify(edges(up)));
    fs.writeFileSync(path.join(evidenceDir, "d10-threshold-scan.json"), JSON.stringify({ dpr, down, up }));
    console.log("D10 threshold sample", JSON.stringify({ down: down.filter((r) => r.outer >= 840 && r.outer <= 860).map((r) => [r.outer, r.toolbarW, r.mode]), up: up.filter((r) => r.outer >= 820 && r.outer <= 860).map((r) => [r.outer, r.toolbarW, r.mode]) }));
  });
});

test.describe("REPORT-008 round 2 (1d) resting inside the threshold band", () => {
  test("CHK2-D10 a window resting at a fixed width between 662 and 674 css px keeps one label mode (no flip-flop)", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    const a = await liveOne(mm, sim);
    await focusPoll(mm, a);
    const { nw, hwnd } = await popOutByButton(desktop, mm, a, "A - ");
    await installDragRecorder(nw.page);
    const rows: Array<Record<string, unknown>> = [];
    for (const W of [840, 846, 848, 850, 852, 854, 856, 858, 860]) {
      desktop.moveWindow(hwnd, 100, 60, W, 640);
      await expect.poll(() => winOf(desktop, hwnd).rect.w).toBe(W);
      await sleep(500);
      await readDragRecorder(nw.page);
      await sleep(2000);
      const log = await readDragRecorder(nw.page);
      const modes = log.modeMut.map((m) => m.mode);
      const row = { outer: W, css: winOf(desktop, hwnd).client.w / 1.25, modeMutationsIn2s: log.modeMut.length, frameChangesIn2s: log.frames.length, lastMode: modes.at(-1) ?? "(none)", heights: [...new Set(log.frames.map((f) => f.h))] };
      rows.push(row);
      console.log("D10 band", JSON.stringify(row));
    }
    fs.writeFileSync(path.join(evidenceDir, "d10-band.json"), JSON.stringify(rows));
    await testInfo.attach("band.json", { body: JSON.stringify(rows), contentType: "application/json" });
    for (const r of rows) expect.soft(r.modeMutationsIn2s, "label-mode changes while resting at outer " + r.outer).toBe(0);
  });
});

test.describe("REPORT-008 round 2 (1b) W1 at its minimum: toolbar clipping and P1 grid", () => {
  test("CHK2-F17 W1 minimum (real drags), connected, Standard 8 polls, traffic collapsed, P1 maximized: toolbar rows, clipped controls, grid rows; widths above the minimum", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(600_000);
    await referenceMap(sim);
    await sim.ctlOk("set holding 20 1 2 3");
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const ids = await createPolls(mm, STANDARD_8);
    await expect(mm.statusLine(ids[0] as number)).toHaveAttribute("data-state", "polling");
    await saveProfileAs(mm, "Plant");
    const w1 = w1Hwnd(desktop);
    const reached = await dragToMinimum(desktop, w1);
    // P1 maximized in the workspace, setup closed
    await focusPoll(mm, ids[0] as number);
    const sub = mm.sub(ids[0] as number);
    if ((await sub.getAttribute("data-state")) !== "maximized") await mm.titleButton(ids[0] as number, /^Maximize/).click();
    await sleep(500);
    await expect(mm.traffic).toHaveCount(0);
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    const tmin = await w1ToolbarMetrics(mm.page);
    const gridSel = `[data-subwindow="${ids[0]}"] [role="grid"][aria-label="Register values"]`;
    const gm = await gridMetrics(mm.page, gridSel);
    const dm = await docMetrics(mm.page, { status: "status-text", view: false });
    console.log("W1 minimum", j({ dpr, reached, tmin, gm, doc: { gutter: dm.gutterX, scrollH: dm.scrollH, clientH: dm.clientH, scrollW: dm.scrollW, clientW: dm.clientW } }));
    fs.writeFileSync(path.join(evidenceDir, "d10-w1-minimum.json"), j({ dpr, reached, tmin, gm, dm }));
    fs.writeFileSync(path.join(evidenceDir, "d10-w1-minimum.png"), await mm.page.screenshot());
    await testInfo.attach("d10-w1-min.png", { body: await mm.page.screenshot(), contentType: "image/png" });
    // wider than the minimum: where does the clipping stop
    const wide: Array<Record<string, unknown>> = [];
    for (const W of [1230, 1250, 1270, 1290, 1310, 1330, 1350, 1370, 1390, 1410, 1430, 1450, 1470, 1500]) {
      desktop.moveWindow(w1, 50, 40, W, 800);
      await expect.poll(() => winOf(desktop, w1).rect.w).toBe(W);
      await sleep(250);
      const t = await w1ToolbarMetrics(mm.page);
      wide.push({ outer: W, inner: t.inner, rows: t.rows, clipped: t.clipped.length, firstClipped: t.clipped[0] ?? "", scrollOver: t.scrollOver, sumChildren: t.sumChildren, contentWidth: t.contentWidth });
    }
    console.log("W1 toolbar widths", j(wide));
    fs.writeFileSync(path.join(evidenceDir, "d10-w1-widths.json"), j(wide));
    const firstOk = wide.find((r) => r.clipped === 0 && (r.scrollOver as number) <= 1);
    console.log("W1 first outer width above the minimum without clipping", j(firstOk ?? null));
    expect.soft(reached.outer, "W1 real drag minimum").toBe("1218x797");
    expect.soft(tmin.rows, "W1 toolbar rows").toBeLessThanOrEqual(2);
    expect.soft(tmin.clipped, `W1 toolbar controls clipped at the minimum (sum of children ${tmin.sumChildren} px, content ${tmin.contentWidth} px)`).toEqual([]);
    expect.soft(tmin.overlaps, "W1 toolbar controls overlapping").toEqual([]);
    expect.soft(tmin.scrollOver, "W1 toolbar scrolls horizontally").toBeLessThanOrEqual(1);
    expect.soft(gm.completeStrict.length, `W1 P1 grid complete rows (${j(gm)})`).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// (2) Thai: Ctrl+\ with focus in the sidebar
// ---------------------------------------------------------------------------------------------------------------------

async function recordKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __k: string[]; __kOn?: boolean };
    w.__k = [];
    if (w.__kOn) return;
    w.__kOn = true;
    window.addEventListener("keydown", (e) => w.__k.push(`${e.ctrlKey ? "C" : ""}${e.shiftKey ? "S" : ""}${e.altKey ? "A" : ""}:${e.key}/${e.code}`), true);
  });
}
const keysSeen = (page: Page) => page.evaluate(() => (window as unknown as { __k: string[] }).__k.splice(0));
async function until(cond: () => Promise<boolean> | boolean, ms = 2500, step = 25): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return Date.now() - t0;
    await sleep(step);
  }
  return null;
}
function restoreLayouts(desktop: Desktop | null): void {
  const target = START_FOREGROUND_LAYOUT === THAI ? THAI : EN;
  try {
    for (const w of desktop?.windows() ?? []) if (layoutOf(w.hwnd).focus !== target) desktop?.setKeyboardLayout(w.hwnd, target);
  } catch {
    /* the app may be gone */
  }
}
async function useLayout(desktop: Desktop, hwnd: number, hkl: string): Promise<void> {
  desktop.showWindow(hwnd, "focus");
  for (let i = 0; i < 25; i += 1) {
    if (layoutOf(hwnd).focus === hkl) return;
    desktop.setKeyboardLayout(hwnd, hkl);
    await sleep(200);
  }
  throw new Error(`could not switch window ${hwnd} to ${hkl} (now ${j(layoutOf(hwnd))})`);
}

test.describe("REPORT-008 round 2 (2) CHK2-R8 backslash shortcuts in the sidebar, Thai and US control", () => {
  test("Ctrl+\\ with focus in the sidebar list collapses/expands the sidebar; Ctrl+Shift+\\ compact mode; key/code pairs (US control first, then Thai)", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const results: Record<string, string> = {};
    try {
      const a = await liveOne(mm, sim);
      const w1 = w1Hwnd(desktop);
      await recordKeys(mm.page);
      const check = (name: string, ok: boolean, extra = "") => {
        results[name] = ok ? `pass${extra ? ` (${extra})` : ""}` : `FAIL${extra ? ` (${extra})` : ""}`;
        expect.soft(ok, `${name} ${extra}`).toBe(true);
      };
      const toSidebar = async () => {
        await mm.row(a).click();
        await mm.row(a).focus();
        const inSidebar = await mm.page.evaluate(() => !!document.activeElement?.closest('[data-slot="sidebar"]'));
        expect(inSidebar, "focus is in the sidebar list").toBe(true);
      };
      for (const [label, hkl] of [["US", EN], ["Thai", THAI]] as const) {
        await useLayout(desktop, w1, hkl);
        await keysSeen(mm.page);
        await toSidebar();
        desktop.nativeKey(w1, "ctrl+backslash", { keepLayout: true });
        check(`${label}: Ctrl+\\ in the sidebar collapses it to the rail`, (await until(() => mm.rail.isVisible(), 2500)) !== null, `keys ${(await keysSeen(mm.page)).join(",")}`);
        await mm.row(a).count();
        // focus is on the rail now; Ctrl+\ expands again
        desktop.nativeKey(w1, "ctrl+backslash", { keepLayout: true });
        check(`${label}: Ctrl+\\ again expands it`, (await until(async () => !(await mm.rail.isVisible()), 2500)) !== null, `keys ${(await keysSeen(mm.page)).join(",")}`);
        await toSidebar();
        desktop.nativeKey(w1, "ctrl+shift+backslash", { keepLayout: true });
        check(`${label}: Ctrl+Shift+\\ in the sidebar switches compact mode on`, (await until(() => mm.rail.isVisible(), 2500)) !== null, `keys ${(await keysSeen(mm.page)).join(",")}`);
        desktop.nativeKey(w1, "ctrl+shift+backslash", { keepLayout: true });
        check(`${label}: Ctrl+Shift+\\ again switches it off`, (await until(async () => !(await mm.rail.isVisible()), 2500)) !== null, `keys ${(await keysSeen(mm.page)).join(",")}`);
        // sub-window setup, focus in the grid
        await focusPoll(mm, a);
        await mm.gridRow(a, 3).click();
        desktop.nativeKey(w1, "ctrl+backslash", { keepLayout: true });
        check(`${label}: Ctrl+\\ with focus in P1's grid opens the setup`, (await until(() => mm.setup(a).isVisible(), 2500)) !== null, `keys ${(await keysSeen(mm.page)).join(",")}`);
        await mm.gridRow(a, 3).click().catch(() => undefined);
        await mm.grid(a).focus();
        desktop.nativeKey(w1, "ctrl+backslash", { keepLayout: true });
        check(`${label}: Ctrl+\\ again closes it`, (await until(async () => !(await mm.setup(a).isVisible()), 2500)) !== null, `keys ${(await keysSeen(mm.page)).join(",")}`);
      }
    } finally {
      restoreLayouts(desktop);
      console.log("THAI SIDEBAR", j(results));
      console.log("THAI SIDEBAR foreground after restore", j(layoutOf(fgHwnd())));
      await testInfo.attach("thai-sidebar.json", { body: j(results), contentType: "application/json" });
    }
  });
});

void (null as unknown as DocMetrics);
