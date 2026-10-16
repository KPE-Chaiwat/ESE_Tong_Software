// Page object and scripting helpers for the Modbus Master window in UI mode (QA-001).
//
// UI mode = Vite dev server with VITE_FAKE_IPC=1. The app talks to a fake IPC that the test
// scripts through `window.__ESEFACT_FAKE_IPC__`. Two flavours:
//   - "manual" (default; the dev server runs with VITE_FAKE_IPC=manual): every session command is recorded and does nothing. The test drives the
//     session with emitted backend events, so every state is deterministic.
//   - "sim": the fake simulates a tiny device (connecting -> connected -> polling -> data stream),
//     used for the end-to-end smoke and the performance test.
import { expect, type Locator, type Page } from "@playwright/test";

export type SessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "polling"
  | "paused"
  | "timeout"
  | "exception"
  | "badResponse"
  | "disconnected";

export const ALL_STATES: readonly SessionState[] = [
  "idle",
  "connecting",
  "connected",
  "polling",
  "paused",
  "timeout",
  "exception",
  "badResponse",
  "disconnected",
];

export interface Reason {
  kind: string;
  phase: "connectFailed" | "linkLost";
  message: string;
}

export interface Frame {
  seq: number;
  at: number;
  direction: "tx" | "rx";
  bytes: number[];
  slaveId?: number | null;
  function?: number | null;
  exceptionCode?: number | null;
  note?: string | null;
}

export interface Counters {
  requests: number;
  responses: number;
  errors: number;
  timeouts: number;
}

/** The scriptable part of the fake that tests use. Loosely typed on purpose (it lives in the page). */
// biome-ignore lint/suspicious/noExplicitAny: the fake lives in the page, tests script it through eval
export type Fake = any;

declare global {
  interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: see Fake
    __ESEFACT_FAKE_IPC__?: any;
    // biome-ignore lint/suspicious/noExplicitAny: see Fake
    __ESEFACT_FAKE_WINDOW_IPC__?: any;
    __qa?: Record<string, unknown>;
  }
}

export const TOOL_ROUTE = "/tools/modbus-master";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 5020;

