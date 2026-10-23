// The local UI state of one poll view (DES-002 2.3.3, 2.5.4, FE-002 task 07): setup presentation,
// selection and focus, scroll, column widths and the unapplied drafts. Selection and focus move by
// ROW (DES-009 3.3): a row is one register or one 32/64-bit group, and the selection always covers
// whole rows, kept as protocol address ranges. Nothing here goes to Rust. It is what the handoff
// carries when the poll moves between hosts.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AddressBase, PollConfig } from "@/shared/ipc/modbus-master.types";
import {
  type AddressRange,
  normalizeRanges,
  rangesContain,
  sameRanges,
} from "../lib/address-ranges";
import { type FormatRow, rowAt, rowsOfConfig, snapRangesToRows } from "../lib/format-overrides";
import { type PollViewHandoffV1, parseHandoff, serializeHandoff } from "../lib/handoff";
import {
  type DraftContext,
  type PollDraftField,
  type PollSetupDraft,
  patchDraft,
  rebaseDraft,
  reconcileDraft,
  validateDraftField,
} from "./poll-draft.logic";
import type { RuleDraft } from "./rule-draft";

export type ColumnId = "alias" | "address" | "format" | "raw" | "scaled";

/** Minimum widths of the data columns (DES-002 2.3.4). */
export const POLL_COLUMN_MIN_WIDTHS: Readonly<Record<ColumnId, number>> = {
  alias: 96,
  address: 72,
  format: 64,
  raw: 96,
  scaled: 120,
};

export const DEFAULT_COLUMN_WIDTHS: Readonly<Record<ColumnId, number>> = {
  alias: 160,
  address: 120,
  format: 96,
  raw: 160,
  scaled: 160,
};

/**
 * The scale editor's unapplied state (`scaleDraftStore` fills `fields`). The handoff carries it as it is, and
 * `dirty` counts as an unapplied edit for the close confirms.
 */
export interface ScaleDraft {
  dirty: boolean;
  fields: Record<string, unknown>;
}

export interface PollViewUiState {
  bulkOperationToken: string | null;
  ruleDraft: RuleDraft | null;
  /** The row whose raw registers the inspector shows (its first in-poll address). */
  inspectedGroupAddress: number | null;
  /** The setup dock, popover or panel is open. */
  setupOpen: boolean;
  /** Compact mode is on (mirrored from Rust). */
  compact: boolean;
  /** The user opened the setup while compact mode is on (a local override, DES-002 2.9). */
  setupOverride: boolean;
  /** `setupOpen` before compact mode closed it, restored when compact mode ends. */
  setupBeforeCompact: boolean | null;
  /** Selected protocol addresses, as sorted merged ranges of whole rows. */
  selection: AddressRange[];
  /** Always the `address` of a row. */
  anchorAddress: number | null;
  /** Always the `address` of a row. */
  focusAddress: number | null;
  /** The address of the first visible row. */
  topAddress: number | null;
  columnWidths: Record<ColumnId, number>;
  pollDraft: PollSetupDraft | null;
  scaleDraft: ScaleDraft | null;
}

export interface PollViewUiActions {
  setRuleDraft(draft: RuleDraft | null): void;
  setInspectedGroupAddress(address: number | null): void;
  toggleSetup(): void;
  setSetupOpen(open: boolean): void;
  /** Closes the setup dock, popover or panel (Esc inside the popover, [Done]). */
  closeSetup(): void;
  /** Compact mode changed: the setup closes and the local override ends (or the setup returns). */
  applyCompact(compact: boolean): void;

  /**
   * Click on the row that contains `address` (Shift extends from the anchor, Ctrl toggles); the row
   * is selected whole. Addresses outside the poll range are ignored.
   */
  click(address: number, mods?: { shift?: boolean; ctrl?: boolean }): void;
  /** Arrow, PageUp and PageDown: `delta` rows. Clamped to the first and last row. */
  moveFocus(delta: number, mods?: { shift?: boolean }): void;
  /** Home and End: the row that contains `address`, clamped to the first and last row. */
  moveFocusTo(address: number, mods?: { shift?: boolean }): void;
  selectAll(): void;
  /** Esc: nothing is selected, the focused row stays and becomes the anchor (DES-009 11.8). */
  clearSelection(): void;
  /** Moves the focus to the row that contains `address` and leaves the selection as it is. */
  setFocusRow(address: number): void;
  /**
   * The rows changed (a format, Start, Quantity or the function): focus and anchor move to the row
   * that now contains their old address (the first row when it is gone), the selection is widened to
   * whole rows and clipped to the poll range.
   */
  syncRows(): void;
  setTopAddress(address: number | null): void;
  setColumnWidth(id: ColumnId, px: number): void;

