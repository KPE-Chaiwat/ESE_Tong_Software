import { memo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { PollId, SubWindowState } from "@/shared/ipc/modbus-master.types";
import { cn } from "@/shared/lib/utils";
import { Icon, type IconName } from "@/shared/ui/icon";
import { ContextMenu } from "@/shared/ui/menu";
import type { PollViewRuntime } from "../../runtime/poll-view-runtime";
import { selectIsSwapTarget, selectSnapEnabled } from "../../store/drag.store";
import { tiledIds } from "../../store/workspace.logic";
import { useDrag, usePollList, useRuntime, useWorkspace } from "../context";
import { InlineRename } from "../InlineRename";
import { startPointerGesture } from "./pointer-gesture";
import { titleBarMenuEntries } from "./title-bar-menu.logic";

interface TitleBarProps {
  pollId: PollId;
  view: PollViewRuntime;
  state: SubWindowState;
  active: boolean;
  tileMode: boolean;
}

function IconButton({
  label,
  icon,
  active,
  onClick,
  pressed,
  dot,
  busy,
  command,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  onClick: () => void;
  pressed?: boolean;
  dot?: boolean;
  /** The command of this button is running: a spinner replaces the icon (DES-002 2.5.2). */
  busy?: boolean;
  /** The pop out button: the focus returns to it after a failure (`data-focus-target`). */
  command?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      // A busy button keeps the keyboard focus: aria-disabled, never `disabled` (DES-002 2.5.2).
      {...(busy ? { "aria-busy": true, "aria-disabled": true } : {})}
      {...(command ? { "data-focus-target": "command" } : {})}
      onClick={() => {
        if (!busy) onClick();
      }}
      // The buttons are not part of the drag grip.
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "relative inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none",
        active ? "hover:bg-light/15 focus-ring-on-dark" : "hover:bg-neutral-tint focus-ring",
      )}
    >
      <Icon name={busy ? "loader" : icon} className="size-3.5" />
      {dot ? (
        <span
          data-testid="unapplied-dot"
          aria-hidden="true"
          className={cn(
            "absolute right-0.5 top-0.5 size-1.5 rounded-pill",
            active ? "bg-accent" : "bg-dark",
          )}
        />
      ) : null}
    </button>
  );
}

/**
 * The 30 px title bar (DES-002 2.3.1): the poll name and the window buttons. It is the drag grip
 * (move; in tile mode, reorder), double-click toggles maximize, and the context menu (right click,
 * Shift+F10, the menu key) is the keyboard route to Move, Size and Move to.
 */
