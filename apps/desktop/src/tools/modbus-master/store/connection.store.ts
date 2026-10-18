// The connection state of one window (DES-002 1.2, 1.3, FE-002 task 05). Rust owns the connection;
// this store mirrors it and tracks the commands the user sent. In the connection window (W1) every
// poll view reads this one instance, and it receives `ConnectionStateChanged` from the session
// channel and from every view channel: the second copy of an event changes nothing.
import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type {
  ConnectionConfig,
  ConnectionState,
  ConnectionStateChangedEvent,
  ConnectionStatus,
} from "@/shared/ipc/modbus-master.types";
import {
  answersPendingConnection,
  type ConnectionData,
  type ConnectionPendingCommand,
  connectionActionsFor,
  initialConnectionData,
  isDuplicateConnectionEvent,
  reduceConnectionStateChanged,
} from "./connection.logic";

export interface ConnectionStoreState extends ConnectionData {
  pending: ConnectionPendingCommand | null;
  /** True once the pending command returned and only its answering event is missing. */
  pendingResolved: boolean;
  /** IPC rejection text, shown as a toast by the runtime. */
  commandError: string | null;
  /** The input field the backend named in a `validation` error (`AppError.field`), if any. */
  commandErrorField: string | null;
  /** The connection of the last accepted connect command and of the snapshot. */
  connection: ConnectionConfig | null;
  /** "Start polling when connected" (REQ-001), owned by Rust. */
  autoStartPoll: boolean;
  /** True once a snapshot was applied. Commands are ignored before that. */
  ready: boolean;
  /** Increments on every applied transition, so announcements fire once per transition. */
  revision: number;
}

export interface ConnectionStoreActions {
  /** The connection part of `mm_open_session` or of an attach snapshot. */
  applySnapshot(snapshot: { connection: ConnectionStatus; autoStartPoll?: boolean }): void;
  /**
   * Authoritative backend transition (C1-C7). Returns false when the event repeats what is
   * already shown (the same event arrives on the session channel and on view channels).
   */
  applyConnectionStateChanged(
    evt: Pick<ConnectionStateChangedEvent, "state" | "reason" | "at"> & {
      config?: ConnectionConfig | null;
    },
  ): boolean;
  connect(config: ConnectionConfig): Promise<void>;
  /** Connect again with the connection of the last accepted connect. */
  reconnect(): Promise<void>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<void>;
  /** C7: disconnected -> idle goes through `mm_disconnect`; the state changes on the idle event. */
  dismiss(): Promise<void>;
  setAutoStartPoll(enabled: boolean): Promise<void>;
  clearCommandError(): void;
}

export type ConnectionStore = ConnectionStoreState & ConnectionStoreActions;
export type ConnectionStoreApi = StoreApi<ConnectionStore>;

export interface ConnectionStoreDeps {
  ipc: Pick<ModbusMasterIpc, "connect" | "cancelConnect" | "disconnect" | "setAutoStartPoll">;
  /**
   * `window`: the connection window, which owns the link. `poll`: a native poll window. It can
   * connect and reconnect when the link is down, but never cancel, disconnect or dismiss.
   */
  role?: "window" | "poll";
  /** Development warning for an unexpected transition. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

const initialState: ConnectionStoreState = {
  ...initialConnectionData,
  pending: null,
  pendingResolved: false,
  commandError: null,
  commandErrorField: null,
  connection: null,
  autoStartPoll: true,
  ready: false,
  revision: 0,
};

export function createConnectionStore(deps: ConnectionStoreDeps): ConnectionStoreApi {
  const { ipc } = deps;
  const owner = (deps.role ?? "window") === "window";
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  let latestCommand = 0;
  // What the backend last accepted: a rejected connect rolls back to it.
  let acceptedConnection: ConnectionConfig | null = null;

  return createStore<ConnectionStore>()((set, get) => {
    /**
     * Runs a command: sets `pending`. A rejection clears it again and records the error text and
     * field. The matching backend event clears it otherwise.
     */
    async function send(
      pending: ConnectionPendingCommand,
      command: () => Promise<void>,
      hooks: { accepted?: () => void; rejected?: () => void } = {},
    ): Promise<void> {
      latestCommand += 1;
      const mine = latestCommand;
      set({ pending, pendingResolved: false, commandError: null, commandErrorField: null });
      try {
        await command();
        hooks.accepted?.();
        if (mine === latestCommand && get().pending === pending) set({ pendingResolved: true });
      } catch (e) {
        const error = toIpcError(e);
        if (mine === latestCommand) hooks.rejected?.();
        set({
          ...(mine === latestCommand ? { pending: null, pendingResolved: false } : {}),
          commandError: error.message,
          commandErrorField: error.field,
        });
      }
    }

