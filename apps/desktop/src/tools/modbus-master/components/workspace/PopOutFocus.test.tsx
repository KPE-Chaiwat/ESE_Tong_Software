// Focus after a failed pop out (REPORT-007 D9, CHK2-F16 "focus kept", DES-002 2.5.2 step 5): the
// button is busy with aria-disabled (never `disabled`), so it keeps the focus; a shortcut gets the
// grid back (the view of the sub-window is replaced); a menu returns it to its button or row.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;
const popOutButton = (id: PollId) =>
  within(frame(id)).getByRole("button", { name: "Open in its own window (Ctrl+Shift+O)" });
const grid = (id: PollId) => within(frame(id)).getByRole("grid");
const titleBar = (id: PollId) => frame(id).querySelector('[data-slot="title-bar"]') as HTMLElement;

/** The focus falls to the page body (the old view's grid is removed, a menu closes). */
function loseFocus() {
  act(() => {
    const tmp = document.createElement("button");
    document.body.append(tmp);
    tmp.focus();
    tmp.remove();
  });
}

async function connectedPoll() {
  h = await renderWindow();
  const a = await h.addPoll("Pump 2", {
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
  });
  await h.connect();
  h.advance(300);
  return a;
}

/** Arms a failure that answers when released, and returns the release. */
function failing() {
  h.ipc.scriptPopOutFailure("boom");
  return h.ipc.holdReply("popOutPoll");
}

describe("a failed pop out keeps the focus", () => {
  it("the busy button keeps the focus (aria-disabled, not disabled) and has it after the failure", async () => {
    const a = await connectedPoll();
    const held = failing();
    await h.user.click(popOutButton(a));
    await waitFor(() => expect(popOutButton(a)).toHaveAttribute("aria-busy", "true"));
    expect(popOutButton(a)).toHaveAttribute("aria-disabled", "true");
    expect(popOutButton(a)).not.toBeDisabled();
    expect(popOutButton(a)).toHaveFocus();
    // A second press while busy does nothing.
    fireEvent.click(popOutButton(a));
    expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1);
    held.release();
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    await waitFor(() => expect(popOutButton(a)).not.toHaveAttribute("aria-disabled"));
    expect(popOutButton(a)).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("the grid has the focus again after Ctrl+Shift+O failed and the view was replaced", async () => {
    const a = await connectedPoll();
    const first = h.rt.views.get(a);
    grid(a).focus();
    const held = failing();
    fireEvent.keyDown(grid(a), { key: "O", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    // The view of the frame goes away with the failed pop out, and the focus with it.
    loseFocus();
    held.release();
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    await waitFor(() => expect(h.rt.views.get(a)).not.toBe(first));
    await waitFor(() => expect(h.rt.views.get(a).stores.poll.getState().attach).toBe("attached"));
    h.advance(300);
    await waitFor(() => expect(grid(a)).toHaveFocus());
  });

  it("a shortcut from another control returns the focus to that control", async () => {
    const a = await connectedPoll();
    const minimize = within(frame(a)).getByRole("button", { name: "Minimize" });
    minimize.focus();
    const held = failing();
    fireEvent.keyDown(minimize, { key: "O", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    loseFocus();
    held.release();
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    await waitFor(() => expect(minimize).toHaveFocus());
  });

  it("the sub-window menu returns the focus to the Poll actions button", async () => {
    const a = await connectedPoll();
    h.ipc.scriptPopOutFailure("boom");
    await h.user.click(within(frame(a)).getByRole("button", { name: "Poll actions" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Pop out to own window/ }));
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    await waitFor(() =>
      expect(within(frame(a)).getByRole("button", { name: "Poll actions" })).toHaveFocus(),
    );
  });

  it("the title bar menu returns the focus to the title bar", async () => {
    const a = await connectedPoll();
    h.ipc.scriptPopOutFailure("boom");
    fireEvent.contextMenu(titleBar(a), { clientX: 20, clientY: 20 });
    await h.user.click(await screen.findByRole("menuitem", { name: /^Pop out to own window/ }));
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    await waitFor(() => expect(titleBar(a)).toHaveFocus());
  });

  it("the sidebar menu returns the focus to the poll Show target", async () => {
    const a = await connectedPoll();
    h.ipc.scriptPopOutFailure("boom");
    const row = document.querySelector<HTMLElement>(
      `[data-region="sidebar"] [data-slot="poll-row"][data-poll-id="${a}"]`,
    ) as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    await h.user.click(await screen.findByRole("menuitem", { name: /^Pop out/ }));
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    await waitFor(() => expect(row.querySelector("[data-poll-show]")).toHaveFocus());
  });

  it("a control that took the focus meanwhile keeps it", async () => {
    const a = await connectedPoll();
    const held = failing();
    await h.user.click(popOutButton(a));
    await waitFor(() => expect(popOutButton(a)).toHaveAttribute("aria-busy", "true"));
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    held.release();
    await waitFor(() => expect(popOutButton(a)).not.toHaveAttribute("aria-disabled"));
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("a pop out that works removes the sub-window", async () => {
    const a = await connectedPoll();
    await h.user.click(popOutButton(a));
    await waitFor(() => expect(document.querySelector(`[data-subwindow="${a}"]`)).toBeNull());
  });
});
