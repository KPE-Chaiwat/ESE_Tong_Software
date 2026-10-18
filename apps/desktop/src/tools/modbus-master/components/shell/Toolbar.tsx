import { useEffect, useMemo, useState } from "react";
import type { PollState } from "@/shared/ipc/modbus-master.types";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { MenuButton, type MenuEntry } from "@/shared/ui/menu";
import { StatusPill, type StatusVariant } from "@/shared/ui/status-pill";
import { MAX_POLLS, MAX_POLLS_MESSAGE } from "../../lib/poll-names";
import { pollSummary, type SummaryTone } from "../../lib/poll-summary";
import { SIDEBAR_ID, SIDEBAR_TOGGLE_ID } from "../../lib/sidebar";
import { hostMarker, hostStateOf } from "../../lib/status-line";
import { windowMenuEntries } from "../../lib/window-menu";
import {
  connectionActionsFor,
  connectionPillFor,
  connectionPillTarget,
} from "../../store/connection.logic";
import { selectAnyPaused, selectAnyRunning, selectNativeCount } from "../../store/poll-list.store";
import { visibleIds } from "../../store/workspace.logic";
import {
  useActions,
  useArrange,
  useConnection,
  usePollBulk,
  usePollList,
  usePrefs,
  useProfileInfo,
  useRuntime,
  useSidebarExpanded,
  useWorkspace,
} from "../context";
import { type ToolbarSqueeze, toolbarSqueezeFor } from "./toolbar.logic";

/** The window width, updated on resize. */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => globalThis.window?.innerWidth ?? 1280);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

const TONE_VARIANT: Record<SummaryTone, StatusVariant> = {
  error: "exception",
  warning: "timeout",
  success: "polling",
  outline: "paused",
};

const MENU_TRIGGER =
  "inline-flex h-8 shrink-0 whitespace-nowrap items-center gap-1 rounded-pill border border-input bg-card px-3.5 text-sm font-semibold outline-none hover:bg-neutral-tint focus-ring disabled:opacity-50";

/** The poll summary chip next to the connection pill (DES-002 1.5 rule 2). Only while connected. */
function SummaryChip({ squeeze }: { squeeze: ToolbarSqueeze }) {
  const states = usePollList((s) =>
    s.order.map((id) => s.polls[id]?.status.state ?? "offline").join(","),
  );
  const summary = useMemo(
    () =>
      pollSummary(
        states === "" ? [] : states.split(",").map((state) => ({ state: state as PollState })),
      ),
    [states],
  );
  const text = squeeze.shortChip ? summary.short : summary.text;
  return (
    <span data-testid="summary-chip" title={summary.text} className={squeeze.chip}>
      <StatusPill
        variant={TONE_VARIANT[summary.tone]}
        icon={summary.icon}
        label={text}
        fullLabel={summary.text}
        truncate
      />
    </span>
  );
}

