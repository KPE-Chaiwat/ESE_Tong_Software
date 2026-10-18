import { vi } from "vitest";
import type { MenuEntry } from "@/shared/ui/menu";
import { NO_NATIVE_TITLE, type WindowMenuInput, windowMenuEntries } from "./window-menu";

function input(patch: Partial<WindowMenuInput> = {}): WindowMenuInput {
  return {
    visibleCount: 2,
    minimizedCount: 0,
    maximizedCount: 0,
    workspaceCount: 2,
    tileMode: false,
    compact: false,
    nativeCount: 0,
    polls: [
      { id: 1, name: "Tank 1", marker: null },
      { id: 2, name: "Pump 2", marker: "minimized" },
      { id: 3, name: "Valves", marker: "own window" },
      { id: 4, name: "Old", marker: "closed" },
    ],
    activeId: 1,
    monitors: [
      {
        id: "D1",
        label: "Display 1",
        name: "D1",
        primary: true,
        workArea: { x: 0, y: 0, width: 1920, height: 1032 },
        scaleFactor: 1,
      },
      {
        id: "D2",
        label: "Display 2",
        name: "D2",
        primary: false,
        workArea: { x: 1920, y: 0, width: 1920, height: 1032 },
        scaleFactor: 1,
      },
    ],
    arrangeTarget: { kind: "eachMonitor" },
    onTile: vi.fn(),
    onTileMode: vi.fn(),
    onCascade: vi.fn(),
    onArrangeMinimized: vi.fn(),
    onMinimizeAll: vi.fn(),
    onRestoreAll: vi.fn(),
    onCompact: vi.fn(),
    onShowNatives: vi.fn(),
    onArrange: vi.fn(),
    onArrangeTarget: vi.fn(),
    onArrangeOpen: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onShowPoll: vi.fn(),
    ...patch,
  };
}

const entry = (entries: MenuEntry[], id: string) =>
  entries.find((e) => e.id === id) as MenuEntry & {
    disabled?: boolean;
    title?: string;
    checked?: boolean;
    label: string;
    shortcut?: string;
    onSelect: () => void;
  };

