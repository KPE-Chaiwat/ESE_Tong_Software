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
const bar = (id: PollId) => within(frame(id)).getByRole("toolbar");
const box = (el: HTMLElement) => ({
  left: Number.parseFloat(el.style.left),
  top: Number.parseFloat(el.style.top),
  width: Number.parseFloat(el.style.width),
  height: Number.parseFloat(el.style.height),
});
const live = () => screen.getByTestId("live-polite");
const layoutCalls = () => h.ipc.callsOf("setWorkspaceLayout").length;

interface Mods {
  altKey?: boolean;
  ctrlKey?: boolean;
}
const press = (el: Element, x: number, y: number) =>
  fireEvent.pointerDown(el, { button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y });
const move = (el: Element, x: number, y: number, mods: Mods = {}) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y, ...mods });
const release = (el: Element, x = 0, y = 0) =>
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y });

async function twoWindows() {
  h = await renderWindow();
  const a = await h.addPoll("A");
  const b = await h.addPoll("B");
  return { a, b };
}

describe("move (DES-002 2.10.1)", () => {
  it("a press raises and activates at once; 3 px is a click and changes nothing", async () => {
    const { a } = await twoWindows();
    const before = box(frame(a));
    press(bar(a), 100, 100);
    expect(frame(a)).toHaveAttribute("aria-current", "true");
    move(bar(a), 103, 100);
    release(bar(a), 103, 100);
    expect(box(frame(a))).toEqual(before);
    expect(frame(a).style.transform).toBe("");
    expect(h.rt.stores.drag.getState().kind).toBe("none");
  });

  it("moving 40 px follows the pointer with a transform and the release commits it", async () => {
    const { a } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), 200, 100);
    expect(frame(a).style.transform).toBe("translate(100px, 0px)");
    expect(frame(a).style.left).toBe("8px");
    expect(frame(a).dataset.dragging).toBe("true");
    const calls = layoutCalls();
    release(bar(a), 200, 100);
    expect(box(frame(a))).toMatchObject({ left: 108, top: 8 });
    expect(frame(a).style.transform).toBe("");
    expect(frame(a).dataset.dragging).toBeUndefined();
    expect(layoutCalls()).toBe(calls + 1);
    expect(live()).toHaveTextContent("A moved.");
  });

  it("the layout is not reported while the drag runs", async () => {
    const { a } = await twoWindows();
    const calls = layoutCalls();
    press(bar(a), 100, 100);
    for (let x = 110; x <= 300; x += 10) move(bar(a), x, 100);
    expect(layoutCalls()).toBe(calls);
    release(bar(a), 300, 100);
    expect(layoutCalls()).toBe(calls + 1);
  });

  it("keeps 80 x 30 px of the title bar inside the workspace", async () => {
    const { a } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), -5000, -5000);
    release(bar(a));
    expect(box(frame(a))).toMatchObject({ left: -560, top: 0 });
  });

  it("a press, a double click or a right click inside the title bar menu is not a press on the grip", async () => {
    const { a } = await twoWindows();
    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    const item = await screen.findByRole("menuitem", { name: "Minimize" });
    press(item, 100, 100);
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    move(item, 300, 300);
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    fireEvent.doubleClick(item);
    expect(frame(a).dataset.state).toBe("normal");
    // No listener was left behind: Esc still reaches the window.
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
  });

  it("the buttons in the title bar are not a grip", async () => {
    const { a } = await twoWindows();
    const minimize = within(frame(a)).getByRole("button", { name: "Minimize" });
    press(minimize, 100, 20);
    expect(h.rt.stores.drag.getState().kind).toBe("none");
  });

  it("Esc during a move puts the frame back and announces 'Move cancelled.'", async () => {
    const { a } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), 300, 200);
    expect(frame(a).style.transform).not.toBe("");
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(box(frame(a))).toMatchObject({ left: 8, top: 8 });
    expect(frame(a).style.transform).toBe("");
    expect(live()).toHaveTextContent("Move cancelled.");
    // The pointer is not tracked any more.
    move(bar(a), 400, 220);
    release(bar(a));
    expect(box(frame(a))).toMatchObject({ left: 8, top: 8 });
  });

  it("losing the pointer capture cancels the drag", async () => {
    const { a } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), 300, 200);
    fireEvent(bar(a), new Event("lostpointercapture", { bubbles: true }));
    expect(frame(a).style.transform).toBe("");
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    expect(live()).toHaveTextContent("Move cancelled.");
  });

  it("dragging a maximized window restores it under the pointer", async () => {
    const { a } = await twoWindows();
    await h.act(() => h.rt.stores.workspace.getState().maximize(a));
    press(bar(a), 666, 100);
    move(bar(a), 700, 150);
    expect(frame(a).style.width).toBe("640px");
    expect(frame(a).style.height).toBe("368px");
    release(bar(a), 700, 150);
    expect(frame(a).dataset.state).toBe("normal");
    expect(box(frame(a)).width).toBe(640);
  });

  it("the other frames do not move while one is dragged", async () => {
    const { a, b } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), 200, 120);
    expect(frame(b).style.transform).toBe("");
    expect(box(frame(b))).toMatchObject({ left: 32, top: 32 });
    release(bar(a));
  });
});

