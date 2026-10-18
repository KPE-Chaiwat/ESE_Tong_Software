// The pointer part of dragging a sidebar poll row (DES-002 2.10.6, 2.10.7): press, the 4 px
// threshold, move, release, Esc and a lost capture. Like `pointer-gesture.ts` for sub-windows it
// translates DOM events into calls of the drag store and measures what the store needs (the rows,
// the list and the workspace, in client coordinates). Every rule is in the store and the pure drag
// math. Auto-scroll of the list near its top and bottom edge runs here, one step per animation frame.
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import type { Rect } from "@/shared/lib/layout-math";
import { autoScrollDelta, exceedsDragThreshold, type Point } from "../../lib/drag-math";
import type { ConnectionRuntime } from "../../runtime/connection-runtime";
import type { ListDragUpdate } from "../../store/drag.store";

type FrameScheduler = (callback: () => void) => () => void;

const animationFrame: FrameScheduler = (callback) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
};

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export interface ListGestureInput {
  event: ReactPointerEvent<HTMLElement>;
  runtime: ConnectionRuntime;
  pollId: PollId;
  /** The scrolling list the rows are in. */
  listEl: HTMLElement;
  /** Runs the auto-scroll steps (tests run them by hand). */
  scheduleFrame?: FrameScheduler;
}

/** Starts tracking a pointer press on a poll row. A press on a button or a field is not a grip. */
export function startListGesture({
  event,
  runtime,
  pollId,
  listEl,
  scheduleFrame = animationFrame,
}: ListGestureInput): void {
  if (event.button !== 0 || event.isPrimary === false) return;
  const el = event.currentTarget;
  const target = event.target;
  // Events of a menu rendered through a portal bubble here too.
  if (!(target instanceof Element) || !el.contains(target)) return;
  if (target.closest("button, input, textarea, [role=menu]")) return;
  const { drag } = runtime.stores;

  const pointerId = event.pointerId;
  const start: Point = { x: event.clientX, y: event.clientY };
  let began = false;
  let last: Point = start;
  let mods = { alt: event.altKey, ctrl: event.ctrlKey };
  let stopFrame: (() => void) | null = null;

  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    // The pointer is already gone (a synthetic event): the listeners below still work.
  }

  const measure = (): ListDragUpdate => {
    const workspace = document.querySelector("[data-workspace]");
    return {
      pointer: last,
      rows: Array.from(listEl.querySelectorAll("[data-poll-id]")).map(rectOf),
      list: rectOf(listEl),
      workspace: workspace ? rectOf(workspace) : null,
      modifiers: mods,
    };
  };

  /** One auto-scroll step per animation frame while the pointer is near the list's top or bottom. */
  const tick = () => {
    stopFrame = null;
    if (!began) return;
    const delta = autoScrollDelta(last, rectOf(listEl));
    if (delta === 0) return;
    const before = listEl.scrollTop;
    listEl.scrollTop = before + delta;
    if (listEl.scrollTop !== before) drag.getState().updateList(measure());
    stopFrame = scheduleFrame(tick);
  };

  /** A click after a drag would show the poll: the first click event after the release is dropped. */
  const swallowClick = () => {
    const stop = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => el.removeEventListener("click", stop, true), 0);
  };

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    stopWatching();
    stopFrame?.();
    stopFrame = null;
    // The listeners are on the document: a row that is removed during the drag no longer gets its
    // events (REV-006 m-2).
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onAbort, true);
    document.removeEventListener("lostpointercapture", onAbort, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
    try {
      el.releasePointerCapture?.(pointerId);
    } catch {
      // Nothing to release.
    }
  };

  function onMove(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    last = { x: ev.clientX, y: ev.clientY };
    mods = { alt: ev.altKey, ctrl: ev.ctrlKey };
    if (!began) {
      if (!exceedsDragThreshold(start, last)) return;
      began = drag.getState().beginList(pollId);
      if (!began) {
        cleanup();
        return;
      }
    }
    drag.getState().updateList(measure());
    stopFrame ??= scheduleFrame(tick);
  }

  function onUp(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    cleanup();
    if (!began) return;
    if (!el.isConnected) {
      drag.getState().abort(pollId);
      return;
    }
    drag.getState().end();
    swallowClick();
  }

  function onAbort(ev?: Event) {
    if (ev && "pointerId" in ev && (ev as PointerEvent).pointerId !== pointerId) return;
    cleanup();
    if (began) drag.getState().cancel();
  }

  // A drag that the store dropped (the poll was removed) ends the gesture too.
  const stopWatching = drag.subscribe((s) => {
    if (began && s.kind === "none") cleanup();
  });

  function onKey(ev: KeyboardEvent) {
    if (ev.type === "keydown" && ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onAbort();
      // The button is still down: its release must not click the row (and show the poll).
      if (began) {
        window.addEventListener("pointerup", swallowClick, { once: true, capture: true });
        // The button may be released outside the window, where no pointerup arrives: do not wait.
        setTimeout(() => window.removeEventListener("pointerup", swallowClick, true), 1000);
      }
      return;
    }
    if (ev.key === "Alt" || ev.key === "Control") {
      // Alt alone must not open the system menu after the drag (DES-002 R7).
      if (ev.key === "Alt") ev.preventDefault();
      mods = { alt: ev.altKey, ctrl: ev.ctrlKey };
      if (began) drag.getState().updateList(measure());
    }
  }

  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("pointercancel", onAbort, true);
  document.addEventListener("lostpointercapture", onAbort, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
}
