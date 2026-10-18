import { useEffect, useState } from "react";
import { toIpcError } from "@/shared/ipc/errors";
import { StateBanner } from "@/shared/ui/state-banner";
import { ConnectionWindow } from "./components/ConnectionWindow";
import { ConnectionRuntimeProvider } from "./components/context";
import { getWindowRuntime } from "./runtime/window-runtime";

/**
 * Route component of the tool: the connection window W1. Each Tauri window is its own JS context,
 * so this creates exactly one runtime (stores, views and IPC) per window and opens its backend
 * session.
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
    <ConnectionRuntimeProvider runtime={runtime}>
      <div className="flex h-full flex-col">
        {startError ? (
          <StateBanner variant="error" icon="unplug">
            Could not start the Modbus session: {startError}
          </StateBanner>
        ) : null}
        <ConnectionWindow />
      </div>
    </ConnectionRuntimeProvider>
  );
}
