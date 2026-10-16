import { createStore, type StoreApi } from "zustand/vanilla";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import { toIpcError } from "@/shared/ipc/modbus-master";
import type {
  ConnectionConfig,
  PollDefinition,
  SessionEvent,
  SessionSnapshot,
  StateChangedEvent,
} from "@/shared/ipc/modbus-master.types";
import {
  actionsFor,
  answersPending,
  badResponseOf,
  initialSessionData,
  type PendingCommand,
  reduceStateChanged,
  type SessionData,
} from "./session.logic";

export interface SessionState extends SessionData {
  pending: PendingCommand | null;
  /** True once the pending command returned and only its answering event is missing. */
  pendingResolved: boolean;
  /** IPC rejection text, shown as a toast by the runtime. */
  commandError: string | null;
  /** The input field the backend named in a `validation` error (`AppError.field`), if any. */
  commandErrorField: string | null;
  /**
   * The definition that is (or will be) polled: set by the last start / resume / apply command
   * and by the snapshot. The banner describes this, not the draft in the setup form.
   */
  pollDefinition: PollDefinition | null;
  /** The connection of the last connect command and of the snapshot, for the same reason. */
  connection: ConnectionConfig | null;
  /** True once `init` has applied the snapshot. Session commands are ignored before that. */
  ready: boolean;
  /** Increments on every applied backend state event, even when the state repeats (Apply restarts). */
  revision: number;
}

export interface SessionActions {
  /**
   * Attaches the event channel (`mm_open_session`) and applies the snapshot. Events that arrive
   * before the snapshot reply are held and replayed on top of it.
   */
  init(): Promise<void>;
  /** Authoritative backend snapshot (T1-T15). */
  applyStateChanged(evt: StateChangedEvent): void;
  connect(config: ConnectionConfig): Promise<void>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Start, resume and apply all use this. */
  startPoll(def: PollDefinition): Promise<void>;
  stopPoll(): Promise<void>;
  /**
   * T15: disconnected -> idle. The backend models this transition itself: `mm_disconnect`
   * dismisses a `disconnected` session, and the idle event follows.
   */
  dismiss(): Promise<void>;
  clearCommandError(): void;
}

export type SessionStore = SessionState & SessionActions;

export interface SessionStoreDeps {
  ipc: ModbusMasterIpc;
  /** Receives every non-state event (poll updates, traffic, counters). */
  onEvent?: (event: SessionEvent) => void;
  /** Receives the snapshot returned by `openSession`, before the held events are replayed. */
  onSnapshot?: (snapshot: SessionSnapshot) => void;
  /** Development warning for an unexpected transition. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

export type SessionStoreApi = StoreApi<SessionStore>;

const initialState: SessionState = {
  ...initialSessionData,
  pending: null,
  pendingResolved: false,
  commandError: null,
  commandErrorField: null,
  pollDefinition: null,
  connection: null,
  ready: false,
  revision: 0,
};

export function createSessionStore(deps: SessionStoreDeps): SessionStoreApi {
  const { ipc } = deps;
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  let latestCommand = 0;
  // What the backend last accepted. A rejected command rolls the shown connection and poll back
  // to these, never to a value an older, also rejected command had set (REV-003 m-1).
  let acceptedPoll: PollDefinition | null = null;
  let acceptedConnection: ConnectionConfig | null = null;
  let acceptedPollAt = 0;

  return createStore<SessionStore>()((set, get) => {
    /**
     * Runs a command: sets `pending`. A rejection clears it again and records the error text and
     * field. The matching backend event clears it otherwise.
     */
    async function send(
      pending: PendingCommand,
      command: () => Promise<void>,
      hooks: { accepted?: (token: number) => void; rejected?: () => void } = {},
    ): Promise<void> {
      latestCommand += 1;
      const mine = latestCommand;
      set({ pending, pendingResolved: false, commandError: null, commandErrorField: null });
      try {
        await command();
        hooks.accepted?.(mine);
        if (mine === latestCommand && get().pending === pending) set({ pendingResolved: true });
      } catch (e) {
        const error = toIpcError(e);
        // Only the newest command rolls back: an older one failing while a newer one is pending
        // must not undo the newer one.
        if (mine === latestCommand) hooks.rejected?.();
        set({
          ...(mine === latestCommand ? { pending: null, pendingResolved: false } : {}),
          commandError: error.message,
          commandErrorField: error.field,
        });
      }
    }

