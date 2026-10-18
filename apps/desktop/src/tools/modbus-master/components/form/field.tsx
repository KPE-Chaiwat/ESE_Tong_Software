import type { ReactNode } from "react";
import { FieldMessage } from "@/shared/ui/field-message";
import { Label } from "@/shared/ui/input";

interface FieldProps {
  id: string;
  label: string;
  /** Error text, shown with `aria-invalid` on the control (the caller sets it). */
  error?: string | undefined;
  warning?: string | undefined;
  /** 12px muted helper, for example "Protocol address 0". */
  helper?: string | undefined;
  children: ReactNode;
  className?: string;
}

/** Ids of the elements a control points to with `aria-describedby`. */
export function describedBy(
  id: string,
  parts: { error?: unknown; warning?: unknown; helper?: unknown },
) {
  const ids = [
    parts.error ? `${id}-error` : null,
    parts.warning ? `${id}-warning` : null,
    parts.helper ? `${id}-helper` : null,
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** Label, control, helper and error/warning message of one form field. */
export function Field({ id, label, error, warning, helper, children, className }: FieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1">{children}</div>
      {helper ? (
        <p id={`${id}-helper`} className="mt-1 text-xs text-text-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <FieldMessage kind="error" id={`${id}-error`} className="mt-1">
          {error}
        </FieldMessage>
      ) : null}
      {warning ? (
        <FieldMessage kind="warning" id={`${id}-warning`} className="mt-1">
          {warning}
        </FieldMessage>
      ) : null}
    </div>
  );
}
