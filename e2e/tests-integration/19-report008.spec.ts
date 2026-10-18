// REPORT-008: targeted integration re-run after the REPORT-007 fixes (D6 to D9) and the D3 oracle change.
//   (1) CHK2-F17 / D6 no document scrollbar in native windows, W1 and the launcher at their minimum
//   (2) CHK2-K5 / K8 (b) / D7 "Show traffic for this poll" from a native window raises W1 and focuses the Filter select (5 runs per variant)
//   (3) CHK2-R8 / D8 Thai layout with hardware input (the only non-Latin layout installed on this machine)
//   (4) CHK2-F8 / F16 / D9 focus after a failed pop out and dock (dev-hooks build only)
//   (5) CHK2-D3 with the simulator built with --features dev-sim-slave/os-timer
// Binary: ESEFACT_APP_EXE + ESEFACT_BINARY_LABEL (normal | hooks). Simulator: ESEFACT_SIM_EXE (D3 uses the os-timer build).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Page } from "@playwright/test";
import { type Desktop, expect, type RealMm, RealNative, test } from "../integration/fixtures";
import { ensureWinHelper, type NativeWindow } from "../integration/desktop";
import { openProfile, profileV2, profilesDir, saveProfileAs, writeProfile, type PollProfileSpec } from "../integration/profiles";
import { gridState, invokeIn } from "../integration/real-mm";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";
import { diffs, focusFingerprint, hwClick, hwndByTitle, SCAN_SECONDS, sleep, visibleFrame } from "../integration/qa7";
import type { Sim } from "../integration/sim";

const K5_RUNS = Number(process.env.K5_RUNS ?? 5);
const LABEL = process.env.ESEFACT_BINARY_LABEL ?? "default";
const winTool = (args: string[]) => execFileSync(ensureWinHelper(), args, { encoding: "utf8", timeout: 20_000 }).trim();
const zAbove = (a: number, b: number) => winTool(["above", String(a), String(b)]) === "true";
const layoutOf = (hwnd: number) => JSON.parse(winTool(["layout", String(hwnd)])) as { top: string; focus: string; hwndFocus: number };
const fgHwnd = () => Number(winTool(["foreground"]));
const THAI = "041E041E";
const EN = "04090409";
/** The input language that was active in the foreground window when the QA run started (restored at the end of every layout test). */
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

// ---------------------------------------------------------------------------------------------------------------------
// (1) CHK2-F17
// ---------------------------------------------------------------------------------------------------------------------

interface DocMetrics {
  inner: number;
  innerH: number;
  clientW: number;
  clientH: number;
  scrollW: number;
  scrollH: number;
  gutterX: number;
  gutterY: number;
  viewOffsetWidth: number | null;
  viewExactWidth: number | null;
  statusTextH: number | null;
  versionH: number | null;
  footerH: number | null;
  statusCut: boolean | null;
  statusTitle: string | null;
  statusText: string | null;
  statusOverflow: string | null;
  versionText: string | null;
  versionCut: boolean | null;
  versionRightInFooter: boolean | null;
}

async function docMetrics(page: Page, o: { status: string | null; view: boolean }): Promise<DocMetrics> {
  return page.evaluate(
    async ({ status, view }) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const de = document.documentElement;
      const st = status ? (document.querySelector(`[data-testid="${status}"]`) as HTMLElement | null) : null;
      const ver = document.querySelector('[data-testid="app-version"]') as HTMLElement | null;
      const foot = document.querySelector('footer[data-region="status"]') as HTMLElement | null;
      const pv = view ? (document.querySelector('[data-slot="poll-view"]') as HTMLElement | null) : null;
      const h = (e: HTMLElement | null) => (e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : null);
      return {
        inner: window.innerWidth,
        innerH: window.innerHeight,
        clientW: de.clientWidth,
        clientH: de.clientHeight,
        scrollW: de.scrollWidth,
        scrollH: de.scrollHeight,
        gutterX: window.innerWidth - de.clientWidth,
        gutterY: window.innerHeight - de.clientHeight,
        viewOffsetWidth: pv ? pv.offsetWidth : null,
        viewExactWidth: pv ? Math.round(pv.getBoundingClientRect().width * 100) / 100 : null,
        statusTextH: h(st),
        versionH: h(ver),
        footerH: h(foot),
        statusCut: st ? st.scrollWidth > st.clientWidth : null,
        statusTitle: st ? st.getAttribute("title") : null,
        statusText: st ? st.textContent : null,
        statusOverflow: st ? `${getComputedStyle(st).textOverflow}/${getComputedStyle(st).overflow}/${getComputedStyle(st).whiteSpace}` : null,
        versionText: ver ? ver.textContent : null,
        versionCut: ver ? ver.scrollWidth > ver.clientWidth : null,
        versionRightInFooter: ver && foot ? ver.getBoundingClientRect().right <= foot.getBoundingClientRect().right + 0.5 : null,
      };
    },
    { status: o.status, view: o.view },
  );
}

/** The CHK2-F17 checks for one measurement. Returns the failures (empty = pass). */
function f17Failures(m: DocMetrics, base: { statusH: number | null; versionH: number | null }, o: { view: boolean; footer28: boolean }): string[] {
  const f: string[] = [];
  if (m.scrollH !== m.clientH) f.push(`scrollHeight ${m.scrollH} != clientHeight ${m.clientH}`);
  if (m.scrollW !== m.clientW) f.push(`scrollWidth ${m.scrollW} != clientWidth ${m.clientW}`);
  if (m.gutterX !== 0) f.push(`vertical scrollbar gutter ${m.gutterX} px`);
  if (m.gutterY !== 0) f.push(`horizontal scrollbar gutter ${m.gutterY} px`);
  if (o.view && m.viewOffsetWidth !== m.clientW) f.push(`PollView offsetWidth ${m.viewOffsetWidth} != client width ${m.clientW} (exact ${m.viewExactWidth})`);
  if (base.statusH !== null && m.statusTextH !== null && Math.abs(m.statusTextH - base.statusH) > 0.5) f.push(`status text height ${m.statusTextH} != one line ${base.statusH} (wrapped)`);
  if (base.versionH !== null && m.versionH !== null && Math.abs(m.versionH - base.versionH) > 0.5) f.push(`version label height ${m.versionH} != one line ${base.versionH} (wrapped)`);
  if (o.footer28 && m.footerH !== 28) f.push(`status bar height ${m.footerH} != 28`);
  if (m.statusCut === true) {
    if (m.statusTitle !== m.statusText) f.push(`status text is cut but its title is ${JSON.stringify(m.statusTitle)} not the complete text`);
    if (!(m.statusOverflow ?? "").startsWith("ellipsis")) f.push(`status text is cut without text-overflow: ellipsis (${m.statusOverflow})`);
  } else if (m.statusCut === false && m.statusTitle) {
    f.push(`status text fits but has a title ${JSON.stringify(m.statusTitle)} (the title must appear only when cut)`);
  }
  if (m.versionText !== null && !/^ESEfact v\d/.test(m.versionText)) f.push(`version label text ${JSON.stringify(m.versionText)}`);
  if (m.versionCut === true) f.push("version label is cut");
  if (m.versionRightInFooter === false) f.push("version label sticks out of the status bar");
  return f;
}

async function dragToMinimum(desktop: Desktop, hwnd: number): Promise<{ outer: string; client: string }> {
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
  return { outer: `${w.rect.w}x${w.rect.h}`, client: `${w.client.w}x${w.client.h}` };
}

