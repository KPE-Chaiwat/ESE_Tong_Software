import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const list = () => screen.getByRole("listbox", { name: "Polls" });
const row = (name: RegExp | string) => within(list()).getByRole("option", { name });
const rowNames = () =>
  within(list())
    .getAllByRole("option")
    .map((r) => r.getAttribute("aria-label")?.split(",")[0]);
const frame = (id: PollId) =>
  document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement | null;
const live = () => screen.getByTestId("live-polite");

async function menuOf(name: string) {
  await h.user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
}
const item = (name: RegExp | string) => screen.getByRole("menuitem", { name });

describe("row actions (DES-002 2.2.3)", () => {
  it("F2 renames in place: the field holds the name, Enter sends it, the row shows the new name", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank");
    row(/^Tank,/).focus();
    fireEvent.keyDown(row(/^Tank,/), { key: "F2" });
    const input = within(list()).getByRole("textbox", { name: "Poll name" });
    expect(input).toHaveValue("Tank");
    expect(input).toHaveFocus();
    await h.user.clear(input);
    await h.user.type(input, "Boiler{Enter}");
    await waitFor(() => expect(h.ipc.callsOf("renamePoll")).toEqual([[a, "Boiler"]]));
    await waitFor(() => expect(within(list()).queryByRole("textbox")).not.toBeInTheDocument());
    expect(row(/^Boiler,/)).toBeVisible();
    // The focus is back on the row.
    await waitFor(() => expect(row(/^Boiler,/)).toHaveFocus());
  });

  it("an invalid name keeps the field open with the message (DES-002 4)", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    await h.addPoll("Pump");
    fireEvent.keyDown(row(/^Tank,/), { key: "F2" });
    const input = within(list()).getByRole("textbox", { name: "Poll name" });
    await h.user.clear(input);
    await h.user.type(input, "pump{Enter}");
    expect(await within(list()).findByRole("alert")).toHaveTextContent(
      'A poll named "pump" already exists on this connection.',
    );
    expect(h.ipc.callsOf("renamePoll")).toHaveLength(0);
    await h.user.clear(input);
    await h.user.type(input, "{Enter}");
    expect(await within(list()).findByRole("alert")).toHaveTextContent("Enter a poll name.");
  });

  it("Esc leaves the name as it was", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    fireEvent.keyDown(row(/^Tank,/), { key: "F2" });
    const input = within(list()).getByRole("textbox", { name: "Poll name" });
    await h.user.type(input, "xyz{Escape}");
    expect(within(list()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(h.ipc.callsOf("renamePoll")).toHaveLength(0);
    expect(row(/^Tank,/)).toBeVisible();
  });

  it("a blur sends a valid name and reverts an invalid one", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank");
    fireEvent.keyDown(row(/^Tank,/), { key: "F2" });
    let input = within(list()).getByRole("textbox", { name: "Poll name" });
    await h.user.clear(input);
    await h.user.type(input, "Boiler");
    fireEvent.blur(input);
    await waitFor(() => expect(h.ipc.callsOf("renamePoll")).toEqual([[a, "Boiler"]]));
    fireEvent.keyDown(row(/^Boiler,/), { key: "F2" });
    input = within(list()).getByRole("textbox", { name: "Poll name" });
    await h.user.clear(input);
    fireEvent.blur(input);
    await waitFor(() => expect(within(list()).queryByRole("textbox")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("renamePoll")).toHaveLength(1);
  });

  it("the menu entry Rename opens the same field", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    await menuOf("Tank");
    await h.user.click(item(/^Rename/));
    expect(within(list()).getByRole("textbox", { name: "Poll name" })).toHaveValue("Tank");
  });

  it("clicking in the rename field does not show the poll", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    fireEvent.keyDown(row(/^Tank,/), { key: "F2" });
    const input = within(list()).getByRole("textbox", { name: "Poll name" });
    await h.user.click(input);
    expect(h.ipc.callsOf("showPoll")).toHaveLength(0);
    expect(within(list()).getByRole("textbox", { name: "Poll name" })).toBeVisible();
  });

  it("Duplicate from the menu sends it and selects the copy, which sits after the source", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    await h.addPoll("Pump");
    await menuOf("Tank");
    await h.user.click(item("Duplicate"));
    await waitFor(() => expect(h.ipc.callsOf("duplicatePoll")).toHaveLength(1));
    await waitFor(() => expect(rowNames()).toEqual(["Tank", "Tank copy", "Pump"]));
    expect(row(/^Tank copy,/)).toHaveAttribute("aria-selected", "true");
  });

  it("Duplicate is off at 16 polls, with the title", async () => {
    h = await renderWindow();
    for (let i = 1; i <= 16; i += 1) await h.addPoll(`P${i}`);
    await menuOf("P1");
    expect(item("Duplicate")).toHaveAttribute("aria-disabled", "true");
    expect(item("Duplicate")).toHaveAttribute("title", "A connection can have at most 16 polls.");
  });

  it("Show traffic for this poll expands the traffic panel with that filter", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    const b = await h.addPoll("Pump");
    expect(h.rt.stores.workspace.getState().traffic.expanded).toBe(false);
    await menuOf("Pump");
    await h.user.click(item("Show traffic for this poll"));
    expect(h.rt.stores.workspace.getState().traffic.expanded).toBe(true);
    expect(h.rt.stores.traffic.getState().filter).toEqual({ kind: "poll", pollId: b });
  });

  it("Shift+F10 and the menu key open the row menu; Esc closes it and the focus returns to the row", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    row(/^Tank,/).focus();
    fireEvent.keyDown(row(/^Tank,/), { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menu", { name: "Actions for Tank" })).toBeVisible();
    await h.user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(row(/^Tank,/)).toHaveFocus());
    fireEvent.keyDown(row(/^Tank,/), { key: "ContextMenu" });
    expect(await screen.findByRole("menu", { name: "Actions for Tank" })).toBeVisible();
  });

  it("the Delete key asks to delete", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    fireEvent.keyDown(row(/^Tank,/), { key: "Delete" });
    expect(await screen.findByRole("alertdialog")).toBeVisible();
  });

  it("the grip icon is on every row (shown on hover and focus)", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    expect(row(/^Tank,/).querySelector('[data-icon="grip-vertical"]')).toBeInTheDocument();
  });

  it("the Delete entry opens the Delete poll dialog and does not show the poll", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    await menuOf("Tank");
    await h.user.click(item(/^Delete…/));
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    expect(h.ipc.callsOf("showPoll")).toHaveLength(0);
  });

  it("choosing an entry of the menu does not also show the poll (the menu is in a portal)", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank");
    await h.addPoll("Pump");
    // Pump is the active sub-window; Tank's menu entry must not bring Tank to the front.
    await menuOf("Tank");
    await h.user.click(item("Show traffic for this poll"));
    expect(frame(a)).not.toHaveAttribute("aria-current", "true");
  });
});

