// CHK-002 section R: accessibility (names, focus order, announcements, contrast). R4 (grayscale
// review by a person) and screen reader output are manual; the icon-plus-text part is asserted.
import type { Page } from "@playwright/test";
import { expect, LAYOUT_SEED, type Mm, STANDARD_8, test } from "../support/mm-fixtures";

const bgOf = (mm: Mm, id: number): Promise<string> =>
  mm.titleBar(id).evaluate((el) => getComputedStyle(el).backgroundColor);

async function regionOfActive(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const r = el?.closest("[data-region]") as HTMLElement | null;
    return r?.dataset.region ?? (el?.tagName ?? "none");
  });
}

test.describe("R accessibility", () => {
  test("CHK2-R1 F6 cycles toolbar, sidebar, workspace, minimized bar, traffic", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }], connected: true });
    const [, b] = (await mm.pollIds()) as [number, number];
    await mm.titleButton(b, "Minimize").click();
    await expect(mm.minimizedBar).toBeVisible();
    await mm.toolbarButton("New poll").focus();
    expect(await regionOfActive(page)).toBe("toolbar");
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("F6");
      seen.push(await regionOfActive(page));
    }
    expect(seen).toEqual(["sidebar", "workspace", "minimized", "traffic", "toolbar"]);
    await page.keyboard.press("Shift+F6");
    expect(await regionOfActive(page)).toBe("traffic");
  });

  // R1 / R6 setup (revision 8): P1, P2, P3 created in that order (ascending poll ids), all normal
  // sub-windows, setup closed, list order [P3, P1, P2], z-order P3 (front) > P2 > P1. P2 and P3 overlap.
  const R1_LAYOUT = {
    items: [
      { index: 0, x: 8, y: 8, z: 1 },
      { index: 1, x: 200, y: 100, z: 2 },
      { index: 2, x: 400, y: 150, z: 3 },
    ],
  };
  async function r1Setup(mm: Mm): Promise<[number, number, number]> {
    await mm.open({
      polls: [{ name: "P1" }, { name: "P2" }, { name: "P3" }],
      seed: LAYOUT_SEED,
      seedArg: R1_LAYOUT,
      connected: true,
    });
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    await mm.script((f, ids) => f.reorderPolls([ids[2], ids[0], ids[1]]), [a, b, c]);
    await expect(mm.pollList.getByRole("option")).toHaveCount(3);
    await expect(mm.pollList.getByRole("option").first()).toContainText("P3");
    await expect(mm.sub(c)).toHaveAttribute("aria-current", "true");
    return [a, b, c];
  }
  /** Which part of which sub-window (or region) holds the focus. */
  const stopOf = (page: Page): Promise<string> =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "none";
      const sub = el.closest("[data-subwindow]") as HTMLElement | null;
      if (sub) {
        const part = el.closest('[data-slot="title-bar"]')
          ? "title"
          : el.closest('[data-testid="poll-status-line"]')
            ? "status"
            : el.closest('[data-testid="poll-setup"]')
              ? "setup"
              : el.closest('[role="grid"]')
                ? "grid"
                : "other";
        return `P${sub.dataset.subwindow}:${part}`;
      }
      if (el.getAttribute("role") === "separator" && el.getAttribute("aria-label") === "Resize sidebar") return "splitter";
      return (el.closest("[data-region]") as HTMLElement | null)?.dataset.region ?? el.tagName;
    });
  /** Presses `key` until `until` accepts the stop; returns the distinct consecutive stops seen. */
  async function tabStops(page: Page, key: string, until: (stop: string) => boolean, max = 80): Promise<string[]> {
    const stops: string[] = [];
    for (let i = 0; i < max; i++) {
      await page.keyboard.press(key);
      const where = await stopOf(page);
      if (stops.at(-1) !== where) stops.push(where);
      if (until(where)) return stops;
    }
    throw new Error(`no stop ended the walk, saw ${stops.join(" > ")}`);
  }

  test("CHK2-R1 Tab follows ascending poll id (not z-order, not list order): P1 title, status, grid, P2, P3, then traffic; Shift+Tab reverses", async ({
    mm,
    page,
  }) => {
    const [a, b, c] = await r1Setup(mm);
    // Walk from the sidebar: focus the first poll row, then Tab until the first sub-window stop.
    await mm.pollList.getByRole("option").first().focus();
    const into = await tabStops(page, "Tab", (s) => s.startsWith("P"));
    expect(
      into.slice(0, -1).every((s) => s === "sidebar" || s === "splitter"),
      `only sidebar stops (and its splitter) before the workspace: ${into.join(" > ")}`,
    ).toBe(true);
    expect(into.at(-1), "P1's title bar is the first stop of the workspace").toBe(`P${a}:title`);
    const walk = await tabStops(page, "Tab", (s) => s === "traffic");
    const seq = [`P${a}:title`, ...walk];
    const firstOf = (id: number) => seq.findIndex((s) => s.startsWith(`P${id}:`));
    expect(firstOf(a), "P1 before P2").toBeLessThan(firstOf(b));
    expect(firstOf(b), "P2 before P3").toBeLessThan(firstOf(c));
    for (const id of [a, b, c]) {
      const parts = seq.filter((s) => s.startsWith(`P${id}:`)).map((s) => s.split(":")[1]);
      expect(parts[0], `P${id} starts with its title bar`).toBe("title");
      expect(parts.at(-1), `P${id} ends with its grid`).toBe("grid");
      expect(parts.indexOf("status"), `P${id} status line before its grid`).toBeGreaterThan(0);
      expect(parts.includes("setup"), "setup closed: no dock stop").toBe(false);
    }
    // The stops are contiguous per sub-window: P1..., then P2..., then P3....
    const order = seq.filter((s) => s.startsWith("P")).map((s) => s.split(":")[0]);
    expect(order.filter((v, i) => order[i - 1] !== v)).toEqual([`P${a}`, `P${b}`, `P${c}`]);
    expect(seq.at(-1)).toBe("traffic");
    // Shift+Tab goes back through the same stops in reverse.
    const back = await tabStops(page, "Shift+Tab", (s) => s === `P${a}:title`);
    const expected = seq.slice(0, -1).reverse().filter((v, i, arr) => arr[i - 1] !== v);
    expect(back, "the reverse walk").toEqual(expected);
  });

  test("CHK2-R1 raising a sub-window (pointer press, Ctrl+F6, the sidebar, focus) never changes the Tab order and keeps the focused control", async ({
    mm,
    page,
  }) => {
    const [a, b, c] = await r1Setup(mm);
    const domOrder = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("[data-subwindow]")].map((e) => Number((e as HTMLElement).dataset.subwindow)),
      );
    const z = async (id: number) => mm.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(await domOrder()).toEqual([a, b, c]);
    // A pointer press on P1's body (its visible left strip) raises it.
    await mm.sub(a).click({ position: { x: 10, y: 150 } });
    await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
    expect(await z(a)).toBeGreaterThan(Math.max(await z(b), await z(c)));
    expect(await domOrder(), "DOM order after a pointer raise").toEqual([a, b, c]);
    // Ctrl+F6 (list order [P3, P1, P2]: after P1 comes P2) and the sidebar.
    await page.keyboard.press("Control+F6");
    await expect(mm.sub(b)).toHaveAttribute("aria-current", "true");
    expect(await domOrder(), "DOM order after Ctrl+F6").toEqual([a, b, c]);
    await mm.row(c).click();
    await expect(mm.sub(c)).toHaveAttribute("aria-current", "true");
    await mm.row(a).click();
    await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
    expect(await domOrder(), "DOM order after the sidebar").toEqual([a, b, c]);
    // A raise by focus: P2's "Poll actions" gets the focus, which raises P2; the control keeps the focus.
    const actions = mm.statusLine(b).getByRole("button", { name: "Poll actions" });
    await actions.focus();
    await expect(mm.sub(b)).toHaveAttribute("aria-current", "true");
    expect(await z(b)).toBeGreaterThan(Math.max(await z(a), await z(c)));
    await expect(actions, "the control that had the focus keeps it after the raise").toBeFocused();
    expect(await domOrder(), "DOM order after a focus raise").toEqual([a, b, c]);
    // The next Tabs go on in the same order: P2's grid, then P3's title bar. Never back to P1.
    const walk = await tabStops(page, "Tab", (s) => s === `P${c}:title`);
    expect(walk.at(-1)).toBe(`P${c}:title`);
    expect(walk.filter((s) => s.startsWith(`P${a}:`)), "never back to P1").toEqual([]);
  });

  test("CHK2-R1 with P1's setup dock open its fields come after the status line and before its grid; a minimized sub-window has no stop but a pill", async ({
    mm,
    page,
  }) => {
    const [a, b, c] = await r1Setup(mm);
    await mm.titleButton(a, /^Poll setup/).click();
    await expect(mm.setupDock(a)).toBeVisible();
    await mm.titleButton(b, "Minimize").click();
    await expect(mm.minimizedBar).toBeVisible();
    await mm.titleBar(a).focus();
    const walk = await tabStops(page, "Tab", (s) => s === `P${c}:title`);
    const parts = walk.filter((s) => s.startsWith(`P${a}:`)).map((s) => s.split(":")[1]);
    expect(parts.indexOf("status")).toBeGreaterThanOrEqual(0);
    expect(parts.indexOf("setup"), "dock after the status line").toBeGreaterThan(parts.indexOf("status"));
    expect(parts.indexOf("grid"), "grid after the dock").toBeGreaterThan(parts.indexOf("setup"));
    expect(walk.filter((s) => s.startsWith(`P${b}:`)), "minimized P2 has no stop in the workspace").toEqual([]);
    const rest = await tabStops(page, "Tab", (s) => s === "minimized");
    expect(rest.at(-1)).toBe("minimized");
    await expect(mm.minimizedBar.getByRole("button", { name: /^P2/ })).toBeVisible();
  });

  test("CHK2-R6 Tab from P1's grid into P2's title bar activates and raises P2 above P3, sends no layout, keeps the focus on the title bar", async ({
    mm,
    page,
  }) => {
    const [a, b, c] = await r1Setup(mm);
    const z = async (id: number) => mm.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));
    // Initial state of the setup: P3 (front) > P2 > P1. Put the focus in P1's grid without changing the
    // order of P2 and P3 (the sidebar row of P1 raises P1 only).
    await mm.row(a).click();
    await expect(mm.grid(a)).toBeFocused();
    await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
    expect(await z(c), "P3 above P2 before the Tab").toBeGreaterThan(await z(b));
    // A point in the P2 / P3 overlap, outside P1 (workspace x 700, y 400): P3 is on top before.
    const topAt = async () => {
      const pt = await mm.wsPoint(700, 400);
      return page.evaluate(
        ({ x, y }) => (document.elementFromPoint(x, y)?.closest("[data-subwindow]") as HTMLElement | null)?.dataset.subwindow ?? null,
        pt,
      );
    };
    expect(await topAt(), "P3 is on top in the overlap before the Tab").toBe(String(c));
    const layoutCalls = await mm.callCount("setWorkspaceLayout");
    // The grid header has its column resize handles as further Tab stops (still P1's grid); the first
    // stop outside P1 must be P2's title bar.
    const out = await tabStops(page, "Tab", (stop) => !stop.startsWith(`P${a}:`));
    expect(out.at(-1)).toBe(`P${b}:title`);
    expect(await stopOf(page)).toBe(`P${b}:title`);
    await expect(mm.sub(b)).toHaveAttribute("aria-current", "true");
    await expect(mm.sub(a)).not.toHaveAttribute("aria-current", "true");
    await expect(mm.row(b)).toHaveAttribute("aria-selected", "true");
    expect(await bgOf(mm, b), "dark title bar").toBe("rgb(49, 47, 46)");
    expect(await z(b)).toBeGreaterThan(await z(c));
    expect(await topAt(), "P2 is drawn above P3 where they overlap").toBe(String(b));
    await expect(mm.titleBar(b), "the focus stays on the title bar").toBeFocused();
    expect(await mm.callCount("setWorkspaceLayout"), "activation sends no layout (N9)").toBe(layoutCalls);
  });

  test("CHK2-R2 sub-window and sidebar accessible names and aria-current", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }], connected: true });
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    await expect(mm.sub(a)).toHaveAttribute("aria-label", "Poll 1, Polling, sub-window");
    await expect(mm.sub(c)).toHaveAttribute("aria-current", "true");
    await expect(mm.sub(a)).not.toHaveAttribute("aria-current", "true");
    await expect(mm.sub(a)).toHaveAttribute("aria-roledescription", "sub-window");
    await expect(mm.row(a)).toHaveAttribute("aria-label", "Poll 1, Polling, in workspace");
    await mm.titleButton(b, "Minimize").click();
    await expect(mm.row(b)).toHaveAttribute("aria-label", "Poll 2, Polling, minimized");
    await mm.script((f, id) => f.closePollView(id, true), a);
    await expect(mm.row(a)).toHaveAttribute("aria-label", "Poll 1, Polling, closed");
    await mm.script((f, id) => f.popOutPoll(id, { kind: "rect", rect: { x: 1, y: 1, width: 600, height: 400 } }, null), c);
    await expect(mm.row(c)).toHaveAttribute("aria-label", "Poll 3, Polling, own window");
    await mm.script((f, id) => f.scriptFault(id, { kind: "exception", code: 2 }), b);
    await mm.advance(500);
    await expect(mm.row(b)).toHaveAttribute("aria-label", "Poll 2, Exception 02, minimized");
  });

  test("CHK2-R3 pointer and keyboard actions are announced once", async ({ mm, page }) => {
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }],
      seed: LAYOUT_SEED,
      seedArg: { items: [{ index: 0, x: 100, y: 150, width: 500, height: 300 }, { index: 1, x: 700, y: 150, width: 500, height: 300 }] },
    });
    const [a] = (await mm.pollIds()) as [number, number];
    await page.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { __live: string[] }).__live = log;
      const region = document.querySelector('[data-testid="live-polite"]');
      new MutationObserver(() => {
        const t = region?.textContent?.trim();
        if (t) log.push(t);
      }).observe(region as Node, { childList: true, subtree: true, characterData: true });
    });
    const live = () => page.evaluate(() => (window as unknown as { __live: string[] }).__live);
    // Keyboard move.
    await mm.titleBar(a).focus();
    await page.keyboard.press("Alt+ArrowRight");
    await mm.expectDomRect(a, { x: 116 });
    // Pointer move.
    await mm.dragTitle(a, 0, 100);
    await mm.release();
    await mm.expectStoredRect(a, { y: 250 });
    // Esc during a drag.
    await mm.dragTitle(a, 50, 0);
    await page.keyboard.press("Escape");
    await mm.release();
    await expect.poll(live).toContain("Move cancelled.");
    const log = await live();
    expect(log.filter((m) => m === "Poll 1 moved.")).toHaveLength(2);
    expect(log.filter((m) => m === "Move cancelled.")).toHaveLength(1);
  });

  test("CHK2-R4 (UI side) every poll state, connection state and host marker has an icon and a text; grayscale screenshot attached", async ({ mm }, testInfo) => {
    await mm.open({
      polls: STANDARD_8.slice(0, 6),
      connected: true,
      seed: async (f, _a, ids) => {
        f.scriptFault(ids[1], { kind: "exception", code: 2 });
        f.scriptFault(ids[2], { kind: "timeout" });
        f.scriptFault(ids[3], { kind: "badResponse", badKind: "crc", detail: { expected: null, got: null, message: "" } });
      },
    });
    const ids = await mm.pollIds();
    await mm.advance(5000);
    await mm.script((f, id) => f.setPollActive(id, false), ids[4]);
    await mm.script((f, id) => f.popOutPoll(id, { kind: "rect", rect: { x: 1, y: 1, width: 600, height: 400 } }, null), ids[0]);
    await mm.titleButton(ids[5] as number, "Minimize").click();
    const rows = await mm.pollList.getByRole("option").evaluateAll((els) =>
      els.map((el) => ({ text: (el.textContent ?? "").trim(), icons: el.querySelectorAll("[data-icon]").length })),
    );
    for (const r of rows) {
      expect(r.icons, `icon in row "${r.text}"`).toBeGreaterThan(0);
      expect(r.text.length).toBeGreaterThan(5);
    }
    const labels = await mm.pollList.getByRole("option").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(labels.join("|")).toContain("Exception 02");
    expect(labels.join("|")).toContain("Timeout");
    expect(labels.join("|")).toContain("Bad response");
    expect(labels.join("|")).toContain("Paused");
    expect(labels.join("|")).toContain("own window");
    expect(labels.join("|")).toContain("minimized");
    // The active sub-window differs by border width and aria-current, not by color only.
    const active = await mm.page.locator('[data-subwindow][aria-current="true"]').first().evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopWidth));
    const inactive = await mm.page.locator('[data-subwindow]:not([aria-current="true"])').first().evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopWidth));
    expect(active).toBeGreaterThan(inactive);
    await mm.page.addStyleTag({ content: "html { filter: grayscale(1); }" });
    await testInfo.attach("grayscale-states.png", { body: await mm.page.screenshot(), contentType: "image/png" });
  });

  test("CHK2-R5 contrast: dark on the warning status line, light on the active title bar; no red or orange text", async ({ mm }) => {
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }],
      connected: true,
      seed: async (f, _a, ids) => {
        f.scriptFault(ids[0], { kind: "timeout" });
        f.scriptFault(ids[1], { kind: "exception", code: 2 });
      },
    });
    const [a, b] = (await mm.pollIds()) as [number, number];
    await mm.advance(5000);
    await expect(mm.statusLine(a)).toHaveAttribute("data-tone", "warning");
    const ratios = await mm.page.evaluate(
      ({ warn, title, error }) => {
        const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
        const rgba = (css: string): [number, number, number] => {
          // Translucent colors (the error tint) are composited over the white card behind them.
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, 1, 1);
          ctx.fillStyle = css;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return [d[0] as number, d[1] as number, d[2] as number];
        };
        const lum = ([r, g, bl]: [number, number, number]) => {
          const f = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
        };
        const ratio = (c1: [number, number, number], c2: [number, number, number]) => {
          const [hi, lo] = [lum(c1), lum(c2)].sort((x, y) => y - x) as [number, number];
          return (hi + 0.05) / (lo + 0.05);
        };
        const pair = (sel: string, textSel?: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          const t = (textSel ? (el.querySelector(textSel) as HTMLElement) : el) ?? el;
          return ratio(rgba(getComputedStyle(el).backgroundColor), rgba(getComputedStyle(t).color));
        };
        // Red and orange text anywhere in the page (the text of an element that owns text).
        const reds: string[] = [];
        const near = (c: [number, number, number], t: [number, number, number]) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]) < 40;
        const red = rgba("#ef4444");
        const orange = rgba("#fa8130");
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
          if (!own) continue;
          const c = rgba(getComputedStyle(el).color);
          if (near(c, red) || near(c, orange)) reds.push(`${el.tagName}:${(el.textContent ?? "").trim().slice(0, 30)}`);
        }
        return {
          warning: pair(warn, '[data-testid="status-reason"]'),
          titleBar: pair(title),
          error: pair(error, '[data-testid="status-reason"]'),
          reds,
        };
      },
      {
        warn: `[data-subwindow="${a}"] [data-testid="poll-status-line"]`,
        title: `[data-subwindow][aria-current="true"] [data-slot="title-bar"]`,
        error: `[data-subwindow="${b}"] [data-testid="poll-status-line"]`,
      },
    );
    expect(ratios.warning, "dark on warning").toBeGreaterThanOrEqual(5.2 - 0.1);
    expect(ratios.titleBar, "light on the active title bar").toBeGreaterThanOrEqual(11.6 - 0.2);
    expect(ratios.error, "dark on error tint").toBeGreaterThanOrEqual(4.5);
    expect(ratios.reds, "no red or orange text").toEqual([]);
  });
});
