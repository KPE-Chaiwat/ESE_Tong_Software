// Whether the sidebar CONNECTION section is expanded (DES-002 2.2.2). Local UI state: the rules live
// in `connection-section.logic.ts`, the connection window feeds the transitions in.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionState, SessionReason } from "@/shared/ipc/modbus-master.types";
import { initialSectionExpanded, sectionAfterTransition } from "./connection-section.logic";

export interface ConnectionSectionState {
  expanded: boolean;
  /** Increments when the form should focus its first field ("Edit connection settings"). */
  focusRequest: number;
}

export interface ConnectionSectionActions {
  /** The state of the snapshot. */
  applySnapshot(state: ConnectionState): void;
  applyTransition(from: ConnectionState, to: ConnectionState, reason: SessionReason | null): void;
  toggle(): void;
  expand(): void;
  /** [Edit] and Connection > Edit connection settings: expand and focus the first field. */
  edit(): void;
}

export type ConnectionSectionStore = ConnectionSectionState & ConnectionSectionActions;
export type ConnectionSectionStoreApi = StoreApi<ConnectionSectionStore>;

export function createConnectionSectionStore(): ConnectionSectionStoreApi {
  return createStore<ConnectionSectionStore>()((set) => ({
    expanded: true,
    focusRequest: 0,
    applySnapshot: (state) => set({ expanded: initialSectionExpanded(state) }),
    applyTransition: (from, to, reason) =>
      set((s) => ({ expanded: sectionAfterTransition(s.expanded, from, to, reason) })),
    toggle: () => set((s) => ({ expanded: !s.expanded })),
    expand: () => set({ expanded: true }),
    edit: () => set((s) => ({ expanded: true, focusRequest: s.focusRequest + 1 })),
  }));
}
