// The profile of the connection window (DES-002 2.2.1, 6.1, FE-002 task 23): its name, whether it
// has unsaved changes ("Modified"), and the notice of a profile that was migrated from schema 1.
//
// Rust holds the name (`mm_set_profile_name`). "Modified" is a frontend rule: the content that is
// saved (connection, polls, definitions, display, aliases, scale settings) is serialized into a
// signature, and the profile is modified when it differs from the signature at the last load or
// save. Layout, hosts, list order, Pause and Resume and the traffic filter are not in the
// signature, so they never mark the profile modified (DES-002 6.1).
import { createStore, type StoreApi } from "zustand/vanilla";

export interface ProfileInfoState {
  /** null = Untitled. */
  name: string | null;
  modified: boolean;
  /** The content signature at the last load or save, or at the first snapshot. */
  baseline: string | null;
  /** The migration notice is shown (a schema 1 profile was loaded and not saved yet). */
  migrated: boolean;
}

export interface ProfileInfoActions {
  setName(name: string | null): void;
  /** Forces the flag (tests and the close question); `evaluate` sets it from the content. */
  setModified(modified: boolean): void;
  /** The content changed: modified when it differs from the baseline. No baseline yet: it becomes one. */
  evaluate(signature: string): void;
  /** The current content is the saved one: a load, a save, or the first snapshot. */
  setBaseline(signature: string): void;
  setMigrated(migrated: boolean): void;
}

export type ProfileInfoStore = ProfileInfoState & ProfileInfoActions;
export type ProfileInfoStoreApi = StoreApi<ProfileInfoStore>;

export function createProfileInfoStore(): ProfileInfoStoreApi {
  return createStore<ProfileInfoStore>()((set, get) => ({
    name: null,
    modified: false,
    baseline: null,
    migrated: false,
    setName: (name) => set({ name }),
    setModified: (modified) => set({ modified }),
    evaluate(signature) {
      const { baseline, modified } = get();
      if (baseline === null) {
        set({ baseline: signature });
        return;
      }
      const next = signature !== baseline;
      if (next !== modified) set({ modified: next });
    },
    setBaseline: (signature) => set({ baseline: signature, modified: false }),
    setMigrated: (migrated) => set({ migrated }),
  }));
}

export const selectProfileName = (s: ProfileInfoStore) => s.name;
export const selectProfileModified = (s: ProfileInfoStore) => s.modified;
export const selectProfileMigrated = (s: ProfileInfoStore) => s.migrated;
