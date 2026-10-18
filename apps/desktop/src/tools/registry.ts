import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { ToolManifest } from "@/shared/lib/tool-manifest";
import { modbusMasterManifest } from "./modbus-master/manifest";

export interface ToolEntry {
  manifest: ToolManifest;
  /** Lazily loaded page; only the router renders it. The launcher reads `manifest` alone. */
  Page: LazyExoticComponent<ComponentType>;
  /** More routes of the tool that are not windows of the launcher (a poll window of Modbus Master). */
  extraRoutes?: ReadonlyArray<{ path: string; Page: LazyExoticComponent<ComponentType> }>;
}

/** The single list of tools. Adding a tool means adding one entry here. */
export const tools: readonly ToolEntry[] = [
  {
    manifest: modbusMasterManifest,
    Page: lazy(() => import("./modbus-master/ModbusMasterPage")),
    // The native poll window W2 (DES-002 2.6): opened by Rust with `?pollId=<id>`.
    extraRoutes: [
      {
        path: "/tools/modbus-master/poll",
        Page: lazy(() => import("./modbus-master/NativePollPage")),
      },
    ],
  },
];
