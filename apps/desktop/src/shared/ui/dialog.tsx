import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { cn } from "@/shared/lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Tailwind width class, for example "w-[480px]". */
  widthClass?: string;
  children: ReactNode;
  /** Receives the dialog content element so the caller can move focus to the first field. */
  initialFocus?: string;
  /** Called before Esc closes the dialog. Call `preventDefault()` to keep it open. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}

/**
 * Remembers the element that had the focus when the modal opened and gives it back on close
 * (DES-001 7). These dialogs are driven by a store, so Radix has no Trigger to return to and would
 * leave the focus on the body. The element is read while rendering, before Radix moves the focus
 * into the dialog. Pass the result to `onCloseAutoFocus`.
 */
function useReturnFocus(open: boolean) {
  const invoker = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    const active = document.activeElement;
    invoker.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpen.current = open;
  return (event: Event) => {
    const element = invoker.current;
    if (element?.isConnected) {
      event.preventDefault();
      element.focus();
    }
  };
}

const OVERLAY = "fixed inset-0 z-40 bg-dark/40";
const CONTENT =
  "fixed left-1/2 top-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-foreground shadow-lg outline-none";

/**
 * Modal dialog. Focus is trapped, returns to the invoking control on close, and starts on the
 * element matching `initialFocus` (a CSS selector, usually the first field).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  widthClass = "w-[480px]",
  initialFocus,
  onEscapeKeyDown,
  children,
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY} />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}
          onCloseAutoFocus={returnFocus}
          className={cn(CONTENT, widthClass)}
          onOpenAutoFocus={(event) => {
            const target = initialFocus
              ? (contentRef.current?.querySelector<HTMLElement>(initialFocus) ?? null)
              : null;
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className="inline-flex size-7 items-center justify-center rounded-pill outline-none hover:bg-neutral-tint focus-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface AlertDialogProps {
  open: boolean;
  /** Called for Esc and outside clicks: the answer is "cancel". */
  onCancel: () => void;
  title: string;
  description: string;
  children: ReactNode;
  /** Selector of the safe button that gets the initial focus. */
  initialFocus: string;
}

/** Small confirm dialog. Initial focus goes to the safe button (DES-001 S5). */
export function AlertDialog({
  open,
  onCancel,
  title,
  description,
  children,
  initialFocus,
}: AlertDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus(open);
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={cn(OVERLAY, "z-[60]")} />
        <AlertDialogPrimitive.Content
          ref={contentRef}
          onCloseAutoFocus={returnFocus}
          className={cn(CONTENT, "z-[70] w-[420px]")}
          onOpenAutoFocus={(event) => {
            const target = contentRef.current?.querySelector<HTMLElement>(initialFocus) ?? null;
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <AlertDialogPrimitive.Title className="text-lg font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-2 text-sm">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="mt-4 flex justify-end gap-2">{children}</div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
