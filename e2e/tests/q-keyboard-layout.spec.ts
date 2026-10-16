// CHK-001 Q. keyboard, copy, layout
import {
  expect,
  type Frame,
  type ModbusApp,
  REGISTER_MAP_10,
  rxFrame,
  test,
  txFrame,
} from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 532).getTime();

/** Collects keydown events after the app's own handler: records what `preventDefault` did. */
async function recordKeys(app: ModbusApp): Promise<void> {
  await app.page.evaluate(() => {
    const log: { key: string; ctrl: boolean; shift: boolean; prevented: boolean }[] = [];
    window.__qa = { keys: log, alive: true };
    window.addEventListener("keydown", (e) => {
      log.push({ key: e.key.toLowerCase(), ctrl: e.ctrlKey, shift: e.shiftKey, prevented: e.defaultPrevented });
    });
  });
}
async function keyLog(app: ModbusApp) {
  return app.page.evaluate(
    () => (window.__qa as { keys: { key: string; shift: boolean; prevented: boolean }[] }).keys,
  );
}

const frames = (n: number): Frame[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0
      ? txFrame(i + 1, AT + i, [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10])
      : rxFrame(i + 1, AT + i, [0, 1, 0, 0, 0, 5, 1, 3, 2, 4, 210]),
  );

