// The ONLY module allowed to import from "@tauri-apps/api". Stores and components call the
// typed wrappers exported here, never `invoke` directly.
import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "@/shared/bindings";

/** Basic information about the running application (name, version). */
export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}
