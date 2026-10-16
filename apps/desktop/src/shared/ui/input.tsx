import type * as React from "react";
import { cn } from "@/shared/lib/utils";

const FIELD =
  "h-8 w-full rounded-md border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-ring placeholder:text-text-muted read-only:bg-neutral-tint disabled:opacity-50 aria-invalid:border-[1.5px] aria-invalid:border-error";

/** Text input. `mono` uses the data font (numbers, hex, addresses). Invalid fields set aria-invalid. */
function Input({ className, mono, ...props }: React.ComponentProps<"input"> & { mono?: boolean }) {
  return (
    <input
      data-slot="input"
      className={cn(FIELD, mono && "font-mono text-[13px]", className)}
      {...props}
    />
  );
}

function Textarea({
  className,
  mono,
  ...props
}: React.ComponentProps<"textarea"> & { mono?: boolean }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(FIELD, "h-auto min-h-20 py-1.5", mono && "font-mono text-[13px]", className)}
      {...props}
    />
  );
}

/** Native select: keyboard and screen reader behavior come from the platform. */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn(FIELD, "pr-6", className)} {...props} />;
}

function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn("size-4 shrink-0 rounded-sm accent-dark focus-ring", className)}
      {...props}
    />
  );
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is associated by the caller (htmlFor or nesting).
    <label data-slot="label" className={cn("text-xs font-semibold", className)} {...props} />
  );
}

export { Checkbox, Input, Label, Select, Textarea };
