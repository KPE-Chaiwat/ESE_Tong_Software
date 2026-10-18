import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const workspace = () => screen.getByRole("region", { name: "Workspace" });
const frame = (id: PollId) =>
  workspace().querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;
const frames = () => Array.from(workspace().querySelectorAll<HTMLElement>("[data-subwindow]"));
const box = (el: HTMLElement) => ({
  left: Number.parseFloat(el.style.left),
  top: Number.parseFloat(el.style.top),
  width: Number.parseFloat(el.style.width),
  height: Number.parseFloat(el.style.height),
});
const menuItem = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const checkItem = (name: string | RegExp) => screen.getByRole("menuitemcheckbox", { name });

async function openWindowMenu() {
  await h.user.click(screen.getByRole("button", { name: "Window" }));
}

describe("empty workspace texts (DES-002 2.2.4)", () => {
  it("no polls at all: the text and a New poll button", async () => {
    h = await renderWindow();
    expect(
      screen.getAllByText(/^No polls yet\. Press New poll \(Ctrl\+Shift\+N\)/),
    ).not.toHaveLength(0);
    expect(within(workspace()).getByTestId("workspace-empty")).toHaveTextContent(
      "No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection.",
    );
    await h.user.click(within(workspace()).getByRole("button", { name: "New poll" }));
    await waitFor(() => expect(frames()).toHaveLength(1));
    expect(within(workspace()).queryByTestId("workspace-empty")).not.toBeInTheDocument();
  });

  it("polls exist but none is shown: the second text, and the count of polls in their own windows", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.act(() => h.ipc.closePollView(a, true));
    expect(within(workspace()).getByTestId("workspace-empty")).toHaveTextContent(
      "No poll is shown in the workspace. Click a poll in the list, or drag it here.",
    );
    await h.addPoll("B", {}, "native");
    expect(within(workspace()).getByText("1 poll is open in its own window.")).toBeVisible();
    await h.addPoll("C", {}, "native");
    expect(within(workspace()).getByText("2 polls are open in their own windows.")).toBeVisible();
  });

  it("only minimized sub-windows: no text, the minimized bar is visible", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.act(() => h.rt.stores.workspace.getState().minimize(a));
    expect(within(workspace()).queryByTestId("workspace-empty")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Minimized windows" })).toBeVisible();
  });
});

describe("the sub-window frame (DES-002 2.3.1)", () => {
  it("is a region named '{name}, {pill}, sub-window' with the title bar buttons and their tooltips", async () => {
    h = await renderWindow();
    const id = await h.addPoll("Tank 1 temperatures");
    const f = frame(id);
    expect(f).toHaveAttribute("aria-roledescription", "sub-window");
    expect(f).toHaveAttribute("aria-label", "Tank 1 temperatures, Offline, sub-window");
    const bar = within(f).getByRole("toolbar");
    expect(within(bar).getByText("Tank 1 temperatures")).toBeVisible();
    for (const label of [
      "Poll setup (Ctrl+\\)",
      "Open in its own window (Ctrl+Shift+O)",
      "Minimize",
      "Maximize",
      "Close (Ctrl+F4)",
    ]) {
      const button = within(bar).getByRole("button", { name: label });
      expect(button).toHaveAttribute("title", label);
    }
  });

  it("the new sub-window is at (8, 8) at 640 x 368 and active; the next one steps 24 px", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 640, height: 368 });
    expect(box(frame(b))).toEqual({ left: 32, top: 32, width: 640, height: 368 });
    expect(frame(b)).toHaveAttribute("aria-current", "true");
    expect(frame(a)).not.toHaveAttribute("aria-current");
  });

  it("the active frame has a 2 px dark border and a dark title bar; the inactive one a light bar", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    expect(frame(b).className).toContain("border-2");
    expect(frame(a).className).toContain("border-[1.5px]");
    expect(within(frame(b)).getByRole("toolbar").className).toContain("bg-dark");
    expect(within(frame(a)).getByRole("toolbar").className).toContain("bg-light");
  });

  it("the state chip and the counters show in the status line of the shared PollView", async () => {
    h = await renderWindow();
    const id = await h.addPoll("A", {
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
    });
    await h.connect();
    h.advance(300);
    const line = within(frame(id)).getByTestId("poll-status-line");
    expect(line).toHaveTextContent("Polling");
    expect(within(line).getByTestId("status-counters")).toHaveTextContent(
      /Tx \d+ · Err 0 · ID 1 · F 03 · SR 100 ms/,
    );
  });

  it("pressing a frame raises and activates it and the sidebar selection follows", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    expect(h.rt.stores.workspace.getState().activeId).toBe(b);
    fireEvent.pointerDown(within(frame(a)).getByTestId("poll-status-line"), { button: 0 });
    expect(frame(a)).toHaveAttribute("aria-current", "true");
    expect(frame(b)).not.toHaveAttribute("aria-current");
    expect(Number(frame(a).style.zIndex)).toBeGreaterThan(Number(frame(b).style.zIndex));
    expect(h.rt.stores.pollList.getState().selectedId).toBe(a);
  });
});

