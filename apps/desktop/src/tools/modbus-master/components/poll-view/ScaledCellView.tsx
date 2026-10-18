import { cn } from "@/shared/lib/utils";
import { Icon } from "@/shared/ui/icon";
import type { ScaledCell } from "../../lib/scaled";

interface ScaledCellViewProps {
  /** The provider's answer for this row: null when the row has no scale. */
  cell: ScaledCell | null;
  /** The row has no value yet (loading): show the dash. */
  empty: boolean;
  stale: boolean;
  width: number;
}

/**
 * The Scaled cell (DES-003 3.3): the number right-aligned in the data font, then the unit in muted
 * 11px, plus the out-of-range and clamp markers (icon, tint, tooltip and accessible name; never
 * color only). A row with no scale shows "—".
 */
export function ScaledCellView({ cell: provided, empty, stale, width }: ScaledCellViewProps) {
  const cell = empty ? null : provided;
  const flagged = cell?.marker === "outOfRange";
  return (
    <div
      role="gridcell"
      data-cell="scaled"
      data-marker={cell?.marker}
      title={cell?.tooltip ?? undefined}
      aria-label={cell?.label}
      style={{ width }}
      className={cn(
        "flex items-center justify-end gap-1 truncate px-2 font-mono text-[13px] leading-6",
        (stale || cell === null) && "text-text-muted",
        flagged && "bg-warning-tint",
      )}
    >
      {cell === null ? (
        "—"
      ) : (
        <>
          {cell.marker === "outOfRange" ? (
            <Icon name="triangle-alert" className="size-3 text-dark" />
          ) : null}
          {cell.marker === "clamped-low" ? (
            <Icon name="arrow-down-to-line" className="size-3 text-dark" />
          ) : null}
          {cell.marker === "clamped-high" ? (
            <Icon name="arrow-up-to-line" className="size-3 text-dark" />
          ) : null}
          <span>{cell.text}</span>
          {cell.unit ? <span className="ml-1 text-[11px] text-dark/75">{cell.unit}</span> : null}
        </>
      )}
    </div>
  );
}
