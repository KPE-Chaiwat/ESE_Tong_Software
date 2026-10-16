import { useRef } from "react";
import {
  MAX_TRAFFIC_HEIGHT_PCT,
  minTrafficHeightPct,
  SPLITTER_STEP_PX,
} from "../../store/layout.logic";
import { useLayout, useRuntime } from "../context";

/**
 * Handle between the data card and the traffic panel. Drag it, or focus it and press Up/Down
 * (16px per press). Double-click resets the panel to 35% (DES-001 5.3).
 */
export function Splitter() {
  const layout = useRuntime().stores.layout;
  const pct = useLayout((s) => s.trafficHeightPct);
  const viewportHeight = useLayout((s) => s.viewportHeight);
  const drag = useRef<{ startY: number; startPx: number } | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize traffic panel"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={Math.round(minTrafficHeightPct(viewportHeight))}
      aria-valuemax={MAX_TRAFFIC_HEIGHT_PCT}
      tabIndex={0}
      data-testid="splitter"
      className="h-2 shrink-0 cursor-row-resize touch-none rounded-pill bg-border outline-none hover:bg-dark/25 focus-ring"
      onPointerDown={(e) => {
        const { trafficHeightPct, viewportHeight } = layout.getState();
        drag.current = { startY: e.clientY, startPx: (trafficHeightPct / 100) * viewportHeight };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          // Dragging up makes the traffic panel taller.
          layout
            .getState()
            .setTrafficHeightPx(drag.current.startPx - (e.clientY - drag.current.startY));
        }
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onDoubleClick={() => layout.getState().resetTrafficHeight()}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          layout.getState().nudgeTrafficHeight(SPLITTER_STEP_PX);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          layout.getState().nudgeTrafficHeight(-SPLITTER_STEP_PX);
        }
      }}
    />
  );
}