describe("minimize, maximize, restore", () => {
  it("minimizing hides the frame, shows the pill with the state chip and activates the next one", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    await h.user.click(within(frame(b)).getByRole("button", { name: "Minimize" }));
    expect(frame(b)).toBeNull();
    const bar = screen.getByRole("region", { name: "Minimized windows" });
    expect(within(bar).getByText("Minimized")).toBeVisible();
    expect(within(bar).getByRole("button", { name: /B · Offline/ })).toBeVisible();
    expect(frame(a)).toHaveAttribute("aria-current", "true");
  });

  it("clicking the pill restores the window and removes the bar", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    const b = await h.addPoll("B");
    await h.user.click(within(frame(b)).getByRole("button", { name: "Minimize" }));
    await h.user.click(screen.getByRole("button", { name: /B · Offline/ }));
    expect(frame(b)).toBeVisible();
    expect(screen.queryByRole("region", { name: "Minimized windows" })).not.toBeInTheDocument();
  });

  it("maximize fills the tile area and the button becomes Restore; double-click on the title bar restores", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.user.click(within(frame(a)).getByRole("button", { name: "Maximize" }));
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 1316, height: 700 });
    expect(within(frame(a)).getByRole("button", { name: "Restore" })).toBeVisible();
    await h.user.dblClick(within(frame(a)).getByRole("toolbar"));
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 640, height: 368 });
  });

  it("a maximized window has no resize handles", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    expect(frame(a).querySelectorAll("[data-resize-handle]")).toHaveLength(8);
    await h.act(() => h.rt.stores.workspace.getState().maximize(a));
    expect(frame(a).querySelectorAll("[data-resize-handle]")).toHaveLength(0);
  });

  it("with A maximized, showing B shows it maximized and A at its normal rectangle", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    await h.act(() => h.rt.stores.workspace.getState().maximize(a));
    await h.act(() => h.rt.actions.showPoll(b));
    expect(box(frame(b))).toEqual({ left: 8, top: 8, width: 1316, height: 700 });
    expect(frame(b).dataset.state).toBe("maximized");
    expect(frame(a).dataset.state).toBe("normal");
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 640, height: 368 });
  });
});

