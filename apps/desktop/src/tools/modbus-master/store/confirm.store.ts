import { createStore, type StoreApi } from "zustand/vanilla";

export interface ConfirmButton {
  id: string;
  label: string;
  /** `destructive` is an outline with an error border (DES-001 6.3). */
  variant?: "default" | "outline" | "destructive";
}

export interface ConfirmSpec {
  title: string;
  body: string;
  buttons: ConfirmButton[];
  /** The button with initial focus: always the safe one (DES-001 S5). */
  defaultId: string;
  /** What Esc and closing the dialog answer. */
  cancelId: string;
}

export interface ConfirmData {
  current: ConfirmSpec | null;
  /** Dialogs waiting behind the current one. */
  queued: number;
}

export interface ConfirmActions {
  /** Shows a confirm dialog and resolves with the id of the pressed button. */
  ask(spec: ConfirmSpec): Promise<string>;
  /** Answers the current dialog. */
  resolve(id: string): void;
}

export type ConfirmStore = ConfirmData & ConfirmActions;
export type ConfirmStoreApi = StoreApi<ConfirmStore>;

interface Entry {
  spec: ConfirmSpec;
  answer: (id: string) => void;
}

export function createConfirmStore(): ConfirmStoreApi {
  const queue: Entry[] = [];
  let active: Entry | null = null;

  return createStore<ConfirmStore>()((set) => {
    const show = () => {
      active = queue.shift() ?? null;
      set({ current: active?.spec ?? null, queued: queue.length });
    };

    return {
      current: null,
      queued: 0,

      ask(spec) {
        return new Promise<string>((answer) => {
          queue.push({ spec, answer });
          if (active === null) show();
          else set({ queued: queue.length });
        });
      },

      resolve(id) {
        const entry = active;
        if (!entry) return;
        entry.answer(id);
        show();
      },
    };
  });
}
