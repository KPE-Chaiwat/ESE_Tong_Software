import { createStore, type StoreApi } from "zustand/vanilla";
import type { PollDefinition, PollUpdateEvent } from "@/shared/ipc/modbus-master.types";
import { kindOf, matchesDefinition, type PollDataStatus, type PollKind } from "./poll-data.logic";

export type ClearReason = "settingsChanged";

export interface PollDataData {
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
  /** A poll starts for `def`: the view is loading and old values are dropped. */
  begin(def: PollDefinition): void;
  /** Ignores updates with `seq <=` the current one and updates for another definition. */
  applyUpdate(u: PollUpdateEvent): void;
  /** Keeps the values but shows them as stale. Only when there are values. */
  markStale(): void;
  clear(reason?: ClearReason): void;
}

export type PollDataStore = PollDataData & PollDataActions;
export type PollDataStoreApi = StoreApi<PollDataStore>;

const emptyData: PollDataData = {
  status: "none",
  definition: null,
  kind: "registers",
  values: null,
  seq: 0,
  lastOkAt: null,
  roundTripMs: null,
  clearedBecause: null,
};

export function createPollDataStore(): PollDataStoreApi {
  return createStore<PollDataStore>()((set, get) => ({
    ...emptyData,

    begin(def) {
      set({
        ...emptyData,
        status: "loading",
        definition: def,
        kind: kindOf(def.function),
      });
    },

    applyUpdate(u) {
      const { definition, seq } = get();
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
      if (get().values !== null) set({ status: "stale" });
    },

    clear(reason) {
      set({ ...emptyData, clearedBecause: reason ?? null });
    },
  }));
}

export const selectPollStatus = (s: PollDataStore) => s.status;
export const selectPollValues = (s: PollDataStore) => s.values;
export const selectPollDefinition = (s: PollDataStore) => s.definition;
export const selectPollKind = (s: PollDataStore) => s.kind;
export const selectLastOkAt = (s: PollDataStore) => s.lastOkAt;
