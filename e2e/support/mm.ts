// Page object and scripting helpers for the multi-poll Modbus Master (CHK-002, UI mode).
//
// UI mode = Vite dev server with VITE_FAKE_IPC=manual. The app talks to the fake IPC, which the
// test scripts through `window.__ESEFACT_FAKE_IPC__`. Three modes of the fake are used:
//   - manual (the default of the dev server): nothing happens by itself; the test emits events.
//   - virtual (`mm.useVirtual()`): a full backend in virtual time. Connect, the scheduler, counters
//     and traffic run when the test calls `mm.advance(ms)`. No real timers, so it is deterministic.
//   - realtime (`mm.useRealtime()`): the same driven by a 20 ms timer; only the perf project uses it.
//
// A native poll window (W2) is another page with its own fake. `openNative` seeds that fake with an
// init script that traps the assignment of `window.__ESEFACT_FAKE_IPC__`, so the poll exists, is
// "native" and carries a handoff before the app attaches its view.
import { expect, type Locator, type Page } from "@playwright/test";

// biome-ignore lint/suspicious/noExplicitAny: the fake lives in the page, tests script it through eval
export type Fake = any;

declare global {
  interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: see Fake
    __ESEFACT_FAKE_IPC__?: any;
    // biome-ignore lint/suspicious/noExplicitAny: see Fake
    __ESEFACT_FAKE_WINDOW_IPC__?: any;
    __qa?: Record<string, unknown>;
    __ESEFACT_RENDERS__?: { get(key: string): number; all(): Record<string, number>; reset(): void };
  }
}

export const TOOL_ROUTE = "/tools/modbus-master";
export const NATIVE_ROUTE = "/tools/modbus-master/poll";

/** 1618 x 834 gives a workspace of 1332 x 716, so the tile area is 1316 x 700 (DES-002 2.8 vectors). */
export const REF_VIEWPORT = { width: 1618, height: 834 } as const;
/** The tile area of the reference viewport (inner workspace minus the 8 px padding). */
export const REF_AREA = { width: 1316, height: 700 } as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FormatOverrideSpec {
  start: number;
  end: number;
  format:
    | "unsigned"
    | "signed"
    | "hex"
    | "binary"
    | "signed32"
    | "unsigned32"
    | "float32"
    | "signed64"
    | "unsigned64"
    | "float64";
  swapBytes: boolean;
  reverseWords: boolean;
}

/** A format on a range with the default byte and word order (big-endian) unless `order` says so. */
export const fmt = (
  start: number,
  end: number,
  format: FormatOverrideSpec["format"],
  order: Partial<Pick<FormatOverrideSpec, "swapBytes" | "reverseWords">> = {},
): FormatOverrideSpec => ({ start, end, format, swapBytes: false, reverseWords: false, ...order });

export interface PollSpec {
  name: string;
  /** Function code, default 3. */
  fc?: 1 | 2 | 3 | 4;
  start?: number;
  qty?: number;
  /** Scan rate in ms, default 100. */
  scan?: number;
  /** Slave id, default 1. */
  slave?: number;
  aliases?: Array<{ address: number; alias: string }>;
  /** Display settings patch, e.g. `{ addressBase: 1 }`. */
  display?: Record<string, unknown>;
  /** Per-row formats (REQ-009): inclusive protocol address ranges, sorted, non-overlapping. */
  formatOverrides?: FormatOverrideSpec[];
  host?: "workspace" | "native";
}

/** "Standard 8 polls" of CHK-002 (P6 gets an exception 02 fault from the test). */
export const STANDARD_8: PollSpec[] = [
  { name: "Poll 1", fc: 3, start: 0, qty: 10 },
  { name: "Poll 2", fc: 3, start: 10, qty: 10 },
  { name: "Poll 3", fc: 4, start: 0, qty: 10 },
  { name: "Poll 4", fc: 1, start: 0, qty: 32 },
  { name: "Poll 5", fc: 2, start: 0, qty: 8 },
  { name: "Poll 6", fc: 3, start: 20, qty: 125 },
  { name: "Poll 7", fc: 3, start: 50, qty: 10, slave: 2 },
  { name: "Poll 8", fc: 3, start: 0, qty: 2, scan: 1000 },
];

