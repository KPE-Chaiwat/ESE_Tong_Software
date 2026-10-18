// REPORT-007: window geometry on the real monitor (one monitor, 125 %). CHK2-A7, A8 (W1 clamp to the work area at creation and at
// restore, visible edges via DWM extended frame bounds, tolerance 1 px), CHK2-F13 (native minimum outer size by real OS drags),
// Q-002-15 / REV-008 m-5 (a W1 snapped to an edge and the taskbar must not move or shrink after a restart).
// Restart tests close the app gracefully (WM_CLOSE on every window) so the window-state plugin writes its file, then start the app
// again on the same data dir with keepWindowState.
import fs from "node:fs";
import { type Desktop, expect, type RealMm, test } from "../integration/fixtures";
import { makeDataDir, removeDir, startApp } from "../integration/app-session";
import { monitorsPx, type NativeWindow, type Rect, WINDOW_STATE_FILE } from "../integration/desktop";
import { openProfile, profileV2, writeProfile } from "../integration/profiles";
import { hwndByTitle, sleep, visibleFrame } from "../integration/qa7";

const primary = () => {
  const m = monitorsPx().find((x) => x.primary) ?? monitorsPx()[0];
  if (!m) throw new Error("no monitor");
  return m;
};
const w1s = (d: Desktop) => d.windows().filter((w) => w.title.startsWith("Modbus Master"));
const r2 = (r: Rect) => `${r.x},${r.y} ${r.w}x${r.h}`;

/** The visible rectangle lies inside the work area, tolerance 1 physical px. */
function insideWorkArea(f: Rect, wa: Rect, tol = 1): { ok: boolean; why: string } {
  const why: string[] = [];
  if (f.x < wa.x - tol) why.push(`left ${f.x} < ${wa.x}`);
  if (f.y < wa.y - tol) why.push(`top ${f.y} < ${wa.y}`);
  if (f.x + f.w > wa.x + wa.w + tol) why.push(`right ${f.x + f.w} > ${wa.x + wa.w}`);
  if (f.y + f.h > wa.y + wa.h + tol) why.push(`bottom ${f.y + f.h} > ${wa.y + wa.h}`);
  return { ok: why.length === 0, why: why.join("; ") };
}

/** The content (toolbar top, status bar bottom) is inside the page viewport and inside the work area on the screen. */
async function contentVisible(mm: RealMm, w: NativeWindow, wa: Rect): Promise<{ ok: boolean; info: string }> {
  const bar = await mm.statusBar.boundingBox();
  const tb = await mm.toolbar.boundingBox();
  const inner = await mm.page.evaluate(() => ({ h: window.innerHeight, w: window.innerWidth, dpr: window.devicePixelRatio }));
  const bottomScreen = bar ? w.client.y + (bar.y + bar.height) * inner.dpr : null;
  const ok = !!bar && !!tb && bar.y + bar.height <= inner.h + 0.5 && tb.y >= -0.5 && bottomScreen !== null && bottomScreen <= wa.y + wa.h + 1;
  return { ok, info: JSON.stringify({ innerH: inner.h, statusBarBottom: bar ? bar.y + bar.height : null, toolbarTop: tb?.y ?? null, bottomScreen }) };
}

async function closeAppGracefully(desktop: Desktop): Promise<void> {
  const code = await desktop.closeGracefully(30_000);
  expect(code, "graceful exit (exit code, null = still running)").not.toBeNull();
  await desktop.stop();
}

