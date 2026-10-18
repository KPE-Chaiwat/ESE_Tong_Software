// REPORT-007: CHK2-F14 (native setup rail + popover below 640, at 466 / 626 / 639 / 640 / 900, live resize across 640 with a focused
// field, pop out with the setup open and closed), CHK2-F15 (pop out timeline with hardware input, 5 runs, O2) and CHK2-F16
// (forced pop out / dock failure with the dev-hooks build; absence of the hook in the normal and release builds).
import { type Desktop, expect, type RealMm, RealNative, test } from "../integration/fixtures";
import { gridState, invokeIn } from "../integration/real-mm";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";
import { hwClick, hwndByTitle, installRecorder, sleep } from "../integration/qa7";
import type { Sim } from "../integration/sim";
import type { NativeWindow } from "../integration/desktop";

const LABEL = process.env.ESEFACT_BINARY_LABEL ?? "default";
const QTY_MSG = "Quantity for FC03 must be from 1 to 125.";

async function liveA(mm: RealMm, sim: Sim): Promise<number> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
  const [a] = await createPolls(mm, [{ name: "A", slave: 1, fc: 3, start: 0, qty: 50, scan: 100 }]);
  await expect(mm.statusLine(a as number)).toHaveAttribute("data-state", "polling");
  return a as number;
}

/** Invalid Quantity 200 in the sub-window's setup (dock), left open or closed. */
async function draftQuantity(mm: RealMm, a: number, leaveOpen: boolean): Promise<void> {
  if (!(await mm.setup(a).isVisible())) await mm.titleButton(a, /^Poll setup/).click();
  await expect(mm.setup(a)).toBeVisible();
  await mm.setupField(a, "Quantity").fill("200");
  await mm.setupField(a, "Quantity").blur();
  await expect(mm.setup(a)).toContainText(QTY_MSG);
  if (!leaveOpen) {
    await mm.titleButton(a, /^Poll setup/).click();
    await expect(mm.setup(a)).toHaveCount(0);
  }
}

async function popOut(desktop: Desktop, mm: RealMm, a: number): Promise<{ nw: RealNative; hwnd: number }> {
  await mm.titleButton(a, /^Open in its own window/).click();
  const page = await desktop.w2Page(a);
  const nw = new RealNative(page);
  await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect(nw.view).toHaveAttribute("data-attach", "attached", { timeout: 20_000 });
  await expect.poll(() => hwndByTitle(desktop, "A - "), { timeout: 15_000 }).not.toBe(0);
  return { nw, hwnd: hwndByTitle(desktop, "A - ") };
}

const winOf = (desktop: Desktop, hwnd: number) => desktop.windows().find((w) => w.hwnd === hwnd) as NativeWindow;

/** Sets the W2 client width so that the PollView root's offsetWidth reads `target` (adjusting by 1 physical px). */
async function setViewWidth(desktop: Desktop, nw: RealNative, hwnd: number, target: number, dpr: number): Promise<string> {
  const w0 = winOf(desktop, hwnd);
  const frameW = w0.rect.w - w0.client.w;
  const base = Math.round(target * dpr);
  // The PollView is narrower than the client when the page shows a vertical scrollbar (a 15 px gutter in narrow windows, see
  // REPORT-007 D6), so the search goes from slightly below to well above the nominal client width.
  const deltas = [0, -1, 1, -2, 2, ...Array.from({ length: 40 }, (_, i) => i + 3)];
  for (const delta of deltas) {
    const clientPhys = Math.max(base + delta, 582);
    desktop.moveWindow(hwnd, w0.rect.x, w0.rect.y, clientPhys + frameW, w0.rect.h);
    try {
      await expect.poll(() => nw.view.evaluate((e) => (e as HTMLElement).offsetWidth), { timeout: 2000, intervals: [50] }).toBe(target);
      const exact = await nw.view.evaluate((e) => e.getBoundingClientRect().width);
      const gutter = await nw.page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
      return `offsetWidth ${target} with client ${clientPhys} px = ${(clientPhys / dpr).toFixed(2)} css px (exact view ${exact.toFixed(2)}, page scrollbar gutter ${gutter} px)`;
    } catch {
      /* try the next physical width */
    }
  }
  throw new Error(`no physical width gives PollView offsetWidth ${target}`);
}

