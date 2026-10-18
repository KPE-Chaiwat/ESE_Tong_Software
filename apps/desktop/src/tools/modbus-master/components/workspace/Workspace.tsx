import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { selectNativeCount } from "../../store/poll-list.store";
import { visibleIds } from "../../store/workspace.logic";
import { useActions, usePollList, useRuntime, useWorkspace } from "../context";
import { DragOverlay } from "./DragOverlay";
import { frameKeyAction, isTextEntry } from "./frame-keys";
import { MinimizedBar } from "./MinimizedBar";
import { SubWindowFrame } from "./SubWindowFrame";

export const EMPTY_NO_POLLS =
  "No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection.";
export const EMPTY_NOT_SHOWN =
  "No poll is shown in the workspace. Click a poll in the list, or drag it here.";

export function nativeWindowsText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 poll is open in its own window."
    : `${count} polls are open in their own windows.`;
}

/** Measures an element and reports its size once per animation frame at most. */
function useReportSize(
  ref: React.RefObject<HTMLElement | null>,
  onSize: (w: number, h: number) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) onSize(Math.round(rect.width), Math.round(rect.height));
    let latest: { w: number; h: number } | null = null;
    let handle: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      latest = { w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) };
      if (handle !== null) return;
      const run = () => {
        handle = null;
        if (latest && latest.w > 0 && latest.h > 0) onSize(latest.w, latest.h);
      };
      handle =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(run)
          : (setTimeout(run, 16) as unknown as number);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (handle !== null && typeof cancelAnimationFrame === "function")
        cancelAnimationFrame(handle);
    };
  }, [ref, onSize]);
}

/**
 * The workspace (DES-002 2.2.4): the area behind the poll sub-windows. It never scrolls, hosts the
 * frames, the minimized bar, the drag overlay and the empty texts, and reports its size.
 */
export function Workspace() {
  const runtime = useRuntime();
  const actions = useActions();
  const { workspace, drag } = runtime.stores;
  const items = useWorkspace((s) => s.items);
  const tileMode = useWorkspace((s) => s.tileMode);
  const total = usePollList((s) => s.order.length);
  const natives = usePollList(selectNativeCount);
  const adding = usePollList((s) => s.adding);
  const canAdd = usePollList((s) => s.order.length < 16);
  const ref = useRef<HTMLElement>(null);

  const ids = useMemo(() => visibleIds(items).sort((a, b) => a - b), [items]);
  const hasItems = Object.keys(items).length > 0;

  const setSize = useMemo(
    () => (w: number, h: number) => workspace.getState().setSize({ width: w, height: h }),
    [workspace],
  );
  useReportSize(ref, setSize);

  return (
    <section
      ref={ref}
      aria-label="Workspace"
      data-region="workspace"
      data-workspace=""
      data-tile-mode={tileMode ? "on" : "off"}
      tabIndex={-1}
      onKeyDown={(e) => {
        // The workspace background forwards the window keys to the active sub-window.
        if (e.target !== e.currentTarget || isTextEntry(e.target)) return;
        const id = workspace.getState().activeId;
        const action = frameKeyAction(e);
        if (id === null || !action) return;
        e.preventDefault();
        if (action.kind === "swap") drag.getState().swapDirection(id, action.dir);
        else drag.getState().nudge(id, action.kind, action.dir, action.fine);
      }}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-workspace outline-none"
    >
      {ids.map((id) => (
        <SubWindowFrame key={id} pollId={id} />
      ))}

      {hasItems ? null : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-text-muted">
          {total === 0 ? (
            <>
              <p data-testid="workspace-empty">{EMPTY_NO_POLLS}</p>
              <Button size="sm" disabled={!canAdd || adding} onClick={() => void actions.newPoll()}>
                <Icon name="plus" />
                New poll
              </Button>
            </>
          ) : (
            <>
              <p data-testid="workspace-empty">{EMPTY_NOT_SHOWN}</p>
              {nativeWindowsText(natives) ? <p>{nativeWindowsText(natives)}</p> : null}
            </>
          )}
        </div>
      )}

      {tileMode ? (
        <div
          data-testid="tile-mode-indicator"
          className="pointer-events-none absolute right-3 top-2 z-[100002] flex items-center gap-1 text-xs text-text-muted"
        >
          <Icon name="layout-grid" className="size-3" />
          Tile mode
        </div>
      ) : null}

      <DragOverlay />
      <MinimizedBar />
    </section>
  );
}