    const route = (event: SessionEvent) => {
      if (event.type === "StateChanged") get().applyStateChanged(event);
      else deps.onEvent?.(event);
    };

    const usable = (pending: PendingCommand | "any") => {
      const s = get();
      return s.ready && (pending === "any" || s.pending !== pending);
    };

    return {
      ...initialState,

      async init() {
        // The channel is live before the snapshot reply arrives, and the two travel on different
        // paths. Hold what comes first, apply the snapshot, then replay (REV-002 M3).
        let holding = true;
        const held: SessionEvent[] = [];
        const snapshot = await ipc.openSession((event) => {
          if (holding) held.push(event);
          else route(event);
        });
        set({
          state: snapshot.state,
          reason: snapshot.state === "disconnected" ? snapshot.reason : null,
          exceptionCode: snapshot.state === "exception" ? snapshot.exceptionCode : null,
          badResponse: snapshot.state === "badResponse" ? badResponseOf(snapshot) : null,
          consecutiveFailures: snapshot.consecutiveFailures,
          since: snapshot.at,
          pollDefinition: snapshot.poll,
          connection: snapshot.config,
          ready: true,
        });
        acceptedPoll = snapshot.poll;
        acceptedConnection = snapshot.config;
        deps.onSnapshot?.(snapshot);
        holding = false;
        // The backend emits on the new channel only after the snapshot was taken, so everything
        // held comes after it and is replayed as it arrived (REV-003 n-1).
        for (const event of held) route(event);
        // The channel callback keeps this array alive for the life of the window.
        held.length = 0;
      },

      applyStateChanged(evt) {
        const prev = get();
        const next = reduceStateChanged(prev, evt);
        if (next.lastUnexpected && next.lastUnexpected !== prev.lastUnexpected) {
          warn(
            `Unexpected session transition ${next.lastUnexpected.from} -> ${next.lastUnexpected.to}`,
          );
        }
        const clears =
          prev.pending !== null &&
          (prev.pendingResolved || answersPending(prev.pending, prev.state, evt.state));
        set({
          ...next,
          ...(clears ? { pending: null, pendingResolved: false } : {}),
          revision: prev.revision + 1,
        });
      },

      async connect(config) {
        if (!usable("any") || get().pending !== null || !actionsFor(get().state).connect) return;
        set({ connection: config });
        await send("connect", () => ipc.connect(config), {
          accepted: () => {
            acceptedConnection = config;
          },
          rejected: () => set({ connection: acceptedConnection }),
        });
      },

      async cancelConnect() {
        if (!usable("cancel") || !actionsFor(get().state).cancel) return;
        await send("cancel", () => ipc.cancelConnect());
      },

      async disconnect() {
        if (!usable("disconnect") || !actionsFor(get().state).disconnect) return;
        await send("disconnect", () => ipc.disconnect());
      },

      async startPoll(def) {
        // A second Apply while the first is pending replaces it: the backend runs them in order.
        if (!usable("any") || !actionsFor(get().state).startPoll) return;
        set({ pollDefinition: def });
        await send("startPoll", () => ipc.startPoll(def), {
          accepted: (token) => {
            if (token > acceptedPollAt) {
              acceptedPollAt = token;
              acceptedPoll = def;
            }
          },
          rejected: () => set({ pollDefinition: acceptedPoll }),
        });
      },

      async stopPoll() {
        if (!usable("stopPoll") || !actionsFor(get().state).pause) return;
        await send("stopPoll", () => ipc.stopPoll());
      },

      async dismiss() {
        if (!usable("dismiss") || !actionsFor(get().state).dismiss) return;
        await send("dismiss", () => ipc.disconnect());
      },

      clearCommandError() {
        set({ commandError: null, commandErrorField: null });
      },
    };
  });
}

// ---- typed selectors (components select the minimum slice) ----
export const selectSessionState = (s: SessionStore) => s.state;
export const selectPending = (s: SessionStore) => s.pending;
export const selectCommandError = (s: SessionStore) => s.commandError;
export const selectReason = (s: SessionStore) => s.reason;
export const selectExceptionCode = (s: SessionStore) => s.exceptionCode;
export const selectConsecutiveFailures = (s: SessionStore) => s.consecutiveFailures;
export const selectSince = (s: SessionStore) => s.since;
export const selectReady = (s: SessionStore) => s.ready;
