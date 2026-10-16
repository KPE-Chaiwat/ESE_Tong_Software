import { createStore, type StoreApi } from "zustand/vanilla";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import { toIpcError } from "@/shared/ipc/modbus-master";
import type {
  AddressBase,
  PollDefinition,
  ValueFormat,
  WriteFunction,
  WriteRequest,
  WriteResult,
} from "@/shared/ipc/modbus-master.types";
import {
  buildDraft,
  DEFAULT_WRITE_FUNCTION,
  emptyDraft,
  validateDraft,
  type WriteDraft,
  type WritePrefill,
} from "./write.logic";

export type WriteStatus = "idle" | "sending" | "done";

export interface WriteData {
  open: boolean;
  draft: WriteDraft;
  /** Remembered for the next prefill. */
  lastFunction: WriteFunction;
  status: WriteStatus;
  result: WriteResult | null;
  /** The request that produced `result`, for the success text. */
  request: WriteRequest | null;
  /** Address base used when `request` was sent. */
  requestBase: AddressBase;
  /** Rejection text of the write command (a failure that is not a WriteResult). */
  ipcError: string | null;
  /** The input the backend named in a `validation` rejection (`AppError.field`), if any. */
  ipcErrorField: string | null;
  /** Show every field error (set by a failed Send). */
  submitted: boolean;
  /** Fields the user has left, whose errors are shown. */
  touched: Readonly<Record<string, boolean>>;
}

export interface WriteActions {
  /** Opens the dialog, prefilled from the selected row and the poll. */
  openFor(prefill?: WritePrefill): void;
  close(): void;
  /** Empties the result area (for example after a link-lost result once the link is back). */
  clearResult(): void;
  updateDraft(patch: Partial<WriteDraft>): void;
  touch(field: string): void;
  /** Validates, then sends. Ignored while a write is in flight. */
  send(): Promise<void>;
}

export type WriteStore = WriteData & WriteActions;
export type WriteStoreApi = StoreApi<WriteStore>;

export interface WriteStoreDeps {
  ipc: ModbusMasterIpc;
  getAddressBase: () => AddressBase;
  getTableFormat: () => ValueFormat;
  getPoll: () => PollDefinition;
  /** True while the link is up (connected, paused or polling). */
  isLinkUp: () => boolean;
}

export function createWriteStore(deps: WriteStoreDeps): WriteStoreApi {
  // Incremented when the dialog opens or closes, so the late result of an abandoned write is dropped.
  let generation = 0;

  return createStore<WriteStore>()((set, get) => ({
    open: false,
    draft: emptyDraft(),
    lastFunction: DEFAULT_WRITE_FUNCTION,
    status: "idle",
    result: null,
    request: null,
    requestBase: 0,
    ipcError: null,
    ipcErrorField: null,
    submitted: false,
    touched: {},

    openFor(prefill) {
      generation += 1;
      set({
        open: true,
        draft: buildDraft(prefill, {
          base: deps.getAddressBase(),
          format: deps.getTableFormat(),
          lastFunction: get().lastFunction,
          defaultSlaveId: deps.getPoll().slaveId,
        }),
        status: "idle",
        result: null,
        request: null,
        ipcError: null,
        ipcErrorField: null,
        submitted: false,
        touched: {},
      });
    },

    close() {
      generation += 1;
      set({
        open: false,
        status: "idle",
        result: null,
        request: null,
        ipcError: null,
        ipcErrorField: null,
      });
    },

    clearResult() {
      set((s) => (s.status === "sending" ? s : { status: "idle", result: null, ipcError: null }));
    },

    updateDraft(patch) {
      // The result stays until the next Send or until the dialog closes (DES-001 2.5).
      set((s) => ({ draft: { ...s.draft, ...patch }, ipcErrorField: null }));
    },

    touch(field) {
      set((s) => ({ touched: { ...s.touched, [field]: true } }));
    },

    async send() {
      const s = get();
      if (!s.open || s.status === "sending") return;
      const base = deps.getAddressBase();
      const parsed = validateDraft(s.draft, base);
      if (!parsed.ok) {
        set({ submitted: true });
        return;
      }
      if (!deps.isLinkUp()) {
        set({ status: "done", result: { status: "notConnected" }, request: null, ipcError: null });
        return;
      }
      const mine = generation;
      set({
        status: "sending",
        result: null,
        request: parsed.value,
        requestBase: base,
        ipcError: null,
        ipcErrorField: null,
        submitted: true,
        lastFunction: parsed.value.function,
      });
      try {
        const result = await deps.ipc.write(parsed.value);
        if (mine !== generation) return;
        set({ status: "done", result });
      } catch (e) {
        if (mine !== generation) return;
        const error = toIpcError(e);
        set({ status: "done", result: null, ipcError: error.message, ipcErrorField: error.field });
      }
    },
  }));
}

export const selectWriteOpen = (s: WriteStore) => s.open;
export const selectWriteStatus = (s: WriteStore) => s.status;
export const selectWriteResult = (s: WriteStore) => s.result;
export const selectWriteDraft = (s: WriteStore) => s.draft;
