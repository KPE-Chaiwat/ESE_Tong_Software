import { createFakeModbusMasterIpc, pollConfigInput } from "./modbus-master.fake";
import type { PollId, SessionEvent } from "./modbus-master.types";

async function setup(count = 4) {
  const ipc = createFakeModbusMasterIpc({ mode: "manual" });
  const events: SessionEvent[] = [];
  await ipc.openSession((e) => events.push(e));
  const ids = [];
  for (let i = 0; i < count; i += 1)
    ids.push(
      await ipc.addPoll(pollConfigInput({ name: String.fromCharCode(65 + i) }), "workspace"),
    );
  events.length = 0;
  return { ipc, ids, events };
}
describe("bulk fake contract", () => {
  it("rejects empty, repeated and unknown ids without definitions changing", async () => {
    const { ipc, ids } = await setup();
    for (const input of [[], [ids[0] as PollId, ids[0] as PollId], [ids[0] as PollId, 999]])
      await expect(ipc.preparePollBulk("delete", input)).rejects.toBeDefined();
    expect(ipc.pollIds()).toEqual(ids);
  });
  it("orders server targets and copy block, publishes one list and replays the same token", async () => {
    const { ipc, ids, events } = await setup();
    const plan = await ipc.preparePollBulk("duplicate", [ids[2] as PollId, ids[0] as PollId]);
    expect(plan.targets.map((p) => p.config.pollId)).toEqual([ids[0], ids[2]]);
    const result = await ipc.duplicatePolls(plan.planToken);
    expect(result.created.map((p) => p.sourceId)).toEqual([ids[0], ids[2]]);
    expect(result.polls.map((p) => p.config.name)).toEqual([
      "A",
      "B",
      "C",
      "A copy",
      "C copy",
      "D",
    ]);
    expect(events.filter((e) => e.type === "PollListChanged")).toHaveLength(1);
    expect(await ipc.duplicatePolls(plan.planToken)).toEqual(result);
    expect(ipc.pollIds()).toHaveLength(6);
    expect(events.filter((e) => e.type === "PollListChanged")).toHaveLength(1);
  });
  it("15 + two rejects and 15 + one reaches exactly sixteen", async () => {
    const { ipc, ids } = await setup(15);
    await expect(ipc.preparePollBulk("duplicate", ids.slice(0, 2))).rejects.toMatchObject({
      code: "validation",
      field: "polls",
    });
    expect(ipc.pollIds()).toHaveLength(15);
    const plan = await ipc.preparePollBulk("duplicate", [ids[0] as PollId]);
    expect((await ipc.duplicatePolls(plan.planToken)).created).toHaveLength(1);
    expect(ipc.pollIds()).toHaveLength(16);
  });
  it("ABA definition changes invalidate the complete prepared set", async () => {
    const { ipc, ids } = await setup();
    const plan = await ipc.preparePollBulk("delete", ids.slice(0, 2));
    await ipc.renamePoll(ids[0] as PollId, "Renamed");
    await ipc.renamePoll(ids[0] as PollId, "A");
    await expect(ipc.removePolls(plan.planToken)).rejects.toMatchObject({
      message: "The selected polls changed. Review your selection and try again.",
    });
    expect(ipc.pollIds()).toEqual(ids);
  });
  it("counter/sample updates do not invalidate a plan and deleting all publishes one list", async () => {
    const { ipc, ids, events } = await setup();
    const plan = await ipc.preparePollBulk("delete", ids);
    ipc.emitPollUpdate(ids[0] as PollId, { values: Array(10).fill(5) });
    const result = await ipc.removePolls(plan.planToken);
    expect(result.removedIds).toEqual(ids);
    expect(result.polls).toEqual([]);
    expect(events.filter((e) => e.type === "PollListChanged")).toHaveLength(1);
    expect(ipc.callsOf("disconnect")).toHaveLength(0);
  });
  it("copies all persisted settings with fresh runtime values and auto-start intent", async () => {
    const { ipc } = await setup(0);
    const input = pollConfigInput({
      name: "Configured",
      aliases: [{ address: 0, alias: "Flow" }],
      display: {
        format: "unsigned32",
        swapBytes: true,
        reverseWords: true,
        addressBase: 1,
        showAlias: true,
        copyAlias: true,
      },
      colorRules: [
        {
          name: "High",
          enabled: true,
          range: null,
          source: "raw",
          comparison: "greaterThan",
          threshold: "100",
          upperThreshold: null,
          highlight: "warning",
        },
      ],
    });
    const id = await ipc.addPoll(input, "workspace");
    ipc.emitPollUpdate(id, { values: Array(10).fill(25) });
    await ipc.setAutoStartPoll(false);
    const plan = await ipc.preparePollBulk("duplicate", [id]);
    const result = await ipc.duplicatePolls(plan.planToken);
    const copy = ipc.pollSummary((result.created[0] as { pollId: PollId }).pollId);
    expect(copy.config).toMatchObject({ ...input, name: "Configured copy", active: false });
    expect(copy.counters.lastOkAt).toBeNull();
    expect(copy.counters.counters.requests).toBe(0);
  });
  it("refusing readiness aborts without a list and releases the lease", async () => {
    const { ipc, ids, events } = await setup(1);
    let token = 0;
    const viewEvents: string[] = [];
    const snapshot = await ipc.attachPollView(ids[0] as PollId, "workspace", (event) => {
      viewEvents.push(event.type);
      if (event.type === "BulkOperationPrepare")
        void ipc.ackPollBulkReady(event.operationToken, ids[0] as PollId, token, false);
    });
    token = snapshot.viewToken;
    const plan = await ipc.preparePollBulk("delete", ids);
    await expect(ipc.removePolls(plan.planToken)).rejects.toMatchObject({ field: "lifecycle" });
    expect(ipc.pollIds()).toEqual(ids);
    expect(events.filter((e) => e.type === "PollListChanged")).toHaveLength(0);
    expect(viewEvents).toContain("BulkOperationRelease");
    await expect(ipc.renamePoll(ids[0] as PollId, "Still here")).resolves.toBeUndefined();
  });
});
