// One poll as one poll view sees it (DES-002 1.2, 1.4, FE-002 task 07). A connection window creates
// one of these per workspace sub-window, a native poll window creates one. The store attaches the
// view's event channel, holds events that arrive before the snapshot, mirrors the backend's poll
// state machine (PT0-PT8) and sends the user's commands for this poll. Rust owns everything it
// mirrors; only `pending` and the command error are local.
import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type {
  Counters,
  DetachReason,
  PollConfig,
  PollCountersEvent,
  PollDefinition,
  PollHostKind,
  PollId,
  PollStateChangedEvent,
  PollViewEvent,
  PollViewSettings,
  PollViewSnapshot,
  ViewToken,
} from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import { pollNameError } from "../lib/poll-names";
import {
  badResponseOf,
  effectiveScanShown,
  initialPollRuntimeData,
  type PollRuntimeData,
  reducePollStateChanged,
} from "./poll.logic";

export type PollAttachState = "attaching" | "attached" | "detached";
export type PollPending = "apply" | "active" | "rename" | "popOut" | "dock";

export interface PollStoreState extends PollRuntimeData {
  pollId: PollId;
  host: PollHostKind;
  viewToken: ViewToken | null;
  attach: PollAttachState;
  /** Why the view was detached by Rust (`ViewDetached`), null for a local dispose or an error. */
  detachReason: DetachReason | null;
  /** The text of a rejected attach, for the host to show. */
  attachError: string | null;
  /** null until the snapshot arrives (the PV "loading (attach)" state). */
  config: PollConfig | null;
  lastOkAt: number | null;
  counters: Counters;
  /** Shown as `SR {n} ms (effective {m} ms)`; null when the rate rule does not fire. */
  effectiveScanMs: number | null;
  hasUnappliedEdits: boolean;
  profileName: string | null;
  pending: PollPending | null;
  /** The poll was deleted (in any host): its view must close. */
  removed: boolean;
  commandError: string | null;
  commandErrorField: string | null;
}

export interface PollStoreActions {
  /** Attaches the view channel (`mm_attach_poll_view`) and applies the snapshot. Safe to call twice. */
  init(): Promise<void>;
  /** Detaches with this view's own token. Does nothing after `ViewDetached`. */
  dispose(): void;

  applyPollStateChanged(evt: PollStateChangedEvent): void;
  applyPollConfigChanged(config: PollConfig): void;
  applyCounters(evt: PollCountersEvent): void;
  applyViewDetached(reason: DetachReason): void;
  applyRemoved(): void;
  setProfileName(name: string | null): void;

  /** Apply with a changed definition (PT6, PT6b). Returns false when it was rejected. */
  apply(definition: PollDefinition): Promise<boolean>;
  /** Pause (false) or Resume (true): PT3, PT4. */
  setActive(active: boolean): Promise<void>;
  /** Returns the message for the name field, or null when the rename was sent. */
  rename(name: string): Promise<string | null>;
  /** Changes view settings (display, scale, overrides, columns, aliases). Applied at once, rolled back when rejected. */
  setView(partial: Partial<PollViewSettings>): Promise<boolean>;
  /** Tells Rust whether this view has unapplied setup edits. */
  reportUnappliedEdits(has: boolean): Promise<void>;
  /** The host store shows a spinner on the pop out or dock control while its command runs. */
  markPending(kind: "popOut" | "dock" | null): void;
  clearCommandError(): void;
}

export type PollStore = PollStoreState & PollStoreActions;
export type PollStoreApi = StoreApi<PollStore>;

export interface PollStoreDeps {
  ipc: Pick<
    ModbusMasterIpc,
    | "attachPollView"
    | "detachPollView"
    | "updatePoll"
    | "setPollActive"
    | "renamePoll"
    | "setPollView"
  >;
  pollId: PollId;
  host: PollHostKind;
  /** Receives the events this store does not handle (updates, connection, prefs, handoff request). */
  onEvent?: (event: PollViewEvent) => void;
  /** Receives the snapshot before the held events are replayed. */
  onSnapshot?: (snapshot: PollViewSnapshot) => void;
  /** The other polls' names, for the rename check. A native window leaves it out. */
  getOtherNames?: () => readonly string[];
  toasts?: ToastStoreApi;
  /** Development warning for an unexpected transition. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

export function createPollStore(deps: PollStoreDeps): PollStoreApi {
  const { ipc, pollId } = deps;
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  let started: Promise<void> | null = null;
  let disposed = false;

  return createStore<PollStore>()((set, get) => {
    const toastError = (message: string) =>
      deps.toasts?.getState().show(message, { tone: "error", durationMs: 4000 });

    /** Runs a command with a `pending` flag; a rejection becomes the error text and a toast. */
    async function send(pending: PollPending, command: () => Promise<void>): Promise<boolean> {
      set({ pending, commandError: null, commandErrorField: null });
      try {
        await command();
        return true;
      } catch (e) {
        const error = toIpcError(e);
        set({ commandError: error.message, commandErrorField: error.field });
        toastError(error.message);
        return false;
      } finally {
        if (get().pending === pending) set({ pending: null });
      }
    }