describe("Window menu: Tile, Cascade, tile mode (DES-002 2.7, 2.8)", () => {
  async function four() {
    h = await renderWindow();
    const ids: PollId[] = [];
    for (const name of ["A", "B", "C", "D"]) ids.push(await h.addPoll(name));
    return ids;
  }

  it("Tile gives the WT-1 rectangles, turns tile mode on and shows the corner indicator", async () => {
    const ids = await four();
    await openWindowMenu();
    await h.user.click(menuItem(/^Tile/));
    expect(ids.map((id) => box(frame(id)))).toEqual([
      { left: 8, top: 8, width: 654, height: 346 },
      { left: 670, top: 8, width: 654, height: 346 },
      { left: 8, top: 362, width: 654, height: 346 },
      { left: 670, top: 362, width: 654, height: 346 },
    ]);
    expect(screen.getByTestId("tile-mode-indicator")).toHaveTextContent("Tile mode");
    await openWindowMenu();
    expect(checkItem("Tile mode")).toHaveAttribute("aria-checked", "true");
  });

  it("with tile mode on, closing one (Keep) re-tiles the other three to WT-2", async () => {
    const ids = await four();
    await openWindowMenu();
    await h.user.click(menuItem(/^Tile/));
    await h.user.click(
      within(frame(ids[3] as PollId)).getByRole("button", { name: "Close (Ctrl+F4)" }),
    );
    await h.user.click(await screen.findByRole("button", { name: "Keep poll" }));
    await waitFor(() => expect(frames()).toHaveLength(3));
    expect(ids.slice(0, 3).map((id) => box(frame(id)))).toEqual([
      { left: 8, top: 8, width: 654, height: 346 },
      { left: 670, top: 8, width: 654, height: 346 },
      { left: 8, top: 362, width: 1316, height: 346 },
    ]);
  });

  it("Cascade unchecks Tile mode and steps the windows by 24 px", async () => {
    const ids = await four();
    await openWindowMenu();
    await h.user.click(menuItem(/^Tile/));
    await openWindowMenu();
    await h.user.click(menuItem(/^Cascade/));
    expect(screen.queryByTestId("tile-mode-indicator")).not.toBeInTheDocument();
    expect(ids.slice(0, 3).map((id) => box(frame(id)))).toEqual([
      { left: 8, top: 8, width: 640, height: 368 },
      { left: 32, top: 32, width: 640, height: 368 },
      { left: 56, top: 56, width: 640, height: 368 },
    ]);
    await openWindowMenu();
    expect(checkItem("Tile mode")).toHaveAttribute("aria-checked", "false");
  });

  it("13 sub-windows: Tile shows the toast '1 window did not fit and was cascaded.'", async () => {
    h = await renderWindow();
    for (let i = 1; i <= 13; i += 1) await h.addPoll(`P${i}`);
    await openWindowMenu();
    await h.user.click(menuItem(/^Tile/));
    expect(await screen.findByText("1 window did not fit and was cascaded.")).toBeVisible();
  });

  it("the Tile mode checkbox tiles and unchecking keeps the rectangles", async () => {
    const ids = await four();
    await openWindowMenu();
    await h.user.click(checkItem("Tile mode"));
    expect(box(frame(ids[1] as PollId)).left).toBe(670);
    await openWindowMenu();
    await h.user.click(checkItem("Tile mode"));
    expect(screen.queryByTestId("tile-mode-indicator")).not.toBeInTheDocument();
    expect(box(frame(ids[1] as PollId)).left).toBe(670);
  });

  it("Ctrl+Shift+T tiles and Ctrl+Shift+C cascades", async () => {
    const ids = await four();
    act(() => {
      fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    });
    expect(box(frame(ids[1] as PollId)).left).toBe(670);
    act(() => {
      fireEvent.keyDown(window, { key: "C", ctrlKey: true, shiftKey: true });
    });
    expect(box(frame(ids[1] as PollId)).left).toBe(32);
  });

  it("Popped-out windows is disabled with the title when none is open", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    await openWindowMenu();
    const item = screen.getByRole("menuitem", { name: "Popped-out windows" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("title", "No poll is open in its own window.");
  });

  it("Minimize all and Restore all; Arrange minimized sorts the bar by list order", async () => {
    h = await renderWindow();
    const ids: PollId[] = [];
    for (const n of ["A", "B", "C"]) ids.push(await h.addPoll(n));
    await h.user.click(within(frame(ids[2] as PollId)).getByRole("button", { name: "Minimize" }));
    await h.user.click(within(frame(ids[0] as PollId)).getByRole("button", { name: "Minimize" }));
    const pills = () =>
      within(screen.getByRole("region", { name: "Minimized windows" }))
        .getAllByRole("button", { name: /Offline/ })
        .map((b) => b.textContent);
    expect(pills()).toEqual(["C · Offline", "A · Offline"]);
    await openWindowMenu();
    await h.user.click(menuItem(/^Arrange minimized/));
    expect(pills()).toEqual(["A · Offline", "C · Offline"]);
    await openWindowMenu();
    await h.user.click(menuItem(/^Minimize all/));
    expect(frames()).toHaveLength(0);
    await openWindowMenu();
    await h.user.click(menuItem(/^Restore all/));
    expect(frames()).toHaveLength(3);
  });

  it("lists every poll with a check on the active one and the host marker; choosing one shows it", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.addPoll("B");
    await h.user.click(within(frame(a)).getByRole("button", { name: "Minimize" }));
    await openWindowMenu();
    expect(checkItem("1 A (minimized)")).toHaveAttribute("aria-checked", "false");
    expect(checkItem("2 B")).toHaveAttribute("aria-checked", "true");
    await h.user.click(checkItem("1 A (minimized)"));
    expect(frame(a)).toHaveAttribute("aria-current", "true");
  });

  it("Ctrl+F6 and Ctrl+Shift+F6 cycle the active sub-window", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    act(() => {
      fireEvent.keyDown(window, { key: "F6", ctrlKey: true });
    });
    expect(frame(a)).toHaveAttribute("aria-current", "true");
    act(() => {
      fireEvent.keyDown(window, { key: "F6", ctrlKey: true, shiftKey: true });
    });
    expect(frame(b)).toHaveAttribute("aria-current", "true");
  });

  it("the Collapse setup panels checkbox sets compact mode in Rust", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    await openWindowMenu();
    await h.user.click(checkItem(/^Collapse setup panels/));
    await waitFor(() => expect(h.ipc.compact).toBe(true));
    expect(h.rt.stores.prefs.getState().compact).toBe(true);
  });
});