export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Runs inside the page: creates polls with the fake and returns their ids. */
const ADD_POLLS = async (f: Fake, specs: PollSpec[]): Promise<number[]> => {
  const ids: number[] = [];
  for (const s of specs) {
    ids.push(
      await f.addPoll(
        {
          name: s.name,
          definition: {
            slaveId: s.slave ?? 1,
            function: s.fc ?? 3,
            startAddress: s.start ?? 0,
            quantity: s.qty ?? 10,
            scanRateMs: s.scan ?? 100,
          },
          display: {
            addressBase: 0,
            showAlias: true,
            copyAlias: false,
            ...(s.display ?? {}),
          },
          formatOverrides: s.formatOverrides ?? [],
          colorRules: [],
          scale: null,
          scaleOverrides: [],
          valueColumns: "raw",
          aliases: s.aliases ?? [],
        },
        s.host ?? "workspace",
      ),
    );
  }
  return ids;
};

export interface OpenOptions {
  route?: string;
  viewport?: { width: number; height: number };
  /** Switch the fake to this mode before the app boots (default: leave manual). */
  mode?: "manual" | "virtual" | "realtime";
  /**
   * Runs against the fake in the page BEFORE the app attaches (at the assignment of
   * `window.__ESEFACT_FAKE_IPC__`). Must not capture variables.
   */
  seed?: (fake: Fake, arg: never, ids: number[]) => unknown;
  seedArg?: unknown;
  /** Polls created in the fake before the app boots (they are part of the first snapshot). */
  polls?: PollSpec[];
  /**
   * The fake is connected (virtual time, 127.0.0.1:5020) before the app boots, `true` = 300 ms of
   * polling already happened. The window starts connected and not Modified.
   */
  connected?: boolean | number;
  /** Wait until the toolbar is usable (default true). The native window has no such toolbar. */
  waitReady?: boolean;
}

/** The init script: calls the seed the moment the app creates the fake. */
export function seedScript(seedSrc: string | null, argJson: string, mode: string | null): string {
  return `(() => {
    let current;
    Object.defineProperty(window, "__ESEFACT_FAKE_IPC__", {
      configurable: true,
      get() { return current; },
      set(f) {
        current = f;
        try {
          ${mode ? `f.setMode(${JSON.stringify(mode)});` : ""}
          ${seedSrc ? `Promise.resolve((${seedSrc})(f, ${argJson})).catch((e) => { window.__qa = { ...(window.__qa || {}), seedError: String(e && e.stack || e) }; });` : ""}
        } catch (e) {
          window.__qa = { ...(window.__qa || {}), seedError: String(e && e.stack || e) };
        }
      },
    });
  })();`;
}

export class Mm {
  readonly pageErrors: string[] = [];
  readonly consoleMessages: string[] = [];
  /** Main-frame navigations: more than one per `open` means the page reloaded (for example Vite HMR). */
  readonly navigations: string[] = [];

