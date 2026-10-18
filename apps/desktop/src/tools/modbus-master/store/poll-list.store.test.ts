import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type {
  PollId,
  PollState,
  PollStateChangedEvent,
  PollSummary,
  WorkspaceRect,
} from "@/shared/ipc/modbus-master.types";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import {
  createPollListStore,
  type PollListStoreApi,
  pollNames,
  pollSummaryOf,
  selectAnyPaused,
  selectAnyRunning,
  selectCanAddPoll,
  selectHostState,
  selectNativeCount,
  unappliedNames,
} from "./poll-list.store";

type SummaryPatch = Partial<Omit<PollSummary, "status" | "counters">> & {
  state?: PollState;
  consecutiveFailures?: number;
  exceptionCode?: number | null;
  counters?: PollSummary["counters"];
};

function summary(id: PollId, name: string, patch: SummaryPatch = {}): PollSummary {
  const { state, consecutiveFailures, exceptionCode, counters, ...rest } = patch;
  return {
    config: { ...pollConfigInput({ name }), pollId: id, active: true },
    status: {
      pollId: id,
      state: state ?? "polling",
      consecutiveFailures: consecutiveFailures ?? 0,
      exceptionCode: exceptionCode ?? null,
      badResponseKind: null,
      badResponseDetail: null,
      at: 0,
    },
    counters: counters ?? {
      pollId: id,
      counters: { requests: 0, responses: 0, errors: 0, timeouts: 0 },
      effectiveScanMs: null,
      lastOkAt: null,
    },
    host: "workspace",
    open: true,
    workspace: null,
    hasUnappliedEdits: false,
    ...rest,
  };
}

const stateEvent = (
  pollId: PollId,
  state: PollState,
  patch: Partial<PollStateChangedEvent> = {},
): PollStateChangedEvent => ({
  type: "PollStateChanged",
  pollId,
  state,
  consecutiveFailures: 0,
  exceptionCode: null,
  badResponseKind: null,
  badResponseDetail: null,
  at: 1,
  ...patch,
});

let ipc: FakeModbusMasterIpc;
let toasts: ToastStoreApi;
let store: PollListStoreApi;
let warnings: string[];

function make(polls: PollSummary[] = []) {
  ipc = createFakeModbusMasterIpc();
  toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  warnings = [];
  store = createPollListStore({
    ipc,
    toasts,
    warn: (m) => warnings.push(m),
  });
  if (polls.length > 0) {
    // The fake backend knows the same polls, so commands on them succeed. Its model is filled
    // synchronously (the command bodies have no await), then the call log is cleared.
    for (const p of polls) void ipc.addPoll(pollConfigInput({ name: p.config.name }), "workspace");
    ipc.calls.length = 0;
    store.getState().applySnapshot(polls);
  }
}

const three = () => [summary(1, "A"), summary(2, "B"), summary(3, "C")];
const toastTexts = () => toasts.getState().items.map((t) => t.text);

beforeEach(() => make());

describe("initial state", () => {
  it("is empty", () => {
    expect(store.getState()).toMatchObject({
      order: [],
      polls: {},
      selectedId: null,
      pending: {},
      adding: false,
      renamingId: null,
      ready: false,
    });
    expect(selectCanAddPoll(store.getState())).toBe(true);
    expect(pollSummaryOf(store.getState()).text).toBe("No polls");
  });
});

