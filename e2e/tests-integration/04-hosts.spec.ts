// Integration mode (REPORT-006), (d): real pop out and dock. Native windows (W2) are separate webviews and real
// top-level windows. CHK2-F1..F3, F5-F7, F9, F11-F13, G1/G2 (native), D5, A5 (W2 part); REV-006 M-1 timeline.
import { type Desktop, expect, type RealMm, type Sim, test } from "../integration/fixtures";
import { LOGICAL_OFFSET } from "../integration/helpers";
import { gridState, RealNative } from "../integration/real-mm";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";

const SPECS = [
  { name: "A", slave: 1, fc: 3 as const, start: 0, qty: 50, scan: 100 },
  { name: "B", slave: 2, fc: 3 as const, start: 10, qty: 5, scan: 100 },
];

async function liveAB(mm: RealMm, sim: Sim, timeoutMs = 1000): Promise<number[]> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs });
  const ids = await createPolls(mm, SPECS);
  for (const id of ids) await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
  return ids;
}

async function w2Of(desktop: Desktop, id: number): Promise<RealNative> {
  const page = await desktop.w2Page(id);
  const nw = new RealNative(page);
  await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect(nw.view).toHaveAttribute("data-attach", "attached", { timeout: 20_000 });
  return nw;
}

/** The scale factor of the W1 window (125 % on this machine). */
const dprOf = (mm: RealMm) => mm.page.evaluate(() => window.devicePixelRatio);

