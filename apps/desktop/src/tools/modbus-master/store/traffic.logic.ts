import type { TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { exceptionName, formatExceptionCode } from "../lib/exceptions";
import { formatHexBytes, formatTime } from "../lib/format";
import { padFunction } from "../lib/functions";

/** Frames kept in the log (REQ-001: the last 5,000). */
export const TRAFFIC_CAPACITY = 5000;

/** `Exception 02 Illegal data address` for exception frames, else the backend note or `FC03 slave 1`. */
export function frameInfo(frame: TrafficFrame): string {
  if (frame.exceptionCode !== null) {
    return `Exception ${formatExceptionCode(frame.exceptionCode)} ${exceptionName(frame.exceptionCode)}`;
  }
  const base =
    frame.function === null
      ? ""
      : `FC${padFunction(frame.function)}${frame.slaveId === null ? "" : ` slave ${frame.slaveId}`}`;
  if (frame.note) return base ? `${base} ${frame.note}` : frame.note;
  return base;
}

export const directionLabel = (f: TrafficFrame) => (f.direction === "tx" ? "TX" : "RX");

/** One line per frame: `{HH:MM:SS.mmm}\t{TX|RX}\t{hex bytes}\t{info}` (DES-001 5.2). */
export function framesToTsv(frames: readonly TrafficFrame[]): string {
  return frames
    .map(
      (f) =>
        `${formatTime(f.at)}\t${directionLabel(f)}\t${formatHexBytes(f.bytes)}\t${frameInfo(f)}`,
    )
    .join("\n");
}

export type FrameScheduler = (callback: () => void) => () => void;

/** requestAnimationFrame when available, else a 16 ms timer (tests and non-browser hosts). */
export const animationFrameScheduler: FrameScheduler = (callback) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
};

export interface Batcher<T> {
  push(items: readonly T[]): void;
  /** Delivers what is queued right now. */
  flush(): void;
  dispose(): void;
}

/**
 * Coalesces everything pushed within one animation frame into a single call of `deliver`
 * (DES-001 section 8: one store write per frame).
 */
export function createBatcher<T>(
  deliver: (items: T[]) => void,
  schedule: FrameScheduler = animationFrameScheduler,
  /**
   * Most items kept while waiting for a frame. Browsers do not run animation frames for a hidden
   * or minimized window, so the queue must not grow for hours (REV-002 M6). The oldest are dropped.
   */
  maxQueue = Number.POSITIVE_INFINITY,
): Batcher<T> {
  let queue: T[] = [];
  let cancel: (() => void) | null = null;
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    cancel = null;
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    deliver(items);
  };

  return {
    push(items) {
      if (items.length === 0) return;
      for (const item of items) queue.push(item);
      if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
      if (!scheduled) {
        scheduled = true;
        const handle = schedule(flush);
        // A scheduler that runs the callback synchronously has already flushed.
        if (scheduled) cancel = handle;
      }
    },
    flush() {
      cancel?.();
      flush();
    },
    dispose() {
      cancel?.();
      cancel = null;
      scheduled = false;
      queue = [];
    },
  };
}