describe("applySnapshot and applyPollListChanged", () => {
  it("takes the order of the event and marks the store ready", () => {
    make(three());
    expect(store.getState().order).toEqual([1, 2, 3]);
    expect(store.getState().ready).toBe(true);
    expect(pollNames(store.getState())).toEqual(["A", "B", "C"]);
  });

  it("an unchanged poll keeps its object identity, a changed one does not", () => {
    make(three());
    const before = store.getState().polls;
    store.getState().applyPollListChanged({
      polls: [summary(1, "A"), summary(2, "B", { state: "paused" }), summary(3, "C")],
    });
    const after = store.getState().polls;
    expect(after[1]).toBe(before[1]);
    expect(after[3]).toBe(before[3]);
    expect(after[2]).not.toBe(before[2]);
    expect(after[2]?.status.state).toBe("paused");
  });

  it("follows a new order and removes polls that are gone", () => {
    make(three());
    store.getState().applyPollListChanged({ polls: [summary(3, "C"), summary(1, "A")] });
    expect(store.getState().order).toEqual([3, 1]);
    expect(store.getState().polls[2]).toBeUndefined();
  });

  it("selection after a removal moves to the next row, else the previous, else nothing", () => {
    make(three());
    store.getState().select(2);
    store.getState().applyPollListChanged({ polls: [summary(1, "A"), summary(3, "C")] });
    expect(store.getState().selectedId).toBe(3);
    store.getState().applyPollListChanged({ polls: [summary(1, "A")] });
    expect(store.getState().selectedId).toBe(1);
    store.getState().applyPollListChanged({ polls: [] });
    expect(store.getState().selectedId).toBeNull();
  });

  it("removing the last row selects the previous one", () => {
    make(three());
    store.getState().select(3);
    store.getState().applyPollListChanged({ polls: [summary(1, "A"), summary(2, "B")] });
    expect(store.getState().selectedId).toBe(2);
  });

  it("a selection that still exists is kept; removing an unselected poll does not move it", () => {
    make(three());
    store.getState().select(1);
    store.getState().applyPollListChanged({ polls: [summary(1, "A"), summary(3, "C")] });
    expect(store.getState().selectedId).toBe(1);
  });

  it("drops the inline rename of a poll that is gone", () => {
    make(three());
    store.getState().startRename(2);
    store.getState().applyPollListChanged({ polls: [summary(1, "A")] });
    expect(store.getState().renamingId).toBeNull();
  });
});

describe("applyPollStateChanged", () => {
  it("updates the state, the failure count and the codes of one poll only", () => {
    make(three());
    store.getState().applyPollStateChanged(stateEvent(2, "timeout", { consecutiveFailures: 3 }));
    expect(store.getState().polls[2]).toMatchObject({
      status: { state: "timeout", consecutiveFailures: 3 },
    });
    expect(store.getState().polls[1]?.status.state).toBe("polling");
  });

  it("exception code and bad response are kept and cleared", () => {
    make(three());
    store.getState().applyPollStateChanged(stateEvent(1, "exception", { exceptionCode: 2 }));
    expect(store.getState().polls[1]).toMatchObject({
      status: { state: "exception", exceptionCode: 2 },
    });
    store.getState().applyPollStateChanged(
      stateEvent(1, "badResponse", {
        badResponseKind: "crc",
        badResponseDetail: { expected: 1, got: 2, message: "" },
      }),
    );
    expect(store.getState().polls[1]).toMatchObject({
      status: { state: "badResponse", badResponseKind: "crc", exceptionCode: null },
    });
    store.getState().applyPollStateChanged(stateEvent(1, "polling"));
    expect(store.getState().polls[1]?.status).toMatchObject({
      state: "polling",
      badResponseKind: null,
      consecutiveFailures: 0,
    });
  });

  it("counts a repeated failure when the backend sends 0", () => {
    make(three());
    store.getState().applyPollStateChanged(stateEvent(1, "timeout"));
    store.getState().applyPollStateChanged(stateEvent(1, "timeout"));
    expect(store.getState().polls[1]?.status.consecutiveFailures).toBe(2);
  });

  it("ignores a poll that is not in the list", () => {
    make(three());
    const before = store.getState().polls;
    store.getState().applyPollStateChanged(stateEvent(99, "paused"));
    expect(store.getState().polls).toBe(before);
  });

  it("an identical state keeps the entry object", () => {
    make(three());
    const before = store.getState().polls[1];
    store.getState().applyPollStateChanged(stateEvent(1, "polling"));
    expect(store.getState().polls[1]).toBe(before);
  });

  it("records a development warning for an unexpected pair", () => {
    make([summary(1, "A", { state: "offline" })]);
    store.getState().applyPollStateChanged(stateEvent(1, "timeout"));
    expect(warnings).toEqual(["Unexpected poll transition offline -> timeout"]);
    expect(store.getState().polls[1]?.status.state).toBe("timeout");
  });
});

describe("applyCounters", () => {
  it("updates only the polls whose counters changed", () => {
    make(three());
    const before = store.getState().polls;
    store.getState().applyCounters({
      polls: [
        {
          pollId: 1,
          counters: { requests: 5, responses: 5, errors: 0, timeouts: 0 },
          effectiveScanMs: null,
          lastOkAt: 1234,
        },
        {
          pollId: 2,
          counters: { requests: 0, responses: 0, errors: 0, timeouts: 0 },
          effectiveScanMs: null,
          lastOkAt: null,
        },
      ],
    });
    const after = store.getState().polls;
    expect(after[1]?.counters.counters.requests).toBe(5);
    expect(after[1]?.counters.lastOkAt).toBe(1234);
    expect(after[2]).toBe(before[2]);
    expect(after[3]).toBe(before[3]);
  });

  it("ignores a poll that is not in the list and keeps the map when nothing changed", () => {
    make(three());
    const before = store.getState().polls;
    store.getState().applyCounters({
      polls: [
        {
          pollId: 77,
          counters: { requests: 1, responses: 1, errors: 0, timeouts: 0 },
          effectiveScanMs: null,
          lastOkAt: null,
        },
      ],
    });
    expect(store.getState().polls).toBe(before);
  });
});

