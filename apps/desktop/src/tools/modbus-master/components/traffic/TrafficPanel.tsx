import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { Checkbox, Label } from "@/shared/ui/input";
import { formatHexBytes, formatHexDump, formatIsoWithOffset, formatTime } from "../../lib/format";
import { COLUMN_MIN_WIDTHS } from "../../store/layout.logic";
import { frameInfo } from "../../store/traffic.logic";
import { ColumnResizeHandle, fitWidth } from "../ColumnResizeHandle";
import { useController, useLayout, useRuntime, useTraffic } from "../context";

export const TRAFFIC_ROW_HEIGHT = 22;
export const TRAFFIC_HEADER_HEIGHT = 36;

const COLUMNS = [
  { id: "traffic.seq", label: "#", width: 64, align: "text-right" },
  { id: "traffic.time", label: "Time", width: 112, align: "" },
  { id: "traffic.dir", label: "Dir", width: 64, align: "" },
  { id: "traffic.len", label: "Len", width: 48, align: "text-right" },
  { id: "traffic.bytes", label: "Bytes", width: 360, align: "" },
  { id: "traffic.info", label: "Info", width: 280, align: "" },
] as const;

type ColumnId = (typeof COLUMNS)[number]["id"];

interface RowProps {
  frame: TrafficFrame;
  index: number;
  top: number;
  widths: Record<ColumnId, number>;
  onSelect: (seq: number) => void;
}

const Row = memo(function Row({ frame, index, top, widths, onSelect }: RowProps) {
  const selected = useTraffic((s) => s.selectedSeq === frame.seq);
  const isException = frame.exceptionCode !== null;
  const tx = frame.direction === "tx";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the list.
    <div
      role="row"
      id={`frame-${frame.seq}`}
      aria-rowindex={index + 2}
      aria-selected={selected}
      onClick={() => onSelect(frame.seq)}
      style={{ position: "absolute", top, height: TRAFFIC_ROW_HEIGHT, left: 0, display: "flex" }}
      className={cn(
        "border-l-[3px] font-mono text-xs leading-[22px]",
        selected ? "border-accent bg-light/15" : "border-transparent hover:bg-light/10",
      )}
    >
      <div
        role="gridcell"
        className="truncate px-2 text-right"
        style={{ width: widths["traffic.seq"] }}
      >
        {frame.seq}
      </div>
      <div
        role="gridcell"
        className="truncate px-2"
        style={{ width: widths["traffic.time"] }}
        title={formatIsoWithOffset(frame.at)}
      >
        {formatTime(frame.at)}
      </div>
      <div role="gridcell" className="truncate px-2" style={{ width: widths["traffic.dir"] }}>
        {tx ? "→ TX" : "← RX"}
      </div>
      <div
        role="gridcell"
        className="truncate px-2 text-right"
        style={{ width: widths["traffic.len"] }}
      >
        {frame.bytes.length}
      </div>
      <div role="gridcell" className="truncate px-2" style={{ width: widths["traffic.bytes"] }}>
        {formatHexBytes(frame.bytes)}
      </div>
      <div
        role="gridcell"
        className="flex items-center gap-1 truncate px-2"
        style={{ width: widths["traffic.info"] }}
      >
        {isException ? <Icon name="octagon-x" tone="error" className="size-3.5" /> : null}
        <span className="truncate">{frameInfo(frame)}</span>
      </div>
    </div>
  );
});

function Counter({ label, value, id }: { label: string; value: number; id: string }) {
  return (
    <span className="whitespace-nowrap text-xs">
      {label}{" "}
      <span data-testid={`traffic-counter-${id}`} className="font-mono text-[13px] font-semibold">
        {value}
      </span>
    </span>
  );
}

