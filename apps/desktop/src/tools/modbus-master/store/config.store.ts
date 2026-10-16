import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  AddressBase,
  ConnectionConfig,
  PollDefinition,
  Profile,
  ValueFormat,
} from "@/shared/ipc/modbus-master.types";
import {
  type ConfigData,
  fromProfile,
  initialConfigData,
  isDirty,
  serializeContent,
  toProfile,
} from "./config.logic";

export interface ConfigActions {
  setConnection(c: ConnectionConfig): void;
  setPoll(p: PollDefinition): void;
  setAutoStart(b: boolean): void;
  setFormat(f: ValueFormat): void;
  /** Flips the display base. Protocol addresses are not touched. */
  toggleBase(): void;
  setBase(b: AddressBase): void;
  /** Loads a profile: its content becomes the saved baseline. */
  applyProfile(profile: Profile): void;
  /**
   * A reloaded window takes the connection and poll the backend still has. They become the clean
   * baseline of an untitled window, so it does not show "Modified" (REV-002 m7).
   */
  adoptBackendSetup(connection: ConnectionConfig | null, poll: PollDefinition | null): void;
  /** The profile was saved under `name`: the current content is the new baseline. */
  markSaved(name: string): void;
  /** A profile was renamed elsewhere (S3): only the name changes, the content is not dirty. */
  setProfileName(name: string): void;
  toProfile(name?: string): Profile;
  reset(): void;
}

export type ConfigStore = ConfigData & ConfigActions;
export type ConfigStoreApi = StoreApi<ConfigStore>;

export function createConfigStore(): ConfigStoreApi {
  return createStore<ConfigStore>()((set, get) => ({
    ...initialConfigData(),

    setConnection: (connection) => set({ connection }),
    setPoll: (poll) => set({ poll }),
    setAutoStart: (autoStartPoll) => set({ autoStartPoll }),
    setFormat: (format) => set((s) => ({ display: { ...s.display, format } })),
    toggleBase: () =>
      set((s) => ({ display: { ...s.display, addressBase: s.display.addressBase === 0 ? 1 : 0 } })),
    setBase: (addressBase) => set((s) => ({ display: { ...s.display, addressBase } })),
    applyProfile: (profile) => set(fromProfile(profile)),
    adoptBackendSetup: (connection, poll) =>
      set((s) => {
        const next = { ...s, connection: connection ?? s.connection, poll: poll ?? s.poll };
        return {
          connection: next.connection,
          poll: next.poll,
          ...(s.profileName === null && s.savedSnapshot === null
            ? { savedSnapshot: serializeContent(next) }
            : {}),
        };
      }),
    markSaved: (name) => set((s) => ({ profileName: name, savedSnapshot: serializeContent(s) })),
    setProfileName: (profileName) => set({ profileName }),
    toProfile: (name) => toProfile(get(), name),
    reset: () => set(initialConfigData()),
  }));
}

// ---- typed selectors ----
export const selectConnection = (s: ConfigStore) => s.connection;
export const selectPoll = (s: ConfigStore) => s.poll;
export const selectAutoStart = (s: ConfigStore) => s.autoStartPoll;
export const selectFormat = (s: ConfigStore) => s.display.format;
export const selectAddressBase = (s: ConfigStore) => s.display.addressBase;
export const selectProfileName = (s: ConfigStore) => s.profileName;
export const selectIsDirty = (s: ConfigStore) => isDirty(s);
