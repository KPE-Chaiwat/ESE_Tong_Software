import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Icon } from "./icon";

interface FieldMessageProps {
  kind: "error" | "warning";
  /** Referenced by the field's `aria-describedby`. */
  id: string;
  children: ReactNode;
  className?: string;
}

/**
 * Message under a field: icon plus 12px dark text. The error icon is red, the warning icon stays
 * dark because orange is not allowed as an icon on a light surface (DES-001 6.2).
 */
export function FieldMessage({ kind, id, children, className }: FieldMessageProps) {
  return (
    <p
      id={id}
      data-slot="field-message"
      data-kind={kind}
      className={cn("flex items-start gap-1 text-xs text-foreground", className)}
    >
      <Icon
        name={kind === "error" ? "circle-x" : "triangle-alert"}
        tone={kind === "error" ? "error" : "default"}
        className="mt-px size-3.5"
      />
      <span>{children}</span>
    </p>
  );
}