describe("snapping (DES-002 2.10.3)", () => {
  async function snapSetup() {
    const { a, b } = await twoWindows();
    await h.act(() =>
      h.rt.stores.workspace.getState().setRect(b, { x: 700, y: 8, width: 500, height: 300 }),
    );
    await h.act(() => h.rt.stores.workspace.getState().activate(a));
    return { a, b };
  }

  it("within 8 px of a neighbor's gap line it snaps and one dashed guide shows", async () => {
    const { a } = await snapSetup();
    press(bar(a), 0, 300);
    move(bar(a), 47, 300);
    const guides = screen.getAllByTestId("snap-guide").filter((g) => g.dataset.axis === "x");
    expect(guides).toHaveLength(1);
    expect(guides[0]?.className).toContain("border-dashed");
    release(bar(a), 47, 300);
    expect(box(frame(a)).left + 640).toBe(692);
  });

  it("with Alt held it does not snap; releasing Alt re-enables it during the same drag", async () => {
    const { a } = await snapSetup();
    press(bar(a), 0, 300);
    move(bar(a), 47, 300, { altKey: true });
    expect(screen.queryAllByTestId("snap-guide")).toHaveLength(0);
    move(bar(a), 47, 300);
    expect(screen.queryAllByTestId("snap-guide").length).toBeGreaterThan(0);
    release(bar(a), 47, 300);
  });

  it("pressing and releasing Alt during a drag does not leak to the system menu (R7)", async () => {
    const { a } = await snapSetup();
    press(bar(a), 0, 300);
    move(bar(a), 47, 300);
    expect(fireEvent.keyDown(window, { key: "Alt", altKey: true })).toBe(false);
    expect(fireEvent.keyUp(window, { key: "Alt" })).toBe(false);
    release(bar(a));
  });

  it("the window never lets a lone Alt tap reach the host, after an Alt-drag too (D2)", async () => {
    const { a } = await snapSetup();
    expect(fireEvent.keyDown(window, { key: "Alt", altKey: true })).toBe(false);
    press(bar(a), 0, 300);
    move(bar(a), 47, 300, { altKey: true });
    release(bar(a), 47, 300);
    // The drag is over: its own key listeners are gone, the window-level guard still holds.
    expect(fireEvent.keyUp(window, { key: "Alt" })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "AltGraph", altKey: true })).toBe(false);
    expect(fireEvent.keyUp(document.body, { key: "AltGraph" })).toBe(false);
  });

  it("Alt+Arrow still moves, Alt+F4 is not prevented, and the Alt keyup after a combination is left alone (D2)", async () => {
    const { a } = await twoWindows();
    const grid = bar(a);
    grid.focus();
    expect(fireEvent.keyDown(grid, { key: "Alt", altKey: true })).toBe(false);
    const before = box(frame(a)).left;
    expect(fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true })).toBe(false);
    expect(box(frame(a)).left).toBe(before + 16);
    expect(fireEvent.keyUp(grid, { key: "Alt" })).toBe(true);
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    expect(fireEvent.keyDown(window, { key: "F4", altKey: true })).toBe(true);
    expect(fireEvent.keyUp(window, { key: "F4", altKey: true })).toBe(true);
  });

  it("the pointer near the left edge shows the zone preview; the drop sets the half and announces it", async () => {
    const { a } = await twoWindows();
    press(bar(a), 300, 100);
    move(bar(a), 12, 300);
    const preview = screen.getByTestId("zone-preview");
    expect(preview.style.left).toBe("8px");
    expect(preview.style.width).toBe("654px");
    expect(preview.style.height).toBe("700px");
    expect(preview.className).toContain("border-dashed");
    release(bar(a), 12, 300);
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 654, height: 700 });
    expect(live()).toHaveTextContent("A moved to the left half.");
    expect(screen.queryByTestId("zone-preview")).not.toBeInTheDocument();
  });

  it("the top edge gives the full area and the maximize button still says Maximize", async () => {
    const { a } = await twoWindows();
    press(bar(a), 300, 100);
    move(bar(a), 600, 10);
    release(bar(a), 600, 10);
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 1316, height: 700 });
    expect(within(frame(a)).getByRole("button", { name: "Maximize" })).toBeVisible();
  });

  it("the bottom edge alone shows no zone", async () => {
    const { a } = await twoWindows();
    press(bar(a), 300, 100);
    move(bar(a), 600, 705);
    expect(screen.queryByTestId("zone-preview")).not.toBeInTheDocument();
    release(bar(a));
  });

  it("a press inside the 24 px band shows no zone until the pointer has left the band (Q-FE2-04)", async () => {
    const { a } = await twoWindows();
    // The window rests at (8, 8): the press on its title bar is inside the top band.
    press(bar(a), 100, 20);
    move(bar(a), 12, 300);
    expect(screen.queryByTestId("zone-preview")).not.toBeInTheDocument();
    move(bar(a), 600, 12);
    expect(screen.queryByTestId("zone-preview")).not.toBeInTheDocument();
    // Out of the band once: from now on the band at the border is a zone.
    move(bar(a), 400, 300);
    move(bar(a), 12, 300);
    expect(screen.getByTestId("zone-preview").style.width).toBe("654px");
    release(bar(a), 12, 300);
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 654, height: 700 });
  });

  it("releasing in the starting band moves the window, it does not snap to the full area", async () => {
    const { a } = await twoWindows();
    press(bar(a), 100, 20);
    move(bar(a), 400, 20);
    release(bar(a), 400, 20);
    expect(box(frame(a))).toMatchObject({ left: 308, top: 8, width: 640, height: 368 });
  });

  it("'Snap while moving' in the title bar menu turns the zones off", async () => {
    const { a } = await twoWindows();
    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    await h.user.click(await screen.findByRole("menuitemcheckbox", { name: "Snap while moving" }));
    press(bar(a), 300, 100);
    move(bar(a), 12, 300);
    expect(screen.queryByTestId("zone-preview")).not.toBeInTheDocument();
    release(bar(a));
  });
});

