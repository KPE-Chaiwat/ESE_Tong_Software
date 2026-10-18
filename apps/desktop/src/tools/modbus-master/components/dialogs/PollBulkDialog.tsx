import { Button } from "@/shared/ui/button";
import { AlertDialog } from "@/shared/ui/dialog";
import { usePollBulk, useRuntime } from "../context";

export function PollBulkDialog() {
  const plan = usePollBulk((s) => s.confirmation);
  const bulk = useRuntime().stores.pollBulk;
  if (!plan) return null;
  const count = plan.targets.length;
  const label = `Delete ${count} ${count === 1 ? "poll" : "polls"}`;
  return (
    <AlertDialog
      open
      title={`${label}?`}
      description="Their windows will close and their settings will be removed from this connection. This cannot be undone."
      initialFocus='[data-default="true"]'
      onCancel={() => bulk.getState().cancelDelete()}
      extra={
        <ul className="max-h-60 space-y-2 overflow-y-auto text-sm">
          {plan.targets.map((p) => (
            <li key={p.config.pollId} className="break-words">
              <span className="font-semibold">{p.config.name}</span>
              <span className="ml-2 text-text-muted">
                {!p.open ? "closed" : p.host === "native" ? "own window" : "in workspace"}
              </span>
              {p.hasUnappliedEdits ? <p>Unapplied changes will be lost.</p> : null}
            </li>
          ))}
        </ul>
      }
    >
      <Button
        type="button"
        variant="outline"
        data-default="true"
        onClick={() => bulk.getState().cancelDelete()}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="destructive"
        onClick={() => void bulk.getState().confirmDelete()}
      >
        {label}
      </Button>
    </AlertDialog>
  );
}
