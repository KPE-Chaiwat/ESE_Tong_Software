import { useEffect } from "react";
import { VALUE_FORMATS } from "../../lib/format";
import { isBitFunction } from "../../lib/functions";
import { type Binding, createShortcutHandler } from "../../lib/shortcuts";
import { isLinkUp } from "../../store/session.logic";
import { useRuntime } from "../context";

/** Window-scoped shortcuts of DES-001 5.1. They are off while a modal is open. */
export function useShortcuts(): void {
  const runtime = useRuntime();

  useEffect(() => {
    const { controller, stores } = runtime;
    const { session, config, layout, dialogs, traffic, pollData } = stores;
    const linkUp = () => isLinkUp(session.getState().state);
    const registerPoll = () =>
      !isBitFunction((pollData.getState().definition ?? config.getState().poll).function);

    const bindings: Binding[] = [
      { combo: "ctrl+l", run: () => void controller.toggleConnection() },
      {
        combo: "ctrl+p",
        run: () => void controller.togglePoll(),
        when: linkUp,
      },
      { combo: "ctrl+e", run: () => controller.openWrite(), when: linkUp },
      { combo: "ctrl+n", run: () => void controller.newWindow() },
      { combo: "ctrl+o", run: () => dialogs.getState().showOpenProfile() },
      { combo: "ctrl+s", run: () => void controller.saveProfile() },
      { combo: "ctrl+shift+s", run: () => void controller.openSaveAs() },
      ...VALUE_FORMATS.map(
        (format, i): Binding => ({
          combo: `ctrl+${i + 1}`,
          run: () => config.getState().setFormat(format),
          when: registerPoll,
        }),
      ),
      { combo: "ctrl+b", run: () => config.getState().toggleBase() },
      { combo: "ctrl+\\", run: () => layout.getState().toggleSetup() },
      { combo: "ctrl+j", run: () => layout.getState().toggleTraffic() },
      { combo: "ctrl+shift+k", run: () => traffic.getState().clear() },
    ];

    const handler = createShortcutHandler(bindings, () => layout.getState().modalOpen);
    const onKeyDown = (e: KeyboardEvent) => {
      handler.handle(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runtime]);
}
