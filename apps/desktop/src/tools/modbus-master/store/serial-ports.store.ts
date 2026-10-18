import { createStore, type StoreApi } from "zustand/vanilla";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import { toIpcError } from "@/shared/ipc/modbus-master";
import type { SerialPortInfo } from "@/shared/ipc/modbus-master.types";

export type SerialPortsStatus = "idle" | "loading" | "ready" | "error";

export interface SerialPortsData {
  status: SerialPortsStatus;
  ports: SerialPortInfo[];
  error: string | null;
}

export interface SerialPortsActions {
  /** Called on the first switch to RTU and by the Refresh button. */
  refresh(): Promise<void>;
}

export type SerialPortsStore = SerialPortsData & SerialPortsActions;
export type SerialPortsStoreApi = StoreApi<SerialPortsStore>;

export function createSerialPortsStore(deps: {
  ipc: Pick<ModbusMasterIpc, "listSerialPorts">;
}): SerialPortsStoreApi {
  let latest = 0;
  return createStore<SerialPortsStore>()((set) => ({
    status: "idle",
    ports: [],
    error: null,

    async refresh() {
      latest += 1;
      const mine = latest;
      set({ status: "loading", error: null });
      try {
        const ports = await deps.ipc.listSerialPorts();
        if (mine !== latest) return;
        set({ status: "ready", ports, error: null });
      } catch (e) {
        if (mine !== latest) return;
        set({ status: "error", error: toIpcError(e).message });
      }
    },
  }));
}

export const selectPorts = (s: SerialPortsStore) => s.ports;
export const selectPortsStatus = (s: SerialPortsStore) => s.status;
export const selectPortsError = (s: SerialPortsStore) => s.error;
