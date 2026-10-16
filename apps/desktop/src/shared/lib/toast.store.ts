import { createStore, type StoreApi } from "zustand/vanilla";

export type ToastTone = "default" | "error";

export interface ToastItem {
  id: number;
  text: string;
  /** `error` shows the circle-x icon in the error color next to the dark text (DES-001 3.5). */
  tone: ToastTone;
}

export interface ShowOptions {
  tone?: ToastTone;
  /** Overrides the default duration, for example 4000 ms for the save-blocked toast. */
  durationMs?: number;
}

export interface ToastData {
  items: ToastItem[];
}

export interface ToastActions {
  /** Shows a toast that goes away by itself (2 s by default, DES-001 5.2). */
  show(text: string, options?: ShowOptions): number;
  dismiss(id: number): void;
  clear(): void;
}

export type ToastStore = ToastData & ToastActions;
export type ToastStoreApi = StoreApi<ToastStore>;

export interface ToastDeps {
  durationMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createToastStore(deps: ToastDeps = {}): ToastStoreApi {
  const duration = deps.durationMs ?? 2000;
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const timers = new Map<number, unknown>();
  let nextId = 1;

  return createStore<ToastStore>()((set, get) => ({
    items: [],

    show(text, options = {}) {
      const id = nextId;
      nextId += 1;
      set((s) => ({ items: [...s.items, { id, text, tone: options.tone ?? "default" }] }));
      timers.set(
        id,
        setTimer(() => get().dismiss(id), options.durationMs ?? duration),
      );
      return id;
    },

    dismiss(id) {
      const handle = timers.get(id);
      if (handle !== undefined) clearTimer(handle);
      timers.delete(id);
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    },

    clear() {
      for (const handle of timers.values()) clearTimer(handle);
      timers.clear();
      set({ items: [] });
    },
  }));
}
