import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { IpcError } from "@/shared/ipc/errors";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  vi.restoreAllMocks();
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
const box = (el: HTMLElement) => ({
  left: Number.parseFloat(el.style.left),
  top: Number.parseFloat(el.style.top),
  width: Number.parseFloat(el.style.width),
  height: Number.parseFloat(el.style.height),
});

/** jsdom has no layout: the rows, the list and the workspace get the rectangles of a 1600 x 900 window. */
function layoutRects() {
  const rect = (x: number, y: number, width: number, height: number) => () =>
    ({
      x,
      y,
      width,
      height,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      toJSON() {},
    }) as DOMRect;
  list().getBoundingClientRect = rect(0, 100, 260, 400);
  within(list())
    .getAllByRole("option")
    .forEach((r, i) => {
      r.getBoundingClientRect = rect(0, 100 + i * 50, 260, 48);
    });
  const workspace = document.querySelector("[data-workspace]") as HTMLElement;
  workspace.getBoundingClientRect = rect(300, 56, 1332, 716);
}

const press = (el: Element, x: number, y: number) =>
  fireEvent.pointerDown(el, { button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y });
const move = (el: Element, x: number, y: number, mods: { altKey?: boolean } = {}) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y, ...mods });
const release = (el: Element, x = 0, y = 0) =>
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y });

async function four() {
  h = await renderWindow();
  const ids: PollId[] = [];
  for (const n of ["A", "B", "C", "D"]) ids.push(await h.addPoll(n));
  layoutRects();
  return ids as [PollId, PollId, PollId, PollId];
}

describe("drag to reorder (DES-002 2.10.6)", () => {
  it("dragging row 1 below row 3 shows the indicator between 3 and 4, then gives the new order", async () => {
    const [a, b, c, d] = await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 130);
    move(row(/^A,/), 100, 249);
    const indicator = screen.getByTestId("list-drop-indicator");
    expect(indicator).toHaveAttribute("data-gap-index", "3");
    expect(indicator).toHaveAttribute("aria-hidden", "true");
    release(row(/^A,/), 100, 249);
    await waitFor(() => expect(h.ipc.callsOf("reorderPolls")).toEqual([[[b, c, a, d]]]));
    expect(rowNames()).toEqual(["B", "C", "A", "D"]);
    expect(live()).toHaveTextContent("A moved to position 3 of 4.");
    expect(screen.queryByTestId("list-drop-indicator")).not.toBeInTheDocument();
  });

  it("the drop indicator is a 2 px dark line with a circle and the row is dimmed while dragged", async () => {
    await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 200);
    const indicator = screen.getByTestId("list-drop-indicator");
    expect(indicator.className).toContain("h-0.5");
    expect(indicator.className).toContain("bg-dark");
    expect(indicator.querySelector("span")?.className).toContain("rounded-full");
    expect(row(/^A,/)).toHaveAttribute("data-dragging", "true");
    expect(row(/^A,/).className).toContain("opacity-40");
    expect(row(/^B,/)).not.toHaveAttribute("data-dragging");
    release(row(/^A,/), 100, 200);
  });

  it("a ghost of the row follows the pointer at 80% opacity", async () => {
    await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 120, 220);
    const ghost = screen.getByTestId("list-drag-ghost");
    expect(ghost).toHaveTextContent("A");
    expect(ghost.className).toContain("opacity-80");
    expect(ghost.style.left).toBe("132px");
    expect(ghost.style.top).toBe("228px");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    release(row(/^A,/), 120, 220);
    expect(screen.queryByTestId("list-drag-ghost")).not.toBeInTheDocument();
  });

  it("less than 4 px is a click: no drag, no indicator, no reorder", async () => {
    await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 102, 122);
    expect(screen.queryByTestId("list-drop-indicator")).not.toBeInTheDocument();
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    release(row(/^A,/), 102, 122);
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(0);
  });

  it("the click that follows a drag does not show the poll; a later click does", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const [, b, , d] = await four();
      const active = () => h.rt.stores.workspace.getState().activeId;
      expect(active()).toBe(d);
      press(row(/^A,/), 100, 120);
      move(row(/^A,/), 100, 140);
      move(row(/^A,/), 100, 249);
      release(row(/^A,/), 100, 249);
      fireEvent.click(row(/^A,/));
      // A click on A would have brought its sub-window to the front.
      expect(active()).toBe(d);
      act(() => {
        vi.runAllTimers();
      });
      // After the click of the drag the row is a normal row again: this click is a real one.
      await h.act(async () => {
        fireEvent.click(row(/^B,/));
      });
      expect(active()).toBe(b);
    } finally {
      vi.useRealTimers();
    }
  });

  it("after Esc the release does not click the row either", async () => {
    const [, , , d] = await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 249);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.click(row(/^A,/));
    expect(h.rt.stores.workspace.getState().activeId).toBe(d);
  });

  it("Esc cancels the drag: the order stays and 'Move cancelled.' is announced", async () => {
    await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 249);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    expect(screen.queryByTestId("list-drop-indicator")).not.toBeInTheDocument();
    expect(live()).toHaveTextContent("Move cancelled.");
    release(row(/^A,/), 100, 249);
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(0);
    expect(rowNames()).toEqual(["A", "B", "C", "D"]);
  });

  it("losing the pointer capture cancels it too", async () => {
    await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 249);
    fireEvent(row(/^A,/), new Event("lostpointercapture", { bubbles: true }));
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(0);
  });

  it("a gap next to the own place changes nothing and says nothing", async () => {
    await four();
    press(row(/^B,/), 100, 170);
    move(row(/^B,/), 100, 190);
    move(row(/^B,/), 100, 199);
    release(row(/^B,/), 100, 199);
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(0);
    expect(live()).not.toHaveTextContent("moved to position");
  });

  it("the list order is also the Window menu order, the tile order and the traffic filter order", async () => {
    const [a, b, c, d] = await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 249);
    release(row(/^A,/), 100, 249);
    await waitFor(() => expect(rowNames()).toEqual(["B", "C", "A", "D"]));
    await h.act(() => h.rt.stores.workspace.getState().tile());
    // Tile order follows the list: B, C, A, D are z-ordered back to front.
    const z = (id: PollId) => h.rt.stores.workspace.getState().items[id]?.z ?? 0;
    expect([b, c, a, d].map(z)).toEqual([1, 2, 3, 4]);
    expect(h.rt.stores.traffic.getState().pollOrder).toEqual([b, c, a, d]);
  });

  it("a drag with the pointer outside the list and the workspace does nothing on release", async () => {
    await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 280, 20);
    expect(screen.queryByTestId("list-drop-indicator")).not.toBeInTheDocument();
    release(row(/^A,/), 280, 20);
    expect(h.ipc.callsOf("reorderPolls")).toHaveLength(0);
  });

  it("a press on the row's actions button or inside the rename field is not a grip", async () => {
    await four();
    press(screen.getByRole("button", { name: "Actions for A" }), 100, 120);
    move(row(/^A,/), 100, 140);
    expect(h.rt.stores.drag.getState().kind).toBe("none");
  });

  it("a rejected reorder puts the rows back and shows the error", async () => {
    await four();
    h.ipc.failNext("reorderPolls", "no way");
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 249);
    release(row(/^A,/), 100, 249);
    expect(await screen.findByText("no way")).toBeVisible();
    expect(rowNames()).toEqual(["A", "B", "C", "D"]);
  });

  it("the profile does not become Modified", async () => {
    await four();
    h.clean();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 249);
    release(row(/^A,/), 100, 249);
    await h.act(async () => {});
    expect(h.rt.stores.profile.getState().modified).toBe(false);
  });
});