const presentation = (nw: RealNative) => nw.view.getAttribute("data-presentation");
const popover = (nw: RealNative) => nw.page.locator('[data-slot="setup-popover"]');
const activeLabel = (nw: RealNative) =>
  nw.page.evaluate(() => {
    const a = document.activeElement as HTMLInputElement | null;
    return a ? `${a.tagName}|${a.labels?.[0]?.textContent ?? a.getAttribute("aria-label") ?? a.id}` : "none";
  });

test.describe("CHK2-F14 native setup: rail plus popover below 640 px, panel from 640", () => {
  test("pop out with the setup open: the popover is open on arrival at the default 626; then widths 466, 626 and 639 behave as rail + popover", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const a = await liveA(mm, sim);
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    await focusPoll(mm, a);
    await draftQuantity(mm, a, true);
    const { nw, hwnd } = await popOut(desktop, mm, a);
    const log: string[] = [];
    // pop out with the setup open: the popover is open on arrival
    log.push(`arrival: presentation ${await presentation(nw)}, view ${await nw.view.evaluate((e) => (e as HTMLElement).offsetWidth)} css px`);
    await expect(nw.view, "popover open on arrival at client ~626").toHaveAttribute("data-presentation", "popover");
    await expect(nw.field("Quantity")).toHaveValue("200");
    for (const target of [466, 626, 639]) {
      log.push(`--- width ${target}: ${await setViewWidth(desktop, nw, hwnd, target, dpr)}`);
      // start from the rail: close the popover if open
      if ((await presentation(nw)) === "popover") {
        await nw.field("Quantity").focus();
        await nw.page.keyboard.press("Escape");
      }
      await expect(nw.view).toHaveAttribute("data-presentation", "rail");
      const railBox = await nw.rail.boundingBox();
      expect.soft(Math.round(railBox?.width ?? 0), `${target}: rail is 30 px wide`).toBe(30);
      await expect.soft(nw.rail, `${target}: vertical Setup label`).toContainText("Setup");
      await expect.soft(nw.rail.locator('[data-icon="chevron-right"]'), `${target}: chevron-right`).toHaveCount(1);
      await expect.soft(nw.page.getByTestId("rail-unapplied"), `${target}: unapplied-edits dot`).toBeVisible();
      await expect.soft(nw.rail, `${target}: aria-expanded false while closed`).toHaveAttribute("aria-expanded", "false");
      // rail click opens the popover
      await nw.rail.click();
      await expect(nw.view, `${target}: rail click opens the popover`).toHaveAttribute("data-presentation", "popover");
      const pb = (await popover(nw).boundingBox()) as { x: number; y: number; width: number; height: number };
      const vb = (await nw.view.boundingBox()) as { x: number; y: number; width: number; height: number };
      const sl = (await nw.statusLine.boundingBox()) as { y: number; height: number };
      expect.soft(Math.abs(pb.width - 360), `${target}: popover width ${pb.width}`).toBeLessThanOrEqual(0.6);
      expect.soft(Math.abs(pb.x - vb.x - 30), `${target}: popover left edge at x = 30 (${pb.x - vb.x})`).toBeLessThanOrEqual(1);
      expect.soft(pb.y, `${target}: popover top under the status line`).toBeGreaterThanOrEqual(sl.y + sl.height - 1);
      expect.soft(pb.x + pb.width, `${target}: popover right edge <= client width`).toBeLessThanOrEqual(vb.x + vb.width + 0.5);
      expect.soft(pb.y + pb.height, `${target}: popover bottom inside the window`).toBeLessThanOrEqual(vb.y + vb.height + 0.5);
      const scrollInfo = await popover(nw).evaluate((e) => ({ overflowY: getComputedStyle(e).overflowY, scrollable: e.scrollHeight > e.clientHeight }));
      expect.soft(scrollInfo.overflowY, `${target}: popover scrolls when taller than the window`).toBe("auto");
      log.push(`${target}: popover ${pb.width.toFixed(1)} x ${pb.height.toFixed(1)} at x ${pb.x - vb.x}, top ${pb.y - vb.y}, ${JSON.stringify(scrollInfo)}`);
      const q = nw.page.locator('[data-slot="setup-popover"]').getByLabel("Quantity", { exact: true });
      await expect.soft(q, `${target}: Quantity 200 kept`).toHaveValue("200");
      await expect.soft(q, `${target}: aria-invalid`).toHaveAttribute("aria-invalid", "true");
      await expect.soft(popover(nw), `${target}: message`).toContainText(QTY_MSG);
      expect.soft(await activeLabel(nw), `${target}: focus is in Quantity (first invalid field)`).toMatch(/Quantity/);
      await expect.soft(nw.rail, `${target}: aria-expanded true`).toHaveAttribute("aria-expanded", "true");
      // a click on the data card does not close it
      // a point of the data card that the popover does not cover (the popover is 360 px wide from x = 30)
      const gb = (await nw.grid.boundingBox()) as { x: number; y: number; width: number; height: number };
      const cardX = Math.min(vb.x + vb.width - 4, Math.max(pb.x + pb.width + 4, gb.x + gb.width - 6));
      log.push(`${target}: data card click at x ${(cardX - vb.x).toFixed(0)} of ${vb.width.toFixed(0)} (popover right edge ${(pb.x + pb.width - vb.x).toFixed(0)})`);
      if (cardX > pb.x + pb.width + 1) await nw.page.mouse.click(cardX, gb.y + 40);
      await expect.soft(nw.view, `${target}: data card click keeps the popover`).toHaveAttribute("data-presentation", "popover");
      // Esc (from inside the popover) closes it, focus returns to the rail button
      await q.focus();
      await nw.page.keyboard.press("Escape");
      await expect(nw.view, `${target}: Esc closes`).toHaveAttribute("data-presentation", "rail");
      await expect.soft(nw.rail, `${target}: focus returns to the rail`).toBeFocused();
      await expect.soft(nw.rail, `${target}: aria-expanded false after Esc`).toHaveAttribute("aria-expanded", "false");
      // the draft is still there on reopen
      await nw.rail.click();
      await expect(nw.view).toHaveAttribute("data-presentation", "popover");
      await expect.soft(q, `${target}: draft kept on reopen`).toHaveValue("200");
      await expect.soft(popover(nw), `${target}: message kept on reopen`).toContainText(QTY_MSG);
      // [Done] closes it the same way
      await popover(nw).getByRole("button", { name: "Done", exact: true }).click();
      await expect(nw.view, `${target}: Done closes`).toHaveAttribute("data-presentation", "rail");
      await expect.soft(nw.rail, `${target}: focus returns to the rail after Done`).toBeFocused();
      // second rail click and Ctrl+\ each toggle
      await nw.rail.click();
      await expect(nw.view).toHaveAttribute("data-presentation", "popover");
      await nw.rail.click();
      await expect.soft(nw.view, `${target}: second rail click closes`).toHaveAttribute("data-presentation", "rail");
      await nw.page.keyboard.press("Control+Backslash");
      await expect.soft(nw.view, `${target}: Ctrl+\\ opens`).toHaveAttribute("data-presentation", "popover");
      await nw.page.keyboard.press("Control+Backslash");
      await expect.soft(nw.view, `${target}: Ctrl+\\ closes`).toHaveAttribute("data-presentation", "rail");
    }
    await testInfo.attach("f14-narrow.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("F14 narrow", log.join(" || "));
    expect(test.info().errors.length).toBe(0);
  });

  test("widths 640 and 900: panel (340 px), Ctrl+\\ toggles, compact mode shows the rail and a rail click opens the panel; live resize across 640 keeps the draft, the message and the focused field", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const a = await liveA(mm, sim);
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    await focusPoll(mm, a);
    await draftQuantity(mm, a, true);
    const { nw, hwnd } = await popOut(desktop, mm, a);
    const log: string[] = [];
    for (const target of [640, 900]) {
      log.push(`--- width ${target}: ${await setViewWidth(desktop, nw, hwnd, target, dpr)}`);
      await expect(nw.view, `${target}: panel (setup was open)`).toHaveAttribute("data-presentation", "panel");
      const panel = (await nw.setupPanel.boundingBox()) as { width: number };
      expect.soft(Math.abs(panel.width - 340), `${target}: panel width ${panel.width}`).toBeLessThanOrEqual(0.6);
      await expect.soft(nw.setupPanel.getByLabel("Quantity", { exact: true })).toHaveValue("200");
      // Ctrl+\ toggles the panel
      await nw.page.keyboard.press("Control+Backslash");
      await expect.soft(nw.view, `${target}: Ctrl+\\ closes the panel`).toHaveAttribute("data-presentation", "rail");
      await nw.page.keyboard.press("Control+Backslash");
      await expect.soft(nw.view, `${target}: Ctrl+\\ opens the panel`).toHaveAttribute("data-presentation", "panel");
      // compact mode: rail, and a rail click opens the panel (not the popover)
      await nw.page.keyboard.press("Control+Shift+Backslash");
      await expect.soft(nw.view, `${target}: compact shows the rail`).toHaveAttribute("data-presentation", "rail");
      await nw.rail.click();
      await expect.soft(nw.view, `${target}: compact + rail click opens the panel, not the popover`).toHaveAttribute("data-presentation", "panel");
      await nw.page.keyboard.press("Control+Shift+Backslash"); // compact off
      log.push(`${target}: panel ${panel.width.toFixed(1)} px`);
    }
    // live change across 640 with a focused field
    log.push(`--- live: ${await setViewWidth(desktop, nw, hwnd, 639, dpr)}`);
    await expect(nw.view).toHaveAttribute("data-presentation", /rail|popover/);
    if ((await presentation(nw)) === "rail") await nw.rail.click();
    await expect(nw.view).toHaveAttribute("data-presentation", "popover");
    const scanIn = (host: string) => nw.page.locator(host).getByLabel("Scan rate (ms)", { exact: true });
    await scanIn('[data-slot="setup-popover"]').click();
    await scanIn('[data-slot="setup-popover"]').press("End");
    expect(await activeLabel(nw)).toMatch(/Scan rate/);
    log.push(`639 popover focus before widening: ${await activeLabel(nw)}`);
    await setViewWidth(desktop, nw, hwnd, 640, dpr);
    await expect(nw.view, "640: the panel opens with the same draft").toHaveAttribute("data-presentation", "panel");
    await expect.soft(nw.setupPanel.getByLabel("Quantity", { exact: true })).toHaveValue("200");
    await expect.soft(nw.setupPanel).toContainText(QTY_MSG);
    const f640 = await activeLabel(nw);
    log.push(`640 panel focus after widening: ${f640}`);
    expect.soft(f640, "m-3: the focused field stays focused when the popover becomes the panel").toMatch(/Scan rate/);
    await setViewWidth(desktop, nw, hwnd, 639, dpr);
    await expect(nw.view, "639: the popover is open again").toHaveAttribute("data-presentation", "popover");
    await expect.soft(popover(nw).getByLabel("Quantity", { exact: true })).toHaveValue("200");
    await expect.soft(popover(nw)).toContainText(QTY_MSG);
    const f639 = await activeLabel(nw);
    log.push(`639 popover focus after narrowing: ${f639}`);
    expect.soft(f639, "m-3: the focused field stays focused when the panel becomes the popover").toMatch(/Scan rate/);
    await testInfo.attach("f14-wide.log", { body: log.join("\n"), contentType: "text/plain" });
    console.log("F14 wide", log.join(" || "));
    expect(test.info().errors.length).toBe(0);
  });

  test("pop out with the setup closed: the rail (not the popover) on arrival at ~626", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    const a = await liveA(mm, sim);
    await focusPoll(mm, a);
    await draftQuantity(mm, a, false);
    const { nw } = await popOut(desktop, mm, a);
    await expect(nw.view).toHaveAttribute("data-presentation", "rail");
    await expect(nw.page.getByTestId("rail-unapplied")).toBeVisible();
    await nw.rail.click();
    await expect(nw.view, "O1: a rail click now opens the popover at the default size").toHaveAttribute("data-presentation", "popover");
    await expect(nw.page.locator('[data-slot="setup-popover"]')).toContainText(QTY_MSG);
  });
});

