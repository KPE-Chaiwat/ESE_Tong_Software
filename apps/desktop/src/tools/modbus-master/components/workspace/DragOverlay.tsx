import { useStore } from "zustand";
import type { Rect } from "@/shared/lib/layout-math";
import type { Guide } from "../../lib/drag-math";
import { useRuntime } from "../context";

/** The drop preview look (DES-002 5): accent at 25% with a 2 px dashed dark border. */
const PREVIEW =
  "pointer-events-none absolute rounded-xl border-2 border-dashed border-dark bg-accent/25";

function rectStyle(r: Rect, z: number) {
  return { left: r.x, top: r.y, width: r.width, height: r.height, zIndex: z };
}

/**
 * Everything a drag draws besides the dragged frame (DES-002 2.10): the snap guides, the snap zone
 * preview, the tile slot indicator and the outline of the keyboard Move and Size modes. It is the
 * only component besides the dragged frame that subscribes to the drag store, and it is
 * `aria-hidden`: the result of a drag is announced in the live region.
 */
export function DragOverlay() {
  const runtime = useRuntime();
  const drag = runtime.stores.drag;
  const kind = useStore(drag, (s) => s.kind);
  const pollId = useStore(drag, (s) => s.pollId);
  const zoneRect = useStore(drag, (s) => s.zoneRect);
  const slotRect = useStore(drag, (s) => s.slotRect);
  const listPlace = useStore(drag, (s) => s.listPlace);
  const outline = useStore(drag, (s) =>
    s.kind === "keyboardMove" || s.kind === "keyboardSize" ? s.currentRect : null,
  );
  const guides = useStore(drag, (s) => s.guides);
  const draggedZ = useStore(runtime.stores.workspace, (s) =>
    pollId !== null ? (s.items[pollId]?.z ?? 1) : 1,
  );
  const area = useStore(runtime.stores.workspace, (s) => s.size);

  if (kind === "none") return null;
  const under = Math.max(0, draggedZ - 1);

  return (
    <div
      aria-hidden="true"
      data-slot="drag-overlay"
      className="pointer-events-none absolute inset-0"
    >
      {zoneRect ? (
        <div data-testid="zone-preview" className={PREVIEW} style={rectStyle(zoneRect, under)} />
      ) : null}
      {slotRect ? (
        <div data-testid="slot-indicator" className={PREVIEW} style={rectStyle(slotRect, under)} />
      ) : null}
      {listPlace ? (
        // A row dragged from the poll list: where the sub-window would go (DES-002 2.10.7).
        <div
          data-testid="list-preview"
          data-place={listPlace.kind}
          className={PREVIEW}
          style={rectStyle(listPlace.rect, 100000)}
        />
      ) : null}
      {outline ? (
        <div
          data-testid="keyboard-outline"
          className="pointer-events-none absolute rounded-xl border-2 border-dashed border-dark"
          style={rectStyle(outline, 100000)}
        />
      ) : null}
      {guides.map((g) => (
        <GuideLine key={`${g.axis}${g.at}`} guide={g} width={area.width} height={area.height} />
      ))}
    </div>
  );
}

/** A 1 px dashed line along the full length of the workspace (DES-002 2.10.3). */
function GuideLine({ guide, width, height }: { guide: Guide; width: number; height: number }) {
  const style =
    guide.axis === "x"
      ? { left: guide.at, top: 0, height, width: 0, borderLeftWidth: 1 }
      : { top: guide.at, left: 0, width, height: 0, borderTopWidth: 1 };
  return (
    <div
      data-testid="snap-guide"
      data-axis={guide.axis}
      className="pointer-events-none absolute border-dashed border-dark"
      style={{ ...style, zIndex: 100001 }}
    />
  );
}
