import { type MouseEvent, memo, type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { shortcutKeyOf } from "@/shared/lib/shortcut-key";
import { cn } from "@/shared/lib/utils";
import { Icon } from "@/shared/ui/icon";
import { ContextMenu, MenuButton } from "@/shared/ui/menu";
import { MAX_POLLS } from "../../lib/poll-names";
import { pollMeta, pollRowLabel, pollRowTooltip } from "../../lib/poll-row";
import { pollRowMenuEntries } from "../../lib/poll-row-menu";
import { hostMarker } from "../../lib/status-line";
import { selectIsListDragged, selectListGapIndex } from "../../store/drag.store";
import { isPollRunning, pollPillFor } from "../../store/poll.logic";
import {
  selectPollConfig,
  selectPollHasData,
  selectPollHostState,
  selectPollLastHost,
  selectPollStatus,
} from "../../store/poll-list.store";
import { useActions, useDrag, usePollList, usePollSelection, useRuntime } from "../context";
import { InlineRename } from "../InlineRename";
import { PollChip } from "../PollChip";
import { startListGesture } from "./list-gesture";
import { PollBulkActions } from "./PollBulkActions";

export const EMPTY_LIST_TEXT =
  "No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection.";
export const LIST_HINT =
  "Click a poll to bring it to the front. Drag a poll into the workspace to place it. Pop out (Ctrl+Shift+O) opens it in its own window, for another monitor.";

/**
 * A click on the row itself. Clicks on the row's buttons, on its rename field and inside its menus
 * (a portal: the events still bubble through the row) are not "show the poll".
 */
function isRowClick(e: MouseEvent<HTMLElement>): boolean {
  const target = e.target;
  return (
    target instanceof Element &&
    e.currentTarget.contains(target) &&
    !target.closest("button:not([data-poll-show]), input, [role=menu]")
  );
}

function focusRow(listEl: HTMLElement | null, id: PollId) {
  queueMicrotask(() =>
    listEl?.querySelector<HTMLElement>(`[data-poll-id="${id}"] [data-poll-show]`)?.focus(),
  );
}

const Row = memo(function Row({
  id,
  listRef,
}: {
  id: PollId;
  listRef: RefObject<HTMLUListElement | null>;
}) {
  const runtime = useRuntime();
  const actions = useActions();
  // Narrow slices: a counters event changes none of them, so the row does not render per cycle.
  const config = usePollList(selectPollConfig(id));
  const status = usePollList(selectPollStatus(id));
  const hostState = usePollList(selectPollHostState(id));
  const lastHost = usePollList(selectPollLastHost(id));
  const hasData = usePollList(selectPollHasData(id));
  const frozen = usePollSelection((s) => s.frozen);
  const checked = usePollSelection((s) => s.selectedIds.has(id));
  const selected = usePollList((s) => s.selectedId === id);
  const renaming = usePollList((s) => s.renamingId === id);
  const isFirst = usePollList((s) => s.order[0] === id);
  const isLast = usePollList((s) => s.order[s.order.length - 1] === id);
  const atLimit = usePollList((s) => s.order.length >= MAX_POLLS);
  const dragging = useDrag(selectIsListDragged(id));
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  if (!config || !status || !hostState) return null;

  const pill = pollPillFor(status.state, status.exceptionCode, hasData);
  const marker = hostMarker(hostState);
  const { pollList, host } = runtime.stores;

  const entries = pollRowMenuEntries({
    hostState,
    lastHostNative: lastHost === "native",
    running: isPollRunning(status.state),
    isFirst,
    isLast,
    atLimit,
    onShow: () => void actions.showPoll(id),
    onShowInWorkspace: () => void host.getState().show(id, null),
    onPopOut: () => void actions.popOutPoll(id, "sidebarMenu"),
    onDock: () => void actions.dockPoll(id),
    onToggle: () => void actions.togglePoll(id),
    onRename: () => pollList.getState().startRename(id),
    onDuplicate: () => void pollList.getState().duplicate(id),
    onMoveUp: () => void actions.movePoll(id, "up").then(() => focusRow(listRef.current, id)),
    onMoveDown: () => void actions.movePoll(id, "down").then(() => focusRow(listRef.current, id)),
    onShowTraffic: () => actions.showTrafficFor(id),
    onDelete: () => host.getState().requestDelete(id),
  });

  return (
    <li
      aria-label={pollRowLabel(config.name, pill.label, marker?.text ?? null)}
      title={config.name}
      // The tooltip has the counters and the last update; they are read when it is wanted, not at
      // every cycle (REV-006 m-9).
      onPointerEnter={(e) => {
        const entry = pollList.getState().polls[id];
        if (!entry) return;
        e.currentTarget.title = pollRowTooltip({
          name: entry.config.name,
          definition: entry.config.definition,
          base: entry.config.display.addressBase,
          lastOkAt: entry.counters.lastOkAt,
          errors: entry.counters.counters.errors + entry.counters.counters.timeouts,
        });
      }}
      data-poll-id={id}
      data-slot="poll-row"
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={(e) => {
        const listEl = listRef.current;
        if (listEl && !renaming) startListGesture({ event: e, runtime, pollId: id, listEl });
      }}
      onClick={(e) => {
        if (isRowClick(e)) void actions.showPoll(id);
      }}
      onDoubleClick={(e) => {
        if (isRowClick(e)) void actions.showPoll(id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        pollList.getState().select(id);
        setMenuAt({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        // The keys of the rename field and of the menus are theirs.
        if (!(e.target instanceof HTMLElement) || !e.target.matches("[data-poll-show]")) return;
        const handled = () => {
          e.preventDefault();
          e.stopPropagation();
        };
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          handled();
          void actions
            .movePoll(id, e.key === "ArrowUp" ? "up" : "down")
            .then(() => focusRow(listRef.current, id));
        } else if (e.key === "Enter") {
          handled();
          void actions.showPoll(id);
        } else if (e.key === "Delete") {
          handled();
          host.getState().requestDelete(id);
        } else if (e.key === "F2") {
          handled();
          pollList.getState().startRename(id);
        } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && shortcutKeyOf(e) === "c") {
          handled();
          void actions.copyPollRow(id);
        } else if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
          handled();
          const rect = e.currentTarget.getBoundingClientRect();
          setMenuAt({ x: rect.left + 24, y: rect.bottom });
        }
      }}
      className={cn(
        "group relative flex h-12 cursor-pointer select-none flex-col justify-center rounded-[10px] py-2 pl-11 pr-2.5 outline-none focus-ring",
        selected ? "bg-selected" : "hover:bg-neutral-tint",
        dragging && "opacity-40",
      )}
    >
      <button
        type="button"
        tabIndex={0}
        data-poll-show
        aria-label={pollRowLabel(config.name, pill.label, marker?.text ?? null)}
        aria-current={selected ? "true" : undefined}
        aria-description={selected ? "Current poll" : undefined}
        className="absolute inset-0 rounded-[10px] outline-none focus-ring"
      />
      <input
        type="checkbox"
        aria-label={`Select ${config.name}`}
        checked={checked}
        aria-disabled={frozen}
        onChange={() => {}}
        onClick={(e) => {
          if (frozen) {
            e.preventDefault();
            return;
          }
          const selection = runtime.stores.pollSelection.getState();
          if (e.shiftKey) selection.addRange(id, pollList.getState().order);
          else selection.toggle(id);
          runtime.stores.announcer
            .getState()
            .announce(
              `${runtime.stores.pollSelection.getState().selectedIds.size} polls selected.`,
            );
        }}
        onKeyDown={(e) => {
          if (frozen) {
            if (e.key !== "Tab") e.preventDefault();
            return;
          }
          if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
          const order = pollList.getState().order;
          const index = order.indexOf(id);
          const nextIndex =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? order.length - 1
                : e.key === "ArrowUp"
                  ? Math.max(0, index - 1)
                  : e.key === "ArrowDown"
                    ? Math.min(order.length - 1, index + 1)
                    : null;
          if (nextIndex === null) {
            if (e.key === " " && e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              runtime.stores.pollSelection.getState().addRange(id, order);
              runtime.stores.announcer
                .getState()
                .announce(
                  `${runtime.stores.pollSelection.getState().selectedIds.size} polls selected.`,
                );
            }
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const next = order[nextIndex];
          if (next === undefined) return;
          if (e.shiftKey) {
            runtime.stores.pollSelection.getState().addRange(next, order, id);
            runtime.stores.announcer
              .getState()
              .announce(
                `${runtime.stores.pollSelection.getState().selectedIds.size} polls selected.`,
              );
          }
          listRef.current
            ?.querySelector<HTMLInputElement>(`[data-poll-id="${next}"] input[type=checkbox]`)
            ?.focus();
        }}
        className="absolute left-2 size-7 cursor-pointer accent-dark outline-none focus-ring"
      />
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-pill bg-dark"
        />
      ) : null}
      <Icon
        name="grip-vertical"
        className="pointer-events-none absolute left-1 top-1/2 size-3 -translate-y-1/2 text-text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
      />
      <div className="pointer-events-none flex min-w-0 items-center gap-1.5">
        {renaming ? (
          <InlineRename
            name={config.name}
            onCommit={(text) => pollList.getState().rename(id, text)}
            onDone={() => {
              pollList.getState().cancelRename();
              focusRow(listRef.current, id);
            }}
            inputClassName="pointer-events-auto text-sm"
          />
        ) : (
          <span className="min-w-0 truncate text-sm font-semibold">{config.name}</span>
        )}
        {marker ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted">
            <Icon name={marker.icon} className="size-3" />
            {marker.text}
          </span>
        ) : null}
        <span className="pointer-events-auto ml-auto opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <MenuButton
            label={`Actions for ${config.name}`}
            entries={entries}
            alignEnd
            className="inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
          >
            <Icon name="ellipsis" />
          </MenuButton>
        </span>
      </div>
      <div className="pointer-events-none flex min-w-0 items-center gap-1.5">
        <PollChip
          state={status.state}
          exceptionCode={status.exceptionCode}
          consecutiveFailures={status.consecutiveFailures}
          hasData={hasData}
        />
        <span className="min-w-0 truncate font-mono text-[11.5px]">
          {pollMeta(config.definition, config.display.addressBase)}
        </span>
      </div>
      <ContextMenu
        position={menuAt}
        entries={entries}
        label={`Actions for ${config.name}`}
        onClose={(restore) => {
          setMenuAt(null);
          if (restore) focusRow(listRef.current, id);
        }}
      />
    </li>
  );
});

