import { useRef } from "react";
import { useStore } from "zustand";
import { useTruncationTitle } from "@/shared/lib/use-truncation-title";
import { AppVersion } from "@/shared/ui/app-version";
import { nativeStatusBarText } from "../../store/native-poll.logic";
import { useNativePoll, useNativeRuntime } from "./context";

/**
 * The 28 px status bar of a native poll window (DES-002 2.6): "Last OK … · Round trip … · Resp … ·
 * Timeouts …" and the version. `Tx`, `ID`, `F` and `SR` are in the status line of the poll view.
 */
export function NativeStatusBar() {
  const { view, windowIpc } = useNativeRuntime();
  const counters = useNativePoll((s) => s.counters);
  const lastOkAt = useStore(view.stores.data, (s) => s.lastOkAt);
  const roundTripMs = useStore(view.stores.data, (s) => s.roundTripMs);
  const text = nativeStatusBarText({
    lastOkAt,
    roundTripMs,
    responses: counters.responses,
    timeouts: counters.timeouts,
  });
  const textRef = useRef<HTMLSpanElement>(null);
  useTruncationTitle(textRef, text);
  // One line at every width (REPORT-007 D6): the text takes what is left and ends in an ellipsis
  // with the full text as its tooltip; the version never wraps and goes away below 640 px.
  return (
    <footer
      data-region="status"
      className="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden whitespace-nowrap border-t bg-card px-4 text-[13px]"
    >
      <span
        ref={textRef}
        data-testid="native-status-text"
        className="min-w-0 flex-1 truncate font-mono text-[12.5px]"
      >
        {text}
      </span>
      <AppVersion load={windowIpc.getAppInfo} className="shrink-0 whitespace-nowrap opacity-70" />
    </footer>
  );
}