describe("closing a poll view (S6, DES-002 2.11)", () => {
  it("shows the dialog with the exact texts and Keep poll focused", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.user.click(within(frame(a)).getByRole("button", { name: "Close (Ctrl+F4)" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Close poll window?")).toBeVisible();
    expect(dialog).toHaveTextContent('Keep "Pump 2" on this connection, or delete it?');
    expect(within(dialog).getByRole("button", { name: "Keep poll" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Delete poll" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(
      within(dialog).getByRole("checkbox", { name: "Don't ask again for this connection window" }),
    ).not.toBeChecked();
  });

  it("adds 'A kept poll keeps polling in the background.' for a running poll", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.connect();
    await h.user.click(within(frame(a)).getByRole("button", { name: "Close (Ctrl+F4)" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "A kept poll keeps polling in the background.",
    );
  });

  it("Keep poll closes the view, keeps the poll and the sidebar marks it closed", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.user.click(within(frame(a)).getByRole("button", { name: "Close (Ctrl+F4)" }));
    await h.user.click(await screen.findByRole("button", { name: "Keep poll" }));
    await waitFor(() => expect(frames()).toHaveLength(0));
    expect(h.ipc.callsOf("closePollView")).toEqual([[a, true]]);
    expect(screen.getByRole("option", { name: /Pump 2, .*, closed/ })).toBeVisible();
  });

  it("Delete poll removes it", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.user.click(within(frame(a)).getByRole("button", { name: "Close (Ctrl+F4)" }));
    await h.user.click(await screen.findByRole("button", { name: "Delete poll" }));
    await waitFor(() => expect(h.ipc.pollIds()).toEqual([]));
  });

  it("Cancel and Esc do nothing", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.user.click(within(frame(a)).getByRole("button", { name: "Close (Ctrl+F4)" }));
    await h.user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await h.user.click(within(frame(a)).getByRole("button", { name: "Close (Ctrl+F4)" }));
    await screen.findByRole("alertdialog");
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("closePollView")).toHaveLength(0);
    expect(frames()).toHaveLength(1);
  });

  it("'Don't ask again' makes the next close keep without a dialog", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    const b = await h.addPoll("Pump 3");
    await h.user.click(within(frame(a)).getByRole("button", { name: "Close (Ctrl+F4)" }));
    await h.user.click(await screen.findByRole("checkbox", { name: /Don't ask again/ }));
    await h.user.click(screen.getByRole("button", { name: "Keep poll" }));
    await waitFor(() => expect(h.ipc.askOnPollClose).toBe(false));
    await h.user.click(within(frame(b)).getByRole("button", { name: "Close (Ctrl+F4)" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(h.ipc.callsOf("closePollView")).toHaveLength(2));
  });

  it("Ctrl+F4 closes the active sub-window, and the shortcuts are off while the dialog is open", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    const b = await h.addPoll("B");
    // The key acts on the sub-window that has the focus (DES-002 3.1: not elsewhere in W1).
    (frame(b).querySelector('[data-slot="title-bar"]') as HTMLElement).focus();
    act(() => {
      fireEvent.keyDown(window, { key: "F4", ctrlKey: true });
    });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent('Keep "B"');
    expect(b).toBeGreaterThan(0);
    act(() => {
      fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    });
    expect(h.rt.stores.workspace.getState().tileMode).toBe(false);
  });
});

describe("setup, new poll", () => {
  it("the gear toggles the setup dock and shows pressed; an unapplied edit shows a dot", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const gear = within(frame(a)).getByRole("button", { name: "Poll setup (Ctrl+\\)" });
    expect(gear).toHaveAttribute("aria-pressed", "false");
    await h.user.click(gear);
    expect(gear).toHaveAttribute("aria-pressed", "true");
    expect(within(frame(a)).getByRole("complementary", { name: "Poll setup" })).toBeVisible();
    const quantity = within(frame(a)).getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "20");
    expect(within(frame(a)).getByTestId("unapplied-dot")).toBeInTheDocument();
  });

  it("a new poll opens its setup with the focus in Name and the text selected", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.actions.newPoll());
    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    await waitFor(() => expect(name).toHaveFocus());
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);
  });

  it("New poll from the toolbar and with Ctrl+Shift+N", async () => {
    h = await renderWindow();
    await h.user.click(
      within(screen.getByRole("toolbar", { name: "Toolbar" })).getByRole("button", {
        name: "New poll",
      }),
    );
    await waitFor(() => expect(frames()).toHaveLength(1));
    act(() => {
      fireEvent.keyDown(window, { key: "N", ctrlKey: true, shiftKey: true });
    });
    await waitFor(() => expect(frames()).toHaveLength(2));
    expect(frames().map((f) => f.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "Poll 1",
      "Poll 2",
    ]);
  });

  it("rename in the title bar: F2, Enter commits, a duplicate name shows the message", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank");
    await h.addPoll("Pump");
    const bar = within(frame(a)).getByRole("toolbar");
    bar.focus();
    await h.user.keyboard("{F2}");
    const input = within(frame(a)).getByRole("textbox", { name: "Poll name" });
    await h.user.clear(input);
    await h.user.type(input, "pump{Enter}");
    expect(await within(frame(a)).findByRole("alert")).toHaveTextContent(
      'A poll named "pump" already exists on this connection.',
    );
    await h.user.clear(input);
    await h.user.type(input, "Tank 2{Enter}");
    await waitFor(() => expect(h.ipc.callsOf("renamePoll")).toEqual([[a, "Tank 2"]]));
    await waitFor(() => expect(within(frame(a)).queryByRole("textbox")).not.toBeInTheDocument());
    expect(within(frame(a)).getByText("Tank 2")).toBeVisible();
  });
});

