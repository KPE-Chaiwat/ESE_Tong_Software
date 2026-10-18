import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { blurActiveEditor } from "../../runtime/clipboard";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement | null;
const popOutButton = (id: PollId) =>
  within(frame(id) as HTMLElement).getByRole("button", {
    name: "Open in its own window (Ctrl+Shift+O)",
  });

describe("pop out controls of a sub-window (DES-002 2.5.2)", () => {
  it("the title bar button pops the poll out; the sub-window goes when Rust has opened the window", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.user.click(popOutButton(a));
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    await waitFor(() => expect(frame(a)).toBeNull());
    expect(h.ipc.pollSummary(a).host).toBe("native");
    expect(screen.getByRole("option", { name: /^Pump 2,/ })).toHaveTextContent("own window");
    expect(screen.getByTestId("status-text")).toHaveTextContent("1 in its own window");
  });

  it("shows a spinner on the button and keeps the sub-window until the command answers (the backend's order)", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    // Rust has detached the view and listed the poll as native before it creates the window.
    const held = h.ipc.holdReply("popOutPoll");
    await h.user.click(popOutButton(a));
    await waitFor(() => expect(popOutButton(a)).toHaveAttribute("aria-disabled", "true"));
    expect(h.ipc.pollSummary(a).host).toBe("native");
    expect(popOutButton(a)).toHaveAttribute("aria-busy", "true");
    expect(popOutButton(a).querySelector('[data-icon="loader"]')).toBeInTheDocument();
    expect(frame(a)).not.toBeNull();
    // A second press does nothing.
    fireEvent.click(popOutButton(a));
    expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1);
    held.release();
    await waitFor(() => expect(frame(a)).toBeNull());
  });

  it("a failed pop out never removes the sub-window; it gets its view back", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    const first = h.rt.views.get(a);
    h.ipc.scriptPopOutFailure("boom");
    const held = h.ipc.holdReply("popOutPoll");
    await h.user.click(popOutButton(a));
    await waitFor(() => expect(popOutButton(a)).toHaveAttribute("aria-disabled", "true"));
    expect(frame(a)).not.toBeNull();
    held.release();
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    expect(frame(a)).not.toBeNull();
    await waitFor(() => expect(popOutButton(a)).not.toHaveAttribute("aria-disabled"));
    await waitFor(() => expect(h.rt.views.get(a)).not.toBe(first));
    await waitFor(() => expect(h.rt.views.get(a).stores.poll.getState().attach).toBe("attached"));
  });

  it("the title bar menu has 'Pop out to own window' and, in Move to, 'Own window (pop out)'", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    fireEvent.contextMenu(within(frame(a) as HTMLElement).getByRole("toolbar"), {
      clientX: 20,
      clientY: 20,
    });
    await h.user.click(await screen.findByRole("menuitem", { name: /^Move to/ }));
    expect(await screen.findByRole("menuitem", { name: /^Own window/ })).toBeVisible();
    await h.user.keyboard("{Escape}");
    await h.user.keyboard("{Escape}");
    fireEvent.contextMenu(within(frame(a) as HTMLElement).getByRole("toolbar"), {
      clientX: 20,
      clientY: 20,
    });
    await h.user.click(await screen.findByRole("menuitem", { name: /^Pop out to own window/ }));
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
  });

  it("the status line menu has 'Pop out to own window' with its shortcut", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.user.click(
      within(frame(a) as HTMLElement).getByRole("button", { name: "Poll actions" }),
    );
    const item = screen.getByRole("menuitem", { name: /^Pop out to own window/ });
    expect(item).toHaveTextContent("Ctrl+Shift+O");
    await h.user.click(item);
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
  });

  it("Ctrl+Shift+O pops out the sub-window that has the focus, not the selected row", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    h.rt.stores.pollList.getState().select(b);
    within(frame(a) as HTMLElement)
      .getByRole("button", { name: "Minimize" })
      .focus();
    fireEvent.keyDown(window, { key: "O", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    expect((h.ipc.callsOf("popOutPoll")[0] as unknown[])[0]).toBe(a);
  });

  it("is not possible while a dialog is open (the shortcut is off)", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    h.rt.stores.host.getState().requestClose(a);
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(window, { key: "O", ctrlKey: true, shiftKey: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("popOutPoll")).toHaveLength(0);
  });

  it("a failure shows the toast; the sub-window and its button are back", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    h.ipc.failNext("popOutPoll", "boom");
    await h.user.click(popOutButton(a));
    expect(await screen.findByText("Could not open the poll window: boom")).toBeVisible();
    expect(frame(a)).not.toBeNull();
    expect(popOutButton(a)).not.toHaveAttribute("aria-disabled");
  });

  it("the other sub-windows stay where they are", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    const rectOfB = h.rt.stores.workspace.getState().items[b]?.rect;
    await h.user.click(popOutButton(a));
    await waitFor(() => expect(frame(a)).toBeNull());
    expect(h.rt.stores.workspace.getState().items[b]?.rect).toEqual(rectOfB);
    expect(frame(b)).not.toBeNull();
  });

  it("in tile mode the remaining windows are tiled again", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    await h.addPoll("C");
    await h.act(() => h.rt.stores.workspace.getState().tile());
    await h.user.click(popOutButton(a));
    await waitFor(() => expect(frame(a)).toBeNull());
    // Two are left: side by side, 654 wide each... the 2 x 1 grid of the tile area.
    expect(h.rt.stores.workspace.getState().items[b]?.rect).toMatchObject({
      x: 8,
      y: 8,
      width: 654,
    });
  });
});

describe("blurActiveEditor (DES-002 2.5.4)", () => {
  it("blurs a text field, so a valid edit commits and an invalid one is reverted, before the move", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const blur = vi.fn();
    input.addEventListener("blur", blur);
    input.focus();
    blurActiveEditor();
    expect(blur).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it("blurs a textarea; leaves a button and the body alone", () => {
    const area = document.createElement("textarea");
    const button = document.createElement("button");
    document.body.append(area, button);
    area.focus();
    blurActiveEditor();
    expect(document.activeElement).not.toBe(area);
    button.focus();
    blurActiveEditor();
    expect(document.activeElement).toBe(button);
    area.remove();
    button.remove();
    expect(() => blurActiveEditor()).not.toThrow();
  });
});
