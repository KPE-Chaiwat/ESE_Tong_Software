import { createFakeModbusMasterIpc, pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import { createToastStore } from "@/shared/lib/toast.store";
import { createConnectionStore } from "../store/connection.store";
import { createLayoutStore } from "../store/layout.store";
import { createPollViewRuntime, type PollViewRuntime } from "./poll-view-runtime";

let view: PollViewRuntime;
afterEach(() => view?.dispose());
async function setup(host: "workspace" | "native" = "workspace") {
  const ipc = createFakeModbusMasterIpc();
  await ipc.openSession(() => {});
  const id = await ipc.addPoll(pollConfigInput({ name: "A" }), host);
  const layout = createLayoutStore();
  const close = vi.fn();
  view = createPollViewRuntime({
    ipc,
    pollId: id,
    host,
    connection: createConnectionStore({ ipc }),
    toasts: createToastStore(),
    lockModal: () => layout.getState().lockModal(),
    canPrepareBulk: () => !layout.getState().modalOpen,
    hostActions: { close },
  });
  await view.init();
  return { ipc, id, layout, close };
}
describe("view bulk readiness leases", () => {
  it("acknowledges the current token, blocks host actions and releases matching leases", async () => {
    const { ipc, id, close } = await setup();
    ipc.emitView(id, {
      type: "BulkOperationPrepare",
      operationToken: "operation",
      action: "duplicate",
    });
    expect(view.stores.ui.getState().bulkOperationToken).toBe("operation");
    expect(ipc.callsOf("ackPollBulkReady")[0]).toEqual([
      "operation",
      id,
      view.stores.poll.getState().viewToken,
      true,
    ]);
    view.hostActions.close?.();
    expect(close).not.toHaveBeenCalled();
    ipc.emitView(id, { type: "BulkOperationRelease", operationToken: "other-operation" });
    expect(view.stores.ui.getState().bulkOperationToken).toBe("operation");
    ipc.emitView(id, { type: "BulkOperationRelease", operationToken: "operation" });
    view.hostActions.close?.();
    expect(close).toHaveBeenCalledOnce();
  });
  it("refuses a modal and accepts after it closes, regardless of dirty setup drafts", async () => {
    const { ipc, id } = await setup();
    const unlock = view.lockModal();
    ipc.emitView(id, { type: "BulkOperationPrepare", operationToken: "refused", action: "delete" });
    expect(ipc.callsOf("ackPollBulkReady")[0]?.[3]).toBe(false);
    expect(view.stores.ui.getState().bulkOperationToken).toBeNull();
    unlock();
    view.stores.ui.getState().setScaleDraft({ dirty: true, fields: {} });
    await Promise.resolve();
    ipc.emitView(id, {
      type: "BulkOperationPrepare",
      operationToken: "accepted",
      action: "delete",
    });
    expect(ipc.callsOf("ackPollBulkReady").at(-1)?.[3]).toBe(true);
  });
  it("native leases lock shortcuts and terminal removal releases the lock", async () => {
    const { ipc, id, layout } = await setup("native");
    ipc.emitView(id, { type: "BulkOperationPrepare", operationToken: "native", action: "delete" });
    expect(layout.getState().modalOpen).toBe(true);
    ipc.emitView(id, { type: "PollRemoved", pollId: id });
    expect(layout.getState().modalOpen).toBe(false);
    expect(view.stores.ui.getState().bulkOperationToken).toBeNull();
  });
});
