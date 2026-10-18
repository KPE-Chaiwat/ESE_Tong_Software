// The traffic of one connection (DES-002 2.2.5, FE-002 task 10): the last 5,000 frames of every
// poll and every write, the counters (total, writes, per poll), and the filter. One store in the
// connection window, filled from the session channel. Frames are appended to a ring buffer in
// batches (one store write per animation frame); readers use `version` as the change signal.
import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type {
  ConnectionCounters,
  Counters,
  PollId,
  TrafficFrame,
} from "@/shared/ipc/modbus-master.types";
import { RingBuffer } from "../lib/ring-buffer";
import {
  ALL_POLLS_FILTER,
  filterEntries,
  filterKey,
  frameMatchesFilter,
  sameFilter,
  TRAFFIC_CAPACITY,
  type TrafficFilter,
} from "./traffic.logic";

export const ZERO_COUNTER_SET: Counters = { requests: 0, responses: 0, errors: 0, timeouts: 0 };

export interface TrafficCounters {
  total: Counters;
  writes: Counters;
  polls: Record<PollId, Counters>;
  /** 0-100 (DES-002 2.2.5). */
  linkLoadPct: number;
}

export const ZERO_TRAFFIC_COUNTERS: TrafficCounters = {
  total: ZERO_COUNTER_SET,
  writes: ZERO_COUNTER_SET,
  polls: {},
  linkLoadPct: 0,
};

export interface TrafficState {
  /**
   * Mutable ring buffer. It is appended to in place and never copied: read it through `version`
   * (a selector on `version` re-renders once per batch).
   */
  frames: RingBuffer<TrafficFrame>;
  /** Increments once per append batch and on clear. */
  version: number;
  counters: TrafficCounters;
  filter: TrafficFilter;
  /** Poll ids in list order, with their names (for the Filter select and the Poll column). */
  pollOrder: PollId[];
  pollNames: Record<PollId, string>;
  autoScroll: boolean;
  selectedSeq: number | null;
  /** Time of the last Clear, for the "Log cleared at {time}" text. */
  clearedAt: number | null;
  /** Text of the last failed Reset counters command. */
  error: string | null;
  /**
   * A pending request to move the keyboard focus into the panel: "filter" after "Show traffic for
   * this poll" came from a native window (DES-002 2.2.5). The panel consumes it once.
   */
  focusRequest: "filter" | null;
}

/** The frames that pass the filter, as an accessor (the ring buffer is not copied for "all"). */
export interface VisibleFrames {
  size: number;
  get(index: number): TrafficFrame | undefined;
}

export interface TrafficActions {
  appendFrames(frames: readonly TrafficFrame[]): void;
  /** The `Counters` event (total, writes, per poll, link load). */
  setCounters(c: Pick<ConnectionCounters, "total" | "writes" | "polls" | "linkLoadPct">): void;
  /**
   * The poll list changed: the Filter select follows the list order and the new names. A poll
   * filter for a poll that is gone switches to "All polls" (CHK2-K6).
   */
  setPollOrder(order: readonly PollId[], names: Readonly<Record<PollId, string>>): void;
  setFilter(filter: TrafficFilter): void;
  /** Asks the panel to focus its Filter select; it waits while a modal is open. */
  requestFilterFocus(): void;
  /** The panel took the request. */
  clearFocusRequest(): void;
  /** Clears the frames only. The counters are kept. */
  clear(): void;
  /** Resets the counters of the filtered poll, or of the whole connection. */
  resetCounters(): Promise<void>;
  clearError(): void;
  setAutoScroll(on: boolean): void;
  /** Selecting a frame that is not visible resets the selection to null. */
  select(seq: number | null): void;
  /** Index (0 = oldest) of the frame with this sequence number in the visible frames, or -1. */
  indexOfSeq(seq: number): number;
  /** The visible frames: all of them, or the ones that pass the filter. */
  visible(): VisibleFrames;
}

export type TrafficStore = TrafficState & TrafficActions;
export type TrafficStoreApi = StoreApi<TrafficStore>;

export interface TrafficStoreDeps {
  ipc: Pick<ModbusMasterIpc, "resetCounters">;
  capacity?: number;
  now?: () => number;
}

