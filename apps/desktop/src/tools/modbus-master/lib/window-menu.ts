// The Window menu of the connection window (DES-002 2.7). Pure: the state in, the entries out.
import type {
  ArrangeLayout,
  ArrangeTarget,
  MonitorInfo,
  PollId,
} from "@/shared/ipc/modbus-master.types";
import type { MenuEntry } from "@/shared/ui/menu";
import { arrangeMenuEntries, NO_NATIVE_TITLE } from "./arrange-menu";

export { NO_NATIVE_TITLE };

export interface WindowMenuPoll {
  id: PollId;
  name: string;
  /** "minimized", "own window", "closed", or null for a sub-window in the workspace. */
  marker: string | null;
}

export interface WindowMenuInput {
  gridMode?: boolean;
  /** Non-minimized sub-windows. */
  visibleCount: number;
  minimizedCount: number;
  maximizedCount: number;
  /** Sub-windows in the workspace (visible or minimized): Next and Previous need two. */
  workspaceCount: number;
  tileMode: boolean;
  compact: boolean;
  nativeCount: number;
  polls: readonly WindowMenuPoll[];
  activeId: PollId | null;
  /** The displays and the chosen "Arrange on:" target of the Popped-out windows submenu. */
  monitors: readonly MonitorInfo[];
  arrangeTarget: ArrangeTarget;
  onTile(): void;
  onResetGrid?(): void;
  onTileMode(on: boolean): void;
  onCascade(): void;
  onArrangeMinimized(): void;
  onMinimizeAll(): void;
  onRestoreAll(): void;
  onCompact(on: boolean): void;
  onShowNatives(): void;
  onArrange(layout: ArrangeLayout): void;
  onArrangeTarget(target: ArrangeTarget): void;
  /** The submenu opened: read the displays again. */
  onArrangeOpen(): void;
  onNext(): void;
  onPrevious(): void;
  onShowPoll(id: PollId): void;
}

/** The entries of M1 in the order of DES-002 2.7. */
export function windowMenuEntries(input: WindowMenuInput): MenuEntry[] {
  const anyVisible = input.visibleCount > 0;
  const noNative = input.nativeCount === 0;
  return [
    ...(input.gridMode
      ? [
          {
            kind: "item" as const,
            id: "reset-grid",
            label: "Reset grid layout",
            shortcut: "Ctrl+Shift+T",
            disabled: !anyVisible,
            onSelect: input.onResetGrid ?? input.onTile,
          },
        ]
      : ([
          {
            kind: "item",
            id: "tile",
            label: "Tile",
            shortcut: "Ctrl+Shift+T",
            disabled: !anyVisible,
            onSelect: input.onTile,
          },
          {
            kind: "check",
            id: "tile-mode",
            label: "Tile mode",
            checked: input.tileMode,
            onSelect: () => input.onTileMode(!input.tileMode),
          },
          {
            kind: "item",
            id: "cascade",
            label: "Cascade",
            shortcut: "Ctrl+Shift+C",
            disabled: !anyVisible,
            onSelect: input.onCascade,
          },
        ] as MenuEntry[])),
    {
      kind: "item",
      id: "arrange-minimized",
      label: "Arrange minimized",
      disabled: input.minimizedCount === 0,
      onSelect: input.onArrangeMinimized,
    },
    {
      kind: "item",
      id: "minimize-all",
      label: "Minimize all",
      disabled: !anyVisible,
      onSelect: input.onMinimizeAll,
    },
    {
      kind: "item",
      id: "restore-all",
      label: "Restore all",
      disabled: input.minimizedCount + input.maximizedCount === 0,
      onSelect: input.onRestoreAll,
    },
    { kind: "separator", id: "sep-compact" },
    {
      kind: "check",
      id: "compact",
      label: "Collapse setup panels",
      shortcut: "Ctrl+Shift+\\",
      checked: input.compact,
      onSelect: () => input.onCompact(!input.compact),
    },
    { kind: "separator", id: "sep-native" },
    {
      kind: "submenu",
      id: "popped-out",
      label: "Popped-out windows",
      disabled: noNative,
      ...(noNative ? { title: NO_NATIVE_TITLE } : {}),
      onOpen: input.onArrangeOpen,
      // Tile here arranges the native windows; the Tile of this menu is the workspace's.
      entries: arrangeMenuEntries({
        monitors: input.monitors,
        target: input.arrangeTarget,
        onArrange: input.onArrange,
        onTarget: input.onArrangeTarget,
      }),
    },
    {
      kind: "item",
      id: "bring-natives",
      label: "Bring popped-out windows to front",
      shortcut: "Ctrl+Shift+A",
      disabled: noNative,
      ...(noNative ? { title: NO_NATIVE_TITLE } : {}),
      onSelect: input.onShowNatives,
    },
    { kind: "separator", id: "sep-cycle" },
    {
      kind: "item",
      id: "next",
      label: "Next sub-window",
      shortcut: "Ctrl+F6",
      disabled: input.visibleCount < 2,
      onSelect: input.onNext,
    },
    {
      kind: "item",
      id: "previous",
      label: "Previous sub-window",
      shortcut: "Ctrl+Shift+F6",
      disabled: input.visibleCount < 2,
      onSelect: input.onPrevious,
    },
    ...(input.polls.length > 0 ? [{ kind: "separator", id: "sep-polls" } as const] : []),
    ...input.polls.map(
      (p, i): MenuEntry => ({
        kind: "check",
        id: `poll-${p.id}`,
        label: `${i + 1} ${p.name}${p.marker ? ` (${p.marker})` : ""}`,
        checked: input.activeId === p.id,
        onSelect: () => input.onShowPoll(p.id),
      }),
    ),
  ];
}