test.describe("(d) pop out and dock", () => {
  test("CHK2-F1 pop out (button) keeps values, selection, scroll and an invalid draft; native window title, rectangle, markers", async ({ desktop, mm, sim }) => {
    test.setTimeout(90_000);
    const [a] = (await liveAB(mm, sim)) as [number, number];
    const dpr = await dprOf(mm);
    // setup: rows 3-5 selected, address 2 on top, invalid Quantity "200" in the draft
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    await mm.gridRow(a, 5).click({ modifiers: ["Shift"] });
    await mm.grid(a).evaluate((el) => {
      el.scrollTop = 2 * 24;
    });
    await expect.poll(() => gridState(mm.grid(a))).toEqual({ selected: [3, 4, 5], top: 2 });
    await mm.titleButton(a, /^Poll setup/).click();
    await mm.setupField(a, "Quantity").fill("200");
    await mm.setupField(a, "Quantity").blur();
    await expect(mm.setup(a)).toContainText(/Quantity/);
    await mm.titleButton(a, /^Poll setup/).click(); // close the dock again (the draft is kept)
    const subRect = await mm.domRect(a);
    const before = desktop.windows().length;

    await mm.titleButton(a, /^Open in its own window/).click();
    const nw = await w2Of(desktop, a);
    // the sub-window is gone, the sidebar says "own window", the status bar counts it
    await expect(mm.sub(a)).toHaveCount(0);
    await expect(mm.row(a)).toContainText("own window");
    await expect.poll(async () => (await mm.statusBar.innerText()).replace(/\s+/g, " ")).toContain("1 in its own window");
    // live values at once: the grid is live and no "Waiting for first response" text
    await expect(nw.grid).toHaveAttribute("data-status", "live");
    await expect(nw.page.getByText(/Waiting for first response/)).toHaveCount(0);
    expect((await nw.cells(1)).at(-1)).toBe("65535");
    expect(await gridState(nw.grid), "selection and scroll position handed over").toEqual({ selected: [3, 4, 5], top: 2 });
    // native window: title, size and position of the sub-window on screen
    await expect.poll(() => desktop.windows().length).toBe(before + 1);
    // DES-002 2.12: the native title is "{poll name} - {profile or Untitled} - {pill label}", no modified marker
    const title = "A - Untitled - Polling";
    await expect.poll(() => desktop.windows().map((w) => w.title)).toContain(title);
    const win = desktop.windows().find((w) => w.title === title);
    expect(win, "native poll window").toBeTruthy();
    const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    const ws = await mm.workspace.boundingBox();
    // sub-window screen position = W1 client origin + workspace origin + rect, all in physical px
    const expectX = Math.round((w1?.client.x ?? 0) + ((ws?.x ?? 0) + subRect.x) * dpr);
    const expectY = Math.round((w1?.client.y ?? 0) + ((ws?.y ?? 0) + subRect.y) * dpr);
    console.log("POPOUT RECT", JSON.stringify({ win: win?.rect, frame: win?.frame, client: win?.client, expectX, expectY, subRect, dpr }));
    expect(win?.rect.x, "x = sub-window screen x").toBeCloseTo(expectX, -1);
    expect(win?.rect.y, "y = sub-window screen y").toBeCloseTo(expectY, -1);
    expect(win?.rect.w, "outer width = sub-window width").toBe(Math.round(subRect.width * dpr));
    expect(win?.rect.h, "outer height = sub-window height").toBe(Math.round(subRect.height * dpr));
    expect(win?.foreground, "the new window has the focus").toBe(true);
    // the draft: Quantity 200 with its message. REPORT-007 (O1 fixed, D-002-23): the setup was closed in the sub-window, so the pop out
    // (outer 640 x 368 logical, client below 640) arrives as the rail, and a rail click opens the POPOVER with the draft.
    await expect(nw.view).toHaveAttribute("data-presentation", "rail");
    await nw.rail.click();
    await expect(nw.view, "O1: below 640 px of client width the rail opens the popover").toHaveAttribute("data-presentation", "popover");
    await expect(nw.page.locator('[data-slot="setup-popover"]').getByLabel("Quantity", { exact: true })).toHaveValue("200");
    const wnow = desktop.windows().find((w) => w.title === "A - Untitled - Polling");
    desktop.moveWindow(wnow?.hwnd as number, wnow?.rect.x ?? 0, wnow?.rect.y ?? 0, Math.round(900 * dpr), wnow?.rect.h ?? 0);
    await expect(nw.view).toHaveAttribute("data-presentation", "panel", { timeout: 10_000 });
    await expect(nw.setupPanel).toBeVisible();
    await expect(nw.field("Quantity")).toHaveValue("200");
    await expect(nw.setupPanel.locator('[aria-invalid="true"]').first()).toBeVisible();
    expect(nw.pageErrors).toEqual([]);
  });

  test("CHK2-F2 dock back (button): W2 closes without S6, W1 in front (also from minimized), sub-window at its previous rectangle with selection and scroll", async ({ desktop, mm, sim }) => {
    test.setTimeout(90_000);
    const [a] = (await liveAB(mm, sim)) as [number, number];
    await focusPoll(mm, a);
    await mm.gridRow(a, 3).click();
    await mm.gridRow(a, 5).click({ modifiers: ["Shift"] });
    await mm.grid(a).evaluate((el) => {
      el.scrollTop = 2 * 24;
    });
    await expect.poll(() => gridState(mm.grid(a))).toEqual({ selected: [3, 4, 5], top: 2 });
    const rect = await mm.domRect(a);
    await mm.titleButton(a, /^Open in its own window/).click();
    const nw = await w2Of(desktop, a);
    // W1 minimized: dock must bring it back
    const w1hwnd = desktop.windows().find((w) => w.title.startsWith("Modbus Master"))?.hwnd as number;
    desktop.showWindow(w1hwnd, "min");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1hwnd)?.iconic).toBe(true);
    await nw.toolbarButton("Dock to workspace").click();
    await expect.poll(() => desktop.windows().filter((w) => w.title.startsWith("A - ")).length, { message: "W2 gone" }).toBe(0);
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1hwnd)?.iconic, { message: "W1 restored from minimized" }).toBe(false);
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1hwnd)?.foreground, { message: "W1 in front" }).toBe(true);
    await expect(mm.sub(a)).toBeVisible();
    await mm.expectDomRect(a, rect);
    await expect(mm.sub(a)).toHaveAttribute("data-active", "true");
    await expect(mm.row(a)).not.toContainText("own window");
    await expect.poll(() => gridState(mm.grid(a)), { message: "selection and scroll after dock" }).toEqual({ selected: [3, 4, 5], top: 2 });
    await expect(mm.grid(a)).toBeFocused();
    await expect(mm.grid(a)).toHaveAttribute("data-status", "live");
  });

  test("CHK2-F1/F2 shortcuts Ctrl+Shift+O (sub-window, sidebar row) and Ctrl+Shift+D (W2) pop out and dock", async ({ desktop, mm, sim }) => {
    const [a] = (await liveAB(mm, sim)) as [number, number];
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+Shift+O");
    const nw = await w2Of(desktop, a);
    await expect(mm.sub(a)).toHaveCount(0);
    await nw.grid.focus();
    await nw.page.keyboard.press("Control+Shift+D");
    await expect(mm.sub(a)).toBeVisible();
    await expect.poll(() => desktop.windows().filter((w) => w.title.startsWith("A - ")).length).toBe(0);
    // sidebar selection: pop out the selected poll with the focus on the list
    await mm.row(a).click();
    await mm.row(a).focus();
    await mm.page.keyboard.press("Control+Shift+O");
    await w2Of(desktop, a);
    await expect(mm.sub(a)).toHaveCount(0);
  });

  test("CHK2-F3 five pop out / dock cycles: Paused state, counters and the wire are unchanged (no extra requests); a polling poll keeps its cadence", async ({ desktop, mm, sim }) => {
    test.setTimeout(150_000);
    const [a, b] = (await liveAB(mm, sim)) as [number, number];
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+p");
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "paused");
    const settle = async () => {
      let last = "";
      await expect
        .poll(
          async () => {
            const t = (await mm.statusText(a)).match(/Tx \d+ · Err \d+/)?.[0] ?? "";
            const same = t === last;
            last = t;
            return same;
          },
          { intervals: [250], timeout: 5000 },
        )
        .toBe(true);
    };
    await settle();
    const counters0 = (await mm.statusText(a)).match(/Tx \d+ · Err \d+/)?.[0];
    const unit1Before = sim.requestsDecoded(0).filter((r) => r.unit === 1).length;
    for (let i = 0; i < 5; i += 1) {
      await mm.titleButton(a, /^Open in its own window/).click();
      const nw = await w2Of(desktop, a);
      await expect(nw.pill).toContainText("Paused");
      await nw.toolbarButton("Dock to workspace").click();
      await expect(mm.sub(a)).toBeVisible();
      await expect(mm.sub(a)).toHaveAttribute("data-active", "true");
    }
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "paused");
    await settle();
    expect((await mm.statusText(a)).match(/Tx \d+ · Err \d+/)?.[0], "counters of the paused poll after 5 cycles").toBe(counters0);
    expect(sim.requestsDecoded(0).filter((r) => r.unit === 1).length, "no request for the paused poll's slave during the cycles").toBe(unit1Before);
    expect(await mm.statusText(b), "poll B kept polling").toContain("Polling");
    // same with a polling poll: its cadence on the wire does not change across the cycles
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+p");
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "polling");
    const mark = sim.mark();
    for (let i = 0; i < 5; i += 1) {
      await mm.titleButton(a, /^Open in its own window/).click();
      const nw = await w2Of(desktop, a);
      await nw.toolbarButton("Dock to workspace").click();
      await expect(mm.sub(a)).toBeVisible();
    }
    const reqs = sim.requestsDecoded(mark).filter((r) => r.unit === 1);
    const gaps = reqs.slice(1).map((r, i) => r.epoch - (reqs[i]?.epoch ?? 0));
    console.log("CYCLES polling gaps A", JSON.stringify({ n: reqs.length, max: Math.max(...gaps), min: Math.min(...gaps) }));
    expect(Math.max(...gaps), "no gap longer than 2 scan periods (200 ms) + timer slack").toBeLessThan(260);
    expect(Math.min(...gaps), "no burst of extra requests").toBeGreaterThanOrEqual(85);
    expect(sim.linesWith("OVERLAP")).toEqual([]);
  });

  test("REV-006 M-1 timeline: when the sub-window disappears versus when the native window exists and shows data (real event order)", async ({ desktop, mm, sim }, testInfo) => {
    const [a] = (await liveAB(mm, sim)) as [number, number];
    await mm.page.evaluate((id) => {
      const q = { removedAt: 0 };
      (window as unknown as { __qa: unknown }).__qa = q;
      new MutationObserver(() => {
        const present = document.querySelector(`[data-subwindow="${id}"]`) !== null;
        if (!present && !q.removedAt) q.removedAt = performance.timeOrigin + performance.now();
      }).observe(document.body, { childList: true, subtree: true });
      const spin: string[] = [];
      (window as unknown as { __spin: string[] }).__spin = spin;
      new MutationObserver(() => {
        const btn = document.querySelector(`[data-subwindow="${id}"] [data-slot="title-bar"] button[aria-label^="Open in its own window"]`);
        if (btn) spin.push(btn.innerHTML.includes("loader") ? "spinner" : "icon");
      }).observe(document.body, { childList: true, subtree: true, attributes: true });
    }, a);
    const t0 = Date.now();
    await mm.titleButton(a, /^Open in its own window/).click();
    // first time a native window with the poll title is listed by the OS (poll as fast as the helper allows)
    let nativeSeenAt = 0;
    const deadline = Date.now() + 15_000;
    while (!nativeSeenAt && Date.now() < deadline) {
      // async between the probes: a new webview is paused until Playwright (this event loop) resumes it
      if (desktop.windows().some((w) => w.title.startsWith("A - "))) nativeSeenAt = Date.now();
      else await new Promise((r) => setTimeout(r, 10));
    }
    const nw = await w2Of(desktop, a);
    const readyAt = Date.now();
    const q = await mm.page.evaluate(() => (window as unknown as { __qa: { removedAt: number } }).__qa);
    const spin = await mm.page.evaluate(() => [...new Set((window as unknown as { __spin: string[] }).__spin)]);
    const data = {
      clickToSubWindowRemoved: Math.round(q.removedAt - t0),
      clickToNativeWindowListed: nativeSeenAt - t0,
      clickToReady: readyAt - t0,
      gapSubWindowGoneToNativeListed: nativeSeenAt - q.removedAt,
      spinnerStates: spin,
    };
    console.log("M-1 TIMELINE", JSON.stringify(data));
    await testInfo.attach("m1-timeline.json", { body: JSON.stringify(data, null, 1), contentType: "application/json" });
    expect(await nw.grid.getAttribute("data-status")).toBe("live");
  });

  test("CHK2-F5/F6/G1/G2 popped-out poll is never shown twice; row click restores a minimized native window; native close asks S6 (Keep) and Show reopens it natively", async ({ desktop, mm, sim }) => {
    test.setTimeout(90_000);
    const [a] = (await liveAB(mm, sim)) as [number, number];
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+Shift+O");
    await w2Of(desktop, a);
    const w2 = () => desktop.windows().find((w) => w.title.startsWith("A - "));
    desktop.showWindow(w2()?.hwnd as number, "min");
    await expect.poll(() => w2()?.iconic).toBe(true);
    await mm.row(a).click();
    await expect.poll(() => w2()?.iconic, { message: "restored by the row click" }).toBe(false);
    await expect.poll(() => w2()?.foreground).toBe(true);
    await expect(mm.sub(a)).toHaveCount(0);
    // close natively (a real WM_CLOSE) and answer Keep
    desktop.closeWindow(w2()?.hwnd as number);
    const nw = new RealNative(await desktop.w2Page(a));
    await expect(nw.confirm).toBeVisible();
    await expect(nw.confirm).toContainText("Close poll window?");
    await expect(nw.confirm).toContainText('Keep "A" on this connection, or delete it?');
    await expect(nw.confirm).toContainText("A kept poll keeps polling in the background.");
    await expect(nw.confirm.getByRole("button", { name: "Keep poll" })).toBeFocused();
    await nw.confirm.getByRole("button", { name: "Keep poll" }).click();
    await expect.poll(() => w2(), { message: "native window closed" }).toBeUndefined();
    await expect(mm.row(a)).toContainText("closed");
    // the closed poll keeps polling in the background
    const m = sim.mark();
    await expect.poll(() => sim.requestsDecoded(m).filter((r) => r.unit === 1).length, { timeout: 5000 }).toBeGreaterThan(5);
    await mm.row(a).click(); // Show: the last host kind was native
    await w2Of(desktop, a);
    expect(w2(), "reopened as a native window").toBeTruthy();
    await expect(mm.sub(a)).toHaveCount(0);
  });

  test("CHK2-G1/G2 native close: Cancel keeps the window, Delete poll removes it; no keeps-polling sentence for a paused poll", async ({ desktop, mm, sim }) => {
    test.setTimeout(90_000);
    const [a] = (await liveAB(mm, sim)) as [number, number];
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+p");
    await expect(mm.statusLine(a)).toHaveAttribute("data-state", "paused");
    await mm.page.keyboard.press("Control+Shift+O");
    const nw = await w2Of(desktop, a);
    const w2 = () => desktop.windows().find((w) => w.title.startsWith("A - "));
    desktop.closeWindow(w2()?.hwnd as number);
    await expect(nw.confirm).toBeVisible();
    await expect(nw.confirm).not.toContainText("keeps polling in the background");
    await nw.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(nw.confirm).toHaveCount(0);
    expect(w2(), "Cancel keeps the window").toBeTruthy();
    desktop.closeWindow(w2()?.hwnd as number);
    await nw.confirm.getByRole("button", { name: "Delete poll" }).click();
    await expect.poll(() => w2()).toBeUndefined();
    await expect(mm.row(a)).toHaveCount(0);
    await expect(mm.pollList.getByRole("option")).toHaveCount(1);
  });

  test("CHK2-F7 Ctrl+Shift+N in a native window creates the poll in a new native window cascaded 24 logical px from it", async ({ desktop, mm, sim }) => {
    const [a] = (await liveAB(mm, sim)) as [number, number];
    const dpr = await dprOf(mm);
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+Shift+O");
    const nw = await w2Of(desktop, a);
    // room for a cascade step: the new window (900 x 640 logical) must fit the work area, else the wrap rule applies
    const w0 = desktop.windows().find((w) => w.title.startsWith("A - "));
    desktop.moveWindow(w0?.hwnd as number, 60, 40, w0?.rect.w ?? 800, w0?.rect.h ?? 460);
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w0?.hwnd)?.rect.x).toBe(60);
    const first = desktop.windows().find((w) => w.hwnd === w0?.hwnd);
    await nw.grid.focus();
    await nw.page.keyboard.press("Control+Shift+N");
    await expect.poll(() => desktop.windows().filter((w) => / - Untitled/.test(w.title) && !w.title.startsWith("Modbus Master")).length).toBe(2);
    const second = desktop.windows().find((w) => !w.title.startsWith("Modbus Master") && w.hwnd !== first?.hwnd && w.title !== "ESEfact");
    expect(second, "second native window").toBeTruthy();
    expect((second?.rect.x ?? 0) - (first?.rect.x ?? 0)).toBeCloseTo(LOGICAL_OFFSET * dpr, 0);
    expect((second?.rect.y ?? 0) - (first?.rect.y ?? 0)).toBeCloseTo(LOGICAL_OFFSET * dpr, 0);
    await expect(mm.pollList.getByRole("option")).toHaveCount(3);
  });

  test("CHK2-F9 Write dialog open in a sub-window: Ctrl+Shift+O does nothing", async ({ desktop, mm, sim }) => {
    const [a] = (await liveAB(mm, sim)) as [number, number];
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+e");
    await expect(mm.writeDialog).toBeVisible();
    await mm.page.keyboard.press("Control+Shift+O");
    await expect(mm.sub(a)).toBeVisible();
    expect(desktop.w2Pages().length, "no native window").toBe(0);
    expect(desktop.windows().filter((w) => w.title.startsWith("A - "))).toHaveLength(0);
  });

  test("CHK2-F11/F12/F13 native window: title follows pill, W1 minimized keeps it visible and updating, no Disconnect, Ctrl+L, Ctrl+Shift+M, link lost banner", async ({ desktop, mm, sim }) => {
    test.setTimeout(90_000);
    const [a] = (await liveAB(mm, sim)) as [number, number];
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+Shift+O");
    const nw = await w2Of(desktop, a);
    await expect.poll(() => desktop.windows().map((w) => w.title)).toContain("A - Untitled - Polling");
    // status bar format: no Tx, has Last OK / Round trip / Resp / Timeouts
    await expect(nw.statusBar).toHaveText(/^Last OK \d\d:\d\d:\d\d\.\d{3} · Round trip \d+ ms · Resp \d+ · Timeouts \d+$/);
    // F13: no Disconnect action; Ctrl+L does nothing while connected
    await expect(nw.toolbar.getByRole("button", { name: /Disconnect/ })).toHaveCount(0);
    await nw.grid.focus();
    await nw.page.keyboard.press("Control+l");
    await expect(nw.connectionPill).toContainText("Connected");
    await mm.expectConnection("connected");
    // F12: W1 minimized: the native window stays visible, keeps updating and has its own taskbar entry (no owner)
    const w1 = desktop.windows().find((w) => w.title.startsWith("Modbus Master"));
    desktop.showWindow(w1?.hwnd as number, "min");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.iconic).toBe(true);
    const w2win = desktop.windows().find((w) => w.title.startsWith("A - "));
    expect(w2win?.iconic).toBe(false);
    expect(w2win?.visible).toBe(true);
    expect(w2win?.owner, "unowned window = own taskbar entry").toBe(0);
    await sim.ctlOk("set holding 0 4242");
    await expect.poll(async () => (await nw.cells(0)).at(-1), { timeout: 5000 }).toBe("4242");
    // Ctrl+Shift+M focuses W1 (restoring it)
    await nw.page.keyboard.press("Control+Shift+M");
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.iconic).toBe(false);
    await expect.poll(() => desktop.windows().find((w) => w.hwnd === w1?.hwnd)?.foreground).toBe(true);
    // F11: Offline in the title while the link is down; the banner has [Reconnect] and [Connection window]
    await sim.ctlOk("stop");
    await expect.poll(() => desktop.windows().map((w) => w.title)).toContain("A - Untitled - Offline");
    await expect(nw.banner).toBeVisible();
    await expect(nw.banner.getByRole("button", { name: "Reconnect" })).toBeVisible();
    await expect(nw.banner.getByRole("button", { name: "Connection window" })).toBeVisible();
    await sim.ctlOk("resume");
    await nw.banner.getByRole("button", { name: "Reconnect" }).click();
    await expect.poll(() => desktop.windows().map((w) => w.title)).toContain("A - Untitled - Polling");
  });

  test("CHK2-D5 writes from a sub-window and a native window within 50 ms: both succeed in FIFO order, polling continues", async ({ desktop, mm, sim }) => {
    test.setTimeout(90_000);
    const [a, b] = (await liveAB(mm, sim)) as [number, number];
    await focusPoll(mm, b);
    await mm.page.keyboard.press("Control+Shift+O");
    const nb = await w2Of(desktop, b);
    // prepare both dialogs, then press Send in both as close together as possible
    await focusPoll(mm, a);
    await mm.page.keyboard.press("Control+e");
    await mm.writeDialog.getByLabel("Function", { exact: true }).selectOption("6");
    await mm.writeDialog.getByLabel("Start address", { exact: true }).fill("41");
    await mm.writeDialog.getByLabel("Value", { exact: true }).fill("11");
    await nb.page.bringToFront();
    await nb.grid.focus();
    await nb.page.keyboard.press("Control+e");
    const wd = nb.page.getByRole("dialog", { name: /^Write/ });
    await wd.getByLabel("Function", { exact: true }).selectOption("6");
    await wd.getByLabel("Start address", { exact: true }).fill("42");
    await wd.getByLabel("Value", { exact: true }).fill("22");
    const mark = sim.mark();
    await Promise.all([
      mm.writeDialog.getByRole("button", { name: "Send" }).click(),
      wd.getByRole("button", { name: "Send" }).click(),
    ]);
    await expect(mm.page.getByTestId("write-result")).toContainText("Write confirmed by slave 1: register at 41.");
    await expect(nb.page.getByTestId("write-result")).toContainText("Write confirmed by slave 2: register at 42.");
    const writes = sim.requestsDecoded(mark).filter((r) => r.fc === 6);
    expect(writes.map((w) => w.addr).sort()).toEqual([41, 42]);
    expect(await sim.get("holding", 41, 2)).toEqual([11, 22]);
    expect(sim.linesWith("OVERLAP")).toEqual([]);
    await mm.writeDialog.getByRole("button", { name: "Close", exact: true }).click();
  });
});
