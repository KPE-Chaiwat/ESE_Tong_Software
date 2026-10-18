import { act, screen, waitFor, within } from "@testing-library/react";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;
afterEach(() => h?.rt.dispose());

const workspace = () => screen.getByRole("region", { name: "Workspace" });
const widgets = () => Array.from(workspace().querySelectorAll<HTMLElement>(".grid-stack-item"));

describe("GridStack workspace (REQ-008)", () => {
  it("adds Polls as grid widgets while keeping each PollView mounted", async () => {
    h = await renderWindow();
    expect(within(workspace()).getByTestId("workspace-empty")).toHaveTextContent("No polls yet");
    const a = await h.addPoll("Tank A");
    const b = await h.addPoll("Tank B");
    await waitFor(() => expect(widgets()).toHaveLength(2));
    expect(
      widgets()
        .map((el) => el.getAttribute("gs-id"))
        .sort(),
    ).toEqual([String(a), String(b)].sort());
    expect(workspace().querySelectorAll("[data-subwindow]")).toHaveLength(2);
    expect(workspace().querySelectorAll('[aria-label="Poll view"]')).toHaveLength(2);
    expect(workspace().querySelector('[data-slot="drag-overlay"]')).toBeNull();
  });

  it("minimizes and restores a Poll without deleting its widget definition", async () => {
    h = await renderWindow();
    const id = await h.addPoll("Pressure");
    await waitFor(() => expect(widgets()).toHaveLength(1));
    await h.user.click(within(workspace()).getByRole("button", { name: "Minimize" }));
    await waitFor(() => expect(widgets()).toHaveLength(0));
    expect(screen.getByRole("region", { name: "Minimized windows" })).toBeVisible();
    await h.user.click(screen.getByTitle("Restore Pressure"));
    await waitFor(() => expect(widgets()).toHaveLength(1));
    expect(widgets()[0]).toHaveAttribute("gs-id", String(id));
  });

  it("offers Reset grid layout and hides legacy freeform layout commands", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    await h.addPoll("B");
    await h.user.click(screen.getByRole("button", { name: "Window" }));
    expect(screen.getByRole("menuitem", { name: /Reset grid layout/ })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Cascade" })).toBeNull();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Tile mode" })).toBeNull();
    await h.user.click(screen.getByRole("menuitem", { name: /Reset grid layout/ }));
    await waitFor(() => expect(widgets()).toHaveLength(2));
    expect(h.rt.stores.workspace.getState().tileMode).toBe(false);
  });

  it("stores exact grid cells in the workspace layout after a completed change", async () => {
    h = await renderWindow();
    const id = await h.addPoll("Flow");
    const store = h.rt.stores.workspace;
    await act(async () => {
      store.getState().setGridRects([
        {
          id,
          grid: { x: 2, y: 3, w: 4, h: 5, columns: 8 },
          rect: { x: 320, y: 144, width: 640, height: 240 },
        },
      ]);
    });
    expect(
      store
        .getState()
        .toLayout()
        .items.find((entry) => entry.pollId === id)?.rect.grid,
    ).toEqual({ x: 2, y: 3, w: 4, h: 5, columns: 8 });
  });
});