/** Local time as the app prints it (`HH:MM:SS.mmm`). Node and the browser share the time zone. */
export function hms(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export const hex = (bytes: readonly number[]): string =>
  bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");

export interface OpenOptions {
  /** Simulating fake (default false: manual). */
  sim?: boolean;
  route?: string;
}

export interface ConnectOptions {
  host?: string;
  port?: number | string;
  timeoutMs?: number | string;
  /** The "Start polling when connected" checkbox. Default false so `connected` stays connected. */
  autoStart?: boolean;
  /** Use RTU on this serial port (for example "COM3") instead of TCP. */
  rtu?: string;
}

export class ModbusApp {
  readonly pageErrors: string[] = [];
  readonly consoleWarnings: string[] = [];

  constructor(readonly page: Page) {
    page.on("pageerror", (e) => this.pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") this.consoleWarnings.push(m.text());
    });
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  async open({ sim = false, route = TOOL_ROUTE }: OpenOptions = {}): Promise<void> {
    await this.page.goto(route);
    await this.page.waitForFunction(() => window.__ESEFACT_FAKE_IPC__ !== undefined, null, {
      timeout: 30_000,
    });
    // Ready = the snapshot was applied, which enables the toolbar buttons.
    await expect(this.toolbar.getByRole("button", { name: "Connect", exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    // The dev server runs with VITE_FAKE_IPC=manual: nothing happens until the test emits events.
    if (sim) await this.script((f) => f.setSimulate(true));
  }

  // ---- fake window IPC (close request, Ctrl+N, window titles) ---------------------------------

  /** Titles the window sent to the (fake) native window, oldest first. */
  async windowTitles(): Promise<string[]> {
    return this.page.evaluate(() => [...(window.__ESEFACT_FAKE_WINDOW_IPC__?.titles ?? [])]);
  }

  async openedTools(): Promise<string[]> {
    return this.page.evaluate(() => [...(window.__ESEFACT_FAKE_WINDOW_IPC__?.openedTools ?? [])]);
  }

  /**
   * The user asks to close the window. Not awaited: a "Save changes?" confirm may wait for an
   * answer. Read the outcome with `closeOutcome()`.
   */
  async requestClose(): Promise<void> {
    await this.page.evaluate(() => {
      const w = window.__ESEFACT_FAKE_WINDOW_IPC__;
      window.__qa = { ...(window.__qa ?? {}), closing: "pending" };
      void w?.requestClose().then((closed: boolean) => {
        (window.__qa as { closing: string }).closing = closed ? "closed" : "kept";
      });
    });
  }

  /** "pending" while a confirm waits, then "closed" or "kept". */
  async closeOutcome(): Promise<string> {
    return this.page.evaluate(() => String((window.__qa as { closing?: string } | undefined)?.closing));
  }

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

  // ---- calls recorded by the fake ------------------------------------------------------------

  async calls(method: string): Promise<unknown[][]> {
    return this.script((f, m) => JSON.parse(JSON.stringify(f.callsOf(m))), method);
  }

  async callCount(method: string): Promise<number> {
    return (await this.calls(method)).length;
  }

  /** Waits (observable condition, no sleeps) until a command was recorded `n` times. */
  async expectCalls(method: string, n: number): Promise<void> {
    await expect.poll(() => this.callCount(method), { message: `calls of ${method}` }).toBe(n);
  }

  // ---- backend events ------------------------------------------------------------------------

  async emitState(
    state: SessionState,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.script(
      (f, a) => f.emitState(a.state, { at: Date.now(), ...a.extra }),
      { state, extra },
    );
  }

  async pollUpdate(
    values: number[],
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.script((f, a) => f.emitPollUpdate({ values: a.values, ...a.extra }), {
      values,
      extra,
    });
  }

  async frames(frames: Frame[]): Promise<void> {
    await this.script(
      (f, list) =>
        f.emitFrames(
          list.map((x) => ({
            slaveId: 1,
            function: 3,
            exceptionCode: null,
            note: null,
            ...x,
          })),
        ),
      frames,
    );
  }

  async counters(c: Counters): Promise<void> {
    await this.script((f, v) => f.emitCounters(v), c);
  }

  // ---- locators ------------------------------------------------------------------------------

  get toolbar(): Locator {
    return this.page.getByRole("toolbar", { name: "Toolbar" });
  }
  get pill(): Locator {
    return this.page.locator('[data-slot="status-pill"]');
  }
  get banner(): Locator {
    return this.page.locator('[data-slot="state-banner"]');
  }
  get setup(): Locator {
    return this.page.getByRole("complementary", { name: "Setup" });
  }
  get dataCard(): Locator {
    return this.page.getByRole("region", { name: "Data" });
  }
  get dataEmpty(): Locator {
    return this.page.getByTestId("data-empty");
  }
  get chip(): Locator {
    return this.page.locator('[data-slot="freshness-chip"]');
  }
  get summary(): Locator {
    return this.page.getByTestId("poll-summary");
  }
  get table(): Locator {
    return this.page.locator('[role="grid"][aria-label="Register values"]');
  }
  get traffic(): Locator {
    return this.page.getByTestId("traffic-panel");
  }
  get frameList(): Locator {
    return this.page.locator('[role="grid"][aria-label="Frames"]');
  }
  get frameDetail(): Locator {
    return this.page.getByTestId("frame-detail");
  }
  get statusBar(): Locator {
    return this.page.locator("footer");
  }
  get attention(): Locator {
    return this.page.getByTestId("attention");
  }
  get writeDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Write" });
  }
  get writeResult(): Locator {
    return this.page.getByTestId("write-result");
  }
  get openDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Open profile" });
  }
  get saveAsDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Save profile as" });
  }
  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }
  get livePolite(): Locator {
    return this.page.getByTestId("live-polite");
  }
  get liveAssertive(): Locator {
    return this.page.getByTestId("live-assertive");
  }
  get profile(): Locator {
    return this.page.getByTestId("profile");
  }
  get splitter(): Locator {
    return this.page.getByTestId("splitter");
  }

  toolbarButton(name: string): Locator {
    return this.toolbar.getByRole("button", { name, exact: true });
  }
  bannerButton(name: string): Locator {
    return this.banner.getByRole("button", { name, exact: true });
  }
  toast(text: string | RegExp): Locator {
    return this.page.locator("[data-tone]").filter({ hasText: text });
  }
  get anyToast(): Locator {
    return this.page.locator("[data-tone]");
  }

  // setup fields (scoped to the setup panel: the write dialog has fields with the same labels)
  field(label: string): Locator {
    return this.setup.getByLabel(label, { exact: true });
  }
  get host(): Locator {
    return this.field("Host");
  }
  get port(): Locator {
    return this.field("Port");
  }
  get timeout(): Locator {
    return this.field("Timeout (ms)");
  }
  get slaveId(): Locator {
    return this.field("Slave ID");
  }
  get fn(): Locator {
    return this.field("Function");
  }
  get start(): Locator {
    return this.field("Start address");
  }
  get quantity(): Locator {
    return this.field("Quantity");
  }
  get scan(): Locator {
    return this.field("Scan rate (ms)");
  }
  get autoStart(): Locator {
    return this.setup.getByLabel("Start polling when connected");
  }
  get applyButton(): Locator {
    return this.setup.getByRole("button", { name: "Apply", exact: true });
  }
  get modeTcp(): Locator {
    return this.setup.getByRole("radio", { name: "TCP", exact: true });
  }
  get modeRtu(): Locator {
    return this.setup.getByRole("radio", { name: "RTU", exact: true });
  }
  get formatGroup(): Locator {
    return this.dataCard.getByRole("radiogroup", { name: "Format" });
  }
  get baseGroup(): Locator {
    return this.dataCard.getByRole("radiogroup", { name: "Address base" });
  }

  /** The value of one traffic counter (`data-testid="traffic-counter-{name}"`). */
  counter(name: "Requests" | "Responses" | "Errors" | "Timeouts"): Locator {
    return this.page.getByTestId(`traffic-counter-${name.toLowerCase()}`);
  }

  async expectCounters(c: Counters): Promise<void> {
    await expect(this.counter("Requests")).toHaveText(String(c.requests));
    await expect(this.counter("Responses")).toHaveText(String(c.responses));
    await expect(this.counter("Errors")).toHaveText(String(c.errors));
    await expect(this.counter("Timeouts")).toHaveText(String(c.timeouts));
  }

  /** The window root carries the session state (`data-session-state`). */
  async expectSessionState(state: SessionState): Promise<void> {
    await expect(this.page.locator("[data-session-state]")).toHaveAttribute(
      "data-session-state",
      state,
    );
  }

  /** The data grid says whether its values are live, stale or still loading (`data-status`). */
  async expectGridStatus(status: "live" | "stale" | "loading"): Promise<void> {
    await expect(this.table).toHaveAttribute("data-status", status);
  }

  row(i: number): Locator {
    return this.table.locator(`#data-row-${i}`);
  }
  /** The Value cell of data row `i`. */
  value(i: number): Locator {
    return this.row(i).locator('[role="gridcell"]').nth(1);
  }
  address(i: number): Locator {
    return this.row(i).locator('[role="gridcell"]').first();
  }
  frameRow(seq: number): Locator {
    return this.frameList.locator(`#frame-${seq}`);
  }

  // ---- state helpers -------------------------------------------------------------------------

  async pillText(): Promise<string> {
    return (await this.pill.innerText()).trim();
  }

  async expectPill(label: string | RegExp, icon: string): Promise<void> {
    await expect(this.pill).toHaveText(label);
    await expect(this.pill.locator(`[data-icon="${icon}"]`)).toHaveCount(1);
  }

  async expectNoBanner(): Promise<void> {
    await expect(this.banner).toHaveCount(0);
  }

  /** Types the connection fields and presses the toolbar Connect. The backend event is not sent. */
  async pressConnect(opts: ConnectOptions = {}): Promise<void> {
    const { host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs, autoStart = false, rtu } = opts;
    if (rtu !== undefined) {
      await this.modeRtu.click();
      await this.field("Serial port").selectOption(rtu);
    } else {
      await this.host.fill(host);
      await this.port.fill(String(port));
    }
    if (timeoutMs !== undefined) await this.timeout.fill(String(timeoutMs));
    if ((await this.autoStart.isChecked()) !== autoStart) await this.autoStart.setChecked(autoStart);
    const before = await this.callCount("connect");
    await this.toolbarButton("Connect").click();
    await this.expectCalls("connect", before + 1);
  }

  /**
   * Drives the session from idle to `state` through valid transitions. The Connect press is real
   * (so the banner and the dialogs describe the typed connection); the backend events are emitted.
   */
  async toState(
    state: SessionState,
    opts: ConnectOptions & {
      extra?: Record<string, unknown>;
      reason?: Reason;
    } = {},
  ): Promise<void> {
    if (state === "idle") return;
    await this.pressConnect(opts);
    await this.emitState("connecting");
    if (state === "connecting") return;
    if (state === "disconnected") {
      await this.emitState("disconnected", {
        reason: opts.reason ?? { kind: "closedByPeer", phase: "linkLost", message: "closed" },
        ...opts.extra,
      });
      return;
    }
    await this.emitState("connected");
    if (state === "connected") return;
    await this.emitState("polling");
    if (state === "polling") return;
    if (state === "paused") {
      await this.emitState("paused");
      return;
    }
    await this.emitState(state, opts.extra ?? {});
  }

  /** Same as `toState`, but ends after a first valid data update (values [1234, 65535, 32768, 0, 32767, 0 ...]). */
  async toLive(values = REGISTER_MAP_10): Promise<void> {
    await this.toState("polling");
    await this.pollUpdate(values);
    await expect(this.chip).toContainText("Updated");
  }

  /** Presses the toolbar button `name` (Start polling / Resume / Pause) and answers it with `next`. */
  async pressAndAnswer(name: string, next: SessionState): Promise<void> {
    const before = await this.callCount(name === "Pause" ? "stopPoll" : "startPoll");
    await this.toolbarButton(name).click();
    await this.expectCalls(name === "Pause" ? "stopPoll" : "startPoll", before + 1);
    await this.emitState(next);
  }

  async seedProfiles(profiles: unknown[]): Promise<void> {
    await this.script((f, list) => f.seedProfiles(list), profiles);
  }

  async clipboardText(): Promise<string> {
    // The OS clipboard turns LF into CRLF on Windows.
    const text = await this.page.evaluate(() => navigator.clipboard.readText());
    return text.replace(/\r\n/g, "\n");
  }

  async setClipboard(text: string): Promise<void> {
    await this.page.evaluate((t) => navigator.clipboard.writeText(t), text);
  }
}

/** The reference holding-register map of CHK-001 (HR0-9). */
export const REGISTER_MAP_10 = [1234, 65535, 32768, 0, 32767, 0, 0, 0, 0, 0];

export function txFrame(seq: number, at: number, bytes: number[], extra: Partial<Frame> = {}): Frame {
  return { seq, at, direction: "tx", bytes, ...extra };
}
export function rxFrame(seq: number, at: number, bytes: number[], extra: Partial<Frame> = {}): Frame {
  return { seq, at, direction: "rx", bytes, ...extra };
}

/** A TCP profile as the backend stores it. */
export function tcpProfile(
  name: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name,
    connection: { mode: "tcp", host: DEFAULT_HOST, port: DEFAULT_PORT, timeoutMs: 1000 },
    poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
    display: { format: "unsigned", addressBase: 0 },
    autoStartPoll: false,
    ...over,
  };
}
