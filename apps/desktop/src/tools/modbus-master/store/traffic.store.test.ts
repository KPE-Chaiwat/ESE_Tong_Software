import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import type { TrafficFrame } from "@/shared/ipc/modbus-master.types";
import {
  createBatcher,
  type FrameScheduler,
  frameInfo,
  framesToTsv,
  TRAFFIC_CAPACITY,
} from "./traffic.logic";
import { createTrafficStore, type TrafficStoreApi } from "./traffic.store";

function frame(seq: number, over: Partial<TrafficFrame> = {}): TrafficFrame {
  return {
    seq,
    at: new Date(2026, 9, 12, 14, 2, 11, 532).getTime(),
    direction: "tx",
    bytes: [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10],
    slaveId: 1,
    function: 3,
    exceptionCode: null,
    note: null,
    ...over,
  };
}

const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => frame(from + i));

let ipc: FakeModbusMasterIpc;
let store: TrafficStoreApi;
const get = () => store.getState();

beforeEach(() => {
  ipc = createFakeModbusMasterIpc();
  store = createTrafficStore({ ipc, now: () => 123456 });
});

describe("initial state", () => {
  it("is empty with zero counters and auto-scroll on", () => {
    expect(get().frames.size).toBe(0);
    expect(get()).toMatchObject({
      version: 0,
      counters: { requests: 0, responses: 0, errors: 0, timeouts: 0 },
      autoScroll: true,
      selectedSeq: null,
      clearedAt: null,
      error: null,
    });
  });
});

describe("appendFrames", () => {
  it("appends in order and bumps the version once per batch", () => {
    get().appendFrames(frames(1, 3));
    expect(
      get()
        .frames.toArray()
        .map((f) => f.seq),
    ).toEqual([1, 2, 3]);
    expect(get().version).toBe(1);
    get().appendFrames(frames(4, 5));
    expect(get().version).toBe(2);
  });

  it("ignores an empty batch", () => {
    get().appendFrames([]);
    expect(get().version).toBe(0);
  });

  it("appending 5,001 frames keeps 5,000 and drops the oldest", () => {
    expect(TRAFFIC_CAPACITY).toBe(5000);
    get().appendFrames(frames(1, 5001));
    expect(get().frames.size).toBe(5000);
    expect(get().frames.first()?.seq).toBe(2);
    expect(get().frames.last()?.seq).toBe(5001);
  });

  it("keeps absolute sequence numbers after dropping", () => {
    get().appendFrames(frames(1, 5010));
    expect(get().frames.get(0)?.seq).toBe(11);
    expect(get().indexOfSeq(11)).toBe(0);
    expect(get().indexOfSeq(5010)).toBe(4999);
    expect(get().indexOfSeq(10)).toBe(-1);
  });

  it("resets the selection when the selected frame is dropped", () => {
    get().appendFrames(frames(1, 5000));
    get().select(1);
    expect(get().selectedSeq).toBe(1);
    get().appendFrames(frames(5001, 5001));
    expect(get().selectedSeq).toBeNull();
  });

  it("keeps the selection while the frame is still in the log", () => {
    get().appendFrames(frames(1, 10));
    get().select(5);
    get().appendFrames(frames(11, 12));
    expect(get().selectedSeq).toBe(5);
  });

  it("the Log cleared text goes away when new frames arrive", () => {
    get().appendFrames(frames(1, 2));
    get().clear();
    expect(get().clearedAt).toBe(123456);
    get().appendFrames(frames(3, 3));
    expect(get().clearedAt).toBeNull();
  });
});

describe("clear", () => {
  it("clears frames and selection but keeps the counters", () => {
    get().setCounters({ requests: 5, responses: 4, errors: 1, timeouts: 0 });
    get().appendFrames(frames(1, 3));
    get().select(2);
    const versionBefore = get().version;
    get().clear();
    expect(get().frames.size).toBe(0);
    expect(get().selectedSeq).toBeNull();
    expect(get().counters).toEqual({ requests: 5, responses: 4, errors: 1, timeouts: 0 });
    expect(get().clearedAt).toBe(123456);
    expect(get().version).toBe(versionBefore + 1);
  });

  it("keeps working after a clear", () => {
    get().appendFrames(frames(1, 3));
    get().clear();
    get().appendFrames(frames(4, 5));
    expect(
      get()
        .frames.toArray()
        .map((f) => f.seq),
    ).toEqual([4, 5]);
  });
});

