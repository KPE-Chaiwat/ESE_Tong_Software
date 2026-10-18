import { useEffect } from "react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Binding, createShortcutHandler } from "../../lib/shortcuts";
import { pollViewBindings } from "../../runtime/poll-view-shortcuts";
import { useRuntime } from "../context";
import { isTextEntry } from "../workspace/frame-keys";

/** The poll of the sub-window that has the keyboard focus, or null when the focus is elsewhere. */
export function focusedSubWindow(): PollId | null {
  const el = document.activeElement;
  const frame = el instanceof HTMLElement ? el.closest<HTMLElement>("[data-subwindow]") : null;
  const id = frame ? Number(frame.dataset.subwindow) : Number.NaN;
  return Number.isFinite(id) ? id : null;
}

/**
 * The poll the "scope SW" keys act on (DES-002 3.1): the sub-window with the focus, or the active
 * one when the focus is on the workspace background, which forwards to it. Null elsewhere.
 */
export function scopedSubWindow(activeId: PollId | null): PollId | null {
  const inside = focusedSubWindow();
  if (inside !== null) return inside;
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches('[data-region="workspace"]') ? activeId : null;
}

/**
 * Window-scoped shortcuts of the connection window: the "W1 outside sub-windows" and the "scope SW"
 * columns of DES-002 3.1. They are registered on this window only and are off while a modal is
 * open; the browser defaults that clash with them are suppressed (`SUPPRESSED_DEFAULTS`).
 */
export function useShortcuts(): void {
  const runtime = useRuntime();

  useEffect(() => {
    const { actions, stores } = runtime;
    const { workspace, host, prefs, pollList, layout } = stores;
    /** The poll a poll key acts on: the focused sub-window, else the selected sidebar row. */
    const target = (): PollId | null => focusedSubWindow() ?? pollList.getState().selectedId;
    const scope = () => scopedSubWindow(workspace.getState().activeId);
    const setupKey = () => {
      const id = focusedSubWindow();
      if (id !== null) runtime.views.peek(id)?.stores.ui.getState().toggleSetup();
      else actions.toggleSidebar();
    };
    const compact = () => void prefs.getState().toggleCompact();

    const bindings: Binding[] = [
      { combo: "ctrl+l", run: () => void actions.toggleConnection() },
      { combo: "ctrl+n", run: () => void actions.newWindow() },
      { combo: "ctrl+o", run: () => actions.openProfile() },
      { combo: "ctrl+s", run: () => void actions.saveProfile() },
      { combo: "ctrl+shift+s", run: () => void actions.saveProfileAs() },
      { combo: "ctrl+shift+n", run: () => void actions.newPoll() },
      {
        combo: "ctrl+p",
        run: () => {
          const id = target();
          if (id !== null) void actions.togglePoll(id);
        },
      },
      { combo: "ctrl+shift+p", run: () => void actions.togglePauseAll() },
      { combo: "ctrl+j", run: () => actions.toggleTraffic() },
      { combo: "ctrl+shift+k", run: () => actions.clearTraffic() },
      { combo: "ctrl+shift+t", run: () => workspace.getState().tile() },
      { combo: "ctrl+shift+c", run: () => workspace.getState().cascade() },
      { combo: "ctrl+f6", run: () => workspace.getState().cycle(1) },
      { combo: "ctrl+shift+f6", run: () => workspace.getState().cycle(-1) },
      {
        // Only in the scope of a sub-window (DES-002 3.1: not in the rest of W1).
        combo: "ctrl+f4",
        when: () => scope() !== null,
        run: () => {
          const id = scope();
          if (id !== null) host.getState().requestClose(id);
        },
      },
      { combo: "ctrl+\\", run: setupKey },
      // The pipe is what Ctrl+Shift+\ types on a US keyboard.
      { combo: "ctrl+shift+\\", run: compact },
      { combo: "ctrl+shift+|", run: compact },
      { combo: "ctrl+shift+a", run: () => void actions.showPollWindows() },
      {
        // Pop out the poll of the focused sub-window, else the selected sidebar row (DES-002 3.1).
        combo: "ctrl+shift+o",
        run: () => {
          const id = target();
          if (id !== null) void actions.popOutPoll(id, "shortcut");
        },
      },
      // The view keys act on the sub-window in scope: formats, address base, Show, Write.
      ...pollViewBindings(
        () => {
          const id = scope();
          return id === null ? undefined : runtime.views.peek(id);
        },
        () => isTextEntry(document.activeElement),
      ),
    ];

    const handler = createShortcutHandler(bindings, () => layout.getState().modalOpen);
    const onKeyDown = (e: KeyboardEvent) => {
      handler.handle(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runtime]);
}