    function applySnapshot(snapshot: PollViewSnapshot): void {
      const poll = snapshot.poll;
      const status = poll.status;
      set({
        viewToken: snapshot.viewToken,
        attach: "attached",
        config: poll.config,
        state: status.state,
        consecutiveFailures: status.consecutiveFailures,
        exceptionCode: status.state === "exception" ? status.exceptionCode : null,
        badResponse: status.state === "badResponse" ? badResponseOf(status) : null,
        since: status.at,
        lastOkAt: poll.counters.lastOkAt,
        counters: poll.counters.counters,
        effectiveScanMs: effectiveScanShown(
          poll.counters.effectiveScanMs,
          poll.config.definition.scanRateMs,
        ),
        hasUnappliedEdits: poll.hasUnappliedEdits,
        profileName: snapshot.profileName,
      });
    }

    /** The events of this store; everything else goes to the owner. */
    function route(event: PollViewEvent): void {
      if (get().attach === "detached") return;
      switch (event.type) {
        case "PollStateChanged":
          if (event.pollId === pollId) get().applyPollStateChanged(event);
          break;
        case "PollConfigChanged": {
          // The event is the poll config itself, flattened next to `type`.
          const { type: _type, ...config } = event;
          if (config.pollId === pollId) get().applyPollConfigChanged(config);
          break;
        }
        case "PollCounters":
          if (event.pollId === pollId) get().applyCounters(event);
          break;
        case "PollRemoved":
          if (event.pollId === pollId) get().applyRemoved();
          break;
        case "ViewDetached":
          if (event.pollId === pollId) get().applyViewDetached(event.reason);
          break;
        case "ProfileNameChanged":
          get().setProfileName(event.name);
          break;
        case "PollUpdate":
          if (event.pollId === pollId) {
            // A good cycle is the only thing that moves `lastOkAt` between snapshots.
            set({ lastOkAt: event.at });
            deps.onEvent?.(event);
          }
          break;
        default:
          deps.onEvent?.(event);
      }
    }

