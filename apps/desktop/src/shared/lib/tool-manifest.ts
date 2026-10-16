import type { LucideIcon } from "lucide-react";

/** Initial size of the window a tool opens in. */
export interface ToolWindowSize {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
}

/**
 * Every tool folder under `src/tools/<tool>/` exports one manifest.
 * The launcher only reads manifests; it never imports anything else from a tool.
 */
export interface ToolManifest {
  /** Stable identifier, also used as the window label prefix. */
  id: string;
  displayName: string;
  /** One-line description shown on the launcher card. */
  description: string;
  icon: LucideIcon;
  /** Route the tool is mounted on. */
  route: string;
  window: ToolWindowSize;
}
