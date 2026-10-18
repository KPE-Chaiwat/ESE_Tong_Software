// The connection settings the user has typed (the CONNECTION section form), as a typed value. The
// form (react-hook-form) pushes every valid draft here; Connect, Reconnect and a reload read it.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionConfig } from "@/shared/ipc/modbus-master.types";

/** TCP defaults of DES-001 section 1: empty host, port 502, timeout 1000 ms. */
export function defaultTcpConnection(): ConnectionConfig {
  return { mode: "tcp", host: "", port: 502, timeoutMs: 1000 };
}

export interface ConnectionDraftState {
  connection: ConnectionConfig;
}

export interface ConnectionDraftActions {
  setConnection(connection: ConnectionConfig): void;
  reset(): void;
}

export type ConnectionDraftStore = ConnectionDraftState & ConnectionDraftActions;
export type ConnectionDraftStoreApi = StoreApi<ConnectionDraftStore>;

export function createConnectionDraftStore(): ConnectionDraftStoreApi {
  return createStore<ConnectionDraftStore>()((set) => ({
    connection: defaultTcpConnection(),
    setConnection: (connection) => set({ connection }),
    reset: () => set({ connection: defaultTcpConnection() }),
  }));
}
