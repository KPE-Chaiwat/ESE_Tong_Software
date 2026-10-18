// The values of one poll view (DES-001 2.4, FE-002 task 08): empty, loading, live or stale. One
// store per view, so two sub-windows in one connection window never share a table. The store
// ignores updates of another poll, out-of-order updates and updates for an old definition.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { PollDefinition, PollId, PollUpdate } from "@/shared/ipc/modbus-master.types";
import { kindOf, matchesDefinition, type PollDataStatus, type PollKind } from "./poll-data.logic";

export type ClearReason = "settingsChanged";

export interface PollDataState {
  status: PollDataStatus;
  /** The definition the values belong to. */
  definition: PollDefinition | null;
  kind: PollKind;
  /** Raw u16, or 0/1 for bits. Length = quantity. */
  values: number[] | null;
  /** Last applied `PollUpdate.seq`. */
  seq: number;
  lastOkAt: number | null;
  roundTripMs: number | null;
  /** Why the view is empty, when it is not simply "nothing yet". */
  clearedBecause: ClearReason | null;
}

export interface PollDataActions {
  /** A poll starts for `def`: the view is loading and the old values are dropped. */
  begin(def: PollDefinition): void;
  /**
   * The attach snapshot carries the last good values, so a view that was just moved shows them at
   * once (live), without passing through loading.
   */
  seed(def: PollDefinition, update: PollUpdate): void;
  /** Ignores updates of another poll, with `seq <=` the current one, or for another definition. */
  applyUpdate(u: PollUpdate): void;
  /** Keeps the values but shows them as stale. Only when there are values. */
  markStale(): void;
  clear(reason?: ClearReason): void;
}

export type PollDataStore = PollDataState & PollDataActions;
export type PollDataStoreApi = StoreApi<PollDataStore>;

const emptyData: PollDataState = {
  status: "none",
  definition: null,
  kind: "registers",
  values: null,
  seq: 0,
  lastOkAt: null,
  roundTripMs: null,
  clearedBecause: null,
};

export function createPollDataStore(deps: { pollId: PollId }): PollDataStoreApi {
  return createStore<PollDataStore>()((set, get) => ({
    ...emptyData,

    begin(def) {
      set({ ...emptyData, status: "loading", definition: def, kind: kindOf(def.function) });
    },

    seed(def, update) {
      if (update.pollId !== deps.pollId || !matchesDefinition(def, update)) return;
      set({
        status: "live",
        definition: def,
        kind: kindOf(def.function),
        values: update.values,
        seq: update.seq,
        lastOkAt: update.at,
        roundTripMs: update.roundTripMs,
        clearedBecause: null,
      });
    },

    applyUpdate(u) {
      const { definition, seq } = get();
      if (u.pollId !== deps.pollId) return;
      if (!definition || u.seq <= seq || !matchesDefinition(definition, u)) return;
      set({
        status: "live",
        values: u.values,
        seq: u.seq,
        lastOkAt: u.at,
        roundTripMs: u.roundTripMs,
        clearedBecause: null,
      });
    },

    markStale() {
      if (get().values !== null && get().status !== "stale") set({ status: "stale" });
    },

    clear(reason) {
      set({ ...emptyData, clearedBecause: reason ?? null });
    },
  }));
}

export const selectPollDataStatus = (s: PollDataStore) => s.status;
export const selectPollValues = (s: PollDataStore) => s.values;
export const selectPollDataDefinition = (s: PollDataStore) => s.definition;
export const selectPollDataKind = (s: PollDataStore) => s.kind;
export const selectPollDataLastOkAt = (s: PollDataStore) => s.lastOkAt;
export const selectPollDataClearedBecause = (s: PollDataStore) => s.clearedBecause;
/** One row subscribes to its own value: an update that changes other rows leaves it alone. */
export const selectValueAt = (index: number) => (s: PollDataStore) => s.values?.[index];