describe("add", () => {
  it("creates 'Poll 1' in the workspace and selects it", async () => {
    const id = await store.getState().add();
    expect(id).toBeTypeOf("number");
    const [input, host] = ipc.callsOf("addPoll")[0] as [ReturnType<typeof pollConfigInput>, string];
    expect(host).toBe("workspace");
    expect(input).toMatchObject({
      name: "Poll 1",
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
      display: { showAlias: true, copyAlias: false },
      aliases: [],
      scale: null,
      valueColumns: "raw",
    });
    expect(store.getState().selectedId).toBe(id);
    expect(store.getState().adding).toBe(false);
  });

  it("fills the lowest free number (CHK2-B2)", async () => {
    make([summary(1, "Poll 1"), summary(3, "Poll 3")]);
    await store.getState().add();
    const input = ipc.callsOf("addPoll")[0]?.[0] as { name: string };
    expect(input.name).toBe("Poll 2");
  });

  it("sends no run intent: Rust sets `active` from Start polling when connected", async () => {
    await store.getState().add();
    expect(ipc.callsOf("addPoll")[0]?.[0]).not.toHaveProperty("active");
  });

  it("counters carry the effective rate and the last good reply too", () => {
    make(three());
    store.getState().applyCounters({
      polls: [
        {
          pollId: 2,
          counters: { requests: 0, responses: 0, errors: 0, timeouts: 0 },
          effectiveScanMs: 150,
          lastOkAt: null,
        },
      ],
    });
    expect(store.getState().polls[2]?.counters.effectiveScanMs).toBe(150);
  });

  it("at 16 polls it sends nothing and shows the limit toast (CHK2-B3)", async () => {
    make(Array.from({ length: 16 }, (_, i) => summary(i + 1, `Poll ${i + 1}`)));
    expect(selectCanAddPoll(store.getState())).toBe(false);
    expect(await store.getState().add()).toBeNull();
    expect(ipc.callsOf("addPoll")).toHaveLength(0);
    expect(toastTexts()).toEqual(["A connection can have at most 16 polls."]);
    expect(toasts.getState().items[0]?.tone).toBe("default");
  });

  it("sets adding while the command runs and ignores a second click", async () => {
    const held = ipc.hold("addPoll");
    const first = store.getState().add();
    expect(store.getState().adding).toBe(true);
    expect(await store.getState().add()).toBeNull();
    held.release(7);
    expect(await first).toBe(7);
    expect(store.getState().adding).toBe(false);
    expect(ipc.callsOf("addPoll")).toHaveLength(1);
  });

  it("a rejection shows an error toast and returns null", async () => {
    ipc.failNext("addPoll", new IpcError("boom", "internal"));
    expect(await store.getState().add()).toBeNull();
    expect(toasts.getState().items).toEqual([
      expect.objectContaining({ text: "boom", tone: "error" }),
    ]);
    expect(store.getState().adding).toBe(false);
  });
});

describe("duplicate", () => {
  it("sends the command and selects the copy", async () => {
    make(three());
    ipc.setResult("duplicatePoll", 9);
    expect(await store.getState().duplicate(2)).toBe(9);
    expect(ipc.callsOf("duplicatePoll")).toEqual([[2]]);
    expect(store.getState().selectedId).toBe(9);
  });

  it("does nothing for an unknown poll or at the limit", async () => {
    make(three());
    expect(await store.getState().duplicate(99)).toBeNull();
    make(Array.from({ length: 16 }, (_, i) => summary(i + 1, `Poll ${i + 1}`)));
    expect(await store.getState().duplicate(1)).toBeNull();
    expect(ipc.callsOf("duplicatePoll")).toHaveLength(0);
    expect(toastTexts()).toEqual(["A connection can have at most 16 polls."]);
  });

  it("a rejection shows an error toast", async () => {
    make(three());
    ipc.failNext("duplicatePoll", "no copy");
    expect(await store.getState().duplicate(1)).toBeNull();
    expect(toastTexts()).toEqual(["no copy"]);
  });
});

