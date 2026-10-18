import { screen, waitFor, within } from "@testing-library/react";
import { IpcError } from "@/shared/ipc/errors";
import type { PollBulkResult, PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;
afterEach(() => h?.rt.dispose());
const select = (name: string) =>
  h.user.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
const duplicate = () => screen.getByRole("button", { name: "Duplicate selected" });
const remove = () => screen.getByRole("button", { name: "Delete selected…" });
async function setup() {
  h = await renderWindow();
  const ids: PollId[] = [];
  for (const name of ["A", "B", "C", "D"]) ids.push(await h.addPoll(name));
  h.clean();
  return ids;
}
describe("bulk sidebar transactions", () => {
  it("empty selection sends no request; selecting leaves the profile clean", async () => {
    await setup();
    await h.user.click(duplicate());
    expect(h.ipc.callsOf("preparePollBulk")).toHaveLength(0);
    await select("A");
    expect(h.rt.stores.profile.getState().modified).toBe(false);
  });
  it("duplicates nonadjacent sources in one ordered block and keeps sources selected", async () => {
    const ids = await setup();
    await select("A");
    await select("C");
    await h.user.click(duplicate());
    await waitFor(() => expect(h.ipc.pollIds()).toHaveLength(6));
    expect(h.ipc.pollIds().map((id) => h.ipc.pollSummary(id).config.name)).toEqual([
      "A",
      "B",
      "C",
      "A copy",
      "C copy",
      "D",
    ]);
    expect(h.ipc.callsOf("duplicatePolls")).toHaveLength(1);
    expect(h.ipc.callsOf("duplicatePoll")).toHaveLength(0);
    expect([...h.rt.stores.pollSelection.getState().selectedIds]).toEqual([ids[0], ids[2]]);
    expect(h.ipc.callsOf("ackPollBulkReady")).toHaveLength(2);
    expect(h.rt.stores.profile.getState().modified).toBe(true);
    expect(h.rt.stores.layout.getState().modalOpen).toBe(false);
  });
  it("rejects full-set capacity without IPC or partial copies", async () => {
    await setup();
    for (let i = 4; i < 15; i += 1) await h.addPoll(`P${i}`);
    await select("A");
    await select("B");
    await h.user.click(duplicate());
    expect(screen.getByRole("alert", { name: "Bulk action error" })).toHaveTextContent(
      "Cannot duplicate 2 polls. This connection has room for 1 more (maximum 16).",
    );
    expect(h.ipc.pollIds()).toHaveLength(15);
    expect(h.ipc.callsOf("preparePollBulk")).toHaveLength(0);
  });
  it("one confirmation lists frozen full names; Cancel preserves definitions and selection", async () => {
    const ids = await setup();
    await select("A");
    await select("C");
    await h.user.click(remove());
    const dialog = await screen.findByRole("alertdialog", { name: "Delete 2 polls?" });
    expect(within(dialog).getByText("A")).toBeVisible();
    expect(within(dialog).getByText("C")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "New poll", hidden: true })).toBeDisabled();
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(h.ipc.pollIds()).toEqual(ids);
    expect(h.rt.stores.pollSelection.getState().selectedIds.size).toBe(2);
    expect(h.ipc.callsOf("removePolls")).toHaveLength(0);
  });
  it("deletes one set atomically, prunes selection and focuses the following survivor", async () => {
    const ids = await setup();
    await select("A");
    await select("C");
    await h.user.click(remove());
    await h.user.click(await screen.findByRole("button", { name: "Delete 2 polls" }));
    await waitFor(() => expect(h.ipc.pollIds()).toEqual([ids[1], ids[3]]));
    expect(h.ipc.callsOf("removePolls")).toHaveLength(1);
    expect(h.ipc.callsOf("removePoll")).toHaveLength(0);
    expect(h.rt.stores.pollSelection.getState().selectedIds.size).toBe(0);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select D" })).toHaveFocus());
  });
  it("all/last deletion leaves an open session with zero polls", async () => {
    await setup();
    await h.user.click(screen.getByRole("button", { name: "Select all" }));
    await h.user.click(remove());
    await h.user.click(await screen.findByRole("button", { name: "Delete 4 polls" }));
    await waitFor(() => expect(h.ipc.pollIds()).toHaveLength(0));
    expect(h.ipc.callsOf("disconnect")).toHaveLength(0);
    expect(screen.getAllByText(/No polls yet/)).toHaveLength(2);
  });
  it("target edits invalidate a confirmation and require a new plan", async () => {
    const ids = await setup();
    await select("A");
    await h.user.click(remove());
    await screen.findByRole("alertdialog");
    await h.act(() => h.ipc.renamePoll(ids[0] as PollId, "Changed"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Bulk action error" })).toHaveTextContent(
      "The selected polls changed. Review your selection and try again.",
    );
    expect(h.ipc.callsOf("removePolls")).toHaveLength(0);
  });
  it("precommit refusal preserves definitions and releases locks", async () => {
    const ids = await setup();
    await select("A");
    const release = h.rt.views.get(ids[0] as PollId).lockModal();
    // A preexisting modal also prevents opening a new coordinator operation.
    await h.user.click(duplicate());
    expect(h.ipc.callsOf("preparePollBulk")).toHaveLength(0);
    release();
    h.ipc.failNext(
      "duplicatePolls",
      new IpcError(
        "Close dialogs in the selected poll windows and try again.",
        "validation",
        "lifecycle",
      ),
    );
    await h.user.click(duplicate());
    await waitFor(() =>
      expect(screen.getByRole("alert", { name: "Bulk action error" })).toHaveTextContent(
        "Close dialogs",
      ),
    );
    expect(h.ipc.pollIds()).toEqual(ids);
    expect(h.rt.stores.layout.getState().modalOpen).toBe(false);
  });
  it("committed window issues keep definitions and recovery never repeats duplication", async () => {
    await setup();
    await select("A");
    const polls = h.rt.stores.pollList.getState();
    const result: PollBulkResult = {
      operationToken: "recovery-test",
      action: "duplicate",
      definitionsCommitted: true,
      created: [],
      removedIds: [],
      polls: polls.order.map((id) => polls.polls[id] as NonNullable<(typeof polls.polls)[number]>),
      issues: [
        {
          pollId: polls.order[0] as PollId,
          stage: "show",
          code: "internal",
          message: "Window unavailable",
          recovery: "showPoll",
        },
      ],
    };
    h.ipc.setResult("duplicatePolls", result);
    await h.user.click(duplicate());
    await screen.findByText("Settings were updated. Some poll windows need attention.");
    await h.user.click(screen.getByRole("button", { name: "Show A" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Settings were updated. Some poll windows need attention."),
      ).not.toBeInTheDocument(),
    );
    expect(h.ipc.callsOf("duplicatePolls")).toHaveLength(1);
    expect(h.ipc.callsOf("showPoll")).toHaveLength(1);
  });
  it("a busy action submits once even when its reply is delayed", async () => {
    await setup();
    await select("A");
    const held = h.ipc.holdReply("duplicatePolls");
    await h.user.click(duplicate());
    await waitFor(() => expect(h.ipc.pollIds()).toHaveLength(5));
    expect(screen.getByRole("button", { name: "Duplicating\u2026" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await h.act(() => h.rt.stores.pollBulk.getState().duplicateSelected());
    expect(h.ipc.callsOf("duplicatePolls")).toHaveLength(1);
    await h.act(() => held.release());
    await waitFor(() => expect(duplicate()).toHaveAttribute("aria-disabled", "false"));
  });
  it("a lost committed response retries the same token and creates copies only once", async () => {
    await setup();
    await select("A");
    const original = h.ipc.duplicatePolls;
    let lost = true;
    h.ipc.duplicatePolls = async (token) => {
      const result = await original(token);
      if (lost) {
        lost = false;
        throw new IpcError("Response lost", "unknown");
      }
      return result;
    };
    await h.user.click(duplicate());
    await waitFor(() => expect(h.rt.stores.pollBulk.getState().phase).toBe("idle"));
    expect(h.ipc.pollIds()).toHaveLength(5);
    const calls = h.ipc.callsOf("duplicatePolls");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(h.ipc.callsOf("preparePollBulk")).toHaveLength(1);
  });
  it("committed delete cleanup retries only orphan window cleanup", async () => {
    await setup();
    await select("A");
    const original = h.ipc.removePolls;
    h.ipc.removePolls = async (token) => {
      const result = await original(token);
      return {
        ...result,
        issues: [
          {
            pollId: result.removedIds[0] as PollId,
            stage: "destroy",
            code: "internal",
            message: "Window still open",
            recovery: "retryWindowCleanup",
          },
        ],
      };
    };
    await h.user.click(remove());
    await h.user.click(await screen.findByRole("button", { name: "Delete 1 poll" }));
    await h.user.click(await screen.findByRole("button", { name: "Retry window cleanup" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Retry window cleanup" }),
      ).not.toBeInTheDocument(),
    );
    expect(h.ipc.pollIds()).toHaveLength(3);
    expect(h.ipc.callsOf("removePolls")).toHaveLength(1);
    expect(h.ipc.callsOf("recoverPollBulkWindows")).toHaveLength(1);
  });
});
