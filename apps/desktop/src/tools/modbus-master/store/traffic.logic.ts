import { exceptionName, formatExceptionCode } from "../lib/exceptions";
import { formatHexBytes, formatTime } from "../lib/format";
import { padFunction } from "../lib/functions";

/**
 * What the text helpers read from a traffic frame (the generated `TrafficFrame` fits).
 */
export interface FrameLike {
  at: number;
  direction: "tx" | "rx";
  bytes: readonly number[];
  slaveId: number | null;
  function: number | null;
  exceptionCode: number | null;
  note: string | null;
}

/** Frames kept in the log (REQ-001: the last 5,000). */
export const TRAFFIC_CAPACITY = 5000;

/** `Exception 02 Illegal data address` for exception frames, else the backend note or `FC03 slave 1`. */
export function frameInfo(frame: FrameLike): string {
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

export const directionLabel = (f: FrameLike) => (f.direction === "tx" ? "TX" : "RX");

/** One line per frame: `{HH:MM:SS.mmm}\t{TX|RX}\t{hex bytes}\t{info}` (DES-001 5.2). */
export function framesToTsv(frames: readonly FrameLike[]): string {
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

// ---------------------------------------------------------------------------------------------
// Multi-poll traffic (DES-002 2.2.5, FE-002 task 10)
// ---------------------------------------------------------------------------------------------

/** What the Filter select shows: every frame, the writes, or the frames of one poll. */
export type TrafficFilter = { kind: "all" } | { kind: "writes" } | { kind: "poll"; pollId: number };

export const ALL_POLLS_FILTER: TrafficFilter = { kind: "all" };
export const ALL_POLLS_LABEL = "All polls";
export const WRITES_LABEL = "Writes";

export function sameFilter(a: TrafficFilter, b: TrafficFilter): boolean {
  return a.kind === b.kind && (a.kind !== "poll" || (b.kind === "poll" && a.pollId === b.pollId));
}

export function filterKey(f: TrafficFilter): string {
  return f.kind === "poll" ? `poll:${f.pollId}` : f.kind;
}

/** Who caused a frame, as the traffic source sends it. */
export type FrameOrigin =
  | { kind: "poll"; pollId: number }
  | { kind: "write"; pollId: number | null };

/** The poll filter shows the polls' own frames; the Writes filter shows every write. */
export function frameMatchesFilter(
  frame: { origin: FrameOrigin | null },
  filter: TrafficFilter,
): boolean {
  const origin = frame.origin;
  switch (filter.kind) {
    case "all":
      return true;
    // A frame without an origin (late, discarded or unsolicited bytes) belongs to no filter.
    case "writes":
      return origin !== null && origin.kind === "write";
    case "poll":
      return origin !== null && origin.kind === "poll" && origin.pollId === filter.pollId;
  }
}

/** One entry of the Filter select. */
export interface FilterEntry {
  filter: TrafficFilter;
  label: string;
}

/** "All polls", "Writes", then one entry per poll in list order (DES-002 2.2.5). */
export function filterEntries(
  order: readonly number[],
  names: Readonly<Record<number, string>>,
): FilterEntry[] {
  return [
    { filter: ALL_POLLS_FILTER, label: ALL_POLLS_LABEL },
    { filter: { kind: "writes" }, label: WRITES_LABEL },
    ...order.map((pollId) => ({
      filter: { kind: "poll", pollId } as TrafficFilter,
      label: names[pollId] ?? `Poll ${pollId}`,
    })),
  ];
}

export function filterLabel(
  filter: TrafficFilter,
  names: Readonly<Record<number, string>>,
): string {
  switch (filter.kind) {
    case "all":
      return ALL_POLLS_LABEL;
    case "writes":
      return WRITES_LABEL;
    case "poll":
      return names[filter.pollId] ?? `Poll ${filter.pollId}`;
  }
}

/**
 * The Poll column: "Poll 3", "Write: Poll 3", "Write" (a write that no poll started) or empty for
 * a frame without an origin.
 */
export function frameOriginLabel(
  origin: FrameOrigin | null,
  names: Readonly<Record<number, string>>,
): string {
  if (origin === null) return "";
  if (origin.kind === "poll") return names[origin.pollId] ?? `Poll ${origin.pollId}`;
  return origin.pollId === null
    ? "Write"
    : `Write: ${names[origin.pollId] ?? `Poll ${origin.pollId}`}`;
}

/** The empty text of the list: "No frames for {filter} yet." (DES-002 2.2.5) or the DES-001 texts. */
export function trafficEmptyText(
  filter: TrafficFilter,
  names: Readonly<Record<number, string>>,
  clearedAt: number | null,
): string {
  if (filter.kind !== "all") return `No frames for ${filterLabel(filter, names)} yet.`;
  return clearedAt === null
    ? "No frames yet. Requests and responses appear here."
    : `Log cleared at ${formatTime(clearedAt)}. New frames appear here.`;
}

/**
 * Like `framesToTsv` with the Poll column at the end: time, TX or RX, hex bytes, info and the
 * poll, separated by tabs, one frame per line.
 */
export function framesToTsvWithPoll(
  frames: ReadonlyArray<FrameLike & { origin: FrameOrigin | null }>,
  names: Readonly<Record<number, string>>,
): string {
  const TAB = String.fromCharCode(9);
  const LF = String.fromCharCode(10);
  return frames
    .map((f) =>
      [
        formatTime(f.at),
        directionLabel(f),
        formatHexBytes(f.bytes),
        frameInfo(f),
        frameOriginLabel(f.origin, names),
      ].join(TAB),
    )
    .join(LF);
}