test.describe("INT-EXTRA native window layout at narrow widths", () => {
  test("the native window never shows a page scrollbar: its bottom status bar fits the window width at every client width from the minimum up", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(150_000);
    const a = await liveA(mm, sim);
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);
    await focusPoll(mm, a);
    const { nw, hwnd } = await popOut(desktop, mm, a);
    const rows: Array<Record<string, unknown>> = [];
    for (const outer of [800, 760, 740, 720, 700, 680, 660, 640, 620, 601, 600]) {
      const w0 = winOf(desktop, hwnd);
      desktop.moveWindow(hwnd, w0.rect.x, w0.rect.y, outer, w0.rect.h);
      await expect.poll(() => winOf(desktop, hwnd).rect.w).toBe(outer);
      await sleep(400);
      const m = await nw.page.evaluate(() => {
        const de = document.documentElement;
        const st = document.querySelector('[data-testid="native-status-text"], [data-slot="native-status-text"]') as HTMLElement | null;
        const ver = document.querySelector('[data-testid="app-version"], [data-slot="app-version"]') as HTMLElement | null;
        return { inner: window.innerWidth, gutter: window.innerWidth - de.clientWidth, docScrollH: de.scrollHeight, innerH: window.innerHeight, statusTextH: st ? Math.round(st.getBoundingClientRect().height * 10) / 10 : null, versionH: ver ? Math.round(ver.getBoundingClientRect().height * 10) / 10 : null, view: (document.querySelector('[data-slot="poll-view"]') as HTMLElement).offsetWidth };
      });
      rows.push({ outer, client: winOf(desktop, hwnd).client.w, ...m });
    }
    console.log("INT-EXTRA scrollbar", JSON.stringify(rows));
    await testInfo.attach("native-scrollbar.json", { body: JSON.stringify(rows, null, 1), contentType: "application/json" });
    await testInfo.attach("native-min-width.png", { body: await nw.page.screenshot(), contentType: "image/png" });
    {
      const fs = await import("node:fs");
      fs.mkdirSync("test-results/evidence", { recursive: true });
      fs.writeFileSync(`test-results/evidence/d6-native-min-width-${LABEL}.png`, await nw.page.screenshot());
    }
    for (const r of rows) {
      expect.soft(r.gutter, `outer ${r.outer} (inner ${r.inner} css px): no page scrollbar gutter (document ${r.docScrollH} px vs window ${r.innerH} px; status text ${r.statusTextH} px high)`).toBe(0);
    }
    expect(test.info().errors.length).toBe(0);
    void dpr;
  });
});

