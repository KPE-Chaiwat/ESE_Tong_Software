import type {
  ConnectionState,
  PollDefinition,
  PollState,
  PollUpdate,
} from "@/shared/ipc/modbus-master.types";
import {
  connectionClearsData,
  definitionChangeAction,
  kindOf,
  matchesDefinition,
  type PollDataAction,
  pollDataActionFor,
  sameDefinition,
} from "./poll-data.logic";
import { createPollDataStore, type PollDataStoreApi, selectValueAt } from "./poll-data.store";

const def: PollDefinition = {
  slaveId: 1,
  function: 3,
  startAddress: 0,
  quantity: 3,
  scanRateMs: 100,
};
const update = (patch: Partial<PollUpdate> = {}): PollUpdate => ({
  pollId: 1,
  seq: 1,
  at: 1000,
  slaveId: 1,
  function: 3,
  startAddress: 0,
  values: [10, 20, 30],
  roundTripMs: 8,
  ...patch,
});

let store: PollDataStoreApi;
beforeEach(() => {
  store = createPollDataStore({ pollId: 1 });
});

describe("initial state", () => {
  it("is empty", () => {
    expect(store.getState()).toMatchObject({
      status: "none",
      definition: null,
      kind: "registers",
      values: null,
      seq: 0,
      lastOkAt: null,
      roundTripMs: null,
      clearedBecause: null,
    });
  });
});

describe("begin, applyUpdate, markStale, clear", () => {
  it("begin makes the view loading and drops old values", () => {
    store.getState().begin(def);
    store.getState().applyUpdate(update());
    store.getState().begin(def);
    expect(store.getState()).toMatchObject({
      status: "loading",
      definition: def,
      values: null,
      seq: 0,
    });
  });

  it("begin sets the kind from the function", () => {
    store.getState().begin({ ...def, function: 1 });
    expect(store.getState().kind).toBe("bits");
    store.getState().begin({ ...def, function: 4 });
    expect(store.getState().kind).toBe("registers");
  });

  it("a valid update makes the view live", () => {
    store.getState().begin(def);
    store.getState().applyUpdate(update({ seq: 5, at: 4242, roundTripMs: 12 }));
    expect(store.getState()).toMatchObject({
      status: "live",
      values: [10, 20, 30],
      seq: 5,
      lastOkAt: 4242,
      roundTripMs: 12,
    });
  });

  it("an update before begin is ignored (no definition)", () => {
    store.getState().applyUpdate(update());
    expect(store.getState().status).toBe("none");
  });

  it("updates for another poll are ignored", () => {
    store.getState().begin(def);
    store.getState().applyUpdate(update({ pollId: 2 }));
    expect(store.getState().values).toBeNull();
  });

  it("an out-of-order seq is ignored", () => {
    store.getState().begin(def);
    store.getState().applyUpdate(update({ seq: 5, values: [1, 1, 1] }));
    store.getState().applyUpdate(update({ seq: 4, values: [2, 2, 2] }));
    store.getState().applyUpdate(update({ seq: 5, values: [3, 3, 3] }));
    expect(store.getState().values).toEqual([1, 1, 1]);
    store.getState().applyUpdate(update({ seq: 6, values: [4, 4, 4] }));
    expect(store.getState().values).toEqual([4, 4, 4]);
  });

  it("an update for an old definition is ignored after Apply", () => {
    store.getState().begin(def);
    store.getState().begin({ ...def, quantity: 5 });
    store.getState().applyUpdate(update());
    expect(store.getState().values).toBeNull();
    store.getState().applyUpdate(update({ values: [1, 2, 3, 4, 5], seq: 2 }));
    expect(store.getState().status).toBe("live");
  });

  it("markStale keeps the values and shows them as stale", () => {
    store.getState().begin(def);
    store.getState().applyUpdate(update());
    store.getState().markStale();
    expect(store.getState()).toMatchObject({ status: "stale", values: [10, 20, 30] });
    store.getState().applyUpdate(update({ seq: 2, values: [1, 2, 3] }));
    expect(store.getState().status).toBe("live");
  });

  it("markStale with no values keeps the status", () => {
    store.getState().markStale();
    expect(store.getState().status).toBe("none");
    store.getState().begin(def);
    store.getState().markStale();
    expect(store.getState().status).toBe("loading");
  });

  it("clear empties the view; the reason is kept for the empty text", () => {
    store.getState().begin(def);
    store.getState().applyUpdate(update());
    store.getState().clear("settingsChanged");
    expect(store.getState()).toMatchObject({
      status: "none",
      values: null,
      definition: null,
      clearedBecause: "settingsChanged",
    });
    store.getState().clear();
    expect(store.getState().clearedBecause).toBeNull();
  });

  it("a live update takes the settings-changed reason away", () => {
    store.getState().clear("settingsChanged");
    store.getState().begin(def);
    store.getState().applyUpdate(update());
    expect(store.getState().clearedBecause).toBeNull();
  });
});