describe("auto-scroll of the list (DES-002 2.10.6)", () => {
  it("scrolls 8 px per frame while the pointer is within 24 px of the bottom edge, and stops outside", async () => {
    await four();
    const frames: Array<() => void> = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(() => cb(0));
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    let top = 0;
    Object.defineProperty(list(), "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    const runFrame = () => {
      const next = frames.splice(0);
      act(() => {
        for (const f of next) f();
      });
    };
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    // Near the bottom edge of the list (400 + 100 = 500).
    move(row(/^A,/), 100, 495);
    runFrame();
    expect(top).toBe(8);
    runFrame();
    expect(top).toBe(16);
    // Back to the middle: the next frame does not scroll and schedules nothing more.
    move(row(/^A,/), 100, 300);
    runFrame();
    expect(top).toBe(16);
    expect(frames).toHaveLength(0);
    release(row(/^A,/), 100, 300);
  });

  it("scrolls up near the top edge", async () => {
    await four();
    const frames: Array<() => void> = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(() => cb(0));
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    let top = 40;
    Object.defineProperty(list(), "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, v);
      },
    });
    press(row(/^C,/), 100, 220);
    move(row(/^C,/), 100, 200);
    move(row(/^C,/), 100, 110);
    act(() => {
      for (const f of frames.splice(0)) f();
    });
    expect(top).toBe(32);
    release(row(/^C,/), 100, 110);
  });
});