/**
 * The 2 px insertion line with its 8 px circle (DES-002 2.10.6), between two rows. It is the only
 * part of the list that follows the drag, so the rows do not render while the pointer moves.
 */
function DropIndicator({ listRef }: { listRef: RefObject<HTMLUListElement | null> }) {
  const gap = useDrag(selectListGapIndex);
  const [top, setTop] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (gap === null || !el) return;
    const rows = el.querySelectorAll<HTMLElement>("[data-poll-id]");
    const next = rows[gap];
    const prev = rows[gap - 1];
    setTop(next ? Math.max(0, next.offsetTop - 2) : prev ? prev.offsetTop + prev.offsetHeight : 0);
  }, [gap, listRef]);

  if (gap === null) return null;
  return (
    <div
      aria-hidden="true"
      role="presentation"
      data-testid="list-drop-indicator"
      data-gap-index={gap}
      style={{ top }}
      className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-dark"
    >
      <span className="absolute -left-0.5 -top-[3px] size-2 rounded-full bg-dark" />
    </div>
  );
}

/**
 * The POLLS list (DES-002 2.2.3): header, rows with the state chip, the meta line and the host
 * marker; click or Enter shows the poll; the row menu, inline rename (F2), Ctrl+C, Alt+Up and
 * Alt+Down; drag a row to reorder (the list order is the tile order) or into the workspace.
 */