  /** Types into a field of the POLL section. */
  patchPollDraft(field: PollDraftField, text: string): void;
  setPollDraft(draft: PollSetupDraft | null): void;
  /** Shows the message of one field (blur). */
  checkPollDraftField(field: PollDraftField, ctx: DraftContext): void;
  /** The applied poll changed: untouched fields follow it, a changed base converts the start text. */
  reconcileConfig(config: PollConfig, previousBase?: AddressBase): void;
  setScaleDraft(draft: ScaleDraft | null): void;

  /** The `PollViewHandoffV1` JSON of this view. */
  toHandoff(): string;
  /** Applies a handoff. An invalid or missing one is ignored (returns false). */
  applyHandoff(json: string | null | undefined): boolean;
}

export type PollViewUiStore = PollViewUiState & PollViewUiActions;
export type PollViewUiStoreApi = StoreApi<PollViewUiStore>;

export interface PollViewUiDeps {
  /** The applied poll (for the address range and the draft). */
  getConfig(): PollConfig | null;
  /**
   * The rows of the applied poll, in address order (`formatRows`). The runtime hands over its
   * memoized list; without it the rows are derived from the config.
   */
  getRows?(): readonly FormatRow[];
  /** A native window shows its setup panel at first; a sub-window starts with it closed. */
  initialSetupOpen?: boolean;
}

/** A handoff is only schema-valid: a width below the column minimum would hide the column. */
function clampWidths(widths: Record<ColumnId, number>): Record<ColumnId, number> {
  const out = { ...widths };
  for (const id of Object.keys(POLL_COLUMN_MIN_WIDTHS) as ColumnId[]) {
    out[id] = Math.max(
      POLL_COLUMN_MIN_WIDTHS[id],
      Math.round(out[id] ?? DEFAULT_COLUMN_WIDTHS[id]),
    );
  }
  return out;
}

const NO_ROWS: readonly FormatRow[] = [];

const initialState: PollViewUiState = {
  bulkOperationToken: null,
  ruleDraft: null,
  inspectedGroupAddress: null,
  setupOpen: false,
  compact: false,
  setupOverride: false,
  setupBeforeCompact: null,
  selection: [],
  anchorAddress: null,
  focusAddress: null,
  topAddress: null,
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
  pollDraft: null,
  scaleDraft: null,
};