test.describe("CHK2-F15 pop out timeline with the real backend (hardware click, 5 runs)", () => {
  test("click -> spinner -> sub-window removed -> native window listed -> W2 ready with values: d - click <= 1000 ms, d - b <= 1000 ms", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(240_000);
    const a = await liveA(mm, sim);
    const w1 = hwndByTitle(desktop, "Modbus Master");
    const runs: Array<Record<string, unknown>> = [];
    for (let run = 1; run <= 5; run += 1) {
      await focusPoll(mm, a);
      await installRecorder(mm.page);
      await mm.page.evaluate((id) => {
        const w = window as unknown as { __tl: Record<string, number> };
        const now = () => performance.timeOrigin + performance.now();
        w.__tl = { click: 0, removed: 0, spinStart: 0, spinEnd: 0, reappeared: 0 };
        const sel = `[data-subwindow="${id}"] [data-slot="title-bar"] button[aria-label^="Open in its own window"]`;
        window.addEventListener("click", () => { if (!w.__tl.click) w.__tl.click = now(); }, true);
        new MutationObserver(() => {
          const btn = document.querySelector(sel);
          const t = now();
          if (btn?.getAttribute("aria-busy") === "true" && !w.__tl.spinStart) w.__tl.spinStart = t;
          const present = document.querySelector(`[data-subwindow="${id}"]`) !== null;
          if (!present && w.__tl.click && !w.__tl.removed) w.__tl.removed = t;
          if (present && w.__tl.removed && !w.__tl.reappeared) w.__tl.reappeared = t;
          if (w.__tl.spinStart && !w.__tl.spinEnd && (!btn || btn.getAttribute("aria-busy") !== "true")) w.__tl.spinEnd = t;
        }).observe(document.body, { childList: true, subtree: true, attributes: true });
      }, a);
      const before = desktop.windows().filter((w) => w.title.startsWith("A - ")).length;
      expect(before).toBe(0);
      await hwClick(desktop, w1, mm.page, mm.titleButton(a, /^Open in its own window/));
      let listedAt = 0;
      const deadline = Date.now() + 15_000;
      while (!listedAt && Date.now() < deadline) {
        if (desktop.windows().some((w) => w.title.startsWith("A - "))) listedAt = Date.now();
        else await sleep(10);
      }
      const page = await desktop.w2Page(a);
      const nw = new RealNative(page);
      let readyAt = 0;
      let waitingText = -1;
      while (!readyAt && Date.now() < deadline) {
        const ready = await nw.root.getAttribute("data-ready").catch(() => null);
        const live = await nw.grid.getAttribute("data-status").catch(() => null);
        if (ready === "true" && live === "live") {
          readyAt = Date.now();
          waitingText = await nw.page.getByText(/Waiting for first response/).count();
        } else await sleep(10);
      }
      const tl = (await mm.page.evaluate(() => (window as unknown as { __tl: Record<string, number> }).__tl)) as { click: number; removed: number; spinStart: number; spinEnd: number; reappeared: number };
      const nativeCount = desktop.windows().filter((w) => w.title.startsWith("A - ")).length;
      const row = {
        run,
        a_spinnerFromClickMs: tl.spinStart ? Math.round(tl.spinStart - tl.click) : null,
        a_spinnerEndMs: tl.spinEnd ? Math.round(tl.spinEnd - tl.click) : null,
        b_subWindowRemovedMs: Math.round(tl.removed - tl.click),
        c_nativeListedMs: listedAt - Math.round(tl.click),
        d_readyWithValuesMs: readyAt - Math.round(tl.click),
        gap_d_minus_b: readyAt - Math.round(tl.removed),
        reappeared: tl.reappeared !== 0,
        nativeWindows: nativeCount,
        waitingForFirstResponse: waitingText,
      };
      runs.push(row);
      console.log("F15", JSON.stringify(row));
      expect.soft(row.d_readyWithValuesMs, `run ${run}: d - click <= 1000`).toBeLessThanOrEqual(1000);
      expect.soft(row.gap_d_minus_b, `run ${run}: d - b <= 1000`).toBeLessThanOrEqual(1000);
      expect.soft(row.reappeared, `run ${run}: the sub-window does not reappear`).toBe(false);
      expect.soft(nativeCount, `run ${run}: one native window`).toBe(1);
      expect.soft(waitingText, `run ${run}: no 'Waiting for first response'`).toBe(0);
      expect.soft(row.a_spinnerFromClickMs, `run ${run}: spinner state shown from the click`).not.toBeNull();
      // dock back for the next run
      await nw.toolbarButton("Dock to workspace").click();
      await expect(mm.sub(a)).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => desktop.windows().filter((w) => w.title.startsWith("A - ")).length).toBe(0);
    }
    await testInfo.attach("f15.json", { body: JSON.stringify(runs, null, 1), contentType: "application/json" });
    expect(test.info().errors.length).toBe(0);
  });
});

