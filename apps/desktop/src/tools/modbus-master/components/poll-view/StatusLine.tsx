import { useId } from "react";
import { cn } from "@/shared/lib/utils";
import { Icon } from "@/shared/ui/icon";
import { MenuButton, type MenuEntry } from "@/shared/ui/menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { StatusStrip } from "@/shared/ui/status-strip";
import { VALUE_FORMAT_LABELS } from "../../lib/format";
import { QUICK_FORMATS, quickFormatState } from "../../lib/format-dialog-model";
import { FORMAT_BUTTON_TITLE, SELECT_ROWS_FIRST } from "../../lib/format-messages";
import { isBitFunction } from "../../lib/functions";
import { SCALE_REGISTERS_ONLY } from "../../lib/scale-presets";
import { effectiveValueColumns, scaleAvailable } from "../../lib/scaled";
import {
  counterText,
  type FreshnessTextKind,
  statusLineReason,
  statusLineStep,
} from "../../lib/status-line";
import { pollBannerFor, pollPillFor } from "../../store/poll.logic";
import { usePoll, usePollConnection, usePollData, usePollUi, usePollViewRuntime } from "./context";
import { FreshnessSlot } from "./FreshnessSlot";
import {
  BITS_FORMAT_TOOLTIP,
  type DataViewInput,
  NO_SCALE_TITLE,
  showButtonLabel,
  VALUE_COLUMN_LABELS,
} from "./poll-view.logic";

interface StatusLineProps {
  /** What the freshness chip derives its text from; shown here when the data header is not (narrow). */
  chipInput: Omit<DataViewInput, "lastOkAt">;
  /** The compact "Show" menu replaces the segmented controls of the wide header. */
  compact: boolean;
  /** Width L of the poll view in px: the line gives parts up in fixed steps when it is narrow. */
  width: number;
  /**
   * The text kind of the freshness chip (`live` "Updated ...", `long` every other text, `none`): a
   * long text keeps its text to a wider L, but only inside this line (step 1).
   */
  freshness?: FreshnessTextKind;
}

const VALUE_COLUMN_ORDER = ["raw", "scaled", "both"] as const;

/** The "Show {Both} ▾" menu of the narrow layout (DES-002 2.3.4). */
function ShowMenu({ iconOnly }: { iconOnly: boolean }) {
  const runtime = usePollViewRuntime();
  const { actions } = runtime;
  const config = usePoll((s) => s.config);
  const hasTarget = usePollUi((s) => s.selection.length > 0 || s.focusAddress !== null);
  // The checked format follows the target: render again when the selection or the focused row moves.
  usePollUi((s) => s.selection);
  usePollUi((s) => s.focusAddress);
  if (!config) return null;
  const bits = isBitFunction(config.definition.function);
  // The format items act on the selection (the focused row when nothing is selected, DES-009 3.5).
  const formatOff = bits || !hasTarget;
  const formatTitle = bits
    ? BITS_FORMAT_TOOLTIP
    : hasTarget
      ? FORMAT_BUTTON_TITLE
      : SELECT_ROWS_FIRST;
  // The checked item is the format the target (selection or focused row) shares, as in the row menu.
  const quick = formatOff
    ? { checked: null }
    : quickFormatState({ scope: runtime.formatScope(), overrides: config.formatOverrides });
  const scaleOn = scaleAvailable(config);
  // A scale on a coil or discrete poll is ignored: the table shows the raw column only.
  const shown = effectiveValueColumns(config);
  const entries: MenuEntry[] = [
    { kind: "heading", id: "h-show", label: "Show" },
    ...VALUE_COLUMN_ORDER.map(
      (value): MenuEntry => ({
        kind: "radio",
        id: `show-${value}`,
        label: VALUE_COLUMN_LABELS[value],
        checked: shown === value,
        disabled: value !== "raw" && !scaleOn,
        ...(value !== "raw" && !scaleOn
          ? { title: bits ? SCALE_REGISTERS_ONLY : NO_SCALE_TITLE }
          : {}),
        onSelect: () => void actions.setValueColumns(value),
      }),
    ),
    { kind: "heading", id: "h-format", label: "Format of selected rows" },
    ...QUICK_FORMATS.map(
      (format, i): MenuEntry => ({
        kind: "radio",
        id: `format-${format}`,
        label: VALUE_FORMAT_LABELS[format],
        shortcut: `Ctrl+${i + 1}`,
        checked: quick.checked === format,
        disabled: formatOff,
        ...(formatOff ? { title: formatTitle } : {}),
        onSelect: () => void actions.setSelectedFormat(format),
      }),
    ),
    {
      kind: "item",
      id: "more-formats",
      label: "More formats…",
      disabled: formatOff,
      ...(formatOff ? { title: formatTitle } : {}),
      onSelect: () => void actions.openFormatDialog("showMenu"),
    },
    { kind: "heading", id: "h-base", label: "Address base" },
    {
      kind: "radio",
      id: "base-0",
      label: "0-based",
      shortcut: "Ctrl+B",
      checked: config.display.addressBase === 0,
      onSelect: () => void actions.setAddressBase(0),
    },
    {
      kind: "radio",
      id: "base-1",
      label: "1-based",
      shortcut: "Ctrl+B",
      checked: config.display.addressBase === 1,
      onSelect: () => void actions.setAddressBase(1),
    },
    { kind: "separator", id: "sep" },
    {
      kind: "check",
      id: "alias-column",
      label: "Alias column",
      checked: config.display.showAlias,
      onSelect: () => void actions.setShowAlias(!config.display.showAlias),
    },
    {
      kind: "check",
      id: "copy-alias",
      label: "Include alias in copy",
      checked: config.display.copyAlias,
      onSelect: () => void actions.setCopyAlias(!config.display.copyAlias),
    },
  ];
  const label = showButtonLabel(shown);
  return (
    <MenuButton
      label={label}
      entries={entries}
      {...(iconOnly ? { title: label } : {})}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-pill border border-input bg-card text-xs font-semibold outline-none hover:bg-neutral-tint focus-ring",
        iconOnly ? "px-1.5" : "px-2.5",
      )}
    >
      {iconOnly ? <Icon name="columns-3" className="size-3.5" /> : label}
      <Icon name="chevron-down" className="size-3.5" />
    </MenuButton>
  );
}

