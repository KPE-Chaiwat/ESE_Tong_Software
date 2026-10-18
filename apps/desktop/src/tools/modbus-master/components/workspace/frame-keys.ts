// The keys that move, resize and swap the active sub-window (DES-002 2.10.8). Pure.
import type { Direction } from "../../lib/drag-math";

export type FrameKeyAction =
  | { kind: "move"; dir: Direction; fine: boolean }
  | { kind: "size"; dir: Direction; fine: boolean }
  | { kind: "swap"; dir: Direction };

export interface FrameKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey?: boolean;
}

const DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/**
 * `Alt+Arrow` moves (16 px, `Shift` 1 px), `Ctrl+Alt+Arrow` resizes (right and bottom edges),
 * `Ctrl+Shift+Arrow` swaps with the neighbor in that direction. Anything else is not ours.
 */
export function frameKeyAction(e: FrameKeyEvent): FrameKeyAction | null {
  const dir = DIRECTIONS[e.key];
  if (!dir || e.metaKey) return null;
  if (e.altKey && e.ctrlKey) return { kind: "size", dir, fine: e.shiftKey };
  if (e.altKey && !e.ctrlKey) return { kind: "move", dir, fine: e.shiftKey };
  if (e.ctrlKey && e.shiftKey) return { kind: "swap", dir };
  return null;
}

/** Text fields keep their own keys: the window keys never act while one has the focus. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true
  );
}