describe("workspace size (DES-002 2.10.1)", () => {
  it("a smaller workspace clamps the frames so 80 x 30 px of the title bar stay inside", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.act(() =>
      h.rt.stores.workspace.getState().setRect(a, { x: 1200, y: 600, width: 640, height: 368 }),
    );
    h.setSize(800, 500);
    expect(box(frame(a))).toMatchObject({ left: 720, top: 470 });
  });

  it("a big minimized bar leaves the tile area: maximize stops above it", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    await h.user.click(within(frame(b)).getByRole("button", { name: "Minimize" }));
    await h.user.click(within(frame(a)).getByRole("button", { name: "Maximize" }));
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 1316, height: 648 });
  });
});

describe("title bar toolbar keys (REV-006 n-9)", () => {
  it("Left and Right move the focus between its buttons and wrap", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const bar = within(frame(a)).getByRole("toolbar");
    const buttons = within(bar).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(2);
    buttons[0]?.focus();
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: "ArrowRight" });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(buttons[1] as HTMLElement, { key: "ArrowLeft" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: "ArrowLeft" });
    expect(buttons.at(-1)).toHaveFocus();
    // Alt+Arrow is the move key of the sub-window, not a toolbar key.
    const before = frame(a).style.left;
    fireEvent.keyDown(buttons.at(-1) as HTMLElement, { key: "ArrowRight", altKey: true });
    expect(frame(a).style.left).not.toBe(before);
  });
});