describe("swap (DES-002 2.10.4)", () => {
  it("Ctrl over another title bar shows 'Swap'; the release exchanges the rectangles", async () => {
    const { a, b } = await twoWindows();
    press(bar(a), 100, 100);
    // B's title bar is at (32, 32), 30 px high.
    move(bar(a), 60, 45, { ctrlKey: true });
    expect(within(frame(b)).getByTestId("swap-overlay")).toHaveTextContent("Swap");
    release(bar(a), 60, 45);
    expect(box(frame(a))).toMatchObject({ left: 32, top: 32 });
    expect(box(frame(b))).toMatchObject({ left: 8, top: 8 });
    expect(live()).toHaveTextContent("A swapped with B.");
    expect(screen.queryByTestId("swap-overlay")).not.toBeInTheDocument();
  });

  it("releasing Ctrl before the drop is a normal move", async () => {
    const { a, b } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), 60, 45, { ctrlKey: true });
    move(bar(a), 60, 45);
    expect(within(frame(b)).queryByTestId("swap-overlay")).not.toBeInTheDocument();
    release(bar(a), 60, 45);
    expect(live()).toHaveTextContent("A moved.");
  });
});

describe("resize (DES-002 2.10.2)", () => {
  const handle = (id: PollId, edge: string) =>
    frame(id).querySelector(`[data-resize-handle="${edge}"]`) as HTMLElement;

  it("has eight handles", async () => {
    const { a } = await twoWindows();
    expect(
      Array.from(frame(a).querySelectorAll("[data-resize-handle]")).map((e) =>
        e.getAttribute("data-resize-handle"),
      ),
    ).toEqual(["n", "s", "w", "e", "nw", "ne", "sw", "se"]);
  });

  it("the south-east corner grows the frame live; the release commits and announces the size", async () => {
    const { a } = await twoWindows();
    press(handle(a, "se"), 648, 376);
    move(handle(a, "se"), 748, 416, { altKey: true });
    expect(frame(a).style.width).toBe("740px");
    expect(frame(a).style.height).toBe("408px");
    release(handle(a, "se"), 748, 416);
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 740, height: 408 });
    expect(live()).toHaveTextContent("A resized to 740 by 408.");
  });

  it("the north-west corner keeps the opposite corner fixed and stops at 320 x 180", async () => {
    const { a } = await twoWindows();
    press(handle(a, "nw"), 8, 8);
    move(handle(a, "nw"), 900, 900, { altKey: true });
    release(handle(a, "nw"));
    expect(box(frame(a))).toEqual({ left: 328, top: 196, width: 320, height: 180 });
  });

  it("Esc restores the size at the press", async () => {
    const { a } = await twoWindows();
    press(handle(a, "e"), 648, 100);
    move(handle(a, "e"), 800, 100);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(box(frame(a))).toMatchObject({ width: 640, height: 368 });
    expect(frame(a).style.width).toBe("640px");
  });

  it("there are no handles in tile mode", async () => {
    const { a } = await twoWindows();
    await h.act(() => h.rt.stores.workspace.getState().tile());
    expect(frame(a).querySelectorAll("[data-resize-handle]")).toHaveLength(0);
  });
});

