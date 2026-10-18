import { useStore } from "zustand";
import { NO_SCALE } from "../../lib/scaled";
import { usePollHost, usePollList, useRuntime } from "../context";
import {
  ClosePollDialogView,
  CloseWindowDialogView,
  DeletePollDialogView,
} from "./PollDialogViews";
import { WriteDialogView } from "./WriteDialogView";

/** The Write dialog (S2) of the connection window, for the poll of the sub-window it was opened from. */
function WriteDialog() {
  const runtime = useRuntime();
  const { write, layout, connection } = runtime.stores;
  const pollId = useStore(write, (s) => s.pollId);
  const config = usePollList((s) => (pollId === null ? null : (s.polls[pollId]?.config ?? null)));
  if (pollId === null) return null;
  return (
    <WriteDialogView
      write={write}
      layout={layout}
      connection={connection}
      config={config}
      scaled={runtime.views.peek(pollId)?.scaled() ?? NO_SCALE}
      reconnect={() => void runtime.actions.connect()}
    />
  );
}

/**
 * The dialogs of the connection window, driven by its stores: Write (S2), Close poll window? (S6),
 * Delete poll? (S7) and Save changes? before the window closes.
 */
export function PollDialogs() {
  const { host, layout, windowClose } = useRuntime().stores;
  const closing = usePollHost((s) => s.closing);
  const deleting = usePollHost((s) => s.deleting);
  const closingPoll = usePollList((s) => (closing === null ? undefined : s.polls[closing]));
  const deletingPoll = usePollList((s) => (deleting === null ? undefined : s.polls[deleting]));
  return (
    <>
      {closing !== null ? (
        <ClosePollDialogView
          key={closing}
          host={host}
          layout={layout}
          present={closingPoll !== undefined}
        />
      ) : null}
      {deleting !== null ? (
        <DeletePollDialogView
          key={deleting}
          host={host}
          layout={layout}
          name={deletingPoll?.config.name ?? null}
        />
      ) : null}
      <WriteDialog />
      <CloseWindowDialogView store={windowClose} layout={layout} />
    </>
  );
}