describe("reorder from the keyboard (DES-002 2.10.8)", () => {
  async function four() {
    h = await renderWindow();
    const ids: PollId[] = [];
    for (const n of ["A", "B", "C", "D"]) ids.push(await h.addPoll(n));
    return ids as [PollId, PollId, PollId, PollId];
  }

  it("Alt+Down moves the row one place, announces it, and keeps the focus on the row", async () => {
    const [a, b, c, d] = await four();
    row(/^B,/).focus();
    fireEvent.keyDown(row(/^B,/), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(h.ipc.callsOf("reorderPolls")).toEqual([[[a, c, b, d]]]));
    expect(rowNames()).toEqual(["A", "C", "B", "D"]);
    expect(live()).toHaveTextContent("B moved to position 3 of 4.");
    await waitFor(() => expect(row(/^B,/)).toHaveFocus());
  });

  it("Alt+Up moves it up; on the first row it does nothing and says nothing", async () => {
    const [a, b, c, d] = await four();
    fireEvent.keyDown(row(/^C,/), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(h.ipc.callsOf("reorderPolls")).toEqual([[[a, c, b, d]]]));
    expect(live()).toHaveTextContent("C moved to position 2 of 4.");

    fireEvent.keyDown(row(/^A,/), { key: "ArrowUp", altKey: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(1);
  });

  it("Alt+Down on the last row does nothing", async () => {
    await four();
    fireEvent.keyDown(row(/^D,/), { key: "ArrowDown", altKey: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(0);
  });

  it("the arrow keys alone still move the selection", async () => {
    await four();
    row(/^A,/).focus();
    h.rt.stores.pollList.getState().select(h.ipc.pollIds()[0] as PollId);
    fireEvent.keyDown(row(/^A,/), { key: "ArrowDown" });
    await waitFor(() => expect(row(/^B,/)).toHaveAttribute("aria-selected", "true"));
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(0);
  });

  it("the menu entries Move up and Move down do the same", async () => {
    const [a, b, c, d] = await four();
    await menuOf("A");
    expect(item(/^Move up/)).toHaveAttribute("aria-disabled", "true");
    await h.user.click(item(/^Move down/));
    await waitFor(() => expect(h.ipc.callsOf("reorderPolls")).toEqual([[[b, a, c, d]]]));
    expect(live()).toHaveTextContent("A moved to position 2 of 4.");
  });

  it("the reorder does not mark the profile Modified", async () => {
    await four();
    h.clean();
    fireEvent.keyDown(row(/^B,/), { key: "ArrowDown", altKey: true });
    await h.act(async () => {});
    expect(h.rt.stores.profile.getState().modified).toBe(false);
  });

  it("a rejected reorder puts the rows back and shows the error", async () => {
    await four();
    h.ipc.failNext("reorderPolls", "no way");
    fireEvent.keyDown(row(/^B,/), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(screen.getByText("no way")).toBeVisible());
    expect(rowNames()).toEqual(["A", "B", "C", "D"]);
    expect(live()).not.toHaveTextContent("moved to position");
  });
});

describe("copy (DES-002 3.2)", () => {
  it("Ctrl+C copies the row as a tab separated line and says so", async () => {
    h = await renderWindow();
    await h.addPoll("Tank 1", {
      definition: { slaveId: 3, function: 4, startAddress: 0, quantity: 8, scanRateMs: 200 },
    });
    row(/^Tank 1,/).focus();
    fireEvent.keyDown(row(/^Tank 1,/), { key: "c", ctrlKey: true });
    await waitFor(() => expect(h.copied).toEqual(["Tank 1\t3\tFC04\t0-7\t200 ms\tOffline"]));
    expect(await screen.findByText("Copied 1 row.")).toBeVisible();
  });
});

describe("the host entries of the row menu", () => {
  it("Pop out to own window pops the sub-window out: the anchor is its rectangle, the row says own window", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank");
    await menuOf("Tank");
    await h.user.click(item(/^Pop out to own window/));
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    const [id, anchor] = h.ipc.callsOf("popOutPoll")[0] as [
      PollId,
      { kind: string; rect: unknown },
    ];
    expect(id).toBe(a);
    expect(anchor).toEqual({ kind: "rect", rect: { x: 8, y: 8, width: 640, height: 368 } });
    await waitFor(() => expect(frame(a)).toBeNull());
    expect(row(/^Tank,/)).toHaveTextContent("own window");
    expect(live()).toHaveTextContent("Tank opened in its own window.");
  });

  it("a poll in its own window offers Dock to workspace; it asks that window for its handoff", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank", {}, "native");
    await menuOf("Tank");
    expect(screen.queryByRole("menuitem", { name: /^Pop out/ })).not.toBeInTheDocument();
    await h.user.click(item("Dock to workspace"));
    await waitFor(() => expect(frame(a)).not.toBeNull());
    expect(h.ipc.callsOf("dockPoll")).toEqual([[a, null, true, null]]);
    expect(live()).toHaveTextContent("Tank docked in the workspace.");
  });

  it("Show in workspace reopens a closed poll that was in its own window", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank", {}, "native");
    await h.act(() => h.ipc.closePollView(a, true));
    await menuOf("Tank");
    expect(item("Show")).toBeVisible();
    await h.user.click(item("Show in workspace"));
    await waitFor(() => expect(h.ipc.callsOf("showPoll")).toHaveLength(1));
    expect(h.ipc.callsOf("showPoll")[0]).toEqual([a, null]);
  });

  it("Ctrl+Shift+O pops out the selected row's poll", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank");
    row(/^Tank,/).focus();
    fireEvent.keyDown(window, { key: "O", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    expect((h.ipc.callsOf("popOutPoll")[0] as unknown[])[0]).toBe(a);
  });

  it("a failed pop out shows the toast and the sub-window comes back", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank");
    h.ipc.scriptPopOutFailure("boom");
    await menuOf("Tank");
    await h.user.click(item(/^Pop out to own window/));
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    await waitFor(() => expect(frame(a)).not.toBeNull());
    expect(row(/^Tank,/)).not.toHaveTextContent("own window");
    // No false "docked" announcement for the host that went back.
    expect(live()).not.toHaveTextContent("docked");
  });
});