describe("tile mode reorder (DES-002 2.10.5)", () => {
  async function tiles() {
    h = await renderWindow();
    const ids: PollId[] = [];
    for (const n of ["A", "B", "C", "D"]) ids.push(await h.addPoll(n));
    await h.act(() => h.rt.stores.workspace.getState().tile());
    return ids as [PollId, PollId, PollId, PollId];
  }
  const names = () =>
    screen.getAllByRole("option").map((o) => o.getAttribute("aria-label")?.split(",")[0]);

  it("shows the slot indicator; dropping A on slot 3 gives B, C, A, D in the sidebar and re-tiles", async () => {
    const [a, b, c, d] = await tiles();
    press(bar(a), 100, 100);
    move(bar(a), 100, 500);
    const slot = screen.getByTestId("slot-indicator");
    expect(slot.style.top).toBe("362px");
    expect(slot.style.left).toBe("8px");
    release(bar(a), 100, 500);
    await waitFor(() => expect(names()).toEqual(["B", "C", "A", "D"]));
    expect(h.rt.stores.pollList.getState().order).toEqual([b, c, a, d]);
    expect(h.ipc.callsOf("reorderPolls")).toEqual([[[b, c, a, d]]]);
    expect(box(frame(a))).toEqual({ left: 8, top: 362, width: 654, height: 346 });
    expect(live()).toHaveTextContent("A moved to slot 3 of 4.");
  });

  it("dropping on its own slot makes no call", async () => {
    const [a] = await tiles();
    press(bar(a), 100, 100);
    move(bar(a), 130, 50);
    release(bar(a), 130, 50);
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(0);
  });

  it("Ctrl-drop of A on D swaps their slots: D, B, C, A", async () => {
    const [a, b, c, d] = await tiles();
    press(bar(a), 100, 100);
    move(bar(a), 700, 380, { ctrlKey: true });
    expect(within(frame(d)).getByTestId("swap-overlay")).toBeVisible();
    release(bar(a), 700, 380);
    await waitFor(() => expect(h.rt.stores.pollList.getState().order).toEqual([d, b, c, a]));
    expect(live()).toHaveTextContent("A swapped with D.");
  });

  it("Ctrl+Shift+Right swaps with the adjacent slot", async () => {
    const [a, b, c, d] = await tiles();
    fireEvent.keyDown(bar(a), { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.rt.stores.pollList.getState().order).toEqual([b, a, c, d]));
  });

  it("a minimized window has no slot: the menu offers only the slots there are (REV-006 m-6)", async () => {
    const [a, b] = await tiles();
    await h.act(() => h.rt.stores.workspace.getState().minimize(b));
    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu");
    await h.user.click(within(menu).getByRole("menuitem", { name: /^Move to slot/ }));
    const slots = screen.getAllByRole("menu").at(-1) as HTMLElement;
    expect(
      within(slots)
        .getAllByRole("menuitem", { name: /^Slot / })
        .map((i) => i.textContent),
    ).toEqual(["Slot 1", "Slot 2", "Slot 3"]);
    // The window's own slot is the one that is off.
    expect(within(slots).getByRole("menuitem", { name: "Slot 1" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("the title bar menu offers Slot 1 to 4 instead of the zones", async () => {
    const [a, b, c, d] = await tiles();
    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu");
    await h.user.click(within(menu).getByRole("menuitem", { name: /^Move to slot/ }));
    const slots = screen.getAllByRole("menu").at(-1) as HTMLElement;
    expect(
      within(slots)
        .getAllByRole("menuitem", { name: /^Slot / })
        .map((i) => i.textContent),
    ).toEqual(["Slot 1", "Slot 2", "Slot 3", "Slot 4"]);
    expect(within(slots).queryByRole("menuitem", { name: /half/ })).not.toBeInTheDocument();
    await h.user.click(within(slots).getByRole("menuitem", { name: "Slot 4" }));
    await waitFor(() => expect(h.rt.stores.pollList.getState().order).toEqual([b, c, d, a]));
  });
});

describe("keyboard (DES-002 2.10.8)", () => {
  async function focused() {
    const { a, b } = await twoWindows();
    // The title bar is focusable and inside the frame: the keys reach the frame from there.
    const grid = bar(a);
    grid.focus();
    return { a, b, grid };
  }

  it("Alt+Right moves 16 px and Alt+Shift+Right 1 px", async () => {
    const { a, b, grid } = await focused();
    await h.act(() =>
      h.rt.stores.workspace.getState().setRect(b, { x: 900, y: 400, width: 320, height: 200 }),
    );
    fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
    expect(box(frame(a)).left).toBe(24);
    fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(box(frame(a)).left).toBe(25);
    expect(live()).toHaveTextContent("A moved.");
  });

  it("the grid does not also move its focus", async () => {
    const { a } = await focused();
    await h.connect();
    h.advance(300);
    const grid = within(frame(a)).getByRole("grid");
    await h.act(() => h.rt.stores.workspace.getState().activate(a));
    const view = h.rt.views.get(a);
    const before = view.stores.ui.getState().focusAddress;
    fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true });
    expect(view.stores.ui.getState().focusAddress).toBe(before);
    expect(box(frame(a)).top).toBe(24);
  });

  it("Ctrl+Alt+Down grows the height by 16 px", async () => {
    const { a, grid } = await focused();
    fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true, ctrlKey: true });
    expect(box(frame(a)).height).toBe(384);
    expect(live()).toHaveTextContent("A resized to 640 by 384.");
  });

  it("Ctrl+Shift+Right swaps with the right neighbor", async () => {
    const { a, b } = await focused();
    await h.act(() =>
      h.rt.stores.workspace.getState().setRect(b, { x: 700, y: 8, width: 500, height: 300 }),
    );
    fireEvent.keyDown(bar(a), { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    expect(box(frame(a))).toMatchObject({ left: 700, width: 500 });
    expect(box(frame(b))).toMatchObject({ left: 8, width: 640 });
    expect(live()).toHaveTextContent("A swapped with B.");
  });

  it("inside a text field the keys act on the text, not on the window (alias editor, setup)", async () => {
    const { a } = await focused();
    await h.user.click(within(frame(a)).getByRole("button", { name: "Poll setup (Ctrl+\\)" }));
    const name = within(frame(a)).getByLabelText("Name");
    name.focus();
    fireEvent.keyDown(name, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(name, { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    expect(box(frame(a)).left).toBe(8);
  });

  it("the workspace background forwards the keys to the active window", async () => {
    // The active window is B (the last one added). Focus in A's title bar would make A the active one
    // (Tab into a sub-window activates it, DES-002 2.3.1), so the focus is left alone here.
    const { b } = await twoWindows();
    fireEvent.keyDown(workspace(), { key: "ArrowRight", altKey: true });
    expect(box(frame(b)).left).toBe(48);
  });

  it("keys do nothing for a maximized or tiled window", async () => {
    const { a, grid } = await focused();
    await h.act(() => h.rt.stores.workspace.getState().maximize(a));
    fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
    expect(frame(a).dataset.state).toBe("maximized");
    expect(box(frame(a)).left).toBe(8);
  });

  it("Title bar menu > Move: arrows move an outline, Enter commits, Esc cancels", async () => {
    const { a } = await focused();
    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    await h.user.click(await screen.findByRole("menuitem", { name: "Move" }));
    expect(bar(a)).toHaveFocus();
    fireEvent.keyDown(bar(a), { key: "ArrowRight" });
    fireEvent.keyDown(bar(a), { key: "ArrowDown" });
    expect(screen.getByTestId("keyboard-outline").style.left).toBe("24px");
    expect(screen.getByTestId("keyboard-outline").style.top).toBe("24px");
    expect(box(frame(a))).toMatchObject({ left: 8, top: 8 });
    fireEvent.keyDown(bar(a), { key: "Enter" });
    expect(box(frame(a))).toMatchObject({ left: 24, top: 24 });
    expect(screen.queryByTestId("keyboard-outline")).not.toBeInTheDocument();

    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    await h.user.click(await screen.findByRole("menuitem", { name: "Move" }));
    expect(h.rt.stores.drag.getState().kind).toBe("keyboardMove");
    fireEvent.keyDown(bar(a), { key: "ArrowRight" });
    expect(h.rt.stores.drag.getState().currentRect?.x).toBe(40);
    const notPrevented = fireEvent.keyDown(bar(a), { key: "Escape" });
    expect(notPrevented).toBe(false);
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    expect(box(frame(a))).toMatchObject({ left: 24, top: 24 });
    expect(live()).toHaveTextContent("Move cancelled.");
  });

  it("Title bar menu > Size moves the right and bottom edges", async () => {
    const { a } = await focused();
    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    await h.user.click(await screen.findByRole("menuitem", { name: "Size" }));
    fireEvent.keyDown(bar(a), { key: "ArrowRight" });
    fireEvent.keyDown(bar(a), { key: "ArrowDown" });
    fireEvent.keyDown(bar(a), { key: "Enter" });
    expect(box(frame(a))).toMatchObject({ width: 656, height: 384 });
  });

  it("Title bar menu > Move to: Left half and Full workspace", async () => {
    const { a } = await focused();
    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    await h.user.click(await screen.findByRole("menuitem", { name: /^Move to/ }));
    await h.user.click(await screen.findByRole("menuitem", { name: "Left half" }));
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 654, height: 700 });
    fireEvent.contextMenu(bar(a), { clientX: 10, clientY: 10 });
    await h.user.click(await screen.findByRole("menuitem", { name: /^Move to/ }));
    await h.user.click(await screen.findByRole("menuitem", { name: "Full workspace" }));
    expect(box(frame(a))).toEqual({ left: 8, top: 8, width: 1316, height: 700 });
    expect(live()).toHaveTextContent("A moved to the full workspace.");
  });

  it("Shift+F10 on the focused title bar opens the menu; Restore, Minimize and Close are in it", async () => {
    const { a } = await focused();
    bar(a).focus();
    fireEvent.keyDown(bar(a), { key: "F10", shiftKey: true });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /^Restore/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await h.user.click(within(menu).getByRole("menuitem", { name: /^Minimize/ }));
    expect(frame(a)).toBeNull();
  });
});

describe("a frame that goes away mid-drag (REV-006 m-2)", () => {
  function escapeIsNotSwallowed(): boolean {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(event);
    });
    return !event.defaultPrevented;
  }

  it("the drag ends, the listeners go, and the next Esc is left alone", async () => {
    const { a, b } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), 200, 100);
    expect(h.rt.stores.drag.getState().kind).toBe("move");
    await h.act(async () => {
      await h.ipc.removePoll(a);
    });
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    expect(frame(a)).toBeNull();
    // No Move cancelled announcement for a window that is gone, and Esc belongs to the page again.
    expect(live()).not.toHaveTextContent("Move cancelled.");
    expect(escapeIsNotSwallowed()).toBe(true);
    // The other window was not touched.
    expect(frame(b)).not.toBeNull();
    expect(h.rt.stores.drag.getState().kind).toBe("none");
  });

  it("releasing the button after the frame was removed leaves nothing behind", async () => {
    const { a } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), 200, 100);
    const element = bar(a);
    await h.act(async () => {
      await h.ipc.removePoll(a);
    });
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 200, clientY: 100 });
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    expect(element.isConnected).toBe(false);
    expect(escapeIsNotSwallowed()).toBe(true);
  });

  it("the events reach the gesture through the document, also when the pointer is elsewhere", async () => {
    const { a } = await twoWindows();
    press(bar(a), 100, 100);
    move(bar(a), 200, 100);
    // The pointer moved over another element: the document still sees the events.
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 300, clientY: 100 });
    expect(box(frame(a))).toMatchObject({ left: 208 });
    expect(h.rt.stores.drag.getState().kind).toBe("none");
  });
});