/** The dark traffic panel: counters, controls, frame list and the detail strip (DES-001 S1). */
export function TrafficPanel() {
  const runtime = useRuntime();
  const controller = useController();
  const layout = runtime.stores.layout;
  const traffic = runtime.stores.traffic;
  const collapsed = useLayout((s) => s.trafficCollapsed);
  const columnWidths = useLayout((s) => s.columnWidths);
  const counters = useTraffic((s) => s.counters);
  const autoScroll = useTraffic((s) => s.autoScroll);
  const version = useTraffic((s) => s.version);
  const clearedAt = useTraffic((s) => s.clearedAt);
  const selectedSeq = useTraffic((s) => s.selectedSeq);

  // Memoized so the rows (React.memo) are not re-rendered by a new object on every batch.
  const widths = useMemo(
    () =>
      Object.fromEntries(COLUMNS.map((c) => [c.id, columnWidths[c.id] ?? c.width])) as Record<
        ColumnId,
        number
      >,
    [columnWidths],
  );
  const totalWidth = COLUMNS.reduce((sum, c) => sum + widths[c.id], 3);

  const frames = traffic.getState().frames;
  const count = frames.size;
  void version; // re-render once per append batch

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TRAFFIC_ROW_HEIGHT,
    overscan: 12,
  });

  // Follow the newest frame only while auto-scroll is on.
  useEffect(() => {
    void version; // a full ring buffer keeps its size, so the batch counter drives this effect
    if (autoScroll && count > 0 && !collapsed) {
      virtualizer.scrollToIndex(count - 1, { align: "end" });
    }
  }, [autoScroll, count, version, collapsed, virtualizer]);

  // The frame at the top of the view while Auto-scroll is off. Rows are addressed by ring index,
  // so once the ring is full every batch shifts them; the view is put back on this frame so it
  // does not move under the reader (REV-002 m4).
  const anchor = useRef<{ seq: number; offset: number } | null>(null);
  const recordAnchor = (el: HTMLElement) => {
    const index = Math.floor(el.scrollTop / TRAFFIC_ROW_HEIGHT);
    const frame = traffic.getState().frames.get(index);
    anchor.current = frame
      ? { seq: frame.seq, offset: el.scrollTop - index * TRAFFIC_ROW_HEIGHT }
      : null;
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (autoScroll) {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance <= TRAFFIC_ROW_HEIGHT * 2) return;
      traffic.getState().setAutoScroll(false);
    }
    recordAnchor(el);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a batch arrives or the mode changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (autoScroll || !el) {
      anchor.current = null;
      return;
    }
    const held = anchor.current;
    if (!held) {
      recordAnchor(el);
      return;
    }
    const index = traffic.getState().indexOfSeq(held.seq);
    const wanted = index >= 0 ? index * TRAFFIC_ROW_HEIGHT + held.offset : 0;
    if (Math.abs(el.scrollTop - wanted) > 0.5) el.scrollTop = wanted;
  }, [autoScroll, version]);

  const onSelect = useCallback(
    (seq: number) => {
      traffic.getState().select(seq);
      scrollRef.current?.focus();
    },
    [traffic],
  );

  const selectedIndex = selectedSeq === null ? -1 : traffic.getState().indexOfSeq(selectedSeq);
  const selectedFrame = selectedIndex >= 0 ? frames.get(selectedIndex) : undefined;

  const moveSelection = (delta: number, absolute?: number) => {
    if (count === 0) return;
    const from = selectedIndex >= 0 ? selectedIndex : delta > 0 ? -1 : count;
    const next = absolute ?? Math.min(count - 1, Math.max(0, from + delta));
    const frame = frames.get(next);
    if (frame) {
      traffic.getState().select(frame.seq);
      virtualizer.scrollToIndex(next, { align: "auto" });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const page = Math.max(
      1,
      Math.floor((scrollRef.current?.clientHeight || 220) / TRAFFIC_ROW_HEIGHT) - 1,
    );
    switch (e.key) {
      case "ArrowDown":
        moveSelection(1);
        break;
      case "ArrowUp":
        moveSelection(-1);
        break;
      case "PageDown":
        moveSelection(page);
        break;
      case "PageUp":
        moveSelection(-page);
        break;
      case "Home":
        moveSelection(0, 0);
        break;
      case "End":
        moveSelection(0, count - 1);
        break;
      case "Escape":
        traffic.getState().select(null);
        break;
      case "c":
      case "C":
        if (!(e.ctrlKey || e.metaKey)) return;
        void controller.copyFrames();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const autoFit = (id: string) => {
    const visible = virtualizer.getVirtualItems();
    let longest = 4;
    for (const item of visible) {
      const frame = frames.get(item.index);
      if (!frame) continue;
      const text =
        id === "traffic.bytes"
          ? formatHexBytes(frame.bytes)
          : id === "traffic.info"
            ? frameInfo(frame)
            : id === "traffic.time"
              ? formatTime(frame.at)
              : id === "traffic.seq"
                ? String(frame.seq)
                : id === "traffic.len"
                  ? String(frame.bytes.length)
                  : "→ TX";
      longest = Math.max(longest, text.length);
    }
    layout.getState().setColumnWidth(id, fitWidth(longest));
  };

  return (
    <section
      aria-label="Communication Traffic"
      data-testid="traffic-panel"
      className="flex min-h-0 flex-col bg-panel text-panel-foreground"
      style={collapsed ? { height: TRAFFIC_HEADER_HEIGHT } : { height: "100%" }}
    >
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3"
        style={{ minHeight: TRAFFIC_HEADER_HEIGHT }}
      >
        <h2 className="text-sm font-semibold">Communication Traffic</h2>
        <Counter id="requests" label="Requests" value={counters.requests} />
        <Counter id="responses" label="Responses" value={counters.responses} />
        <Counter id="errors" label="Errors" value={counters.errors} />
        <Counter id="timeouts" label="Timeouts" value={counters.timeouts} />
        <div className="ml-auto flex items-center gap-2">
          {collapsed ? null : (
            <>
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="traffic-autoscroll"
                  checked={autoScroll}
                  onChange={(e) => traffic.getState().setAutoScroll(e.target.checked)}
                  className="focus-ring-on-dark"
                />
                <Label htmlFor="traffic-autoscroll" className="font-normal">
                  Auto-scroll
                </Label>
              </div>
              <PanelButton
                disabled={selectedSeq === null}
                title={
                  selectedSeq === null
                    ? "Select a frame to copy it"
                    : "Copy the selected frame (Ctrl+C)"
                }
                onClick={() => void controller.copyFrames()}
              >
                Copy
              </PanelButton>
              <PanelButton title="Clear (Ctrl+Shift+K)" onClick={() => traffic.getState().clear()}>
                Clear
              </PanelButton>
              <PanelButton onClick={() => void traffic.getState().resetCounters()}>
                Reset counters
              </PanelButton>
            </>
          )}
          <button
            type="button"
            aria-label={collapsed ? "Expand traffic panel" : "Collapse traffic panel"}
            aria-expanded={!collapsed}
            title="Collapse or expand (Ctrl+J)"
            onClick={() => layout.getState().toggleTraffic()}
            className="inline-flex size-6 items-center justify-center rounded-pill outline-none hover:bg-light/15 focus-ring-on-dark"
          >
            {collapsed ? (
              <ChevronUp aria-hidden="true" className="size-4" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <>
          <div
            ref={scrollRef}
            role="grid"
            aria-label="Frames"
            aria-rowcount={count + 1}
            aria-activedescendant={selectedSeq === null ? undefined : `frame-${selectedSeq}`}
            tabIndex={0}
            data-virtual-viewport=""
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            className="relative min-h-0 flex-1 overflow-auto outline-none focus-ring-on-dark"
          >
            <div style={{ width: totalWidth }}>
              <div
                role="row"
                aria-rowindex={1}
                className="sticky top-0 z-10 flex border-b border-light/20 bg-panel text-xs font-semibold"
                style={{ height: TRAFFIC_ROW_HEIGHT, paddingLeft: 3 }}
              >
                {COLUMNS.map((c) => (
                  <div
                    key={c.id}
                    role="columnheader"
                    className={cn("relative truncate px-2 leading-[22px]", c.align)}
                    style={{ width: widths[c.id] }}
                  >
                    {c.label}
                    <ColumnResizeHandle
                      columnId={c.id}
                      label={c.label}
                      width={widths[c.id]}
                      minWidth={COLUMN_MIN_WIDTHS[c.id] ?? 24}
                      onResize={(cid, px) => layout.getState().setColumnWidth(cid, px)}
                      onAutoFit={autoFit}
                      onDark
                    />
                  </div>
                ))}
              </div>
              {count === 0 ? (
                <p className="px-3 py-4 text-sm text-light/75" data-testid="traffic-empty">
                  {clearedAt === null
                    ? "No frames yet. Requests and responses appear here."
                    : `Log cleared at ${formatTime(clearedAt)}. New frames appear here.`}
                </p>
              ) : (
                <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                  {virtualizer.getVirtualItems().map((item) => {
                    const frame = frames.get(item.index);
                    return frame ? (
                      <Row
                        key={frame.seq}
                        frame={frame}
                        index={item.index}
                        top={item.start}
                        widths={widths}
                        onSelect={onSelect}
                      />
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </div>
          {selectedFrame ? (
            <div
              data-testid="frame-detail"
              className="flex max-h-32 shrink-0 gap-3 overflow-auto border-t border-light/20 px-3 py-2"
            >
              <pre className="min-w-0 flex-1 font-mono text-xs leading-5">
                {formatHexDump(selectedFrame.bytes).join("\n")}
              </pre>
              <PanelButton onClick={() => void controller.copyFrameBytes()}>Copy bytes</PanelButton>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function PanelButton(props: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      {...props}
      className="h-6 border-light/40 bg-transparent px-3 text-xs text-light hover:bg-light/15 focus-ring-on-dark"
    />
  );
}
