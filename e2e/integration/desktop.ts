// Launches the real ESEfact desktop app (debug build with the frontend embedded) with WebView2
// remote debugging on a free loopback port, and attaches Playwright over CDP (REPORT-006 harness).
//
// Windows: the launcher (W0), connection windows (W1, route /tools/modbus-master) and native poll
// windows (W2, route /tools/modbus-master/poll?pollId=N) are separate top-level windows, each with its
// own webview. Over CDP each webview is one Playwright page. Native window facts (title, rectangle,
// frame, DPI, minimized, foreground) come from `winhelper.exe` (e2e/integration/winhelper.cs), a small
// per-monitor-DPI-aware Win32 tool compiled once with the .NET Framework csc.exe.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";
import { REPO } from "./sim";

/** The binary under test. QA REPORT-007: ESEFACT_APP_EXE selects the normal debug, the dev-hooks debug or the release exe. */
export const APP_EXE = process.env.ESEFACT_APP_EXE ?? path.join(REPO, "target", "debug", "esefact-desktop.exe");
/** The window-state plugin writes here on a graceful exit (outside the data dir). */
export const WINDOW_STATE_FILE = path.join(process.env.APPDATA ?? "", "com.esefact.desktop", ".window-state.json");
const WIN_SRC = path.join(import.meta.dirname, "winhelper.cs");
const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
export const TOOL_DIR = path.join(os.tmpdir(), "esefact-it-tools");
const WIN_EXE = path.join(TOOL_DIR, "winhelper.exe");

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NativeWindow {
  hwnd: number;
  pid: number;
  title: string;
  cls: string;
  visible: boolean;
  iconic: boolean;
  zoomed: boolean;
  foreground: boolean;
  owner: number;
  exStyle: number;
  dpi: number;
  /** GetWindowRect: the outer rectangle in physical px, including the invisible resize border. */
  rect: Rect;
  /** DWM extended frame bounds: the visible rectangle (null when unavailable). */
  frame: Rect | null;
  /** The client area in screen physical px. */
  client: Rect;
}

export interface MonitorInfoPx {
  device: string;
  primary: boolean;
  dpi: number;
  scale: number;
  bounds: Rect;
  work: Rect;
}

/** Compiles the Win32 helper once per machine/source version. */
export function ensureWinHelper(): string {
  const srcTime = fs.statSync(WIN_SRC).mtimeMs;
  if (fs.existsSync(WIN_EXE) && fs.statSync(WIN_EXE).mtimeMs >= srcTime) return WIN_EXE;
  fs.mkdirSync(TOOL_DIR, { recursive: true });
  execFileSync(CSC, ["/nologo", `/out:${WIN_EXE}`, WIN_SRC], { encoding: "utf8", timeout: 60_000 });
  return WIN_EXE;
}

function win(args: string[]): string {
  return execFileSync(ensureWinHelper(), args, { encoding: "utf8", timeout: 20_000 }).trim();
}

export function monitorsPx(): MonitorInfoPx[] {
  return JSON.parse(win(["monitors"])) as MonitorInfoPx[];
}

