import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
import { shortcutKeyOf } from "@/shared/lib/shortcut-key";
import { cn } from "@/shared/lib/utils";
import { FieldMessage } from "@/shared/ui/field-message";
import { Icon } from "@/shared/ui/icon";
import { ContextMenu, type MenuEntry } from "@/shared/ui/menu";
import { toDisplayAddress } from "../../lib/address";
import { rangesContain } from "../../lib/address-ranges";
import { matchRule } from "../../lib/color-rules";
import { combinedText, rawWordsText } from "../../lib/combined";
import { formatBit, formatValue, VALUE_FORMAT_LABELS } from "../../lib/format";
import { QUICK_FORMATS, quickFormatState } from "../../lib/format-dialog-model";
import { NO_SCALING_FOR_COMBINED } from "../../lib/format-messages";
import { type FormatRow, formatCode, formatName, rowAt } from "../../lib/format-overrides";
import { registerLines } from "../../lib/register-lines";
import { groupValueOfWords } from "../../lib/row-value";
import { rawToX } from "../../lib/scale-math";
import { SCALE_REGISTERS_ONLY } from "../../lib/scale-presets";
import { effectiveValueColumns, type ScaledProvider, scaleAvailable } from "../../lib/scaled";
import { selectAliasAt, selectEditingAddress } from "../../store/alias.store";
import { selectValueAt, selectWordsKey } from "../../store/poll-data.store";
import { overridesTouching } from "../../store/poll-scale.logic";
import {
  type ColumnId,
  POLL_COLUMN_MIN_WIDTHS,
  selectIsFocused,
  selectIsSelected,
} from "../../store/poll-view-ui.store";
import { registerColorDraft, registerRuleDraft } from "../../store/rule-draft";
import { ColumnResizeHandle, fitWidth } from "../ColumnResizeHandle";
import { usePoll, usePollAlias, usePollData, usePollUi, usePollViewRuntime } from "./context";
import { BITS_FORMAT_TOOLTIP, NO_SCALE_TITLE } from "./poll-view.logic";
import { RuleMarker, ruleClass, ruleStyle } from "./RuleMarker";
import { ScaledCellView } from "./ScaledCellView";

const EMPTY_RULES: readonly ValueColorRule[] = [];
export const ROW_HEIGHT = 24;

/** The address cell text of a row: `4`, or `2–3` for a group (en dash, display base). */
export function rowRangeText(row: FormatRow, base: 0 | 1): string {
  return row.address === row.endAddress
    ? String(toDisplayAddress(row.address, base))
    : `${toDisplayAddress(row.address, base)}–${toDisplayAddress(row.endAddress, base)}`;
}

interface RowProps {
  index: number;
  top: number;
  row: FormatRow;
  displayAddress: number;
  continuation: boolean;
  start: number;
  quantity: number;
  base: 0 | 1;
  bits: boolean;
  loading: boolean;
  stale: boolean;
  columns: readonly ColumnId[];
  widths: Record<ColumnId, number>;
  scaled: ScaledProvider;
  gridId: string;
  rules: readonly ValueColorRule[];
  current: boolean;
  onRowClick: (address: number, e: ReactMouseEvent) => void;
  onRowDoubleClick: (address: number, e: ReactMouseEvent) => void;
  onRowContextMenu: (address: number, e: ReactMouseEvent) => void;
  onEditorDone: (refocus: boolean) => void;
  onInspect: (address: number) => void;
}

