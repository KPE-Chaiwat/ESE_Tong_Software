// Window-level IPC: title, close interception and opening another tool window.
// Only `shared/ipc` may import `@tauri-apps/api`.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toIpcError, type Unsubscribe } from "./modbus-master";

export type CloseDecision = "close" | "cancel";

export interface WindowIpc {
  setTitle(title: string): Promise<void>;
  /** Runs `handler` when the user asks to close this window; "cancel" keeps the window open. */
  onCloseRequested(handler: () => Promise<CloseDecision> | CloseDecision): Promise<Unsubscribe>;
  /** `window_open_tool`: opens a new window of the tool, in the idle state with defaults. */
  openToolWindow(toolId: string): Promise<void>;
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
  };
}

export interface FakeWindowIpc extends WindowIpc {
  readonly titles: string[];
  readonly openedTools: string[];
  closed: boolean;
  /** When set, `openToolWindow` rejects with this message (for example "Unknown tool"). */
  openError: string | null;
  /** Simulates the user closing the window. Resolves to true when the window actually closed. */
  requestClose(): Promise<boolean>;
}

export function createFakeWindowIpc(): FakeWindowIpc {
  let handler: (() => Promise<CloseDecision> | CloseDecision) | null = null;
  const fake: FakeWindowIpc = {
    titles: [],
    openedTools: [],
    closed: false,
    openError: null,
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