test.describe("CHK2-F16 forced pop out and dock failure (dev-hooks build) and absence of the hook elsewhere", () => {
  test("the dev hook is ABSENT in this build: dev_fail_next_window_op is rejected as an unknown command and pop out / dock work", async ({ desktop, mm, sim }, testInfo) => {
    test.skip(LABEL === "hooks", "this is the dev-hooks build");
    test.setTimeout(120_000);
    const a = await liveA(mm, sim);
    const result = await mm.page.evaluate(async () => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      try {
        const r = await internals.invoke("dev_fail_next_window_op", { kind: "popOut", message: "boom" });
        return { ok: true, value: JSON.stringify(r) };
      } catch (e) {
        return { ok: false, value: typeof e === "string" ? e : JSON.stringify(e) };
      }
    });
    console.log(`F16 absent (${LABEL}):`, JSON.stringify(result));
    await testInfo.attach("f16-absent.json", { body: JSON.stringify({ label: LABEL, result }), contentType: "application/json" });
    expect(result.ok, "the hook command must be rejected").toBe(false);
    expect(result.value.toLowerCase(), "rejected as an unknown command").toMatch(/not found|unknown|not allowed/);
    // no pop out / dock fails
    await focusPoll(mm, a);
    const { nw } = await popOut(desktop, mm, a);
    await nw.toolbarButton("Dock to workspace").click();
    await expect(mm.sub(a)).toBeVisible({ timeout: 15_000 });
  });

  test("pop out failure: the sub-window stays with values, selection, scroll, draft and focus; toast 'Could not open the poll window: boom'; no native window even for an instant; polling continues; the next pop out works", async ({ desktop, mm, sim }, testInfo) => {
    test.skip(LABEL !== "hooks", "needs the dev-hooks build");
    test.setTimeout(150_000);
    const a = await liveA(mm, sim);
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    await mm.gridRow(a, 5).click({ modifiers: ["Shift"] });
    await mm.grid(a).evaluate((el) => {
      el.scrollTop = 2 * 24;
    });
    await expect.poll(() => gridState(mm.grid(a))).toEqual({ selected: [3, 4, 5], top: 2 });
    await draftQuantity(mm, a, false);
    const rect = await mm.domRect(a);
    const stateBefore = await gridState(mm.grid(a));
    const hookResult = await invokeIn(mm.page, "dev_fail_next_window_op", { kind: "popOut", message: "boom" });
    expect(hookResult, "arming returns null").toBeNull();
    const w1 = hwndByTitle(desktop, "Modbus Master");
    const mark = sim.mark();
    // sample the OS window list every 10 ms from before the click until after the toast
    let sawNative = 0;
    let samples = 0;
    let stop = false;
    const sampler = (async () => {
      while (!stop) {
        if (desktop.windows().some((w) => w.title.startsWith("A - ") || (w.cls === "Tauri Window" && !w.title.startsWith("Modbus Master") && w.title !== "ESEfact"))) sawNative += 1;
        samples += 1;
        await sleep(10);
      }
    })();
    await hwClick(desktop, w1, mm.page, mm.titleButton(a, /^Open in its own window/));
    await expect(mm.toast("Could not open the poll window: boom"), "error toast").toBeVisible({ timeout: 10_000 });
    await sleep(800);
    stop = true;
    await sampler;
    const focus = await mm.page.evaluate((id) => {
      const el = document.activeElement as HTMLElement | null;
      return { insideSub: !!el?.closest(`[data-subwindow="${id}"]`), tag: el?.tagName ?? "none", label: el?.getAttribute("aria-label") ?? "" };
    }, a);
    const btn = mm.titleButton(a, /^Open in its own window/);
    await expect(btn, "the button left its spinner state").not.toHaveAttribute("aria-busy", "true");
    await expect(mm.sub(a)).toBeVisible();
    await mm.expectDomRect(a, rect);
    expect(await gridState(mm.grid(a)), "selection and scroll kept").toEqual(stateBefore);
    expect(await mm.grid(a).getAttribute("data-status"), "values kept").toBe("live");
    // draft kept: open the setup and read it
    await mm.titleButton(a, /^Poll setup/).click();
    await expect(mm.setupField(a, "Quantity")).toHaveValue("200");
    await mm.titleButton(a, /^Poll setup/).click();
    expect.soft(focus.insideSub, `CHK2-F16: focus stays in the sub-window after the failed pop out (${JSON.stringify(focus)})`).toBe(true);
    expect(sawNative, `no native window in ${samples} OS samples (10 ms)`).toBe(0);
    expect(desktop.windows().filter((w) => w.title.startsWith("A - ")).length).toBe(0);
    await expect(mm.row(a)).not.toContainText("own window");
    const exported = await mm.exportProfile();
    const host = exported.polls?.find((p: { name: string }) => p.name === "A")?.view?.host;
    expect(host, "export shows host workspace").toBe("workspace");
    // polling continued without a gap longer than 2 scan periods (100 ms) + slack
    const reqs = sim.requestsDecoded(mark).filter((r) => r.unit === 1).map((r) => r.epoch);
    const gaps = reqs.slice(1).map((t, i) => t - (reqs[i] as number));
    console.log("F16 popOut", JSON.stringify({ samples, sawNative, maxGap: Math.max(...gaps), requests: reqs.length, focus, host }));
    await testInfo.attach("f16-popout.json", { body: JSON.stringify({ samples, sawNative, maxGap: Math.max(...gaps), requests: reqs.length, focus, host }), contentType: "application/json" });
    expect(Math.max(...gaps), "no gap longer than 2 scan periods (+ timer slack)").toBeLessThanOrEqual(230);
    // the next pop out (hook disarmed) succeeds
    const { nw } = await popOut(desktop, mm, a);
    await expect(nw.grid).toHaveAttribute("data-status", "live");
    // a second arming replaces an unused arm and is consumed once
    expect(await invokeIn(mm.page, "dev_fail_next_window_op", { kind: "dock", message: "first" })).toBeNull();
    expect(await invokeIn(mm.page, "dev_fail_next_window_op", { kind: "dock", message: "second" })).toBeNull();
    await nw.toolbarButton("Dock to workspace").click();
    await expect(nw.toasts.filter({ hasText: "Could not dock the poll: second" }), "re-arming replaced the first message").toBeVisible({ timeout: 10_000 });
    await nw.toolbarButton("Dock to workspace").click();
    await expect(mm.sub(a)).toBeVisible({ timeout: 15_000 });
    expect(test.info().errors.length, "soft failures of this test").toBe(0);
  });

  test("dock failure: the W2 stays with values and draft, toast 'Could not dock the poll: boom' in the W2, no sub-window in W1, W1 not brought to the front, host native, polling continues", async ({ desktop, mm, sim }, testInfo) => {
    test.skip(LABEL !== "hooks", "needs the dev-hooks build");
    test.setTimeout(150_000);
    const a = await liveA(mm, sim);
    await focusPoll(mm, a);
    await draftQuantity(mm, a, false);
    const { nw, hwnd: w2 } = await popOut(desktop, mm, a);
    const w1 = hwndByTitle(desktop, "Modbus Master");
    await nw.gridRow(3).click();
    await expect.poll(() => desktop.foregroundHwnd(), { message: "the W2 is in front before the dock" }).toBe(w2);
    expect(await invokeIn(nw.page, "dev_fail_next_window_op", { kind: "dock", message: "boom" })).toBeNull();
    const mark = sim.mark();
    await nw.toolbarButton("Dock to workspace").click();
    await expect(nw.toasts.filter({ hasText: "Could not dock the poll: boom" }), "error toast in the W2").toBeVisible({ timeout: 10_000 });
    await sleep(600);
    expect(hwndByTitle(desktop, "A - "), "the W2 stays").toBe(w2);
    await expect(mm.sub(a), "no sub-window appears in W1").toHaveCount(0);
    expect(desktop.foregroundHwnd(), "W1 is not brought to the front (the W2 keeps the foreground)").toBe(w2);
    expect(desktop.foregroundHwnd()).not.toBe(w1);
    await expect(nw.grid).toHaveAttribute("data-status", "live");
    // the draft is still there
    await nw.rail.click();
    await expect(nw.page.locator('[data-slot="setup-popover"]')).toContainText(QTY_MSG);
    await expect(nw.field("Quantity")).toHaveValue("200");
    const exported = await mm.exportProfile();
    const host = exported.polls?.find((p: { name: string }) => p.name === "A")?.view?.host;
    expect(host, "host stays native").toBe("native");
    const reqs = sim.requestsDecoded(mark).filter((r) => r.unit === 1).map((r) => r.epoch);
    const gaps = reqs.slice(1).map((t, i) => t - (reqs[i] as number));
    console.log("F16 dock", JSON.stringify({ maxGap: Math.max(...gaps), requests: reqs.length, host }));
    await testInfo.attach("f16-dock.json", { body: JSON.stringify({ maxGap: Math.max(...gaps), requests: reqs.length, host }), contentType: "application/json" });
    expect(Math.max(...gaps)).toBeLessThanOrEqual(230);
    // disarmed: the next dock works
    await nw.page.keyboard.press("Escape");
    await nw.toolbarButton("Dock to workspace").click();
    await expect(mm.sub(a)).toBeVisible({ timeout: 15_000 });
  });
});
