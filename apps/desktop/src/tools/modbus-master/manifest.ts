import { Activity } from "lucide-react";
import type { ToolManifest } from "@/shared/lib/tool-manifest";

export const modbusMasterManifest: ToolManifest = {
  id: "modbus-master",
  displayName: "Modbus Master",
  description: "Poll and write registers on Modbus TCP and RTU devices, and inspect raw traffic.",
  icon: Activity,
  route: "/tools/modbus-master",
  window: { width: 1280, height: 800, minWidth: 960, minHeight: 600 },
};