    const usable = () => get().ready && get().pending === null;

    return {
      ...initialState,

      applySnapshot(snapshot) {
        acceptedConnection = snapshot.connection.config;
        set({
          state: snapshot.connection.state,
          reason: snapshot.connection.state === "disconnected" ? snapshot.connection.reason : null,
          since: snapshot.connection.at,
          connection: snapshot.connection.config,
          ...(snapshot.autoStartPoll === undefined
            ? {}
            : { autoStartPoll: snapshot.autoStartPoll }),
          ready: true,
        });
      },

      applyConnectionStateChanged(evt) {
        const prev = get();
        if (isDuplicateConnectionEvent(prev, evt)) return false;
        const next = reduceConnectionStateChanged(prev, evt);
        if (next.lastUnexpected && next.lastUnexpected !== prev.lastUnexpected) {
          warn(
            `Unexpected connection transition ${next.lastUnexpected.from} -> ${next.lastUnexpected.to}`,
          );
        }
        const clears =
          prev.pending !== null &&
          (prev.pendingResolved || answersPendingConnection(prev.pending, prev.state, evt.state));
        set({
          ...next,
          // The event carries the connection settings Rust has (after a profile load, say).
          ...(evt.config ? { connection: evt.config } : {}),
          ...(clears ? { pending: null, pendingResolved: false } : {}),
          revision: prev.revision + 1,
        });
        return true;
      },

      async connect(config) {
        if (!usable() || !connectionActionsFor(get().state).connect) return;
        set({ connection: config });
        await send("connect", () => ipc.connect(config), {
          accepted: () => {
            acceptedConnection = config;
          },
          rejected: () => set({ connection: acceptedConnection }),
        });
      },

      async reconnect() {
        const config = get().connection;
        if (config) await get().connect(config);
      },

      async cancelConnect() {
        if (!owner || !get().ready || get().pending === "cancel") return;
        if (!connectionActionsFor(get().state).cancel) return;
        await send("cancel", () => ipc.cancelConnect());
      },

      async disconnect() {
        if (!owner || !get().ready || get().pending === "disconnect") return;
        if (!connectionActionsFor(get().state).disconnect) return;
        await send("disconnect", () => ipc.disconnect());
      },

      async dismiss() {
        if (!owner || !get().ready || get().pending === "dismiss") return;
        if (!connectionActionsFor(get().state).dismiss) return;
        await send("dismiss", () => ipc.disconnect());
      },

      async setAutoStartPoll(enabled) {
        const previous = get().autoStartPoll;
        set({ autoStartPoll: enabled });
        try {
          await ipc.setAutoStartPoll(enabled);
        } catch (e) {
          const error = toIpcError(e);
          set({
            autoStartPoll: previous,
            commandError: error.message,
            commandErrorField: error.field,
          });
        }
      },

      clearCommandError() {
        set({ commandError: null, commandErrorField: null });
      },
    };
  });
}

// ---- typed selectors (components select the minimum slice) ----
export const selectConnectionState = (s: ConnectionStore): ConnectionState => s.state;
export const selectConnectionReason = (s: ConnectionStore) => s.reason;
export const selectConnectionPending = (s: ConnectionStore) => s.pending;
export const selectConnectionConfig = (s: ConnectionStore) => s.connection;
export const selectAutoStartPoll = (s: ConnectionStore) => s.autoStartPoll;
export const selectConnectionReady = (s: ConnectionStore) => s.ready;
export const selectConnectionRevision = (s: ConnectionStore) => s.revision;
export const selectConnectionCommandError = (s: ConnectionStore) => s.commandError;
export const selectConnectionSince = (s: ConnectionStore) => s.since;
