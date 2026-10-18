// Integration mode (REPORT-006), (e): Arrange for native windows on the real monitor (1 monitor, 125 %). The oracle is an
// independent implementation of DES-002 2.8 (integration/arrange-math.ts) applied to the monitor's real work area.
// CHK2-H1, H2, H3, H6, F13 (minimum size); [MON2] items H4, H5, F4 are skipped (one monitor).
import { type Desktop, expect, type RealMm, test } from "../integration/fixtures";
import { arrange, type Layout, overlaps, type R, toPhysical } from "../integration/arrange-math";
import { monitorsPx, trayRect } from "../integration/desktop";
import { openProfile, profileV2 } from "../integration/profiles";
import { writeProfile } from "../integration/profiles";

const pad = (i: number) => String(i + 1).padStart(2, "0");

/** Writes a profile with n polls that open as native windows (no saved placement: cascade rule) and opens it. */
async function openManyNative(desktop: Desktop, mm: RealMm, n: number): Promise<void> {
  writeProfile(
    desktop,
    "Many",
    profileV2(
      "Many",
      Array.from({ length: n }, (_, i) => ({ name: `W${pad(i)}`, host: "native" as const, open: true, native: null, scan: 1000 })),
    ),
  );
  await openProfile(mm, "Many");
  await expect.poll(() => polls(desktop).length, { timeout: 30_000, message: `${n} native windows` }).toBe(n);
}

/** The native poll windows in list order (title "W01 - Many - Offline"). */
function polls(desktop: Desktop) {
  return desktop
    .windows()
    .filter((w) => /^W\d\d - /.test(w.title))
    .sort((a, b) => a.title.localeCompare(b.title));
}

async function arrangeVia(mm: RealMm, label: string): Promise<void> {
  await mm.openMenu("Window");
  await mm.menuItem("Popped-out windows").click();
  await mm.page.getByRole("menu").last().getByRole("menuitem", { name: new RegExp(`^${label}`) }).click();
}

function workArea() {
  const m = monitorsPx().find((x) => x.primary) ?? monitorsPx()[0];
  if (!m) throw new Error("no monitor");
  return { px: m.work, scale: m.scale, logical: { x: m.work.x / m.scale, y: m.work.y / m.scale, w: m.work.w / m.scale, h: m.work.h / m.scale } as R };
}

/** Measures every window against the expected rectangles; returns a table for the report. */
function compare(desktop: Desktop, layout: Layout, n: number, wa: ReturnType<typeof workArea>) {
  const exp = arrange(layout, wa.logical, n);
  const got = polls(desktop);
  const table = got.map((w, i) => {
    const want = toPhysical(exp.rects[i] as R, wa.scale);
    return { poll: w.title.slice(0, 3), want, got: w.rect, frame: w.frame, client: w.client, dx: w.rect.x - want.x, dy: w.rect.y - want.y, dw: w.rect.w - want.w, dh: w.rect.h - want.h };
  });
  return { exp, table };
}