describe("Tab into a sub-window activates and raises it (DES-002 2.3.1, D-002-08, CHK2-R1, R6)", () => {
  it("focus entering an inactive sub-window makes it active and front; DOM order stays by poll id; the focus stays", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    expect(frame(b)).toHaveAttribute("aria-current", "true");
    const zOf = (id: PollId) => Number(frame(id).style.zIndex);
    expect(zOf(b)).toBeGreaterThan(zOf(a));
    const orderBefore = frames().map((f) => f.getAttribute("data-subwindow"));
    const layoutCalls = h.ipc.callsOf("setWorkspaceLayout").length;

    const minimize = within(frame(a)).getByRole("button", { name: "Minimize" });
    act(() => minimize.focus());

    expect(frame(a)).toHaveAttribute("aria-current", "true");
    expect(frame(b)).not.toHaveAttribute("aria-current");
    expect(zOf(a)).toBeGreaterThan(zOf(b));
    expect(document.activeElement).toBe(minimize);
    expect(frames().map((f) => f.getAttribute("data-subwindow"))).toEqual(orderBefore);
    expect(orderBefore).toEqual([String(a), String(b)]);
    // A pure activation reports nothing to Rust (the z-order goes with the next layout action).
    expect(h.ipc.callsOf("setWorkspaceLayout")).toHaveLength(layoutCalls);
  });

  it("moving the focus inside the active sub-window changes nothing", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    const b = await h.addPoll("B");
    const z = frame(b).style.zIndex;
    act(() => within(frame(b)).getByRole("button", { name: "Minimize" }).focus());
    act(() => within(frame(b)).getByRole("button", { name: "Maximize" }).focus());
    expect(frame(b).style.zIndex).toBe(z);
    expect(frame(b)).toHaveAttribute("aria-current", "true");
  });

  it("Tab key order walks the sub-windows by poll id, activating each one it enters", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    // B is active and in front. Tab from the last control of A reaches B's first control...
    act(() => within(frame(a)).getByRole("button", { name: "Close (Ctrl+F4)" }).focus());
    expect(frame(a)).toHaveAttribute("aria-current", "true");
    // ...and focus in B brings B to the front again.
    act(() => within(frame(b)).getByRole("button", { name: "Poll setup (Ctrl+\\)" }).focus());
    expect(frame(b)).toHaveAttribute("aria-current", "true");
    expect(frames().map((f) => f.getAttribute("data-subwindow"))).toEqual([String(a), String(b)]);
  });
});

describe("announcement hooks (REPORT-003 section 5, item 7)", () => {
  it("the live regions carry data-seq and the fake window logs every announcement", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    const before = h.win.announcements.length;
    const polite = screen.getByTestId("live-polite");
    const seq0 = Number(polite.getAttribute("data-seq"));
    await h.act(() => h.rt.stores.announcer.getState().announce("First."));
    await h.act(() => h.rt.stores.announcer.getState().announce("First."));
    // The same text twice: two entries, and the sequence number moved twice.
    expect(h.win.announcements.slice(before)).toEqual([
      { text: "First.", assertive: false },
      { text: "First.", assertive: false },
    ]);
    expect(Number(polite.getAttribute("data-seq"))).toBe(seq0 + 2);
    await h.act(() => h.rt.stores.announcer.getState().announce("Link lost.", { assertive: true }));
    expect(h.win.announcements.at(-1)).toEqual({ text: "Link lost.", assertive: true });
    expect(Number(screen.getByTestId("live-assertive").getAttribute("data-seq"))).toBeGreaterThan(
      seq0 + 2,
    );
    // The polite region is emptied while the assertive one speaks.
    expect(polite.getAttribute("data-seq")).toBe("0");
    expect(a).toBeGreaterThan(0);
  });
});