describe("Window menu (DES-002 2.7)", () => {
  it("lists the items in the design order with their shortcuts", () => {
    const entries = windowMenuEntries(input());
    expect(
      entries
        .filter((e) => e.kind !== "separator")
        .slice(0, 12)
        .map((e) => ("label" in e ? e.label : "")),
    ).toEqual([
      "Tile",
      "Tile mode",
      "Cascade",
      "Arrange minimized",
      "Minimize all",
      "Restore all",
      "Collapse setup panels",
      "Popped-out windows",
      "Bring popped-out windows to front",
      "Next sub-window",
      "Previous sub-window",
      "1 Tank 1",
    ]);
    expect(entry(entries, "tile").shortcut).toBe("Ctrl+Shift+T");
    expect(entry(entries, "cascade").shortcut).toBe("Ctrl+Shift+C");
    expect(entry(entries, "compact").shortcut).toBe("Ctrl+Shift+\\");
    expect(entry(entries, "bring-natives").shortcut).toBe("Ctrl+Shift+A");
    expect(entry(entries, "next").shortcut).toBe("Ctrl+F6");
    expect(entry(entries, "previous").shortcut).toBe("Ctrl+Shift+F6");
  });

  it("Tile, Cascade and Minimize all need one visible sub-window", () => {
    const none = windowMenuEntries(input({ visibleCount: 0 }));
    for (const id of ["tile", "cascade", "minimize-all"])
      expect(entry(none, id).disabled).toBe(true);
    const some = windowMenuEntries(input({ visibleCount: 1 }));
    for (const id of ["tile", "cascade", "minimize-all"])
      expect(entry(some, id).disabled).toBe(false);
  });

  it("Arrange minimized needs a minimized window; Restore all a minimized or maximized one", () => {
    const e = windowMenuEntries(input());
    expect(entry(e, "arrange-minimized").disabled).toBe(true);
    expect(entry(e, "restore-all").disabled).toBe(true);
    expect(
      entry(windowMenuEntries(input({ minimizedCount: 1 })), "arrange-minimized").disabled,
    ).toBe(false);
    expect(entry(windowMenuEntries(input({ maximizedCount: 1 })), "restore-all").disabled).toBe(
      false,
    );
  });

  it("Tile mode and Collapse setup panels are checkboxes that follow the state", () => {
    const on = windowMenuEntries(input({ tileMode: true, compact: true }));
    expect(entry(on, "tile-mode")).toMatchObject({ kind: "check", checked: true });
    expect(entry(on, "compact")).toMatchObject({ kind: "check", checked: true });
    const handlers = input({ tileMode: true });
    entry(windowMenuEntries(handlers), "tile-mode").onSelect();
    expect(handlers.onTileMode).toHaveBeenCalledWith(false);
    const handlers2 = input();
    entry(windowMenuEntries(handlers2), "compact").onSelect();
    expect(handlers2.onCompact).toHaveBeenCalledWith(true);
  });

  it("Popped-out windows is disabled with the exact title when none is open", () => {
    const e = windowMenuEntries(input());
    expect(entry(e, "popped-out")).toMatchObject({ disabled: true, title: NO_NATIVE_TITLE });
    expect(NO_NATIVE_TITLE).toBe("No poll is open in its own window.");
    expect(entry(e, "bring-natives")).toMatchObject({ disabled: true, title: NO_NATIVE_TITLE });
    expect(entry(windowMenuEntries(input({ nativeCount: 2 })), "bring-natives").disabled).toBe(
      false,
    );
  });

  it("Popped-out windows is a submenu that arranges the native windows (DES-002 2.8.5)", () => {
    const i = input({ nativeCount: 2 });
    const popped = entry(windowMenuEntries(i), "popped-out") as unknown as {
      kind: string;
      disabled?: boolean;
      title?: string;
      entries: MenuEntry[];
      onOpen: () => void;
    };
    expect(popped.kind).toBe("submenu");
    expect(popped.disabled).toBe(false);
    expect(popped.title).toBeUndefined();
    expect(popped.entries.map((e) => ("label" in e ? e.label : "-"))).toEqual([
      "Tile",
      "Side by side",
      "Stacked",
      "Cascade",
      "-",
      "Arrange on:",
      "Each monitor (in place)",
      "Display 1 (primary)",
      "Display 2",
    ]);
    popped.onOpen();
    expect(i.onArrangeOpen).toHaveBeenCalledOnce();
    const item = (id: string) =>
      popped.entries.find((e) => e.id === id) as MenuEntry & { onSelect: () => void };
    item("arrange-sideBySide").onSelect();
    expect(i.onArrange).toHaveBeenCalledWith("sideBySide");
    item("target-D2").onSelect();
    expect(i.onArrangeTarget).toHaveBeenCalledWith({ kind: "monitor", monitorId: "D2" });
    item("target-each").onSelect();
    expect(i.onArrangeTarget).toHaveBeenLastCalledWith({ kind: "eachMonitor" });
  });

  it("Next and Previous need two sub-windows that are not minimized (REV-006 n-5)", () => {
    expect(entry(windowMenuEntries(input({ visibleCount: 1 })), "next").disabled).toBe(true);
    expect(entry(windowMenuEntries(input({ visibleCount: 2 })), "previous").disabled).toBe(false);
    // One visible and one minimized: the cycle has nowhere to go.
    expect(
      entry(
        windowMenuEntries(input({ visibleCount: 1, minimizedCount: 1, workspaceCount: 2 })),
        "next",
      ).disabled,
    ).toBe(true);
  });

  it("lists every poll in list order with a check on the active one and the host marker", () => {
    const e = windowMenuEntries(input());
    expect(entry(e, "poll-1")).toMatchObject({ kind: "check", label: "1 Tank 1", checked: true });
    expect(entry(e, "poll-2")).toMatchObject({ label: "2 Pump 2 (minimized)", checked: false });
    expect(entry(e, "poll-3").label).toBe("3 Valves (own window)");
    expect(entry(e, "poll-4").label).toBe("4 Old (closed)");
  });

  it("choosing a poll shows it", () => {
    const i = input();
    entry(windowMenuEntries(i), "poll-3").onSelect();
    expect(i.onShowPoll).toHaveBeenCalledWith(3);
  });

  it("has no poll entries and no extra separator for an empty list", () => {
    const e = windowMenuEntries(input({ polls: [] }));
    expect(e.some((x) => x.id.startsWith("poll-"))).toBe(false);
    expect(e.some((x) => x.id === "sep-polls")).toBe(false);
  });
});