export const TitleBar = memo(function TitleBar({
  pollId,
  view,
  state,
  active,
  tileMode,
}: TitleBarProps) {
  const runtime = useRuntime();
  const { workspace, drag, host } = runtime.stores;
  const name = usePollList((s) => s.polls[pollId]?.config.name ?? "");
  const setupOpen = useStore(view.stores.ui, (s) => s.setupOpen);
  const unapplied = useStore(view.stores.poll, (s) => s.hasUnappliedEdits);
  const popOutBusy = useStore(view.stores.poll, (s) => s.pending === "popOut");
  const swapTarget = useDrag(selectIsSwapTarget(pollId));
  const snapEnabled = useDrag(selectSnapEnabled);
  const renaming = useWorkspace((s) => s.titleRenameId === pollId);
  // The tile slots are the sub-windows that are not minimized, in list order (REV-006 m-6).
  const listKey = usePollList((s) => s.order.join(","));
  const slotKey = useWorkspace((s) =>
    s.tileMode
      ? tiledIds(s.items, listKey === "" ? [] : listKey.split(",").map(Number)).join(",")
      : "",
  );
  const slots = slotKey === "" ? [] : slotKey.split(",").map(Number);
  const slotCount = slots.length;
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const openMenuAtBar = () => {
    const rect = barRef.current?.getBoundingClientRect();
    setMenuAt({ x: (rect?.left ?? 0) + 16, y: (rect?.bottom ?? 0) + 2 });
  };

  const entries = titleBarMenuEntries({
    state,
    tileMode,
    snapEnabled,
    slotCount,
    slotIndex: slots.indexOf(pollId),
    canPopOut: Boolean(view.hostActions.popOut),
    onRestore: () => workspace.getState().restore(pollId),
    onMove: () => {
      drag.getState().beginKeyboard("keyboardMove", pollId);
      barRef.current?.focus();
    },
    onSize: () => {
      drag.getState().beginKeyboard("keyboardSize", pollId);
      barRef.current?.focus();
    },
    onMinimize: () => workspace.getState().minimize(pollId),
    onMaximize: () => workspace.getState().maximize(pollId),
    onMoveToZone: (zone) => drag.getState().moveToZone(pollId, zone),
    onMoveToSlot: (i) => drag.getState().moveToSlot(pollId, i),
    onPopOut: () => view.hostActions.popOut?.("titleBarMenu"),
    onToggleSnap: () => drag.getState().toggleSnap(),
    onClose: () => host.getState().requestClose(pollId),
  });

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={`${name} window`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the title bar is a toolbar; it takes the focus so the title bar menu and the keyboard move are reachable (DES-002 9).
      tabIndex={0}
      data-slot="title-bar"
      data-poll-id={pollId}
      onPointerDown={(e) => startPointerGesture({ event: e, runtime, pollId, kind: "move" })}
      onDoubleClick={(e) => {
        // The menu is rendered by this component but lives in a portal: its events bubble here.
        if (e.currentTarget.contains(e.target as Node)) workspace.getState().toggleMaximize(pollId);
      }}
      onContextMenu={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        setMenuAt({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        // Left and Right move between the buttons of the toolbar (a toolbar is one tab stop).
        if (
          (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
          !e.altKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          e.target instanceof HTMLButtonElement
        ) {
          const buttons = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
          );
          const at = buttons.indexOf(e.target);
          const next =
            buttons[(at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
          if (at !== -1 && next) {
            e.preventDefault();
            e.stopPropagation();
            next.focus();
          }
          return;
        }
        if (e.target !== e.currentTarget) return;
        if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
          e.preventDefault();
          openMenuAtBar();
        } else if (e.key === "F2") {
          e.preventDefault();
          workspace.getState().startTitleRename(pollId);
        }
      }}
      className={cn(
        "relative flex h-[30px] shrink-0 cursor-move touch-none select-none items-center gap-1 px-1.5 pl-3 outline-none",
        active ? "bg-dark text-light focus-ring-on-dark" : "bg-light text-dark focus-ring",
      )}
    >
      {renaming ? (
        <InlineRename
          name={name}
          onCommit={(text) => runtime.stores.pollList.getState().rename(pollId, text)}
          onDone={() => workspace.getState().endTitleRename()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{name}</span>
      )}
      <IconButton
        label="Poll setup (Ctrl+\)"
        icon="settings-2"
        active={active}
        pressed={setupOpen}
        dot={unapplied}
        onClick={() => view.stores.ui.getState().toggleSetup()}
      />
      {view.hostActions.popOut ? (
        <IconButton
          label="Open in its own window (Ctrl+Shift+O)"
          icon="square-arrow-out-up-right"
          active={active}
          busy={popOutBusy}
          command
          onClick={() => view.hostActions.popOut?.("button")}
        />
      ) : null}
      <IconButton
        label="Minimize"
        icon="minus"
        active={active}
        onClick={() => workspace.getState().minimize(pollId)}
      />
      <IconButton
        label={state === "maximized" ? "Restore" : "Maximize"}
        icon={state === "maximized" ? "copy" : "square"}
        active={active}
        onClick={() => workspace.getState().toggleMaximize(pollId)}
      />
      <IconButton
        label="Close (Ctrl+F4)"
        icon="x"
        active={active}
        onClick={() => host.getState().requestClose(pollId)}
      />
      {swapTarget ? (
        <div
          data-testid="swap-overlay"
          aria-hidden="true"
          className="absolute inset-0 z-10 flex items-center justify-center gap-1.5 bg-selected text-[13px] font-semibold text-dark"
        >
          <Icon name="arrow-left-right" className="size-3.5" />
          Swap
        </div>
      ) : null}
      <ContextMenu
        position={menuAt}
        entries={entries}
        label={`${name} window menu`}
        onClose={(restore) => {
          setMenuAt(null);
          if (restore) barRef.current?.focus();
        }}
      />
    </div>
  );
});