    return {
      pollId,
      host: deps.host,
      viewToken: null,
      attach: "attaching",
      detachReason: null,
      attachError: null,
      config: null,
      ...initialPollRuntimeData,
      lastOkAt: null,
      counters: { requests: 0, responses: 0, errors: 0, timeouts: 0 },
      effectiveScanMs: null,
      hasUnappliedEdits: false,
      profileName: null,
      pending: null,
      removed: false,
      commandError: null,
      commandErrorField: null,

      init() {
        started ??= (async () => {
          // The channel is live before the snapshot reply arrives, and the two travel on different
          // paths. Hold what comes first, apply the snapshot, then replay (FE-001 rule).
          let holding = true;
          const held: PollViewEvent[] = [];
          try {
            const snapshot = await ipc.attachPollView(pollId, deps.host, (event) => {
              if (holding) held.push(event);
              else route(event);
            });
            if (disposed) {
              void ipc.detachPollView(pollId, snapshot.viewToken).catch(() => {});
              set({ attach: "detached" });
              return;
            }
            applySnapshot(snapshot);
            deps.onSnapshot?.(snapshot);
            holding = false;
            for (const event of held) route(event);
            // The channel callback keeps this array alive for the life of the view.
            held.length = 0;
          } catch (e) {
            holding = false;
            held.length = 0;
            const message = toIpcError(e).message;
            set({ attach: "detached", attachError: message });
            if (!disposed) toastError(message);
          }
        })();
        return started;
      },

      dispose() {
        disposed = true;
        const { viewToken, attach } = get();
        if (attach === "attached" && viewToken !== null) {
          // A late detach with an old token is a no-op in Rust, so this can never remove a newer view.
          void ipc.detachPollView(pollId, viewToken).catch(() => {});
        }
        if (attach !== "attaching") set({ attach: "detached" });
      },

      applyPollStateChanged(evt) {
        if (evt.pollId !== pollId) return;
        const prev = get();
        const next = reducePollStateChanged(prev, evt);
        if (next.lastUnexpected && next.lastUnexpected !== prev.lastUnexpected) {
          warn(
            `Unexpected poll transition ${next.lastUnexpected.from} -> ${next.lastUnexpected.to}`,
          );
        }
        set(next);
      },

      applyPollConfigChanged(config) {
        if (config.pollId !== pollId) return;
        set({ config });
      },

      applyCounters(evt) {
        if (evt.pollId !== pollId) return;
        const scan = get().config?.definition.scanRateMs ?? null;
        set({
          counters: evt.counters,
          // Rust clears it after Apply, Disconnect and Dismiss: a null is meaningful.
          lastOkAt: evt.lastOkAt,
          effectiveScanMs: scan === null ? null : effectiveScanShown(evt.effectiveScanMs, scan),
        });
      },

      applyViewDetached(reason) {
        set({ attach: "detached", detachReason: reason });
      },

      applyRemoved() {
        set({ removed: true });
      },

      setProfileName(name) {
        set({ profileName: name });
      },

      apply(definition) {
        return send("apply", () => ipc.updatePoll(pollId, definition));
      },

      async setActive(active) {
        await send("active", () => ipc.setPollActive(pollId, active));
      },

      async rename(name) {
        const config = get().config;
        if (!config) return null;
        const problem = pollNameError(name, deps.getOtherNames?.() ?? []);
        if (problem) return problem;
        if (name === config.name) return null;
        let message: string | null = null;
        set({ pending: "rename", commandError: null, commandErrorField: null });
        try {
          await ipc.renamePoll(pollId, name);
        } catch (e) {
          const error = toIpcError(e);
          if (error.field === "name") message = error.message;
          else {
            set({ commandError: error.message, commandErrorField: error.field });
            toastError(error.message);
          }
        } finally {
          if (get().pending === "rename") set({ pending: null });
        }
        return message;
      },

      async setView(partial) {
        const before = get();
        const config = before.config;
        if (!config) return false;
        // Applied at once; Rust confirms with `PollConfigChanged`, or the change is rolled back.
        // Only the keys the caller gave go to Rust (a patch: the others stay as they are).
        const optimistic: PollConfig = {
          ...config,
          ...(partial.display === undefined ? {} : { display: partial.display }),
          ...(partial.formatOverrides === undefined
            ? {}
            : { formatOverrides: partial.formatOverrides }),
          ...(partial.colorRules === undefined ? {} : { colorRules: partial.colorRules }),
          ...(partial.scale === undefined ? {} : { scale: partial.scale }),
          ...(partial.scaleOverrides === undefined
            ? {}
            : { scaleOverrides: partial.scaleOverrides }),
          ...(partial.valueColumns === undefined ? {} : { valueColumns: partial.valueColumns }),
          ...(partial.aliases === undefined ? {} : { aliases: partial.aliases }),
        };
        // Format overrides and rules form one validated setting; keep the applied view until acknowledged.
        if (
          partial.colorRules !== undefined ||
          partial.display !== undefined ||
          partial.formatOverrides !== undefined
        ) {
          try {
            await ipc.setPollView(pollId, partial);
            if (get().config === config)
              set({
                config: optimistic,
                hasUnappliedEdits: partial.hasUnappliedEdits ?? before.hasUnappliedEdits,
              });
            return true;
          } catch (e) {
            const error = toIpcError(e);
            set({ commandError: error.message, commandErrorField: error.field });
            return false;
          }
        }
        set({
          config: optimistic,
          hasUnappliedEdits: partial.hasUnappliedEdits ?? before.hasUnappliedEdits,
        });
        try {
          await ipc.setPollView(pollId, partial);
          return true;
        } catch (e) {
          const error = toIpcError(e);
          // Roll back, unless a newer config already replaced the optimistic one.
          if (get().config === optimistic) {
            set({ config, hasUnappliedEdits: before.hasUnappliedEdits });
          }
          set({ commandError: error.message, commandErrorField: error.field });
          toastError(error.message);
          return false;
        }
      },

      async reportUnappliedEdits(has) {
        if (get().hasUnappliedEdits === has || get().config === null) return;
        await get().setView({ hasUnappliedEdits: has });
      },

      markPending(kind) {
        set({ pending: kind });
      },

      clearCommandError() {
        set({ commandError: null, commandErrorField: null });
      },
    };
  });
}

// ---- typed selectors ----
export const selectPollState = (s: PollStore) => s.state;
export const selectPollConfig = (s: PollStore) => s.config;
export const selectPollAttach = (s: PollStore) => s.attach;
export const selectPollPending = (s: PollStore) => s.pending;
export const selectPollCounters = (s: PollStore) => s.counters;
export const selectEffectiveScanMs = (s: PollStore) => s.effectiveScanMs;
export const selectConsecutiveFailures = (s: PollStore) => s.consecutiveFailures;
export const selectPollExceptionCode = (s: PollStore) => s.exceptionCode;
export const selectHasUnappliedEdits = (s: PollStore) => s.hasUnappliedEdits;
export const selectPollRemoved = (s: PollStore) => s.removed;
export const selectPollLastOkAt = (s: PollStore) => s.lastOkAt;
export const selectPollProfileName = (s: PollStore) => s.profileName;
