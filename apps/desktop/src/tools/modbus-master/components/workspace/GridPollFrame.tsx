import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { cn } from "@/shared/lib/utils";
import { Icon, type IconName } from "@/shared/ui/icon";
import { ContextMenu, type MenuEntry } from "@/shared/ui/menu";
import { subWindowLabel } from "../../lib/titles";
import { pollPillFor } from "../../store/poll.logic";
import { selectActiveId } from "../../store/workspace.store";
import { usePollList, useRuntime, useWorkspace } from "../context";
import { InlineRename } from "../InlineRename";
import { PollView } from "../poll-view/PollView";
import { frameKeyAction } from "./frame-keys";

interface GridPollFrameProps {
  pollId: PollId;
  onExpand(id: PollId): void;
  onStep(id: PollId, kind: "move" | "size", dir: "left" | "right" | "up" | "down"): void;
}

/** The Poll view remains a React subtree while GridStack moves its outer widget. */
export const GridPollFrame = memo(function GridPollFrame({
  pollId,
  onExpand,
  onStep,
}: GridPollFrameProps) {
  const runtime = useRuntime();
  const { workspace, host } = runtime.stores;
  useSyncExternalStore(runtime.views.subscribe, () => runtime.views.epoch(pollId));
  const view = runtime.views.get(pollId);
  const active = useWorkspace((s) => selectActiveId(s) === pollId);
  const fresh = useWorkspace((s) => s.freshId === pollId);
  const renaming = useWorkspace((s) => s.titleRenameId === pollId);
  const focusSeq = useWorkspace((s) => (s.focusRequest?.id === pollId ? s.focusRequest.seq : 0));
  const name = usePollList((s) => s.polls[pollId]?.config.name ?? "Poll");
  const state = useStore(view.stores.poll, (s) => s.state);
  const exceptionCode = useStore(view.stores.poll, (s) => s.exceptionCode);
  const attach = useStore(view.stores.poll, (s) => s.attach);
  const pending = useStore(view.stores.poll, (s) => s.pending);
  const hasValues = useStore(view.stores.data, (s) => s.values !== null);
  const setupOpen = useStore(view.stores.ui, (s) => s.setupOpen);
  const ref = useRef<HTMLElement>(null);
  const focused = useRef(0);
  const sawSetup = useRef(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!fresh) {
      sawSetup.current = false;
      return;
    }
    if (setupOpen) sawSetup.current = true;
    else if (sawSetup.current) workspace.getState().markFresh(null);
  }, [fresh, setupOpen, workspace]);
  useEffect(() => {
    if (fresh) view.stores.ui.getState().setSetupOpen(true);
  }, [fresh, view]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus waits for the live data grid to mount.
  useEffect(() => {
    if (focusSeq === 0 || focused.current === focusSeq) return;
    const el = ref.current;
    const grid = el?.querySelector<HTMLElement>('[role="grid"]');
    if (grid) {
      grid.focus();
      el?.closest(".grid-stack-item")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      focused.current = focusSeq;
    } else if (attach !== "attaching") {
      el?.querySelector<HTMLElement>('[data-slot="title-bar"]')?.focus();
      el?.closest(".grid-stack-item")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      focused.current = focusSeq;
    }
  }, [focusSeq, attach, hasValues]);

  const pill = pollPillFor(state, exceptionCode, hasValues);
  const menu: MenuEntry[] = [
    {
      kind: "item",
      id: "rename",
      label: "Rename",
      shortcut: "F2",
      onSelect: () => workspace.getState().startTitleRename(pollId),
    },
    {
      kind: "item",
      id: "minimize",
      label: "Minimize",
      onSelect: () => workspace.getState().minimize(pollId),
    },
    { kind: "item", id: "expand", label: "Expand on grid", onSelect: () => onExpand(pollId) },
    ...(view.hostActions.popOut
      ? [
          {
            kind: "item" as const,
            id: "pop-out",
            label: "Pop out to own window",
            onSelect: () => view.hostActions.popOut?.("titleBarMenu"),
          },
        ]
      : []),
    { kind: "separator", id: "sep-close" },
    {
      kind: "item",
      id: "close",
      label: "Close",
      shortcut: "Ctrl+F4",
      onSelect: () => host.getState().requestClose(pollId),
    },
  ];
  return (
    <section
      ref={ref}
      aria-roledescription="sub-window"
      aria-label={subWindowLabel(name, pill.label)}
      aria-current={active ? "true" : undefined}
      data-subwindow={pollId}
      data-active={active ? "true" : "false"}
      onPointerDownCapture={(e) => {
        if (e.currentTarget.contains(e.target as Node)) workspace.getState().activate(pollId);
      }}
      onFocusCapture={(e) => {
        if (
          e.currentTarget.contains(e.target as Node) &&
          selectActiveId(workspace.getState()) !== pollId
        )
          workspace.getState().activate(pollId);
      }}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-card text-foreground shadow-subwindow",
        active ? "border-2 border-dark" : "border-[1.5px] border-dark/55",
      )}
    >
      <div
        role="toolbar"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the title bar is the keyboard drag and menu handle.
        tabIndex={0}
        data-slot="title-bar"
        aria-label={`${name} window`}
        onKeyDown={(e) => {
          if (e.key === "F2") {
            e.preventDefault();
            workspace.getState().startTitleRename(pollId);
          } else if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: rect.left + 16, y: rect.bottom + 2 });
          } else {
            const action = frameKeyAction(e);
            if (action && action.kind !== "swap") {
              e.preventDefault();
              onStep(pollId, action.kind, action.dir);
              runtime.stores.announcer
                .getState()
                .announce(action.kind === "move" ? `${name} moved.` : `${name} resized on grid.`);
            }
          }
        }}
        onContextMenu={(e) => {
          if (!e.currentTarget.contains(e.target as Node)) return;
          e.preventDefault();
          setMenuAt({ x: e.clientX, y: e.clientY });
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
          onExpand(pollId);
        }}
        className={cn(
          "flex h-[30px] shrink-0 cursor-move touch-none select-none items-center gap-1 px-1.5 pl-3 outline-none",
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
        <GridButton
          label="Poll setup (Ctrl+\)"
          icon="settings-2"
          pressed={setupOpen}
          onClick={() => view.stores.ui.getState().toggleSetup()}
        />
        {view.hostActions.popOut ? (
          <GridButton
            label="Open in its own window (Ctrl+Shift+O)"
            icon="square-arrow-out-up-right"
            disabled={pending === "popOut"}
            command
            onClick={() => view.hostActions.popOut?.("button")}
          />
        ) : null}
        <GridButton
          label="Minimize"
          icon="minus"
          onClick={() => workspace.getState().minimize(pollId)}
        />
        <GridButton label="Expand on grid" icon="square" onClick={() => onExpand(pollId)} />
        <GridButton
          label="Close (Ctrl+F4)"
          icon="x"
          onClick={() => host.getState().requestClose(pollId)}
        />
        <ContextMenu
          position={menuAt}
          entries={menu}
          label={`${name} window menu`}
          onClose={() => setMenuAt(null)}
        />
      </div>
      <div className="min-h-0 flex-1">
        <PollView
          runtime={view}
          host="workspace"
          focusName={fresh}
          popoverMaxHeight={600}
          frame={ref}
        />
      </div>
    </section>
  );
});

function GridButton({
  label,
  icon,
  disabled,
  pressed,
  command,
  onClick,
}: {
  label: string;
  icon: IconName;
  disabled?: boolean;
  pressed?: boolean;
  command?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      aria-disabled={disabled || undefined}
      aria-busy={disabled || undefined}
      data-focus-target={command ? "command" : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-neutral-tint/20 focus-ring"
    >
      <Icon name={disabled ? "loader" : icon} className="size-3.5" />
    </button>
  );
}