describe("select", () => {
  it("selects an existing frame and deselects with null", () => {
    get().appendFrames(frames(1, 3));
    get().select(2);
    expect(get().selectedSeq).toBe(2);
    get().select(null);
    expect(get().selectedSeq).toBeNull();
  });

  it("selecting a frame that is not in the log gives null", () => {
    get().appendFrames(frames(10, 12));
    get().select(2);
    expect(get().selectedSeq).toBeNull();
    get().select(99);
    expect(get().selectedSeq).toBeNull();
  });
});

describe("counters", () => {
  it("setCounters replaces the counters", () => {
    get().setCounters({ requests: 1204, responses: 1198, errors: 2, timeouts: 4 });
    expect(get().counters).toEqual({ requests: 1204, responses: 1198, errors: 2, timeouts: 4 });
  });

  it("resetCounters calls the backend and zeroes the counters", async () => {
    get().setCounters({ requests: 3, responses: 3, errors: 0, timeouts: 0 });
    await get().resetCounters();
    expect(ipc.callsOf("resetCounters")).toHaveLength(1);
    expect(get().counters).toEqual({ requests: 0, responses: 0, errors: 0, timeouts: 0 });
  });

  it("resetCounters keeps the counters and records the error when the command fails", async () => {
    get().setCounters({ requests: 3, responses: 3, errors: 0, timeouts: 0 });
    ipc.failNext("resetCounters", "not connected");
    await get().resetCounters();
    expect(get().counters.requests).toBe(3);
    expect(get().error).toBe("not connected");
  });
});

describe("auto-scroll", () => {
  it("can be switched off and on", () => {
    get().setAutoScroll(false);
    expect(get().autoScroll).toBe(false);
    get().setAutoScroll(true);
    expect(get().autoScroll).toBe(true);
  });
});

describe("frameInfo and TSV", () => {
  it("describes an exception frame", () => {
    expect(frameInfo(frame(1, { direction: "rx", exceptionCode: 2 }))).toBe(
      "Exception 02 Illegal data address",
    );
    expect(frameInfo(frame(1, { direction: "rx", exceptionCode: 0x0c }))).toBe(
      "Exception 0C Unknown exception",
    );
  });

  it("describes a normal frame and appends the backend note", () => {
    expect(frameInfo(frame(1))).toBe("FC03 slave 1");
    expect(frameInfo(frame(1, { note: "20 bytes" }))).toBe("FC03 slave 1 20 bytes");
    expect(frameInfo(frame(1, { function: null, slaveId: null, note: "CRC error" }))).toBe(
      "CRC error",
    );
    expect(frameInfo(frame(1, { function: null, slaveId: null }))).toBe("");
  });

  it("formats the Copy text as tab separated lines", () => {
    const text = framesToTsv([
      frame(1),
      frame(2, { direction: "rx", bytes: [0, 1, 0xab], exceptionCode: 2 }),
    ]);
    expect(text).toBe(
      "14:02:11.532\tTX\t00 01 00 00 00 06 01 03 00 00 00 0A\tFC03 slave 1\n" +
        "14:02:11.532\tRX\t00 01 AB\tException 02 Illegal data address",
    );
  });
});

