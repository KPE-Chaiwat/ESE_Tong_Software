// Window-level IPC: title, close interception and opening another tool window.
// Only `shared/ipc` may import `@tauri-apps/api`.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppInfo } from "@/shared/bindings";
import { toIpcError, type Unsubscribe } from "./errors";
import type { MonitorInfo } from "./modbus-master.types";

export type CloseDecision = "close" | "cancel";

export interface WindowIpc {
  setTitle(title: string): Promise<void>;
  /** Runs `handler` when the user asks to close this window; "cancel" keeps the window open. */
  onCloseRequested(handler: () => Promise<CloseDecision> | CloseDecision): Promise<Unsubscribe>;
  /** `window_open_tool`: opens a new window of the tool, in the idle state with defaults. */
  openToolWindow(toolId: string): Promise<void>;
  /** `app_info`: name and version of the running app (shown as "ESEfact v0.1.0"). */
  getAppInfo(): Promise<AppInfo>;
  /** `app_list_monitors`: the displays with their work areas in logical px (DES-002 2.8.5). */
  listMonitors(): Promise<MonitorInfo[]>;
  /** Closes this window (File > Close window). Closing W1 also closes its poll windows (Rust). */
  closeWindow(): Promise<void>;
  /**
   * Test hook: the window tells what it announced to assistive technology. Only the fake keeps it
   * (`FakeWindowIpc.announcements`); the Tauri implementation has none.
   */
  recordAnnouncement?(text: string, assertive: boolean): void;
}

/**
 * `window_open_tool`: opens a new window of the tool (label `<toolId>-<n>`). Used by the launcher
 * tiles and by Ctrl+N. It rejects with an `IpcError` (for example `unknownTool`).
 */
export async function openToolWindow(toolId: string): Promise<void> {
  try {
    await invoke<string>("window_open_tool", { toolId });
  } catch (e) {
    throw toIpcError(e);
  }
}

export function createTauriWindowIpc(): WindowIpc {
  return {
    // async: outside a Tauri window `getCurrentWindow()` throws, which must become a rejection.
    setTitle: async (title) => getCurrentWindow().setTitle(title),
    async onCloseRequested(handler) {
      return getCurrentWindow().onCloseRequested(async (event) => {
        if ((await handler()) === "cancel") event.preventDefault();
      });
    },
    openToolWindow,
    getAppInfo: async () => invoke<AppInfo>("app_info"),
    // `destroy` is the call the capability grants (there is no close-request handler to bypass).
    closeWindow: async () => getCurrentWindow().destroy(),
    async listMonitors() {
      try {
        return await invoke<MonitorInfo[]>("app_list_monitors");
      } catch (e) {
        throw toIpcError(e);
      }
    },
  };
}

export interface FakeWindowIpc extends WindowIpc {
  readonly titles: string[];
  readonly openedTools: string[];
  closed: boolean;
  /** When set, `openToolWindow` rejects with this message (for example "Unknown tool"). */
  openError: string | null;
  /** What `getAppInfo` resolves to. */
  appInfo: AppInfo;
  /** When set, `getAppInfo` rejects with this message. */
  appInfoError: string | null;
  /** What `listMonitors` resolves to: one 1920 x 1080 display (work area 1920 x 1032) by default. */
  monitors: MonitorInfo[];
  /** When set, `listMonitors` rejects with this message. */
  monitorsError: string | null;
  /** Simulates the user closing the window. Resolves to true when the window actually closed. */
  requestClose(): Promise<boolean>;
  /** Everything the window announced, oldest first (at most 500; REPORT-003 section 5, item 7). */
  readonly announcements: Array<{ text: string; assertive: boolean }>;
}

/**
 * Makes two fakes share ONE monitor list: assigning `monitors` on either (or mutating it) changes
 * what both report. The app reads monitors from the window IPC and from the Modbus facade; a test
 * that scripts a second display must change both (REPORT-003 section 5, item 3).
 */
export function linkMonitors(a: { monitors: MonitorInfo[] }, b: { monitors: MonitorInfo[] }): void {
  let shared = a.monitors;
  for (const target of [a, b]) {
    Object.defineProperty(target, "monitors", {
      configurable: true,
      enumerable: true,
      get: () => shared,
      set: (next: MonitorInfo[]) => {
        shared = next;
      },
    });
  }
}

export function createFakeWindowIpc(): FakeWindowIpc {
  let handler: (() => Promise<CloseDecision> | CloseDecision) | null = null;
  const fake: FakeWindowIpc = {
    titles: [],
    openedTools: [],
    closed: false,
    openError: null,
    appInfo: { name: "ESEfact", version: "0.0.0-fake" },
    appInfoError: null,
    monitors: [
      {
        // Like Rust: the id is the OS monitor name.
        id: "\\\\.\\DISPLAY1",
        label: "Display 1",
        name: "\\\\.\\DISPLAY1",
        primary: true,
        workArea: { x: 0, y: 0, width: 1920, height: 1032 },
        scaleFactor: 1,
      },
    ],
    monitorsError: null,
    announcements: [],
    recordAnnouncement(text, assertive) {
      fake.announcements.push({ text, assertive });
      if (fake.announcements.length > 500) fake.announcements.shift();
    },
    async setTitle(title) {
      fake.titles.push(title);
    },
    async onCloseRequested(h) {
      handler = h;
      return () => {
        if (handler === h) handler = null;
      };
    },
    async openToolWindow(toolId) {
      if (fake.openError) throw new Error(fake.openError);
      fake.openedTools.push(toolId);
    },
    async getAppInfo() {
      if (fake.appInfoError) throw new Error(fake.appInfoError);
      return fake.appInfo;
    },
    async listMonitors() {
      if (fake.monitorsError) throw new Error(fake.monitorsError);
      return fake.monitors.map((m) => ({ ...m, workArea: { ...m.workArea } }));
    },
    async closeWindow() {
      fake.closed = true;
    },
    async requestClose() {
      const decision = handler ? await handler() : "close";
      if (decision === "close") fake.closed = true;
      return decision === "close";
    },
  };
  return fake;
}

/** True inside a Tauri window. In a plain browser the IPC does not exist. */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