/** The inline alias editor (DES-002 2.3.5). */
export function AliasEditor({
  address,
  base,
  width,
  onDone,
}: {
  address: number;
  base: 0 | 1;
  width: number;
  onDone: (refocus: boolean) => void;
}) {
  const { stores } = usePollViewRuntime();
  const editing = usePollAlias((s) => s.editing);
  const messageId = useId();
  const ref = useRef<HTMLInputElement>(null);

  // The editor of the next row mounts a fresh input: focus it with its text selected.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!editing || editing.address !== address) return null;
  const alias = stores.alias.getState();

  const commit = (key: "enter" | "shiftEnter" | "tab" | "blur") => {
    const result = alias.commit(key);
    if (result === "end") onDone(key !== "blur");
  };

  return (
    <div role="gridcell" data-cell="alias" style={{ width }} className="relative px-1">
      <input
        ref={ref}
        value={editing.text}
        aria-label={`Alias for address ${toDisplayAddress(address, base)}`}
        aria-invalid={editing.error ? true : undefined}
        aria-describedby={editing.error ? messageId : undefined}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => alias.setText(e.target.value)}
        onBlur={() => {
          // Moving to the next row's editor re-renders this one away: only a real blur commits.
          // Read the current state: the render's copy is old by the time the blur fires (REV-005 n-2).
          if (stores.alias.getState().editing?.address === address) commit("blur");
        }}
        onKeyDown={(e) => {
          // Keys of the editor are not the grid's keys (arrows move the caret, not the row).
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.shiftKey ? "shiftEnter" : "enter");
          } else if (e.key === "Tab") {
            e.preventDefault();
            commit("tab");
          } else if (e.key === "Escape") {
            e.preventDefault();
            alias.cancel();
            onDone(true);
          }
        }}
        className="h-5 w-full rounded-md border-[1.5px] border-dark bg-card px-1.5 text-[13.5px] outline-none aria-invalid:border-error"
      />
      {editing.error ? (
        <FieldMessage
          kind="error"
          id={messageId}
          className="absolute left-1 top-full z-20 mt-0.5 w-max max-w-[320px] rounded-md border bg-card px-2 py-1 shadow-md"
        >
          {editing.error}
        </FieldMessage>
      ) : null}
    </div>
  );
}

/**
 * One visible register line; combined values decode only on the group's first line. It selects
 * only its own value or words, alias and flags, so an update that changes other rows leaves it alone.
 */
