import { useEffect } from "react";
import { Toaster } from "@/shared/ui/toaster";
import { windowTitle } from "../lib/title";
import { isDirty } from "../store/config.logic";
import { pillFor } from "../store/session.logic";
import { useConfig, useLayout, useRuntime, useSession } from "./context";
import { DataCard } from "./data/DataCard";
import { ConfirmHost } from "./dialogs/ConfirmHost";
import { OpenProfileDialog } from "./dialogs/OpenProfileDialog";
import { SaveAsDialog } from "./dialogs/SaveAsDialog";
import { WriteDialog } from "./dialogs/WriteDialog";
import { SetupPanel } from "./setup/SetupPanel";
import { LiveRegions } from "./shell/LiveRegions";
import { SessionBanner } from "./shell/SessionBanner";
import { Splitter } from "./shell/Splitter";
import { StatusBar } from "./shell/StatusBar";
import { Toolbar } from "./shell/Toolbar";
import { useShortcuts } from "./shell/use-shortcuts";
import { TRAFFIC_HEADER_HEIGHT, TrafficPanel } from "./traffic/TrafficPanel";

/** Keeps the document and the native window title in sync (DES-001 2.3). */
function useWindowTitle() {
  const runtime = useRuntime();
  const state = useSession((s) => s.state);
  const exceptionCode = useSession((s) => s.exceptionCode);
  const name = useConfig((s) => s.profileName);
  const modified = useConfig((s) => isDirty(s));
  const title = windowTitle(name, modified, pillFor(state, exceptionCode).label);

  useEffect(() => {
    document.title = title;
    void runtime.windowIpc.setTitle(title).catch(() => {});
  }, [title, runtime]);
}

/** Closing the window with unsaved changes asks first (DES-001 S5). */
function useCloseRequest() {
  const { controller, windowIpc } = useRuntime();
  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void windowIpc
      .onCloseRequested(() => controller.requestClose())
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else off = unsubscribe;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      off?.();
    };
  }, [controller, windowIpc]);
}

/** The Modbus Master window (DES-001 S1). One runtime per window. */
export function ModbusMasterWindow() {
  const runtime = useRuntime();
  const layout = runtime.stores.layout;
  const collapsed = useLayout((s) => s.trafficCollapsed);
  const pct = useLayout((s) => s.trafficHeightPct);
  const sessionState = useSession((s) => s.state);
  useShortcuts();
  useWindowTitle();
  useCloseRequest();

  // The 120px minimum of the traffic panel depends on the window height.
  useEffect(() => {
    const update = () => layout.getState().setViewportHeight(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [layout]);

  return (
    <div
      data-session-state={sessionState}
      className="flex min-h-0 flex-1 flex-col bg-background text-foreground"
    >
      <Toolbar />
      <SessionBanner />
      <main className="flex min-h-0 flex-1 flex-col gap-1 px-3 pb-2">
        <div className="flex min-h-0 flex-1 gap-3">
          <SetupPanel />
          <DataCard />
        </div>
        {collapsed ? null : <Splitter />}
        <div
          className="shrink-0 overflow-hidden rounded-lg"
          style={{ height: collapsed ? TRAFFIC_HEADER_HEIGHT : `${pct}vh` }}
        >
          <TrafficPanel />
        </div>
      </main>
      <StatusBar />
      <WriteDialog />
      <OpenProfileDialog />
      <SaveAsDialog />
      <ConfirmHost />
      <Toaster store={runtime.stores.toasts} />
      <LiveRegions />
    </div>
  );
}