  constructor(readonly page: Page) {
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) this.navigations.push(f.url());
    });
    page.on("pageerror", (e) => this.pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") this.consoleMessages.push(m.text());
    });
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  async open(opts: OpenOptions = {}): Promise<void> {
    const { route = TOOL_ROUTE, viewport = REF_VIEWPORT, mode = null, seed, seedArg, polls, connected } = opts;
    await this.page.setViewportSize(viewport);
    if (seed || mode || polls || connected) {
      // The polls (and the seed) exist in the fake before the window attaches, so they are part of
      // its first snapshot: the profile is not "Modified" and the polls are not "new".
      const src =
        polls || seed || connected
          ? `async (f, a) => { const ids = await (${ADD_POLLS.toString()})(f, a.polls || []); ${
              seed ? `await (${seed.toString()})(f, a.arg, ids);` : ""
            } ${
              connected
                ? `f.setMode("virtual"); await f.connect({ mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 }); f.advance(${connected === true ? 300 : connected});`
                : ""
            } }`
          : null;
      await this.page.addInitScript(
        seedScript(src, JSON.stringify({ polls: polls ?? [], arg: seedArg ?? null }), mode),
      );
    }
    await this.page.goto(route);
    await this.page.waitForFunction(() => window.__ESEFACT_FAKE_IPC__ !== undefined, null, {
      timeout: 30_000,
    });
    if (opts.waitReady !== false) {
      // Ready = the first snapshot was applied: the connection button of the state is enabled.
      await expect(
        this.toolbar.getByRole("button", { name: /^(Connect|Disconnect|Reconnect|Cancel)$/ }).first(),
      ).toBeEnabled({ timeout: 30_000 });
    }
  }

  // ---- scripting the fake --------------------------------------------------------------------

  /** Runs `fn(fake, arg)` inside the page. `fn` must not capture variables. */
  async script<A, R>(fn: (fake: Fake, arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    return this.page.evaluate(
      ({ src, a }) => {
        // biome-ignore lint/security/noGlobalEval: the helper source is our own test code
        const f = (0, eval)(`(${src})`);
        return f(window.__ESEFACT_FAKE_IPC__, a);
      },
      { src: fn.toString(), a: arg as A },
    );
  }

  async useVirtual(): Promise<void> {
    await this.script((f) => f.setMode("virtual"));
  }
  async useRealtime(): Promise<void> {
    await this.script((f) => f.setMode("realtime"));
  }
  /** Virtual time only: runs the backend for `ms`. */
  async advance(ms: number): Promise<void> {
    await this.script((f, n) => f.advance(n), ms);
  }

  async calls(method: string): Promise<unknown[][]> {
    return this.script((f, m) => JSON.parse(JSON.stringify(f.callsOf(m))), method);
  }
  async callCount(method: string): Promise<number> {
    return (await this.calls(method)).length;
  }
  async expectCalls(method: string, n: number): Promise<void> {
    await expect.poll(() => this.callCount(method), { message: `calls of ${method}` }).toBe(n);
  }
  async lastCall(method: string): Promise<unknown[] | undefined> {
    const all = await this.calls(method);
    return all[all.length - 1];
  }

  /** Creates polls through the fake (no UI). Returns their ids in order. */
  async addPolls(specs: PollSpec[]): Promise<number[]> {
    const ids = await this.script(ADD_POLLS, specs);
    // The window follows the poll list: wait until every sub-window (or row) is there.
    for (const [i, s] of specs.entries()) {
      await expect(this.row(ids[i] as number)).toBeVisible();
      if ((s.host ?? "workspace") === "workspace") {
        await expect(this.sub(ids[i] as number)).toBeVisible();
      }
    }
    return ids;
  }

  async pollIds(): Promise<number[]> {
    return this.script((f) => f.pollIds());
  }

  /** The id of the poll with this name (from the fake's model). */
  async idOf(name: string): Promise<number> {
    const id = await this.script((f, n) => {
      const hit = f.snapshot().polls.find((p: { config: { name: string } }) => p.config.name === n);
      return hit ? hit.config.pollId : null;
    }, name);
    if (id === null) throw new Error(`no poll named ${name}`);
    return id;
  }

  async layout(): Promise<{
    items: Array<{ pollId: number; rect: Rect & { z: number; state: string; restore: Rect | null } }>;
    minimizedOrder: number[];
    tileMode: boolean;
    compact: boolean;
    trafficExpanded: boolean;
  }> {
    return this.script((f) => JSON.parse(JSON.stringify(f.snapshot().workspaceLayout)));
  }

  /** The rectangle Rust holds for a poll (what the window last reported). */
  async storedRect(id: number): Promise<(Rect & { z: number; state: string; restore: Rect | null }) | null> {
    const l = await this.layout();
    return l.items.find((i) => i.pollId === id)?.rect ?? null;
  }

  // ---- locators: window ---------------------------------------------------------------------

  get toolbar(): Locator {
    return this.page.getByRole("toolbar", { name: "Toolbar", exact: true });
  }
  get workspace(): Locator {
    return this.page.locator("[data-workspace]");
  }
  get sidebar(): Locator {
    return this.page.locator('[data-slot="sidebar"]');
  }
  get rail(): Locator {
    return this.page.locator('[data-slot="sidebar-rail"]');
  }
  get pollList(): Locator {
    return this.page.getByRole("listbox", { name: "Polls" });
  }
  get pill(): Locator {
    return this.toolbar.locator('[data-slot="status-pill"]').first();
  }
  get summaryChip(): Locator {
    return this.page.getByTestId("summary-chip");
  }
  get banner(): Locator {
    return this.page.locator('[data-slot="state-banner"]');
  }
  get trafficBar(): Locator {
    return this.page.getByTestId("traffic-bar");
  }
  get traffic(): Locator {
    return this.page.getByTestId("traffic-panel");
  }
  get frameList(): Locator {
    return this.page.locator('[role="grid"][aria-label="Frames"]');
  }
  get statusBar(): Locator {
    return this.page.getByTestId("status-text");
  }
  get workspaceEmpty(): Locator {
    return this.page.getByTestId("workspace-empty");
  }
  get minimizedBar(): Locator {
    return this.page.locator('[data-slot="minimized-bar"]');
  }
  get livePolite(): Locator {
    return this.page.getByTestId("live-polite");
  }
  get liveAssertive(): Locator {
    return this.page.getByTestId("live-assertive");
  }
  get profileLabel(): Locator {
    return this.page.getByTestId("profile");
  }
  get tileIndicator(): Locator {
    return this.page.getByTestId("tile-mode-indicator");
  }
  get toasts(): Locator {
    return this.page.locator('[role="status"][aria-live="polite"] [data-tone]');
  }
  toast(text: string | RegExp): Locator {
    return this.toasts.filter({ hasText: text });
  }
  get confirm(): Locator {
    return this.page.getByRole("alertdialog");
  }
  get writeDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^Write/ });
  }
  get openDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Open profile" });
  }
  get saveAsDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Save profile as" });
  }

  toolbarButton(name: string): Locator {
    return this.toolbar.getByRole("button", { name, exact: true });
  }
  bannerButton(name: string): Locator {
    return this.banner.getByRole("button", { name, exact: true });
  }
  counter(name: "requests" | "responses" | "errors" | "timeouts"): Locator {
    return this.page.getByTestId(`traffic-counter-${name}`);
  }

  // ---- connection section -------------------------------------------------------------------

  get connectionSection(): Locator {
    return this.page.getByRole("region", { name: "Connection", exact: true });
  }
  field(label: string): Locator {
    return this.connectionSection.getByLabel(label, { exact: true });
  }
  get hostField(): Locator {
    return this.field("Host");
  }
  get portField(): Locator {
    return this.field("Port");
  }
  get timeoutField(): Locator {
    return this.field("Timeout (ms)");
  }
  get autoStart(): Locator {
    return this.connectionSection.getByLabel("Start polling when connected");
  }

  /** Types the connection and presses the toolbar Connect (or Reconnect). */
  async pressConnect(
    opts: { host?: string; port?: number | string; timeoutMs?: number | string; autoStart?: boolean } = {},
  ): Promise<void> {
    const { host = "127.0.0.1", port = 5020, timeoutMs, autoStart } = opts;
    if (!(await this.hostField.isVisible())) await this.page.getByRole("button", { name: "Edit", exact: true }).click();
    await this.hostField.fill(host);
    await this.portField.fill(String(port));
    if (timeoutMs !== undefined) await this.timeoutField.fill(String(timeoutMs));
    if (autoStart !== undefined && (await this.autoStart.isChecked()) !== autoStart) {
      await this.autoStart.setChecked(autoStart);
    }
    const before = await this.callCount("connect");
    await this.toolbarButton("Connect").click();
    await this.expectCalls("connect", before + 1);
  }

  /** Virtual mode: connect and let the link come up. */
  async connectVirtual(opts: Parameters<Mm["pressConnect"]>[0] = {}): Promise<void> {
    await this.useVirtual();
    await this.pressConnect(opts);
    await expect(this.pill).toContainText("Connected");
  }

  // ---- locators: sub-windows and rows -------------------------------------------------------

  /** A sub-window by poll id (preferred) or by poll name. */
  sub(who: number | string): Locator {
    return typeof who === "number"
      ? this.page.locator(`[data-subwindow="${who}"]`)
      : this.page.getByRole("region", { name: new RegExp(`^${esc(who)}, .*, sub-window$`) });
  }
  titleBar(who: number | string): Locator {
    return typeof who === "number"
      ? this.sub(who).locator('[data-slot="title-bar"]')
      : this.page.getByRole("toolbar", { name: `${who} window`, exact: true });
  }
  statusLine(who: number | string): Locator {
    return this.sub(who).getByTestId("poll-status-line");
  }
  grid(who: number | string): Locator {
    return this.sub(who).getByRole("grid", { name: "Register values" });
  }
  gridRow(who: number | string, index: number): Locator {
    return this.grid(who).locator(`[data-row="${index}"]`);
  }
  titleButton(who: number | string, name: string | RegExp): Locator {
    return this.titleBar(who).getByRole("button", { name });
  }
  /** The popover or dock of a sub-window. */
  setup(who: number | string): Locator {
    return this.sub(who).getByTestId("poll-setup");
  }
  setupField(who: number | string, label: string): Locator {
    return this.setup(who).getByLabel(label, { exact: true });
  }
  /** The 300 px dock of a sub-window (hook `data-slot="setup-dock"`, on the surface only). */
  setupDock(who: number | string): Locator {
    return this.sub(who).locator('[data-slot="setup-dock"]');
  }
  /** The 360 px popover of a sub-window (hook `data-slot="setup-popover"`). */
  setupPopover(who: number | string): Locator {
    return this.sub(who).locator('[data-slot="setup-popover"]');
  }

  /** A sidebar row by poll id or by name. */
  row(who: number | string): Locator {
    return typeof who === "number"
      ? this.pollList.locator(`[data-poll-id="${who}"]`)
      : this.pollList.getByRole("option", { name: new RegExp(`^${esc(who)}, `) });
  }

  /** Frame rectangle in workspace coordinates, measured from the DOM (includes a live drag). */
  async domRect(id: number): Promise<Rect> {
    const ws = await this.workspace.boundingBox();
    const box = await this.sub(id).boundingBox();
    if (!ws || !box) throw new Error(`sub-window ${id} or workspace not rendered`);
    return {
      x: Math.round(box.x - ws.x),
      y: Math.round(box.y - ws.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  }

  /** The size of the workspace's inner area (what the app calls the workspace size). */
  async workspaceSize(): Promise<{ width: number; height: number }> {
    const box = await this.workspace.boundingBox();
    if (!box) throw new Error("workspace not rendered");
    return { width: Math.round(box.width), height: Math.round(box.height) };
  }

  // ---- menus ---------------------------------------------------------------------------------

  /** Opens a toolbar menu ("File", "Connection", "Window") and returns the menu list. */
  async openMenu(name: "File" | "Connection" | "Window"): Promise<Locator> {
    await this.toolbar.getByRole("button", { name, exact: true }).click();
    const menu = this.page.getByRole("menu").first();
    await expect(menu).toBeVisible();
    return menu;
  }

  /** A menu entry by its label. Shortcut text is part of the accessible name, so it is allowed. */
  menuItem(label: string, role: "menuitem" | "menuitemcheckbox" | "menuitemradio" = "menuitem"): Locator {
    return this.page
      .getByRole("menu")
      .last()
      .getByRole(role, { name: new RegExp(`^${esc(label)}(\\s+(Ctrl\\+|Alt\\+|Shift\\+|F\\d+|Enter|Delete).*)?$`) });
  }

  async windowMenu(
    label: string,
    role: "menuitem" | "menuitemcheckbox" | "menuitemradio" = "menuitem",
  ): Promise<void> {
    await this.openMenu("Window");
    await this.menuItem(label, role).click();
  }

  // ---- state helpers --------------------------------------------------------------------------

  async expectPill(label: string | RegExp, icon?: string): Promise<void> {
    await expect(this.pill).toHaveText(label);
    if (icon) await expect(this.pill.locator(`[data-icon="${icon}"]`)).toHaveCount(1);
  }

  async expectConnection(state: "idle" | "connecting" | "connected" | "disconnected"): Promise<void> {
    await expect(this.page.locator("[data-connection-state]")).toHaveAttribute(
      "data-connection-state",
      state,
    );
  }

  /** Text of a status line, with the chip label first: e.g. "Polling Tx 11 · Err 0 · ID 1 · F 03 · SR 100 ms". */
  async statusText(who: number | string): Promise<string> {
    return ((await this.statusLine(who).innerText()) ?? "").replace(/\s+/g, " ").trim();
  }

  /** Every announcement W1 made, oldest first (fake window IPC log). */
  async announcements(): Promise<Array<{ text: string; assertive: boolean }>> {
    return this.page.evaluate(() =>
      JSON.parse(JSON.stringify(window.__ESEFACT_FAKE_WINDOW_IPC__?.announcements ?? [])),
    );
  }
  /** How many announcements have exactly this text (string) or match (RegExp). */
  async announcedCount(text: string | RegExp): Promise<number> {
    const all = await this.announcements();
    return all.filter((a) => (typeof text === "string" ? a.text === text : text.test(a.text))).length;
  }
  /** The sequence number of the announcement a live region holds (`data-seq`, 0 when empty). */
  async liveSeq(region: "polite" | "assertive"): Promise<number> {
    const loc = region === "polite" ? this.livePolite : this.liveAssertive;
    return Number((await loc.getAttribute("data-seq")) ?? 0);
  }

  /** The dev render probe: commits of the body of one poll view (key `poll-view:{id}`). */
  async renders(pollId: number): Promise<number> {
    return this.page.evaluate((id) => window.__ESEFACT_RENDERS__?.get(`poll-view:${id}`) ?? -1, pollId);
  }
  async allRenders(): Promise<Record<string, number>> {
    return this.page.evaluate(() => window.__ESEFACT_RENDERS__?.all() ?? {});
  }
  async resetRenders(): Promise<void> {
    await this.page.evaluate(() => window.__ESEFACT_RENDERS__?.reset());
  }

  /** A cell of a traffic row by its hook (`data-cell`: seq, time, dir, len, bytes, info, poll). */
  trafficCell(row: Locator, cell: "seq" | "time" | "dir" | "len" | "bytes" | "info" | "poll"): Locator {
    return row.locator(`[data-cell="${cell}"]`);
  }

  async modified(): Promise<boolean> {
    return (await this.profileLabel.innerText()).includes("Modified");
  }

  async clipboardText(): Promise<string> {
    const text = await this.page.evaluate(() => navigator.clipboard.readText());
    return text.replace(/\r\n/g, "\n");
  }
  async setClipboard(text: string): Promise<void> {
    await this.page.evaluate((t) => navigator.clipboard.writeText(t), text);
  }

  /** The user asks to close the window. Read the outcome with `closeOutcome()`. */
  async requestClose(): Promise<void> {
    await this.page.evaluate(() => {
      const w = window.__ESEFACT_FAKE_WINDOW_IPC__;
      window.__qa = { ...(window.__qa ?? {}), closing: "pending" };
      void w?.requestClose().then((closed: boolean) => {
        (window.__qa as { closing: string }).closing = closed ? "closed" : "kept";
      });
    });
  }
  async closeOutcome(): Promise<string> {
    return this.page.evaluate(() => String((window.__qa as { closing?: string } | undefined)?.closing));
  }
  async windowTitles(): Promise<string[]> {
    return this.page.evaluate(() => [...(window.__ESEFACT_FAKE_WINDOW_IPC__?.titles ?? [])]);
  }
  async openedTools(): Promise<string[]> {
    return this.page.evaluate(() => [...(window.__ESEFACT_FAKE_WINDOW_IPC__?.openedTools ?? [])]);
  }

  // ---- pointer helpers (real mouse events) ----------------------------------------------------

  /** Page coordinates of a point in workspace coordinates. */
  async wsPoint(x: number, y: number): Promise<{ x: number; y: number }> {
    const ws = await this.workspace.boundingBox();
    if (!ws) throw new Error("workspace not rendered");
    return { x: ws.x + x, y: ws.y + y };
  }

  /** A point on a title bar: `dx` px from its left edge (the name area), vertically centered. */
  async titlePoint(id: number, dx = 40): Promise<{ x: number; y: number }> {
    const box = await this.titleBar(id).boundingBox();
    if (!box) throw new Error(`title bar ${id} not rendered`);
    return { x: box.x + dx, y: box.y + box.height / 2 };
  }

  /**
   * Presses at `from`, moves to `to` in `steps` pointer moves and returns without releasing. The
   * caller waits for what the drag should show and then calls `page.mouse.up()`.
   */
  async dragStart(
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps = 6,
  ): Promise<void> {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps });
  }

  async dragTitle(id: number, dx: number, dy: number, opts: { dxStart?: number; steps?: number } = {}): Promise<void> {
    const from = await this.titlePoint(id, opts.dxStart ?? 40);
    await this.dragStart(from, { x: from.x + dx, y: from.y + dy }, opts.steps ?? 8);
  }

  async release(): Promise<void> {
    await this.page.mouse.up();
  }

  /** Waits (condition, no sleep) until the frame's DOM rectangle equals `want` (partial allowed). */
  async expectDomRect(id: number, want: Partial<Rect>): Promise<void> {
    await expect.poll(() => this.domRect(id), { message: `rect of sub-window ${id}` }).toMatchObject(want);
  }

  async expectStoredRect(id: number, want: Partial<Rect> & { state?: string }): Promise<void> {
    await expect
      .poll(() => this.storedRect(id), { message: `stored rect of poll ${id}` })
      .toMatchObject(want);
  }

  /** Resizes the viewport until the workspace has exactly this inner size. */
  async sizeWorkspaceTo(width: number, height: number): Promise<void> {
    const vp = this.page.viewportSize() ?? REF_VIEWPORT;
    const now = await this.workspaceSize();
    await this.page.setViewportSize({
      width: vp.width + (width - now.width),
      height: vp.height + (height - now.height),
    });
    await expect.poll(() => this.workspaceSize()).toEqual({ width, height });
  }

  // ---- native window harness -------------------------------------------------------------------

  /**
   * Opens a native poll window W2 as a new page in the same browser context. Its fake is seeded
   * with `polls` (workspace polls, then `pollId` index is popped out with the optional handoff),
   * is switched to virtual time and, when `connect` is set, connected. `advanceMs` runs the
   * scheduler so that values exist when the view attaches.
   */
  async openNative(opts: {
    polls: PollSpec[];
    /** Index into `polls` of the poll shown in this window. */
    index?: number;
    handoff?: string | null;
    /** true: connected (default); false: never connected; "idle": connected once, then disconnected. */
    connect?: boolean | "idle";
    advanceMs?: number;
    /** Real-time fake (perf): the link comes up by itself and the poll runs on a 20 ms ticker. */
    realtime?: boolean;
    viewport?: { width: number; height: number };
    seedExtra?: (fake: Fake) => unknown;
  }): Promise<NativeWin> {
    const page = await this.page.context().newPage();
    const win = new NativeWin(page);
    const index = opts.index ?? 0;
    const seed = async (
      f: Fake,
      a: {
        specs: PollSpec[];
        index: number;
        handoff: string | null;
        connect: boolean | "idle";
        advanceMs: number;
        realtime: boolean;
        extra: string | null;
      },
    ) => {
      const ids: number[] = [];
      for (const s of a.specs) {
        ids.push(
          await f.addPoll(
            {
              name: s.name,
              definition: {
                slaveId: s.slave ?? 1,
                function: s.fc ?? 3,
                startAddress: s.start ?? 0,
                quantity: s.qty ?? 10,
                scanRateMs: s.scan ?? 100,
              },
              display: {
                addressBase: 0,
                showAlias: true,
                copyAlias: false,
                ...(s.display ?? {}),
              },
              formatOverrides: s.formatOverrides ?? [],
              colorRules: [],
              scale: null,
              scaleOverrides: [],
              valueColumns: "raw",
              aliases: s.aliases ?? [],
            },
            "workspace",
          ),
        );
      }
      f.setMode(a.realtime ? "realtime" : "virtual");
      if (a.connect) {
        await f.connect({ mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 });
        if (!a.realtime) f.advance(a.advanceMs);
        if (a.connect === "idle") await f.disconnect();
      }
      await f.popOutPoll(
        ids[a.index],
        { kind: "rect", rect: { x: 100, y: 100, width: 900, height: 640 } },
        a.handoff,
      );
      if (a.extra) await (0, eval)(`(${a.extra})`)(f, ids);
      window.__qa = { ...(window.__qa ?? {}), seeded: ids };
    };
    await page.addInitScript(
      seedScript(
        seed.toString(),
        JSON.stringify({
          specs: opts.polls,
          index,
          handoff: opts.handoff ?? null,
          connect: opts.connect ?? true,
          advanceMs: opts.advanceMs ?? 500,
          realtime: opts.realtime ?? false,
          extra: opts.seedExtra ? opts.seedExtra.toString() : null,
        }),
        null,
      ),
    );
    await page.setViewportSize(opts.viewport ?? { width: 900, height: 700 });
    await page.goto(`${NATIVE_ROUTE}?pollId=${index + 1}`);
    await page.waitForFunction(() => (window.__qa as { seeded?: number[] } | undefined)?.seeded !== undefined, null, {
      timeout: 30_000,
    });
    await page.bringToFront();
    // Ready = the window says so (`data-ready`: close handler registered and attach finished) and the
    // view really is attached (data-ready is also true when the attach failed).
    await expect(win.root).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(page.locator('[data-slot="poll-view"]')).toHaveAttribute("data-attach", "attached", { timeout: 30_000 });
    await expect(win.name).not.toHaveText("", { timeout: 30_000 });
    await expect(win.toolbar.getByRole("button", { name: "Dock to workspace" })).toBeEnabled({ timeout: 30_000 });
    return win;
  }
}

