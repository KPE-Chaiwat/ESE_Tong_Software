import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import { toDisplayAddress } from "../../lib/address";
import { formatBit, formatValue } from "../../lib/format";
import { COLUMN_MIN_WIDTHS } from "../../store/layout.logic";
import { ColumnResizeHandle, fitWidth } from "../ColumnResizeHandle";
import {
  useConfig,
  useController,
  useLayout,
  usePollData,
  useRuntime,
  useSelection,
} from "../context";

export const ROW_HEIGHT = 24;
const DEFAULT_ADDRESS_WIDTH = 140;
const DEFAULT_VALUE_WIDTH = 200;

interface RowProps {
  index: number;
  top: number;
  address: number;
  base: 0 | 1;
  format: "unsigned" | "signed" | "hex" | "binary";
  bits: boolean;
  loading: boolean;
  stale: boolean;
  addressWidth: number;
  valueWidth: number;
  onClick: (index: number, e: React.MouseEvent) => void;
  onDoubleClick: (index: number) => void;
}

/** One row. It selects only its own value, so an update that changes other rows leaves it alone. */
const Row = memo(function Row({
  index,
  top,
  address,
  base,
  format,
  bits,
  loading,
  stale,
  addressWidth,
  valueWidth,
  onClick,
  onDoubleClick,
}: RowProps) {
  const raw = usePollData((s) => s.values?.[index]);
  const selected = useSelection((s) => s.selected.has(index));
  const focused = useSelection((s) => s.focused === index);
  const shown =
    loading || raw === undefined ? "—" : bits ? formatBit(raw) : formatValue(raw, format);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the grid.
    <div
      role="row"
      id={`data-row-${index}`}
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-focused={focused || undefined}
      onClick={(e) => onClick(index, e)}
      onDoubleClick={() => onDoubleClick(index)}
      style={{ position: "absolute", top, height: ROW_HEIGHT, left: 0, display: "flex" }}
      className={cn(
        "border-l-[3px] font-mono text-[13px] hover:bg-neutral-tint",
        selected ? "border-dark bg-selected" : "border-transparent",
        focused && "outline outline-1 -outline-offset-1 outline-dark/40",
      )}
    >
      <div
        role="gridcell"
        className="truncate px-2 text-right leading-6"
        style={{ width: addressWidth }}
      >
        {toDisplayAddress(address + index, base)}
      </div>
      <div
        role="gridcell"
        className={cn(
          "truncate px-2 text-right leading-6",
          (stale || loading) && "text-text-muted",
        )}
        style={{ width: valueWidth }}
      >
        {shown}
      </div>
    </div>
  );
});

interface DataTableProps {
  rowCount: number;
  startAddress: number;
  loading: boolean;
  stale: boolean;
  bits: boolean;
}

/** What the grid shows, for tests and tools: `data-status` on the grid element. */
export type GridStatus = "live" | "stale" | "loading";

/** Virtualized two-column grid: Address and Value (DES-001 S1). */
export function DataTable({ rowCount, startAddress, loading, stale, bits }: DataTableProps) {
  const runtime = useRuntime();
  const controller = useController();
  const selection = runtime.stores.selection;
  const layout = runtime.stores.layout;
  const base = useConfig((s) => s.display.addressBase);
  const format = useConfig((s) => s.display.format);
  const widths = useLayout((s) => s.columnWidths);
  const addressWidth = widths["data.address"] ?? DEFAULT_ADDRESS_WIDTH;
  const valueWidth = widths["data.value"] ?? DEFAULT_VALUE_WIDTH;
  const focused = useSelection((s) => s.focused);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  useEffect(() => {
    selection.getState().setRowCount(rowCount);
  }, [rowCount, selection]);

  useEffect(() => {
    if (focused !== null) virtualizer.scrollToIndex(focused, { align: "auto" });
  }, [focused, virtualizer]);

  const autoFit = (id: string) => {
    const state = runtime.stores.pollData.getState();
    const visible = virtualizer.getVirtualItems();
    if (id === "data.address") {
      const longest = Math.max(
        "Address (0-based)".length,
        ...visible.map((v) => String(toDisplayAddress(startAddress + v.index, base)).length),
      );
      layout.getState().setColumnWidth(id, fitWidth(longest));
    } else {
      const longest = Math.max(
        "Value".length,
        ...visible.map((v) => {
          const raw = state.values?.[v.index];
          if (raw === undefined) return 1;
          return (bits ? formatBit(raw) : formatValue(raw, format)).length;
        }),
      );
      layout.getState().setColumnWidth(id, fitWidth(longest));
    }
  };

  // Stable identities: a new function would defeat the memo of every row on each update.
  const onRowClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      selection.getState().click(index, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      scrollRef.current?.focus();
    },
    [selection],
  );
  const onRowDoubleClick = useCallback((i: number) => controller.openWriteForRow(i), [controller]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const sel = selection.getState();
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight || 240) / ROW_HEIGHT) - 1);
    const mods = { shift: e.shiftKey };
    const ctrl = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "ArrowDown":
        sel.move(1, mods);
        break;
      case "ArrowUp":
        sel.move(-1, mods);
        break;
      case "PageDown":
        sel.move(page, mods);
        break;
      case "PageUp":
        sel.move(-page, mods);
        break;
      case "Home":
        sel.moveTo(0, mods);
        break;
      case "End":
        sel.moveTo(rowCount - 1, mods);
        break;
      case "Enter":
        if (sel.focused !== null) controller.openWriteForRow(sel.focused);
        break;
      case "Escape":
        sel.clear();
        break;
      case "a":
      case "A":
        if (!ctrl) return;
        sel.selectAll(rowCount);
        break;
      case "c":
      case "C":
        if (!ctrl) return;
        void controller.copyRows();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const baseLabel = base === 0 ? "Address (0-based)" : "Address (1-based)";
  const totalWidth = addressWidth + valueWidth + 3;

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label="Register values"
      aria-rowcount={rowCount + 1}
      aria-multiselectable="true"
      aria-activedescendant={focused === null ? undefined : `data-row-${focused}`}
      tabIndex={0}
      data-status={loading ? "loading" : stale ? "stale" : "live"}
      data-virtual-viewport=""
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 overflow-auto rounded-md border outline-none focus-ring"
    >
      <div style={{ width: totalWidth }}>
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-10 flex border-b bg-card text-xs font-semibold"
          style={{ height: ROW_HEIGHT, paddingLeft: 3 }}
        >
          {(
            [
              ["data.address", baseLabel, addressWidth],
              ["data.value", "Value", valueWidth],
            ] as const
          ).map(([id, label, width]) => (
            <div
              key={id}
              role="columnheader"
              className="relative truncate px-2 text-right leading-6"
              style={{ width }}
            >
              {label}
              <ColumnResizeHandle
                columnId={id}
                label={label}
                width={width}
                minWidth={COLUMN_MIN_WIDTHS[id] ?? 24}
                onResize={(cid, px) => layout.getState().setColumnWidth(cid, px)}
                onAutoFit={autoFit}
              />
            </div>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => (
            <Row
              key={item.key}
              index={item.index}
              top={item.start}
              address={startAddress}
              base={base}
              format={format}
              bits={bits}
              loading={loading}
              stale={stale}
              addressWidth={addressWidth}
              valueWidth={valueWidth}
              onClick={onRowClick}
              onDoubleClick={onRowDoubleClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