describe("rename", () => {
  beforeEach(() => make([summary(1, "Tank"), summary(2, "Pump")]));

  it.each([
    ["", "Enter a poll name."],
    ["   ", "Enter a poll name."],
    ["x".repeat(49), "Poll name must be at most 48 characters."],
    [" a", "Poll name cannot start or end with a space."],
    ["a\u0007", "Poll name cannot contain control characters."],
    ["pump", 'A poll named "pump" already exists on this connection.'],
  ])("%j gives the message %j and sends nothing", async (name, message) => {
    expect(await store.getState().rename(1, name)).toBe(message);
    expect(ipc.callsOf("renamePoll")).toHaveLength(0);
  });

  it("a valid name is sent and ends the inline rename", async () => {
    store.getState().startRename(1);
    expect(await store.getState().rename(1, "Tank 1")).toBeNull();
    expect(ipc.callsOf("renamePoll")).toEqual([[1, "Tank 1"]]);
    expect(store.getState().renamingId).toBeNull();
    expect(store.getState().pending[1]).toBeNull();
  });

  it("the poll's own name in another case is allowed", async () => {
    expect(await store.getState().rename(1, "TANK")).toBeNull();
    expect(ipc.callsOf("renamePoll")).toEqual([[1, "TANK"]]);
  });

  it("the same name sends nothing and ends the rename", async () => {
    store.getState().startRename(1);
    expect(await store.getState().rename(1, "Tank")).toBeNull();
    expect(ipc.callsOf("renamePoll")).toHaveLength(0);
    expect(store.getState().renamingId).toBeNull();
  });

  it("a backend message about the name is returned for the field", async () => {
    ipc.failNext(
      "renamePoll",
      new IpcError(
        'A poll named "X" already exists on this connection.',
        "duplicatePollName",
        "name",
      ),
    );
    expect(await store.getState().rename(1, "Other")).toContain("already exists");
    expect(toastTexts()).toEqual([]);
  });

  it("another backend error is a toast", async () => {
    ipc.failNext("renamePoll", new IpcError("gone", "pollNotFound"));
    expect(await store.getState().rename(1, "Other")).toBeNull();
    expect(toastTexts()).toEqual(["gone"]);
  });

  it("an unknown poll does nothing", async () => {
    expect(await store.getState().rename(9, "X")).toBeNull();
    expect(ipc.callsOf("renamePoll")).toHaveLength(0);
  });

  it("startRename selects the row; cancelRename ends it", () => {
    store.getState().startRename(2);
    expect(store.getState()).toMatchObject({ renamingId: 2, selectedId: 2 });
    store.getState().cancelRename();
    expect(store.getState().renamingId).toBeNull();
    store.getState().startRename(99);
    expect(store.getState().renamingId).toBeNull();
  });
});

describe("remove, setActive, setAllActive", () => {
  beforeEach(() => make(three()));

  it("remove sends the command with a pending flag", async () => {
    const held = ipc.hold("removePoll");
    const pending = store.getState().remove(2);
    expect(store.getState().pending[2]).toBe("remove");
    held.release();
    await pending;
    expect(store.getState().pending[2]).toBeNull();
    expect(ipc.callsOf("removePoll")).toEqual([[2]]);
  });

  it("remove does not touch the list itself: Rust answers with PollListChanged", async () => {
    await store.getState().remove(2);
    expect(store.getState().order).toEqual([1, 2, 3]);
  });

  it("setActive sends the command", async () => {
    await store.getState().setActive(1, false);
    expect(ipc.callsOf("setPollActive")).toEqual([[1, false]]);
  });

  it("setAllActive sends the command", async () => {
    await store.getState().setAllActive(false);
    expect(ipc.callsOf("setAllPollsActive")).toEqual([[false]]);
  });

  it("rejections become error toasts and clear pending", async () => {
    ipc.failNext("removePoll", "x1");
    ipc.failNext("setPollActive", "x2");
    ipc.failNext("setAllPollsActive", "x3");
    await store.getState().remove(1);
    await store.getState().setActive(1, true);
    await store.getState().setAllActive(true);
    expect(toastTexts()).toEqual(["x1", "x2", "x3"]);
    expect(store.getState().pending[1]).toBeNull();
  });

  it("unknown polls are ignored", async () => {
    await store.getState().remove(99);
    await store.getState().setActive(99, true);
    expect(ipc.calls).toHaveLength(0);
  });
});

