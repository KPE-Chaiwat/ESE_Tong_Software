import { useRef } from "react";
import { useTruncationTitle } from "@/shared/lib/use-truncation-title";
import { AppVersion } from "@/shared/ui/app-version";
import { transportSummary } from "../../store/connection.logic";
import { selectNativeCount } from "../../store/poll-list.store";
import { useConnection, usePollList, useRuntime } from "../context";

/** "{k} in their own windows" ("1 in its own window" for one), or null when none. */
export function nativeSuffix(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 in its own window" : `${count} in their own windows`;
}

export function statusBarText(
  transport: string | null,
  pollCount: number,
  natives: number,
): string {
  const parts = [
    transport ?? "Not connected",
    `${pollCount} ${pollCount === 1 ? "poll" : "polls"}`,
  ];
  const suffix = nativeSuffix(natives);
  if (suffix) parts.push(suffix);
  return parts.join(" · ");
}

/** The 28 px status bar (DES-002 2.2.6). Not focusable. */
export function StatusBar() {
  const { windowIpc } = useRuntime();
  const state = useConnection((s) => s.state);
  const connection = useConnection((s) => s.connection);
  const count = usePollList((s) => s.order.length);
  const natives = usePollList(selectNativeCount);
  const known = connection && state !== "idle" ? transportSummary(connection) : null;

  const text = statusBarText(known, count, natives);
  const textRef = useRef<HTMLSpanElement>(null);
  useTruncationTitle(textRef, text);

  // One line at every width (DES-002 2.2.6): the text ends in an ellipsis, the version stays whole.
  return (
    <footer
      data-region="status"
      className="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden whitespace-nowrap border-t bg-card px-4 text-[13px]"
    >
      <span ref={textRef} data-testid="status-text" className="min-w-0 flex-1 truncate">
        {text}
      </span>
      <AppVersion load={windowIpc.getAppInfo} className="opacity-70" />
    </footer>
  );
}