describe("drag a row into the workspace (DES-002 2.10.7)", () => {
  /** The pointer in workspace coordinates (x, y) is at client (300 + x, 56 + y). */
  const at = (x: number, y: number) => [300 + x, 56 + y] as const;

  async function dragTo(rowName: RegExp, x: number, y: number, mods: { altKey?: boolean } = {}) {
    const el = row(rowName);
    const [cx, cy] = at(x, y);
    press(el, 100, 270);
    move(el, 120, 270);
    move(el, cx, cy, mods);
    return { el, cx, cy };
  }

  it("a closed poll dropped at the right edge shows in the right half", async () => {
    const [, , c] = await four();
    await h.act(() => h.ipc.closePollView(c, true));
    layoutRects();
    expect(frame(c)).toBeNull();
    const { el, cx, cy } = await dragTo(/^C,/, 1320, 300);
    const preview = screen.getByTestId("list-preview");
    expect(preview).toHaveAttribute("data-place", "zone");
    expect(preview.className).toContain("border-dashed");
    expect(box(preview)).toEqual({ left: 670, top: 8, width: 654, height: 700 });
    release(el, cx, cy);
    await waitFor(() => expect(frame(c)).not.toBeNull());
    expect(box(frame(c) as HTMLElement)).toEqual({ left: 670, top: 8, width: 654, height: 700 });
    expect(frame(c)).toHaveAttribute("aria-current", "true");
    expect(live()).toHaveTextContent("C moved to the right half.");
    const call = h.ipc.callsOf("showPoll").at(-1) as [PollId, { workspaceRect: { x: number } }];
    expect(call[0]).toBe(c);
    expect(call[1].workspaceRect).toMatchObject({ x: 670, width: 654, state: "normal" });
  });

  it("a closed poll dropped in the middle: 640 x 368 with the title bar centered under the pointer", async () => {
    const [, , c] = await four();
    await h.act(() => h.ipc.closePollView(c, true));
    layoutRects();
    const { el, cx, cy } = await dragTo(/^C,/, 600, 300);
    expect(screen.getByTestId("list-preview")).toHaveAttribute("data-place", "rect");
    release(el, cx, cy);
    await waitFor(() => expect(frame(c)).not.toBeNull());
    expect(box(frame(c) as HTMLElement)).toEqual({ left: 280, top: 285, width: 640, height: 368 });
    expect(live()).toHaveTextContent("C shown in the workspace.");
  });

  it("the preview is gone after the drop and while the pointer is back over the list", async () => {
    const [, , c] = await four();
    await h.act(() => h.ipc.closePollView(c, true));
    layoutRects();
    const { el } = await dragTo(/^C,/, 600, 300);
    expect(screen.getByTestId("list-preview")).toBeVisible();
    move(el, 100, 270);
    expect(screen.queryByTestId("list-preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("list-drop-indicator")).toBeVisible();
    release(el, 100, 270);
  });

  it("a poll that is a sub-window already moves there, is restored and activated", async () => {
    const [a, b] = await four();
    await h.act(() => h.rt.stores.workspace.getState().minimize(a));
    layoutRects();
    const { el, cx, cy } = await dragTo(/^A,/, 600, 300);
    release(el, cx, cy);
    await waitFor(() => expect(frame(a)).not.toBeNull());
    expect(box(frame(a) as HTMLElement)).toMatchObject({ left: 280, top: 285 });
    expect(frame(a)).toHaveAttribute("aria-current", "true");
    expect(frame(b)).not.toHaveAttribute("aria-current", "true");
    // Nothing goes to Rust but the layout: the sub-window was there.
    expect(h.ipc.callsOf("showPoll")).toHaveLength(0);
  });

  it("in tile mode the poll takes the slot under the pointer, in the list order too", async () => {
    const [a, b, c, d] = await four();
    await h.act(() => h.rt.stores.workspace.getState().tile());
    layoutRects();
    // A 2 x 2 grid: the lower left cell is slot 2 (index 2). Drag A there.
    const { el, cx, cy } = await dragTo(/^A,/, 100, 600);
    expect(screen.getByTestId("list-preview")).toHaveAttribute("data-place", "slot");
    release(el, cx, cy);
    await waitFor(() => expect(h.ipc.callsOf("reorderPolls")).toEqual([[[b, c, a, d]]]));
    expect(live()).toHaveTextContent("A moved to slot 3 of 4.");
  });

  it("a poll in its own window is docked at the drop point with a handoff request", async () => {
    await four();
    const n = await h.addPoll("N", {}, "native");
    layoutRects();
    const { el, cx, cy } = await dragTo(/^N,/, 600, 300);
    release(el, cx, cy);
    await waitFor(() => expect(frame(n)).not.toBeNull());
    const call = h.ipc.callsOf("dockPoll")[0] as [PollId, null, boolean, { x: number; y: number }];
    expect(call.slice(0, 3)).toEqual([n, null, true]);
    expect(call[3]).toMatchObject({ x: 280, y: 285 });
    expect(box(frame(n) as HTMLElement)).toMatchObject({ left: 280, top: 285 });
  });

  it("a refused list drag of a native poll says to close the dialog in its window first", async () => {
    await four();
    const pump = await h.addPoll("Pump 2", {}, "native");
    // The native window has a dialog open: it refuses the handoff request.
    await h.ipc.attachPollView(pump, "native", (event) => {
      if (event.type === "HandoffRequested") void h.ipc.provideHandoff(pump, null);
    });
    layoutRects();
    const { el, cx, cy } = await dragTo(/^Pump 2,/, 600, 300);
    release(el, cx, cy);
    expect(await screen.findByText('Close the dialog in the "Pump 2" window first.')).toBeVisible();
    expect(frame(pump)).toBeNull();
    expect(row(/^Pump 2,/)).toHaveTextContent("own window");
  });

  it("another dock failure is the dock toast", async () => {
    await four();
    await h.addPoll("N", {}, "native");
    layoutRects();
    h.ipc.failNext("dockPoll", new IpcError("gone", "internal"));
    const { el, cx, cy } = await dragTo(/^N,/, 600, 300);
    release(el, cx, cy);
    expect(await screen.findByText("Could not dock the poll: gone")).toBeVisible();
  });

  it("Esc over the workspace cancels: nothing is shown or sent", async () => {
    const [, , c] = await four();
    await h.act(() => h.ipc.closePollView(c, true));
    layoutRects();
    const { el, cx, cy } = await dragTo(/^C,/, 600, 300);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("list-preview")).not.toBeInTheDocument();
    release(el, cx, cy);
    expect(frame(c)).toBeNull();
    expect(h.ipc.callsOf("showPoll")).toHaveLength(0);
    expect(live()).toHaveTextContent("Move cancelled.");
  });

  it("Alt turns the snap zone off while dragging", async () => {
    const [, , c] = await four();
    await h.act(() => h.ipc.closePollView(c, true));
    layoutRects();
    const { el, cx, cy } = await dragTo(/^C,/, 1320, 300, { altKey: true });
    expect(screen.getByTestId("list-preview")).toHaveAttribute("data-place", "rect");
    release(el, cx, cy);
  });
});

describe("a row that goes away mid-drag (REV-006 m-2)", () => {
  it("the ghost goes, the drag ends, and Esc is not swallowed afterwards", async () => {
    const [a] = await four();
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 200);
    expect(screen.getByTestId("list-drag-ghost")).toBeInTheDocument();
    await h.act(async () => {
      await h.ipc.removePoll(a);
    });
    expect(h.rt.stores.drag.getState().kind).toBe("none");
    expect(screen.queryByTestId("list-drag-ghost")).not.toBeInTheDocument();
    expect(screen.queryByTestId("list-drop-indicator")).not.toBeInTheDocument();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(live()).not.toHaveTextContent("Move cancelled.");
  });

  it("the list changing during the drag moves the dragged poll, not the one at its old index (m-3)", async () => {
    const [a, b, c, d] = await four();
    press(row(/^C,/), 100, 220);
    move(row(/^C,/), 100, 230);
    move(row(/^C,/), 100, 140);
    // A is deleted while the button is held.
    await h.act(async () => {
      await h.ipc.removePoll(a);
    });
    layoutRects();
    move(row(/^C,/), 100, 105);
    release(row(/^C,/), 100, 105);
    await waitFor(() => expect(h.ipc.callsOf("reorderPolls")).toHaveLength(1));
    expect(h.ipc.callsOf("reorderPolls")[0]).toEqual([[c, b, d]]);
    expect(live()).toHaveTextContent("C moved to position 1 of 3.");
    expect(a).toBeGreaterThan(0);
  });

  it("a rejected reorder is not announced (m-4)", async () => {
    await four();
    h.ipc.failNext("reorderPolls", "no way");
    press(row(/^A,/), 100, 120);
    move(row(/^A,/), 100, 140);
    move(row(/^A,/), 100, 249);
    release(row(/^A,/), 100, 249);
    expect(await screen.findByText("no way")).toBeVisible();
    expect(live()).not.toHaveTextContent("moved to position");
  });

  it("a release 10 px above the first row still lands in the list (small item a)", async () => {
    const [a, b, c, d] = await four();
    press(row(/^D,/), 100, 270);
    move(row(/^D,/), 100, 250);
    move(row(/^D,/), 100, 90);
    expect(screen.getByTestId("list-drop-indicator")).toHaveAttribute("data-gap-index", "0");
    release(row(/^D,/), 100, 90);
    await waitFor(() => expect(h.ipc.callsOf("reorderPolls")).toEqual([[[d, a, b, c]]]));
  });
});
