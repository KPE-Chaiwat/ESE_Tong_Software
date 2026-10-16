import { useEffect, useState } from "react";
import { toIpcError } from "@/shared/ipc/modbus-master";
import { StateBanner } from "@/shared/ui/state-banner";
import { ModbusMasterProvider } from "./components/context";
import { ModbusMasterWindow } from "./components/ModbusMasterWindow";
import { getWindowRuntime } from "./runtime/window-runtime";

/**
 * Route component of the tool. Each Tauri window is its own JS context, so this creates exactly
 * one runtime (stores + controller + IPC) per window and opens its backend session.
 */
export default function ModbusMasterPage() {
  const runtime = getWindowRuntime();
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    runtime.init().catch((e: unknown) => {
      if (live) setStartError(toIpcError(e).message);
    });
    return () => {
      live = false;
    };
  }, [runtime]);

  return (
    <ModbusMasterProvider runtime={runtime}>
      <div className="flex h-full flex-col">
        {startError ? (
          <StateBanner variant="error" icon="unplug">
            Could not start the Modbus session: {startError}
          </StateBanner>
        ) : null}
        <ModbusMasterWindow />
      </div>
    </ModbusMasterProvider>
  );
}