export function PollList() {
  const order = usePollList((s) => s.order);
  const frozen = usePollSelection((s) => s.frozen);
  const selectedCount = usePollSelection((s) => s.selectedIds.size);
  const runtime = useRuntime();
  const listRef = useRef<HTMLUListElement>(null);

  return (
    <section aria-labelledby="polls-heading" className="flex min-h-0 flex-1 flex-col gap-1">
      <h3
        id="polls-heading"
        className="text-xs font-semibold uppercase tracking-wide text-text-muted"
      >
        Polls · {order.length} of {MAX_POLLS}
      </h3>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="mr-auto">{selectedCount} selected</span>
        <button
          type="button"
          className="min-h-7 rounded-pill px-2 outline-none focus-ring disabled:opacity-50"
          disabled={frozen || order.length === 0 || selectedCount === order.length}
          onClick={() => {
            runtime.stores.pollSelection.getState().selectAll(order);
            runtime.stores.announcer.getState().announce(`${order.length} polls selected.`);
          }}
        >
          Select all
        </button>
        <button
          type="button"
          className="min-h-7 rounded-pill px-2 outline-none focus-ring disabled:opacity-50"
          disabled={frozen || selectedCount === 0}
          onClick={() => {
            runtime.stores.pollSelection.getState().clear();
            runtime.stores.announcer.getState().announce("0 polls selected.");
          }}
        >
          Clear selection
        </button>
      </div>
      <PollBulkActions />
      {order.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-text-muted">{EMPTY_LIST_TEXT}</p>
      ) : (
        <ul
          ref={listRef}
          aria-label="Polls"
          data-region="polls"
          className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
          onKeyDown={(e) => {
            const target = e.target as HTMLElement;
            if (
              e.nativeEvent.isComposing ||
              e.altKey ||
              target.closest(
                "[role=menu], textarea, [contenteditable=true], input:not([type=checkbox]), button:not([data-poll-show])",
              )
            )
              return;
            if ((e.ctrlKey || e.metaKey) && shortcutKeyOf(e) === "a") {
              e.preventDefault();
              e.stopPropagation();
              const selection = runtime.stores.pollSelection.getState();
              if (e.shiftKey) selection.clear();
              else selection.selectAll(order);
              runtime.stores.announcer
                .getState()
                .announce(
                  `${runtime.stores.pollSelection.getState().selectedIds.size} polls selected.`,
                );
              return;
            }
            if (target.matches("input")) return;
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if ((e.target as HTMLElement).closest("[role=menu]")) return;
            e.preventDefault();
            const listEl = e.currentTarget;
            const list = runtime.stores.pollList.getState();
            const index = list.selectedId === null ? -1 : list.order.indexOf(list.selectedId);
            const next =
              list.order[
                Math.max(
                  0,
                  Math.min(list.order.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)),
                )
              ];
            if (next === undefined) return;
            list.select(next);
            focusRow(listEl, next);
          }}
        >
          {order.map((id) => (
            <Row key={id} id={id} listRef={listRef} />
          ))}
          <DropIndicator listRef={listRef} />
        </ul>
      )}
      <p className="mt-auto pt-2 text-[12.5px] leading-snug text-text-muted">{LIST_HINT}</p>
    </section>
  );
}
