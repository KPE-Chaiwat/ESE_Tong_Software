import { useStore } from "zustand";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import { Icon } from "./icon";

/** Bottom-right toasts in a polite live region (DES-001 5.2). */
export function Toaster({ store }: { store: ToastStoreApi }) {
  const items = useStore(store, (s) => s.items);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-8 right-4 z-[80] flex flex-col items-end gap-2"
    >
      {items.map((toast) => (
        <div
          key={toast.id}
          data-tone={toast.tone}
          className="flex items-center gap-2 rounded-lg border border-light/20 bg-dark px-3 py-2 text-sm text-light shadow-lg"
        >
          {toast.tone === "error" ? <Icon name="circle-x" tone="error" /> : null}
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
