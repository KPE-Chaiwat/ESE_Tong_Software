// The sub-window title bar menu (DES-002 2.3.1, 2.10.8). Pure: it turns the sub-window state into
// menu entries; the component supplies the callbacks.
import type { SubWindowState } from "@/shared/ipc/modbus-master.types";
import type { MenuEntry } from "@/shared/ui/menu";
import { type SnapZone, ZONE_LABELS } from "../../lib/drag-math";

export interface TitleBarMenuInput {
  state: SubWindowState;
  tileMode: boolean;
  snapEnabled: boolean;
  /** Tile mode: how many slots there are and which one this window has (0-based). */
  slotCount: number;
  slotIndex: number;
  /** Pop out is offered when the host provides it (FE-002 task 20). */
  canPopOut: boolean;
  onRestore(): void;
  onMove(): void;
  onSize(): void;
  onMinimize(): void;
  onMaximize(): void;
  onMoveToZone(zone: SnapZone): void;
  onMoveToSlot(index: number): void;
  onPopOut(): void;
  onToggleSnap(): void;
  onClose(): void;
}

export const MOVE_TO_ZONES: readonly SnapZone[] = [
  "left",
  "right",
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
  "full",
];

/** "Left half", "Top-left quarter", "Full workspace". */
export function zoneMenuLabel(zone: SnapZone): string {
  const text = ZONE_LABELS[zone];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The entries, in the order of DES-002 2.3.1. "Move to" is a submenu (DES-002 2.10.8). */
export function titleBarMenuEntries(input: TitleBarMenuInput): MenuEntry[] {
  const free = !input.tileMode;
  const normal = input.state === "normal";
  const entries: MenuEntry[] = [
    {
      kind: "item",
      id: "restore",
      label: "Restore",
      disabled: normal,
      onSelect: input.onRestore,
    },
    {
      kind: "item",
      id: "move",
      label: "Move",
      disabled: !normal || !free,
      ...(free ? {} : { title: "Not available in tile mode. Use Move to a slot." }),
      onSelect: input.onMove,
    },
    {
      kind: "item",
      id: "size",
      label: "Size",
      disabled: !normal || !free,
      ...(free ? {} : { title: "Not available in tile mode." }),
      onSelect: input.onSize,
    },
    { kind: "item", id: "minimize", label: "Minimize", onSelect: input.onMinimize },
    {
      kind: "item",
      id: "maximize",
      label: "Maximize",
      disabled: !normal,
      onSelect: input.onMaximize,
    },
    { kind: "separator", id: "sep-move" },
  ];

  // "Move to" is a submenu: the zones, or the slots in tile mode, then the own window.
  const moveTo: MenuEntry[] = [];
  if (free) {
    for (const zone of MOVE_TO_ZONES) {
      moveTo.push({
        kind: "item",
        id: `zone-${zone}`,
        label: zoneMenuLabel(zone),
        onSelect: () => input.onMoveToZone(zone),
      });
    }
  } else {
    for (let i = 0; i < input.slotCount; i += 1) {
      moveTo.push({
        kind: "item",
        id: `slot-${i}`,
        label: `Slot ${i + 1}`,
        disabled: i === input.slotIndex,
        onSelect: () => input.onMoveToSlot(i),
      });
    }
  }
  if (input.canPopOut) {
    moveTo.push(
      { kind: "separator", id: "sep-own-window" },
      {
        kind: "item",
        id: "own-window",
        label: "Own window (pop out)",
        shortcut: "Ctrl+Shift+O",
        onSelect: input.onPopOut,
      },
    );
  }
  entries.push({
    kind: "submenu",
    id: "move-to",
    label: free ? "Move to" : "Move to slot",
    entries: moveTo,
    disabled: moveTo.length === 0,
  });

  if (input.canPopOut) {
    entries.push({
      kind: "item",
      id: "pop-out",
      label: "Pop out to own window",
      shortcut: "Ctrl+Shift+O",
      onSelect: input.onPopOut,
    });
  }
  entries.push(
    { kind: "separator", id: "sep-snap" },
    {
      kind: "check",
      id: "snap",
      label: "Snap while moving",
      checked: input.snapEnabled,
      onSelect: input.onToggleSnap,
    },
    { kind: "separator", id: "sep-close" },
    { kind: "item", id: "close", label: "Close", shortcut: "Ctrl+F4", onSelect: input.onClose },
  );
  return entries;
}