/** The File, Connection and Window menus plus New poll (DES-002 2.2.1). */
export function Toolbar() {
  const runtime = useRuntime();
  const actions = useActions();
  const { workspace, pollList, prefs, arrange, connection: connStore, section } = runtime.stores;
  const width = useWindowWidth();
  const squeeze = toolbarSqueezeFor(width);
  const expanded = useSidebarExpanded();
  const sidebarLabel = expanded ? "Hide sidebar" : "Show sidebar";

  const state = useConnection((s) => s.state);
  const pending = useConnection((s) => s.pending);
  const ready = useConnection((s) => s.ready);
  const target = useConnection((s) => s.connection);
  const autoStart = useConnection((s) => s.autoStartPoll);
  const profileName = useProfileInfo((s) => s.name);
  const modified = useProfileInfo((s) => s.modified);
  const compact = usePrefs((s) => s.compact);
  const bulkLocked = usePollBulk((s) => s.phase !== "idle");
  const adding = usePollList((s) => s.adding);
  const count = usePollList((s) => s.order.length);
  const anyRunning = usePollList(selectAnyRunning);
  const anyPaused = usePollList(selectAnyPaused);
  const natives = usePollList(selectNativeCount);
  const monitors = useArrange((s) => s.monitors);
  const arrangeTarget = useArrange((s) => s.target);
  const tileMode = useWorkspace((s) => s.tileMode);
  const activeId = useWorkspace((s) => s.activeId);
  const items = useWorkspace((s) => s.items);
  // The entries of the Window menu follow the poll names and hosts.
  const listKey = usePollList((s) =>
    s.order
      .map((id) => {
        const p = s.polls[id];
        return p ? `${id}|${p.config.name}|${p.host}|${p.open}|${p.workspace?.state ?? ""}` : "";
      })
      .join(";"),
  );

  const pill = connectionPillFor(state);
  const pillLabel =
    state === "connected" && target
      ? `${pill.label} · ${connectionPillTarget(target)}`
      : pill.label;
  const can = connectionActionsFor(state);
  const limit = count >= MAX_POLLS;
  const busy = !ready || pending !== null;

  const connectionLabel =
    state === "disconnected"
      ? "Reconnect"
      : state === "connecting"
        ? "Cancel"
        : state === "connected"
          ? "Disconnect"
          : "Connect";

  const fileEntries: MenuEntry[] = [
    {
      kind: "item",
      id: "open",
      label: "Open profile…",
      shortcut: "Ctrl+O",
      onSelect: () => actions.openProfile(),
    },
    {
      kind: "item",
      id: "save",
      label: "Save",
      shortcut: "Ctrl+S",
      onSelect: () => void actions.saveProfile(),
    },
    {
      kind: "item",
      id: "save-as",
      label: "Save as…",
      shortcut: "Ctrl+Shift+S",
      onSelect: () => void actions.saveProfileAs(),
    },
    { kind: "separator", id: "sep" },
    {
      kind: "item",
      id: "new-window",
      label: "New connection window",
      shortcut: "Ctrl+N",
      onSelect: () => void actions.newWindow(),
    },
    {
      kind: "item",
      id: "close-window",
      label: "Close window",
      shortcut: "Alt+F4",
      // Asks "Save changes?" first when something is unsaved (the same question as the OS close).
      onSelect: () => void actions.closeWindow(),
    },
  ];

  const connectionEntries: MenuEntry[] = [
    {
      kind: "item",
      id: "connect",
      label: connectionLabel,
      shortcut: "Ctrl+L",
      disabled: busy,
      onSelect: () => void actions.toggleConnection(),
    },
    ...(can.dismiss
      ? [
          {
            kind: "item",
            id: "dismiss",
            label: "Dismiss",
            disabled: busy,
            onSelect: () => void actions.dismiss(),
          } satisfies MenuEntry,
        ]
      : []),
    { kind: "separator", id: "sep-edit" },
    {
      kind: "item",
      id: "edit",
      label: "Edit connection settings",
      onSelect: () => section.getState().edit(),
    },
    {
      kind: "check",
      id: "auto-start",
      label: "Start polling when connected",
      checked: autoStart,
      onSelect: () => void connStore.getState().setAutoStartPoll(!autoStart),
    },
    { kind: "separator", id: "sep-counters" },
    {
      kind: "item",
      id: "reset",
      label: "Reset all counters",
      onSelect: () => void actions.resetAllCounters(),
    },
    {
      kind: "item",
      id: "traffic",
      label: "Show traffic",
      shortcut: "Ctrl+J",
      onSelect: () => workspace.getState().setTrafficExpanded(true),
    },
  ];

  // listKey changes with names, hosts and the workspace state of the polls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `listKey` stands for the poll list.
  const windowEntries = useMemo(() => {
    const list = pollList.getState();
    const visible = visibleIds(items);
    return windowMenuEntries({
      gridMode: true,
      visibleCount: visible.length,
      minimizedCount: Object.values(items).filter((i) => i.state === "minimized").length,
      maximizedCount: Object.values(items).filter((i) => i.state === "maximized").length,
      workspaceCount: Object.keys(items).length,
      tileMode,
      compact,
      nativeCount: natives,
      polls: list.order.flatMap((id) => {
        const p = list.polls[id];
        return p
          ? [{ id, name: p.config.name, marker: hostMarker(hostStateOf(p))?.text ?? null }]
          : [];
      }),
      activeId,
      monitors,
      arrangeTarget,
      onTile: () => workspace.getState().tile(),
      onResetGrid: () => workspace.getState().resetGrid(),
      onTileMode: (on) => workspace.getState().setTileMode(on),
      onCascade: () => workspace.getState().cascade(),
      onArrangeMinimized: () => actions.arrangeMinimized(),
      onMinimizeAll: () => workspace.getState().minimizeAll(),
      onRestoreAll: () => workspace.getState().restoreAll(),
      onCompact: (on) => void prefs.getState().setCompact(on),
      onShowNatives: () => void actions.showPollWindows(),
      onArrange: (layout) => void actions.arrangeNatives(layout),
      onArrangeTarget: (target) => arrange.getState().setTarget(target),
      onArrangeOpen: () => void arrange.getState().loadMonitors(),
      onNext: () => workspace.getState().cycle(1),
      onPrevious: () => workspace.getState().cycle(-1),
      onShowPoll: (id) => void actions.showPoll(id),
    });
  }, [
    items,
    tileMode,
    compact,
    natives,
    activeId,
    listKey,
    monitors,
    arrangeTarget,
    workspace,
    prefs,
    pollList,
    arrange,
    actions,
  ]);

  return (
    <div
      role="toolbar"
      aria-label="Toolbar"
      data-region="toolbar"
      data-narrow={squeeze.narrow ? "true" : "false"}
      className={squeeze.root}
    >
      <MenuButton label="File" entries={fileEntries} className={MENU_TRIGGER}>
        File
        <Icon name="chevron-down" className="size-3.5" />
      </MenuButton>
      <MenuButton label="Connection" entries={connectionEntries} className={MENU_TRIGGER}>
        Connection
        <Icon name="chevron-down" className="size-3.5" />
      </MenuButton>
      <Button
        id={SIDEBAR_TOGGLE_ID}
        size={squeeze.narrow ? "icon-sm" : "sm"}
        variant="outline"
        aria-label={sidebarLabel}
        aria-expanded={expanded}
        aria-controls={SIDEBAR_ID}
        title={`${sidebarLabel} (Ctrl+\\)`}
        onClick={() => actions.toggleSidebar()}
      >
        <Icon name={expanded ? "panel-left-close" : "panel-left-open"} />
        {squeeze.narrow ? null : sidebarLabel}
      </Button>
      <Button
        size="sm"
        disabled={bulkLocked || limit || adding || !ready}
        title={limit ? MAX_POLLS_MESSAGE : "New poll (Ctrl+Shift+N)"}
        onClick={() => void actions.newPoll()}
      >
        <Icon name="plus" />
        New poll
      </Button>
      <MenuButton label="Window" entries={windowEntries} className={MENU_TRIGGER}>
        Window
        <Icon name="chevron-down" className="size-3.5" />
      </MenuButton>

      {squeeze.showProfile ? (
        <span className={squeeze.profile} data-testid="profile">
          <span className="min-w-0 truncate font-semibold" title={profileName ?? "Untitled"}>
            {profileName ?? "Untitled"}
          </span>
          {modified ? <span className="shrink-0 text-text-muted">· Modified</span> : null}
        </span>
      ) : null}

      <StatusPill
        variant={pill.variant}
        icon={pill.icon}
        label={pillLabel}
        title={pillLabel}
        className={squeeze.pill}
        truncate
      />
      {state === "connected" ? <SummaryChip squeeze={squeeze} /> : null}

      <div className={squeeze.actions}>
        {state === "connected" && (anyRunning || anyPaused) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!ready}
            title={anyRunning ? "Pause all (Ctrl+Shift+P)" : "Resume all (Ctrl+Shift+P)"}
            onClick={() => void actions.togglePauseAll()}
          >
            {anyRunning ? "Pause all" : "Resume all"}
          </Button>
        ) : null}
        {can.connect ? (
          <Button
            size="sm"
            disabled={busy}
            title={`${connectionLabel} (Ctrl+L)`}
            onClick={() => void actions.connect()}
          >
            {pending === "connect" ? <Icon name="loader" /> : null}
            {connectionLabel}
          </Button>
        ) : null}
        {can.cancel ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || pending === "cancel"}
            title="Cancel (Ctrl+L)"
            onClick={() => void actions.cancelConnect()}
          >
            {pending === "cancel" ? <Icon name="loader" /> : null}
            Cancel
          </Button>
        ) : null}
        {can.disconnect ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || pending === "disconnect"}
            title="Disconnect (Ctrl+L)"
            onClick={() => void actions.disconnect()}
          >
            {pending === "disconnect" ? <Icon name="loader" /> : null}
            Disconnect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
