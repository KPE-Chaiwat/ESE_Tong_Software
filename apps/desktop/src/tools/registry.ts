import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { ToolManifest } from "@/shared/lib/tool-manifest";
import { modbusMasterManifest } from "./modbus-master/manifest";

export interface ToolEntry {
  manifest: ToolManifest;
  /** Lazily loaded page; only the router renders it. The launcher reads `manifest` alone. */
  Page: LazyExoticComponent<ComponentType>;
}

/** The single list of tools. Adding a tool means adding one entry here. */
export const tools: readonly ToolEntry[] = [
  {
    manifest: modbusMasterManifest,
    Page: lazy(() => import("./modbus-master/ModbusMasterPage")),
  },
];
