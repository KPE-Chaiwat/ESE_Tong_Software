// Gives the keyboard focus back after a pop out or a dock failed (DES-002 2.5.2 step 5, 2.5.3 step
// 4, 9; REPORT-007 D9, CHK2-F16 "focus kept"). The command buttons keep the focus while they are
// busy (`aria-disabled`, not `disabled`), but a failed pop out gives the sub-window a new view and
// the grid goes with the old one, and a menu or a shortcut leaves the focus somewhere else.
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type FocusTarget, fallbackFocusTarget } from "../store/poll-host.logic";

/** The element that has the focus, or null when it is the page body. */
export function focusedElementOrNull(doc: Document = document): HTMLElement | null {
  const el = doc.activeElement;
  return el instanceof HTMLElement && el !== doc.body ? el : null;
}

export interface FocusAfterFailure {
  target: FocusTarget;
  host: "workspace" | "native";
  pollId: PollId;
  /** The element that had the focus when the command started (for `previous`). */
  previous: HTMLElement | null;
  /** The grid of this sub-window had the focus and its view is being replaced: ask for it later. */
  requestGridFocus: () => void;
  doc?: Document;
}

function find(target: FocusTarget, o: FocusAfterFailure, scope: ParentNode): HTMLElement | null {
  const doc = o.doc ?? document;
  switch (target) {
    case "button":
      return scope.querySelector<HTMLElement>('[data-focus-target="command"]');
    case "previous":
      return o.previous?.isConnected ? o.previous : null;
    case "menuButton":
      return scope.querySelector<HTMLElement>('button[aria-label="Poll actions"]');
    case "sidebarRow":
      return doc.querySelector<HTMLElement>(
        `[data-region="sidebar"] [data-slot="poll-row"][data-poll-id="${o.pollId}"]`,
      );
    case "titleBar":
      return scope.querySelector<HTMLElement>('[data-slot="title-bar"]');
    case "pollName":
      return doc.querySelector<HTMLElement>('[data-region="toolbar"] button:not([disabled])');
  }
}

/**
 * Focuses the target when the focus is free (nowhere, or inside this poll's window); a control the
 * user went to meanwhile keeps it. Falls back to the title bar (sub-window) or the toolbar (native
 * window) when the target is gone. A grid that was replaced is asked for through `requestGridFocus`,
 * which waits for the new view to attach.
 */
export function restoreFocusAfterFailure(o: FocusAfterFailure): void {
  const doc = o.doc ?? document;
  const scope: ParentNode =
    o.host === "workspace"
      ? (doc.querySelector(`[data-subwindow="${o.pollId}"]`) ?? doc)
      : (doc.querySelector("[data-native-window]") ?? doc);
  const active = doc.activeElement;
  const free =
    !(active instanceof HTMLElement) ||
    active === doc.body ||
    !active.isConnected ||
    active === o.previous ||
    (scope instanceof Element && scope.contains(active));
  if (!free) return;

  if (o.target === "previous" && o.previous?.matches('[role="grid"]')) {
    // A grid that is still there takes the focus; the view of a sub-window is replaced after a
    // failed pop out, so the new grid is asked for as well and takes it once it exists.
    if (o.previous.isConnected) o.previous.focus();
    o.requestGridFocus();
    return;
  }
  const el = find(o.target, o, scope) ?? find(fallbackFocusTarget(o.host), o, scope);
  el?.focus();
}