test.describe("REPORT-008 (1) CHK2-F17 no document scrollbar (D6)", () => {
  test("CHK2-F17 native window sweep: outer width 900 -> 600 physical at outer heights 640 and 400; grid rows, setup popover and screenshot at 600 x 400", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(600_000);
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
    console.log("F17 setup at 900 x 640", JSON.stringify({ dpr, base, m0 }));
    expect(m0.statusText ?? "", "status text at 900").toMatch(/^Last OK .* · Round trip .* · Resp .* · Timeouts /);
    const widths = [...Array.from({ length: 21 }, (_, i) => 900 - 10 * i), ...Array.from({ length: 100 }, (_, i) => 699 - i)];
    const table: Array<Record<string, unknown>> = [];
    const failures: string[] = [];
    let cutSteps = 0;
    for (const H of [640, 400]) {
      for (const W of widths) {
        desktop.moveWindow(hwnd, 100, 60, W, H);
        const deadline = Date.now() + 8000;
        let w = winOf(desktop, hwnd);
        while ((w.rect.w !== W || w.rect.h !== H) && Date.now() < deadline) {
          await sleep(30);
          w = winOf(desktop, hwnd);
        }
        // wait until the page layout follows the client size (the resize event reaches the webview)
        const wantInner = w.client.w / dpr;
        let m = await docMetrics(nw.page, O);
        const d2 = Date.now() + 5000;
        while (Math.abs(m.inner - wantInner) > 1.01 && Date.now() < d2) {
          await sleep(30);
          m = await docMetrics(nw.page, O);
        }
        const fl = f17Failures(m, base, { view: true, footer28: true });
        if (m.statusCut) cutSteps += 1;
        table.push({ H, outer: `${w.rect.w}x${w.rect.h}`, inner: m.inner, client: m.clientW, view: m.viewOffsetWidth, scrollH: m.scrollH, clientH: m.clientH, gutter: m.gutterX, statusH: m.statusTextH, versionH: m.versionH, footerH: m.footerH, cut: m.statusCut });
        if (w.rect.w !== W || w.rect.h !== H) fl.push(`window is ${w.rect.w}x${w.rect.h}, wanted ${W}x${H}`);
        if (fl.length) failures.push(`outer ${W}x${H} (inner ${m.inner}): ${fl.join("; ")}`);
      }
    }
    fs.writeFileSync(path.join(evidenceDir, "f17-native-sweep.json"), JSON.stringify({ dpr, base, table }, null, 1));
    await testInfo.attach("f17-sweep.json", { body: JSON.stringify({ dpr, base, table }), contentType: "application/json" });
    console.log("F17 sweep steps", table.length, "failures", failures.length, "steps with cut status text", cutSteps);
    console.log("F17 sample rows", JSON.stringify([table[0], table[20], table[21], table[60], table[120], table[121], table[141], table[200], table.at(-1)]));
    if (failures.length) console.log("F17 FAILURES", failures.slice(0, 12).join(" || "));

    // at 600 x 400 now
    const wMin = winOf(desktop, hwnd);
    const mMin = await docMetrics(nw.page, O);
    console.log("F17 at the minimum", JSON.stringify({ outer: `${wMin.rect.w}x${wMin.rect.h}`, client: `${wMin.client.w}x${wMin.client.h}`, mMin }));
    const rowsInfo = await nw.grid.evaluate((g) => {
      const gr = g.getBoundingClientRect();
      const rows = [...g.querySelectorAll('[role="row"][data-row]')] as HTMLElement[];
      const complete = rows.filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top >= gr.top - 0.5 && b.bottom <= gr.bottom + 0.5;
      });
      return { gridH: Math.round(gr.height), rendered: rows.length, complete: complete.map((r) => Number(r.dataset.row)), scrollable: g.scrollHeight > g.clientHeight + 1 };
    });
    console.log("F17 grid rows at 600 x 400", JSON.stringify(rowsInfo));
    fs.writeFileSync(path.join(evidenceDir, "f17-native-600x400.png"), await nw.page.screenshot());
    // wheel and End reach address 9
    await nw.grid.hover();
    await nw.page.mouse.wheel(0, 2000);
    await expect.poll(() => nw.grid.locator('[data-row="9"]').count(), { message: "wheel reaches row 9" }).toBeGreaterThan(0);
    const lastByWheel = await nw.grid.evaluate((g) => {
      const r = g.querySelector('[data-row="9"]') as HTMLElement;
      const gr = g.getBoundingClientRect();
      const b = r.getBoundingClientRect();
      return { bottomInside: b.bottom <= gr.bottom + 0.5, top: Math.round(b.top - gr.top) };
    });
    await nw.grid.evaluate((g) => {
      g.scrollTop = 0;
    });
    await nw.gridRow(0).click();
    await nw.page.keyboard.press("End");
    const lastByEnd = await nw.grid.evaluate((g) => {
      const r = g.querySelector('[data-row="9"]') as HTMLElement | null;
      const gr = g.getBoundingClientRect();
      const b = r?.getBoundingClientRect();
      return { exists: !!r, bottomInside: b ? b.bottom <= gr.bottom + 0.5 : false, activedescendant: g.getAttribute("aria-activedescendant") };
    });
    console.log("F17 wheel / End", JSON.stringify({ lastByWheel, lastByEnd }));
    // the setup popover at the minimum
    await nw.grid.evaluate((g) => {
      g.scrollTop = 0;
    });
    await nw.rail.click();
    const pop = nw.page.locator('[data-slot="setup-popover"]');
    await expect(pop).toBeVisible();
    await sleep(300);
    const mPop = await docMetrics(nw.page, O);
    const popInfo = await pop.evaluate((p) => {
      const before = { sh: p.scrollHeight, ch: p.clientHeight };
      p.scrollTop = p.scrollHeight;
      const buttons = [...p.querySelectorAll("button, input, select")] as HTMLElement[];
      const last = buttons.at(-1) as HTMLElement;
      const pr = p.getBoundingClientRect();
      const lr = last.getBoundingClientRect();
      return { before, scrollTopAfter: p.scrollTop, lastControl: last.getAttribute("aria-label") ?? last.textContent?.trim() ?? last.tagName, lastVisible: lr.bottom <= pr.bottom + 1 && lr.top >= pr.top - 1 };
    });
    console.log("F17 popover at the minimum", JSON.stringify({ doc: f17Failures(mPop, base, { view: true, footer28: true }), popInfo }));
    fs.writeFileSync(path.join(evidenceDir, "f17-native-600x400-popover.png"), await nw.page.screenshot());
    await nw.page.keyboard.press("Escape");
    await testInfo.attach("f17-600x400.png", { body: await nw.page.screenshot(), contentType: "image/png" });

    expect(failures, `CHK2-F17 failures in the sweep (${failures.length} of ${table.length} steps)`).toEqual([]);
    expect.soft(`${wMin.rect.w}x${wMin.rect.h}`, "outer size at the end of the sweep").toBe("600x400");
    expect.soft(rowsInfo.complete.length, `at least 3 complete data rows at 600 x 400 (${JSON.stringify(rowsInfo)})`).toBeGreaterThanOrEqual(3);
    expect.soft(lastByWheel.bottomInside, "mouse wheel brings row 9 fully into view").toBe(true);
    expect.soft(lastByEnd.bottomInside, "End brings row 9 fully into view").toBe(true);
    expect.soft(f17Failures(mPop, base, { view: true, footer28: true }), "document checks with the setup popover open at 600 x 400").toEqual([]);
    expect.soft(popInfo.lastVisible, "the popover scrolls inside itself to its last control").toBe(true);
  });

  test("CHK2-F17 W1 at its minimum outer size (real edge drags): one-line status bar, no document scrollbar", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(180_000);
    await liveOne(mm, sim);
    const O = { status: "status-text", view: false } as const;
    const m0 = await docMetrics(mm.page, O);
    const base = { statusH: m0.statusTextH, versionH: m0.versionH };
    const w1 = w1Hwnd(desktop);
    const reached = await dragToMinimum(desktop, w1);
    await sleep(500);
    const m = await docMetrics(mm.page, O);
    const fl = f17Failures(m, base, { view: false, footer28: true });
    console.log("F17 W1 minimum", JSON.stringify({ base, reached, m, failures: fl }));
    fs.writeFileSync(path.join(evidenceDir, "f17-w1-minimum.png"), await mm.page.screenshot());
    await testInfo.attach("f17-w1-min.png", { body: await mm.page.screenshot(), contentType: "image/png" });
    expect(fl, `W1 at ${reached.outer}`).toEqual([]);
    // the grid / toolbar are not part of this item; only the document checks
  });

  test("CHK2-F17 launcher at its minimum size (real edge drags): no document scrollbar, version label on one line", async ({ desktop, launcher }, testInfo) => {
    test.setTimeout(180_000);
    const lw = hwndByTitle(desktop, "ESEfact");
    const O = { status: null, view: false } as const;
    const m0 = await docMetrics(launcher, O);
    const base = { statusH: null, versionH: m0.versionH };
    const reached = await dragToMinimum(desktop, lw);
    await sleep(500);
    const m = await docMetrics(launcher, O);
    const inner = await launcher.evaluate(() => {
      const box = document.querySelector("#root > div") as HTMLElement | null;
      return box ? { box: `${box.clientWidth}x${box.clientHeight}`, scrollbarInsideBox: box.offsetWidth - box.clientWidth, scrollsInside: box.scrollHeight > box.clientHeight } : null;
    });
    const fl = f17Failures(m, base, { view: false, footer28: false });
    console.log("F17 launcher minimum", JSON.stringify({ base, reached, m, inner, failures: fl }));
    fs.writeFileSync(path.join(evidenceDir, "f17-launcher-minimum.png"), await launcher.screenshot());
    await testInfo.attach("f17-launcher-min.png", { body: await launcher.screenshot(), contentType: "image/png" });
    expect(fl, `launcher at ${reached.outer}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// (2) CHK2-K5 / K8 (b)
// ---------------------------------------------------------------------------------------------------------------------

test.describe("REPORT-008 (2) CHK2-K5 / K8(b) Show traffic for this poll from a native window (D7)", () => {
  test("Poll 2 popped out; W1 minimized (5 runs) and W1 behind the native window (5 runs): restored, foreground, above, panel expanded, filter Poll 2, Filter select focused", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(420_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const [p1, p2] = await createPolls(mm, [
      { name: "Poll 1", slave: 1, fc: 3, start: 0, qty: 10, scan: 100 },
      { name: "Poll 2", slave: 1, fc: 3, start: 10, qty: 10, scan: 100 },
    ]);
    await expect(mm.statusLine(p2 as number)).toHaveAttribute("data-state", "polling");
    const w1 = w1Hwnd(desktop);
    await focusPoll(mm, p2 as number);
    const { nw, hwnd: w2 } = await popOutByButton(desktop, mm, p2 as number, "Poll 2 - ");
    // Playwright (connectOverCDP) enables Emulation.setFocusEmulationEnabled on every page it drives, so document.hasFocus() is always true
    // there. A real user has no emulation: the frontend decides on document.hasFocus() as the event arrives. Switch the emulation off for
    // both pages (the sessions stay open) and prove that hasFocus() now follows the OS foreground window.
    const cdpSessions = [await mm.page.context().newCDPSession(mm.page), await mm.page.context().newCDPSession(nw.page)];
    for (const c of cdpSessions) await c.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    desktop.showWindow(w2, "focus");
    await expect.poll(() => fgHwnd()).toBe(w2);
    const probe = { w2Foreground: { w1HasFocus: await mm.page.evaluate(() => document.hasFocus()), w2HasFocus: await nw.page.evaluate(() => document.hasFocus()) } };
    desktop.showWindow(w1, "focus");
    await expect.poll(() => fgHwnd()).toBe(w1);
    await mm.grid(p1 as number).focus();
    (probe as Record<string, unknown>).w1Foreground = { w1HasFocus: await mm.page.evaluate(() => document.hasFocus()), w2HasFocus: await nw.page.evaluate(() => document.hasFocus()) };
    console.log("K5 focus emulation probe", JSON.stringify(probe));
    const filter = mm.traffic.getByRole("combobox", { name: "Traffic filter" });
    // page-side timeline: focus/blur of W1's document and the moment the panel and the focus appear
    await mm.page.evaluate(() => {
      const w = window as unknown as { __tl: Array<{ ev: string; at: number; hasFocus: boolean }>; __tlOn?: boolean };
      w.__tl = [];
      if (w.__tlOn) return;
      w.__tlOn = true;
      const push = (ev: string) => w.__tl.push({ ev, at: Date.now(), hasFocus: document.hasFocus() });
      window.addEventListener("focus", () => push("window-focus"));
      window.addEventListener("blur", () => push("window-blur"));
      new MutationObserver(() => {
        const panel = document.querySelector('[data-testid="traffic-panel"]');
        const sel = document.querySelector('[aria-label="Traffic filter"]');
        const state = `${panel ? "panel" : "nopanel"}${sel && document.activeElement === sel ? "+selectfocus" : ""}`;
        const last = w.__tl.filter((e) => e.ev.startsWith("dom:")).at(-1);
        if (!last || last.ev !== `dom:${state}`) push(`dom:${state}`);
      }).observe(document.body, { childList: true, subtree: true, attributes: true });
      document.addEventListener("focusin", (e) => {
        if ((e.target as HTMLElement).getAttribute?.("aria-label") === "Traffic filter") push("focusin:filter");
      });
    });
    const resetPanel = async () => {
      desktop.showWindow(w1, "focus");
      await expect.poll(() => winOf(desktop, w1).iconic).toBe(false);
      if (!(await mm.traffic.isVisible())) await mm.expandTraffic();
      await filter.selectOption({ label: "All polls" });
      await mm.traffic.getByRole("button", { name: "Collapse traffic panel" }).click();
      await expect(mm.traffic).toHaveCount(0);
      await mm.grid(p1 as number).focus();
      await mm.page.evaluate(() => ((window as unknown as { __tl: unknown[] }).__tl.length = 0));
    };
    const rows: Array<Record<string, unknown>> = [];
    for (const variant of ["minimized", "behind"] as const) {
      for (let run = 1; run <= K5_RUNS; run += 1) {
        await resetPanel();
        // put the window states
        if (variant === "minimized") {
          desktop.showWindow(w1, "min");
          await expect.poll(() => winOf(desktop, w1).iconic).toBe(true);
          desktop.showWindow(w2, "focus");
        } else {
          desktop.moveWindow(w2, 420, 220, 900, 640);
          desktop.showWindow(w2, "focus");
        }
        await expect.poll(() => fgHwnd(), { message: "the native window is the foreground window" }).toBe(w2);
        const pre = { w1Iconic: winOf(desktop, w1).iconic, w2AboveW1: variant === "behind" ? zAbove(w2, w1) : null, w1HasFocus: variant === "behind" ? await mm.page.evaluate(() => document.hasFocus()) : null };
        // real mouse: menu button, then the entry
        await hwClick(desktop, w2, nw.page, nw.page.getByRole("button", { name: "Poll actions" }));
        const item = nw.page.getByRole("menuitem", { name: /^Show traffic for this poll/ });
        await expect(item).toBeVisible();
        const t0 = Date.now();
        await hwClick(desktop, w2, nw.page, item);
        const tClick = Date.now();
        const seen: { restored: number | null; foreground: number | null; panel: number | null; filter: number | null; focus: number | null } = { restored: null, foreground: null, panel: null, filter: null, focus: null };
        let last: Record<string, unknown> = {};
        while (Date.now() - tClick < 1500) {
          const w = winOf(desktop, w1);
          const s = await mm.page.evaluate(() => {
            const sel = document.querySelector('[aria-label="Traffic filter"]') as HTMLSelectElement | null;
            return { panel: !!document.querySelector('[data-testid="traffic-panel"]'), filterText: sel ? (sel.selectedOptions[0]?.textContent ?? "") : null, selectFocused: !!sel && document.activeElement === sel, activeTag: document.activeElement?.tagName ?? "none", hasFocus: document.hasFocus() };
          });
          const el = Date.now() - tClick;
          if (!w.iconic && seen.restored === null) seen.restored = el;
          if (w.foreground && seen.foreground === null) seen.foreground = el;
          if (s.panel && seen.panel === null) seen.panel = el;
          if (s.filterText === "Poll 2" && seen.filter === null) seen.filter = el;
          if (s.selectFocused && seen.focus === null) seen.focus = el;
          last = { ...s, iconic: w.iconic, foreground: w.foreground };
          if (Object.values(seen).every((v) => v !== null) && el > 400) break;
        }
        await sleep(300);
        const wEnd = winOf(desktop, w1);
        const above = zAbove(w1, w2);
        const final = await mm.page.evaluate(() => {
          const sel = document.querySelector('[aria-label="Traffic filter"]') as HTMLSelectElement | null;
          return { panel: !!document.querySelector('[data-testid="traffic-panel"]'), filterText: sel ? (sel.selectedOptions[0]?.textContent ?? "") : null, selectFocused: !!sel && document.activeElement === sel, activeTag: document.activeElement?.tagName ?? "none", activeLabel: (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? "" };
        });
        const tl = await mm.page.evaluate(() => (window as unknown as { __tl: Array<{ ev: string; at: number; hasFocus: boolean }> }).__tl.map((e) => ({ ev: e.ev, dt: e.at - 0, hasFocus: e.hasFocus })));
        const t0abs = tClick;
        const tlRel = tl.map((e) => `${e.ev}@${e.dt - t0abs}ms(hasFocus=${e.hasFocus})`);
        const w2Updating = await nw.grid.getAttribute("data-status");
        const ok = { restored: !wEnd.iconic && seen.restored !== null && seen.restored <= 1000, foreground: wEnd.foreground && seen.foreground !== null && seen.foreground <= 1000, above, panel: final.panel, filter: final.filterText === "Poll 2", focus: final.selectFocused };
        const row = { variant, run, pre, clickToDone: Date.now() - t0, seen, final, wEnd: { iconic: wEnd.iconic, foreground: wEnd.foreground }, ok, w2Open: !!hwndByTitleSafe(desktop, "Poll 2 - "), w2Status: w2Updating, timeline: tlRel };
        rows.push(row);
        console.log("K5", JSON.stringify(row));
      }
    }
    await testInfo.attach("k5-runs.json", { body: JSON.stringify(rows, null, 1), contentType: "application/json" });
    fs.writeFileSync(path.join(evidenceDir, "k5-runs.json"), JSON.stringify(rows, null, 1));
    const rate = (variant: string, key: string) => rows.filter((r) => r.variant === variant && (r.ok as Record<string, boolean>)[key]).length;
    for (const variant of ["minimized", "behind"]) {
      console.log("K5 RATE", variant, JSON.stringify(Object.fromEntries(["restored", "foreground", "above", "panel", "filter", "focus"].map((k) => [k, `${rate(variant, k)}/${K5_RUNS}`]))));
    }
    for (const variant of ["minimized", "behind"]) {
      for (const key of ["restored", "foreground", "above", "panel", "filter"]) expect.soft(rate(variant, key), `K5 ${variant}: ${key} in 5 runs`).toBe(K5_RUNS);
      expect.soft(rate(variant, "focus"), `K5 ${variant}: the Filter select has the focus in ${K5_RUNS} runs`).toBe(K5_RUNS);
    }
    expect(rows.every((r) => r.w2Open), "the native window stays open").toBe(true);
  });
});
const hwndByTitleSafe = (d: Desktop, p: string) => hwndByTitle(d, p);

// ---------------------------------------------------------------------------------------------------------------------
// (3) CHK2-R8 Thai layout (the only non-Latin layout installed)
// ---------------------------------------------------------------------------------------------------------------------

const Thai = {
  async use(desktop: Desktop, hwnd: number): Promise<void> {
    desktop.showWindow(hwnd, "focus");
    for (let i = 0; i < 25; i += 1) {
      if (layoutOf(hwnd).focus === THAI) return;
      desktop.setKeyboardLayout(hwnd, THAI);
      await sleep(200);
    }
    throw new Error(`could not switch window ${hwnd} to the Thai layout (now ${JSON.stringify(layoutOf(hwnd))})`);
  },
  async key(desktop: Desktop, hwnd: number, chord: string): Promise<void> {
    if (layoutOf(hwnd).focus !== THAI) await Thai.use(desktop, hwnd);
    desktop.nativeKey(hwnd, chord, { keepLayout: true });
  },
};

/** Puts every ESEfact window and the foreground window back to the language that was active at the start. */
function restoreLayouts(desktop: Desktop | null): void {
  const target = START_FOREGROUND_LAYOUT === THAI ? THAI : EN;
  try {
    for (const w of desktop?.windows() ?? []) {
      if (layoutOf(w.hwnd).focus !== target) desktop?.setKeyboardLayout(w.hwnd, target);
    }
  } catch {
    /* the app may be gone */
  }
}

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

test.describe("REPORT-008 (3) CHK2-R8 shortcuts with the Thai layout active (D8), hardware input", () => {
  test("W1: Ctrl+P, Ctrl+E, Ctrl+J, Ctrl+S, F6, Ctrl+Shift+N, Ctrl+Shift+O, Ctrl+\\, Ctrl+Shift+\\ (and Ctrl+Shift+P, Ctrl+1/3)", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    const results: Record<string, string> = {};
    const log: string[] = [`start foreground layout ${START_FOREGROUND_LAYOUT}`];
    try {
      const a = await liveOne(mm, sim, "A", 10);
      const [c] = await createPolls(mm, [{ name: "C", slave: 1, fc: 3, start: 20, qty: 5, scan: 100 }]);
      await referenceMap(sim);
      await saveProfileAs(mm, "Plant");
      expect(await mm.modified()).toBe(false);
      const w1 = w1Hwnd(desktop);
      await recordKeys(mm.page);
      const state = () => mm.statusLine(a).getAttribute("data-state");
      const toGrid = async () => {
        await focusPoll(mm, a);
        await mm.gridRow(a, 3).click();
      };
      const check = (name: string, ok: boolean, extra = "") => {
        results[name] = ok ? `pass${extra ? ` (${extra})` : ""}` : `FAIL${extra ? ` (${extra})` : ""}`;
        expect.soft(ok, `Thai layout: ${name} ${extra}`).toBe(true);
      };

      // F6 with US English first (control), then Thai
      const region = () => mm.page.evaluate(() => (document.activeElement?.closest("[data-region]") as HTMLElement | null)?.dataset.region ?? "none");
      await toGrid();
      desktop.ensureEnglishLayout(w1);
      const r0 = await region();
      desktop.nativeKey(w1, "f6");
      await until(async () => (await region()) !== r0, 3000);
      const f6en = `${r0}->${await region()}`;
      await keysSeen(mm.page);

      await Thai.use(desktop, w1);
      log.push(`W1 layout ${JSON.stringify(layoutOf(w1))}`);
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+p");
      const tp = await until(async () => (await state()) === "paused", 2500);
      const seenP = await keysSeen(mm.page);
      log.push(`Ctrl+P keys seen: ${JSON.stringify(seenP)}`);
      check("Ctrl+P pauses within 500 ms", tp !== null && tp <= 500, `${tp} ms; page received ${seenP.join(",")}`);
      await sleep(250);
      const m = sim.mark();
      await sleep(400);
      check("Ctrl+P: no further request for A", sim.requestsDecoded(m).filter((r) => r.unit === 1 && r.addr === 0).length === 0);
      await Thai.key(desktop, w1, "ctrl+p");
      check("second Ctrl+P resumes", (await until(async () => (await state()) === "polling", 2500)) !== null);

      await toGrid();
      await Thai.key(desktop, w1, "ctrl+e");
      check("Ctrl+E opens the Write dialog", (await until(() => mm.writeDialog.isVisible(), 2500)) !== null, (await mm.writeDialog.isVisible()) ? (await mm.writeDialog.innerText()).split("\n")[0] ?? "" : "");
      await Thai.key(desktop, w1, "esc");
      check("Esc closes the Write dialog", (await until(async () => !(await mm.writeDialog.isVisible()), 2500)) !== null);

      await toGrid();
      await Thai.key(desktop, w1, "ctrl+j");
      check("Ctrl+J expands the traffic panel", (await until(() => mm.traffic.isVisible(), 2500)) !== null);
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+j");
      check("Ctrl+J again collapses it", (await until(async () => !(await mm.traffic.isVisible()), 2500)) !== null);

      // Ctrl+S on a modified named profile
      await focusPoll(mm, c as number);
      await mm.titleButton(c as number, /^Poll setup/).click();
      await mm.setupField(c as number, "Name").fill("C2");
      await mm.setup(c as number).getByRole("button", { name: "Apply", exact: true }).click();
      await expect(mm.row(c as number)).toContainText("C2");
      await expect.poll(() => mm.modified()).toBe(true);
      const file = path.join(profilesDir(desktop), "Plant.json");
      const mtime0 = fs.statSync(file).mtimeMs;
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+s");
      const saved = await until(async () => !(await mm.modified()), 4000);
      const mtime1 = fs.statSync(file).mtimeMs;
      check("Ctrl+S saves without a dialog and clears Modified", saved !== null && !(await mm.saveAsDialog.isVisible()) && mtime1 > mtime0, `modified cleared after ${saved} ms, file mtime changed ${mtime1 > mtime0}`);

      // F6
      await toGrid();
      const rr0 = await region();
      await Thai.key(desktop, w1, "f6");
      await until(async () => (await region()) !== rr0, 3000);
      const f6th = `${rr0}->${await region()}`;
      check("F6 moves to the next region as with US English", f6th === f6en && rr0 !== (await region()), `US ${f6en}, Thai ${f6th}`);

      // Ctrl+Shift+N
      const before = (await mm.ids()).length;
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+shift+n");
      check("Ctrl+Shift+N creates a poll", (await until(async () => (await mm.ids()).length === before + 1, 3000)) !== null, `keys ${(await keysSeen(mm.page)).slice(-1).join(",")}`);
      const created = (await mm.ids()).find((i) => ![a, c].includes(i));
      if (created !== undefined) {
        await mm.row(created).click();
        await mm.row(created).focus();
        await mm.page.keyboard.press("Delete");
        await mm.confirm.getByRole("button", { name: "Delete", exact: true }).click();
        await expect.poll(async () => (await mm.ids()).length).toBe(before);
      }

      // Ctrl+\ and Ctrl+Shift+\
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+backslash");
      check("Ctrl+\\ opens the setup of the poll", (await until(() => mm.setup(a).isVisible(), 2500)) !== null, `keys ${(await keysSeen(mm.page)).slice(-1).join(",")}`);
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+backslash");
      check("Ctrl+\\ again closes it", (await until(async () => !(await mm.setup(a).isVisible()), 2500)) !== null);
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+shift+backslash");
      check("Ctrl+Shift+\\ switches compact mode on", (await until(() => mm.rail.isVisible(), 2500)) !== null, `keys ${(await keysSeen(mm.page)).slice(-1).join(",")}`);
      await Thai.key(desktop, w1, "ctrl+shift+backslash");
      check("Ctrl+Shift+\\ again switches it off", (await until(async () => !(await mm.rail.isVisible()), 2500)) !== null);

      // spot checks
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+shift+p");
      check("Ctrl+Shift+P pauses all", (await until(() => mm.toolbarButton("Resume all").isVisible(), 2500)) !== null);
      await Thai.key(desktop, w1, "ctrl+shift+p");
      check("Ctrl+Shift+P resumes all", (await until(() => mm.toolbarButton("Pause all").isVisible(), 2500)) !== null);

      // Ctrl+Shift+O pops out, then Ctrl+Shift+D in the native window docks (below)
      await toGrid();
      await Thai.key(desktop, w1, "ctrl+shift+o");
      const popped = await until(() => hwndByTitle(desktop, "A - ") !== 0, 6000, 100);
      check("Ctrl+Shift+O pops the poll out to a native window", popped !== null, `keys ${(await keysSeen(mm.page)).slice(-1).join(",")}`);
      if (popped !== null) {
        const w2 = hwndByTitle(desktop, "A - ");
        const nw = new RealNative(await desktop.w2Page(a));
        await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
        await recordKeys(nw.page);
        await nw.gridRow(3).click();
        await Thai.key(desktop, w2, "ctrl+shift+d");
        check("Ctrl+Shift+D in the native window docks the poll back", (await until(() => mm.sub(a).isVisible(), 8000, 100)) !== null, `keys ${(await keysSeen(nw.page).catch(() => [])).slice(-1).join(",")}`);
      }
    } finally {
      restoreLayouts(desktop);
      log.push(`restored layouts; foreground ${JSON.stringify(layoutOf(fgHwnd()))}`);
      console.log("THAI W1", JSON.stringify(results, null, 1));
      console.log("THAI W1 log", log.join(" || "));
      await testInfo.attach("thai-w1.json", { body: JSON.stringify({ results, log }, null, 1), contentType: "application/json" });
    }
  });

  test("native window (P2 popped out): Ctrl+P, Ctrl+E, Ctrl+S, F6, Ctrl+Shift+N, Ctrl+\\, Ctrl+Shift+\\, Ctrl+Shift+D", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(300_000);
    const results: Record<string, string> = {};
    const log: string[] = [`start foreground layout ${START_FOREGROUND_LAYOUT}`];
    try {
      await referenceMap(sim);
      await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
      const [p1, p2] = await createPolls(mm, [
        { name: "Poll 1", slave: 1, fc: 3, start: 0, qty: 10, scan: 100 },
        { name: "Poll 2", slave: 1, fc: 3, start: 10, qty: 10, scan: 100 },
      ]);
      await saveProfileAs(mm, "Plant");
      await focusPoll(mm, p2 as number);
      const { nw, hwnd: w2 } = await popOutByButton(desktop, mm, p2 as number, "Poll 2 - ");
      await recordKeys(nw.page);
      const state = () => nw.statusLine.getAttribute("data-state");
      const check = (name: string, ok: boolean, extra = "") => {
        results[name] = ok ? `pass${extra ? ` (${extra})` : ""}` : `FAIL${extra ? ` (${extra})` : ""}`;
        expect.soft(ok, `Thai layout (native): ${name} ${extra}`).toBe(true);
      };
      const region = () => nw.page.evaluate(() => (document.activeElement?.closest("[data-region]") as HTMLElement | null)?.dataset.region ?? (document.activeElement?.tagName ?? "none"));
      await nw.gridRow(3).click();
      desktop.ensureEnglishLayout(w2);
      const r0 = await region();
      desktop.nativeKey(w2, "f6");
      await until(async () => (await region()) !== r0, 3000);
      const f6en = `${r0}->${await region()}`;

      await Thai.use(desktop, w2);
      log.push(`W2 layout ${JSON.stringify(layoutOf(w2))}`);
      await nw.gridRow(3).click();
      await keysSeen(nw.page);
      await Thai.key(desktop, w2, "ctrl+p");
      const tp = await until(async () => (await state()) === "paused", 2500);
      const seenP = await keysSeen(nw.page);
      check("Ctrl+P pauses within 500 ms", tp !== null && tp <= 500, `${tp} ms; page received ${seenP.join(",")}`);
      await sleep(250);
      const m = sim.mark();
      await sleep(400);
      check("Ctrl+P: no further request for Poll 2", sim.requestsDecoded(m).filter((r) => r.addr === 10).length === 0);
      await Thai.key(desktop, w2, "ctrl+p");
      check("second Ctrl+P resumes", (await until(async () => (await state()) === "polling", 2500)) !== null);

      await nw.gridRow(3).click();
      await Thai.key(desktop, w2, "ctrl+e");
      const dlg = nw.page.getByRole("dialog");
      check("Ctrl+E opens the Write dialog", (await until(() => dlg.isVisible(), 2500)) !== null);
      await Thai.key(desktop, w2, "esc");
      check("Esc closes it", (await until(async () => !(await dlg.isVisible()), 2500)) !== null);

      await nw.gridRow(3).click();
      await Thai.key(desktop, w2, "f6");
      await until(async () => (await region()) !== f6en.split("->")[0], 3000);
      // the start region of the Thai run is the grid cell as in the control
      const f6th = `${f6en.split("->")[0]}->${await region()}`;
      check("F6 moves to the next region as with US English", f6th === f6en, `US ${f6en}, Thai ${f6th}`);

      // Ctrl+S: change the profile through W1 (Modified), then Ctrl+S in the native window
      await focusPoll(mm, p1 as number);
      await mm.titleButton(p1 as number, /^Poll setup/).click();
      await mm.setupField(p1 as number, "Name").fill("Poll 1b");
      await mm.setup(p1 as number).getByRole("button", { name: "Apply", exact: true }).click();
      await expect.poll(() => mm.modified()).toBe(true);
      const file = path.join(profilesDir(desktop), "Plant.json");
      const mtime0 = fs.statSync(file).mtimeMs;
      await nw.gridRow(3).click();
      await Thai.key(desktop, w2, "ctrl+s");
      const saved = await until(async () => !(await mm.modified()), 4000);
      check("Ctrl+S in the native window saves the profile (no dialog), Modified cleared", saved !== null && fs.statSync(file).mtimeMs > mtime0, `cleared after ${saved} ms`);

      // Ctrl+\ toggles this window's setup (rail -> popover at the default width)
      const pres0 = await nw.view.getAttribute("data-presentation");
      await nw.gridRow(3).click();
      await Thai.key(desktop, w2, "ctrl+backslash");
      check("Ctrl+\\ opens the setup", (await until(async () => (await nw.view.getAttribute("data-presentation")) !== pres0, 2500)) !== null, `${pres0} -> ${await nw.view.getAttribute("data-presentation")}, keys ${(await keysSeen(nw.page)).slice(-1).join(",")}`);
      await Thai.key(desktop, w2, "ctrl+backslash");
      check("Ctrl+\\ again closes it", (await until(async () => (await nw.view.getAttribute("data-presentation")) === pres0, 2500)) !== null);

      // Ctrl+Shift+\ compact mode
      await nw.gridRow(3).click();
      await Thai.key(desktop, w2, "ctrl+shift+backslash");
      check("Ctrl+Shift+\\ switches compact mode on", (await until(async () => (await nw.prefs()).compact === true, 2500)) !== null);
      await Thai.key(desktop, w2, "ctrl+shift+backslash");
      check("Ctrl+Shift+\\ again switches it off", (await until(async () => (await nw.prefs()).compact === false, 2500)) !== null);

      // Ctrl+Shift+N in the native window: a new native window
      const natives0 = desktop.windows().filter((w) => w.cls === "Tauri Window").length;
      await nw.gridRow(3).click();
      await Thai.key(desktop, w2, "ctrl+shift+n");
      check("Ctrl+Shift+N opens a new poll in a new native window", (await until(() => desktop.windows().filter((w) => w.cls === "Tauri Window").length === natives0 + 1, 6000, 100)) !== null, `keys ${(await keysSeen(nw.page)).slice(-1).join(",")}`);
      const created = (await mm.ids()).find((i) => ![p1, p2].includes(i));
      if (created !== undefined) {
        desktop.showWindow(w1Hwnd(desktop), "focus");
        await mm.row(created).click();
        await mm.row(created).focus();
        await mm.page.keyboard.press("Delete");
        await mm.confirm.getByRole("button", { name: "Delete", exact: true }).click();
        await expect.poll(async () => (await mm.ids()).length).toBe(2);
      }

      // Ctrl+L does nothing while connected
      await Thai.use(desktop, w2);
      await nw.gridRow(3).click();
      await Thai.key(desktop, w2, "ctrl+l");
      await sleep(600);
      check("Ctrl+L does nothing while connected", (await mm.pill.innerText()).includes("Connected"));

      // Ctrl+Shift+D docks
      await nw.gridRow(3).click();
      await Thai.key(desktop, w2, "ctrl+shift+d");
      check("Ctrl+Shift+D docks the poll", (await until(() => mm.sub(p2 as number).isVisible(), 8000, 100)) !== null);
    } finally {
      restoreLayouts(desktop);
      log.push(`restored layouts; foreground ${JSON.stringify(layoutOf(fgHwnd()))}`);
      console.log("THAI NATIVE", JSON.stringify(results, null, 1));
      console.log("THAI NATIVE log", log.join(" || "));
      await testInfo.attach("thai-native.json", { body: JSON.stringify({ results, log }, null, 1), contentType: "application/json" });
    }
  });

  test("text fields keep their native editing keys with Thai active (Name field: typing, Ctrl+A/C/V/X/Z) and the grid copies rows with Ctrl+C", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const results: Record<string, string> = {};
    try {
      const a = await liveOne(mm, sim, "A", 10);
      const w1 = w1Hwnd(desktop);
      await recordKeys(mm.page);
      const check = (name: string, ok: boolean, extra = "") => {
        results[name] = ok ? `pass${extra ? ` (${extra})` : ""}` : `FAIL${extra ? ` (${extra})` : ""}`;
        expect.soft(ok, `Thai layout (text field): ${name} ${extra}`).toBe(true);
      };
      await focusPoll(mm, a);
      await mm.titleButton(a, /^Poll setup/).click();
      const name = mm.setupField(a, "Name");
      await name.fill("Tank");
      await name.focus();
      const val = () => name.inputValue();
      await Thai.use(desktop, w1);
      await keysSeen(mm.page);
      await name.focus();
      await Thai.key(desktop, w1, "end");
      await Thai.key(desktop, w1, "p");
      const typed = await val();
      check('typing the key at the US P position types "ย" and no shortcut fires', typed === "Tankย" && (await mm.statusLine(a).getAttribute("data-state")) === "polling", `value ${JSON.stringify(typed)}, keys ${(await keysSeen(mm.page)).join(",")}`);
      await Thai.key(desktop, w1, "backspace");
      await Thai.key(desktop, w1, "ctrl+a");
      const sel = await name.evaluate((e) => `${(e as HTMLInputElement).selectionStart}-${(e as HTMLInputElement).selectionEnd}`);
      check("Ctrl+A selects the whole text", sel === "0-4", sel);
      await Thai.key(desktop, w1, "ctrl+c");
      await Thai.key(desktop, w1, "end");
      await Thai.key(desktop, w1, "ctrl+v");
      check("Ctrl+C then Ctrl+V gives TankTank", (await until(async () => (await val()) === "TankTank", 2000)) !== null, JSON.stringify(await val()));
      await Thai.key(desktop, w1, "ctrl+a");
      await Thai.key(desktop, w1, "ctrl+x");
      check("Ctrl+X cuts the selection", (await until(async () => (await val()) === "", 2000)) !== null, JSON.stringify(await val()));
      await Thai.key(desktop, w1, "ctrl+z");
      check("Ctrl+Z undoes the cut", (await until(async () => (await val()) === "TankTank", 2000)) !== null, JSON.stringify(await val()));
      const dlg = await mm.writeDialog.isVisible();
      const paused = (await mm.statusLine(a).getAttribute("data-state")) !== "polling";
      check("none of these keys paused the poll or opened a dialog", !dlg && !paused, `dialog ${dlg}, paused ${paused}`);
      // the grid: Ctrl+C copies the selected rows (OS clipboard read through PowerShell)
      await name.fill("A");
      await mm.titleButton(a, /^Poll setup/).click();
      await mm.gridRow(a, 2).click();
      await mm.gridRow(a, 4).click({ modifiers: ["Shift"] });
      execFileSync("powershell.exe", ["-NoProfile", "-Command", "Set-Clipboard -Value 'QA-SENTINEL'"]);
      await Thai.key(desktop, w1, "ctrl+c");
      const clip = await until(async () => execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }).trim() !== "QA-SENTINEL", 3000, 150);
      const text = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }).trim();
      check("Ctrl+C in the grid copies the selected rows", clip !== null && text.split(/\r?\n/).length >= 3, JSON.stringify(text.slice(0, 80)));
    } finally {
      restoreLayouts(desktop);
      console.log("THAI TEXT", JSON.stringify(results, null, 1));
      await testInfo.attach("thai-text.json", { body: JSON.stringify(results, null, 1), contentType: "application/json" });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// (4) CHK2-F8 / F16 focus after a failed pop out and dock (hooks build)
// ---------------------------------------------------------------------------------------------------------------------

async function activeInfo(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return { tag: "none" } as Record<string, unknown>;
    return {
      tag: a.tagName,
      role: a.getAttribute("role"),
      label: a.getAttribute("aria-label"),
      text: (a.textContent ?? "").trim().slice(0, 28),
      slot: a.getAttribute("data-slot"),
      pollId: a.getAttribute("data-poll-id"),
      inSub: a.closest("[data-subwindow]")?.getAttribute("data-subwindow") ?? null,
      inGrid: !!a.closest('[role="grid"]'),
      activedescendant: a.getAttribute("aria-activedescendant"),
      inToast: !!a.closest('[role="status"]'),
    } as Record<string, unknown>;
  });
}

test.describe("REPORT-008 (4) CHK2-F8 / F16 focus after a failed pop out and dock (D9, hooks build)", () => {
  test("pop out failure: button, Ctrl+Shift+O, sidebar menu, title bar menu, poll actions menu; dock failure: button, Ctrl+Shift+D, poll actions menu", async ({ desktop, mm, sim }, testInfo) => {
    test.skip(LABEL !== "hooks", "needs the dev-hooks build");
    test.setTimeout(420_000);
    const a = await liveOne(mm, sim, "A", 50);
    const w1 = w1Hwnd(desktop);
    const rows: Array<Record<string, unknown>> = [];
    const verdict = (name: string, ok: boolean, info: unknown) => {
      rows.push({ name, ok, info });
      console.log("F8", name, ok ? "pass" : "FAIL", JSON.stringify(info));
      expect.soft(ok, `${name}: ${JSON.stringify(info)}`).toBe(true);
    };
    const arm = (page: Page, kind: "popOut" | "dock") => invokeIn(page, "dev_fail_next_window_op", { kind, message: "boom" });
    const popToast = "Could not open the poll window: boom";

    // ---- pop out failures
    // (a) the button, real mouse
    await focusPoll(mm, a);
    {
      const btn = mm.titleButton(a, /^Open in its own window/);
      await btn.evaluate((el) => {
        const w = window as unknown as { __btn: Array<Record<string, unknown>> };
        w.__btn = [{ busy: el.getAttribute("aria-busy"), disabled: el.hasAttribute("disabled"), ariaDisabled: el.getAttribute("aria-disabled") }];
        new MutationObserver(() => w.__btn.push({ busy: el.getAttribute("aria-busy"), disabled: el.hasAttribute("disabled"), ariaDisabled: el.getAttribute("aria-disabled") })).observe(el, { attributes: true });
      });
      await arm(mm.page, "popOut");
      await hwClick(desktop, w1, mm.page, btn);
      await expect(mm.toast(popToast)).toBeVisible({ timeout: 10_000 });
      await sleep(600);
      const act = await activeInfo(mm.page);
      const trail = await mm.page.evaluate(() => (window as unknown as { __btn: Array<Record<string, unknown>> }).__btn);
      const everDisabled = trail.some((t) => t.disabled);
      const sawBusy = trail.some((t) => t.busy === "true");
      const same = await btn.evaluate((el) => el === document.activeElement);
      verdict("pop out button (real click)", same && act.tag !== "BODY" && !everDisabled, { active: act, buttonIsActive: same, neverDisabled: !everDisabled, sawAriaBusy: sawBusy, sawAriaDisabled: trail.some((t) => t.ariaDisabled === "true"), trail });
      verdict("pop out button: the busy state ended", (await btn.getAttribute("aria-busy")) !== "true", { busy: await btn.getAttribute("aria-busy") });
      await mm.page.keyboard.press("Tab");
      const afterTab = await activeInfo(mm.page);
      verdict("pop out button: Tab moves to the next control of that sub-window", afterTab.inSub === String(a) && !same ? true : afterTab.inSub === String(a), { afterTab });
      await expect(mm.sub(a)).toBeVisible();
    }
    // (b) Ctrl+Shift+O (hardware), focus on the grid, row 3
    {
      await focusPoll(mm, a);
      await mm.gridRow(a, 3).click();
      const before = await focusFingerprint(mm.page);
      const beforeInfo = await activeInfo(mm.page);
      await arm(mm.page, "popOut");
      desktop.nativeKey(w1, "ctrl+shift+o");
      await expect(mm.toast(popToast)).toBeVisible({ timeout: 10_000 });
      await sleep(600);
      const act = await activeInfo(mm.page);
      const after = await focusFingerprint(mm.page);
      verdict("Ctrl+Shift+O (hardware) with row 3 focused", act.tag !== "BODY" && act.inGrid === true && after === before, { before: beforeInfo, after: act, fingerprintBefore: before, fingerprintAfter: after });
    }
    // (c) sidebar context menu
    {
      await arm(mm.page, "popOut");
      await mm.row(a).click({ button: "right" });
      await mm.page.getByRole("menuitem", { name: /^Pop out to own window/ }).click();
      await expect(mm.toast(popToast).first()).toBeVisible({ timeout: 10_000 });
      await sleep(600);
      const act = await activeInfo(mm.page);
      verdict("sidebar context menu", act.tag !== "BODY" && act.slot === "poll-row" && act.pollId === String(a), { active: act });
    }
    // (d) title bar context menu
    {
      await arm(mm.page, "popOut");
      await mm.titleBar(a).click({ button: "right", position: { x: 60, y: 10 } });
      await mm.page.getByRole("menuitem", { name: /^Pop out to own window/ }).click();
      await sleep(900);
      const act = await activeInfo(mm.page);
      verdict("title bar context menu", act.tag !== "BODY", { active: act });
    }
    // (e) the status-line "Poll actions" menu
    {
      await arm(mm.page, "popOut");
      const trigger = mm.statusLine(a).getByRole("button", { name: "Poll actions" });
      await trigger.click();
      await mm.page.getByRole("menuitem", { name: /^Pop out to own window/ }).click();
      await sleep(900);
      const act = await activeInfo(mm.page);
      const onTrigger = await trigger.evaluate((el) => el === document.activeElement);
      verdict("status line Poll actions menu", act.tag !== "BODY" && onTrigger, { active: act, onTrigger });
    }
    // disarm: the next pop out works (the earlier arms were consumed one by one)
    const { nw, hwnd: w2 } = await popOutByButton(desktop, mm, a, "A - ");
    await expect(nw.grid).toHaveAttribute("data-status", "live");

    // ---- dock failures in the native window
    {
      const btn = nw.toolbarButton("Dock to workspace");
      await btn.evaluate((el) => {
        const w = window as unknown as { __btn: Array<Record<string, unknown>> };
        w.__btn = [{ busy: el.getAttribute("aria-busy"), disabled: el.hasAttribute("disabled"), ariaDisabled: el.getAttribute("aria-disabled") }];
        new MutationObserver(() => w.__btn.push({ busy: el.getAttribute("aria-busy"), disabled: el.hasAttribute("disabled"), ariaDisabled: el.getAttribute("aria-disabled") })).observe(el, { attributes: true });
      });
      await arm(nw.page, "dock");
      await hwClick(desktop, w2, nw.page, btn);
      await expect(nw.toasts.filter({ hasText: "Could not dock the poll: boom" })).toBeVisible({ timeout: 10_000 });
      await sleep(600);
      const act = await activeInfo(nw.page);
      const trail = await nw.page.evaluate(() => (window as unknown as { __btn: Array<Record<string, unknown>> }).__btn);
      const same = await btn.evaluate((el) => el === document.activeElement);
      verdict("dock button (real click)", same && act.tag !== "BODY" && !trail.some((t) => t.disabled), { active: act, buttonIsActive: same, neverDisabled: !trail.some((t) => t.disabled), sawAriaBusy: trail.some((t) => t.busy === "true"), trail });
      verdict("dock failure: W2 stays, host native, W1 not raised", hwndByTitle(desktop, "A - ") === w2 && (await mm.sub(a).count()) === 0, { fg: desktop.foregroundHwnd(), w2, w1 });
    }
    {
      await nw.gridRow(3).click();
      const before = await focusFingerprint(nw.page);
      await arm(nw.page, "dock");
      desktop.nativeKey(w2, "ctrl+shift+d");
      await expect(nw.toasts.filter({ hasText: "Could not dock the poll: boom" })).toBeVisible({ timeout: 10_000 });
      await sleep(600);
      const act = await activeInfo(nw.page);
      const after = await focusFingerprint(nw.page);
      verdict("Ctrl+Shift+D (hardware) from the grid", act.tag !== "BODY" && act.inGrid === true && after === before, { before, after, active: act });
    }
    {
      await arm(nw.page, "dock");
      const trigger = nw.statusLine.getByRole("button", { name: "Poll actions" });
      await trigger.click();
      await nw.page.getByRole("menuitem", { name: /^Dock to workspace/ }).click();
      await sleep(900);
      const act = await activeInfo(nw.page);
      const onTrigger = await trigger.evaluate((el) => el === document.activeElement);
      verdict("native status line Poll actions menu (dock)", act.tag !== "BODY" && onTrigger, { active: act, onTrigger });
    }
    // the hook is consumed: the next dock works
    await nw.toolbarButton("Dock to workspace").click();
    await expect(mm.sub(a)).toBeVisible({ timeout: 15_000 });
    await testInfo.attach("f8.json", { body: JSON.stringify(rows, null, 1), contentType: "application/json" });
    fs.writeFileSync(path.join(evidenceDir, "f8-f16-focus.json"), JSON.stringify(rows, null, 1));
    void gridState;
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// (5) CHK2-D3 with the os-timer simulator
// ---------------------------------------------------------------------------------------------------------------------

/** Median / min / max of the reply delay of the simulator for `n` sequential FC03 reads. */
async function simReplyDelay(port: number, n = 60): Promise<{ median: number; min: number; max: number }> {
  const socket = net.connect({ host: "127.0.0.1", port });
  await new Promise<void>((r, j) => {
    socket.once("connect", () => r());
    socket.once("error", j);
  });
  const times: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const req = Buffer.from([0, i & 0xff, 0, 0, 0, 6, 1, 3, 0, 0, 0, 1]);
    const t0 = process.hrtime.bigint();
    await new Promise<void>((resolve) => {
      socket.once("data", () => resolve());
      socket.write(req);
    });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  socket.destroy();
  times.sort((a, b) => a - b);
  return { median: Math.round((times[Math.floor(n / 2)] as number) * 100) / 100, min: Math.round((times[0] as number) * 100) / 100, max: Math.round((times.at(-1) as number) * 100) / 100 };
}

test.describe("REPORT-008 (5) CHK2-D3 saturated link, revision 11 oracle", () => {
  test("16 polls at 20 ms, fault delay 3, master-timeout 1000: link load, effective vs log (0.5 ms), round robin, no OVERLAP, clear within 1 s", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(SCAN_SECONDS * 1000 + 300_000);
    await referenceMap(sim);
    await sim.ctlOk("master-timeout 1000");
    await sim.ctlOk("fault delay 3");
    const delay = await simReplyDelay(sim.modbusPort);
    console.log("D3 simulator reply delay with fault delay 3", JSON.stringify({ simExe: process.env.ESEFACT_SIM_EXE ?? "default", ...delay }));
    const polls: PollProfileSpec[] = Array.from({ length: 16 }, (_, i) => ({ name: `Poll ${i + 1}`, slave: 1, fc: 3, start: 5 * i, qty: 5, scan: 20, workspace: null }));
    writeProfile(desktop, "D3", profileV2("D3", polls, { connection: { mode: "tcp", host: "127.0.0.1", port: sim.modbusPort, timeoutMs: 1000 } }));
    await openProfile(mm, "D3");
    await expect(mm.pollList.getByRole("option")).toHaveCount(16);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    await expect(mm.statusLine(await mm.idByName("Poll 1"))).toHaveAttribute("data-state", "polling", { timeout: 30_000 });
    await sleep(5000);
    const mid = sim.mark();
    const ids = await mm.ids();
    const t0 = Date.now();
    const samples: Array<Record<string, unknown>> = [];
    const oracle: Array<{ poll: number; effective: number; logMean: number; diff: number; bestShiftDiff: number }> = [];
    for (let k = 0; k < 4; k += 1) {
      await sleep(Math.floor((SCAN_SECONDS * 1000) / 5));
      const row: Record<string, unknown> = { atS: Math.round((Date.now() - t0) / 100) / 10 };
      for (const pi of [0, 1, 2, 5, 15]) {
        const lineMark = sim.mark();
        const text = await mm.statusText(ids[pi] as number);
        const n = Number(/effective (\d+) ms/.exec(text)?.[1] ?? Number.NaN);
        const reqs = sim.requestsDecoded(0, lineMark).filter((r) => r.addr === 5 * pi).map((r) => r.epoch);
        const meanAt = (end: number) => {
          const w = reqs.slice(Math.max(0, end - 10), end);
          return diffs(w).reduce((s, x) => s + x, 0) / Math.max(1, w.length - 1);
        };
        const m0 = meanAt(reqs.length);
        let best = Math.abs(n - m0);
        for (let s = 1; s <= 3; s += 1) best = Math.min(best, Math.abs(n - meanAt(reqs.length - s)));
        row[`P${pi + 1}`] = { effective: n, logMeanLast10: Math.round(m0 * 100) / 100 };
        oracle.push({ poll: pi + 1, effective: n, logMean: Math.round(m0 * 100) / 100, diff: Math.round(Math.abs(n - m0) * 100) / 100, bestShiftDiff: Math.round(best * 100) / 100 });
        expect.soft(n, `Poll ${pi + 1}: effective ${n} > 30 (${text})`).toBeGreaterThan(30);
      }
      const bar = (await mm.trafficBar.innerText()).replace(/\s+/g, " ");
      const load = Number(/link load (\d+)%/.exec(bar)?.[1] ?? Number.NaN);
      row.linkLoad = load;
      row.bar = bar;
      samples.push(row);
      expect.soft(load, "link load >= 90 %").toBeGreaterThanOrEqual(90);
      expect.soft(bar, "polls are slowed down text").toContain("polls are slowed down");
    }
    await expect(mm.trafficBar.locator('[data-icon="gauge"]'), "gauge icon").toHaveCount(1);
    const everyLine = await Promise.all(ids.map((id) => mm.statusText(id)));
    const effectives = everyLine.map((t) => Number(/effective (\d+) ms/.exec(t)?.[1] ?? Number.NaN));
    everyLine.forEach((t, i) => expect.soft(t, `Poll ${i + 1}: SR 20 ms (effective n ms)`).toMatch(/SR 20 ms \(effective \d+ ms\)/));
    const doneBy = t0 + SCAN_SECONDS * 1000;
    if (Date.now() < doneBy) await sleep(doneBy - Date.now());
    const reqs = sim.requestsDecoded(mid);
    const pollOf = (r: { addr: number }) => Math.floor(r.addr / 5);
    let violations = 0;
    let firstViolation = "";
    let windows = 0;
    for (let i = 0; i + 16 <= reqs.length; i += 1) {
      windows += 1;
      const seen = new Set(reqs.slice(i, i + 16).map(pollOf));
      if (seen.size < 16) {
        violations += 1;
        if (!firstViolation) firstViolation = `window at request ${i}: polls ${[...seen].sort((a, b) => a - b).join(",")}`;
      }
    }
    let maxGap = 0;
    for (let p = 0; p < 16; p += 1) maxGap = Math.max(maxGap, ...diffs(reqs.filter((r) => pollOf(r) === p).map((r) => r.epoch)));
    const overlap = sim.linesWith("OVERLAP");
    const allIntervals = diffs(reqs.map((r) => r.epoch));
    const meanAll = allIntervals.reduce((s, x) => s + x, 0) / allIntervals.length;
    const result = { simDelay: delay, requests: reqs.length, windowsChecked: windows, windowsMissingAPoll: violations, firstViolation, maxGapOnePollMs: maxGap, overlapLines: overlap.length, meanIntervalAllRequestsMs: Math.round(meanAll * 100) / 100, effectives, oracle, samples };
    console.log("D3", JSON.stringify(result));
    await testInfo.attach("d3.json", { body: JSON.stringify(result, null, 1), contentType: "application/json" });
    expect.soft(violations, `round robin: every window of 16 requests has all 16 polls (${firstViolation})`).toBe(0);
    expect.soft(maxGap, "longest gap of one poll <= 2 s").toBeLessThanOrEqual(2000);
    expect.soft(overlap, "no OVERLAP").toEqual([]);
    expect.soft(oracle.filter((o) => o.diff > 0.5).map((o) => `P${o.poll}: effective ${o.effective} vs log ${o.logMean}`), "oracle |effective - log mean| <= 0.5 ms").toEqual([]);
    // clear
    await sim.ctlOk("clear");
    const tClear = Date.now();
    let gone: number | null = null;
    let below: number | null = null;
    let loadAtGone: number | null = null;
    let lastBar = "";
    while (Date.now() - tClear < 8000) {
      const lines = await Promise.all(ids.map((id) => mm.statusText(id)));
      lastBar = (await mm.trafficBar.innerText()).replace(/\s+/g, " ");
      const load = Number(/link load (\d+)%/.exec(lastBar)?.[1] ?? Number.NaN);
      const slowed = lastBar.includes("polls are slowed down") || (await mm.trafficBar.locator('[data-icon="gauge"]').count()) > 0;
      if (gone === null && lines.every((t) => !t.includes("effective"))) {
        gone = Date.now() - tClear;
        loadAtGone = load;
      }
      if (below === null && load < 90 && !slowed) below = Date.now() - tClear;
      if (gone !== null && below !== null) break;
      await sleep(50);
    }
    const out = { suffixGoneAfterMs: gone, loadAtSuffixGone: loadAtGone, loadBelow90AndTextGoneAfterMs: below, lastBar };
    console.log("D3 CLEAR", JSON.stringify(out));
    await testInfo.attach("d3-clear.json", { body: JSON.stringify(out), contentType: "application/json" });
    expect.soft(gone, "the suffix disappears from every line after clear").not.toBeNull();
    expect.soft(gone ?? 99999, "suffix gone within 1 s").toBeLessThanOrEqual(1000);
    expect.soft(below, "link load below 90 % and the slowed text and gauge gone after clear (null = not within 8 s)").not.toBeNull();
    expect(test.info().errors.length).toBe(0);
  });
});
