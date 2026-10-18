import { useLayoutEffect } from "react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { Icon } from "@/shared/ui/icon";
import { SIDEBAR_ID, SIDEBAR_TOGGLE_ID } from "../../lib/sidebar";
import { compactChip } from "../../lib/status-line";
import { pollPillFor } from "../../store/poll.logic";
import { selectPollConfig, selectPollHasData, selectPollStatus } from "../../store/poll-list.store";
import { SIDEBAR_WIDTH_RANGE } from "../../store/workspace.logic";
import { useActions, usePollList, useRuntime, useSidebarExpanded, useWorkspace } from "../context";
import { ResizeSeparator } from "../shell/ResizeSeparator";
import { ConnectionSection } from "./ConnectionSection";
import { PollList } from "./PollList";

function RailIcon({ pollId }: { pollId: PollId }) {
  const actions = useActions();
  const config = usePollList(selectPollConfig(pollId));
  const status = usePollList(selectPollStatus(pollId));
  const hasData = usePollList(selectPollHasData(pollId));
  if (!config || !status) return null;
  const chip = compactChip(status.state, {
    consecutiveFailures: status.consecutiveFailures,
    exceptionCode: status.exceptionCode,
    hasData,
  });
  const label = `${config.name}: ${pollPillFor(status.state, status.exceptionCode, hasData).label}`;
  return (
    <button
      type="button"
      data-slot="rail-icon"
      aria-label={label}
      title={label}
      onClick={() => void actions.showPoll(pollId)}
      className="inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
    >
      <Icon name={chip.icon} tone={status.state === "exception" ? "error" : "default"} />
    </button>
  );
}

/** The 44 px rail of compact mode and of a collapsed sidebar: one state icon per poll (DES-002 2.9). */
function Rail() {
  const actions = useActions();
  const order = usePollList((s) => s.order);
  useLayoutEffect(
    () => () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('[data-slot="sidebar-rail"]')) {
        document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
      }
    },
    [],
  );
  return (
    <nav
      aria-label="Polls (rail)"
      data-region="sidebar"
      data-slot="sidebar-rail"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-card py-2"
    >
      <button
        type="button"
        aria-label="Show sidebar"
        aria-expanded={false}
        aria-controls={SIDEBAR_ID}
        title="Show sidebar (Ctrl+\)"
        onClick={() => {
          document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
          actions.toggleSidebar();
        }}
        className="inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
      >
        <Icon name="chevron-right" />
      </button>
      {order.map((id) => (
        <RailIcon key={id} pollId={id} />
      ))}
    </nav>
  );
}

/**
 * The sidebar (DES-002 2.2.2, 2.2.3): the CONNECTION section and the POLLS list. 280 px wide
 * (220-400, a handle resizes it), or the 44 px rail in compact mode and when collapsed.
 */
export function Sidebar() {
  const runtime = useRuntime();
  const expanded = useSidebarExpanded();
  const width = useWorkspace((s) => s.sidebar.width);
  const workspace = runtime.stores.workspace;

  const rail = !expanded;
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (rail && active instanceof HTMLElement && active.closest(`#${SIDEBAR_ID}`)) {
      document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
    }
  }, [rail]);

  return (
    <>
      {rail ? <Rail /> : null}
      {/* Hidden, not unmounted, as a rail: the connection form keeps what was typed. */}
      <aside
        id={SIDEBAR_ID}
        hidden={rail}
        aria-label="Sidebar"
        data-region="sidebar"
        data-slot="sidebar"
        style={{ width }}
        className="flex shrink-0 flex-col gap-4 overflow-y-auto border-r bg-card p-3"
      >
        <ConnectionSection />
        <PollList />
      </aside>
      {rail ? null : (
        <ResizeSeparator
          orientation="vertical"
          label="Resize sidebar"
          value={width}
          min={SIDEBAR_WIDTH_RANGE.min}
          max={SIDEBAR_WIDTH_RANGE.max}
          onResize={(px) => workspace.getState().setSidebarWidth(px)}
          onCommit={() => void workspace.getState().flush()}
          onReset={() => {
            workspace.getState().setSidebarWidth(SIDEBAR_WIDTH_RANGE.default);
            void workspace.getState().flush();
          }}
        />
      )}
    </>
  );
}
