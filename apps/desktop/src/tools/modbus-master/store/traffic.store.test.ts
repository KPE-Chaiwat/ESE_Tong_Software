import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import type {
  Counters,
  PollId,
  TrafficFrame,
  TrafficOrigin,
} from "@/shared/ipc/modbus-master.types";
import {
  createTrafficStore,
  filteredCounters,
  selectFilteredCounters,
  type TrafficStoreApi,
  trafficFilterEntries,
  ZERO_COUNTER_SET,
} from "./traffic.store";

let ipc: FakeModbusMasterIpc;
let store: TrafficStoreApi;
let seq = 0;

function frame(origin: TrafficOrigin, patch: Partial<TrafficFrame> = {}): TrafficFrame {
  seq += 1;
  return {
    seq,
    at: 1_700_000_000_000 + seq,
    direction: "tx",
    bytes: [0, 1],
    slaveId: 1,
    function: 3,
    exceptionCode: null,
    note: null,
    origin,
    ...patch,
  };
}
const poll = (pollId: PollId): TrafficOrigin => ({ kind: "poll", pollId });
const write = (pollId: PollId | null = null): TrafficOrigin => ({ kind: "write", pollId });
const set = (requests: number): Counters => ({
  requests,
  responses: requests,
  errors: 0,
  timeouts: 0,
});

beforeEach(() => {
  seq = 0;
  ipc = createFakeModbusMasterIpc();
  store = createTrafficStore({ ipc, capacity: 5000, now: () => 1234 });
  store.getState().setPollOrder([1, 2, 3], { 1: "Poll 1", 2: "Poll 2", 3: "Poll 3" });
});

const seqs = (v: { size: number; get(i: number): TrafficFrame | undefined }) =>
  Array.from({ length: v.size }, (_, i) => v.get(i)?.seq);

describe("initial state", () => {
  it("is empty with the All polls filter", () => {
    const fresh = createTrafficStore({ ipc });
    expect(fresh.getState()).toMatchObject({
      version: 0,
      filter: { kind: "all" },
      pollOrder: [],
      autoScroll: true,
      selectedSeq: null,
      clearedAt: null,
      error: null,
      focusRequest: null,
      counters: { total: ZERO_COUNTER_SET, writes: ZERO_COUNTER_SET, polls: {}, linkLoadPct: 0 },
    });
    expect(fresh.getState().frames.size).toBe(0);
    expect(fresh.getState().visible().size).toBe(0);
  });
});

describe("appendFrames", () => {
  it("appends in batches and bumps the version once per batch", () => {
    store.getState().appendFrames([frame(poll(1)), frame(poll(2))]);
    store.getState().appendFrames([frame(poll(1))]);
    store.getState().appendFrames([]);
    expect(store.getState().frames.size).toBe(3);
    expect(store.getState().version).toBe(2);
  });

  it("keeps 5,000 frames and drops the oldest", () => {
    const frames = Array.from({ length: 5001 }, () => frame(poll(1)));
    store.getState().appendFrames(frames);
    expect(store.getState().frames.size).toBe(5000);
    expect(store.getState().frames.first()?.seq).toBe(2);
  });

  it("selecting a frame that was dropped resets the selection", () => {
    store.getState().appendFrames([frame(poll(1))]);
    store.getState().select(1);
    expect(store.getState().selectedSeq).toBe(1);
    store.getState().appendFrames(Array.from({ length: 5000 }, () => frame(poll(1))));
    expect(store.getState().selectedSeq).toBeNull();
  });

  it("an append clears the 'Log cleared' time", () => {
    store.getState().clear();
    expect(store.getState().clearedAt).toBe(1234);
    store.getState().appendFrames([frame(poll(1))]);
    expect(store.getState().clearedAt).toBeNull();
  });
});

describe("focus request (DES-002 2.2.5)", () => {
  it("requestFilterFocus sets it, clearFocusRequest consumes it, clearing twice is harmless", () => {
    store.getState().requestFilterFocus();
    expect(store.getState().focusRequest).toBe("filter");
    store.getState().clearFocusRequest();
    expect(store.getState().focusRequest).toBeNull();
    store.getState().clearFocusRequest();
    expect(store.getState().focusRequest).toBeNull();
  });

  it("a filter change does not touch it", () => {
    store.getState().requestFilterFocus();
    store.getState().setFilter({ kind: "poll", pollId: 2 });
    expect(store.getState().focusRequest).toBe("filter");
  });
});

