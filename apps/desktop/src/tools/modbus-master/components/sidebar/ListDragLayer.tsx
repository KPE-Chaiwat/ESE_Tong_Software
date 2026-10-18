import { isListDrag } from "../../store/drag.store";
import { useDrag, usePollList } from "../context";
import { PollChip } from "../PollChip";

/**
 * The ghost of a dragged poll row (DES-002 2.10.6): a snapshot of the row at 80% opacity that
 * follows the pointer. The original row stays in the list at 40%. It is `aria-hidden`: the result
 * of the drag is announced.
 */
export function ListDragLayer() {
  const active = useDrag((s) => isListDrag(s.kind));
  const pollId = useDrag((s) => s.pollId);
  const pointer = useDrag((s) => s.listPointer);
  const poll = usePollList((s) => (pollId === null ? undefined : s.polls[pollId]));
  if (!active || !pointer || !poll) return null;
  const { status, counters, config } = poll;
  return (
    <div
      aria-hidden="true"
      data-testid="list-drag-ghost"
      style={{ left: pointer.x + 12, top: pointer.y + 8 }}
      className="pointer-events-none fixed z-[100003] flex w-56 flex-col gap-0.5 rounded-[10px] border bg-selected px-3 py-2 opacity-80 shadow-subwindow"
    >
      <span className="truncate text-sm font-semibold">{config.name}</span>
      <PollChip
        state={status.state}
        exceptionCode={status.exceptionCode}
        consecutiveFailures={status.consecutiveFailures}
        hasData={counters.lastOkAt !== null}
      />
    </div>
  );
}
