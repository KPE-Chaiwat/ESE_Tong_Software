import { createStore, type StoreApi } from "zustand/vanilla";
import type { PollId } from "@/shared/ipc/modbus-master.types";

export interface PollSelectionStore {
  selectedIds: Set<PollId>;
  frozen: boolean;
  setFrozen(frozen: boolean): void;
  anchorId: PollId | null;
  toggle(id: PollId): void;
  addRange(id: PollId, order: readonly PollId[], fallbackAnchor?: PollId): void;
  selectAll(order: readonly PollId[]): void;
  clear(): void;
  reconcile(ids: readonly PollId[]): void;
  resetForProfile(): void;
}
export type PollSelectionStoreApi = StoreApi<PollSelectionStore>;

/** Transient bulk membership, independent of the active view and saved profile. */
export function createPollSelectionStore(): PollSelectionStoreApi {
  return createStore<PollSelectionStore>()((set, get) => {
    const clear = () => set({ selectedIds: new Set(), anchorId: null });
    return {
      selectedIds: new Set(),
      frozen: false,
      setFrozen: (frozen) => set({ frozen }),
      anchorId: null,
      toggle(id) {
        if (get().frozen) return;
        const selectedIds = new Set(get().selectedIds);
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        set({ selectedIds, anchorId: id });
      },
      addRange(id, order, fallbackAnchor) {
        if (get().frozen) return;
        const end = order.indexOf(id);
        if (end < 0) return;
        const previous = get().anchorId;
        const anchorId =
          previous !== null && order.includes(previous)
            ? previous
            : fallbackAnchor !== undefined && order.includes(fallbackAnchor)
              ? fallbackAnchor
              : id;
        const start = order.indexOf(anchorId);
        set({
          selectedIds: new Set([
            ...get().selectedIds,
            ...order.slice(Math.min(start, end), Math.max(start, end) + 1),
          ]),
          anchorId,
        });
      },
      selectAll(order) {
        if (get().frozen) return;
        set({ selectedIds: new Set(order) });
      },
      clear: () => {
        if (!get().frozen) clear();
      },
      resetForProfile: clear,
      reconcile(ids) {
        const known = new Set(ids);
        const before = get();
        const selectedIds = new Set([...before.selectedIds].filter((id) => known.has(id)));
        const anchorId =
          before.anchorId !== null && known.has(before.anchorId) ? before.anchorId : null;
        if (selectedIds.size !== before.selectedIds.size || anchorId !== before.anchorId)
          set({ selectedIds, anchorId });
      },
    };
  });
}
