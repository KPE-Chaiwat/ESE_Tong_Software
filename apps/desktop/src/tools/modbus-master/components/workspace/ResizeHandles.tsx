import type { PollId } from "@/shared/ipc/modbus-master.types";
import type { Edges } from "../../lib/drag-math";
import { useRuntime } from "../context";
import { startPointerGesture } from "./pointer-gesture";

interface Handle {
  id: string;
  edges: Edges;
  className: string;
}

const NONE = { left: false, right: false, top: false, bottom: false };

/** Edges are 6 px wide and corners 12 x 12 px, with the matching resize cursors (DES-002 2.10.2). */
const HANDLES: readonly Handle[] = [
  { id: "n", edges: { ...NONE, top: true }, className: "inset-x-3 top-0 h-1.5 cursor-ns-resize" },
  {
    id: "s",
    edges: { ...NONE, bottom: true },
    className: "inset-x-3 bottom-0 h-1.5 cursor-ns-resize",
  },
  { id: "w", edges: { ...NONE, left: true }, className: "inset-y-3 left-0 w-1.5 cursor-ew-resize" },
  {
    id: "e",
    edges: { ...NONE, right: true },
    className: "inset-y-3 right-0 w-1.5 cursor-ew-resize",
  },
  {
    id: "nw",
    edges: { ...NONE, top: true, left: true },
    className: "left-0 top-0 size-3 cursor-nwse-resize",
  },
  {
    id: "ne",
    edges: { ...NONE, top: true, right: true },
    className: "right-0 top-0 size-3 cursor-nesw-resize",
  },
  {
    id: "sw",
    edges: { ...NONE, bottom: true, left: true },
    className: "bottom-0 left-0 size-3 cursor-nesw-resize",
  },
  {
    id: "se",
    edges: { ...NONE, bottom: true, right: true },
    className: "bottom-0 right-0 size-3 cursor-nwse-resize",
  },
];

/** The eight resize handles of a free-layout sub-window. Not rendered when maximized or tiled. */
export function ResizeHandles({ pollId }: { pollId: PollId }) {
  const runtime = useRuntime();
  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.id}
          aria-hidden="true"
          data-resize-handle={h.id}
          className={`absolute z-20 touch-none ${h.className}`}
          onPointerDown={(e) =>
            startPointerGesture({ event: e, runtime, pollId, kind: "resize", edges: h.edges })
          }
        />
      ))}
    </>
  );
}
