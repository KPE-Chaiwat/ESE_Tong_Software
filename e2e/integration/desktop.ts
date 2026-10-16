// Launches the real ESEfact desktop app (debug build with the frontend embedded) with WebView2
// remote debugging on a free loopback port, and attaches Playwright over CDP.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";
import { REPO } from "./sim";

export const APP_EXE = path.join(REPO, "target", "debug", "esefact-desktop.exe");
const WIN_PS1 = path.join(import.meta.dirname, "win.ps1");

export interface NativeWindow {
  hwnd: number;
  title: string;
  cls: string;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
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
}

export class Desktop {
  readonly log: string[] = [];
  cdpPort = 0;
  dataDir = "";
  userDataDir = "";
  private proc!: ChildProcess;
  private browser!: Browser;
  context!: BrowserContext;
  private ownsDataDir = true;

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
      await new Promise((r) => setTimeout(r, 250));
    }
    if (Date.now() >= deadline) throw new Error(`CDP endpoint did not come up on ${this.cdpPort}: ${lastError}\n${this.log.join("\n")}`);
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.cdpPort}`);
    this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    // Diagnostics for the log attachment: every navigation of every page, with its time after attach.
    const attached = Date.now();
    const watch = (page: Page) => {
      page.on("framenavigated", (f) => {
        if (f === page.mainFrame()) this.log.push(`[qa] +${Date.now() - attached} ms framenavigated ${f.url()}`);
      });
      page.on("domcontentloaded", () => this.log.push(`[qa] +${Date.now() - attached} ms domcontentloaded ${page.url()}`));
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
    return this.context.pages().filter((p) => !p.url().startsWith("devtools:"));
  }

  async pageWhere(pred: (url: string) => boolean, timeoutMs = 20_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.pages().find((p) => pred(p.url()));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`no page matched; urls: ${this.pages().map((p) => p.url()).join(", ")}`);
  }

  /** A page that is not in `known` and whose url matches. */
  async newPage(known: Set<Page>, pred: (url: string) => boolean, timeoutMs = 20_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.pages().find((p) => !known.has(p) && pred(p.url()));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`no new page; urls: ${this.pages().map((p) => p.url()).join(", ")}`);
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
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WIN_PS1, "-ProcId", String(this.pid)],
      { encoding: "utf8", timeout: 20_000 },
    ).trim();
    const all = JSON.parse(out || "[]") as NativeWindow[];
    // Tauri/WRY windows have the class "Window Class"/"TauriWindow...", WebView2 adds helper windows.
    return all.filter((w) => w.visible && w.title !== "" && w.w > 100 && w.h > 100);
  }

  /** Posts WM_CLOSE to a native window: the same event as the user's close button. */
  closeWindow(hwnd: number): void {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WIN_PS1, "-ProcId", String(this.pid), "-Action", "close", "-Hwnd", String(hwnd)],
      { encoding: "utf8", timeout: 20_000 },
    );
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

  /** Moves and resizes a native window (physical pixels). */
  moveWindow(hwnd: number, x: number, y: number, w: number, h: number): void {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WIN_PS1, "-ProcId", String(this.pid), "-Action", "move", "-Hwnd", String(hwnd), "-X", String(x), "-Y", String(y), "-W", String(w), "-H", String(h)],
      { encoding: "utf8", timeout: 20_000 },
    );
  }

  /** Established TCP connections from this app to `remotePort` on loopback (the simulator). */
  establishedTo(remotePort: number): number {
    const script = `(Get-NetTCPConnection -State Established -RemotePort ${remotePort} -OwningProcess ${this.pid} -ErrorAction SilentlyContinue | Measure-Object).Count`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 20_000 }).trim();
    return Number(out || "0");
  }

  async stop(): Promise<void> {
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
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    if (this.ownsDataDir) fs.rmSync(this.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}
