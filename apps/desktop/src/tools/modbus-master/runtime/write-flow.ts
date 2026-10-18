// Opens the Write dialog from a poll view (DES-001 S2, DES-002 3.3). Shared by the connection
// window (a sub-window's grid, `Ctrl+E`, its menu) and a native poll window (its grid, toolbar and
// `Ctrl+E`): both pass the view runtime of the poll and get the same prefill and the same refusals.
import type { PollId } from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import { isWritableRead } from "../lib/functions";
import type { ConnectionStoreApi } from "../store/connection.store";
import { READ_ONLY_TOAST, type WritePrefill } from "../store/write.logic";
import type { WriteStoreApi } from "../store/write.store";
import type { PollViewRuntime } from "./poll-view-runtime";

export interface WriteFlowDeps {
  write: WriteStoreApi;
  connection: ConnectionStoreApi;
  toasts: ToastStoreApi;
  /** The view of a poll, or undefined when it has none (a closed or never mounted poll). */
  getView: (pollId: PollId) => PollViewRuntime | undefined;
}

/** The link is up: writes need a connected link (DES-001 2.3, Write… is available in L*). */
export function isLinkUp(connection: ConnectionStoreApi): boolean {
  return connection.getState().state === "connected";
}

/**
 * Opens the dialog for `pollId`. `address` is the protocol address of a row (Enter, double click or
 * the row menu: a read-only poll answers with the toast of DES-001 S2); `null` is the toolbar button,
 * the `⋯` menu and `Ctrl+E`, which prefill from the focused row (or the poll start) and also open
 * for FC02 and FC04 (function 06 is the default there).
 */
export function openWriteDialog(deps: WriteFlowDeps, pollId: PollId, address: number | null): void {
  const view = deps.getView(pollId);
  const config = view?.stores.poll.getState().config;
  if (!view || !config) return;
  const def = config.definition;
  if (address !== null && !isWritableRead(def.function)) {
    deps.toasts.getState().show(READ_ONLY_TOAST);
    return;
  }
  if (!isLinkUp(deps.connection)) return;
  const focus = address ?? view.stores.ui.getState().focusAddress;
  const inRange =
    focus !== null && focus >= def.startAddress && focus < def.startAddress + def.quantity;
  const target = inRange ? focus : def.startAddress;
  const raw = inRange ? view.stores.data.getState().values?.[target - def.startAddress] : undefined;
  const prefill: WritePrefill = {
    address: target,
    pollFunction: def.function,
    slaveId: def.slaveId,
    ...(raw === undefined ? {} : { raw }),
  };
  deps.write.getState().openFor(pollId, prefill);
}

/**
 * A link-lost write result stays until the next Send or until the dialog closes; once the link is
 * back (connected) the result area is emptied, [Reconnect] with it (DES-001 2.5). Returns the
 * unsubscribe function.
 */
export function watchWriteLink(connection: ConnectionStoreApi, write: WriteStoreApi): () => void {
  return connection.subscribe((s, prev) => {
    if (s.state === "connected" && prev.state !== "connected") {
      if (write.getState().result?.status === "linkLost") write.getState().clearResult();
    }
  });
}