describe("seed (the attach snapshot carries the last update)", () => {
  it("shows live values at once, without passing through loading", () => {
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.status));
    store.getState().seed(def, update({ seq: 9, at: 777 }));
    expect(seen).toEqual(["live"]);
    expect(store.getState()).toMatchObject({
      status: "live",
      values: [10, 20, 30],
      seq: 9,
      lastOkAt: 777,
      definition: def,
    });
  });

  it("an older update than the seed is ignored afterwards", () => {
    store.getState().seed(def, update({ seq: 9 }));
    store.getState().applyUpdate(update({ seq: 8, values: [0, 0, 0] }));
    expect(store.getState().values).toEqual([10, 20, 30]);
    store.getState().applyUpdate(update({ seq: 10, values: [1, 1, 1] }));
    expect(store.getState().values).toEqual([1, 1, 1]);
  });

  it("ignores an update of another poll or another definition", () => {
    store.getState().seed(def, update({ pollId: 2 }));
    store.getState().seed(def, update({ values: [1] }));
    expect(store.getState().status).toBe("none");
  });
});

describe("selectors", () => {
  it("selectValueAt reads one row", () => {
    store.getState().seed(def, update());
    expect(selectValueAt(1)(store.getState())).toBe(20);
    expect(selectValueAt(9)(store.getState())).toBeUndefined();
    store.getState().clear();
    expect(selectValueAt(0)(store.getState())).toBeUndefined();
  });

  it("a row selector does not notify when another row changes", () => {
    store.getState().seed(def, update());
    let value = selectValueAt(0)(store.getState());
    let changes = 0;
    store.subscribe((s) => {
      const next = selectValueAt(0)(s);
      if (next !== value) {
        changes += 1;
        value = next;
      }
    });
    store.getState().applyUpdate(update({ seq: 2, values: [10, 99, 30] }));
    expect(changes).toBe(0);
    store.getState().applyUpdate(update({ seq: 3, values: [11, 99, 30] }));
    expect(changes).toBe(1);
  });
});

describe("pollDataActionFor (poll state -> data view)", () => {
  const cases: Array<[PollState, PollState, PollDataAction]> = [
    ["offline", "polling", "begin"],
    ["paused", "polling", "begin"],
    ["polling", "timeout", "markStale"],
    ["polling", "exception", "markStale"],
    ["polling", "badResponse", "markStale"],
    ["timeout", "exception", "markStale"],
    ["timeout", "polling", "none"],
    ["exception", "polling", "none"],
    ["polling", "polling", "none"],
    ["polling", "paused", "markStale"],
    ["timeout", "paused", "markStale"],
    ["polling", "offline", "markStale"],
    ["paused", "offline", "markStale"],
    ["offline", "paused", "markStale"],
    ["paused", "paused", "none"],
    ["offline", "offline", "none"],
    ["offline", "timeout", "markStale"],
  ];
  it.each(cases)("%s -> %s is %s", (prev, next, action) => {
    expect(pollDataActionFor(prev, next)).toBe(action);
  });
});

describe("connectionClearsData", () => {
  const cases: Array<[ConnectionState, ConnectionState, boolean]> = [
    ["connected", "idle", true],
    ["disconnected", "idle", true],
    ["connecting", "idle", true],
    ["idle", "idle", false],
    ["connected", "disconnected", false],
    ["disconnected", "connecting", false],
    ["idle", "connecting", false],
  ];
  it.each(cases)("%s -> %s is %s", (prev, next, clears) => {
    expect(connectionClearsData(prev, next)).toBe(clears);
  });
});

describe("definitionChangeAction (PT6, PT6b)", () => {
  const changed = { ...def, quantity: 9 };
  it("a running poll restarts and shows loading", () => {
    for (const s of ["polling", "timeout", "exception", "badResponse"] as const) {
      expect(definitionChangeAction(def, changed, s)).toBe("begin");
    }
  });
  it("a paused or offline poll clears its values", () => {
    expect(definitionChangeAction(def, changed, "paused")).toBe("clear");
    expect(definitionChangeAction(def, changed, "offline")).toBe("clear");
  });
  it("an unchanged definition does nothing", () => {
    expect(definitionChangeAction(def, { ...def }, "polling")).toBe("none");
  });
});

describe("helpers", () => {
  it("matchesDefinition compares slave, function, start and length", () => {
    expect(matchesDefinition(def, update())).toBe(true);
    expect(matchesDefinition(def, update({ slaveId: 2 }))).toBe(false);
    expect(matchesDefinition(def, update({ function: 4 }))).toBe(false);
    expect(matchesDefinition(def, update({ startAddress: 1 }))).toBe(false);
    expect(matchesDefinition(def, update({ values: [1, 2] }))).toBe(false);
  });
  it("sameDefinition and kindOf", () => {
    expect(sameDefinition(def, { ...def })).toBe(true);
    expect(sameDefinition(def, { ...def, scanRateMs: 50 })).toBe(false);
    expect(kindOf(1)).toBe("bits");
    expect(kindOf(2)).toBe("bits");
    expect(kindOf(3)).toBe("registers");
    expect(kindOf(4)).toBe("registers");
  });
});
