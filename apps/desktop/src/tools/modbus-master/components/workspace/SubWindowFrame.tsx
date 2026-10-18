import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import type { Rect } from "@/shared/lib/layout-math";
import { cn } from "@/shared/lib/utils";
import { subWindowLabel } from "../../lib/titles";
import { selectLiveRect } from "../../store/drag.store";
import { pollPillFor } from "../../store/poll.logic";
import type { SubWindowItem } from "../../store/workspace.logic";
import { selectActiveId, selectItem, selectTileMode } from "../../store/workspace.store";
import { useRuntime, useWorkspace } from "../context";
import { PollView } from "../poll-view/PollView";
import { frameKeyAction, isTextEntry } from "./frame-keys";
import { ResizeHandles } from "./ResizeHandles";
import { TitleBar } from "./TitleBar";

/**
 * Applies the live rectangle of a drag to the frame element: a transform for the position and the
 * size only when it changes. `live` null puts the committed rectangle back. This is the only thing
 * that touches the frame during a drag, so no React render happens (DES-002 2.10.10).
 */
export function applyLiveRect(el: HTMLElement, committed: Rect, live: Rect | null): void {
  const rect = live ?? committed;
  el.style.left = `${committed.x}px`;
  el.style.top = `${committed.y}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.transform =
    live && (live.x !== committed.x || live.y !== committed.y)
      ? `translate(${live.x - committed.x}px, ${live.y - committed.y}px)`
      : "";
  if (live) el.setAttribute("data-dragging", "true");
  else el.removeAttribute("data-dragging");
}

/**
 * One poll as a floating frame in the workspace (DES-002 2.3.1): title bar, the shared PollView,
 * resize handles. It subscribes to its own item only, and a drag moves it without re-rendering it.
 */
export const SubWindowFrame = memo(function SubWindowFrame({ pollId }: { pollId: PollId }) {
  const item = useWorkspace(selectItem(pollId));
  // Without an item there is no frame, and no view runtime is created for it: the registry
  // disposed the view when the item went away.
  return item ? <FrameBody pollId={pollId} item={item} /> : null;
});

function FrameBody({ pollId, item }: { pollId: PollId; item: SubWindowItem }) {
  const runtime = useRuntime();
  const { workspace, drag } = runtime.stores;
  // A pop out that failed gives the frame a new view (the old one was detached by Rust).
  useSyncExternalStore(runtime.views.subscribe, () => runtime.views.epoch(pollId));
  const view = runtime.views.get(pollId);
  const active = useWorkspace((s) => selectActiveId(s) === pollId);
  const tileMode = useWorkspace(selectTileMode);
  const workspaceHeight = useWorkspace((s) => s.size.height);
  const fresh = useWorkspace((s) => s.freshId === pollId);
  const focusSeq = useWorkspace((s) => (s.focusRequest?.id === pollId ? s.focusRequest.seq : 0));
  const state = useStore(view.stores.poll, (s) => s.state);
  const exceptionCode = useStore(view.stores.poll, (s) => s.exceptionCode);
  const hasValues = useStore(view.stores.data, (s) => s.values !== null);
  const name = useStore(view.stores.poll, (s) => s.config?.name ?? "");
  const setupOpen = useStore(view.stores.ui, (s) => s.setupOpen);
  const ref = useRef<HTMLDivElement>(null);

  // The live rectangle of a drag, applied to the element without a render.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const own = selectLiveRect(pollId);
    return drag.subscribe((s, prev) => {
      const live = own(s);
      if (live === own(prev)) return;
      const committed = workspace.getState().items[pollId]?.rect;
      if (committed) applyLiveRect(el, committed, live);
    });
  }, [drag, workspace, pollId]);

  // Moves the keyboard focus into the sub-window when it was asked for (sidebar, menu, Ctrl+F6,
  // dock). The data grid gets it; a view that has not attached yet has no grid, so the request waits
  // for the attach (REV-006 m-7) and only falls back to the title bar when the view has attached
  // and has no grid (not connected).
  const attach = useStore(view.stores.poll, (s) => s.attach);
  const hasGrid = useStore(view.stores.data, (s) => s.values !== null);
  const focused = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the request, the attach or the grid change.
  useEffect(() => {
    if (focusSeq === 0 || focused.current === focusSeq) return;
    const el = ref.current;
    const grid = el?.querySelector<HTMLElement>('[role="grid"]') ?? null;
    if (grid) {
      grid.focus();
      focused.current = focusSeq;
    } else if (attach !== "attaching") {
      el?.querySelector<HTMLElement>('[data-slot="title-bar"]')?.focus();
      focused.current = focusSeq;
    }
  }, [focusSeq, attach, hasGrid]);

  // A new poll opens its setup with the focus in Name; the mark ends when the setup is closed.
  useEffect(() => {
    if (fresh) view.stores.ui.getState().setSetupOpen(true);
  }, [fresh, view]);
  const sawSetup = useRef(false);
  useEffect(() => {
    if (!fresh) {
      sawSetup.current = false;
      return;
    }
    if (setupOpen) sawSetup.current = true;
    else if (sawSetup.current) workspace.getState().markFresh(null);
  }, [fresh, setupOpen, workspace]);

  const pill = pollPillFor(state, exceptionCode, hasValues);
  const maximized = item.state === "maximized";

  return (
    <section
      ref={ref}
      aria-roledescription="sub-window"
      aria-label={subWindowLabel(name, pill.label)}
      aria-current={active ? "true" : undefined}
      data-subwindow={pollId}
      data-state={item.state}
      data-active={active ? "true" : "false"}
      style={{
        position: "absolute",
        left: item.rect.x,
        top: item.rect.y,
        width: item.rect.width,
        height: item.rect.height,
        zIndex: item.z,
      }}
      onPointerDownCapture={(e) => {
        // A dialog of this poll sits in a portal: React still routes its events through the frame,
        // but they are not on the frame.
        if (!e.currentTarget.contains(e.target as Node)) return;
        // Pressing anywhere raises and activates the sub-window; the sidebar selection follows.
        workspace.getState().activate(pollId);
      }}
      onFocusCapture={(e) => {
        // Tab (or any focus) into a sub-window activates and raises it: the active sub-window is the
        // one with the focus, so a focused control is never hidden behind another sub-window
        // (DES-002 2.3.1, D-002-08). The DOM order stays by poll id; nothing is reported to Rust.
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (selectActiveId(workspace.getState()) !== pollId) workspace.getState().activate(pollId);
      }}
      onKeyDownCapture={(e) => {
        // Keys typed in a dialog of this poll (a portal) are the dialog's, not the frame's.
        if (!e.currentTarget.contains(e.target as Node)) return;
        const d = drag.getState();
        // The keyboard Move and Size modes of the title bar menu.
        if (d.pollId === pollId && (d.kind === "keyboardMove" || d.kind === "keyboardSize")) {
          const dir = ARROWS[e.key];
          if (dir) d.keyboardStep(dir, e.shiftKey);
          else if (e.key === "Enter") d.end();
          else if (e.key === "Escape") d.cancel();
          else return;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (isTextEntry(e.target)) return;
        const action = frameKeyAction(e);
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        if (action.kind === "swap") d.swapDirection(pollId, action.dir);
        else d.nudge(pollId, action.kind, action.dir, action.fine);
      }}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl bg-card text-foreground shadow-subwindow",
        active ? "border-2 border-dark" : "border-[1.5px] border-dark/55",
      )}
    >
      <TitleBar
        pollId={pollId}
        view={view}
        state={item.state}
        active={active}
        tileMode={tileMode}
      />
      <div className="min-h-0 flex-1">
        <PollView
          runtime={view}
          host="workspace"
          focusName={fresh}
          popoverMaxHeight={Math.max(0, workspaceHeight - 48)}
          frame={ref}
        />
      </div>
      {tileMode || maximized ? null : <ResizeHandles pollId={pollId} />}
    </section>
  );
}

const ARROWS: Record<string, "left" | "right" | "up" | "down" | undefined> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