describe("filter", () => {
  beforeEach(() => {
    store
      .getState()
      .appendFrames([
        frame(poll(1)),
        frame(poll(2)),
        frame(write(1)),
        frame(poll(1)),
        frame(write(null)),
        frame(poll(3)),
      ]);
  });

  it("All polls shows every frame", () => {
    expect(seqs(store.getState().visible())).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("a poll filter shows only the frames of that poll, not its writes", () => {
    store.getState().setFilter({ kind: "poll", pollId: 1 });
    expect(seqs(store.getState().visible())).toEqual([1, 4]);
  });

  it("a frame without an origin shows only under All polls", () => {
    store.getState().appendFrames([{ ...frame(poll(1)), origin: null }]);
    expect(seqs(store.getState().visible())).toEqual([1, 2, 3, 4, 5, 6, 7]);
    store.getState().setFilter({ kind: "writes" });
    expect(seqs(store.getState().visible())).toEqual([3, 5]);
    store.getState().setFilter({ kind: "poll", pollId: 1 });
    expect(seqs(store.getState().visible())).toEqual([1, 4]);
  });

  it("Writes shows only writes", () => {
    store.getState().setFilter({ kind: "writes" });
    expect(seqs(store.getState().visible())).toEqual([3, 5]);
  });

  it("the visible frames follow new batches", () => {
    store.getState().setFilter({ kind: "poll", pollId: 2 });
    store.getState().appendFrames([frame(poll(2)), frame(poll(1))]);
    expect(seqs(store.getState().visible())).toEqual([2, 7]);
  });

  it("an unchanged version reuses the filtered list", () => {
    store.getState().setFilter({ kind: "poll", pollId: 1 });
    const a = store.getState().visible();
    const b = store.getState().visible();
    expect(a.size).toBe(b.size);
    expect(a.get(0)).toBe(b.get(0));
  });

  it("indexOfSeq counts in the visible frames", () => {
    store.getState().setFilter({ kind: "poll", pollId: 1 });
    expect(store.getState().indexOfSeq(4)).toBe(1);
    expect(store.getState().indexOfSeq(2)).toBe(-1);
  });

  it("changing the filter drops a selection that is not visible any more", () => {
    store.getState().select(2);
    store.getState().setFilter({ kind: "poll", pollId: 1 });
    expect(store.getState().selectedSeq).toBeNull();
    store.getState().select(4);
    store.getState().setFilter({ kind: "all" });
    expect(store.getState().selectedSeq).toBe(4);
  });

  it("a filter for an unknown poll is refused; the same filter is a no-op", () => {
    store.getState().setFilter({ kind: "poll", pollId: 99 });
    expect(store.getState().filter).toEqual({ kind: "all" });
    store.getState().setFilter({ kind: "writes" });
    const before = store.getState();
    store.getState().setFilter({ kind: "writes" });
    expect(store.getState()).toBe(before);
  });

  it("selecting a frame that is not visible gives null", () => {
    store.getState().setFilter({ kind: "writes" });
    store.getState().select(1);
    expect(store.getState().selectedSeq).toBeNull();
    store.getState().select(3);
    expect(store.getState().selectedSeq).toBe(3);
    store.getState().select(null);
    expect(store.getState().selectedSeq).toBeNull();
  });
});

describe("counters follow the filter", () => {
  beforeEach(() => {
    store.getState().setCounters({
      total: set(100),
      writes: set(4),
      linkLoadPct: 72,
      polls: [
        { pollId: 1, counters: set(60), effectiveScanMs: null, lastOkAt: null },
        { pollId: 2, counters: set(36), effectiveScanMs: null, lastOkAt: null },
      ],
    });
  });

  it("All polls is the total", () => {
    expect(filteredCounters(store.getState())).toEqual(set(100));
    expect(selectFilteredCounters(store.getState())).toEqual(set(100));
    expect(store.getState().counters.linkLoadPct).toBe(72);
  });

  it("Writes is the write counters, a poll its own", () => {
    store.getState().setFilter({ kind: "writes" });
    expect(filteredCounters(store.getState())).toEqual(set(4));
    store.getState().setFilter({ kind: "poll", pollId: 2 });
    expect(filteredCounters(store.getState())).toEqual(set(36));
    // a poll without counters yet
    store.getState().setFilter({ kind: "poll", pollId: 3 });
    expect(filteredCounters(store.getState())).toEqual(ZERO_COUNTER_SET);
  });

  it("total = the polls + the writes in the fake's accounting", () => {
    const c = store.getState().counters;
    const sum = Object.values(c.polls).reduce((n, p) => n + p.requests, 0);
    expect(sum + c.writes.requests).toBe(c.total.requests);
  });
});

describe("filter entries follow the list order", () => {
  it("All polls, Writes, then the polls in list order", () => {
    expect(trafficFilterEntries(store.getState()).map((e) => e.label)).toEqual([
      "All polls",
      "Writes",
      "Poll 1",
      "Poll 2",
      "Poll 3",
    ]);
  });

  it("after a reorder the entries follow the new order", () => {
    store.getState().setPollOrder([3, 1, 2], { 1: "Poll 1", 2: "Poll 2", 3: "Poll 3" });
    expect(trafficFilterEntries(store.getState()).map((e) => e.label)).toEqual([
      "All polls",
      "Writes",
      "Poll 3",
      "Poll 1",
      "Poll 2",
    ]);
  });

  it("a rename changes the label", () => {
    store.getState().setPollOrder([1, 2, 3], { 1: "Tank", 2: "Poll 2", 3: "Poll 3" });
    expect(trafficFilterEntries(store.getState())[2]?.label).toBe("Tank");
  });

  it("deleting the filtered poll switches the filter to All polls and drops the selection", () => {
    store.getState().appendFrames([frame(poll(2))]);
    store.getState().setFilter({ kind: "poll", pollId: 2 });
    store.getState().select(1);
    store.getState().setPollOrder([1, 3], { 1: "Poll 1", 3: "Poll 3" });
    expect(store.getState().filter).toEqual({ kind: "all" });
    expect(store.getState().selectedSeq).toBeNull();
  });

  it("another filter survives a list change", () => {
    store.getState().setFilter({ kind: "writes" });
    store.getState().setPollOrder([1], { 1: "Poll 1" });
    expect(store.getState().filter).toEqual({ kind: "writes" });
    store.getState().setFilter({ kind: "poll", pollId: 1 });
    store.getState().setPollOrder([1, 2], { 1: "Poll 1", 2: "Poll 2" });
    expect(store.getState().filter).toEqual({ kind: "poll", pollId: 1 });
  });
});

describe("clear, auto-scroll, reset counters", () => {
  it("clear empties the frames, keeps the counters and remembers the time", () => {
    store.getState().setCounters({ total: set(5), writes: set(0), linkLoadPct: 0, polls: [] });
    store.getState().appendFrames([frame(poll(1))]);
    store.getState().select(1);
    store.getState().clear();
    expect(store.getState().frames.size).toBe(0);
    expect(store.getState()).toMatchObject({ selectedSeq: null, clearedAt: 1234 });
    expect(store.getState().counters.total).toEqual(set(5));
    expect(store.getState().version).toBe(2);
  });

  it("auto-scroll", () => {
    store.getState().setAutoScroll(false);
    expect(store.getState().autoScroll).toBe(false);
  });

  it("resetCounters resets the whole connection under All polls and Writes", async () => {
    await store.getState().resetCounters();
    store.getState().setFilter({ kind: "writes" });
    await store.getState().resetCounters();
    expect(ipc.callsOf("resetCounters")).toEqual([[null], [null]]);
  });

  it("resetCounters resets only the filtered poll", async () => {
    store.getState().setFilter({ kind: "poll", pollId: 2 });
    await store.getState().resetCounters();
    expect(ipc.callsOf("resetCounters")).toEqual([[2]]);
  });

  it("a rejected reset keeps its message until cleared", async () => {
    ipc.failNext("resetCounters", new IpcError("nope", "internal"));
    await store.getState().resetCounters();
    expect(store.getState().error).toBe("nope");
    store.getState().clearError();
    expect(store.getState().error).toBeNull();
    await store.getState().resetCounters();
    expect(store.getState().error).toBeNull();
  });
});
