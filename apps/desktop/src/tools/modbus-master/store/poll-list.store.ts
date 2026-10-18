// The poll list of the connection window (DES-002 2.2.3, FE-002 task 06). It mirrors every poll
// for the sidebar, the summary chip, the Window menu, the traffic filter names, the tile order and
// the close confirms. Rust owns the polls and their order; this store applies `PollListChanged`
// and the per-poll events, and sends the user's commands.
import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type {
  CountersEvent,
  PollHostKind,
  PollId,
  PollListChangedEvent,
  PollStateChangedEvent,
  PollSummary,
} from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import { reorder } from "../lib/drag-math";
import { MAX_POLLS, MAX_POLLS_MESSAGE, nextPollName, pollNameError } from "../lib/poll-names";
import { pollSummary } from "../lib/poll-summary";
import { hostStateOf, type PollHostState } from "../lib/status-line";
import { badResponseOf, reducePollStateChanged } from "./poll.logic";
import {
  defaultPollInput,
  findUnexpectedHostTransition,
  namesInOrder,
  sameCounters,
  sameSummary,
  selectionAfterRemoval,
  type UnexpectedHostTransition,
} from "./poll-list.logic";

export type PollListPending = "active" | "rename" | "remove" | "reorder";

export interface PollListState {
  /** List order from Rust. */
  order: PollId[];
  polls: Record<PollId, PollSummary>;
  selectedId: PollId | null;
  pending: Record<PollId, PollListPending | null>;
  /** New poll or Duplicate is running. */
  adding: boolean;
  /** The row that is being renamed inline. */
  renamingId: PollId | null;
  /** True once a snapshot or a list event was applied. */
  ready: boolean;
  /** The last host transition that is not in `HOST_ALLOWED` (a development aid, like the others). */
  lastUnexpected: UnexpectedHostTransition | null;
}

export interface PollListActions {
  /** The polls of `mm_open_session`, in list order. */
  applySnapshot(polls: readonly PollSummary[]): void;
  applyPollListChanged(evt: Pick<PollListChangedEvent, "polls">): void;
  applyPollStateChanged(evt: PollStateChangedEvent): void;
  /** Per-poll counters of the `Counters` event. */
  applyCounters(evt: Pick<CountersEvent, "polls">): void;

  select(id: PollId | null): void;
  /** New poll in the workspace. Returns the new id, or null at the limit or on an error. */
  add(): Promise<PollId | null>;
  duplicate(id: PollId): Promise<PollId | null>;
  /** Returns the message to show under the name, or null when the rename was sent. */
  rename(id: PollId, name: string): Promise<string | null>;
  remove(id: PollId): Promise<void>;
  setActive(id: PollId, active: boolean): Promise<void>;
  setAllActive(active: boolean): Promise<void>;
  /** Moves the row at `fromIndex` to `toIndex`. Applied at once, rolled back when rejected. */
  reorder(fromIndex: number, toIndex: number): Promise<void>;
  /** Sets the whole order (a permutation of the polls). Applied at once, rolled back when rejected. */
  setOrder(order: readonly PollId[], moved?: PollId): Promise<boolean>;
  moveUp(id: PollId): Promise<void>;
  moveDown(id: PollId): Promise<void>;
  startRename(id: PollId): void;
  cancelRename(): void;
}

export type PollListStore = PollListState & PollListActions;
export type PollListStoreApi = StoreApi<PollListStore>;

export interface PollListStoreDeps {
  ipc: Pick<
    ModbusMasterIpc,
    | "addPoll"
    | "duplicatePoll"
    | "removePoll"
    | "renamePoll"
    | "reorderPolls"
    | "setPollActive"
    | "setAllPollsActive"
  >;
  toasts: ToastStoreApi;
  warn?: (message: string) => void;
  canChangeDefinitions?: () => boolean;
}

const initialState: PollListState = {
  order: [],
  polls: {},
  selectedId: null,
  pending: {},
  adding: false,
  renamingId: null,
  ready: false,
  lastUnexpected: null,
};