/** The `⋯` menu: poll actions; the host decides which of its own actions are offered. */
function ActionsMenu() {
  const runtime = usePollViewRuntime();
  const { actions, hostActions, host } = runtime;
  const state = usePoll((s) => s.state);
  const running =
    state === "polling" || state === "timeout" || state === "exception" || state === "badResponse";
  const entries: MenuEntry[] = [
    {
      kind: "item",
      id: "toggle",
      label: running ? "Pause" : "Resume",
      shortcut: "Ctrl+P",
      onSelect: () => void actions.toggleActive(),
    },
    ...(hostActions.write
      ? [
          {
            kind: "item",
            id: "write",
            label: "Write…",
            shortcut: "Ctrl+E",
            onSelect: () => hostActions.write?.(null),
          } satisfies MenuEntry,
        ]
      : []),
    ...(hostActions.rename
      ? [
          {
            kind: "item",
            id: "rename",
            label: "Rename",
            shortcut: "F2",
            onSelect: () => hostActions.rename?.(),
          } satisfies MenuEntry,
        ]
      : []),
    ...(hostActions.duplicate
      ? [
          {
            kind: "item",
            id: "duplicate",
            label: "Duplicate",
            onSelect: () => hostActions.duplicate?.(),
          } satisfies MenuEntry,
        ]
      : []),
    ...(hostActions.showTraffic
      ? [
          {
            kind: "item",
            id: "traffic",
            label: "Show traffic for this poll",
            onSelect: () => hostActions.showTraffic?.(),
          } satisfies MenuEntry,
        ]
      : []),
    {
      kind: "item",
      id: "reset",
      label: "Reset counters for this poll",
      onSelect: () => void actions.resetCounters(),
    },
    { kind: "separator", id: "sep" },
    ...(host === "workspace" && hostActions.popOut
      ? [
          {
            kind: "item",
            id: "pop-out",
            label: "Pop out to own window",
            shortcut: "Ctrl+Shift+O",
            onSelect: () => hostActions.popOut?.("subWindowMenu"),
          } satisfies MenuEntry,
        ]
      : []),
    ...(host === "native" && hostActions.dock
      ? [
          {
            kind: "item",
            id: "dock",
            label: "Dock to workspace",
            shortcut: "Ctrl+Shift+D",
            onSelect: () => hostActions.dock?.("subWindowMenu"),
          } satisfies MenuEntry,
        ]
      : []),
    ...(hostActions.close
      ? [
          {
            kind: "item",
            id: "close",
            label: "Close",
            ...(host === "workspace" ? { shortcut: "Ctrl+F4" } : {}),
            onSelect: () => hostActions.close?.(),
          } satisfies MenuEntry,
        ]
      : []),
    ...(hostActions.deletePoll
      ? [
          {
            kind: "item",
            id: "delete",
            label: "Delete…",
            onSelect: () => hostActions.deletePoll?.(),
          } satisfies MenuEntry,
        ]
      : []),
  ];
  return (
    <MenuButton
      label="Poll actions"
      entries={entries}
      alignEnd
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
    >
      <Icon name="ellipsis" />
    </MenuButton>
  );
}

