import { useRef } from "react";
import { cn } from "@/shared/lib/utils";

interface ColumnResizeHandleProps {
  /** `<table>.<column>`, the key in the layout store. */
  columnId: string;
  label: string;
  width: number;
  minWidth: number;
  onResize: (columnId: string, px: number) => void;
  /** Double-click: fit the column to its visible content. */
  onAutoFit: (columnId: string) => void;
  /** Use the accent focus ring (dark panels). */
  onDark?: boolean;
}

const STEP_PX = 8;

/** 6px drag handle at the right edge of a column header (DES-001 5.3). Also works with the keyboard. */
export function ColumnResizeHandle({
  columnId,
  label,
  width,
  minWidth,
  onResize,
  onAutoFit,
  onDark,
}: ColumnResizeHandleProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      tabIndex={0}
      data-resize-handle={columnId}
      className={cn(
        "absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none outline-none hover:bg-dark/20",
        onDark ? "focus-ring-on-dark hover:bg-light/30" : "focus-ring",
      )}
      onPointerDown={(e) => {
        drag.current = { startX: e.clientX, startWidth: width };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          onResize(columnId, drag.current.startWidth + (e.clientX - drag.current.startX));
        }
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onDoubleClick={() => onAutoFit(columnId)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onResize(columnId, width + STEP_PX);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          onResize(columnId, width - STEP_PX);
        }
      }}
    />
  );
}

/** Rough content width of monospace text: 13px mono is about 8px per character, plus padding. */
export function fitWidth(chars: number, paddingPx = 24): number {
  return Math.ceil(chars * 8 + paddingPx);
}