export function createPollListStore(deps: PollListStoreDeps): PollListStoreApi {
  const { ipc, toasts } = deps;
  const warn = deps.warn ?? ((m: string) => console.warn(m));

  const fail = (e: unknown): string => {
    const message = toIpcError(e).message;
    toasts.getState().show(message, { tone: "error", durationMs: 4000 });
    return message;
  };

  return createStore<PollListStore>()((set, get) => {
    const setPending = (id: PollId, kind: PollListPending | null) =>
      set((s) => ({ pending: { ...s.pending, [id]: kind } }));

    /** Runs a command for one poll with its `pending` flag; errors become a toast. */
    async function withPending(id: PollId, kind: PollListPending, run: () => Promise<void>) {
      setPending(id, kind);
      try {
        await run();
      } catch (e) {
        fail(e);
      } finally {
        setPending(id, null);
      }
    }

    // The order Rust last confirmed: a snapshot, a list event or an accepted reorder.
    let confirmedOrder: PollId[] = [];

    function applyList(polls: readonly PollSummary[]): void {
      const prev = get();
      const order = polls.map((p) => p.config.pollId);
      const next: Record<PollId, PollSummary> = {};
      for (const incoming of polls) {
        const id = incoming.config.pollId;
        const old = prev.polls[id];
        next[id] = old && sameSummary(old, incoming) ? old : incoming;
      }
      let selectedId = prev.selectedId;
      if (selectedId !== null && !(selectedId in next)) {
        selectedId = selectionAfterRemoval(prev.order, selectedId, order);
      }
      const pending: Record<PollId, PollListPending | null> = {};
      for (const id of order) if (prev.pending[id]) pending[id] = prev.pending[id] ?? null;
      confirmedOrder = order;
      const unexpected = prev.ready ? findUnexpectedHostTransition(prev.polls, polls) : null;
      if (unexpected) {
        warn(
          `Unexpected host transition of poll ${unexpected.pollId}: ${unexpected.from} -> ${unexpected.to}`,
        );
      }
      set({
        ...(unexpected ? { lastUnexpected: unexpected } : {}),
        order,
        polls: next,
        selectedId,
        pending,
        renamingId: prev.renamingId !== null && prev.renamingId in next ? prev.renamingId : null,
        ready: true,
      });
    }

    return {
      ...initialState,

      applySnapshot: applyList,
      applyPollListChanged: (evt) => applyList(evt.polls),

      applyPollStateChanged(evt) {
        const entry = get().polls[evt.pollId];
        if (!entry) return;
        const before = entry.status;
        const data = reducePollStateChanged(
          {
            state: before.state,
            consecutiveFailures: before.consecutiveFailures,
            exceptionCode: before.exceptionCode,
            badResponse: badResponseOf(before),
            since: before.at,
            lastUnexpected: null,
          },
          evt,
        );
        if (data.lastUnexpected) {
          warn(
            `Unexpected poll transition ${data.lastUnexpected.from} -> ${data.lastUnexpected.to}`,
          );
        }
        const unchanged =
          before.state === data.state &&
          before.consecutiveFailures === data.consecutiveFailures &&
          before.exceptionCode === data.exceptionCode &&
          before.badResponseKind === (data.badResponse?.kind ?? null) &&
          before.badResponseDetail === (data.badResponse?.detail ?? null);
        if (unchanged) return;
        set((s) => ({
          polls: {
            ...s.polls,
            [evt.pollId]: {
              ...entry,
              status: {
                ...before,
                state: data.state,
                consecutiveFailures: data.consecutiveFailures,
                exceptionCode: data.exceptionCode,
                badResponseKind: data.badResponse?.kind ?? null,
                badResponseDetail: data.badResponse?.detail ?? null,
                at: evt.at,
              },
            },
          },
        }));
      },

      applyCounters(evt) {
        const current = get().polls;
        let next: Record<PollId, PollSummary> | null = null;
        for (const incoming of evt.polls) {
          const entry = (next ?? current)[incoming.pollId];
          if (
            !entry ||
            (sameCounters(entry.counters.counters, incoming.counters) &&
              entry.counters.effectiveScanMs === incoming.effectiveScanMs &&
              entry.counters.lastOkAt === incoming.lastOkAt)
          ) {
            continue;
          }
          next ??= { ...current };
          next[incoming.pollId] = { ...entry, counters: incoming };
        }
        if (next) set({ polls: next });
      },

      select(id) {
        set({ selectedId: id });
      },

      async add() {
        if (deps.canChangeDefinitions?.() === false) return null;
        const s = get();
        if (s.order.length >= MAX_POLLS) {
          toasts.getState().show(MAX_POLLS_MESSAGE);
          return null;
        }
        if (s.adding) return null;
        const name = nextPollName(namesInOrder(s.order, s.polls));
        set({ adding: true });
        try {
          const id = await ipc.addPoll(defaultPollInput(name), "workspace" satisfies PollHostKind);
          set({ selectedId: id });
          return id;
        } catch (e) {
          fail(e);
          return null;
        } finally {
          set({ adding: false });
        }
      },

      async duplicate(id) {
        if (deps.canChangeDefinitions?.() === false) return null;
        const s = get();
        if (!(id in s.polls) || s.adding) return null;
        if (s.order.length >= MAX_POLLS) {
          toasts.getState().show(MAX_POLLS_MESSAGE);
          return null;
        }
        set({ adding: true });
        try {
          const copy = await ipc.duplicatePoll(id);
          set({ selectedId: copy });
          return copy;
        } catch (e) {
          fail(e);
          return null;
        } finally {
          set({ adding: false });
        }
      },

      async rename(id, name) {
        const s = get();
        const entry = s.polls[id];
        if (!entry) return null;
        const others = s.order
          .filter((x) => x !== id)
          .flatMap((x) => s.polls[x]?.config.name ?? []);
        const problem = pollNameError(name, others);
        if (problem) return problem;
        if (name === entry.config.name) {
          set({ renamingId: null });
          return null;
        }
        let message: string | null = null;
        setPending(id, "rename");
        try {
          await ipc.renamePoll(id, name);
          set({ renamingId: null });
        } catch (e) {
          const error = toIpcError(e);
          // A message about the name is shown under the field, the others as a toast.
          if (error.field === "name") message = error.message;
          else fail(e);
        } finally {
          setPending(id, null);
        }
        return message;
      },

      async remove(id) {
        if (!(id in get().polls)) return;
        await withPending(id, "remove", () => ipc.removePoll(id));
      },

      async setActive(id, active) {
        if (!(id in get().polls)) return;
        await withPending(id, "active", () => ipc.setPollActive(id, active));
      },

      async setAllActive(active) {
        try {
          await ipc.setAllPollsActive(active);
        } catch (e) {
          fail(e);
        }
      },

      async reorder(fromIndex, toIndex) {
        const before = get().order;
        if (
          fromIndex === toIndex ||
          fromIndex < 0 ||
          fromIndex >= before.length ||
          toIndex < 0 ||
          toIndex >= before.length
        ) {
          return;
        }
        await get().setOrder(reorder(before, fromIndex, toIndex), before[fromIndex]);
      },

      async setOrder(order, movedId) {
        if (deps.canChangeDefinitions?.() === false) return false;
        const before = get().order;
        const known = new Set(before);
        if (
          order.length !== before.length ||
          !order.every((id) => known.has(id)) ||
          order.every((id, i) => id === before[i])
        ) {
          return false;
        }
        const optimistic = [...order];
        const moved = movedId ?? optimistic.find((id, i) => id !== before[i]);
        set({ order: optimistic });
        if (moved !== undefined) setPending(moved, "reorder");
        try {
          await ipc.reorderPolls(optimistic);
          confirmedOrder = optimistic;
          return true;
        } catch (e) {
          // Roll back to the last order Rust accepted (not to the optimistic order of an earlier,
          // possibly rejected reorder), unless a list event already replaced the order.
          if (get().order === optimistic) set({ order: confirmedOrder });
          fail(e);
          return false;
        } finally {
          if (moved !== undefined) setPending(moved, null);
        }
      },

      async moveUp(id) {
        const index = get().order.indexOf(id);
        if (index > 0) await get().reorder(index, index - 1);
      },

      async moveDown(id) {
        const { order } = get();
        const index = order.indexOf(id);
        if (index !== -1 && index < order.length - 1) await get().reorder(index, index + 1);
      },

      startRename(id) {
        if (id in get().polls) set({ renamingId: id, selectedId: id });
      },

      cancelRename() {
        set({ renamingId: null });
      },
    };
  });
}

