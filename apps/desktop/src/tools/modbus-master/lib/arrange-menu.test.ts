import { vi } from "vitest";
import type { MonitorInfo } from "@/shared/ipc/modbus-master.types";
import type { MenuEntry } from "@/shared/ui/menu";
import {
  ARRANGE_LAYOUTS,
  arrangeMenuEntries,
  EACH_MONITOR_LABEL,
  monitorLabel,
  NO_NATIVE_TITLE,
  sameTarget,
} from "./arrange-menu";

const monitor = (id: string, label: string, primary: boolean): MonitorInfo => ({
  id,
  label,
  name: id,
  primary,
  workArea: { x: 0, y: 0, width: 1920, height: 1032 },
  scaleFactor: 1,
});
const MONITORS = [monitor("D1", "Display 1", true), monitor("D2", "Display 2", false)];

type Item = MenuEntry & { onSelect: () => void; checked?: boolean; shortcut?: string };
const byId = (entries: MenuEntry[], id: string) => entries.find((e) => e.id === id) as Item;

describe("arrange menu (DES-002 2.8.5)", () => {
  it("lists the layouts, then 'Arrange on:' with each monitor and one entry per display", () => {
    const entries = arrangeMenuEntries({
      monitors: MONITORS,
      target: { kind: "eachMonitor" },
      onArrange: vi.fn(),
      onTarget: vi.fn(),
    });
    expect(
      entries.map((e) => (e.kind === "separator" ? "-" : (e as { label: string }).label)),
    ).toEqual([
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
    expect(entries.find((e) => e.id === "arrange-on")?.kind).toBe("heading");
    expect(EACH_MONITOR_LABEL).toBe("Each monitor (in place)");
    expect(ARRANGE_LAYOUTS.map((l) => l.layout)).toEqual([
      "tile",
      "sideBySide",
      "stacked",
      "cascade",
    ]);
  });

  it("the radio of the chosen target is checked", () => {
    const each = arrangeMenuEntries({
      monitors: MONITORS,
      target: { kind: "eachMonitor" },
      onArrange: vi.fn(),
      onTarget: vi.fn(),
    });
    expect(byId(each, "target-each").checked).toBe(true);
    expect(byId(each, "target-D1").checked).toBe(false);
    const second = arrangeMenuEntries({
      monitors: MONITORS,
      target: { kind: "monitor", monitorId: "D2" },
      onArrange: vi.fn(),
      onTarget: vi.fn(),
    });
    expect(byId(second, "target-each").checked).toBe(false);
    expect(byId(second, "target-D2").checked).toBe(true);
    expect(byId(second, "target-D2").kind).toBe("radio");
  });

  it("choosing a layout or a target calls back with it", () => {
    const onArrange = vi.fn();
    const onTarget = vi.fn();
    const entries = arrangeMenuEntries({
      monitors: MONITORS,
      target: { kind: "eachMonitor" },
      onArrange,
      onTarget,
    });
    byId(entries, "arrange-stacked").onSelect();
    byId(entries, "arrange-cascade").onSelect();
    byId(entries, "target-D1").onSelect();
    byId(entries, "target-each").onSelect();
    expect(onArrange.mock.calls).toEqual([["stacked"], ["cascade"]]);
    expect(onTarget.mock.calls).toEqual([
      [{ kind: "monitor", monitorId: "D1" }],
      [{ kind: "eachMonitor" }],
    ]);
  });

  it("only a native window shows the Tile shortcut (in W1 Ctrl+Shift+T tiles the workspace)", () => {
    const base = {
      monitors: MONITORS,
      target: { kind: "eachMonitor" } as const,
      onArrange: vi.fn(),
      onTarget: vi.fn(),
    };
    expect(byId(arrangeMenuEntries(base), "arrange-tile").shortcut).toBeUndefined();
    expect(
      byId(arrangeMenuEntries({ ...base, tileShortcut: "Ctrl+Shift+T" }), "arrange-tile").shortcut,
    ).toBe("Ctrl+Shift+T");
    expect(
      byId(arrangeMenuEntries({ ...base, tileShortcut: "Ctrl+Shift+T" }), "arrange-cascade")
        .shortcut,
    ).toBeUndefined();
  });

  it("with no monitor list there is still 'Each monitor (in place)'", () => {
    const entries = arrangeMenuEntries({
      monitors: [],
      target: { kind: "eachMonitor" },
      onArrange: vi.fn(),
      onTarget: vi.fn(),
    });
    expect(entries.filter((e) => e.kind === "radio")).toHaveLength(1);
  });

  it("labels and targets", () => {
    expect(monitorLabel(MONITORS[0] as MonitorInfo)).toBe("Display 1 (primary)");
    expect(monitorLabel(MONITORS[1] as MonitorInfo)).toBe("Display 2");
    expect(sameTarget({ kind: "eachMonitor" }, { kind: "eachMonitor" })).toBe(true);
    expect(sameTarget({ kind: "eachMonitor" }, { kind: "monitor", monitorId: "D1" })).toBe(false);
    expect(
      sameTarget({ kind: "monitor", monitorId: "D1" }, { kind: "monitor", monitorId: "D1" }),
    ).toBe(true);
    expect(
      sameTarget({ kind: "monitor", monitorId: "D1" }, { kind: "monitor", monitorId: "D2" }),
    ).toBe(false);
    expect(NO_NATIVE_TITLE).toBe("No poll is open in its own window.");
  });
});
