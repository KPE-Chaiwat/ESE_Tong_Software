import { vi } from "vitest";
import type { MenuEntry } from "@/shared/ui/menu";
import { type PollRowMenuInput, pollRowMenuEntries } from "./poll-row-menu";

function input(patch: Partial<PollRowMenuInput> = {}): PollRowMenuInput {
  return {
    hostState: "workspace.normal",
    lastHostNative: false,
    running: true,
    isFirst: false,
    isLast: false,
    atLimit: false,
    onShow: vi.fn(),
    onShowInWorkspace: vi.fn(),
    onPopOut: vi.fn(),
    onDock: vi.fn(),
    onToggle: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onShowTraffic: vi.fn(),
    onDelete: vi.fn(),
    ...patch,
  };
}

type Item = MenuEntry & { label: string; shortcut?: string; disabled?: boolean; title?: string };
const labels = (entries: MenuEntry[]) =>
  entries.map((e) => (e.kind === "separator" ? "-" : (e as Item).label));
const find = (entries: MenuEntry[], id: string) =>
  entries.find((e) => e.id === id) as Item & { onSelect: () => void };

describe("poll row menu (DES-002 2.2.3, 2.10.8)", () => {
  it("a sub-window: Show, Pop out, Pause, Rename, Duplicate, Move up, Move down, traffic, Delete", () => {
    expect(labels(pollRowMenuEntries(input()))).toEqual([
      "Show",
      "Pop out to own window",
      "Pause",
      "Rename",
      "Duplicate",
      "Move up",
      "Move down",
      "Show traffic for this poll",
      "-",
      "Delete…",
    ]);
  });

  it("the shortcuts are shown", () => {
    const e = pollRowMenuEntries(input());
    expect(find(e, "pop-out").shortcut).toBe("Ctrl+Shift+O");
    expect(find(e, "toggle").shortcut).toBe("Ctrl+P");
    expect(find(e, "rename").shortcut).toBe("F2");
    expect(find(e, "move-up").shortcut).toBe("Alt+Up");
    expect(find(e, "move-down").shortcut).toBe("Alt+Down");
    expect(find(e, "delete").shortcut).toBe("Delete");
  });

  it("a poll in its own window offers Dock to workspace instead of Pop out", () => {
    const labelsOf = labels(pollRowMenuEntries(input({ hostState: "native" })));
    expect(labelsOf).toContain("Dock to workspace");
    expect(labelsOf).not.toContain("Pop out to own window");
  });

  it("a closed poll has neither; one that was in its own window can be shown in the workspace", () => {
    const closed = labels(pollRowMenuEntries(input({ hostState: "closed" })));
    expect(closed).not.toContain("Pop out to own window");
    expect(closed).not.toContain("Dock to workspace");
    expect(closed).not.toContain("Show in workspace");
    const closedNative = labels(
      pollRowMenuEntries(input({ hostState: "closed", lastHostNative: true })),
    );
    expect(closedNative).toContain("Show in workspace");
  });

  it("a minimized or maximized sub-window can pop out", () => {
    for (const hostState of ["workspace.minimized", "workspace.maximized"] as const) {
      expect(labels(pollRowMenuEntries(input({ hostState })))).toContain("Pop out to own window");
    }
  });

  it("Resume replaces Pause while the poll does not run", () => {
    expect(find(pollRowMenuEntries(input({ running: false })), "toggle").label).toBe("Resume");
    expect(find(pollRowMenuEntries(input({ running: true })), "toggle").label).toBe("Pause");
  });

  it("Move up is off on the first row, Move down on the last", () => {
    const first = pollRowMenuEntries(input({ isFirst: true }));
    expect(find(first, "move-up").disabled).toBe(true);
    expect(find(first, "move-down").disabled).toBe(false);
    const last = pollRowMenuEntries(input({ isLast: true }));
    expect(find(last, "move-down").disabled).toBe(true);
    expect(find(last, "move-up").disabled).toBe(false);
  });

  it("Duplicate is off at 16 polls, with the title", () => {
    const e = pollRowMenuEntries(input({ atLimit: true }));
    expect(find(e, "duplicate")).toMatchObject({
      disabled: true,
      title: "A connection can have at most 16 polls.",
    });
    expect(find(pollRowMenuEntries(input()), "duplicate").disabled).toBe(false);
  });

  it("every entry calls its handler", () => {
    const i = input({ hostState: "native" });
    const e = pollRowMenuEntries(i);
    for (const id of [
      "show",
      "dock",
      "toggle",
      "rename",
      "duplicate",
      "move-up",
      "move-down",
      "traffic",
      "delete",
    ]) {
      find(e, id).onSelect();
    }
    expect(i.onShow).toHaveBeenCalledOnce();
    expect(i.onDock).toHaveBeenCalledOnce();
    expect(i.onToggle).toHaveBeenCalledOnce();
    expect(i.onRename).toHaveBeenCalledOnce();
    expect(i.onDuplicate).toHaveBeenCalledOnce();
    expect(i.onMoveUp).toHaveBeenCalledOnce();
    expect(i.onMoveDown).toHaveBeenCalledOnce();
    expect(i.onShowTraffic).toHaveBeenCalledOnce();
    expect(i.onDelete).toHaveBeenCalledOnce();
    expect(i.onPopOut).not.toHaveBeenCalled();
  });
});
