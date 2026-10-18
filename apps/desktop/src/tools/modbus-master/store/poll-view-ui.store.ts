// The local UI state of one poll view (DES-002 2.3.3, 2.5.4, FE-002 task 07): setup presentation,
// selection and focus by address, scroll, column widths and the unapplied drafts. Nothing here
// goes to Rust. It is what the handoff carries when the poll moves between hosts.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AddressBase, PollConfig } from "@/shared/ipc/modbus-master.types";
import {
  type AddressRange,
  clampRanges,
  normalizeRanges,
  rangeBetween,
  rangesContain,
  sameRanges,
  toggleAddress,
} from "../lib/address-ranges";
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

export type ColumnId = "alias" | "address" | "raw" | "scaled";

/** Minimum widths of the data columns (DES-002 2.3.4). */
export const POLL_COLUMN_MIN_WIDTHS: Readonly<Record<ColumnId, number>> = {
  alias: 96,
  address: 72,
  raw: 96,
  scaled: 120,
};

export const DEFAULT_COLUMN_WIDTHS: Readonly<Record<ColumnId, number>> = {
  alias: 160,
  address: 120,
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
  groupWidth: number;
  ruleDraft: RuleDraft | null;
  inspectedGroupAddress: number | null;
  interpretationDraft: {
    format: string;
    swapBytes: boolean;
    reverseWords: boolean;
    error: string | null;
  } | null;
  /** The setup dock, popover or panel is open. */
  setupOpen: boolean;
  /** Compact mode is on (mirrored from Rust). */
  compact: boolean;
  /** The user opened the setup while compact mode is on (a local override, DES-002 2.9). */
  setupOverride: boolean;
  /** `setupOpen` before compact mode closed it, restored when compact mode ends. */
  setupBeforeCompact: boolean | null;
  /** Selected protocol addresses, as sorted merged ranges. */
  selection: AddressRange[];
  anchorAddress: number | null;
  focusAddress: number | null;
  /** The first visible address. */
  topAddress: number | null;
  columnWidths: Record<ColumnId, number>;
  pollDraft: PollSetupDraft | null;
  scaleDraft: ScaleDraft | null;
}

export interface PollViewUiActions {
  setGroupWidth(width: number): void;
  setRuleDraft(draft: RuleDraft | null): void;
  setInspectedGroupAddress(address: number | null): void;
  setInterpretationDraft(draft: PollViewUiState["interpretationDraft"]): void;
  toggleSetup(): void;
  setSetupOpen(open: boolean): void;
  /** Closes the setup dock, popover or panel (Esc inside the popover, [Done]). */
  closeSetup(): void;
  /** Compact mode changed: the setup closes and the local override ends (or the setup returns). */
  applyCompact(compact: boolean): void;

  /** Click on a row (Shift extends from the anchor, Ctrl toggles). Out-of-range addresses are ignored. */
  click(address: number, mods?: { shift?: boolean; ctrl?: boolean }): void;
  /** Arrow, PageUp and PageDown. Clamped to the poll range. */
  moveFocus(delta: number, mods?: { shift?: boolean }): void;
  /** Home and End. */
  moveFocusTo(address: number, mods?: { shift?: boolean }): void;
  selectAll(): void;
  clearSelection(): void;
  /** The poll range changed (Start or Quantity): selection and focus keep only what is still there. */
  syncRange(): void;
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

function rangeOf(config: PollConfig | null): { start: number; end: number } | null {
  if (!config) return null;
  const { startAddress, quantity } = config.definition;
  return { start: startAddress, end: startAddress + quantity - 1 };
}

const initialState: PollViewUiState = {
  bulkOperationToken: null,
  groupWidth: 1,
  ruleDraft: null,
  inspectedGroupAddress: null,
  interpretationDraft: null,
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
    const clampAddress = (address: number): number | null => {
      const range = rangeOf(deps.getConfig());
      if (!range || address < range.start || address > range.end) return null;
      return address;
    };

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
        const target = clampAddress(address);
        if (target === null) return;
        const s = get();
        if (mods.shift) {
          const from = s.anchorAddress ?? target;
          set({
            anchorAddress: from,
            selection: [rangeBetween(from, target)],
            focusAddress: target,
          });
        } else if (mods.ctrl) {
          set({
            anchorAddress: target,
            selection: toggleAddress(s.selection, target),
            focusAddress: target,
          });
        } else {
          set({
            anchorAddress: target,
            selection: [{ start: target, end: target }],
            focusAddress: target,
          });
        }
      },

      moveFocus(delta, mods = {}) {
        const range = rangeOf(deps.getConfig());
        if (!range) return;
        const base = get().focusAddress ?? (delta > 0 ? range.start - 1 : range.end + 1);
        get().moveFocusTo(Math.min(range.end, Math.max(range.start, base + delta)), mods);
      },

      moveFocusTo(address, mods = {}) {
        const range = rangeOf(deps.getConfig());
        if (!range) return;
        const target = Math.min(range.end, Math.max(range.start, address));
        const s = get();
        if (mods.shift) {
          const from = s.anchorAddress ?? s.focusAddress ?? target;
          set({
            anchorAddress: from,
            selection: [rangeBetween(from, target)],
            focusAddress: target,
          });
        } else {
          set({
            anchorAddress: target,
            selection: [{ start: target, end: target }],
            focusAddress: target,
          });
        }
      },

      selectAll() {
        const range = rangeOf(deps.getConfig());
        if (!range) return;
        set((s) => ({
          anchorAddress: range.start,
          selection: [{ start: range.start, end: range.end }],
          focusAddress: s.focusAddress ?? range.start,
        }));
      },

      clearSelection() {
        set({ selection: [], anchorAddress: null, focusAddress: null });
      },

      syncRange() {
        const range = rangeOf(deps.getConfig());
        if (!range) return;
        const s = get();
        const selection = clampRanges(s.selection, range.start, range.end);
        const inside = (a: number | null) =>
          a !== null && a >= range.start && a <= range.end ? a : null;
        const next = {
          selection: sameRanges(selection, s.selection) ? s.selection : selection,
          anchorAddress: inside(s.anchorAddress),
          focusAddress: inside(s.focusAddress),
          topAddress: inside(s.topAddress),
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
      setGroupWidth(width) {
        set({ groupWidth: width });
      },
      setRuleDraft(draft) {
        set({ ruleDraft: draft });
      },
      setInterpretationDraft(draft) {
        set({ interpretationDraft: draft });
      },
      setInspectedGroupAddress(address) {
        set({ inspectedGroupAddress: address });
      },

      toHandoff() {
        const s = get();
        const handoff: PollViewHandoffV1 = {
          version: 1,
          inspectedGroupAddress: s.inspectedGroupAddress,
          groupWidth: s.groupWidth,
          ruleDraft: s.ruleDraft,
          interpretationDraft: s.interpretationDraft,
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
          columnWidths: clampWidths(handoff.columnWidths),
          pollDraft: handoff.pollDraft
            ? { ...handoff.pollDraft, errors: { ...handoff.pollDraft.errors } }
            : null,
          scaleDraft: handoff.scaleDraft,
          inspectedGroupAddress: handoff.inspectedGroupAddress ?? null,
          groupWidth: handoff.groupWidth ?? 1,
          ruleDraft: handoff.ruleDraft ?? null,
          interpretationDraft: handoff.interpretationDraft ?? null,
        });
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
