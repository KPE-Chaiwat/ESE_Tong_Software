// The menu that arranges the poll windows (DES-002 2.8.5, M2). Pure: the state in, the entries out.
// The Window menu of W1 shows it as the submenu "Popped-out windows", a native window in its `⋯`
// menu as "Arrange poll windows".
import type { ArrangeLayout, ArrangeTarget, MonitorInfo } from "@/shared/ipc/modbus-master.types";
import type { MenuEntry } from "@/shared/ui/menu";

export const NO_NATIVE_TITLE = "No poll is open in its own window.";

export const EACH_MONITOR_LABEL = "Each monitor (in place)";

export const ARRANGE_LAYOUTS: ReadonlyArray<{ layout: ArrangeLayout; label: string }> = [
  { layout: "tile", label: "Tile" },
  { layout: "sideBySide", label: "Side by side" },
  { layout: "stacked", label: "Stacked" },
  { layout: "cascade", label: "Cascade" },
];

export const EACH_MONITOR: ArrangeTarget = { kind: "eachMonitor" };

/** "Display 1 (primary)", "Display 2": the radio of one monitor. */
export function monitorLabel(m: Pick<MonitorInfo, "label" | "primary">): string {
  return m.primary ? `${m.label} (primary)` : m.label;
}

export function sameTarget(a: ArrangeTarget, b: ArrangeTarget): boolean {
  return a.kind === "eachMonitor"
    ? b.kind === "eachMonitor"
    : b.kind === "monitor" && a.monitorId === b.monitorId;
}

export interface ArrangeMenuInput {
  monitors: readonly MonitorInfo[];
  target: ArrangeTarget;
  /** The shortcut text of Tile: "Ctrl+Shift+T" in a native window, none in W1 (it tiles the workspace). */
  tileShortcut?: string;
  onArrange(layout: ArrangeLayout): void;
  onTarget(target: ArrangeTarget): void;
}

/** Tile · Side by side · Stacked · Cascade · "Arrange on:" with one radio per target. */
export function arrangeMenuEntries(input: ArrangeMenuInput): MenuEntry[] {
  return [
    ...ARRANGE_LAYOUTS.map(
      ({ layout, label }): MenuEntry => ({
        kind: "item",
        id: `arrange-${layout}`,
        label,
        ...(layout === "tile" && input.tileShortcut ? { shortcut: input.tileShortcut } : {}),
        onSelect: () => input.onArrange(layout),
      }),
    ),
    { kind: "separator", id: "arrange-sep" },
    { kind: "heading", id: "arrange-on", label: "Arrange on:" },
    {
      kind: "radio",
      id: "target-each",
      label: EACH_MONITOR_LABEL,
      checked: input.target.kind === "eachMonitor",
      onSelect: () => input.onTarget(EACH_MONITOR),
    },
    ...input.monitors.map(
      (m): MenuEntry => ({
        kind: "radio",
        id: `target-${m.id}`,
        label: monitorLabel(m),
        checked: input.target.kind === "monitor" && input.target.monitorId === m.id,
        onSelect: () => input.onTarget({ kind: "monitor", monitorId: m.id }),
      }),
    ),
  ];
}
