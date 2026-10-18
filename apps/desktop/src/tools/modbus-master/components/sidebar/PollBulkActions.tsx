import { useShallow } from "zustand/react/shallow";
import { Icon } from "@/shared/ui/icon";
import { StatusStrip } from "@/shared/ui/status-strip";
import { bulkLocked } from "../../store/poll-bulk.store";
import { usePollBulk, usePollList, usePollSelection, useRuntime } from "../context";

export function PollBulkActions() {
  const runtime = useRuntime();
  const count = usePollSelection((s) => s.selectedIds.size);
  const phase = usePollBulk((s) => s.phase);
  const locked = usePollBulk(bulkLocked);
  const error = usePollBulk((s) => s.error);
  const warning = usePollBulk((s) => s.warning);
  const retryPlan = usePollBulk((s) => s.retryPlan);
  const recovery = usePollBulk((s) => s.recovery);
  const names = usePollList(
    useShallow(
      (s) =>
        recovery?.issues.map(
          (issue) => s.polls[issue.pollId]?.config.name ?? `Poll ${issue.pollId}`,
        ) ?? [],
    ),
  );
  const bulk = runtime.stores.pollBulk;
  const button =
    "min-h-7 rounded-pill border px-2 text-xs outline-none focus-ring aria-disabled:opacity-50";
  return (
    <>
      <div className="flex flex-wrap gap-1" aria-busy={locked}>
        <button
          type="button"
          data-bulk-action="duplicate"
          className={button}
          aria-disabled={locked || !count || retryPlan !== null || recovery !== null}
          onClick={() => void bulk.getState().duplicateSelected()}
        >
          {phase === "duplicating" ? "Duplicating…" : "Duplicate selected"}
        </button>
        <button
          type="button"
          data-bulk-action="delete"
          className={`${button} border-error text-foreground`}
          aria-disabled={locked || !count || retryPlan !== null || recovery !== null}
          onClick={() => void bulk.getState().requestDeleteSelected()}
        >
          {phase === "deleting" ? "Deleting…" : "Delete selected…"}
        </button>
      </div>
      {error ? (
        <StatusStrip
          tone={warning ? "warning" : "error"}
          role="alert"
          aria-label="Bulk action error"
          className="items-start gap-1 rounded-md p-2 text-xs"
        >
          <Icon name={warning ? "triangle-alert" : "circle-x"} className="size-4 shrink-0" />
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss bulk action error"
            onClick={() => bulk.getState().dismissError()}
          >
            Dismiss
          </button>
        </StatusStrip>
      ) : null}
      {retryPlan ? (
        <div className="text-xs">
          <p>The operation result could not be confirmed.</p>
          <button
            type="button"
            className={button}
            aria-disabled={locked}
            onClick={() => void bulk.getState().retryOperation()}
          >
            Check operation result
          </button>
        </div>
      ) : null}
      {recovery ? (
        <div role="status" className="space-y-1 text-xs">
          <p>Settings were updated. Some poll windows need attention.</p>
          {recovery.issues.map((issue, index) => (
            <div key={`${issue.pollId}-${issue.stage}`} className="break-words">
              <p>
                {names[index]}: {issue.message}
              </p>
              {issue.recovery === "showPoll" ? (
                <button
                  type="button"
                  className={button}
                  aria-disabled={locked}
                  onClick={() => void bulk.getState().recoverHost(issue.pollId)}
                >
                  Show {names[index]}
                </button>
              ) : null}
            </div>
          ))}
          {recovery.issues.some((issue) => issue.recovery === "retryWindowCleanup") ? (
            <button
              type="button"
              className={button}
              aria-disabled={locked}
              onClick={() => void bulk.getState().retryWindowCleanup()}
            >
              Retry window cleanup
            </button>
          ) : null}
          <button
            type="button"
            className={button}
            onClick={() => bulk.getState().dismissRecovery()}
          >
            Dismiss recovery notice
          </button>
        </div>
      ) : null}
    </>
  );
}