test.describe("(e) arrange native windows", () => {
  test("INT-E-0 environment: monitor, scale, work area, taskbar, and the real frame of a native window versus the backend assumption", async ({ desktop, mm }, testInfo) => {
    const monitors = monitorsPx();
    const tray = trayRect();
    const real = await mm.monitors();
    await openManyNative(desktop, mm, 1);
    const w = polls(desktop)[0];
    const frame = { w: (w?.rect.w ?? 0) - (w?.client.w ?? 0), h: (w?.rect.h ?? 0) - (w?.client.h ?? 0) };
    const info = {
      monitorsPx: monitors,
      taskbar: tray,
      appListMonitors: real,
      nativeWindow: w,
      frameFromWin32PhysicalPx: frame,
      frameLogical: { w: frame.w / (monitors[0]?.scale ?? 1), h: frame.h / (monitors[0]?.scale ?? 1) },
      backendAssumptionAt100Percent: { w: 16, h: 39 },
      dwmVisibleFrameVsRect: { rect: w?.rect, frame: w?.frame },
    };
    console.log("ENV", JSON.stringify(info));
    await testInfo.attach("environment.json", { body: JSON.stringify(info, null, 1), contentType: "application/json" });
    // app_list_monitors agrees with Win32: logical work area x scale = physical work area
    const m0 = monitors.find((m) => m.primary) as (typeof monitors)[number];
    const r0 = real.find((m) => m.primary) as (typeof real)[number];
    expect(r0.scaleFactor).toBeCloseTo(m0.scale, 3);
    expect(Math.round(r0.workArea.width * r0.scaleFactor)).toBe(m0.work.w);
    expect(Math.round(r0.workArea.height * r0.scaleFactor)).toBe(m0.work.h);
    // the work area excludes the taskbar
    expect(m0.work.y + m0.work.h).toBeLessThanOrEqual(tray.y);
  });

  for (const [n, layout] of [
    [4, "tile"],
    [6, "tile"],
    [9, "tile"],
    [13, "tile"],
    [3, "sideBySide"],
    [3, "stacked"],
    [3, "cascade"],
  ] as Array<[number, Layout]>) {
    test(`CHK2-H1/H2/H3 ${layout} with ${n} native windows: rectangles equal the DES-002 2.8 result for this work area, nothing under the taskbar`, async ({ desktop, mm }, testInfo) => {
      test.setTimeout(120_000);
      const wa = workArea();
      await openManyNative(desktop, mm, n);
      const label = { tile: "Tile", sideBySide: "Side by side", stacked: "Stacked", cascade: "Cascade" }[layout];
      await arrangeVia(mm, label);
      const { exp, table } = compare(desktop, layout, n, wa);
      // the windows move one after the other: wait until the last one is where it should be
      await expect
        .poll(() => compare(desktop, layout, n, wa).table.every((r) => r.dx === 0 && r.dy === 0 && r.dw === 0 && r.dh === 0), {
          timeout: 15_000,
          message: "every window at its expected rectangle",
          intervals: [250],
        })
        .toBe(true)
        .catch(() => undefined);
      const final = compare(desktop, layout, n, wa);
      console.log(`ARRANGE ${layout} n=${n} workArea=${JSON.stringify(wa.px)} scale=${wa.scale} tiled=${exp.tiled} overflow=${exp.overflow}`, JSON.stringify(final.table.map((r) => ({ p: r.poll, want: r.want, got: r.got, d: [r.dx, r.dy, r.dw, r.dh] }))));
      await testInfo.attach(`arrange-${layout}-${n}.json`, { body: JSON.stringify({ workArea: wa.px, scale: wa.scale, expected: exp, table: final.table }, null, 1), contentType: "application/json" });
      void table;
      for (const r of final.table) {
        expect([r.dx, r.dy, r.dw, r.dh], `${r.poll} rect delta (got ${JSON.stringify(r.got)}, want ${JSON.stringify(r.want)})`).toEqual([0, 0, 0, 0]);
      }
      // every window is inside the work area (nothing under the taskbar), the tiled ones do not overlap
      const wp = wa.px;
      for (const r of final.table) {
        expect(r.got.x, `${r.poll} left`).toBeGreaterThanOrEqual(wp.x);
        expect(r.got.y, `${r.poll} top`).toBeGreaterThanOrEqual(wp.y);
        expect(r.got.x + r.got.w, `${r.poll} right`).toBeLessThanOrEqual(wp.x + wp.w);
        expect(r.got.y + r.got.h, `${r.poll} bottom (taskbar starts at ${trayRect().y})`).toBeLessThanOrEqual(wp.y + wp.h);
      }
      const tiledRects = final.table.slice(0, exp.tiled).map((r) => r.got);
      for (let i = 0; i < tiledRects.length; i += 1) {
        for (let j = i + 1; j < tiledRects.length; j += 1) {
          if (layout !== "cascade") expect(overlaps(tiledRects[i] as R, tiledRects[j] as R), `tiles ${i} and ${j} overlap`).toBe(false);
        }
      }
      if (exp.overflow > 0) await expect(mm.toast(new RegExp(`${exp.overflow} windows? did not fit and (were|was) cascaded\\.`))).toBeVisible();
      // each window's minimum is the OS minimum, the tiles never go below 480 x 320 logical outer
      for (const r of final.table.slice(0, exp.tiled)) {
        expect(r.got.w, `${r.poll} width >= 480 logical`).toBeGreaterThanOrEqual(Math.round(480 * wa.scale));
        expect(r.got.h, `${r.poll} height >= 320 logical`).toBeGreaterThanOrEqual(Math.round(320 * wa.scale));
      }
    });
  }

  test("CHK2-H6 no native window: the 'Popped-out windows' item is disabled with its title; with one native window Tile fills the work area", async ({ desktop, mm }) => {
    await mm.openMenu("Window");
    const item = mm.page.getByRole("menuitem", { name: /^Popped-out windows/ });
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toHaveAttribute("title", "No poll is open in its own window.");
    await mm.page.keyboard.press("Escape");
    const wa = workArea();
    await openManyNative(desktop, mm, 1);
    await arrangeVia(mm, "Tile");
    const want = toPhysical(wa.logical, wa.scale);
    await expect.poll(() => polls(desktop)[0]?.rect, { timeout: 10_000 }).toEqual(want);
  });

  test("CHK2-H1 Ctrl+Shift+T in a native window tiles the native windows (4)", async ({ desktop, mm }) => {
    test.setTimeout(90_000);
    const wa = workArea();
    await openManyNative(desktop, mm, 4);
    const first = await desktop.w2Page(1);
    await first.bringToFront();
    await first.keyboard.press("Control+Shift+T");
    const exp = arrange("tile", wa.logical, 4).rects.map((r) => toPhysical(r, wa.scale));
    await expect.poll(() => polls(desktop).map((w) => w.rect), { timeout: 15_000 }).toEqual(exp);
  });

  test("CHK2-F13 a native window cannot be made smaller than 480 x 320 logical OUTER (real OS resize drags)", async ({ desktop, mm }) => {
    const wa = workArea();
    await openManyNative(desktop, mm, 1);
    const w = polls(desktop)[0];
    const hwnd = w?.hwnd as number;
    const get = () => desktop.windows().find((x) => x.hwnd === hwnd);
    // a free spot with room on both sides
    desktop.moveWindow(hwnd, 100, 60, Math.round(900 * wa.scale), Math.round(500 * wa.scale));
    await expect.poll(() => get()?.rect.x).toBe(100);
    const r = get()?.rect as R;
    const f = get()?.frame as R;
    desktop.showWindow(hwnd, "focus");
    desktop.mouseDrag(f.x + f.w - 1, r.y + 200, r.x + 200, r.y + 200, 25, 20); // right edge to the left
    await expect.poll(() => get()?.rect.w, { message: "narrowed" }).toBeLessThan(Math.round(900 * wa.scale));
    desktop.mouseDrag(r.x + 300, r.y, r.x + 300, r.y + 800, 25, 20); // top edge down
    await expect.poll(() => get()?.rect.h, { message: "shortened" }).toBeLessThan(Math.round(500 * wa.scale));
    const min = get()?.rect as R;
    console.log("NATIVE MIN OUTER (physical px)", JSON.stringify(min), "logical", min.w / wa.scale, min.h / wa.scale);
    // the W2 status line at the minimum width (REPORT-005 O3): nothing clipped, step recorded
    const page = await desktop.w2Page(1);
    const line = await page.evaluate(() => {
      const l = document.querySelector('[data-testid="poll-status-line"]') as HTMLElement;
      const r = l.getBoundingClientRect();
      const acts = [...l.querySelectorAll("button")].map((b) => ({ label: b.getAttribute("aria-label") ?? b.innerText, right: Math.round(b.getBoundingClientRect().right * 10) / 10 }));
      return { L: Math.round(r.width * 10) / 10, step: l.getAttribute("data-step"), scrollWidth: l.scrollWidth, clientWidth: l.clientWidth, counters: (l.querySelector('[data-slot="counters"]') as HTMLElement | null)?.textContent, viewportWidth: window.innerWidth, buttons: acts };
    });
    console.log("W2 STATUS LINE AT THE MINIMUM", JSON.stringify(line));
    expect(line.scrollWidth, "the status line of a native window at the minimum width does not scroll").toBeLessThanOrEqual(line.clientWidth);
    expect(min.w, "outer minimum width = 480 logical").toBe(Math.round(480 * wa.scale));
    expect(min.h, "outer minimum height = 320 logical").toBe(Math.round(320 * wa.scale));
  });
});
