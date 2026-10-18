// The Write dialog of one window (DES-001 S2, DES-002 3.3, FE-002 task 22). A window has one dialog:
// it is a modal, so only one poll writes at a time from that window, but the dialog is opened from
// any poll view (a sub-window in W1, the poll of a native window in W2). The store therefore keeps
// the poll it was opened for and asks its dependencies for that poll's settings.
//
// Writes of all hosts of one connection share one FIFO queue in Rust (DES-002 7): the dialog only
// sends one request at a time (`status: "sending"` blocks a second Send) and shows what comes back.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import { toIpcError } from "@/shared/ipc/modbus-master";
import type {
  PollConfig,
  PollId,
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
  /** The poll the dialog was opened for. Null while closed. */
  pollId: PollId | null;
  draft: WriteDraft;
  /** Remembered for the next prefill. */
  lastFunction: WriteFunction;
  status: WriteStatus;
  result: WriteResult | null;
  /** The request that produced `result`, for the success text. */
  request: WriteRequest | null;
  /** Address base used when `request` was sent. */
  requestBase: 0 | 1;
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
  /** Opens the dialog for a poll, prefilled from the row and the poll. */
  openFor(pollId: PollId, prefill?: WritePrefill): void;
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
  ipc: Pick<ModbusMasterIpc, "write">;
  /** The applied settings of a poll (display base and format, slave id), or null once it is gone. */
  getConfig: (pollId: PollId) => PollConfig | null;
  /** True while the link is up. */
  isLinkUp: () => boolean;
}

const BASE_FALLBACK = 0;

export function createWriteStore(deps: WriteStoreDeps): WriteStoreApi {
  // Incremented when the dialog opens or closes, so the late result of an abandoned write is dropped.
  let generation = 0;

  return createStore<WriteStore>()((set, get) => ({
    open: false,
    pollId: null,
    draft: emptyDraft(),
    lastFunction: DEFAULT_WRITE_FUNCTION,
    status: "idle",
    result: null,
    request: null,
    requestBase: BASE_FALLBACK,
    ipcError: null,
    ipcErrorField: null,
    submitted: false,
    touched: {},

    openFor(pollId, prefill) {
      const config = deps.getConfig(pollId);
      if (!config) return;
      generation += 1;
      set({
        open: true,
        pollId,
        draft: buildDraft(prefill, {
          base: config.display.addressBase,
          format: config.display.format,
          lastFunction: get().lastFunction,
          defaultSlaveId: config.definition.slaveId,
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
        pollId: null,
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
      if (!s.open || s.pollId === null || s.status === "sending") return;
      const pollId = s.pollId;
      const base = deps.getConfig(pollId)?.display.addressBase ?? BASE_FALLBACK;
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
        const result = await deps.ipc.write(parsed.value, pollId);
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
export const selectWritePollId = (s: WriteStore) => s.pollId;
export const selectWriteStatus = (s: WriteStore) => s.status;
export const selectWriteResult = (s: WriteStore) => s.result;
export const selectWriteDraft = (s: WriteStore) => s.draft;