export function createPollViewUiStore(deps: PollViewUiDeps): PollViewUiStoreApi {
  return createStore<PollViewUiStore>()((set, get) => {
    const rows = (): readonly FormatRow[] =>
      deps.getRows ? deps.getRows() : deps.getConfig() ? rowsOfConfig(deps.getConfig()) : NO_ROWS;
    /** The row that contains the address, or null when the address is not in the poll. */
    const rowFor = (list: readonly FormatRow[], address: number): FormatRow | null =>
      list[rowAt(list, address)] ?? null;
    const rangeOfRow = (row: FormatRow): AddressRange => ({
      start: row.address,
      end: row.endAddress,
    });
    /** The whole rows between two rows, in either order. */
    const spanOf = (a: FormatRow, b: FormatRow): AddressRange => ({
      start: Math.min(a.address, b.address),
      end: Math.max(a.endAddress, b.endAddress),
    });

    return {
      ...initialState,
      setupOpen: deps.initialSetupOpen ?? false,

      toggleSetup() {
        get().setSetupOpen(!get().setupOpen);
      },

      setSetupOpen(open) {
        const { compact } = get();
        // In compact mode a single view can still open its setup; that override ends when
        // compact mode is toggled again.
        set({ setupOpen: open, ...(compact ? { setupOverride: open } : {}) });
      },

      closeSetup() {
        get().setSetupOpen(false);
      },

      applyCompact(compact) {
        const s = get();
        if (compact === s.compact) return;
        if (compact) {
          set({
            compact: true,
            setupBeforeCompact: s.setupOpen,
            setupOpen: false,
            setupOverride: false,
          });
        } else {
          set({
            compact: false,
            setupOpen: s.setupBeforeCompact ?? s.setupOpen,
            setupBeforeCompact: null,
            setupOverride: false,
          });
        }
      },

      click(address, mods = {}) {
        const list = rows();
        const target = rowFor(list, address);
        if (!target) return;
        const s = get();
        if (mods.shift) {
          const from = s.anchorAddress === null ? null : rowFor(list, s.anchorAddress);
          const anchor = from ?? target;
          set({
            anchorAddress: anchor.address,
            selection: [spanOf(anchor, target)],
            focusAddress: target.address,
          });
        } else if (mods.ctrl) {
          const selected = rangesContain(s.selection, target.address);
          const selection = selected
            ? normalizeRanges(
                s.selection.flatMap((r) => {
                  if (target.address < r.start || target.address > r.end) return [r];
                  return [
                    ...(r.start < target.address
                      ? [{ start: r.start, end: target.address - 1 }]
                      : []),
                    ...(target.endAddress < r.end
                      ? [{ start: target.endAddress + 1, end: r.end }]
                      : []),
                  ];
                }),
              )
            : normalizeRanges([...s.selection, rangeOfRow(target)]);
          set({ anchorAddress: target.address, selection, focusAddress: target.address });
        } else {
          set({
            anchorAddress: target.address,
            selection: [rangeOfRow(target)],
            focusAddress: target.address,
          });
        }
      },

      moveFocus(delta, mods = {}) {
        const list = rows();
        if (list.length === 0) return;
        const s = get();
        const at = s.focusAddress === null ? -1 : rowAt(list, s.focusAddress);
        const from = at !== -1 ? at : delta > 0 ? -1 : list.length;
        const index = Math.min(list.length - 1, Math.max(0, from + delta));
        get().moveFocusTo((list[index] as FormatRow).address, mods);
      },

      moveFocusTo(address, mods = {}) {
        const list = rows();
        const first = list[0];
        const last = list[list.length - 1];
        if (!first || !last) return;
        const clamped = Math.min(last.address, Math.max(first.address, address));
        const target = rowFor(list, clamped) ?? first;
        const s = get();
        if (mods.shift) {
          const known = s.anchorAddress ?? s.focusAddress;
          const from = known === null ? null : rowFor(list, known);
          const anchor = from ?? target;
          set({
            anchorAddress: anchor.address,
            selection: [spanOf(anchor, target)],
            focusAddress: target.address,
          });
        } else {
          set({
            anchorAddress: target.address,
            selection: [rangeOfRow(target)],
            focusAddress: target.address,
          });
        }
      },

      selectAll() {
        const list = rows();
        const first = list[0];
        const last = list[list.length - 1];
        if (!first || !last) return;
        set((s) => ({
          anchorAddress: first.address,
          selection: [{ start: first.address, end: last.endAddress }],
          focusAddress: s.focusAddress ?? first.address,
        }));
      },

      clearSelection() {
        const { selection, anchorAddress, focusAddress } = get();
        if (selection.length === 0 && anchorAddress === focusAddress) return;
        set({ selection: [], anchorAddress: focusAddress });
      },

      setFocusRow(address) {
        const list = rows();
        const row = rowFor(list, address);
        if (row && get().focusAddress !== row.address) set({ focusAddress: row.address });
      },

      syncRows() {
        const list = rows();
        const first = list[0];
        if (!first) return;
        const s = get();
        const selection = snapRangesToRows(list, s.selection);
        /** The row address that now contains `address`; `whenGone` when it left the poll; null stays. */
        const snap = (address: number | null, whenGone: number | null): number | null => {
          if (address === null) return null;
          return rowFor(list, address)?.address ?? whenGone;
        };
        const next = {
          selection: sameRanges(selection, s.selection) ? s.selection : selection,
          anchorAddress: snap(s.anchorAddress, first.address),
          focusAddress: snap(s.focusAddress, first.address),
          topAddress: snap(s.topAddress, null),
        };
        if (
          next.selection !== s.selection ||
          next.anchorAddress !== s.anchorAddress ||
          next.focusAddress !== s.focusAddress ||
          next.topAddress !== s.topAddress
        ) {
          set(next);
        }
      },

      setTopAddress(address) {
        if (get().topAddress !== address) set({ topAddress: address });
      },

      setColumnWidth(id, px) {
        const width = Math.max(POLL_COLUMN_MIN_WIDTHS[id], Math.round(px));
        if (get().columnWidths[id] === width) return;
        set((s) => ({ columnWidths: { ...s.columnWidths, [id]: width } }));
      },

      patchPollDraft(field, text) {
        const config = deps.getConfig();
        if (!config) return;
        const next = patchDraft(get().pollDraft, config, field, text);
        set({ pollDraft: next.dirty.length === 0 ? null : next });
      },

      setPollDraft(draft) {
        set({ pollDraft: draft });
      },

      checkPollDraftField(field, ctx) {
        const draft = get().pollDraft;
        if (draft) set({ pollDraft: validateDraftField(draft, field, ctx) });
      },

      reconcileConfig(config, previousBase) {
        const draft = get().pollDraft;
        if (draft === null) return;
        const rebased =
          previousBase === undefined
            ? draft
            : rebaseDraft(draft, previousBase, config.display.addressBase);
        const next = reconcileDraft(rebased, config);
        if (next !== draft) set({ pollDraft: next });
      },

      setScaleDraft(draft) {
        set({ scaleDraft: draft });
      },
      setRuleDraft(draft) {
        set({ ruleDraft: draft });
      },
      setInspectedGroupAddress(address) {
        set({ inspectedGroupAddress: address });
      },

      toHandoff() {
        const s = get();
        const handoff: PollViewHandoffV1 = {
          version: 1,
          inspectedGroupAddress: s.inspectedGroupAddress,
          ruleDraft: s.ruleDraft,
          setupOpen: s.setupOpen,
          setupOverride: s.setupOverride,
          selection: s.selection.map((r) => ({ ...r })),
          anchorAddress: s.anchorAddress,
          focusAddress: s.focusAddress,
          topAddress: s.topAddress,
          columnWidths: { ...s.columnWidths },
          pollDraft: s.pollDraft
            ? { ...s.pollDraft, dirty: [...s.pollDraft.dirty], errors: { ...s.pollDraft.errors } }
            : null,
          scaleDraft: s.scaleDraft
            ? { dirty: s.scaleDraft.dirty, fields: { ...s.scaleDraft.fields } }
            : null,
        };
        return serializeHandoff(handoff);
      },

      applyHandoff(json) {
        const handoff = parseHandoff(json);
        if (!handoff) return false;
        const { compact } = get();
        // Compact rules apply on arrival: the setup opens only when the user had overridden them.
        const open = compact ? handoff.setupOpen && handoff.setupOverride : handoff.setupOpen;
        set({
          setupOpen: open,
          setupOverride: compact ? open : false,
          setupBeforeCompact: compact ? handoff.setupOpen : null,
          selection: normalizeRanges(handoff.selection),
          anchorAddress: handoff.anchorAddress,
          focusAddress: handoff.focusAddress,
          topAddress: handoff.topAddress,
          columnWidths: clampWidths({
            alias: handoff.columnWidths.alias,
            address: handoff.columnWidths.address,
            format: handoff.columnWidths.format ?? DEFAULT_COLUMN_WIDTHS.format,
            raw: handoff.columnWidths.raw,
            scaled: handoff.columnWidths.scaled,
          }),
          pollDraft: handoff.pollDraft
            ? { ...handoff.pollDraft, errors: { ...handoff.pollDraft.errors } }
            : null,
          scaleDraft: handoff.scaleDraft,
          inspectedGroupAddress: handoff.inspectedGroupAddress ?? null,
          ruleDraft: handoff.ruleDraft ?? null,
        });
        // The handoff holds addresses, not rows: whole rows again for this window's formats.
        get().syncRows();
        return true;
      },
    };
  });
}

// ---- typed selectors (rows select only their own slice) ----
export const selectSetupOpen = (s: PollViewUiStore) => s.setupOpen;
export const selectCompact = (s: PollViewUiStore) => s.compact;
export const selectSelection = (s: PollViewUiStore) => s.selection;
export const selectFocusAddress = (s: PollViewUiStore) => s.focusAddress;
export const selectTopAddress = (s: PollViewUiStore) => s.topAddress;
export const selectColumnWidths = (s: PollViewUiStore) => s.columnWidths;
export const selectPollDraft = (s: PollViewUiStore) => s.pollDraft;
export const selectScaleDraft = (s: PollViewUiStore) => s.scaleDraft;
/** A row subscribes to this: it re-renders only when its own selected flag changes. */
export const selectIsSelected = (address: number) => (s: PollViewUiStore) =>
  rangesContain(s.selection, address);
export const selectIsFocused = (address: number) => (s: PollViewUiStore) =>
  s.focusAddress === address;
