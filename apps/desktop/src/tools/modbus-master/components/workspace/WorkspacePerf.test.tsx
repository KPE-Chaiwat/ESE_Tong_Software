// Render counts during a drag (DES-002 2.10.10): the dragged frame moves by a transform applied to
// its element, and no other sub-window or table renders.
import { fireEvent, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

const renders = vi.hoisted(() => ({ byPoll: new Map<number, number>() }));

// The shared PollView renders inside a frame: counting its renders counts the renders of the frame.
vi.mock("../poll-view/PollView", () => ({
  PollView: ({ runtime }: { runtime: { pollId: number } }) => {
    renders.byPoll.set(runtime.pollId, (renders.byPoll.get(runtime.pollId) ?? 0) + 1);
    return <div data-testid={`view-${runtime.pollId}`} />;
  },
}));

let h: Harness;
afterEach(() => h?.rt.dispose());

const bar = (id: PollId) =>
  within(
    screen
      .getByRole("region", { name: "Workspace" })
      .querySelector(`[data-subwindow="${id}"]`) as HTMLElement,
  ).getByRole("toolbar");

describe("drag performance (DES-002 2.10.10)", () => {
  it("60 pointer moves render no frame at all; the release renders only the dragged one", async () => {
    renders.byPoll.clear();
    h = await renderWindow();
    const ids: PollId[] = [];
    for (const n of ["A", "B", "C"]) ids.push(await h.addPoll(n));
    const [a] = ids as [PollId, PollId, PollId];
    fireEvent.pointerDown(bar(a), {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    // The press raised and activated A: that is the only change of the active frames.
    const before = new Map(renders.byPoll);
    for (let i = 1; i <= 60; i += 1) {
      fireEvent.pointerMove(bar(a), { pointerId: 1, clientX: 100 + i * 5, clientY: 100 + i * 2 });
    }
    expect(h.rt.stores.drag.getState().kind).toBe("move");
    for (const id of ids) expect(renders.byPoll.get(id)).toBe(before.get(id));
    fireEvent.pointerUp(bar(a), { pointerId: 1 });

    // The commit renders only the dragged frame, once; the others stay untouched.
    for (const id of ids.slice(1)) expect(renders.byPoll.get(id)).toBe(before.get(id));
    expect((renders.byPoll.get(a) ?? 0) - (before.get(a) ?? 0)).toBeLessThanOrEqual(2);
  });

  it("the dragged frame is moved by its element style, not by its props", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const frame = screen
      .getByRole("region", { name: "Workspace" })
      .querySelector(`[data-subwindow="${a}"]`) as HTMLElement;
    fireEvent.pointerDown(bar(a), {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(bar(a), { pointerId: 1, clientX: 200, clientY: 150 });
    expect(frame.style.transform).toBe("translate(100px, 50px)");
    expect(frame.style.left).toBe("8px");
    fireEvent.pointerUp(bar(a), { pointerId: 1 });
  });

  it("a steady stream of poll updates does not render the other frames either", async () => {
    renders.byPoll.clear();
    h = await renderWindow();
    const ids: PollId[] = [];
    for (const n of ["A", "B"]) ids.push(await h.addPoll(n));
    await h.connect();
    h.advance(300);
    const before = new Map(renders.byPoll);
    h.advance(2000);
    for (const id of ids) expect(renders.byPoll.get(id)).toBe(before.get(id));
  });
});
