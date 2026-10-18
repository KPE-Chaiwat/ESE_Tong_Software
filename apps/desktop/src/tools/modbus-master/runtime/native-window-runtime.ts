import { createIpcRuntime } from "@/shared/ipc/runtime";
import { createNativePollRuntime, type NativePollRuntime } from "./native-poll-runtime";

let current: NativePollRuntime | null = null;

/**
 * The runtime of this native poll window. Each Tauri window is its own JS context, so there is
 * exactly one: the page, React StrictMode and route changes all get the same one.
 */
export function getNativeRuntime(pollId: number): NativePollRuntime {
  if (current === null || current.pollId !== pollId) {
    current?.dispose();
    const ipc = createIpcRuntime();
    current = createNativePollRuntime(ipc.modbus, ipc.window, { pollId });
  }
  return current;
}

/** Tests only: forget the runtime so the next page starts from scratch. */
export function resetNativeRuntimeForTests(): void {
  current?.dispose();
  current = null;
}