// ---- typed selectors and derived values ----
export const selectPollOrder = (s: PollListStore) => s.order;
export const selectSelectedPollId = (s: PollListStore) => s.selectedId;
export const selectCanAddPoll = (s: PollListStore) => s.order.length < MAX_POLLS;
export const selectPollCount = (s: PollListStore) => s.order.length;
export const selectAdding = (s: PollListStore) => s.adding;
export const selectRenamingId = (s: PollListStore) => s.renamingId;
export const selectPollEntry = (id: PollId) => (s: PollListStore) => s.polls[id];
// ---- per-poll selectors with stable results ----
// The counters event replaces a poll's summary ten times a second, but not its config or status.
// Rows, rail icons and minimized pills select these slices, so a counters update does not render
// them (REV-006 m-9).
export const selectPollConfig = (id: PollId) => (s: PollListStore) => s.polls[id]?.config;
export const selectPollStatus = (id: PollId) => (s: PollListStore) => s.polls[id]?.status;
export const selectPollHostState = (id: PollId) => (s: PollListStore) => {
  const p = s.polls[id];
  return p ? hostStateOf(p) : undefined;
};
/** True once the poll has had a valid reply of its current definition. */
export const selectPollHasData = (id: PollId) => (s: PollListStore) =>
  (s.polls[id]?.counters.lastOkAt ?? null) !== null;
export const selectPollLastHost = (id: PollId) => (s: PollListStore) => s.polls[id]?.host;

export const selectAnyRunning = (s: PollListStore) =>
  s.order.some((id) => {
    const state = s.polls[id]?.status.state;
    return (
      state === "polling" || state === "timeout" || state === "exception" || state === "badResponse"
    );
  });
export const selectAnyPaused = (s: PollListStore) =>
  s.order.some((id) => s.polls[id]?.status.state === "paused");
/** Open polls that are shown in their own windows. */
export const selectNativeCount = (s: PollListStore) =>
  s.order.filter((id) => {
    const p = s.polls[id];
    return p?.host === "native" && p.open;
  }).length;
export const selectHostState =
  (id: PollId) =>
  (s: PollListStore): PollHostState | null => {
    const p = s.polls[id];
    return p ? hostStateOf(p) : null;
  };

/** Pure derivations for components (call inside `useMemo` or `useShallow`). */
export function unappliedNames(s: PollListState): string[] {
  return s.order.flatMap((id) => {
    const p = s.polls[id];
    return p?.hasUnappliedEdits ? [p.config.name] : [];
  });
}
export function pollSummaryOf(s: PollListState) {
  return pollSummary(s.order.flatMap((id) => s.polls[id]?.status ?? []));
}
export function pollNames(s: PollListState): string[] {
  return namesInOrder(s.order, s.polls);
}
