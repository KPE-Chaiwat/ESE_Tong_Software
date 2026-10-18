import { IpcError } from "@/shared/ipc/errors";
import { createFakeModbusMasterIpc, pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import type { PollBulkResult } from "@/shared/ipc/modbus-master.types";
import { createToastStore } from "@/shared/lib/toast.store";
import { createAnnouncerStore } from "./announcer.store";
import { createLayoutStore } from "./layout.store";
import { createPollBulkStore, type PollBulkStoreApi } from "./poll-bulk.store";
import { createPollListStore } from "./poll-list.store";
import { createPollSelectionStore } from "./poll-selection.store";

let bulk: PollBulkStoreApi;
afterEach(() => bulk?.getState().dispose());
async function setup() {
  const ipc = createFakeModbusMasterIpc();
  const list = createPollListStore({ ipc, toasts: createToastStore() });
  const selection = createPollSelectionStore();
  const layout = createLayoutStore();
  const snapshot = await ipc.openSession((e) => {
    if (e.type === "PollListChanged") list.getState().applyPollListChanged(e);
  });
  list.getState().applySnapshot(snapshot.polls);
  const id = await ipc.addPoll(pollConfigInput({ name: "A" }), "workspace");
  selection.getState().toggle(id);
  const focus = vi.fn();
  bulk = createPollBulkStore({
    ipc,
    list,
    selection,
    layout,
    announcer: createAnnouncerStore(),
    focus,
  });
  return { ipc, list, selection, layout, id, focus };
}
describe("bulk coordinator", () => {
  it.each(["show", "cleanup"] as const)(
    "late %s recovery cannot overwrite a replacement profile's confirmation",
    async (kind) => {
      const { ipc, id, layout } = await setup();
      const recovery: PollBulkResult = {
        operationToken: "old-operation",
        action: "duplicate",
        definitionsCommitted: true,
        created: [],
        removedIds: [],
        polls: [],
        issues: [
          {
            pollId: id,
            stage: kind === "show" ? "show" : "destroy",
            code: "internal",
            message: "Retry",
            recovery: kind === "show" ? "showPoll" : "retryWindowCleanup",
          },
        ],
      };
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (kind === "show") ipc.showPoll = () => pending;
      else
        ipc.recoverPollBulkWindows = async () => {
          await pending;
          return recovery;
        };
      bulk.setState({ recovery });
      const task =
        kind === "show" ? bulk.getState().recoverHost(id) : bulk.getState().retryWindowCleanup();
      expect(layout.getState().modalOpen).toBe(true);
      bulk.getState().resetForProfile();
      await bulk.getState().requestDeleteSelected();
      const confirmation = bulk.getState().confirmation;
      expect(confirmation).not.toBeNull();
      finish();
      await task;
      expect(bulk.getState().phase).toBe("confirming");
      expect(bulk.getState().confirmation).toBe(confirmation);
      expect(bulk.getState().recovery).toBeNull();
      expect(layout.getState().modalOpen).toBe(true);
      bulk.getState().cancelDelete();
      expect(layout.getState().modalOpen).toBe(false);
    },
  );
  it("never silently reduces a stale selected set before prepare", async () => {
    const { ipc, selection } = await setup();
    selection.getState().toggle(999);
    await bulk.getState().duplicateSelected();
    expect(ipc.callsOf("preparePollBulk")[0]).toEqual(["duplicate", [1, 999]]);
    expect(ipc.pollIds()).toEqual([1]);
    expect(bulk.getState().error).toContain("Could not duplicate");
  });
  it("a newer channel list supersedes the older returned result snapshot", async () => {
    const { ipc, list } = await setup();
    const held = ipc.holdReply("duplicatePolls");
    const task = bulk.getState().duplicateSelected();
    await vi.waitFor(() => expect(ipc.pollIds()).toHaveLength(2));
    const later = await ipc.addPoll(pollConfigInput({ name: "Later" }), "workspace");
    held.release();
    await task;
    expect(list.getState().order).toEqual(ipc.pollIds());
    expect(list.getState().order).toContain(later);
  });
  it("two lost responses expose a same-token result check and block fresh plans", async () => {
    const { ipc } = await setup();
    const original = ipc.duplicatePolls;
    let lost = 2;
    ipc.duplicatePolls = async (token) => {
      const result = await original(token);
      if (lost-- > 0) throw new IpcError("Response lost");
      return result;
    };
    await bulk.getState().duplicateSelected();
    expect(bulk.getState().retryPlan).not.toBeNull();
    await bulk.getState().duplicateSelected();
    expect(ipc.callsOf("preparePollBulk")).toHaveLength(1);
    await bulk.getState().retryOperation();
    expect(bulk.getState().retryPlan).toBeNull();
    expect(ipc.pollIds()).toHaveLength(2);
    const calls = ipc.callsOf("duplicatePolls");
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call[0] === calls[0]?.[0])).toBe(true);
  });
  it("an explicit precommit internal error retains its original message without replay", async () => {
    const { ipc, layout } = await setup();
    ipc.failNext("duplicatePolls", new IpcError("Actor unavailable", "internal"));
    await bulk.getState().duplicateSelected();
    expect(bulk.getState().error).toBe("Could not duplicate the selected polls. Actor unavailable");
    expect(ipc.callsOf("duplicatePolls")).toHaveLength(1);
    expect(bulk.getState().retryPlan).toBeNull();
    expect(layout.getState().modalOpen).toBe(false);
  });
  it("profile reset cancels confirmation and clears recovery without changing definitions", async () => {
    const { ipc, layout } = await setup();
    await bulk.getState().requestDeleteSelected();
    expect(bulk.getState().confirmation).not.toBeNull();
    bulk.getState().resetForProfile();
    await bulk.getState().confirmDelete();
    expect(layout.getState().modalOpen).toBe(false);
    expect(ipc.pollIds()).toEqual([1]);
    expect(ipc.callsOf("removePolls")).toHaveLength(0);
  });
});
