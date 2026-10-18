import { useEffect, useId, useRef, useState } from "react";
import { shortcutKeyOf } from "@/shared/lib/shortcut-key";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { Icon } from "@/shared/ui/icon";
import { ContextMenu, type MenuEntry } from "@/shared/ui/menu";
import { toDisplayAddress } from "../../lib/address";
import { matchRule } from "../../lib/color-rules";
import {
  type CombinedFormat,
  type CombinedRow,
  combinedRows,
  combinedText,
  rawWordsText,
  registerWidth,
} from "../../lib/combined";
import { VALUE_FORMAT_LABELS } from "../../lib/format";
import { type ColumnId, POLL_COLUMN_MIN_WIDTHS } from "../../store/poll-view-ui.store";
import { registerColorDraft, registerRuleDraft } from "../../store/rule-draft";
import { ColumnResizeHandle, fitWidth } from "../ColumnResizeHandle";
import { usePoll, usePollAlias, usePollData, usePollUi, usePollViewRuntime } from "./context";
import { AliasEditor } from "./DataGrid";
import { focusInterpretationFormat } from "./focus-interpretation";
import { RuleMarker, ruleClass, ruleStyle } from "./RuleMarker";
import { scrollWithin } from "./scroll-within";

export function CombinedGrid({
  format,
  loading,
  stale,
}: {
  format: CombinedFormat;
  loading: boolean;
  stale: boolean;
}) {
  const runtime = usePollViewRuntime();
  const config = usePoll((s) => s.config);
  const current = usePoll((s) => s.state === "polling");
  const values = usePollData((s) => s.values);
  const aliases = usePollAlias((s) => s.aliases);
  const editingAddress = usePollAlias((s) => s.editing?.address);
  const selection = usePollUi((s) => s.selection);
  const focus = usePollUi((s) => s.focusAddress);
  const widths = usePollUi((s) => s.columnWidths);
  const inspected = usePollUi((s) => s.inspectedGroupAddress);
  const setInspected = runtime.stores.ui.getState().setInspectedGroupAddress;
  const [menu, setMenu] = useState<{ x: number; y: number; address: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const gridId = useId();
  useEffect(() => {
    const grid = ref.current;
    const row = focus === null ? null : document.getElementById(`${gridId}-row-${focus}`);
    if (grid && row) scrollWithin(grid, row);
  }, [focus, gridId]);
  const width = registerWidth(format);
  const start = config?.definition.startAddress ?? 0;
  useEffect(() => {
    const ui = runtime.stores.ui.getState();
    const previous = ui.focusAddress ?? start;
    const address = start + Math.floor(Math.max(0, previous - start) / width) * width;
    if (ui.focusAddress === null || ui.focusAddress !== address || ui.groupWidth !== width)
      ui.click(address);
    ui.setGroupWidth(width);
  }, [runtime, start, width]);
  useEffect(() => (inspected === null ? undefined : runtime.lockModal()), [runtime, inspected]);
  if (!config) return null;
  const { quantity } = config.definition;
  const base = config.display.addressBase;
  const rows = combinedRows(start, quantity, loading ? null : values, format, config.display);
  const selected = (address: number) =>
    selection.some((range) => address >= range.start && address <= range.end);
  const range = (row: CombinedRow) =>
    row.address === row.endAddress
      ? String(toDisplayAddress(row.address, base))
      : `${toDisplayAddress(row.address, base)}–${toDisplayAddress(row.endAddress, base)}`;
  const ruleFor = (row: CombinedRow) => {
    const raw = row.value.kind === "integer" || row.value.kind === "float" ? row.value.value : null;
    return matchRule(config.colorRules ?? [], {
      address: row.address,
      raw,
      scaled: null,
      displayed: raw,
      column: "Interpreted",
      current: current && !stale && !loading,
      format,
    });
  };
  const inspect = rows.find((row) => row.address === inspected);
  const headers: { id: ColumnId; label: string }[] = [
    ...(config.display.showAlias ? [{ id: "alias" as const, label: "Alias" }] : []),
    { id: "address", label: `Address (${base}-based)` },
    { id: "raw", label: `Interpreted (${VALUE_FORMAT_LABELS[format]})` },
    { id: "scaled", label: "Raw words" },
  ];
  const fitColumn = (id: string) => {
    const texts = rows.map((row) =>
      id === "alias"
        ? (aliases.get(row.address) ?? "")
        : id === "address"
          ? range(row)
          : id === "raw"
            ? combinedText(row.value)
            : rawWordsText(row.words),
    );
    runtime.stores.ui
      .getState()
      .setColumnWidth(id as ColumnId, fitWidth(Math.max(...texts.map((text) => text.length), 4)));
  };
  const entries: MenuEntry[] = [
    {
      kind: "item",
      id: "alias",
      label: "Edit alias",
      shortcut: "F2",
      onSelect: () => {
        const address = menu?.address ?? focus;
        if (address !== null) runtime.actions.editAlias(address, "menu");
      },
    },
    {
      kind: "item",
      id: "inspect",
      label: "Inspect raw registers",
      onSelect: () => setInspected(menu?.address ?? focus),
    },
    { kind: "item", id: "copy", label: "Copy", onSelect: () => void runtime.actions.copyRows() },
    {
      kind: "item",
      id: "raw",
      label: "Copy raw registers",
      onSelect: () => void runtime.actions.copyRows({ columns: "raw" }),
    },
    {
      kind: "item",
      id: "header",
      label: "Copy with header",
      onSelect: () => void runtime.actions.copyRows({ header: true }),
    },
    {
      kind: "item",
      id: "scaled",
      label: "Copy scaled",
      disabled: true,
      title: "Scaling is unavailable for combined values.",
      onSelect: () => {},
    },
    {
      kind: "item",
      id: "register-colors",
      label: `Set colors for register ${toDisplayAddress(menu?.address ?? focus ?? start, base)}…`,
      onSelect: () => {
        const address = menu?.address ?? focus;
        if (address === null) return;
        const ui = runtime.stores.ui.getState();
        ui.setSetupOpen(true);
        ui.setRuleDraft(
          registerColorDraft(config.colorRules ?? [], address, toDisplayAddress(address, base)),
        );
      },
    },
    {
      kind: "item",
      id: "value-color-rules",
      label: "Value color rules…",
      onSelect: () => {
        const address = menu?.address ?? focus;
        if (address === null) return;
        const ui = runtime.stores.ui.getState();
        ui.setSetupOpen(true);
        ui.setRuleDraft(
          registerRuleDraft(config.colorRules ?? [], address, toDisplayAddress(address, base)),
        );
      },
    },
    {
      kind: "item",
      id: "format-endian",
      label: "Format / endian…",
      onSelect: () => {
        const pollView = ref.current?.closest('[data-slot="poll-view"]');
        runtime.stores.ui.getState().setSetupOpen(true);
        window.setTimeout(() => focusInterpretationFormat(pollView ?? null), 0);
      },
    },
    ...(runtime.hostActions.write
      ? [
          {
            kind: "item",
            id: "write",
            label: "Write…",
            onSelect: () => runtime.hostActions.write?.(menu?.address ?? focus),
          } satisfies MenuEntry,
        ]
      : []),
  ];
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: scroll container owns keyboard grid navigation. */}
      <div
        ref={ref}
        role="grid"
        aria-label="Register values"
        aria-multiselectable="true"
        aria-activedescendant={focus === null ? undefined : `${gridId}-row-${focus}`}
        aria-rowcount={rows.length + 1}
        tabIndex={0}
        data-status={loading ? "loading" : stale ? "stale" : "live"}
        className="min-h-0 flex-1 overflow-auto rounded-md border outline-none focus-ring"
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest("button,input")) return;
          const ui = runtime.stores.ui.getState();
          const index = Math.max(
            0,
            rows.findIndex((row) => row.address === focus),
          );
          const target =
            event.key === "ArrowDown"
              ? index + 1
              : event.key === "ArrowUp"
                ? index - 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? rows.length - 1
                    : null;
          if (target !== null) {
            const row = rows[Math.max(0, Math.min(rows.length - 1, target))];
            if (row) ui.click(row.address, { shift: event.shiftKey });
          } else if (event.key === "Enter") runtime.hostActions.write?.(focus);
          else if (event.key === "F2" && focus !== null) runtime.actions.editAlias(focus, "f2");
          else if (event.key === "Escape") ui.clearSelection();
          else if ((event.ctrlKey || event.metaKey) && shortcutKeyOf(event) === "a") ui.selectAll();
          else if ((event.ctrlKey || event.metaKey) && shortcutKeyOf(event) === "c")
            void runtime.actions.copyRows();
          else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            const rect = ref.current?.getBoundingClientRect();
            setMenu({ x: rect?.left ?? 0, y: rect?.top ?? 0, address: focus ?? start });
          } else return;
          event.preventDefault();
        }}
      >
        <table className="w-max min-w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr>
              {headers.map((header) => (
                <th
                  key={header.id}
                  className="relative px-2 text-left"
                  style={{ minWidth: widths[header.id] }}
                >
                  {header.label}
                  <ColumnResizeHandle
                    columnId={header.id}
                    label={header.label}
                    width={widths[header.id]}
                    minWidth={POLL_COLUMN_MIN_WIDTHS[header.id]}
                    onResize={(id, px) =>
                      runtime.stores.ui.getState().setColumnWidth(id as ColumnId, px)
                    }
                    onAutoFit={fitColumn}
                  />
                </th>
              ))}
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const match = ruleFor(row);
              return (
                <tr
                  key={row.address}
                  id={`${gridId}-row-${row.address}`}
                  aria-selected={selected(row.address)}
                  data-focused={focus === row.address || undefined}
                  className={`${selected(row.address) ? "bg-selected" : "hover:bg-neutral-tint"} ${focus === row.address ? "outline outline-1 -outline-offset-1 outline-dark/40" : ""} ${stale || loading ? "text-text-muted" : ""}`}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("input,button")) return;
                    runtime.stores.ui.getState().click(row.address, {
                      shift: event.shiftKey,
                      ctrl: event.ctrlKey || event.metaKey,
                    });
                    ref.current?.focus();
                  }}
                  onDoubleClick={(event) => {
                    if ((event.target as HTMLElement).closest('[data-cell="alias"]'))
                      runtime.actions.editAlias(row.address, "dblclick");
                    else runtime.hostActions.write?.(row.address);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!selected(row.address)) runtime.stores.ui.getState().click(row.address);
                    setMenu({ x: event.clientX, y: event.clientY, address: row.address });
                  }}
                >
                  {config.display.showAlias ? (
                    <td data-cell="alias" className="px-2">
                      {editingAddress === row.address ? (
                        <AliasEditor
                          address={row.address}
                          base={base}
                          width={widths.alias}
                          onDone={(refocus) => {
                            if (refocus) ref.current?.focus();
                          }}
                        />
                      ) : (
                        aliases.get(row.address)
                      )}
                    </td>
                  ) : null}
                  <td
                    className="select-none px-2 font-mono"
                    aria-label={`Registers ${toDisplayAddress(row.address, base)} through ${toDisplayAddress(row.endAddress, base)}; group address ${toDisplayAddress(row.address, base)}`}
                  >
                    {range(row)}
                  </td>
                  <td
                    className={`select-none whitespace-nowrap px-2 font-mono ${ruleClass(match)}`}
                    style={ruleStyle(match)}
                  >
                    <RuleMarker match={match} />
                    {combinedText(row.value)}
                    {row.value.kind === "incomplete" ? (
                      <span
                        role="img"
                        aria-label={`Needs ${width} registers; only ${row.words.length} available.`}
                        title={`Needs ${width} registers; only ${row.words.length} available.`}
                      >
                        <Icon name="info" className="inline size-3" />
                      </span>
                    ) : row.value.kind === "float" && !Number.isFinite(row.value.value) ? (
                      <span role="img" aria-label="Nonfinite value" title="Nonfinite value">
                        <Icon name="info" className="inline size-3" />
                      </span>
                    ) : null}
                  </td>
                  <td className="select-none whitespace-nowrap px-2 font-mono">
                    {rawWordsText(row.words)}
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Inspect raw registers ${range(row)}`}
                      className="rounded p-1 focus-ring"
                      onClick={(event) => {
                        event.stopPropagation();
                        setInspected(row.address);
                      }}
                    >
                      <Icon name="info" className="size-3" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ContextMenu
        position={menu}
        label="Row actions"
        entries={entries}
        onClose={() => {
          setMenu(null);
          ref.current?.focus();
        }}
      />
      <Dialog
        open={inspect !== undefined}
        onOpenChange={(open) => {
          if (!open) setInspected(null);
        }}
        title={`Raw registers · ${inspect ? range(inspect) : ""}`}
      >
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>Address</th>
                <th>Alias</th>
                <th>Unsigned</th>
                <th>Hex</th>
              </tr>
            </thead>
            <tbody>
              {inspect?.words.map((word, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: protocol address is stable identity.
                <tr key={inspect.address + index}>
                  <td className="font-mono">{toDisplayAddress(inspect.address + index, base)}</td>
                  <td>{aliases.get(inspect.address + index)}</td>
                  <td className="font-mono">{word}</td>
                  <td className="font-mono">{rawWordsText([word])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {config.scale || config.scaleOverrides.length ? (
          <p className="mt-2 text-xs">Saved scales apply again in 16-bit mode.</p>
        ) : null}
        {inspect?.value.kind === "float" && Object.is(inspect.value.value, -0) ? (
          <p>Negative zero</p>
        ) : null}
        <Button
          className="mt-3"
          size="sm"
          onClick={() => {
            if (inspect) {
              void runtime.actions.copyRows({ columns: "raw", addresses: [inspect.address] });
            }
          }}
        >
          Copy raw registers
        </Button>
      </Dialog>
    </>
  );
}
