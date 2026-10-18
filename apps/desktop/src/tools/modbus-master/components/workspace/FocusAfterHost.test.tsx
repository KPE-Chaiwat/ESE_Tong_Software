// Where the keyboard focus lands after a dock, a Show and after a view closes (REV-006 m-7,
// DES-002 9, CHK2-F2).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;
const grid = (id: PollId) => within(frame(id)).getByRole("grid");

async function two() {
  h = await renderWindow();
  const a = await h.addPoll("A");
  const b = await h.addPoll("B");
  await h.connect();
  h.advance(300);
  return { a, b };
}

describe("after a dock or a Show", () => {
  it("a docked poll gets the focus in its data grid once the view has attached", async () => {
    const { a } = await two();
    await h.act(() =>
      h.ipc.popOutPoll(a, { kind: "rect", rect: { x: 0, y: 0, width: 600, height: 400 } }, null),
    );
    await waitFor(() => expect(document.querySelector(`[data-subwindow="${a}"]`)).toBeNull());
    await h.act(() => h.ipc.dockPoll(a, null, false, null));
    await waitFor(() => expect(frame(a)).not.toBeNull());
    await waitFor(() => expect(grid(a)).toHaveFocus());
  });

  it("a poll that is shown again (closed, kept) gets the focus in its grid", async () => {
    const { a } = await two();
    await h.act(() => h.ipc.closePollView(a, true));
    await waitFor(() => expect(document.querySelector(`[data-subwindow="${a}"]`)).toBeNull());
    await h.act(() => h.rt.actions.showPoll(a));
    await waitFor(() => expect(frame(a)).not.toBeNull());
    await waitFor(() => expect(grid(a)).toHaveFocus());
  });

  it("without a grid (not connected) the title bar gets it once the view has attached", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.act(() => h.ipc.closePollView(a, true));
    await h.act(() => h.rt.actions.showPoll(a));
    await waitFor(() => expect(frame(a)).not.toBeNull());
    await waitFor(() => expect(frame(a).querySelector('[data-slot="title-bar"]')).toHaveFocus());
  });
});

describe("after a view closes", () => {
  it("Keep: the focus goes to the other sub-window, not to the page", async () => {
    const { a, b } = await two();
    grid(b).focus();
    fireEvent.keyDown(grid(b), { key: "F4", ctrlKey: true });
    const dialog = await screen.findByRole("alertdialog");
    await h.user.click(within(dialog).getByRole("button", { name: "Keep poll" }));
    await waitFor(() => expect(document.querySelector(`[data-subwindow="${b}"]`)).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(frame(a).contains(document.activeElement)).toBe(true);
  });

  it("Delete of the last sub-window: the focus goes to the surviving poll Show target", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.addPoll("B");
    await h.act(() => h.rt.stores.pollList.getState().select(a));
    await h.act(() => h.ipc.closePollView(h.ipc.pollIds()[1] as number, true));
    (frame(a).querySelector('[data-slot="title-bar"]') as HTMLElement).focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "F4", ctrlKey: true });
    const dialog = await screen.findByRole("alertdialog");
    await h.user.click(within(dialog).getByRole("button", { name: "Delete poll" }));
    await waitFor(() => expect(document.querySelector(`[data-subwindow="${a}"]`)).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toHaveAttribute("data-poll-show");
    expect(document.activeElement?.closest("[data-region]")?.getAttribute("data-region")).toBe(
      "polls",
    );
  });

  it("pop out: the focus does not fall to the page", async () => {
    const { a } = await two();
    grid(a).focus();
    fireEvent.keyDown(grid(a), { key: "O", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(document.querySelector(`[data-subwindow="${a}"]`)).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });
});