describe("batcher (one store write per animation frame)", () => {
  function manualScheduler() {
    const callbacks: (() => void)[] = [];
    const schedule: FrameScheduler = (cb) => {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i >= 0) callbacks.splice(i, 1);
      };
    };
    return {
      schedule,
      callbacks,
      runFrame: () => {
        for (const cb of callbacks.splice(0)) cb();
      },
    };
  }

  it("coalesces pushes within one frame into one delivery", () => {
    const { schedule, callbacks, runFrame } = manualScheduler();
    const delivered: number[][] = [];
    const batcher = createBatcher<number>((items) => delivered.push(items), schedule);
    batcher.push([1, 2]);
    batcher.push([3]);
    batcher.push([]);
    expect(callbacks).toHaveLength(1);
    expect(delivered).toEqual([]);
    runFrame();
    expect(delivered).toEqual([[1, 2, 3]]);
    batcher.push([4]);
    runFrame();
    expect(delivered).toEqual([[1, 2, 3], [4]]);
  });

  it("flush delivers immediately and cancels the scheduled frame", () => {
    const { schedule, callbacks } = manualScheduler();
    const delivered: number[][] = [];
    const batcher = createBatcher<number>((items) => delivered.push(items), schedule);
    batcher.push([1]);
    batcher.flush();
    expect(delivered).toEqual([[1]]);
    expect(callbacks).toHaveLength(0);
    batcher.flush();
    expect(delivered).toHaveLength(1);
  });

  it("dispose drops what is queued", () => {
    const { schedule, runFrame } = manualScheduler();
    const delivered: number[][] = [];
    const batcher = createBatcher<number>((items) => delivered.push(items), schedule);
    batcher.push([1]);
    batcher.dispose();
    runFrame();
    expect(delivered).toEqual([]);
  });

  it("drives one version bump per frame in the store", () => {
    const { schedule, runFrame } = manualScheduler();
    const batcher = createBatcher<TrafficFrame>((items) => get().appendFrames(items), schedule);
    for (let i = 1; i <= 10; i += 1) batcher.push([frame(i)]);
    expect(get().version).toBe(0);
    runFrame();
    expect(get().version).toBe(1);
    expect(get().frames.size).toBe(10);
  });
});

describe("REV-002 M6: the batcher queue is capped while no frame runs", () => {
  it("keeps only the newest items when animation frames never fire (hidden window)", () => {
    const delivered: number[][] = [];
    // A scheduler that never calls back, like requestAnimationFrame in a hidden document.
    const batcher = createBatcher<number>(
      (items) => delivered.push(items),
      () => () => {},
      5000,
    );
    for (let batch = 0; batch < 100; batch += 1) {
      batcher.push(Array.from({ length: 1000 }, (_, i) => batch * 1000 + i));
    }
    batcher.flush();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toHaveLength(5000);
    expect(delivered[0]?.[0]).toBe(95000);
    expect(delivered[0]?.at(-1)).toBe(99999);
  });

  it("does not drop anything below the cap and keeps the order", () => {
    const delivered: number[][] = [];
    const batcher = createBatcher<number>(
      (items) => delivered.push(items),
      () => () => {},
      10,
    );
    batcher.push([1, 2, 3]);
    batcher.push([4, 5]);
    batcher.flush();
    expect(delivered).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("a single push larger than the cap keeps its newest items", () => {
    const delivered: number[][] = [];
    const batcher = createBatcher<number>(
      (items) => delivered.push(items),
      () => () => {},
      3,
    );
    batcher.push([1, 2, 3, 4, 5]);
    batcher.flush();
    expect(delivered).toEqual([[3, 4, 5]]);
  });

  it("is unbounded by default", () => {
    const delivered: number[][] = [];
    const batcher = createBatcher<number>(
      (items) => delivered.push(items),
      () => () => {},
    );
    batcher.push(Array.from({ length: 20000 }, (_, i) => i));
    batcher.flush();
    expect(delivered[0]).toHaveLength(20000);
  });

  it("the runtime hands the log only the newest 5,000 frames when a frame finally runs", async () => {
    const { createModbusMasterRuntime } = await import("../runtime");
    const { createFakeWindowIpc } = await import("@/shared/ipc/window");
    const fake = createFakeModbusMasterIpc();
    const callbacks: (() => void)[] = [];
    const rt = createModbusMasterRuntime(fake, createFakeWindowIpc(), {
      scheduler: (cb) => {
        callbacks.push(cb);
        return () => {};
      },
      warn: () => {},
    });
    await rt.init();
    for (let batch = 0; batch < 12; batch += 1) {
      fake.emitFrames(Array.from({ length: 1000 }, (_, i) => frame(batch * 1000 + i + 1)));
    }
    expect(rt.stores.traffic.getState().frames.size).toBe(0);
    expect(callbacks).toHaveLength(1);
    callbacks[0]?.();
    expect(rt.stores.traffic.getState().frames.size).toBe(5000);
    expect(rt.stores.traffic.getState().frames.first()?.seq).toBe(7001);
    expect(rt.stores.traffic.getState().frames.last()?.seq).toBe(12000);
    rt.dispose();
  });
});

describe("REV-002 M1: the Reset counters failure is kept for the runtime to show", () => {
  it("clearError empties it", async () => {
    ipc.failNext("resetCounters", "No session");
    await get().resetCounters();
    expect(get().error).toBe("No session");
    get().clearError();
    expect(get().error).toBeNull();
  });
});