const Row = memo(function Row({
  index,
  top,
  row,
  displayAddress,
  continuation,
  start,
  quantity,
  base,
  bits,
  loading,
  stale,
  columns,
  widths,
  scaled,
  gridId,
  rules,
  current,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  onEditorDone,
  onInspect,
}: RowProps) {
  const address = row.address;
  const group = row.width > 1;
  const offset = address - start;
  // A group row reads its words, not its first register: -1 never has a value.
  const raw = usePollData(selectValueAt(group ? -1 : offset));
  const wordsKey = usePollData(
    selectWordsKey(offset, group ? row.endAddress - row.address + 1 : 0, quantity),
  );
  const alias = usePollAlias(selectAliasAt(displayAddress));
  const editing = usePollAlias((s) => s.editing?.address === displayAddress);
  const selected = usePollUi(selectIsSelected(displayAddress));
  const focused = usePollUi(selectIsFocused(address));

  // ---- a group row: the value of its words ----
  const words = !group || loading || wordsKey === null ? null : wordsKey.split(",").map(Number);
  const groupValue = group && !continuation ? groupValueOfWords(row, words) : null;
  const groupNumber =
    groupValue?.value.kind === "integer" || groupValue?.value.kind === "float"
      ? groupValue.value.value
      : null;

  // ---- a 16-bit row: the register in the format of the row ----
  const empty = group
    ? !continuation && groupValue?.value.kind === "missing"
    : loading || raw === undefined;
  const cell = group || empty || raw === undefined ? null : scaled(raw, address);
  // The override marker belongs to the address, so it shows while there is no value yet too.
  const overrideMarker = group ? null : (scaled.override?.(address) ?? cell?.override ?? null);
  const rawShown = continuation
    ? "--"
    : group
      ? combinedText(groupValue?.value ?? { kind: "missing" })
      : empty || raw === undefined
        ? "—"
        : bits
          ? formatBit(raw)
          : formatValue(raw, row.format);

  const rawNumeric =
    group || empty || raw === undefined
      ? null
      : bits
        ? raw
          ? 1
          : 0
        : rawToX(raw, row.format === "signed");
  const scaledNumeric = cell?.numeric ?? null;
  const visibleScaled = cell?.text === "too large" ? null : scaledNumeric;
  const match = (column: "Raw" | "Scaled") =>
    matchRule(rules, {
      address,
      raw: rawNumeric,
      scaled: scaledNumeric,
      displayed: column === "Raw" ? rawNumeric : visibleScaled,
      column,
      current: current && !stale && !empty,
      format: row.format,
    });
  const rawMatch = continuation
    ? null
    : group
      ? matchRule(rules, {
          address,
          raw: groupNumber,
          scaled: null,
          displayed: groupNumber,
          column: "Interpreted",
          current: current && !stale && !empty,
          format: row.format,
        })
      : match("Raw");
  const scaledMatch = group ? null : match("Scaled");
  const rangeText = rowRangeText(row, base);
  const incompleteText =
    groupValue?.value.kind === "incomplete"
      ? `Needs ${row.width} registers; only ${groupValue.value.available} available.`
      : null;
  const nonfinite = groupValue?.value.kind === "float" && !Number.isFinite(groupValue.value.value);
  const wordsTitle =
    group && groupValue && groupValue.words.length > 0
      ? `Raw words: ${rawWordsText(groupValue.words)}`
      : undefined;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the grid.
    <div
      role="row"
      id={`${gridId}-row-${index}`}
      data-row={index}
      data-row-kind={continuation ? "continuation" : group ? "group" : "word"}
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-focused={focused || undefined}
      onClick={(e) => onRowClick(displayAddress, e)}
      onDoubleClick={(e) => onRowDoubleClick(displayAddress, e)}
      onContextMenu={(e) => onRowContextMenu(displayAddress, e)}
      style={{ position: "absolute", top, height: ROW_HEIGHT, left: 0, display: "flex" }}
      className={cn(
        "border-l-[3px] text-[13px] hover:bg-neutral-tint",
        selected ? "border-dark bg-selected" : "border-transparent",
        focused && "outline outline-1 -outline-offset-1 outline-dark/40",
      )}
    >
      {columns.map((id) => {
        const width = widths[id];
        if (id === "alias") {
          return editing ? (
            <AliasEditor
              key={id}
              address={displayAddress}
              base={base}
              width={width}
              onDone={onEditorDone}
            />
          ) : (
            <div
              key={id}
              role="gridcell"
              data-cell="alias"
              style={{ width }}
              title={alias}
              className="truncate px-2 text-left text-[13.5px] leading-6 text-dark"
            >
              {alias ? alias : focused ? <span className="text-text-muted">Alias…</span> : null}
            </div>
          );
        }
        if (id === "address") {
          return (
            <div
              key={id}
              role="gridcell"
              data-cell="address"
              style={{ width }}
              {...(continuation
                ? {
                    "aria-label": `Register ${toDisplayAddress(displayAddress, base)}; continuation of value at register ${toDisplayAddress(row.address, base)}`,
                  }
                : {})}
              className="flex select-none items-center justify-end gap-1 truncate px-2 font-mono leading-6"
            >
              {overrideMarker ? (
                <span role="img" title={overrideMarker.tooltip} aria-label={overrideMarker.tooltip}>
                  <Icon name="sliders-horizontal" className="size-3 text-dark/75" />
                </span>
              ) : null}
              {toDisplayAddress(displayAddress, base)}
            </div>
          );
        }
        if (id === "format") {
          return (
            <div
              key={id}
              role="gridcell"
              data-cell="format"
              style={{ width }}
              aria-label={
                continuation
                  ? `Continuation of ${formatName(row.format, row.order)} at register ${toDisplayAddress(row.address, base)}`
                  : formatName(row.format, row.order)
              }
              title={
                continuation
                  ? `Continuation of ${formatName(row.format, row.order)} at register ${toDisplayAddress(row.address, base)}`
                  : formatName(row.format, row.order)
              }
              className={cn(
                "select-none truncate px-2 text-left font-mono leading-6",
                continuation && "text-text-muted",
              )}
            >
              {continuation ? "--" : formatCode(row.format, row.order)}
            </div>
          );
        }
        if (id === "raw") {
          return (
            <div
              key={id}
              role="gridcell"
              data-cell="raw"
              {...(wordsTitle ? { title: wordsTitle } : {})}
              style={{ width, ...ruleStyle(rawMatch) }}
              className={cn(
                "select-none truncate px-2 text-right font-mono leading-6",
                group && "flex items-center justify-end gap-1",
                ruleClass(rawMatch),
                (stale || empty) && "text-text-muted",
              )}
            >
              <RuleMarker match={rawMatch} />
              {group ? <span>{rawShown}</span> : rawShown}
              {incompleteText ? (
                <span role="img" aria-label={incompleteText} title={incompleteText}>
                  <Icon name="info" className="inline size-3" />
                </span>
              ) : nonfinite ? (
                <span role="img" aria-label="Nonfinite value" title="Nonfinite value">
                  <Icon name="info" className="inline size-3" />
                </span>
              ) : null}
              {group && !continuation ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Inspect raw registers ${rangeText}`}
                  title="Inspect raw registers"
                  className="shrink-0 rounded p-0.5 text-dark/75 outline-none hover:bg-neutral-tint focus-ring"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspect(address);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <Icon name="info" className="size-3" />
                </button>
              ) : null}
            </div>
          );
        }
        if (group) {
          return (
            <div
              key={id}
              role="gridcell"
              data-cell="scaled"
              style={{ width }}
              title={
                continuation
                  ? `Continuation of value at register ${toDisplayAddress(row.address, base)}`
                  : NO_SCALING_FOR_COMBINED
              }
              aria-label={
                continuation
                  ? `Continuation of value at register ${toDisplayAddress(row.address, base)}`
                  : NO_SCALING_FOR_COMBINED
              }
              className="select-none truncate px-2 text-right font-mono text-[13px] leading-6 text-text-muted"
            >
              {continuation ? "--" : "n/a"}
            </div>
          );
        }
        return (
          <ScaledCellView
            key={id}
            cell={cell}
            match={scaledMatch}
            empty={empty}
            stale={stale}
            width={width}
          />
        );
      })}
    </div>
  );
});

interface DataGridProps {
  loading: boolean;
  stale: boolean;
  bits: boolean;
}

/** What the grid shows, for tests and tools: `data-status` on the grid element. */
export type GridStatus = "live" | "stale" | "loading";

const COLUMN_LABEL: Record<ColumnId, string> = {
  alias: "Alias",
  address: "Address",
  format: "Format",
  raw: "Raw",
  scaled: "Scaled",
};

/**
 * Virtualized grid: Alias | Address | Format | Raw | Scaled (DES-002 2.3.4, DES-009 3.2). Hand-built
 * ARIA grid on `@tanstack/react-virtual` like the FE-001 data table: the columns are fixed and a row
 * is one polled register, including continuation lines of 32/64-bit values, in address order.
 */
export const DataGrid = memo(function DataGrid({ loading, stale, bits }: DataGridProps) {
  const runtime = usePollViewRuntime();
  const { actions, hostActions, stores } = runtime;
  const config = usePoll((s) => s.config);
  const current = usePoll((s) => s.state === "polling");
  const widths = usePollUi((s) => s.columnWidths);
  const focused = usePollUi((s) => s.focusAddress);
  const editingAddress = usePollAlias(selectEditingAddress);
  const gridId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  // `address` is the row the menu was opened on: "Edit alias" edits that row, not the focused one.
  const [menu, setMenu] = useState<{ x: number; y: number; address: number | null } | null>(null);

  const rows = runtime.rows();
  const displayRows = useMemo(() => registerLines(rows), [rows]);
  const rowCount = displayRows.length;
  const start = config?.definition.startAddress ?? 0;
  const quantity = config?.definition.quantity ?? 0;
  const showAlias = config?.display.showAlias ?? true;
  // A scale on a coil or discrete poll is kept and ignored: only the raw column shows.
  const valueColumns = config ? effectiveValueColumns(config) : "raw";
  const base = config?.display.addressBase ?? 0;
  const columns = useMemo<ColumnId[]>(
    () => [
      ...(showAlias ? (["alias"] as const) : []),
      "address" as const,
      ...(bits ? [] : (["format"] as const)),
      ...(valueColumns === "scaled" ? [] : (["raw"] as const)),
      ...(valueColumns === "raw" ? [] : (["scaled"] as const)),
    ],
    [showAlias, valueColumns, bits],
  );
  const scaleRef = config?.scale;
  const overridesRef = config?.scaleOverrides;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the provider depends on the scale settings, which are read inside `runtime.scaled()`; it stays the same object while they do not change.
  const scaled = useMemo(() => runtime.scaled(), [runtime, scaleRef, overridesRef, base, bits]);
  const scaleOn = config ? scaleAvailable(config) : false;
  const focusIndex =
    focused === null ? -1 : displayRows.findIndex((line) => line.address === focused);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // The handoff (or a reload) restores the first visible row once, when the grid appears. The focus
  // the same handoff brings must not move the view away from it (CHK2-F1/F2): `restoredFor` remembers
  // the focus and range of that restore, and the focus effect below skips exactly that state.
  const restoredFor = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restored once on mount.
  useEffect(() => {
    const top = stores.ui.getState().topAddress;
    const index = top === null ? -1 : displayRows.findIndex((line) => line.address === top);
    if (index !== -1) {
      virtualizer.scrollToIndex(index, { align: "start" });
      restoredFor.current = `${focused}|${start}|${rowCount}`;
    }
  }, []);

  // Moving the focus brings its row into view, only when it is outside the viewport ("auto").
  useEffect(() => {
    const key = `${focused}|${start}|${rowCount}`;
    // Not on the restore itself: a second scroll would work from the virtualizer's stale offset and
    // undo the restored first row.
    if (restoredFor.current === key) return;
    restoredFor.current = null;
    if (focusIndex !== -1) virtualizer.scrollToIndex(focusIndex, { align: "auto" });
  }, [focused, focusIndex, start, rowCount, virtualizer]);

  // The editor of the next row (Enter) opens in view.
  useEffect(() => {
    const index =
      editingAddress === null
        ? -1
        : displayRows.findIndex((line) => line.address === editingAddress);
    if (index !== -1) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [editingAddress, displayRows, virtualizer]);

  // The address of the first visible row is remembered for the next host (once per animation frame).
  const frame = useRef<number | null>(null);
  const onScroll = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const el = scrollRef.current;
      const first = el ? displayRows[Math.floor(el.scrollTop / ROW_HEIGHT)] : undefined;
      if (first) stores.ui.getState().setTopAddress(first.address);
    });
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const focusGrid = useCallback(() => scrollRef.current?.focus(), []);

  // Stable identities: a new function would defeat the memo of every row on each update.
  const onRowClick = useCallback(
    (address: number, e: ReactMouseEvent) => {
      // A click inside the alias editor is the editor's own: the row must not take the focus.
      if ((e.target as HTMLElement).closest("input")) return;
      stores.ui.getState().click(address, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      focusGrid();
    },
    [stores.ui, focusGrid],
  );
  const onRowDoubleClick = useCallback(
    (address: number, e: ReactMouseEvent) => {
      if ((e.target as HTMLElement).closest("input")) return;
      const onAlias = (e.target as HTMLElement).closest('[data-cell="alias"]') !== null;
      if (onAlias) actions.editAlias(address, "dblclick");
      else hostActions.write?.(address);
    },
    [actions, hostActions],
  );
  const onRowContextMenu = useCallback(
    (address: number, e: ReactMouseEvent) => {
      e.preventDefault();
      const ui = stores.ui.getState();
      if (!rangesContain(ui.selection, address)) ui.click(address);
      setMenu({ x: e.clientX, y: e.clientY, address });
    },
    [stores.ui],
  );
  const onEditorDone = useCallback(
    (refocus: boolean) => {
      if (refocus) focusGrid();
    },
    [focusGrid],
  );
  const onInspect = useCallback(
    (address: number) => stores.ui.getState().setInspectedGroupAddress(address),
    [stores.ui],
  );

  const autoFit = (id: string) => {
    const column = id as ColumnId;
    const data = stores.data.getState();
    let longest = 4;
    for (const v of virtualizer.getVirtualItems()) {
      const line = displayRows[v.index];
      if (!line) continue;
      const { row, continuation } = line;
      const group = row.width > 1;
      if (column === "address")
        longest = Math.max(longest, String(toDisplayAddress(line.address, base)).length);
      else if (column === "alias")
        longest = Math.max(
          longest,
          (stores.alias.getState().aliases.get(line.address) ?? "").length,
        );
      else if (column === "format")
        longest = Math.max(
          longest,
          (continuation ? "--" : formatCode(row.format, row.order)).length,
        );
      else if (group) {
        if (continuation) {
          longest = Math.max(longest, column === "scaled" ? 2 : 2);
          continue;
        }
        const snapshot = data.values?.length === quantity ? data.values : null;
        const words = snapshot?.slice(row.address - start, row.endAddress - start + 1) ?? null;
        const text =
          column === "scaled"
            ? "n/a"
            : combinedText(groupValueOfWords(row, words).value) + (row.complete ? "" : " ⓘ");
        longest = Math.max(longest, text.length);
      } else {
        const raw = data.values?.[row.address - start];
        if (raw !== undefined && column === "scaled") {
          const cell = scaled(raw, row.address);
          if (cell)
            longest = Math.max(longest, cell.text.length + (cell.unit ? cell.unit.length + 1 : 0));
        } else if (raw !== undefined) {
          longest = Math.max(
            longest,
            (bits ? formatBit(raw) : formatValue(raw, row.format)).length,
          );
        }
      }
    }
    stores.ui.getState().setColumnWidth(column, fitWidth(longest));
  };

  const openMenuAtFocus = () => {
    const el = scrollRef.current;
    const row =
      focusIndex === -1 ? null : el?.querySelector<HTMLElement>(`[data-row="${focusIndex}"]`);
    const rect = (row ?? el)?.getBoundingClientRect();
    setMenu({
      x: (rect?.left ?? 0) + 24,
      y: rect?.bottom ?? 0,
      address: stores.ui.getState().focusAddress,
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const ui = stores.ui.getState();
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight || 240) / ROW_HEIGHT) - 1);
    const mods = { shift: e.shiftKey };
    const ctrl = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "ArrowDown":
        ui.moveFocus(1, mods);
        break;
      case "ArrowUp":
        ui.moveFocus(-1, mods);
        break;
      case "PageDown":
        ui.moveFocus(page, mods);
        break;
      case "PageUp":
        ui.moveFocus(-page, mods);
        break;
      case "Home":
        ui.moveFocusTo(rows[0]?.address ?? start, mods);
        break;
      case "End":
        ui.moveFocusTo(rows[rows.length - 1]?.address ?? start, mods);
        break;
      case "Enter":
        if (ui.focusAddress !== null) hostActions.write?.(ui.focusAddress);
        break;
      case "F2":
        if (ui.focusAddress !== null) actions.editAlias(ui.focusAddress, "f2");
        break;
      case "Escape":
        ui.clearSelection();
        break;
      case "ContextMenu":
        openMenuAtFocus();
        break;
      case "F10":
        if (!e.shiftKey) return;
        openMenuAtFocus();
        break;
      default: {
        // Ctrl+A and Ctrl+C by the physical key too (a non-Latin layout, REPORT-007 D8).
        const letter = ctrl ? shortcutKeyOf(e) : "";
        if (letter === "a") ui.selectAll();
        else if (letter === "c") void actions.copyRows();
        else return;
      }
    }
    e.preventDefault();
  };

  const closeMenu = useCallback(
    (restore: boolean) => {
      setMenu(null);
      if (restore) focusGrid();
    },
    [focusGrid],
  );

  // What the menu acts on: the rows of the selection (the row menu selects its own row first).
  const selection = stores.ui.getState().selection;
  const selectedRows = menu === null ? [] : rows.filter((r) => rangesContain(selection, r.address));
  const hasGroup = selectedRows.some((r) => r.width > 1);
  const hasWord = selectedRows.some((r) => r.width === 1);
  const menuRow = menu?.address == null ? undefined : rows[rowAt(rows, menu.address)];
  // "Remove scale override" is offered on rows inside an override (DES-003 3.2).
  const overridesInSelection =
    menu !== null && !bits && overridesTouching(config?.scaleOverrides ?? [], selection).length > 0;
  const copyScaledOff = !scaleOn || !hasWord;
  const copyScaledTitle = copyScaledOff
    ? !scaleOn
      ? bits
        ? SCALE_REGISTERS_ONLY
        : NO_SCALE_TITLE
      : NO_SCALING_FOR_COMBINED
    : undefined;
  // The Value format section (DES-010 10): the four 16-bit formats of Ctrl+1..4 on the same target as
  // the shortcuts, checked when the target shares one of them, then `More formats…`. A coil or
  // discrete poll has no formats: the entry stays, disabled, with the reason.
  const moreFormats = (disabled: boolean): MenuEntry => ({
    kind: "item",
    id: "more-formats",
    label: "More formats…",
    disabled,
    ...(disabled ? { title: BITS_FORMAT_TOOLTIP } : {}),
    onSelect: () => void actions.openFormatDialog("grid", menu?.address ?? null),
  });
  const formatSection: MenuEntry[] = (() => {
    if (bits || !config) return [moreFormats(true), { kind: "separator", id: "sep-format" }];
    const { checked, heading } =
      menu === null
        ? { checked: null, heading: "Value format" }
        : quickFormatState({ scope: runtime.formatScope(), overrides: config.formatOverrides });
    return [
      { kind: "heading", id: "h-format", label: heading },
      ...QUICK_FORMATS.map(
        (format, i): MenuEntry => ({
          kind: "radio",
          id: `format-${format}`,
          label: VALUE_FORMAT_LABELS[format],
          shortcut: `Ctrl+${i + 1}`,
          checked: checked === format,
          onSelect: () => void actions.setSelectedFormat(format),
        }),
      ),
      moreFormats(false),
      { kind: "separator", id: "sep-format" },
    ];
  })();
  const entries: MenuEntry[] = [
    ...formatSection,
    {
      kind: "item",
      id: "edit-alias",
      label: "Edit alias",
      shortcut: "F2",
      onSelect: () => {
        const address = menu?.address ?? stores.ui.getState().focusAddress;
        if (address !== null) actions.editAlias(address, "menu");
      },
    },
    {
      kind: "item",
      id: "clear-alias",
      label: "Clear alias",
      onSelect: () => void actions.clearSelectedAliases(),
    },
    {
      kind: "item",
      id: "paste-aliases",
      label: "Paste aliases",
      shortcut: "Ctrl+V",
      onSelect: () => void actions.pasteAliasesFromClipboard(),
    },
    { kind: "separator", id: "sep-copy" },
    {
      kind: "item",
      id: "copy",
      label: "Copy",
      shortcut: "Ctrl+C",
      onSelect: () => void actions.copyRows(),
    },
    {
      kind: "item",
      id: "copy-raw",
      label: "Copy raw",
      onSelect: () => void actions.copyRows({ columns: "raw" }),
    },
    ...(bits
      ? []
      : [
          {
            kind: "item",
            id: "copy-registers",
            label: "Copy raw registers",
            onSelect: () => void actions.copyRows({ registers: true }),
          } satisfies MenuEntry,
        ]),
    {
      kind: "item",
      id: "copy-scaled",
      label: "Copy scaled",
      disabled: copyScaledOff,
      ...(copyScaledTitle ? { title: copyScaledTitle } : {}),
      onSelect: () => void actions.copyRows({ columns: "scaled" }),
    },
    {
      kind: "item",
      id: "copy-both",
      label: "Copy raw and scaled",
      disabled: copyScaledOff,
      ...(copyScaledTitle ? { title: copyScaledTitle } : {}),
      onSelect: () => void actions.copyRows({ columns: "both" }),
    },
    {
      kind: "item",
      id: "copy-header",
      label: "Copy with header",
      onSelect: () => void actions.copyRows({ header: true }),
    },
    {
      kind: "item",
      id: "copy-aliases",
      label: "Copy aliases",
      onSelect: () => void actions.copyAliases(),
    },
    {
      kind: "check",
      id: "include-alias",
      label: "Include alias in copy",
      checked: config?.display.copyAlias ?? false,
      onSelect: () => void actions.setCopyAlias(!(config?.display.copyAlias ?? false)),
    },
    { kind: "separator", id: "sep-scale" },
    {
      kind: "item",
      id: "set-scale",
      label: "Set scale for selected rows…",
      shortcut: "Ctrl+Shift+E",
      disabled: bits || hasGroup,
      ...(bits
        ? { title: SCALE_REGISTERS_ONLY }
        : hasGroup
          ? { title: NO_SCALING_FOR_COMBINED }
          : {}),
      onSelect: () => void actions.openOverrideForSelection(),
    },
    ...(overridesInSelection
      ? [
          {
            kind: "item",
            id: "remove-override",
            label: "Remove scale override",
            onSelect: () => void actions.removeOverridesAtSelection(),
          } satisfies MenuEntry,
        ]
      : []),
    ...(menuRow && menuRow.width > 1
      ? [
          {
            kind: "item",
            id: "inspect",
            label: "Inspect raw registers",
            onSelect: () => onInspect(menuRow.address),
          } satisfies MenuEntry,
        ]
      : []),
    {
      kind: "item",
      id: "register-colors",
      label: `Set colors for register ${toDisplayAddress(menu?.address ?? stores.ui.getState().focusAddress ?? start, config?.display.addressBase ?? 0)}…`,
      onSelect: () => {
        const address = menu?.address ?? stores.ui.getState().focusAddress;
        if (address === null) return;
        const ui = stores.ui.getState();
        ui.setSetupOpen(true);
        ui.setRuleDraft(
          registerColorDraft(
            config?.colorRules ?? [],
            address,
            toDisplayAddress(address, config?.display.addressBase ?? 0),
          ),
        );
      },
    },
    {
      kind: "item",
      id: "value-color-rules",
      label: "Value color rules…",
      onSelect: () => {
        const address = menu?.address ?? stores.ui.getState().focusAddress;
        if (address === null) return;
        const ui = stores.ui.getState();
        ui.setSetupOpen(true);
        ui.setRuleDraft(
          registerRuleDraft(
            config?.colorRules ?? [],
            address,
            toDisplayAddress(address, config?.display.addressBase ?? 0),
          ),
        );
      },
    },
    ...(hostActions.write
      ? [
          { kind: "separator", id: "sep-write" } satisfies MenuEntry,
          {
            kind: "item",
            id: "write",
            label: "Write…",
            shortcut: "Enter",
            // The row that was right-clicked, also when it is part of a larger selection
            // (the focus stays on another row then; the dialog would write there).
            onSelect: () => hostActions.write?.(menu?.address ?? stores.ui.getState().focusAddress),
          } satisfies MenuEntry,
        ]
      : []),
  ];

  const totalWidth = columns.reduce((n, id) => n + widths[id], 0) + 3;
  const baseLabel = `Address (${base}-based)`;
  const headerLabel = (id: ColumnId): string => (id === "address" ? baseLabel : COLUMN_LABEL[id]);

  return (
    <>
      <div
        ref={scrollRef}
        role="grid"
        aria-label="Register values"
        aria-rowcount={rowCount + 1}
        aria-multiselectable="true"
        aria-activedescendant={focusIndex === -1 ? undefined : `${gridId}-row-${focusIndex}`}
        tabIndex={0}
        data-status={loading ? "loading" : stale ? "stale" : "live"}
        data-virtual-viewport=""
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        onPaste={(e) => {
          // A paste into the alias editor is the editor's own.
          if ((e.target as HTMLElement).tagName === "INPUT") return;
          e.preventDefault();
          void actions.pasteAliases(e.clipboardData.getData("text/plain"));
        }}
        className="relative min-h-0 flex-1 overflow-auto rounded-md border outline-none focus-ring"
      >
        <div style={{ width: totalWidth }}>
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-10 flex border-b bg-card text-xs font-semibold"
            style={{ height: ROW_HEIGHT, paddingLeft: 3 }}
          >
            {columns.map((id) => (
              <div
                key={id}
                role="columnheader"
                {...(id === "scaled" ? { "aria-label": "Scaled value" } : {})}
                className={cn(
                  "relative truncate px-2 leading-6",
                  id === "alias" || id === "format" ? "text-left" : "text-right",
                )}
                style={{ width: widths[id] }}
              >
                {headerLabel(id)}
                <ColumnResizeHandle
                  columnId={id}
                  label={COLUMN_LABEL[id]}
                  width={widths[id]}
                  minWidth={POLL_COLUMN_MIN_WIDTHS[id]}
                  onResize={(cid, px) => stores.ui.getState().setColumnWidth(cid as ColumnId, px)}
                  onAutoFit={autoFit}
                />
              </div>
            ))}
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const line = displayRows[item.index];
              if (!line) return null;
              return (
                <Row
                  key={item.key}
                  index={item.index}
                  top={item.start}
                  row={line.row}
                  displayAddress={line.address}
                  continuation={line.continuation}
                  start={start}
                  quantity={quantity}
                  base={base}
                  bits={bits}
                  loading={loading}
                  stale={stale}
                  columns={columns}
                  widths={widths}
                  scaled={scaled}
                  gridId={gridId}
                  rules={config?.colorRules ?? EMPTY_RULES}
                  current={current}
                  onRowClick={onRowClick}
                  onRowDoubleClick={onRowDoubleClick}
                  onRowContextMenu={onRowContextMenu}
                  onEditorDone={onEditorDone}
                  onInspect={onInspect}
                />
              );
            })}
          </div>
        </div>
      </div>
      <ContextMenu position={menu} label="Row actions" entries={entries} onClose={closeMenu} />
    </>
  );
});
