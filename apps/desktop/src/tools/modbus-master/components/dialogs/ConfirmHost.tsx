import { Button } from "@/shared/ui/button";
import { AlertDialog } from "@/shared/ui/dialog";
import { useConfirm, useModalLock, useRuntime } from "../context";

/** Renders the dialog the confirm store asks for (DES-001 S5). Initial focus is the safe button. */
export function ConfirmHost() {
  const confirm = useRuntime().stores.confirm;
  const spec = useConfirm((s) => s.current);
  useModalLock(spec !== null);

  if (!spec) return null;
  return (
    <AlertDialog
      open
      title={spec.title}
      description={spec.body}
      initialFocus='[data-default="true"]'
      onCancel={() => confirm.getState().resolve(spec.cancelId)}
    >
      {spec.buttons.map((button) => (
        <Button
          key={button.id}
          type="button"
          variant={button.variant ?? "default"}
          data-default={button.id === spec.defaultId ? "true" : undefined}
          onClick={() => confirm.getState().resolve(button.id)}
        >
          {button.label}
        </Button>
      ))}
    </AlertDialog>
  );
}
