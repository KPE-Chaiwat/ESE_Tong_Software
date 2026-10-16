import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-pill px-3 py-0.5 text-xs font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-input text-foreground",
        // Status variants: callers must also render an icon or text label (never color-only).
        success: "bg-success text-success-foreground",
        warning: "bg-warning text-warning-foreground",
        // Never text on a solid error fill (DES-001 6.2).
        error: "border-[1.5px] border-error bg-error-tint text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
