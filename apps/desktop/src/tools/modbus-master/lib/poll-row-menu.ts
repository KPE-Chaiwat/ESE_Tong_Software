// The context menu of a sidebar poll row (DES-002 2.2.3, 2.10.8). Pure: the state in, the entries out.
import type { MenuEntry } from "@/shared/ui/menu";
import { MAX_POLLS_MESSAGE } from "./poll-names";
import type { PollHostState } from "./status-line";

export interface PollRowMenuInput {
  hostState: PollHostState;
  /** The poll's last host kind is the native window (a closed poll reopens there). */
  lastHostNative: boolean;
  running: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** 16 polls: Duplicate is not possible. */
  atLimit: boolean;
  onShow(): void;
  onShowInWorkspace(): void;
  onPopOut(): void;
  onDock(): void;
  onToggle(): void;
  onRename(): void;
  onDuplicate(): void;
  onMoveUp(): void;
  onMoveDown(): void;
  onShowTraffic(): void;
  onDelete(): void;
}

/**
 * Show · (Show in workspace) · Pop out to own window or Dock to workspace · Pause or Resume ·
 * Rename · Duplicate · Move up · Move down · Show traffic for this poll · Delete….
 * "Show in workspace" is for a closed poll whose last host was the native window: Show reopens it
 * there, this entry reopens it in the workspace (H12). A closed poll has no view to pop out.
 */
export function pollRowMenuEntries(input: PollRowMenuInput): MenuEntry[] {
  const native = input.hostState === "native";
  const inWorkspace =
    input.hostState === "workspace.normal" ||
    input.hostState === "workspace.minimized" ||
    input.hostState === "workspace.maximized";
  const closedNative = input.hostState === "closed" && input.lastHostNative;
  return [
    { kind: "item", id: "show", label: "Show", onSelect: input.onShow },
    ...(closedNative
      ? [
          {
            kind: "item",
            id: "show-workspace",
            label: "Show in workspace",
            onSelect: input.onShowInWorkspace,
          } satisfies MenuEntry,
        ]
      : []),
    ...(inWorkspace
      ? [
          {
            kind: "item",
            id: "pop-out",
            label: "Pop out to own window",
            shortcut: "Ctrl+Shift+O",
            onSelect: input.onPopOut,
          } satisfies MenuEntry,
        ]
      : []),
    ...(native
      ? [
          {
            kind: "item",
            id: "dock",
            label: "Dock to workspace",
            onSelect: input.onDock,
          } satisfies MenuEntry,
        ]
      : []),
    {
      kind: "item",
      id: "toggle",
      label: input.running ? "Pause" : "Resume",
      shortcut: "Ctrl+P",
      onSelect: input.onToggle,
    },
    { kind: "item", id: "rename", label: "Rename", shortcut: "F2", onSelect: input.onRename },
    {
      kind: "item",
      id: "duplicate",
      label: "Duplicate",
      disabled: input.atLimit,
      ...(input.atLimit ? { title: MAX_POLLS_MESSAGE } : {}),
      onSelect: input.onDuplicate,
    },
    {
      kind: "item",
      id: "move-up",
      label: "Move up",
      shortcut: "Alt+Up",
      disabled: input.isFirst,
      onSelect: input.onMoveUp,
    },
    {
      kind: "item",
      id: "move-down",
      label: "Move down",
      shortcut: "Alt+Down",
      disabled: input.isLast,
      onSelect: input.onMoveDown,
    },
    {
      kind: "item",
      id: "traffic",
      label: "Show traffic for this poll",
      onSelect: input.onShowTraffic,
    },
    { kind: "separator", id: "sep" },
    { kind: "item", id: "delete", label: "Delete…", shortcut: "Delete", onSelect: input.onDelete },
  ];
}
