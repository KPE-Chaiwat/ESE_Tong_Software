import type * as React from "react";
import { cn } from "@/shared/lib/utils";

/** Background of a strip (DES-002 2.3.2): plain surface, warning, error tint or neutral tint. */
export type StripTone = "none" | "warning" | "error" | "neutral";

const TONES: Record<StripTone, string> = {
  none: "bg-card text-foreground",
  // The orange fill with dark text (5.2:1). Warning only, never decoration.
  warning: "bg-warning text-dark",
  // Tinted background; the text stays dark (never text on a solid error fill).
  error: "bg-error-tint text-foreground",
  neutral: "bg-neutral-tint text-foreground",
};

interface StatusStripProps extends React.ComponentProps<"div"> {
  tone: StripTone;
}

/** A one-line strip whose background carries the tone of what it says. Text is always dark. */
export function StatusStrip({ tone, className, ...props }: StatusStripProps) {
  return (
    <div
      data-slot="status-strip"
      data-tone={tone}
      className={cn("flex items-center gap-2 border-b", TONES[tone], className)}
      {...props}
    />
  );
}
