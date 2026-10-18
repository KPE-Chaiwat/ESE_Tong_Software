import { GridStack, type GridStackHandle, GridStackItem } from "gridstack/dist/react";
import { useEffect, useMemo, useRef } from "react";
import "gridstack/dist/gridstack.css";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { selectNativeCount } from "../../store/poll-list.store";
import { visibleIds } from "../../store/workspace.logic";
import { useActions, usePollList, useRuntime, useWorkspace } from "../context";
import { DragOverlay } from "./DragOverlay";
import { GridPollFrame } from "./GridPollFrame";
import { MinimizedBar } from "./MinimizedBar";

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

function useReportSize(
  ref: React.RefObject<HTMLElement | null>,
  onSize: (w: number, h: number) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0)
        onSize(Math.round(rect.width), Math.round(rect.height));
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, onSize]);
}

/** GridStack owns all Poll placement. Only the grid viewport scrolls. */
export function Workspace() {
  const runtime = useRuntime();
  const actions = useActions();
  const { workspace } = runtime.stores;
  const items = useWorkspace((s) => s.items);
  const size = useWorkspace((s) => s.size);
  const total = usePollList((s) => s.order.length);
  const natives = usePollList(selectNativeCount);
  const adding = usePollList((s) => s.adding);
  const canAdd = usePollList((s) => s.order.length < 16);
  const region = useRef<HTMLElement>(null);
  const gridRef = useRef<GridStackHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moving = useRef(false);
  const expanded = useRef(new Map<number, { x: number; y: number; w: number; h: number }>());
  const ids = useMemo(() => visibleIds(items).sort((a, b) => a - b), [items]);
  const hasItems = Object.keys(items).length > 0;
  const columns =
    gridRef.current?.getGrid()?.getColumn() ??
    Math.max(1, Math.min(12, Math.floor(Math.max(size.width, 160) / 160)));
  const options = useMemo(
    () => ({
      column: "auto" as const,
      columnOpts: { columnWidth: 160, columnMax: 12 },
      cellHeight: 48,
      margin: 8,
      float: true,
      animate: false,
      draggable: {
        handle: '[data-slot="title-bar"]',
        cancel: "button, input, textarea, select, [contenteditable]",
      },
      resizable: { handles: "se" },
    }),
    [],
  );
  const setSize = useMemo(
    () => (w: number, h: number) => workspace.getState().setSize({ width: w, height: h }),
    [workspace],
  );
  useReportSize(region, setSize);
  useEffect(
    () => () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    },
    [],
  );

  const persist = () => {
    const grid = gridRef.current?.getGrid();
    if (!grid) return;
    const cols = grid.getColumn();
    const entries = [];
    for (const node of grid.engine.nodes) {
      const id = Number(node.id);
      if (
        !Number.isInteger(id) ||
        node.x === undefined ||
        node.y === undefined ||
        node.w === undefined ||
        node.h === undefined ||
        !node.el
      )
        continue;
      entries.push({
        id,
        grid: { x: node.x, y: node.y, w: node.w, h: node.h, columns: cols },
        rect: {
          x: node.el.offsetWidth > 0 ? node.el.offsetLeft : (items[id]?.rect.x ?? 0),
          y: node.el.offsetHeight > 0 ? node.el.offsetTop : (items[id]?.rect.y ?? 0),
          width: node.el.offsetWidth || items[id]?.rect.width || 640,
          height: node.el.offsetHeight || items[id]?.rect.height || 368,
        },
      });
    }
    workspace.getState().setGridRects(entries);
  };
  const schedulePersist = () => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      persist();
    }, 0);
  };
  const expand = (id: number) => {
    const grid = gridRef.current?.getGrid();
    const node = grid?.engine.nodes.find((n) => n.id === String(id));
    if (!grid || !node?.el) return;
    const previous = expanded.current.get(id);
    if (previous) {
      grid.update(node.el, previous);
      expanded.current.delete(id);
    } else {
      expanded.current.set(id, { x: node.x ?? 0, y: node.y ?? 0, w: node.w ?? 1, h: node.h ?? 4 });
      grid.update(node.el, { x: 0, w: grid.getColumn(), h: Math.max(node.h ?? 4, 8) });
    }
    schedulePersist();
  };
  const step = (id: number, kind: "move" | "size", dir: "left" | "right" | "up" | "down") => {
    const grid = gridRef.current?.getGrid();
    const node = grid?.engine.nodes.find((n) => n.id === String(id));
    if (!grid || !node?.el) return;
    const delta = dir === "left" || dir === "up" ? -1 : 1;
    if (kind === "move")
      grid.update(
        node.el,
        dir === "left" || dir === "right"
          ? { x: Math.max(0, (node.x ?? 0) + delta) }
          : { y: Math.max(0, (node.y ?? 0) + delta) },
      );
    else
      grid.update(
        node.el,
        dir === "left" || dir === "right"
          ? { w: Math.max(1, (node.w ?? 1) + delta) }
          : { h: Math.max(4, (node.h ?? 4) + delta) },
      );
    schedulePersist();
  };

  return (
    <section
      ref={region}
      aria-label="Workspace"
      data-region="workspace"
      data-workspace=""
      tabIndex={-1}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-workspace outline-none"
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-16"
        data-testid="workspace-scroll"
      >
        <GridStack
          ref={gridRef}
          options={options}
          className="min-h-full"
          onAdded={schedulePersist}
          onRemoved={(_event, nodes) => {
            // The React wrapper removes GridStack nodes with removeDOM=false.
            // Its widget elements otherwise keep occupying visible grid space.
            for (const node of nodes) node.el?.remove();
            schedulePersist();
          }}
          onChange={() => {
            if (!moving.current) schedulePersist();
          }}
          onDragStart={() => {
            moving.current = true;
          }}
          onResizeStart={() => {
            moving.current = true;
          }}
          onDragStop={() => {
            moving.current = false;
            schedulePersist();
          }}
          onResizeStop={() => {
            moving.current = false;
            schedulePersist();
          }}
        >
          {ids.map((id) => {
            const item = items[id];
            if (!item) return null;
            const saved = item.grid;
            const x = saved
              ? Math.round((saved.x * columns) / saved.columns)
              : Math.round((item.rect.x / Math.max(160, size.width)) * columns);
            const w = saved
              ? Math.round((saved.w * columns) / saved.columns)
              : Math.round((item.rect.width / Math.max(160, size.width)) * columns);
            const minW = Math.min(
              columns,
              Math.max(1, Math.ceil(328 / Math.max(160, size.width / columns))),
            );
            return (
              <GridStackItem
                key={id}
                id={String(id)}
                options={{
                  ...(!saved
                    ? { autoPosition: true }
                    : {
                        x: Math.max(0, Math.min(columns - 1, x)),
                        y: saved?.y ?? Math.max(0, Math.round(item.rect.y / 48)),
                      }),
                  w: Math.max(minW, Math.min(columns, w)),
                  h: saved?.h ?? Math.max(4, Math.round(item.rect.height / 48)),
                  minW,
                  minH: 4,
                }}
              >
                <GridPollFrame pollId={id} onExpand={expand} onStep={step} />
              </GridStackItem>
            );
          })}
        </GridStack>
      </div>

      {hasItems ? null : (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-text-muted">
          {total === 0 ? (
            <>
              <p data-testid="workspace-empty">{EMPTY_NO_POLLS}</p>
              <Button
                size="sm"
                className="pointer-events-auto"
                disabled={!canAdd || adding}
                onClick={() => void actions.newPoll()}
              >
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
      <DragOverlay />
      <MinimizedBar />
    </section>
  );
}
