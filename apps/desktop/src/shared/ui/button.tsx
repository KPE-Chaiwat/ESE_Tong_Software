import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-semibold transition-colors outline-none focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Accent on a light surface needs the 1px border (DES-001 6.2).
        default: "border border-border bg-primary text-primary-foreground hover:bg-primary/85",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        outline: "border border-input bg-card text-foreground hover:bg-neutral-tint",
        ghost: "text-foreground hover:bg-neutral-tint",
        // DES-001 6.3: destructive confirm = outline with an error border; never text on a solid error fill.
        destructive: "border-[1.5px] border-error bg-card text-foreground hover:bg-error-tint",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-4",
        lg: "h-12 px-7 text-base",
        icon: "size-10",
        // 32 x 32 icon-only button (a narrow toolbar, DES-002 2.6): same shape and tones as `sm`.
        "icon-sm": "size-8 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
