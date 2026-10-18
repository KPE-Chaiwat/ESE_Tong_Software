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
import { matchRule } from "../../lib/color-rules";
import { formatBit, formatValue, VALUE_FORMAT_LABELS } from "../../lib/format";
import { rawToX } from "../../lib/scale-math";
import { SCALE_REGISTERS_ONLY } from "../../lib/scale-presets";
import { effectiveValueColumns, type ScaledProvider, scaleAvailable } from "../../lib/scaled";
import { selectAliasAt, selectEditingAddress } from "../../store/alias.store";
import { selectValueAt } from "../../store/poll-data.store";
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
import { focusInterpretationFormat } from "./focus-interpretation";
import { NO_SCALE_TITLE } from "./poll-view.logic";
import { RuleMarker, ruleClass, ruleStyle } from "./RuleMarker";
import { ScaledCellView } from "./ScaledCellView";

const EMPTY_RULES: readonly ValueColorRule[] = [];
export const ROW_HEIGHT = 24;

interface RowProps {
  index: number;
  top: number;
  address: number;
  base: 0 | 1;
  format: import("@/shared/ipc/modbus-master.types").ValueFormat;
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

/** One row. It selects only its own value, alias and flags, so an update that changes other rows leaves it alone. */
const Row = memo(function Row({
  index,
  top,
  address,
  base,
  format,
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
}: RowProps) {
  const raw = usePollData(selectValueAt(index));
  const alias = usePollAlias(selectAliasAt(address));
  const editing = usePollAlias((s) => s.editing?.address === address);
  const selected = usePollUi(selectIsSelected(address));
  const focused = usePollUi(selectIsFocused(address));
  const empty = loading || raw === undefined;
  const cell = empty ? null : scaled(raw, address);
  // The override marker belongs to the address, so it shows while there is no value yet too.
  const overrideMarker = scaled.override?.(address) ?? cell?.override ?? null;
  const rawShown = empty ? "—" : bits ? formatBit(raw) : formatValue(raw, format);

  const rawNumeric = empty ? null : bits ? (raw ? 1 : 0) : rawToX(raw, format === "signed");
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
      format,
    });
  const rawMatch = match("Raw");
  const scaledMatch = match("Scaled");
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the grid.
    <div
      role="row"
      id={`${gridId}-row-${index}`}
      data-row={index}
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-focused={focused || undefined}
      onClick={(e) => onRowClick(address, e)}
      onDoubleClick={(e) => onRowDoubleClick(address, e)}
      onContextMenu={(e) => onRowContextMenu(address, e)}
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
              address={address}
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
              className="flex select-none items-center justify-end gap-1 truncate px-2 font-mono leading-6"
            >
              {overrideMarker ? (
                <span role="img" title={overrideMarker.tooltip} aria-label={overrideMarker.tooltip}>
                  <Icon name="sliders-horizontal" className="size-3 text-dark/75" />
                </span>
              ) : null}
              {toDisplayAddress(address, base)}
            </div>
          );
        }
        if (id === "raw") {
          return (
            <div
              key={id}
              role="gridcell"
              data-cell="raw"
              style={{ width, ...ruleStyle(rawMatch) }}
              className={cn(
                "select-none truncate px-2 text-right font-mono leading-6",
                ruleClass(rawMatch),
                (stale || empty) && "text-text-muted",
              )}
            >
              <RuleMarker match={rawMatch} />
              {rawShown}
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
  rowCount: number;
  startAddress: number;
  loading: boolean;
  stale: boolean;
  bits: boolean;
}

/** What the grid shows, for tests and tools: `data-status` on the grid element. */
export type GridStatus = "live" | "stale" | "loading";

const COLUMN_LABEL: Record<ColumnId, string> = {
  alias: "Alias",
  address: "Address",
  raw: "Raw",
  scaled: "Scaled",
};

/**
 * Virtualized grid: Alias | Address | Raw | Scaled (DES-002 2.3.4). Hand-built ARIA grid on
 * `@tanstack/react-virtual` like the FE-001 data table: the columns are fixed and the rows render
 * one value each.
 */
export const DataGrid = memo(function DataGrid({
  rowCount,
  startAddress,
  loading,
  stale,
  bits,
}: DataGridProps) {
  const runtime = usePollViewRuntime();
  const { actions, hostActions, stores } = runtime;
  useEffect(() => stores.ui.getState().setGroupWidth(1), [stores.ui]);
  const config = usePoll((s) => s.config);
  const current = usePoll((s) => s.state === "polling");
  const widths = usePollUi((s) => s.columnWidths);
  const focused = usePollUi((s) => s.focusAddress);
  const editingAddress = usePollAlias(selectEditingAddress);
  const gridId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  // `address` is the row the menu was opened on: "Edit alias" edits that row, not the focused one.
  const [menu, setMenu] = useState<{ x: number; y: number; address: number | null } | null>(null);

  const showAlias = config?.display.showAlias ?? true;
  // A scale on a coil or discrete poll is kept and ignored: only the raw column shows.
  const valueColumns = config ? effectiveValueColumns(config) : "raw";
  const base = config?.display.addressBase ?? 0;
  const format = config?.display.format ?? "unsigned";
  const columns = useMemo<ColumnId[]>(
    () => [
      ...(showAlias ? (["alias"] as const) : []),
      "address" as const,
      ...(valueColumns === "scaled" ? [] : (["raw"] as const)),
      ...(valueColumns === "raw" ? [] : (["scaled"] as const)),
    ],
    [showAlias, valueColumns],
  );
  const scaleRef = config?.scale;
  const overridesRef = config?.scaleOverrides;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the provider depends on the scale settings, which are read inside `runtime.scaled()`; it stays the same object while they do not change.
  const scaled = useMemo(() => runtime.scaled(), [runtime, scaleRef, overridesRef, base, bits]);
  const scaleOn = config ? scaleAvailable(config) : false;

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
    if (top !== null && top >= startAddress && top < startAddress + rowCount) {
      virtualizer.scrollToIndex(top - startAddress, { align: "start" });
      restoredFor.current = `${focused}|${startAddress}|${rowCount}`;
    }
  }, []);

  // Moving the focus brings its row into view, only when it is outside the viewport ("auto").
  useEffect(() => {
    const key = `${focused}|${startAddress}|${rowCount}`;
    // Not on the restore itself: a second scroll would work from the virtualizer's stale offset and
    // undo the restored first row.
    if (restoredFor.current === key) return;
    restoredFor.current = null;
    if (focused !== null && focused >= startAddress && focused < startAddress + rowCount) {
      virtualizer.scrollToIndex(focused - startAddress, { align: "auto" });
    }
  }, [focused, startAddress, rowCount, virtualizer]);

  // The editor of the next row (Enter) opens in view.
  useEffect(() => {
    if (
      editingAddress !== null &&
      editingAddress >= startAddress &&
      editingAddress < startAddress + rowCount
    ) {
      virtualizer.scrollToIndex(editingAddress - startAddress, { align: "auto" });
    }
  }, [editingAddress, startAddress, rowCount, virtualizer]);

  // The first visible address is remembered for the next host (once per animation frame).
  const frame = useRef<number | null>(null);
  const onScroll = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const el = scrollRef.current;
      if (el)
        stores.ui.getState().setTopAddress(startAddress + Math.floor(el.scrollTop / ROW_HEIGHT));
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
      stores.ui.getState().click(address, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      focusGrid();
    },
    [stores.ui, focusGrid],
  );
  const onRowDoubleClick = useCallback(
    (address: number, e: ReactMouseEvent) => {
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
      const selected = ui.selection.some((r) => address >= r.start && address <= r.end);
      if (!selected) ui.click(address);
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

  const autoFit = (id: string) => {
    const column = id as ColumnId;
    const data = stores.data.getState();
    const visible = virtualizer.getVirtualItems();
    let longest = 4;
    for (const v of visible) {
      const address = startAddress + v.index;
      if (column === "address")
        longest = Math.max(longest, String(toDisplayAddress(address, base)).length);
      else if (column === "alias")
        longest = Math.max(longest, (stores.alias.getState().aliases.get(address) ?? "").length);
      else {
        const raw = data.values?.[v.index];
        if (raw !== undefined && column === "scaled") {
          const cell = scaled(raw, address);
          if (cell)
            longest = Math.max(longest, cell.text.length + (cell.unit ? cell.unit.length + 1 : 0));
        } else if (raw !== undefined) {
          longest = Math.max(longest, (bits ? formatBit(raw) : formatValue(raw, format)).length);
        }
      }
    }
    stores.ui.getState().setColumnWidth(column, fitWidth(longest));
  };

  const openMenuAtFocus = () => {
    const el = scrollRef.current;
    const row =
      focused === null
        ? null
        : el?.querySelector<HTMLElement>(`[data-row="${focused - startAddress}"]`);
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
        ui.moveFocusTo(startAddress, mods);
        break;
      case "End":
        ui.moveFocusTo(startAddress + rowCount - 1, mods);
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

  // "Remove scale override" is offered on rows inside an override (DES-003 3.2).
  const overridesInSelection =
    menu !== null &&
    !bits &&
    overridesTouching(config?.scaleOverrides ?? [], stores.ui.getState().selection).length > 0;
  const entries: MenuEntry[] = [
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
    {
      kind: "item",
      id: "copy-scaled",
      label: "Copy scaled",
      disabled: !scaleOn,
      ...(scaleOn ? {} : { title: bits ? SCALE_REGISTERS_ONLY : NO_SCALE_TITLE }),
      onSelect: () => void actions.copyRows({ columns: "scaled" }),
    },
    {
      kind: "item",
      id: "copy-both",
      label: "Copy raw and scaled",
      disabled: !scaleOn,
      ...(scaleOn ? {} : { title: bits ? SCALE_REGISTERS_ONLY : NO_SCALE_TITLE }),
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
      disabled: bits,
      ...(bits ? { title: SCALE_REGISTERS_ONLY } : {}),
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
    {
      kind: "item",
      id: "register-colors",
      label: `Set colors for register ${toDisplayAddress(menu?.address ?? stores.ui.getState().focusAddress ?? startAddress, config?.display.addressBase ?? 0)}…`,
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
    {
      kind: "item",
      id: "format-endian",
      label: "Format / endian…",
      onSelect: () => {
        const pollView = scrollRef.current?.closest('[data-slot="poll-view"]');
        stores.ui.getState().setSetupOpen(true);
        window.setTimeout(() => focusInterpretationFormat(pollView ?? null), 0);
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
  const headerLabel = (id: ColumnId): string =>
    id === "address"
      ? baseLabel
      : id === "raw"
        ? `Raw (${VALUE_FORMAT_LABELS[format]})`
        : COLUMN_LABEL[id];

  return (
    <>
      <div
        ref={scrollRef}
        role="grid"
        aria-label="Register values"
        aria-rowcount={rowCount + 1}
        aria-multiselectable="true"
        aria-activedescendant={
          focused === null || focused < startAddress || focused >= startAddress + rowCount
            ? undefined
            : `${gridId}-row-${focused - startAddress}`
        }
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
                  id === "alias" ? "text-left" : "text-right",
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
            {virtualizer.getVirtualItems().map((item) => (
              <Row
                key={item.key}
                index={item.index}
                top={item.start}
                address={startAddress + item.index}
                base={base}
                format={format}
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
              />
            ))}
          </div>
        </div>
      </div>
      <ContextMenu position={menu} label="Row actions" entries={entries} onClose={closeMenu} />
    </>
  );
});