export function trayRect(): Rect {
  return JSON.parse(win(["tray"])) as Rect;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export interface DesktopOptions {
  /** Reuse a data directory (profiles) from an earlier run, for the restart test. */
  dataDir?: string;
  /** Extra environment for the app. */
  env?: Record<string, string>;
  /** Keep the window-state file of an earlier run (restart tests). Default: it is removed first, so a run starts clean. */
  keepWindowState?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Desktop {
  readonly log: string[] = [];
  readonly layoutLog: string[] = [];
  cdpPort = 0;
  dataDir = "";
  userDataDir = "";
  private proc!: ChildProcess;
  private browser!: Browser;
  context!: BrowserContext;
  private ownsDataDir = true;
  private stopped = false;

  static async start(options: DesktopOptions = {}): Promise<Desktop> {
    const d = new Desktop();
    await d.launch(options);
    return d;
  }

  get pid(): number {
    return this.proc.pid ?? 0;
  }

  get running(): boolean {
    return this.proc.exitCode === null && !this.proc.killed;
  }

  private async launch(options: DesktopOptions): Promise<void> {
    if (!fs.existsSync(APP_EXE)) throw new Error(`desktop app not built: ${APP_EXE}`);
    ensureWinHelper();
    if (!options.keepWindowState) fs.rmSync(WINDOW_STATE_FILE, { force: true });
    this.cdpPort = await freePort();
    this.ownsDataDir = options.dataDir === undefined;
    this.dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "esefact-it-data-"));
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "esefact-it-wv2-"));
    this.proc = spawn(APP_EXE, [], {
      cwd: path.dirname(APP_EXE),
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${this.cdpPort}`,
        WEBVIEW2_USER_DATA_FOLDER: this.userDataDir,
        ESEFACT_DATA_DIR: this.dataDir,
        ...(options.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });
    const sink = (chunk: Buffer) => this.log.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean));
    this.proc.stdout?.on("data", sink);
    this.proc.stderr?.on("data", sink);
    const deadline = Date.now() + 45_000;
    let lastError = "";
    while (Date.now() < deadline) {
      if (!this.running) throw new Error(`app exited early (code ${this.proc.exitCode}):\n${this.log.join("\n")}`);
      try {
        const res = await fetch(`http://127.0.0.1:${this.cdpPort}/json/version`);
        if (res.ok) break;
      } catch (e) {
        lastError = String(e);
      }
      await sleep(250);
    }
    if (Date.now() >= deadline) throw new Error(`CDP endpoint did not come up on ${this.cdpPort}: ${lastError}\n${this.log.join("\n")}`);
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.cdpPort}`);
    this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    const attached = Date.now();
    const watch = (page: Page) => {
      page.on("framenavigated", (f) => {
        if (f === page.mainFrame()) this.log.push(`[qa] +${Date.now() - attached} ms framenavigated ${f.url()}`);
      });
      page.on("crash", () => this.log.push(`[qa] +${Date.now() - attached} ms PAGE CRASH ${page.url()}`));
      page.on("close", () => this.log.push(`[qa] +${Date.now() - attached} ms page closed`));
    };
    for (const page of this.context.pages()) {
      this.log.push(`[qa] +0 ms page present at attach: ${page.url()}`);
      watch(page);
    }
    this.context.on("page", (page) => {
      this.log.push(`[qa] +${Date.now() - attached} ms new page ${page.url()}`);
      watch(page);
    });
  }

  /** The app pages (one per window), without devtools targets. */
  pages(): Page[] {
    return this.context.pages().filter((p) => !p.isClosed() && !p.url().startsWith("devtools:"));
  }

  /** Connection windows (W1). */
  w1Pages(): Page[] {
    return this.pages().filter((p) => /\/tools\/modbus-master(\/)?(\?|#|$)/.test(p.url()));
  }

  /** Native poll windows (W2) and the poll id in their URL. */
  w2Pages(): Array<{ page: Page; pollId: number }> {
    const out: Array<{ page: Page; pollId: number }> = [];
    for (const p of this.pages()) {
      const m = /\/tools\/modbus-master\/poll\?pollId=(\d+)/.exec(p.url());
      if (m) out.push({ page: p, pollId: Number(m[1]) });
    }
    return out;
  }

  async pageWhere(pred: (url: string) => boolean, timeoutMs = 20_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.pages().find((p) => pred(p.url()));
      if (hit) return hit;
      await sleep(100);
    }
    throw new Error(`no page matched; urls: ${this.pages().map((p) => p.url()).join(", ")}`);
  }

  /** A page that is not in `known` and whose url matches. */
  async newPage(known: Set<Page>, pred: (url: string) => boolean, timeoutMs = 20_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.pages().find((p) => !known.has(p) && pred(p.url()));
      if (hit) return hit;
      await sleep(100);
    }
    throw new Error(`no new page; urls: ${this.pages().map((p) => p.url()).join(", ")}`);
  }

  /** The W2 page of a poll (waits for it to appear). */
  async w2Page(pollId: number, timeoutMs = 20_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.w2Pages().find((w) => w.pollId === pollId);
      if (hit) return hit.page;
      await sleep(100);
    }
    throw new Error(`no W2 page for poll ${pollId}; urls: ${this.pages().map((p) => p.url()).join(", ")}`);
  }

  /**
   * The launcher page. WebView2 first reports a blank/initial document and then navigates to the
   * app, which destroys the first execution context: wait for the real document and the heading.
   */
  async launcherPage(): Promise<Page> {
    const page = await this.pageWhere((u) => u !== "" && !u.startsWith("about:") && !u.includes("/tools/"));
    await page.waitForLoadState("load");
    await page.getByRole("heading", { name: "ESEfact" }).waitFor({ timeout: 20_000 });
    return page;
  }

  /** Real top-level windows of the app process (native titles and rectangles). */
  windows(): NativeWindow[] {
    const all = JSON.parse(win(["list", String(this.pid)]) || "[]") as NativeWindow[];
    return all.filter((w) => w.visible && w.title !== "");
  }

  /** Every top-level window of the app process, also untitled helper windows and OS menus (class #32768). */
  allWindows(): NativeWindow[] {
    return JSON.parse(win(["list", String(this.pid)]) || "[]") as NativeWindow[];
  }

  windowTitled(title: string | RegExp): NativeWindow | undefined {
    return this.windows().find((w) => (typeof title === "string" ? w.title === title : title.test(w.title)));
  }

  /** Posts WM_CLOSE to a native window: the same event as the user's close button. */
  closeWindow(hwnd: number): void {
    win(["close", String(hwnd)]);
  }

  /** Moves and resizes a native window (physical pixels, outer rectangle). */
  moveWindow(hwnd: number, x: number, y: number, w: number, h: number): void {
    win(["move", String(hwnd), String(x), String(y), String(w), String(h)]);
  }

  showWindow(hwnd: number, what: "min" | "restore" | "max" | "focus"): void {
    const out = win(["show", String(hwnd), what]);
    if (what === "focus" && out === "refused") throw new Error(`window ${hwnd} could not be brought to the foreground`);
  }

  /** Real hardware-level keyboard input (SendInput) after bringing the window to the foreground. */
  nativeKey(hwnd: number, sequence: string, opts: { keepLayout?: boolean } = {}): void {
    // Make sure the page sees Latin keys: the machine's current input language may be Thai (Ctrl+P arrives as "ย"). The window's
    // input language is switched to US English for the test windows only (see keyboardLayout / setKeyboardLayout).
    if (!process.env.QA_KEEP_LAYOUT && !opts.keepLayout) this.ensureEnglishLayout(hwnd);
    let out = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      out = win(["key", String(hwnd), sequence]);
      if (out === "sent") return;
      execFileSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 400"], { stdio: "ignore" });
    }
    throw new Error(`hardware key "${sequence}" refused: window ${hwnd} could not be brought to the foreground (${out}); input is never sent to another application`);
  }

  /** Switches the focus thread of the window to US English when it is not (poll until the OS reports it). */
  ensureEnglishLayout(hwnd: number): void {
    const want = "04090409";
    const t0 = Date.now();
    let cur = this.keyboardLayout(hwnd);
    while (cur.focus !== want && Date.now() - t0 < 4000) {
      this.setKeyboardLayout(hwnd, want);
      execFileSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 250"], { stdio: "ignore" });
      cur = this.keyboardLayout(hwnd);
    }
    this.layoutLog.push(`layout ${hwnd}: ${cur.focus} after ${Date.now() - t0} ms`);
  }

  /** Real mouse drag with OS-level input (SendInput): moves the cursor, presses, moves in steps, releases. */
  mouseDrag(x1: number, y1: number, x2: number, y2: number, steps = 20, delayMs = 15): void {
    win(["mouse", "drag", String(x1), String(y1), String(x2), String(y2), String(steps), String(delayMs)]);
  }

  /** Presses or releases a modifier (alt, ctrl, shift) with OS-level input and leaves it so. */
  holdKey(name: "alt" | "ctrl" | "shift", state: "down" | "up"): void {
    win(["hold", name, state]);
  }

  /** A real click: move, press, release, all in one helper process (no spawn latency between press and release). */
  mouseClick(x: number, y: number): void {
    const out = win(["mouse", "click", String(x), String(y), String(this.pid)]);
    if (out === "refused") throw new Error(`real click at (${x}, ${y}) refused: the top-level window under the point is not an ESEfact window`);
  }

  mouseDown(): void {
    win(["mouse", "down"]);
  }

  mouseUp(): void {
    win(["mouse", "up"]);
  }

  /** Key chord with OS input WITHOUT touching the foreground window (Alt+Tab and the like). */
  rawKey(sequence: string): void {
    win(["rawkey", sequence]);
  }

  /** Presses or releases any single key (alt, ctrl, shift, tab, ...) with OS input. */
  holdAny(name: string, state: "down" | "up"): void {
    win(["hold", name, state]);
  }

  /** GUI thread state of the thread that owns the window: menu mode, move/size loop (GetGUIThreadInfo). */
  menuMode(hwnd: number): { ok: boolean; inMenuMode: boolean; inMoveSize: boolean; popupMenu: boolean; systemMenu: boolean; hwndFocus: number; hwndActive: number } {
    return JSON.parse(win(["menumode", String(hwnd)]));
  }

  /** Keyboard layouts (hex HKL) of the window's thread and of its focus window's thread. */
  keyboardLayout(hwnd: number): { top: string; focus: string; hwndFocus: number } {
    return JSON.parse(win(["layout", String(hwnd)]));
  }

  /** Asks the window (and its focus window) to switch its input language, e.g. "04090409" for US English. */
  setKeyboardLayout(hwnd: number, hklHex: string): void {
    win(["setlayout", String(hwnd), hklHex]);
  }

  foregroundHwnd(): number {
    return Number(win(["foreground"]));
  }

  mouseMove(x: number, y: number): void {
    win(["mouse", "move", String(x), String(y)]);
  }

  /** PIDs of the app and of the WebView2 processes started with this run's user data folder. */
  processIds(): number[] {
    const script = `$u='${this.userDataDir.replace(/'/g, "''")}'; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${this.pid} -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like ('*' + $u + '*')) } | ForEach-Object { $_.ProcessId }) -join ','`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 30_000 }).trim();
    return out ? out.split(",").map(Number) : [];
  }

  /** Sum of the working sets (bytes) of the app and its WebView2 processes. */
  workingSetBytes(): number {
    const ids = this.processIds();
    if (ids.length === 0) return 0;
    const script = `(Get-Process -Id ${ids.join(",")} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`;
    return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 30_000 }).trim() || "0");
  }

  /** Established TCP connections from this app to `remotePort` on loopback (the simulator). */
  establishedTo(remotePort: number): number {
    const script = `(Get-NetTCPConnection -State Established -RemotePort ${remotePort} -OwningProcess ${this.pid} -ErrorAction SilentlyContinue | Measure-Object).Count`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 20_000 }).trim();
    return Number(out || "0");
  }

  /** The app has ended by itself (closing the last window, a crash). */
  async waitForExit(timeoutMs = 15_000): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.running) return this.proc.exitCode;
      await sleep(100);
    }
    return null;
  }

  /** Closes every window of the app with WM_CLOSE (as the user does) so that the exit is graceful (window state is saved). */
  async closeGracefully(timeoutMs = 20_000): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) {
      const ws = this.windows().filter((w) => w.cls === "Tauri Window");
      // connection windows first, the launcher last
      ws.sort((a, b) => Number(a.title === "ESEfact") - Number(b.title === "ESEfact"));
      const first = ws[0];
      if (first) this.closeWindow(first.hwnd);
      await sleep(600);
    }
    return this.running ? null : this.proc.exitCode;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.browser?.close();
    } catch {
      /* the app may already be gone */
    }
    if (this.proc?.pid && this.running) {
      try {
        execFileSync("taskkill", ["/PID", String(this.proc.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already exited */
      }
    }
    // WebView2 can need a moment to release its user data folder.
    await sleep(500);
    fs.rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
    if (this.ownsDataDir) fs.rmSync(this.dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
}
