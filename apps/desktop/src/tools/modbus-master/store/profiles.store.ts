import { createStore, type StoreApi } from "zustand/vanilla";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import { toIpcError } from "@/shared/ipc/modbus-master";
import type { Profile, ProfileSummary } from "@/shared/ipc/modbus-master.types";
import { profileNameSchema, validate } from "../validation/schemas";

export type ProfilesStatus = "idle" | "loading" | "ready" | "error";

export interface ProfilesData {
  status: ProfilesStatus;
  items: ProfileSummary[];
  error: string | null;
  filter: string;
}

export type OpResult = { ok: true } | { ok: false; message: string; code: string };

export interface ProfilesActions {
  /** Re-fetches the list. S3 calls it every time it opens. */
  refresh(): Promise<void>;
  /** Save as. `overwrite` is true after the Replace confirm. */
  save(profile: Profile, overwrite: boolean): Promise<OpResult>;
  /** Rejects with an `IpcError` when the profile cannot be read. */
  load(name: string): Promise<Profile>;
  /** Validates the new name (unique, case-insensitive) before calling the backend. */
  rename(oldName: string, newName: string): Promise<OpResult>;
  remove(name: string): Promise<OpResult>;
  setFilter(text: string): void;
  /** True when a profile with this name exists (case-insensitive). */
  exists(name: string): boolean;
}

export type ProfilesStore = ProfilesData & ProfilesActions;
export type ProfilesStoreApi = StoreApi<ProfilesStore>;

/** Items matching the filter, case-insensitive on the name. */
export function visibleProfiles(
  items: readonly ProfileSummary[],
  filter: string,
): ProfileSummary[] {
  const needle = filter.trim().toLowerCase();
  return needle === "" ? [...items] : items.filter((p) => p.name.toLowerCase().includes(needle));
}

export function createProfilesStore(deps: { ipc: ModbusMasterIpc }): ProfilesStoreApi {
  let latest = 0;

  return createStore<ProfilesStore>()((set, get) => {
    async function op(run: () => Promise<void>): Promise<OpResult> {
      try {
        await run();
      } catch (e) {
        const err = toIpcError(e);
        return { ok: false, message: err.message, code: err.code };
      }
      await get().refresh();
      return { ok: true };
    }

    return {
      status: "idle",
      items: [],
      error: null,
      filter: "",

      async refresh() {
        latest += 1;
        const mine = latest;
        set({ status: "loading", error: null });
        try {
          const items = await deps.ipc.profilesList();
          if (mine !== latest) return;
          set({ status: "ready", items, error: null });
        } catch (e) {
          if (mine !== latest) return;
          set({ status: "error", error: toIpcError(e).message });
        }
      },

      save: (profile, overwrite) => op(() => deps.ipc.profilesSave(profile, overwrite)),

      load: (name) => deps.ipc.profilesGet(name),

      async rename(oldName, newName) {
        const others = get()
          .items.map((p) => p.name)
          .filter((n) => n.toLowerCase() !== oldName.toLowerCase());
        const checked = validate(profileNameSchema(others), newName);
        if (!checked.ok) {
          return {
            ok: false,
            message: checked.errors.name ?? "Invalid name.",
            code: "invalidProfileName",
          };
        }
        return op(() => deps.ipc.profilesRename(oldName, newName));
      },

      remove: (name) => op(() => deps.ipc.profilesDelete(name)),

      setFilter: (filter) => set({ filter }),

      exists: (name) => get().items.some((p) => p.name.toLowerCase() === name.trim().toLowerCase()),
    };
  });
}

export const selectProfilesStatus = (s: ProfilesStore) => s.status;
export const selectProfilesError = (s: ProfilesStore) => s.error;
export const selectProfileItems = (s: ProfilesStore) => s.items;
export const selectProfileFilter = (s: ProfilesStore) => s.filter;
