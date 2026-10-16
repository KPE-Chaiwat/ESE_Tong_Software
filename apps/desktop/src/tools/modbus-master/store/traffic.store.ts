import { createStore, type StoreApi } from "zustand/vanilla";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import { toIpcError } from "@/shared/ipc/modbus-master";
import type { Counters, TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { RingBuffer } from "../lib/ring-buffer";
import { TRAFFIC_CAPACITY } from "./traffic.logic";

export const ZERO_COUNTERS: Counters = { requests: 0, responses: 0, errors: 0, timeouts: 0 };

export interface TrafficData {
  /**
   * Mutable ring buffer. It is appended to in place and never copied: read it through `version`
   * (a selector on `version` re-renders once per batch).
   */
  frames: RingBuffer<TrafficFrame>;
  /** Increments once per append batch and on clear. */
  version: number;
  counters: Counters;
  autoScroll: boolean;
  selectedSeq: number | null;
  /** Time of the last Clear, for the "Log cleared at {time}" text. */
  clearedAt: number | null;
  /** Text of the last failed Reset counters command. */
  error: string | null;
}

export interface TrafficActions {
  appendFrames(frames: readonly TrafficFrame[]): void;
  setCounters(c: Counters): void;
  /** Clears the frames only. The counters are kept. */
  clear(): void;
  resetCounters(): Promise<void>;
  clearError(): void;
  setAutoScroll(on: boolean): void;
  /** Selecting a frame that is not in the log resets the selection to null. */
  select(seq: number | null): void;
  /** Index (0 = oldest) of the frame with this sequence number, or -1. */
  indexOfSeq(seq: number): number;
}

export type TrafficStore = TrafficData & TrafficActions;
export type TrafficStoreApi = StoreApi<TrafficStore>;

export interface TrafficStoreDeps {
  ipc: ModbusMasterIpc;
  capacity?: number;
  now?: () => number;
}

export function createTrafficStore(deps: TrafficStoreDeps): TrafficStoreApi {
  const now = deps.now ?? Date.now;
  return createStore<TrafficStore>()((set, get) => {
    const indexOfSeq = (seq: number): number => {
      const { frames } = get();
      let lo = 0;
      let hi = frames.size - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const value = frames.get(mid)?.seq ?? 0;
        if (value === seq) return mid;
        if (value < seq) lo = mid + 1;
        else hi = mid - 1;
      }
      return -1;
    };

    return {
      frames: new RingBuffer<TrafficFrame>(deps.capacity ?? TRAFFIC_CAPACITY),
      version: 0,
      counters: ZERO_COUNTERS,
      autoScroll: true,
      selectedSeq: null,
      clearedAt: null,
      error: null,

      indexOfSeq,

      appendFrames(batch) {
        if (batch.length === 0) return;
        const { frames, selectedSeq } = get();
        frames.pushMany(batch);
        const selectionDropped = selectedSeq !== null && indexOfSeq(selectedSeq) === -1;
        set((s) => ({
          version: s.version + 1,
          selectedSeq: selectionDropped ? null : s.selectedSeq,
          clearedAt: null,
        }));
      },

      setCounters: (counters) => set({ counters }),

      clear() {
        get().frames.clear();
        set((s) => ({ version: s.version + 1, selectedSeq: null, clearedAt: now() }));
      },

      async resetCounters() {
        try {
          await deps.ipc.resetCounters();
          set({ counters: ZERO_COUNTERS, error: null });
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

export const selectVersion = (s: TrafficStore) => s.version;
export const selectCounters = (s: TrafficStore) => s.counters;
export const selectAutoScroll = (s: TrafficStore) => s.autoScroll;
export const selectSelectedSeq = (s: TrafficStore) => s.selectedSeq;
export const selectClearedAt = (s: TrafficStore) => s.clearedAt;