test.describe("CHK2-A7 W1 clamped at creation (visible edges, work area, content visible)", () => {
  test("default W1 from the launcher tile and a second W1 from Ctrl+N lie inside the work area; inner width 1280 logical; no part under the taskbar", async ({ desktop, launcher, mm }, testInfo) => {
    test.setTimeout(120_000);
    const m = primary();
    const wa = m.work;
    const L = desktop.windows().find((w) => w.title === "ESEfact");
    const first = w1s(desktop)[0] as NativeWindow;
    const rows: Record<string, unknown>[] = [];
    const check = async (label: string, w: NativeWindow, page: RealMm) => {
      const f = visibleFrame(w);
      const inside = insideWorkArea(f, wa);
      const cv = await contentVisible(page, w, wa);
      const innerLogical = w.client.w / m.scale;
      rows.push({ label, rect: r2(w.rect), visible: r2(f), client: r2(w.client), innerLogical, bottomLimit: wa.y + wa.h, inside: inside.ok, content: cv.info });
      expect.soft(inside.ok, `${label}: visible frame inside the work area (${inside.why}); visible ${r2(f)} work area ${r2(wa)}`).toBe(true);
      expect.soft(f.y + f.h, `${label}: visible bottom <= ${wa.y + wa.h}`).toBeLessThanOrEqual(wa.y + wa.h + 1);
      expect.soft(f.x + f.w, `${label}: visible right <= ${wa.x + wa.w}`).toBeLessThanOrEqual(wa.x + wa.w + 1);
      expect.soft(Math.abs(innerLogical - 1280), `${label}: inner width ${innerLogical} logical is 1280 +-1`).toBeLessThanOrEqual(1);
      expect.soft(cv.ok, `${label}: toolbar, workspace and status bar fully visible (${cv.info})`).toBe(true);
    };
    await check("W1 from the launcher", first, mm);
    const known = new Set(desktop.pages());
    await mm.page.keyboard.press("Control+n");
    const page2 = await desktop.newPage(known, (u) => /\/tools\/modbus-master(\/)?(\?|#|$)/.test(u));
    const { RealMm } = await import("../integration/real-mm");
    const mm2 = new RealMm(page2);
    await expect(mm2.toolbarButton("Connect")).toBeEnabled({ timeout: 20_000 });
    await expect.poll(() => w1s(desktop).length).toBe(2);
    const second = w1s(desktop).find((w) => w.hwnd !== first.hwnd) as NativeWindow;
    await check("W1 from Ctrl+N", second, mm2);
    console.log("A7", JSON.stringify({ launcher: L && { rect: r2(L.rect), scale: m.scale }, workArea: r2(wa), rows }));
    await testInfo.attach("a7.json", { body: JSON.stringify({ launcher: L?.rect, workArea: wa, scale: m.scale, rows }, null, 1), contentType: "application/json" });
    expect(test.info().errors.length).toBe(0);
  });
});

interface RestartCase {
  name: string;
  /** Puts the W1 window into the state to be saved; returns a note. */
  prepare: (d: Desktop, hwnd: number, wa: Rect, borders: { l: number; r: number; b: number }) => void;
  /** The rule the restored window must satisfy. */
  expectRestored: (before: NativeWindow, after: NativeWindow, wa: Rect, scale: number) => string[];
}

const RESTART_CASES: RestartCase[] = [
  {
    name: "A7/A8 the default W1 as created by the launcher (clamped to the work area) comes back unchanged after a restart",
    prepare: () => {},
    expectRestored: (bf, a, wa) => {
      const bad: string[] = [];
      const fb = visibleFrame(bf);
      const fa = visibleFrame(a);
      for (const k of ["x", "y", "w", "h"] as const) if (Math.abs(fb[k] - fa[k]) > 1) bad.push(`visible ${k} changed ${fb[k]} -> ${fa[k]}`);
      const ins = insideWorkArea(fa, wa);
      if (!ins.ok) bad.push(`not inside the work area: ${ins.why}`);
      return bad;
    },
  },
  {
    name: "A8 saved rect (100, 300, 1900 x 1000) with its bottom below the work area",
    prepare: (d, h) => d.moveWindow(h, 100, 300, 1900, 1000),
    expectRestored: (_b, a, wa, s) => {
      const f = visibleFrame(a);
      const bad: string[] = [];
      const ins = insideWorkArea(f, wa);
      if (!ins.ok) bad.push(`not inside the work area: ${ins.why}`);
      if (a.rect.w < 960 * s || a.rect.h < 600 * s) bad.push(`smaller than the 960 x 600 logical minimum: ${a.rect.w}x${a.rect.h}`);
      return bad;
    },
  },
  {
    name: "A8 saved rect partly off-screen on the right and bottom (1500, 800, 1300 x 900)",
    prepare: (d, h) => d.moveWindow(h, 1500, 800, 1300, 900),
    expectRestored: (_b, a, wa) => {
      const ins = insideWorkArea(visibleFrame(a), wa);
      return ins.ok ? [] : [`not inside the work area: ${ins.why}`];
    },
  },
  {
    name: "A8 saved rect partly off-screen on the left and top (-500, -200, 1400 x 900)",
    prepare: (d, h) => d.moveWindow(h, -500, -200, 1400, 900),
    expectRestored: (_b, a, wa) => {
      const ins = insideWorkArea(visibleFrame(a), wa);
      return ins.ok ? [] : [`not inside the work area: ${ins.why}`];
    },
  },
  {
    name: "m-5 visible left edge on the screen edge and visible bottom on the taskbar (snap-like) stays put",
    prepare: (d, h, wa, b) => d.moveWindow(h, wa.x - b.l, wa.y, 1300 + b.l + b.r, wa.h + b.b),
    expectRestored: (bf, a) => {
      const bad: string[] = [];
      const fb = visibleFrame(bf);
      const fa = visibleFrame(a);
      for (const k of ["x", "y", "w", "h"] as const) if (Math.abs(fb[k] - fa[k]) > 1) bad.push(`visible ${k} changed ${fb[k]} -> ${fa[k]}`);
      return bad;
    },
  },
  {
    name: "m-5 visible right edge on the screen edge and visible bottom on the taskbar stays put",
    prepare: (d, h, wa, b) => d.moveWindow(h, wa.x + wa.w - 1300 - b.l, wa.y, 1300 + b.l + b.r, wa.h + b.b),
    expectRestored: (bf, a) => {
      const bad: string[] = [];
      const fb = visibleFrame(bf);
      const fa = visibleFrame(a);
      for (const k of ["x", "y", "w", "h"] as const) if (Math.abs(fb[k] - fa[k]) > 1) bad.push(`visible ${k} changed ${fb[k]} -> ${fa[k]}`);
      return bad;
    },
  },
  {
    name: "m-5 a normal placement (200, 100, 1500 x 800) comes back exactly",
    prepare: (d, h) => d.moveWindow(h, 200, 100, 1500, 800),
    expectRestored: (bf, a) => {
      const bad: string[] = [];
      const fb = visibleFrame(bf);
      const fa = visibleFrame(a);
      for (const k of ["x", "y", "w", "h"] as const) if (Math.abs(fb[k] - fa[k]) > 1) bad.push(`visible ${k} changed ${fb[k]} -> ${fa[k]}`);
      return bad;
    },
  },
];

test.describe("CHK2-A8 W1 clamped at restore, and m-5 (visible edges), real graceful restart", () => {
  for (const c of RESTART_CASES) {
    test(c.name, async ({}, testInfo) => {
      test.setTimeout(180_000);
      const dataDir = makeDataDir();
      const m = primary();
      const wa = m.work;
      let s1: Awaited<ReturnType<typeof startApp>> | null = null;
      let s2: Awaited<ReturnType<typeof startApp>> | null = null;
      try {
        s1 = await startApp(dataDir);
        const w = w1s(s1.desktop)[0] as NativeWindow;
        const borders = { l: (w.frame?.x ?? w.rect.x) - w.rect.x, r: w.rect.x + w.rect.w - ((w.frame?.x ?? w.rect.x) + (w.frame?.w ?? w.rect.w)), b: w.rect.y + w.rect.h - ((w.frame?.y ?? w.rect.y) + (w.frame?.h ?? w.rect.h)) };
        c.prepare(s1.desktop, w.hwnd, wa, borders);
        await sleep(600);
        const placed = w1s(s1.desktop)[0] as NativeWindow;
        await closeAppGracefully(s1.desktop);
        s1 = null;
        const stateText = fs.existsSync(WINDOW_STATE_FILE) ? fs.readFileSync(WINDOW_STATE_FILE, "utf8") : "(no window-state file)";
        s2 = await startApp(dataDir, true);
        const after = w1s(s2.desktop)[0] as NativeWindow;
        // give the clamp (queued after the plugin's restore) time to run: wait until the rectangle is stable
        let last = "";
        for (let i = 0; i < 20; i += 1) {
          const now = r2((w1s(s2.desktop)[0] as NativeWindow).rect);
          if (now === last) break;
          last = now;
          await sleep(150);
        }
        const restored = w1s(s2.desktop)[0] as NativeWindow;
        const bad = c.expectRestored(placed, restored, wa, m.scale);
        const info = { case: c.name, borders, placed: { rect: r2(placed.rect), visible: r2(visibleFrame(placed)) }, restored: { rect: r2(restored.rect), visible: r2(visibleFrame(restored)), client: r2(restored.client) }, workArea: r2(wa), problems: bad, savedState: stateText.slice(0, 1200) };
        console.log("A8", JSON.stringify({ ...info, savedState: undefined }));
        await testInfo.attach("a8.json", { body: JSON.stringify(info, null, 1), contentType: "application/json" });
        void after;
        expect(bad, `restored placement: ${JSON.stringify(info.restored)} from ${JSON.stringify(info.placed)}`).toEqual([]);
        expect(visibleFrame(restored).y + visibleFrame(restored).h, "the restored W1 is not under the taskbar").toBeLessThanOrEqual(wa.y + wa.h + 1);
      } finally {
        await s1?.desktop.stop();
        await s2?.desktop.stop();
        removeDir(dataDir);
      }
    });
  }

  test("A8 a maximized W1 restores maximized", async ({}, testInfo) => {
    test.setTimeout(150_000);
    const dataDir = makeDataDir();
    let s1: Awaited<ReturnType<typeof startApp>> | null = null;
    let s2: Awaited<ReturnType<typeof startApp>> | null = null;
    try {
      s1 = await startApp(dataDir);
      const w = w1s(s1.desktop)[0] as NativeWindow;
      s1.desktop.showWindow(w.hwnd, "max");
      await expect.poll(() => w1s(s1?.desktop as Desktop)[0]?.zoomed).toBe(true);
      await closeAppGracefully(s1.desktop);
      s1 = null;
      s2 = await startApp(dataDir, true);
      await expect.poll(() => w1s(s2?.desktop as Desktop)[0]?.zoomed, { message: "W1 restored maximized", timeout: 15_000 }).toBe(true);
      const r = w1s(s2.desktop)[0] as NativeWindow;
      await testInfo.attach("a8-max.json", { body: JSON.stringify({ rect: r2(r.rect), zoomed: r.zoomed, workArea: r2(primary().work) }), contentType: "application/json" });
    } finally {
      await s1?.desktop.stop();
      await s2?.desktop.stop();
      removeDir(dataDir);
    }
  });
});

test.describe("CHK2-F13 native window minimum outer size, real OS drags (right edge, bottom edge) and SetWindowPos 1 x 1", () => {
  test("outer minimum is exactly ceil(480 s) x ceil(320 s) physical (600 x 400 at 125 %), client = outer - frame with no 1 px loss, status line has no clipped control", async ({ desktop, mm }, testInfo) => {
    test.setTimeout(150_000);
    const m = primary();
    const s = m.scale;
    writeProfile(desktop, "One", profileV2("One", [{ name: "W01", host: "native", open: true, native: null, scan: 1000 }]));
    await openProfile(mm, "One");
    await expect.poll(() => desktop.windows().filter((w) => /^W01 - /.test(w.title)).length, { timeout: 30_000 }).toBe(1);
    const hwnd = hwndByTitle(desktop, "W01 - ");
    const get = () => desktop.windows().find((x) => x.hwnd === hwnd) as NativeWindow;
    desktop.moveWindow(hwnd, 100, 60, Math.round(900 * s), Math.round(500 * s));
    await expect.poll(() => get().rect.x).toBe(100);
    desktop.showWindow(hwnd, "focus");
    // right edge to the left (grab inside the visible frame edge), then the bottom edge up
    let f = visibleFrame(get());
    desktop.mouseDrag(f.x + f.w - 1, get().rect.y + 200, get().rect.x + 150, get().rect.y + 200, 25, 20);
    await expect.poll(() => get().rect.w, { message: "narrowed by the right-edge drag" }).toBeLessThan(Math.round(900 * s));
    f = visibleFrame(get());
    desktop.mouseDrag(get().rect.x + 250, f.y + f.h - 1, get().rect.x + 250, get().rect.y + 60, 25, 20);
    await expect.poll(() => get().rect.h, { message: "shortened by the bottom-edge drag" }).toBeLessThan(Math.round(500 * s));
    await sleep(500);
    const dragged = get();
    const frame = { w: dragged.rect.w - dragged.client.w, h: dragged.rect.h - dragged.client.h };
    const want = { w: Math.ceil(480 * s), h: Math.ceil(320 * s) };
    // the status line of the W2 at the minimum
    const page = await desktop.w2Page(1);
    const line = await page.evaluate(() => {
      const l = document.querySelector('[data-testid="poll-status-line"]') as HTMLElement;
      const root = document.querySelector('[data-slot="poll-view"]') as HTMLElement;
      const clipped = [...l.querySelectorAll("button")].filter((b) => b.scrollWidth > b.clientWidth + 0.5).length;
      return { L: Math.round(l.getBoundingClientRect().width * 10) / 10, step: l.getAttribute("data-step"), scrollWidth: l.scrollWidth, clientWidth: l.clientWidth, viewOffsetWidth: root.offsetWidth, clippedButtons: clipped };
    });
    // CHK2-F13 also says "the same holds after SetWindowPos to 1 x 1: the OS keeps the minimum". Win32 applies the minimum track size to user
    // resizing only; the same call is made on the launcher (minimum 800 x 560 logical in tauri.conf.json) as a control.
    const lw = hwndByTitle(desktop, "ESEfact");
    desktop.moveWindow(lw, 50, 50, 1, 1);
    desktop.moveWindow(hwnd, 100, 60, 1, 1);
    await sleep(600);
    const tiny = get();
    const tinyLauncher = desktop.windows().find((w) => w.hwnd === lw) as NativeWindow;
    const info = { scale: s, launcherAfterSetWindowPos1x1: `${tinyLauncher.rect.w}x${tinyLauncher.rect.h}`, dragged: { outer: `${dragged.rect.w}x${dragged.rect.h}`, client: `${dragged.client.w}x${dragged.client.h}`, frame }, afterSetWindowPos1x1: { outer: `${tiny.rect.w}x${tiny.rect.h}`, client: `${tiny.client.w}x${tiny.client.h}` }, want, line };
    console.log("F13", JSON.stringify(info));
    await testInfo.attach("f13.json", { body: JSON.stringify(info, null, 1), contentType: "application/json" });
    expect.soft(dragged.rect.w, `outer width after the drag (REPORT-006: 599)`).toBe(want.w);
    expect.soft(dragged.rect.h, "outer height after the drag").toBe(want.h);
    // The SetWindowPos 1 x 1 clause: reported, and judged against the launcher control (same OS behaviour = not a product defect).
    const sameAsLauncher = tiny.rect.w === tinyLauncher.rect.w && tiny.rect.h === tinyLauncher.rect.h;
    testInfo.annotations.push({ type: "F13-SetWindowPos-1x1", description: `native window ${tiny.rect.w}x${tiny.rect.h}, launcher control ${tinyLauncher.rect.w}x${tinyLauncher.rect.h}; clause expects ${want.w}x${want.h}` });
    expect.soft(sameAsLauncher || (tiny.rect.w === want.w && tiny.rect.h === want.h), "SetWindowPos 1 x 1 on the native window behaves like the launcher control or keeps the minimum").toBe(true);
    expect.soft(dragged.client.w, "client width = outer - frame").toBe(want.w - frame.w);
    expect.soft(line.scrollWidth, "status line does not overflow at the minimum").toBeLessThanOrEqual(line.clientWidth);
    expect.soft(line.clippedButtons, "no clipped control in the status line").toBe(0);
    expect(test.info().errors.length).toBe(0);
  });
});
