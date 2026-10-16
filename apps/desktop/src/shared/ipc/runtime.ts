import { createTauriModbusMasterIpc, type ModbusMasterIpc } from "./modbus-master";
import { createFakeModbusMasterIpc, type FakeModbusMasterIpc } from "./modbus-master.fake";
import {
  createFakeWindowIpc,
  createTauriWindowIpc,
  type FakeWindowIpc,
  type WindowIpc,
} from "./window";

export interface IpcRuntime {
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
    const modbus = createFakeModbusMasterIpc({ simulate: mode === "1" });
    const fakeWindow = createFakeWindowIpc();
    window.__ESEFACT_FAKE_IPC__ = modbus;
    window.__ESEFACT_FAKE_WINDOW_IPC__ = fakeWindow;
    return { modbus, window: fakeWindow };
  }
  return { modbus: createTauriModbusMasterIpc(), window: createTauriWindowIpc() };
}
