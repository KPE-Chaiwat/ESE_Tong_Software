import { createStore, type StoreApi } from "zustand/vanilla";

export interface SelectionData {
  anchor: number | null;
  /** Selected row indexes. Replaced (never mutated) on every change. */
  selected: ReadonlySet<number>;
  focused: number | null;
  rowCount: number;
}

export interface ClickModifiers {
  shift?: boolean;
  ctrl?: boolean;
}

export interface SelectionActions {
  /** The number of rows changed. Drops selected rows that no longer exist. */
  setRowCount(count: number): void;
  click(index: number, mods?: ClickModifiers): void;
  /** Arrow, PageUp and PageDown moves. Clamped to 0 and rowCount - 1. */
  move(delta: number, mods?: { shift?: boolean }): void;
  /** Home and End. */
  moveTo(index: number, mods?: { shift?: boolean }): void;
  selectAll(count?: number): void;
  clear(): void;
  /** Sorted selected row indexes. */
  selectedRows(): number[];
}

export type SelectionStore = SelectionData & SelectionActions;
export type SelectionStoreApi = StoreApi<SelectionStore>;

function range(a: number, b: number): Set<number> {
  const out = new Set<number>();
  for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) out.add(i);
  return out;
}

const sorted = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);

export function createTableSelectionStore(): SelectionStoreApi {
  return createStore<SelectionStore>()((set, get) => ({
    anchor: null,
    selected: new Set<number>(),
    focused: null,
    rowCount: 0,

    setRowCount(count) {
      set((s) => {
        const selected = new Set([...s.selected].filter((i) => i < count));
        const keep = (i: number | null) => (i !== null && i < count ? i : null);
        return {
          rowCount: count,
          selected: selected.size === s.selected.size ? s.selected : selected,
          anchor: keep(s.anchor),
          focused: keep(s.focused),
        };
      });
    },

    click(index, mods = {}) {
      const { anchor, selected, rowCount } = get();
      if (index < 0 || index >= rowCount) return;
      if (mods.shift) {
        const from = anchor ?? index;
        set({ anchor: from, selected: range(from, index), focused: index });
      } else if (mods.ctrl) {
        const next = new Set(selected);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        set({ anchor: index, selected: next, focused: index });
      } else {
        set({ anchor: index, selected: new Set([index]), focused: index });
      }
    },

    move(delta, mods = {}) {
      const { rowCount, focused } = get();
      if (rowCount === 0) return;
      const base = focused ?? (delta > 0 ? -1 : rowCount);
      get().moveTo(Math.min(rowCount - 1, Math.max(0, base + delta)), mods);
    },

    moveTo(index, mods = {}) {
      const { rowCount, anchor, focused } = get();
      if (rowCount === 0) return;
      const target = Math.min(rowCount - 1, Math.max(0, index));
      if (mods.shift) {
        const from = anchor ?? focused ?? target;
        set({ anchor: from, selected: range(from, target), focused: target });
      } else {
        set({ anchor: target, selected: new Set([target]), focused: target });
      }
    },

    selectAll(count) {
      const n = count ?? get().rowCount;
      if (n <= 0) return;
      set({
        rowCount: n,
        anchor: 0,
        selected: range(0, n - 1),
        focused: get().focused ?? 0,
      });
    },

    clear() {
      set({ anchor: null, selected: new Set<number>(), focused: null });
    },

    selectedRows: () => sorted(get().selected),
  }));
}

export const selectFocusedRow = (s: SelectionStore) => s.focused;
export const selectSelectedSet = (s: SelectionStore) => s.selected;
