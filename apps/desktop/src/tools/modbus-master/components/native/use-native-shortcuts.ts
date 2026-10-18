import { useEffect } from "react";
import { type Binding, createShortcutHandler } from "../../lib/shortcuts";
import { pollViewBindings } from "../../runtime/poll-view-shortcuts";
import { isTextEntry } from "../workspace/frame-keys";
import { useNativeRuntime } from "./context";

/**
 * Window-scoped shortcuts of a native poll window: the W2 column of DES-002 3.1. They are
 * registered on this window only and are off while a dialog is open. `Ctrl+L` only connects or
 * reconnects (there is no Disconnect here). The keys of the connection window (Open, traffic,
 * Cascade, close, pop out) do nothing, and their browser defaults stay suppressed.
 */
export function useNativeShortcuts(): void {
  const runtime = useNativeRuntime();

  useEffect(() => {
    const { actions, stores, view } = runtime;
    const compact = () => void actions.toggleCompact();
    const bindings: Binding[] = [
      { combo: "ctrl+l", run: () => void actions.connectOrReconnect() },
      { combo: "ctrl+p", run: () => void actions.toggleActive() },
      { combo: "ctrl+n", run: () => void actions.newWindow() },
      { combo: "ctrl+s", run: () => void actions.requestSave(false) },
      { combo: "ctrl+shift+s", run: () => void actions.requestSave(true) },
      { combo: "ctrl+shift+n", run: () => void actions.newPoll() },
      { combo: "ctrl+shift+d", run: () => void actions.dock("shortcut") },
      { combo: "ctrl+shift+m", run: () => void actions.focusConnectionWindow() },
      { combo: "ctrl+shift+t", run: () => void actions.arrange("tile") },
      { combo: "ctrl+shift+a", run: () => void runtime.ipc.showPollWindows().catch(() => {}) },
      { combo: "ctrl+\\", run: () => view.stores.ui.getState().toggleSetup() },
      // The pipe is what Ctrl+Shift+\ types on a US keyboard.
      { combo: "ctrl+shift+\\", run: compact },
      { combo: "ctrl+shift+|", run: compact },
      ...pollViewBindings(
        () => view,
        () => isTextEntry(document.activeElement),
      ),
    ];
    const handler = createShortcutHandler(bindings, () => stores.layout.getState().modalOpen);
    const onKeyDown = (e: KeyboardEvent) => {
      handler.handle(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runtime]);
}