/** A native poll window (a second page with its own seeded fake). */
export class NativeWin {
  readonly pageErrors: string[] = [];
  constructor(readonly page: Page) {
    page.on("pageerror", (e) => this.pageErrors.push(String(e)));
  }
  get toolbar(): Locator {
    return this.page.getByRole("toolbar", { name: "Poll window toolbar" });
  }
  get name(): Locator {
    return this.page.getByTestId("native-poll-name");
  }
  get pill(): Locator {
    return this.toolbar.locator('[data-slot="status-pill"]').first();
  }
  get connectionPill(): Locator {
    return this.toolbar.locator('[data-slot="status-pill"]').last();
  }
  get banner(): Locator {
    return this.page.locator('[data-region="banner"] [data-slot="state-banner"]');
  }
  get statusBar(): Locator {
    return this.page.getByTestId("native-status-text");
  }
  get statusLine(): Locator {
    return this.page.getByTestId("poll-status-line");
  }
  get grid(): Locator {
    return this.page.getByRole("grid", { name: "Register values" });
  }
  gridRow(index: number): Locator {
    return this.grid.locator(`[data-row="${index}"]`);
  }
  get view(): Locator {
    return this.page.locator('[data-slot="poll-view"]');
  }
  get setupPanel(): Locator {
    return this.page.locator('[data-slot="setup-panel"]');
  }
  get rail(): Locator {
    return this.page.locator('[data-slot="setup-rail"]');
  }
  /** The window element: `data-ready` (close handler registered, attach done) and `data-prefs`. */
  get root(): Locator {
    return this.page.locator("[data-native-window]");
  }
  /** The preferences the window applied (`data-prefs` JSON). */
  async prefs(): Promise<{ askOnPollClose: boolean; compact: boolean }> {
    return JSON.parse((await this.root.getAttribute("data-prefs")) ?? "{}");
  }
  async announcements(): Promise<Array<{ text: string; assertive: boolean }>> {
    return this.page.evaluate(() =>
      JSON.parse(JSON.stringify(window.__ESEFACT_FAKE_WINDOW_IPC__?.announcements ?? [])),
    );
  }
  async announcedCount(text: string | RegExp): Promise<number> {
    const all = await this.announcements();
    return all.filter((a) => (typeof text === "string" ? a.text === text : text.test(a.text))).length;
  }
  get toasts(): Locator {
    return this.page.locator('[role="status"][aria-live="polite"] [data-tone]');
  }
  get confirm(): Locator {
    return this.page.getByRole("alertdialog");
  }
  get livePolite(): Locator {
    return this.page.getByTestId("live-polite");
  }
  field(label: string): Locator {
    return this.page.getByTestId("poll-setup").getByLabel(label, { exact: true });
  }
  toolbarButton(name: string): Locator {
    return this.toolbar.getByRole("button", { name, exact: true });
  }
  async script<A, R>(fn: (fake: Fake, arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    return this.page.evaluate(
      ({ src, a }) => {
        // biome-ignore lint/security/noGlobalEval: the helper source is our own test code
        const f = (0, eval)(`(${src})`);
        return f(window.__ESEFACT_FAKE_IPC__, a);
      },
      { src: fn.toString(), a: arg as A },
    );
  }
  async calls(method: string): Promise<unknown[][]> {
    return this.script((f, m) => JSON.parse(JSON.stringify(f.callsOf(m))), method);
  }
  async callCount(method: string): Promise<number> {
    return (await this.calls(method)).length;
  }
  async expectCalls(method: string, n: number): Promise<void> {
    await expect.poll(() => this.callCount(method), { message: `W2 calls of ${method}` }).toBe(n);
  }
  async windowTitles(): Promise<string[]> {
    return this.page.evaluate(() => [...(window.__ESEFACT_FAKE_WINDOW_IPC__?.titles ?? [])]);
  }
  async requestClose(): Promise<void> {
    await this.page.evaluate(() => {
      const w = window.__ESEFACT_FAKE_WINDOW_IPC__;
      window.__qa = { ...(window.__qa ?? {}), closing: "pending" };
      void w?.requestClose().then((closed: boolean) => {
        (window.__qa as { closing: string }).closing = closed ? "closed" : "kept";
      });
    });
  }
  async closeOutcome(): Promise<string> {
    return this.page.evaluate(() => String((window.__qa as { closing?: string } | undefined)?.closing));
  }
  async advance(ms: number): Promise<void> {
    await this.script((f, n) => f.advance(n), ms);
  }
}

/** The hex of a frame, as the traffic panel prints it. */
export const hex = (bytes: readonly number[]): string =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");

export interface SeedItem {
  /** Index into the seeded polls. */
  index: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z?: number;
  state?: "normal" | "minimized" | "maximized";
  restore?: Rect | null;
}

/**
 * A `seed` for `open({ polls, seed: LAYOUT_SEED, seedArg })`: stores these sub-window rectangles in
 * the fake, so the window mounts them at these places. Self-contained (runs in the page).
 */
export const LAYOUT_SEED = (
  f: Fake,
  a: { items: SeedItem[]; minimizedOrder?: number[]; tileMode?: boolean; compact?: boolean; trafficExpanded?: boolean },
  ids: number[],
): void => {
  const base = f.snapshot().workspaceLayout;
  f.setWorkspaceLayout({
    ...base,
    tileMode: a.tileMode ?? false,
    compact: a.compact ?? false,
    trafficExpanded: a.trafficExpanded ?? false,
    minimizedOrder: (a.minimizedOrder ?? []).map((i) => ids[i]),
    items: a.items.map((it, n) => ({
      pollId: ids[it.index],
      rect: {
        x: it.x,
        y: it.y,
        width: it.width ?? 640,
        height: it.height ?? 368,
        z: it.z ?? n + 1,
        state: it.state ?? "normal",
        restore: it.restore ?? null,
      },
    })),
  });
};

/** A profile as the backend stores it (current schema, one workspace poll). */
export function profileV2(name: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 6,
    name,
    connection: { mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 },
    autoStartPoll: true,
    connectionWindow: null,
    workspace: {
      tileMode: false,
      compact: false,
      sidebarWidth: 280,
      sidebarCollapsed: false,
      trafficExpanded: false,
      trafficHeight: null,
      minimizedOrder: [],
    },
    polls: [
      {
        name: "Poll 1",
        definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
        active: true,
        display: { addressBase: 0, showAlias: true, copyAlias: false },
        formatOverrides: [],
        scale: null,
        scaleOverrides: [],
        valueColumns: "raw",
        aliases: [],
        view: { host: "workspace", open: true, workspace: null, native: null },
      },
    ],
    migratedFrom: null,
    ...over,
  };
}
