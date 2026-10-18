/**
 * Keeps the keyboard focus through a change of the setup presentation (REV-008 m-3). The setup
 * moves between the dock, the panel and the popover when the width crosses 640 px; these are
 * different DOM nodes, so React re-creates the fields and the browser drops the focus. The view
 * captures the focused control just before its container is removed and puts the focus back on the
 * equivalent control of the new container: same field, same caret or selection. The typed text is
 * not touched here, it lives in the draft of the poll view's UI store.
 */

/** Marks the content of the setup (the POLL and SCALE sections), identical in every presentation. */
export const SETUP_CONTENT_ANCHOR = "content";
/** The button that hides the setup panel (the equivalent of the rail). */
export const SETUP_HIDE_ANCHOR = "hide";

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SetupFocusSnapshot {
  /**
   * - `field`: a control of the setup content.
   * - `toggle`: the rail button or the panel's hide button (they are one control in two shapes).
   * - `other`: something else in the container (the Done button of the popover).
   */
  kind: "field" | "toggle" | "other";
  /** The stable part of the control's id (the id without its per-instance prefix), or null. */
  key: string | null;
  /** The position among the focusable controls of the content; the fallback when there is no key. */
  index: number;
  /** The caret or selection of a text control. */
  selection: { start: number; end: number; direction: "forward" | "backward" | "none" } | null;
}

/**
 * The id of a control without the `useId` prefix of the component instance that rendered it
 * (`_r_3_-quantity` -> `quantity`): the instance, and so the prefix, changes on a remount while the
 * rest does not.
 */
export function stableKey(el: Element): string | null {
  const dash = el.id.indexOf("-");
  return el.id !== "" && dash > 0 && dash < el.id.length - 1 ? el.id.slice(dash + 1) : null;
}

function focusables(content: Element): HTMLElement[] {
  return Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE));
}

function selectionOf(el: HTMLElement): SetupFocusSnapshot["selection"] {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  try {
    const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = el;
    if (start === null || end === null) return null;
    return { start, end, direction: direction ?? "none" };
  } catch {
    // Some input types have no selection.
    return null;
  }
}

/** The control with the focus inside a setup container, or null when the focus is not in it. */
export function captureSetupFocus(container: HTMLElement): SetupFocusSnapshot | null {
  const active = container.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || active === container || !container.contains(active)) {
    return null;
  }
  const content = container.querySelector(`[data-focus-anchor="${SETUP_CONTENT_ANCHOR}"]`);
  if (content?.contains(active)) {
    return {
      kind: "field",
      key: stableKey(active),
      index: focusables(content).indexOf(active),
      selection: selectionOf(active),
    };
  }
  const kind = active.dataset.focusAnchor === SETUP_HIDE_ANCHOR ? "toggle" : "other";
  return { kind, key: null, index: -1, selection: null };
}

/** The rail button had the focus. */
export const TOGGLE_FOCUS: SetupFocusSnapshot = {
  kind: "toggle",
  key: null,
  index: -1,
  selection: null,
};

/**
 * Puts the focus back in a new setup container. `toggle` is the rail button when it exists. Returns
 * the control that now has the focus, or null when there was nothing to focus.
 */
export function restoreSetupFocus(
  container: HTMLElement,
  snapshot: SetupFocusSnapshot,
  toggle: HTMLElement | null,
): HTMLElement | null {
  const content = container.querySelector(`[data-focus-anchor="${SETUP_CONTENT_ANCHOR}"]`);
  const list = content ? focusables(content) : [];
  let target: HTMLElement | null = null;
  if (snapshot.kind === "toggle") {
    target =
      toggle ?? container.querySelector<HTMLElement>(`[data-focus-anchor="${SETUP_HIDE_ANCHOR}"]`);
  } else if (snapshot.kind === "field") {
    target =
      (snapshot.key === null ? null : list.find((el) => stableKey(el) === snapshot.key)) ??
      list[snapshot.index] ??
      null;
  }
  // No equivalent control (the Done button of the popover, a field that is gone): the first field.
  target ??= list[0] ?? null;
  if (!target) return null;
  target.focus();
  const sel = snapshot.kind === "field" ? snapshot.selection : null;
  if (sel && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    try {
      target.setSelectionRange(sel.start, sel.end, sel.direction);
    } catch {
      // The control has no selection.
    }
  }
  return target;
}