export function createTrafficStore(deps: TrafficStoreDeps): TrafficStoreApi {
  const now = deps.now ?? Date.now;
  // The filtered frames are rebuilt when a batch arrives or the filter changes, not on every read.
  let cache: { version: number; key: string; frames: TrafficFrame[] } | null = null;

  return createStore<TrafficStore>()((set, get) => {
    const visible = (): VisibleFrames => {
      const { frames, filter, version } = get();
      if (filter.kind === "all") return { size: frames.size, get: (i) => frames.get(i) };
      const key = filterKey(filter);
      if (!cache || cache.version !== version || cache.key !== key) {
        cache = {
          version,
          key,
          frames: frames.toArray().filter((f) => frameMatchesFilter(f, filter)),
        };
      }
      const list = cache.frames;
      return { size: list.length, get: (i) => list[i] };
    };

    const indexOfSeq = (seq: number): number => {
      const view = visible();
      let lo = 0;
      let hi = view.size - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const value = view.get(mid)?.seq ?? 0;
        if (value === seq) return mid;
        if (value < seq) lo = mid + 1;
        else hi = mid - 1;
      }
      return -1;
    };

    return {
      frames: new RingBuffer<TrafficFrame>(deps.capacity ?? TRAFFIC_CAPACITY),
      version: 0,
      counters: ZERO_TRAFFIC_COUNTERS,
      filter: ALL_POLLS_FILTER,
      pollOrder: [],
      pollNames: {},
      autoScroll: true,
      selectedSeq: null,
      clearedAt: null,
      error: null,
      focusRequest: null,

      indexOfSeq,
      visible,

      appendFrames(batch) {
        if (batch.length === 0) return;
        get().frames.pushMany(batch);
        set((s) => ({ version: s.version + 1, clearedAt: null }));
        // The selected frame may have left the ring (the oldest frames are dropped).
        const { selectedSeq } = get();
        if (selectedSeq !== null && indexOfSeq(selectedSeq) === -1) set({ selectedSeq: null });
      },

      setCounters(c) {
        set({
          counters: {
            total: c.total,
            writes: c.writes,
            polls: toPollMap(c.polls),
            linkLoadPct: c.linkLoadPct,
          },
        });
      },

      setPollOrder(order, names) {
        const { filter } = get();
        const gone = filter.kind === "poll" && !order.includes(filter.pollId);
        set({
          pollOrder: [...order],
          pollNames: { ...names },
          ...(gone ? { filter: ALL_POLLS_FILTER, selectedSeq: null } : {}),
        });
      },

      requestFilterFocus: () => set({ focusRequest: "filter" }),
      clearFocusRequest: () => {
        if (get().focusRequest !== null) set({ focusRequest: null });
      },

      setFilter(filter) {
        const s = get();
        if (sameFilter(filter, s.filter)) return;
        if (filter.kind === "poll" && !s.pollOrder.includes(filter.pollId)) return;
        set({ filter });
        // A selection that is not visible under the new filter is dropped.
        const { selectedSeq } = get();
        if (selectedSeq !== null && indexOfSeq(selectedSeq) === -1) set({ selectedSeq: null });
      },

      clear() {
        get().frames.clear();
        set((s) => ({ version: s.version + 1, selectedSeq: null, clearedAt: now() }));
      },

      async resetCounters() {
        const { filter } = get();
        const pollId = filter.kind === "poll" ? filter.pollId : null;
        try {
          await deps.ipc.resetCounters(pollId);
          set({ error: null });
        } catch (e) {
          set({ error: toIpcError(e).message });
        }
      },

      clearError: () => set({ error: null }),

      setAutoScroll: (autoScroll) => set({ autoScroll }),

      select(seq) {
        set({ selectedSeq: seq !== null && indexOfSeq(seq) !== -1 ? seq : null });
      },
    };
  });
}

function toPollMap(polls: ConnectionCounters["polls"]): Record<PollId, Counters> {
  const map: Record<PollId, Counters> = {};
  for (const { pollId, counters } of polls) map[pollId] = counters;
  return map;
}

/** The counters of the current filter: total, writes, or the poll's own. */
export function filteredCounters(s: Pick<TrafficState, "counters" | "filter">): Counters {
  switch (s.filter.kind) {
    case "all":
      return s.counters.total;
    case "writes":
      return s.counters.writes;
    case "poll":
      return s.counters.polls[s.filter.pollId] ?? ZERO_COUNTER_SET;
  }
}

/** The entries of the Filter select, in list order. */
export function trafficFilterEntries(s: Pick<TrafficState, "pollOrder" | "pollNames">) {
  return filterEntries(s.pollOrder, s.pollNames);
}

export const selectTrafficVersion = (s: TrafficStore) => s.version;
export const selectTrafficFilter = (s: TrafficStore) => s.filter;
export const selectFilteredCounters = (s: TrafficStore) => filteredCounters(s);
export const selectLinkLoadPct = (s: TrafficStore) => s.counters.linkLoadPct;
export const selectTrafficAutoScroll = (s: TrafficStore) => s.autoScroll;
export const selectTrafficSelectedSeq = (s: TrafficStore) => s.selectedSeq;
export const selectTrafficClearedAt = (s: TrafficStore) => s.clearedAt;
