import { createTauriModbusMasterIpc, type ModbusMasterIpc } from "./modbus-master";
import { createFakeModbusMasterIpc, type FakeModbusMasterIpc } from "./modbus-master.fake";
import {
  createFakeWindowIpc,
  createTauriWindowIpc,
  type FakeWindowIpc,
  linkMonitors,
  type WindowIpc,
} from "./window";

export interface IpcRuntime {
  /** The multi-poll facade (DES-002 section 8). */
  modbus: ModbusMasterIpc;
  window: WindowIpc;
}

declare global {
  interface Window {
    /** Dev mode only (VITE_FAKE_IPC): lets Playwright and the console script the fake backend. */
    __ESEFACT_FAKE_IPC__?: FakeModbusMasterIpc;
    /** Dev mode only: the fake window (close request, `openedTools`, `titles`). */
    __ESEFACT_FAKE_WINDOW_IPC__?: FakeWindowIpc;
  }
}

/**
 * The real Tauri facade, unless the dev server runs with `VITE_FAKE_IPC`:
 * - `1`: the simulating fake (for example `pnpm dev:web` without a Tauri window);
 * - `manual`: the fake without simulation. Nothing happens until a test emits events, or calls
 *   `__ESEFACT_FAKE_IPC__.setSimulate(true)`.
 * Any other value, or none, gives the real backend, and no test hook is installed.
 */
export function createIpcRuntime(): IpcRuntime {
  const mode = import.meta.env.VITE_FAKE_IPC;
  if (mode === "1" || mode === "manual") {
    // `?fakePersist` (or VITE_FAKE_IPC_PERSIST=1) keeps the fake's stored model in sessionStorage,
    // so a reload of the page finds its polls and layout again (a restarted app).
    const persist =
      import.meta.env.VITE_FAKE_IPC_PERSIST === "1" ||
      new URLSearchParams(window.location.search).has("fakePersist");
    const modbus = createFakeModbusMasterIpc({
      simulate: mode === "1",
      ...(persist ? { persist: { storage: window.sessionStorage } } : {}),
    });
    const fakeWindow = createFakeWindowIpc();
    // One display list for the window IPC and the Modbus fake.
    linkMonitors(fakeWindow, modbus);
    window.__ESEFACT_FAKE_IPC__ = modbus;
    window.__ESEFACT_FAKE_WINDOW_IPC__ = fakeWindow;
    return { modbus, window: fakeWindow };
  }
  return {
    modbus: createTauriModbusMasterIpc(),
    window: createTauriWindowIpc(),
  };
}
