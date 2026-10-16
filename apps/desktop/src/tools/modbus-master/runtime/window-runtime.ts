import { createIpcRuntime } from "@/shared/ipc/runtime";
import { createModbusMasterRuntime, type ModbusMasterRuntime } from ".";

let current: ModbusMasterRuntime | null = null;

/**
 * The runtime of this window. Each Tauri window is its own JS context, so there is exactly one
 * runtime per window: the page, React StrictMode and route changes all get the same one.
 */
export function getWindowRuntime(): ModbusMasterRuntime {
  if (current === null) {
    const ipc = createIpcRuntime();
    current = createModbusMasterRuntime(ipc.modbus, ipc.window);
  }
  return current;
}

/** Tests only: forget the runtime so the next page starts from scratch. */
export function resetWindowRuntimeForTests(): void {
  current?.dispose();
  current = null;
}
