import { useEffect, useMemo } from "react";
import { useAltGuard } from "@/shared/lib/alt-guard";
import { Toaster } from "@/shared/ui/toaster";
import { pollSummary } from "../lib/poll-summary";
import { connectionTitle } from "../lib/titles";
import {
  clampTrafficHeight,
  defaultTrafficHeight,
  TRAFFIC_MIN_HEIGHT,
} from "../store/workspace.logic";
import { useConnection, usePollList, useProfileInfo, useRuntime, useWorkspace } from "./context";
import { ConfirmHost } from "./dialogs/ConfirmHost";
import { OpenProfileDialog } from "./dialogs/OpenProfileDialog";
import { PollDialogs } from "./dialogs/PollDialogs";
import { SaveAsDialog } from "./dialogs/SaveAsDialog";
import { ConnectionBanner } from "./shell/ConnectionBanner";
import { LiveRegions } from "./shell/LiveRegions";
import { MigrationNotice } from "./shell/MigrationNotice";
import { ResizeSeparator } from "./shell/ResizeSeparator";
import { StatusBar } from "./shell/StatusBar";
import { Toolbar } from "./shell/Toolbar";
import { useRegionCycle } from "./shell/use-regions";
import { useShortcuts } from "./shell/use-shortcuts";
import { ListDragLayer } from "./sidebar/ListDragLayer";
import { Sidebar } from "./sidebar/Sidebar";
import { TrafficBar } from "./traffic/TrafficBar";
import { TrafficPanel } from "./traffic/TrafficPanel";
import { Workspace } from "./workspace/Workspace";

/** Keeps the document and the native window title in sync (DES-002 2.12). */
function useWindowTitle() {
  const { windowIpc } = useRuntime();
  const state = useConnection((s) => s.state);
  const name = useProfileInfo((s) => s.name);
  const modified = useProfileInfo((s) => s.modified);
  const states = usePollList((s) =>
    s.order.map((id) => s.polls[id]?.status.state ?? "offline").join(","),
  );
  const summary = useMemo(
    () =>
      pollSummary(
        states === "" ? [] : states.split(",").map((state) => ({ state: state as never })),
      ),
    [states],
  );
  const title = connectionTitle(name, modified, state, states === "" ? null : summary.text);

  useEffect(() => {
    document.title = title;
    void windowIpc.setTitle(title).catch(() => {});
  }, [title, windowIpc]);
}

/** The collapsed bar, or the splitter and the expanded traffic panel (DES-002 2.2.5). */
function TrafficArea() {
  const runtime = useRuntime();
  const workspace = runtime.stores.workspace;
  const traffic = useWorkspace((s) => s.traffic);
  if (!traffic.expanded) return <TrafficBar />;
  const windowHeight = globalThis.window?.innerHeight ?? 800;
  const height = traffic.height ?? defaultTrafficHeight(windowHeight);
  return (
    <>
      <ResizeSeparator
        orientation="horizontal"
        label="Resize traffic panel"
        value={height}
        min={TRAFFIC_MIN_HEIGHT}
        max={clampTrafficHeight(Number.MAX_SAFE_INTEGER, windowHeight)}
        growsTowardsStart
        onResize={(px) => workspace.getState().setTrafficHeight(px)}
        onCommit={() => void workspace.getState().flush()}
        onReset={() => {
          workspace.getState().setTrafficHeight(null);
          void workspace.getState().flush();
        }}
      />
      <div style={{ height }} className="shrink-0 overflow-hidden">
        <TrafficPanel />
      </div>
    </>
  );
}

/**
 * The connection window W1 (DES-002 2.2): toolbar and menus, the connection banner, the sidebar
 * (CONNECTION section and POLLS list), the workspace with its sub-windows, the traffic bar or panel
 * and the status bar. One runtime per window.
 */
export function ConnectionWindow() {
  const runtime = useRuntime();
  const state = useConnection((s) => s.state);
  useShortcuts();
  useAltGuard();
  useRegionCycle();
  useWindowTitle();

  return (
    <div
      data-connection-state={state}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
    >
      <Toolbar />
      <ConnectionBanner />
      <MigrationNotice />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <Workspace />
      </div>
      <TrafficArea />
      <StatusBar />
      <PollDialogs />
      <OpenProfileDialog />
      <SaveAsDialog />
      <ConfirmHost />
      <Toaster store={runtime.stores.toasts} />
      <LiveRegions />
      <ListDragLayer />
    </div>
  );
}
