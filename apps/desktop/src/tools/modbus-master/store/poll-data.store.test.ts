import type {
  PollDefinition,
  PollUpdateEvent,
  SessionState,
} from "@/shared/ipc/modbus-master.types";
import { pollDataActionFor } from "./poll-data.logic";
import { createPollDataStore, type PollDataStoreApi } from "./poll-data.store";
import { SESSION_STATES } from "./session.logic";

const def: PollDefinition = {
  slaveId: 1,
  function: 3,
  startAddress: 0,
  quantity: 3,
  scanRateMs: 1000,
};

function update(over: Partial<PollUpdateEvent> = {}): PollUpdateEvent {
  return {
    type: "PollUpdate",
    seq: 1,
    at: 5000,
    slaveId: 1,
    function: 3,
    startAddress: 0,
    values: [1, 2, 3],
    roundTripMs: 8,
    ...over,
  };
}

let store: PollDataStoreApi;
const get = () => store.getState();

beforeEach(() => {
  store = createPollDataStore();
});

describe("initial state", () => {
  it("has no data", () => {
    expect(get()).toMatchObject({
      status: "none",
      definition: null,
      values: null,
      seq: 0,
      lastOkAt: null,
      roundTripMs: null,
    });
  });
});

describe("begin", () => {
  it("goes to loading and drops old values", () => {
    get().begin(def);
    get().applyUpdate(update());
    get().begin({ ...def, function: 1 });
    expect(get()).toMatchObject({ status: "loading", values: null, kind: "bits", seq: 0 });
    expect(get().definition?.function).toBe(1);
  });

  it("derives the kind from the function", () => {
    get().begin({ ...def, function: 2 });
    expect(get().kind).toBe("bits");
    get().begin({ ...def, function: 4 });
    expect(get().kind).toBe("registers");
  });
});

describe("applyUpdate", () => {
  it("goes live with the values, time and round trip", () => {
    get().begin(def);
    get().applyUpdate(update({ seq: 4, at: 9000, roundTripMs: 12 }));
    expect(get()).toMatchObject({
      status: "live",
      values: [1, 2, 3],
      seq: 4,
      lastOkAt: 9000,
      roundTripMs: 12,
    });
  });

  it("ignores out-of-order and duplicate sequence numbers", () => {
    get().begin(def);
    get().applyUpdate(update({ seq: 5, values: [5, 5, 5] }));
    get().applyUpdate(update({ seq: 4, values: [4, 4, 4] }));
    get().applyUpdate(update({ seq: 5, values: [9, 9, 9] }));
    expect(get().values).toEqual([5, 5, 5]);
    expect(get().seq).toBe(5);
    get().applyUpdate(update({ seq: 6, values: [6, 6, 6] }));
    expect(get().values).toEqual([6, 6, 6]);
  });

  it("ignores an update for an old definition after Apply", () => {
    get().begin(def);
    get().applyUpdate(update({ seq: 1 }));
    get().begin({ ...def, startAddress: 10, quantity: 2 });
    get().applyUpdate(update({ seq: 2, startAddress: 0, values: [1, 2, 3] }));
    expect(get().status).toBe("loading");
    expect(get().values).toBeNull();
    get().applyUpdate(update({ seq: 3, startAddress: 10, values: [7, 8] }));
    expect(get()).toMatchObject({ status: "live", values: [7, 8] });
  });

  it("ignores updates of another slave, function or length", () => {
    get().begin(def);
    get().applyUpdate(update({ slaveId: 2 }));
    get().applyUpdate(update({ function: 4 }));
    get().applyUpdate(update({ values: [1, 2] }));
    expect(get().status).toBe("loading");
  });

  it("ignores updates when no poll was begun", () => {
    get().applyUpdate(update());
    expect(get().status).toBe("none");
    expect(get().values).toBeNull();
  });

  it("restarts the sequence after begin so a restarted backend poll is not dropped", () => {
    get().begin(def);
    get().applyUpdate(update({ seq: 500 }));
    get().begin(def);
    get().applyUpdate(update({ seq: 1, values: [9, 9, 9] }));
    expect(get().values).toEqual([9, 9, 9]);
  });

  it("returns to live from stale on a valid update", () => {
    get().begin(def);
    get().applyUpdate(update({ seq: 1 }));
    get().markStale();
    get().applyUpdate(update({ seq: 2 }));
    expect(get().status).toBe("live");
  });
});

describe("markStale", () => {
  it("marks existing values stale and keeps them", () => {
    get().begin(def);
    get().applyUpdate(update());
    get().markStale();
    expect(get().status).toBe("stale");
    expect(get().values).toEqual([1, 2, 3]);
    expect(get().lastOkAt).toBe(5000);
  });

  it("keeps 'none' when there are no values", () => {
    get().markStale();
    expect(get().status).toBe("none");
  });

  it("keeps 'loading' when nothing was ever received", () => {
    get().begin(def);
    get().markStale();
    expect(get().status).toBe("loading");
    expect(get().values).toBeNull();
  });
});

describe("clear", () => {
  it("resets to none", () => {
    get().begin(def);
    get().applyUpdate(update());
    get().clear();
    expect(get()).toMatchObject({
      status: "none",
      values: null,
      definition: null,
      clearedBecause: null,
    });
  });

  it("remembers that the settings changed", () => {
    get().begin(def);
    get().applyUpdate(update());
    get().clear("settingsChanged");
    expect(get().clearedBecause).toBe("settingsChanged");
    get().begin(def);
    expect(get().clearedBecause).toBeNull();
  });
});

describe("wiring rule (session state -> poll data action)", () => {
  const act = pollDataActionFor;

  it("begins when a poll starts from connected or paused", () => {
    expect(act("connected", "polling", false)).toBe("begin");
    expect(act("paused", "polling", false)).toBe("begin");
    expect(act("connected", "timeout", false)).toBe("begin");
    expect(act("connected", "exception", false)).toBe("begin");
  });

  it("begins again on Apply while running (restart) and not on a normal cycle result", () => {
    expect(act("polling", "polling", true)).toBe("begin");
    expect(act("timeout", "polling", true)).toBe("begin");
    expect(act("timeout", "polling", false)).toBe("none");
    expect(act("polling", "polling", false)).toBe("none");
  });

  it("marks the values stale when a cycle fails", () => {
    expect(act("polling", "timeout", false)).toBe("markStale");
    expect(act("timeout", "timeout", false)).toBe("markStale");
    expect(act("timeout", "exception", false)).toBe("markStale");
    expect(act("exception", "badResponse", false)).toBe("markStale");
  });

  it("marks stale on paused and disconnected", () => {
    for (const from of ["polling", "timeout", "exception", "badResponse"] as const) {
      expect(act(from, "paused", false)).toBe("markStale");
      expect(act(from, "disconnected", false)).toBe("markStale");
    }
    expect(act("connected", "disconnected", false)).toBe("markStale");
    expect(act("paused", "disconnected", false)).toBe("markStale");
  });

  it("clears on idle and when a new connection attempt starts", () => {
    for (const from of SESSION_STATES as readonly SessionState[]) {
      expect(act(from, "idle", false)).toBe("clear");
    }
    expect(act("disconnected", "connecting", false)).toBe("clear");
    expect(act("idle", "connecting", false)).toBe("clear");
  });

  it("does nothing when the link comes up", () => {
    expect(act("connecting", "connected", false)).toBe("none");
  });
});