describe("setOrder", () => {
  beforeEach(() => make(three()));

  it("sets the whole order at once and sends it once", async () => {
    await store.getState().setOrder([3, 1, 2]);
    expect(store.getState().order).toEqual([3, 1, 2]);
    expect(ipc.callsOf("reorderPolls")).toEqual([[[3, 1, 2]]]);
  });

  it("marks the poll it was told about as moving", async () => {
    const held = ipc.hold("reorderPolls");
    const pending = store.getState().setOrder([3, 1, 2], 3);
    expect(store.getState().pending[3]).toBe("reorder");
    held.release();
    await pending;
    expect(store.getState().pending[3]).toBeNull();
  });

  it("ignores the same order, a different set of polls and a wrong length", async () => {
    await store.getState().setOrder([1, 2, 3]);
    await store.getState().setOrder([1, 2]);
    await store.getState().setOrder([1, 2, 9]);
    expect(ipc.callsOf("reorderPolls")).toHaveLength(0);
  });

  it("a rejection restores the order", async () => {
    ipc.failNext("reorderPolls", "no");
    await store.getState().setOrder([3, 2, 1]);
    expect(store.getState().order).toEqual([1, 2, 3]);
  });
});

describe("reorder", () => {
  beforeEach(() => make(three()));

  it("reorder(0, 2) on [A, B, C] gives [B, C, A] at once and calls reorderPolls once", async () => {
    const held = ipc.hold("reorderPolls");
    const pending = store.getState().reorder(0, 2);
    expect(store.getState().order).toEqual([2, 3, 1]);
    expect(store.getState().pending[1]).toBe("reorder");
    held.release();
    await pending;
    expect(ipc.callsOf("reorderPolls")).toEqual([[[2, 3, 1]]]);
    expect(store.getState().order).toEqual([2, 3, 1]);
    expect(store.getState().pending[1]).toBeNull();
  });

  it("a rejected call restores the order and shows the rejection toast", async () => {
    ipc.failNext(
      "reorderPolls",
      new IpcError("The order must list every poll once.", "validation", "order"),
    );
    await store.getState().reorder(0, 2);
    expect(store.getState().order).toEqual([1, 2, 3]);
    expect(toastTexts()).toEqual(["The order must list every poll once."]);
  });

  it("a rollback does not clobber a newer order from the backend", async () => {
    const held = ipc.hold("reorderPolls");
    const pending = store.getState().reorder(0, 2);
    store
      .getState()
      .applyPollListChanged({ polls: [summary(3, "C"), summary(2, "B"), summary(1, "A")] });
    held.fail("late");
    await pending;
    expect(store.getState().order).toEqual([3, 2, 1]);
  });

  it("two quick reorders: a rejected second one rolls back to what Rust accepted, not to the first's order (REV-006 n-4)", async () => {
    const first = ipc.hold("reorderPolls");
    const one = store.getState().setOrder([2, 1, 3]);
    expect(store.getState().order).toEqual([2, 1, 3]);
    ipc.failNext("reorderPolls", "no");
    const two = store.getState().setOrder([3, 2, 1]);
    // The second was rejected at once; the first is still on its way.
    await two;
    expect(store.getState().order).toEqual([1, 2, 3]);
    first.fail("also no");
    await one;
    expect(store.getState().order).toEqual([1, 2, 3]);
  });

  it("setOrder says whether the order was applied", async () => {
    expect(await store.getState().setOrder([2, 1, 3])).toBe(true);
    expect(await store.getState().setOrder([2, 1, 3])).toBe(false);
    ipc.failNext("reorderPolls", "no");
    expect(await store.getState().setOrder([3, 2, 1])).toBe(false);
  });

  it("does nothing for the same index or an index out of range", async () => {
    await store.getState().reorder(1, 1);
    await store.getState().reorder(-1, 0);
    await store.getState().reorder(0, 3);
    await store.getState().reorder(5, 0);
    expect(ipc.calls).toHaveLength(0);
    expect(store.getState().order).toEqual([1, 2, 3]);
  });

  it("moveUp moves one place; on the first row it does nothing and makes no IPC call", async () => {
    await store.getState().moveUp(1);
    expect(ipc.calls).toHaveLength(0);
    await store.getState().moveUp(3);
    expect(store.getState().order).toEqual([1, 3, 2]);
    expect(ipc.callsOf("reorderPolls")).toEqual([[[1, 3, 2]]]);
  });

  it("moveDown moves one place; on the last row it does nothing", async () => {
    await store.getState().moveDown(3);
    expect(ipc.calls).toHaveLength(0);
    await store.getState().moveDown(1);
    expect(store.getState().order).toEqual([2, 1, 3]);
    await store.getState().moveDown(99);
    expect(ipc.callsOf("reorderPolls")).toHaveLength(1);
  });
});