test.describe("Q. keyboard shortcuts (DES 5.1)", () => {
  test("CHK-Q1 Ctrl+L: Connect when idle, Disconnect when connected", async ({ app, page }) => {
    await app.host.fill("127.0.0.1");
    await page.keyboard.press("Control+l");
    await app.expectCalls("connect", 1);
    await app.emitState("connecting");
    await app.emitState("connected");
    await page.keyboard.press("Control+l");
    await app.expectCalls("disconnect", 1);
  });

  test("CHK-Q1 Ctrl+P: Start, Pause, Resume; nothing when idle", async ({ app, page }) => {
    await page.keyboard.press("Control+p");
    expect(await app.callCount("startPoll")).toBe(0);
    await app.toState("connected");
    await page.keyboard.press("Control+p");
    await app.expectCalls("startPoll", 1);
    await app.emitState("polling");
    await page.keyboard.press("Control+p");
    await app.expectCalls("stopPoll", 1);
    await app.emitState("paused");
    await page.keyboard.press("Control+p");
    await app.expectCalls("startPoll", 2);
  });

  test("CHK-Q1 Ctrl+E opens the Write dialog when the link is up", async ({ app, page }) => {
    await page.keyboard.press("Control+e");
    await expect(app.writeDialog).toHaveCount(0);
    await app.toState("connected");
    await page.keyboard.press("Control+e");
    await expect(app.writeDialog).toBeVisible();
  });

  test("CHK-Q1 Ctrl+O, Ctrl+S (untitled -> Save as) and Ctrl+Shift+S open their dialogs", async ({
    app,
    page,
  }) => {
    await page.keyboard.press("Control+o");
    await expect(app.openDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(app.openDialog).toHaveCount(0);
    await app.host.fill("127.0.0.1");
    await page.keyboard.press("Control+s");
    await expect(app.saveAsDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(app.saveAsDialog).toHaveCount(0);
    await page.keyboard.press("Control+Shift+s");
    await expect(app.saveAsDialog).toBeVisible();
  });

  test("CHK-Q1 Ctrl+1..4 switch the format, Ctrl+B the address base", async ({ app, page }) => {
    const radio = (n: string) => app.formatGroup.getByRole("radio", { name: n, exact: true });
    await page.keyboard.press("Control+2");
    await expect(radio("Signed")).toBeChecked();
    await page.keyboard.press("Control+3");
    await expect(radio("Hex")).toBeChecked();
    await page.keyboard.press("Control+4");
    await expect(radio("Binary")).toBeChecked();
    await page.keyboard.press("Control+1");
    await expect(radio("Unsigned")).toBeChecked();
    await page.keyboard.press("Control+b");
    await expect(app.baseGroup.getByRole("radio", { name: "1", exact: true })).toBeChecked();
  });

  test("CHK-Q1 Ctrl+1..4 do nothing for a coil poll", async ({ app, page }) => {
    await app.fn.selectOption("1");
    await page.keyboard.press("Control+3");
    await expect(app.formatGroup.getByRole("radio", { name: "Unsigned", exact: true })).toBeChecked();
  });

  test("CHK-Q1 Ctrl+\\ toggles the setup panel, Ctrl+J the traffic panel, Ctrl+Shift+K clears", async ({
    app,
    page,
  }) => {
    await app.toState("polling");
    await app.frames(frames(4));
    await page.keyboard.press("Control+\\");
    await expect(app.setup).toBeHidden();
    await page.keyboard.press("Control+\\");
    await expect(app.setup).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(app.frameList).toHaveCount(0);
    await expect(app.counter("Requests")).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(app.frameList).toBeVisible();
    await page.keyboard.press("Control+Shift+k");
    await expect(app.page.getByTestId("traffic-empty")).toContainText("Log cleared at");
  });

  test("CHK-Q1 browser defaults are suppressed: Ctrl+P/O/S/Shift+S/N/R, F5, Ctrl+F5", async ({
    app,
    page,
  }) => {
    await app.toState("connected");
    await recordKeys(app);
    const keys: [string, string][] = [
      ["Control+p", "p"],
      ["Control+o", "o"],
      ["Escape", "Escape"], // closes the Open dialog again
      ["Control+s", "s"],
      ["Escape", "Escape"],
      ["Control+Shift+s", "s"],
      ["Escape", "Escape"],
      ["Control+n", "n"],
      ["Control+r", "r"],
      ["Control+Shift+r", "r"],
      ["F5", "F5"],
      ["Control+F5", "F5"],
    ];
    for (const [combo] of keys) await page.keyboard.press(combo);
    const log = await keyLog(app);
    // the shifted variants (Ctrl+Shift+S, Ctrl+Shift+R) must be prevented too
    for (const k of ["s", "r"]) {
      expect(log.some((x) => x.key === k && x.shift), `Ctrl+Shift+${k}`).toBe(true);
    }
    for (const wanted of ["p", "o", "s", "n", "r", "f5"]) {
      const hits = log.filter((k) => k.key === wanted);
      expect(hits.length, `key ${wanted} reached the page`).toBeGreaterThan(0);
      expect(
        hits.every((k) => k.prevented),
        `default of ${wanted} is prevented`,
      ).toBe(true);
    }
    expect(await page.evaluate(() => (window.__qa as { alive?: boolean } | undefined)?.alive)).toBe(true);
  });

  test("CHK-Q1 table keys: arrows, Home/End, Shift extends, Ctrl+A, Esc clears, Enter opens Write", async ({
    app,
    page,
  }) => {
    await app.toLive();
    const selected = async () =>
      app.table.locator('[role="row"][aria-selected="true"]').evaluateAll((rows) =>
        rows.map((r) => r.id),
      );
    await app.row(0).click();
    expect(await selected()).toEqual(["data-row-0"]);
    await page.keyboard.press("ArrowDown");
    expect(await selected()).toEqual(["data-row-1"]);
    await page.keyboard.press("Shift+ArrowDown");
    expect(await selected()).toEqual(["data-row-1", "data-row-2"]);
    await page.keyboard.press("End");
    expect(await selected()).toEqual(["data-row-9"]);
    await page.keyboard.press("Home");
    expect(await selected()).toEqual(["data-row-0"]);
    await page.keyboard.press("PageDown");
    expect((await selected())[0]).toBe("data-row-9");
    await page.keyboard.press("PageUp");
    expect(await selected()).toEqual(["data-row-0"]);
    await page.keyboard.press("Control+a");
    expect(await selected()).toHaveLength(10);
    await page.keyboard.press("Escape");
    expect(await selected()).toEqual([]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(app.writeDialog).toBeVisible();
    await expect(app.writeDialog.getByLabel("Start address")).toHaveValue("0");
  });

  test("CHK-Q1 Ctrl+N is intercepted (no browser window opens)", async ({ app, page, context }) => {
    await recordKeys(app);
    const pages: unknown[] = [];
    context.on("page", (p) => pages.push(p));
    await page.keyboard.press("Control+n");
    const log = await keyLog(app);
    expect(log.find((k) => k.key === "n")?.prevented).toBe(true);
    expect(pages).toHaveLength(0);
  });
});

test.describe("Q. modal, copy, layout", () => {
  test("CHK-Q2 with a modal open Ctrl+L and Ctrl+P do nothing and Esc closes it", async ({ app, page }) => {
    await app.toLive();
    await app.toolbarButton("Write…").click();
    await expect(app.writeDialog).toBeVisible();
    const methods = ["disconnect", "stopPoll", "startPoll", "connect", "cancelConnect"];
    const before = await Promise.all(methods.map((m) => app.callCount(m)));
    await page.keyboard.press("Control+l");
    await page.keyboard.press("Control+p");
    await page.keyboard.press("Control+b");
    const after = await Promise.all(methods.map((m) => app.callCount(m)));
    expect(after).toEqual(before);
    await page.keyboard.press("Escape");
    await expect(app.writeDialog).toHaveCount(0);
    // Ctrl+B was ignored while the modal was open
    await expect(app.table.getByRole("columnheader").first()).toContainText("Address (0-based)");
  });

  test("CHK-Q2 same for the Open profile dialog", async ({ app, page }) => {
    await app.toLive();
    await page.keyboard.press("Control+o");
    await expect(app.openDialog).toBeVisible();
    await page.keyboard.press("Control+l");
    await page.keyboard.press("Control+p");
    expect(await app.callCount("disconnect")).toBe(0);
    expect(await app.callCount("stopPoll")).toBe(0);
    expect(await app.callCount("connect")).toBe(1); // only the Connect press of the setup
    await page.keyboard.press("Escape");
    await expect(app.openDialog).toHaveCount(0);
  });

  test("CHK-Q3 Ctrl+C on rows 0-1 in Hex copies two tab-separated lines and toasts", async ({ app, page }) => {
    await app.toLive();
    await page.keyboard.press("Control+3");
    await app.row(0).click();
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Control+c");
    await expect(app.toast("Copied 2 rows.")).toBeVisible();
    expect(await app.clipboardText()).toBe("0\t0x04D2\n1\t0xFFFF");
  });

  test("CHK-Q3 one row says Copied 1 row.", async ({ app, page }) => {
    await app.toLive();
    await app.row(2).click();
    await page.keyboard.press("Control+c");
    await expect(app.toast("Copied 1 row.")).toBeVisible();
    expect(await app.clipboardText()).toBe("2\t32768");
  });

  test("CHK-Q4 dragging the Value column handle resizes it, minimum 96 px, double-click auto-fits", async ({
    app,
    page,
  }) => {
    await app.toLive();
    const handle = app.table.locator('[data-resize-handle="data.value"]');
    const width = async () => Number(await handle.getAttribute("aria-valuenow"));
    const w0 = await width();
    const box = await handle.boundingBox();
    if (!box) throw new Error("no handle box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(width).toBeGreaterThan(w0 + 100);
    const box2 = await handle.boundingBox();
    if (!box2) throw new Error("no handle box");
    const x2 = box2.x + box2.width / 2;
    await page.mouse.move(x2, y);
    await page.mouse.down();
    await page.mouse.move(x2 - 600, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(width).toBe(96);
    // widen again, then auto-fit narrows it to the content (never below the minimum)
    await handle.focus();
    for (let i = 0; i < 20; i += 1) await page.keyboard.press("ArrowRight");
    await expect.poll(width).toBeGreaterThan(200);
    await handle.dblclick();
    await expect.poll(width).toBeLessThan(200);
    expect(await width()).toBeGreaterThanOrEqual(96);
  });

  test("CHK-Q5 splitter: focus ring, Up/Down move 16 px, clamps at 120 px and 70 %, double-click resets to 35 %", async ({
    app,
    page,
  }) => {
    const panel = app.traffic.locator("xpath=..");
    const height = async () => (await panel.boundingBox())?.height ?? 0;
    const vh = page.viewportSize()?.height ?? 800;
    await app.splitter.focus();
    const ring = await app.splitter.evaluate((el) => {
      const s = getComputedStyle(el);
      return { focusVisible: el.matches(":focus-visible"), style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
    });
    expect(ring.focusVisible).toBe(true);
    expect(ring.style).toBe("solid");
    expect(ring.width).toBe("2px");
    expect(ring.color).toBe("rgb(49, 47, 46)");

    const near = (target: number) => async () => Math.abs((await height()) - target) <= 2;
    const h0 = await height();
    expect(Math.abs(h0 - 0.35 * vh)).toBeLessThanOrEqual(2);
    await page.keyboard.press("ArrowUp");
    await expect.poll(near(h0 + 16)).toBe(true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect.poll(near(h0 - 16)).toBe(true);
    for (let i = 0; i < 40; i += 1) await page.keyboard.press("ArrowUp");
    await expect(app.splitter).toHaveAttribute("aria-valuenow", "70");
    expect(Math.abs((await height()) - 0.7 * vh)).toBeLessThanOrEqual(2);
    for (let i = 0; i < 60; i += 1) await page.keyboard.press("ArrowDown");
    await expect.poll(near(120)).toBe(true);
    expect(await height()).toBeGreaterThanOrEqual(119);
    await app.splitter.dblclick();
    await expect(app.splitter).toHaveAttribute("aria-valuenow", "35");
    expect(Math.abs((await height()) - 0.35 * vh)).toBeLessThanOrEqual(2);
  });

  test("CHK-Q6 Ctrl+\\ hides the setup panel, Ctrl+J collapses traffic to its header with the counters", async ({
    app,
    page,
  }) => {
    await page.keyboard.press("Control+\\");
    await expect(app.setup).toBeHidden();
    await page.keyboard.press("Control+\\");
    await expect(app.setup).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(app.frameList).toHaveCount(0);
    await expect(app.traffic).toHaveCSS("height", "36px");
    for (const c of ["Requests", "Responses", "Errors", "Timeouts"] as const) {
      await expect(app.counter(c)).toBeVisible();
    }
    await expect(app.traffic.getByRole("button", { name: "Expand traffic panel" })).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(app.frameList).toBeVisible();
  });

  for (const state of ["idle", "polling", "disconnected"] as const) {
    test(`CHK-Q7 960x600: no horizontal scroll, all toolbar actions reachable (${state})`, async ({
      app,
      page,
    }) => {
      await page.setViewportSize({ width: 960, height: 600 });
      if (state === "polling") await app.toLive();
      else if (state === "disconnected") await app.toState("disconnected");
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow).toEqual({ doc: 0, body: 0 });
      const buttons = await app.toolbar.getByRole("button").all();
      expect(buttons.length).toBeGreaterThanOrEqual(5);
      for (const b of buttons) await expect(b).toBeInViewport({ ratio: 1 });
      await expect(app.pill).toBeInViewport({ ratio: 1 });
    });
  }

  test("CHK-Q8 the setup panel has no Connect button", async ({ app }) => {
    await expect(app.setup.getByRole("button", { name: /connect/i })).toHaveCount(0);
  });

  for (const name of ["Host", "Port", "Timeout (ms)"] as const) {
    test(`CHK-Q8 Enter in ${name} connects when idle`, async ({ app }) => {
      await app.host.fill("127.0.0.1");
      await app.field(name).press("Enter");
      await app.expectCalls("connect", 1);
      const [[cfg]] = (await app.calls("connect")) as [[Record<string, unknown>]];
      expect(cfg).toMatchObject({ mode: "tcp", host: "127.0.0.1" });
    });
  }

  test("CHK-Q8 Enter in a Connection field reconnects when disconnected", async ({ app }) => {
    await app.toState("disconnected");
    await app.port.press("Enter");
    await app.expectCalls("connect", 2);
  });

  test("CHK-Q8 Enter in a Connection field does nothing while polling", async ({ app }) => {
    await app.toLive();
    await app.host.press("Enter");
    await app.port.press("Enter");
    await app.timeout.press("Enter");
    expect(await app.callCount("connect")).toBe(1);
    expect(await app.callCount("disconnect")).toBe(0);
    await app.expectPill("Polling", "activity");
  });

  test("CHK-Q9 traffic list: Ctrl+A selects nothing, Shift/Ctrl-click keep one frame, Up/Down move it", async ({
    app,
    page,
  }) => {
    await app.toLive();
    await app.frames(frames(6));
    const selected = async () =>
      app.frameList.locator('[role="row"][aria-selected="true"]').evaluateAll((r) => r.map((x) => x.id));
    await app.frameRow(2).click();
    await page.keyboard.press("Control+a");
    expect(await selected()).toEqual(["frame-2"]); // unchanged, nothing was added
    await app.frameRow(5).click({ modifiers: ["Shift"] });
    expect(await selected()).toEqual(["frame-5"]);
    await app.frameRow(3).click({ modifiers: ["Control"] });
    expect(await selected()).toEqual(["frame-3"]);
    await page.keyboard.press("ArrowDown");
    expect(await selected()).toEqual(["frame-4"]);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await selected()).toEqual(["frame-2"]);
    await page.keyboard.press("Escape");
    expect(await selected()).toEqual([]);
    await page.keyboard.press("Control+a");
    expect(await selected()).toEqual([]);
    // the data table is unaffected by Ctrl+A in the traffic list
    expect(await app.table.locator('[role="row"][aria-selected="true"]').count()).toBe(0);
    await expect(app.value(0)).toHaveText(String(REGISTER_MAP_10[0]));
  });
});
