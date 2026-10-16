import { formatTime } from "../../lib/format";
import { isLinkUp } from "../../store/session.logic";
import { useConfig, usePollData, useSession } from "../context";

const PARITY_LETTER = { none: "N", even: "E", odd: "O" } as const;

/** Dark 24px bar: connection summary, last good response and round trip. Not focusable. */
export function StatusBar() {
  const state = useSession((s) => s.state);
  const connection = useConfig((s) => s.connection);
  const lastOkAt = usePollData((s) => s.lastOkAt);
  const roundTripMs = usePollData((s) => s.roundTripMs);

  const target =
    connection.mode === "tcp"
      ? `TCP ${connection.host || "—"}:${connection.port}`
      : `RTU ${connection.port || "—"} ${connection.baud} ${connection.dataBits}${PARITY_LETTER[connection.parity]}${connection.stopBits}`;
  const up = isLinkUp(state);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-2 bg-panel px-3 text-xs text-panel-foreground">
      <span className="font-mono">{up || state === "connecting" ? target : "Not connected"}</span>
      <span aria-hidden="true">·</span>
      <span>
        Last OK <span className="font-mono">{lastOkAt === null ? "—" : formatTime(lastOkAt)}</span>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Round trip{" "}
        <span className="font-mono">{roundTripMs === null ? "—" : `${roundTripMs} ms`}</span>
      </span>
    </footer>
  );
}
