// The pointer part of a sub-window drag (DES-002 2.10): press, 4 px threshold, move, release, Esc
// and a lost capture. It translates DOM events into calls of the drag store and does nothing else:
// every rule (snapping, zones, swap) is in the store and the pure drag math.
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Edges, exceedsDragThreshold, type Point } from "../../lib/drag-math";
import type { ConnectionRuntime } from "../../runtime/connection-runtime";

interface GestureInput {
  event: ReactPointerEvent<HTMLElement>;
  runtime: ConnectionRuntime;
  pollId: PollId;
  kind: "move" | "resize";
  edges?: Edges;
}

/** Starts tracking a pointer press on a title bar or a resize handle. */
export function startPointerGesture({ event, runtime, pollId, kind, edges }: GestureInput): void {
  if (event.button !== 0 || event.isPrimary === false) return;
  const el = event.currentTarget;
  // React events bubble through portals: a press inside a menu rendered by the title bar is not a
  // press on the grip.
  if (!(event.target instanceof Node) || !el.contains(event.target)) return;
  const workspaceEl = el.closest<HTMLElement>("[data-workspace]");
  if (!workspaceEl) return;
  const { drag, workspace } = runtime.stores;

  // The only layout read of a drag: the workspace origin, once, at the press.
  const origin = workspaceEl.getBoundingClientRect();
  const toWorkspace = (clientX: number, clientY: number): Point => ({
    x: clientX - origin.left,
    y: clientY - origin.top,
  });
  const start = toWorkspace(event.clientX, event.clientY);
  const pointerId = event.pointerId;

  // Pressing raises and activates the sub-window at once, before the drag threshold.
  workspace.getState().activate(pollId);
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    // The pointer is already gone (a synthetic event): the listeners below still work.
  }

  let began = false;
  let last: Point = start;
  let lastMods = { alt: event.altKey, ctrl: event.ctrlKey };

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    stopWatching();
    // The listeners are on the document: when the frame is removed during the drag, its events
    // (and its lostpointercapture) go to the document, not to the removed element (REV-006 m-2).
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
    const p = toWorkspace(ev.clientX, ev.clientY);
    lastMods = { alt: ev.altKey, ctrl: ev.ctrlKey };
    if (!began) {
      if (!exceedsDragThreshold(start, p)) return;
      began = drag.getState().begin(kind, pollId, start, {
        ...(edges ? { edges } : {}),
        modifiers: lastMods,
      });
      if (!began) {
        cleanup();
        return;
      }
    }
    last = p;
    drag.getState().update(p, lastMods);
  }

  function onUp(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    cleanup();
    // The frame went away during the drag: there is nothing to drop.
    if (!el.isConnected) {
      if (began) drag.getState().abort(pollId);
      return;
    }
    if (began) drag.getState().end();
    // A click raised the window: the new z-order is reported.
    else void workspace.getState().flush();
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
      return;
    }
    if (ev.key === "Alt" || ev.key === "Control") {
      // Alt alone must not open the system menu after the drag (DES-002 R7).
      if (ev.key === "Alt") ev.preventDefault();
      lastMods = { alt: ev.altKey, ctrl: ev.ctrlKey };
      if (began) drag.getState().update(last, lastMods);
    }
  }

  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("pointercancel", onAbort, true);
  document.addEventListener("lostpointercapture", onAbort, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
}