describe("derived values", () => {
  it("hostState: closed when open is false, workspace.minimized from the rect state", () => {
    const rect = (state: WorkspaceRect["state"]): WorkspaceRect => ({
      x: 0,
      y: 0,
      width: 640,
      height: 368,
      z: 1,
      state,
      restore: null,
    });
    make([
      summary(1, "A", { open: false }),
      summary(2, "B", { workspace: rect("minimized") }),
      summary(3, "C", { host: "native" }),
      summary(4, "D", { workspace: rect("maximized") }),
      summary(5, "E"),
    ]);
    const s = store.getState();
    expect([1, 2, 3, 4, 5].map((id) => selectHostState(id)(s))).toEqual([
      "closed",
      "workspace.minimized",
      "native",
      "workspace.maximized",
      "workspace.normal",
    ]);
    expect(selectHostState(99)(s)).toBeNull();
    expect(selectNativeCount(s)).toBe(1);
  });

  it("anyRunning and anyPaused", () => {
    make([summary(1, "A", { state: "paused" }), summary(2, "B", { state: "offline" })]);
    expect(selectAnyRunning(store.getState())).toBe(false);
    expect(selectAnyPaused(store.getState())).toBe(true);
    store.getState().applyPollStateChanged(stateEvent(1, "polling"));
    expect(selectAnyRunning(store.getState())).toBe(true);
    expect(selectAnyPaused(store.getState())).toBe(false);
    store.getState().applyPollStateChanged(stateEvent(1, "exception", { exceptionCode: 2 }));
    expect(selectAnyRunning(store.getState())).toBe(true);
  });

  it("unappliedNames in list order, and the summary of the polls", () => {
    make([
      summary(1, "A", { hasUnappliedEdits: true }),
      summary(2, "B", { state: "timeout" }),
      summary(3, "C", { hasUnappliedEdits: true, state: "exception", exceptionCode: 2 }),
    ]);
    expect(unappliedNames(store.getState())).toEqual(["A", "C"]);
    expect(pollSummaryOf(store.getState()).text).toBe("1 exception · 1 timeout · 1 live");
    store.getState().applyPollListChanged({
      polls: [store.getState().polls[3] as PollSummary, store.getState().polls[1] as PollSummary],
    });
    expect(unappliedNames(store.getState())).toEqual(["C", "A"]);
  });
});

describe("host transitions (FE-002 ground rules: HOST_ALLOWED, lastUnexpected)", () => {
  beforeEach(() => make([summary(1, "A"), summary(2, "B")]));

  it("a pop out, a dock and a close are expected: nothing is recorded or warned", () => {
    store.getState().applyPollListChanged({
      polls: [summary(1, "A", { host: "native" }), summary(2, "B")],
    });
    store.getState().applyPollListChanged({ polls: [summary(1, "A"), summary(2, "B")] });
    store.getState().applyPollListChanged({
      polls: [summary(1, "A", { open: false }), summary(2, "B")],
    });
    store.getState().applyPollListChanged({
      polls: [summary(1, "A", { host: "native" }), summary(2, "B")],
    });
    expect(store.getState().lastUnexpected).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("a native poll that becomes minimized is applied anyway and recorded", () => {
    store.getState().applyPollListChanged({
      polls: [summary(1, "A", { host: "native" }), summary(2, "B")],
    });
    const minimized: WorkspaceRect = {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      z: 1,
      state: "minimized",
      restore: null,
    };
    store.getState().applyPollListChanged({
      polls: [summary(1, "A", { host: "workspace", workspace: minimized }), summary(2, "B")],
    });
    expect(store.getState().polls[1]?.workspace?.state).toBe("minimized");
    expect(store.getState().lastUnexpected).toEqual({
      pollId: 1,
      from: "native",
      to: "workspace.minimized",
    });
    expect(warnings).toEqual([
      "Unexpected host transition of poll 1: native -> workspace.minimized",
    ]);
  });

  it("a poll that is new in the list has no transition", () => {
    store.getState().applyPollListChanged({
      polls: [summary(1, "A"), summary(2, "B"), summary(3, "C", { open: false })],
    });
    expect(store.getState().lastUnexpected).toBeNull();
  });
});