/**
 * The status line of a poll view (DES-002 2.3.2): state chip, `Tx · Err · ID · F · SR`, the reason
 * text on a tinted line, the freshness chip and Show menu (narrow layout) and the `⋯` menu.
 */
export function StatusLine({ chipInput, compact, width, freshness = "none" }: StatusLineProps) {
  const reasonId = useId();
  const attach = usePoll((s) => s.attach);
  const config = usePoll((s) => s.config);
  const state = usePoll((s) => s.state);
  const exceptionCode = usePoll((s) => s.exceptionCode);
  const badResponse = usePoll((s) => s.badResponse);
  const failures = usePoll((s) => s.consecutiveFailures);
  const counters = usePoll((s) => s.counters);
  const effective = usePoll((s) => s.effectiveScanMs);
  const hasValues = usePollData((s) => s.values !== null);
  const connectionState = usePollConnection((s) => s.state);
  const connectionConfig = usePollConnection((s) => s.connection);

  // The PV "loading (attach)" state: nothing known about the poll yet.
  if (!config) {
    return (
      <StatusStrip tone="none" className="h-7 px-3 text-sm" data-testid="poll-status-line">
        <span className="inline-flex items-center gap-1.5 text-text-muted" data-slot="loading-chip">
          <Icon name="loader" />
          Loading…
        </span>
      </StatusStrip>
    );
  }

  const def = config.definition;
  const timeoutMs = connectionConfig?.timeoutMs ?? 1000;
  const pill = pollPillFor(state, exceptionCode, hasValues);
  const reason = statusLineReason(state, connectionState, {
    timeoutMs,
    exceptionCode,
    badResponse,
  });
  const banner = pollBannerFor(
    { state, exceptionCode, badResponse, consecutiveFailures: failures },
    { definition: def, timeoutMs, addressBase: config.display.addressBase },
  );
  // The tooltip carries the full banner text of DES-001 2.3, or the reason for an offline poll.
  const tooltip = banner?.text ?? reason.text ?? undefined;
  const onWarning = reason.tone === "warning";
  const step = statusLineStep(width, freshness);
  const counterTexts = counterText(
    {
      counters,
      slaveId: def.slaveId,
      fc: def.function,
      scanMs: def.scanRateMs,
      effectiveScanMs: effective,
    },
    step,
  );
  return (
    <StatusStrip
      tone={reason.tone}
      role="group"
      aria-label="Poll status"
      aria-describedby={reason.text ? reasonId : undefined}
      data-testid="poll-status-line"
      data-state={state}
      data-step={step}
      className="h-7 shrink-0 px-3 text-sm"
    >
      <StatusPill
        size="sm"
        variant={pill.variant}
        icon={pill.icon}
        label={pill.label}
        {...(onWarning
          ? { className: "shrink-0 border-dark bg-light" }
          : { className: "shrink-0" })}
        {...(tooltip ? { title: tooltip } : {})}
      />
      {/* The last resort: when nothing else gives, the end of the counters is cut with an ellipsis.
          From step 3 on (parts are dropped) the name and tooltip carry the complete text. */}
      <span
        data-slot="counters"
        data-testid="status-counters"
        title={counterTexts.full}
        {...(step >= 3 ? { role: "group", "aria-label": counterTexts.full } : {})}
        className="min-w-0 truncate whitespace-nowrap font-mono text-[12.5px]"
      >
        {counterTexts.visible}
      </span>
      {reason.text ? (
        // The only growing item: it takes all the space that is left (no spacer element). Hidden at
        // narrow widths, not removed: the line still points at it for its description.
        <span
          id={reasonId}
          title={tooltip}
          data-slot="reason"
          data-testid="status-reason"
          hidden={step >= 2}
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
        >
          {reason.text}
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {compact ? <FreshnessSlot input={chipInput} iconOnly={step >= 1} /> : null}
        {compact ? <ShowMenu iconOnly={step >= 4} /> : null}
        <ActionsMenu />
      </div>
      {attach === "detached" ? <span className="sr-only">Detached</span> : null}
    </StatusStrip>
  );
}
