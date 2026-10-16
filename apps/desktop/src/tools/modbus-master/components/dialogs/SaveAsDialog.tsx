import { useEffect, useId, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { FieldMessage } from "@/shared/ui/field-message";
import { Input, Label } from "@/shared/ui/input";
import { profileNameSchema, validate } from "../../validation/schemas";
import { useController, useDialogs, useModalLock, useRuntime } from "../context";

/** S4 Save profile as (DES-001): a name, validated like the profile list rename. */
export function SaveAsDialog() {
  const uid = useId();
  const runtime = useRuntime();
  const controller = useController();
  const open = useDialogs((s) => s.saveAsVisible);
  useModalLock(open);

  const [name, setName] = useState("");
  const [shown, setShown] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);

  // Start from the current profile name each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(runtime.stores.config.getState().profileName ?? "");
      setShown(false);
      setBackendError(null);
    }
  }, [open, runtime]);

  const checked = validate(profileNameSchema([]), name);
  const error = shown ? (checked.ok ? null : (checked.errors.name ?? null)) : null;
  const message = error ?? backendError;
  const inputId = `${uid}-name`;

  const submit = async () => {
    setShown(true);
    if (!checked.ok) return;
    const result = await controller.saveProfileAs(checked.value);
    if (!result.ok && result.message) setBackendError(result.message);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) runtime.stores.dialogs.getState().resolveSaveAs(false);
      }}
      title="Save profile as"
      widthClass="w-[400px]"
      initialFocus="[data-autofocus]"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label htmlFor={inputId}>Name</Label>
          <div className="mt-1">
            <Input
              id={inputId}
              data-autofocus=""
              value={name}
              autoComplete="off"
              aria-invalid={message ? true : undefined}
              aria-describedby={message ? `${inputId}-error` : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setBackendError(null);
              }}
              onBlur={() => setShown(true)}
            />
          </div>
          {message ? (
            <FieldMessage kind="error" id={`${inputId}-error`} className="mt-1">
              {message}
            </FieldMessage>
          ) : null}
        </div>
        <p className="text-xs text-text-muted">Saves connection, poll and display settings.</p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => runtime.stores.dialogs.getState().resolveSaveAs(false)}
          >
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  );
}
