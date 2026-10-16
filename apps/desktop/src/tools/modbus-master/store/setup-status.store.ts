import { createStore, type StoreApi } from "zustand/vanilla";

/** What the setup form tells the rest of the window about its validity. */
export interface SetupStatusData {
  /** Fields currently showing an error: "{n} fields need attention". */
  attentionCount: number;
  /** The poll draft is invalid right now (live, whether or not errors are shown). */
  pollInvalid: boolean;
  connectionInvalid: boolean;
}

export interface SetupStatusActions {
  update(patch: Partial<SetupStatusData>): void;
  reset(): void;
}

export type SetupStatusStore = SetupStatusData & SetupStatusActions;
export type SetupStatusStoreApi = StoreApi<SetupStatusStore>;

const initial: SetupStatusData = {
  attentionCount: 0,
  pollInvalid: false,
  connectionInvalid: false,
};

export function createSetupStatusStore(): SetupStatusStoreApi {
  return createStore<SetupStatusStore>()((set) => ({
    ...initial,
    update: (patch) => set(patch),
    reset: () => set(initial),
  }));
}

/** "1 field needs attention" / "{n} fields need attention", or null when there is nothing to show. */
export function attentionText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 field needs attention" : `${count} fields need attention`;
}
