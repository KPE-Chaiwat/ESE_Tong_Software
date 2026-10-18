import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { StateBanner } from "@/shared/ui/state-banner";
import { NativeRuntimeProvider } from "./components/native/context";
import { NativePollWindow } from "./components/native/NativePollWindow";
import { getNativeRuntime } from "./runtime/native-window-runtime";

/** The poll id of the route `/tools/modbus-master/poll?pollId=<id>`, or null when it is not one. */
export function parsePollId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function NativePollHost({ pollId }: { pollId: number }) {
  const runtime = getNativeRuntime(pollId);
  useEffect(() => {
    void runtime.init();
  }, [runtime]);
  return (
    <NativeRuntimeProvider runtime={runtime}>
      <NativePollWindow />
    </NativeRuntimeProvider>
  );
}

/**
 * Route component of a native poll window W2 (DES-002 2.6). Rust opens the window with the poll id
 * in the query; this attaches that poll's view channel and shows it.
 */
export default function NativePollPage() {
  const [params] = useSearchParams();
  const pollId = parsePollId(params.get("pollId"));
  if (pollId === null) {
    return (
      <StateBanner variant="error" icon="unplug">
        This window needs a poll. Open it from the connection window.
      </StateBanner>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <NativePollHost pollId={pollId} />
    </div>
  );
}
