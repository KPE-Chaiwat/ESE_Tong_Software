import { isTauriRuntime, openToolWindow } from "@/shared/ipc/window";
import type { ToolManifest } from "@/shared/lib/tool-manifest";

/**
 * Opens a tool in its own window through `window_open_tool` (DES-001 5.4). The launcher window
 * stays the launcher, so it is the way back and the next tool can be started from it.
 * In a plain browser (`pnpm dev:web`) there are no windows, so the tool opens in a new tab.
 */
export async function openTool(manifest: ToolManifest): Promise<void> {
  if (isTauriRuntime()) {
    await openToolWindow(manifest.id);
  } else {
    window.open(manifest.route, "_blank");
  }
}
