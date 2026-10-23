// The draft of the Format dialog D1 of one poll view (DES-009 section 4, FE-009 task 04). Rust owns
// the formats (`PollConfig.formatOverrides`); this store holds only what the user is choosing: the
// scope captured at open, the chosen format and order, and the Apply progress. The plan (what the
// choice would do to the overrides) is derived by `selectPlan` from the draft and the applied
// config, so it follows a config that changes while the dialog is open.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FormatOverride, PollConfig, ValueFormat } from "@/shared/ipc/modbus-master.types";
import {
  type AddressRange,
  clampRanges,
  countAddresses,
  formatRanges,
  normalizeRanges,
} from "../lib/address-ranges";
import { firstRuleConflict } from "../lib/color-rules";
import { widthAvailability } from "../lib/format-dialog-model";
import {
  appliedAnnouncement,
  applyFailedMessage,
  ruleConflictMessage,
} from "../lib/format-messages";
import {
  DEFAULT_FORMAT,
  DEFAULT_ORDER,
  type FormatRow,
  initialChoice,
  type OrderId,
  type Plan,
  planFormatChange,
  widenToRows,
} from "../lib/format-overrides";

/** Where D1 was opened from: decides where the focus goes when it closes (DES-009 4.7). */
export type FormatDialogOrigin = "grid" | "header" | "showMenu";

/**
 * V valid, C valid but splits existing groups, U the result equals the current overrides, T more than
 * 256 overrides (DES-010 11.1). R, P and F are the Apply progress (`error` and `pending`).
 */
export type FormatDialogStatus = "V" | "C" | "U" | "T";

export interface FormatDialogError {
  /** `rule`: a color rule does not fit the new formats (R). `ipc`: Rust rejected the change (F). */
  kind: "rule" | "ipc";
  text: string;
}

export interface FormatDialogState {
  open: boolean;
  /** Protocol ranges, clipped to the poll range, always whole rows (`widenToRows`). */
  scope: AddressRange[];
  origin: FormatDialogOrigin;
  /** The row that opened D1, for the focus return. */
  originAddress: number | null;
  /** Always one format is checked (DES-009 11.3). */
  format: ValueFormat;
  order: OrderId;
  /** The scope uses more than one format now: the non-blocking mixed note. */
  mixed: boolean;
  /** State P: the change is on its way to Rust. */
  pending: boolean;
  error: FormatDialogError | null;
}

export type ApplyResult = "closed" | "blocked" | "failed";

export interface FormatDialogActions {
  /** Opens D1 for a scope. False (and nothing opens) for an empty scope, a missing config or a dialog that is busy. */
  openFor(
    scope: readonly AddressRange[],
    origin: FormatDialogOrigin,
    originAddress: number | null,
  ): boolean;
  setFormat(format: ValueFormat): void;
  setOrder(order: OrderId): void;
  /** Apply: "closed" when done, "blocked" when it cannot be sent (nothing was), "failed" when Rust rejected it. */
  apply(): Promise<ApplyResult>;
  /** Cancel, Esc, x, overlay. Ignored while the change is on its way. */
  close(): void;
  /**
   * The poll went away (deleted, detached, range lost): closes at once without applying, also while
   * the change is on its way; its reply is then ignored (DES-009 11.12).
   */
  closeForRemoval(): void;
}

export type FormatDialogStore = FormatDialogState & FormatDialogActions;
export type FormatDialogStoreApi = StoreApi<FormatDialogStore>;

export interface FormatDialogDeps {
  getConfig(): PollConfig | null;
  /** The rows of the applied poll (`formatRows`), to widen the scope to whole rows. */
  getRows(): readonly FormatRow[];
  /** `poll.setView({ formatOverrides })`: true when Rust acknowledged it. */
  applyFormatOverrides(overrides: FormatOverride[]): Promise<boolean>;
  /** The text of the last rejected command, for M-F. */
  getCommandError(): string | null;
  /** The polite announcement after a successful Apply. */
  announce(text: string): void;
}

const initialState: FormatDialogState = {
  open: false,
  scope: [],
  origin: "grid",
  originAddress: null,
  format: DEFAULT_FORMAT,
  order: DEFAULT_ORDER,
  mixed: false,
  pending: false,
  error: null,
};

export function createFormatDialogStore(deps: FormatDialogDeps): FormatDialogStoreApi {
  // A completion that arrives after the dialog closed or reopened must not write to the new state.
  let generation = 0;
  return createStore<FormatDialogStore>()((set, get) => ({
    ...initialState,

    openFor(scope, origin, originAddress) {
      const config = deps.getConfig();
      if (!config || get().pending) return false;
      const { startAddress, quantity } = config.definition;
      const pollRange = { start: startAddress, end: startAddress + quantity - 1 };
      // Whole rows always (DES-009 11.2): a group row contributes all its in-poll registers, whatever
      // the caller handed over.
      const widened = widenToRows(
        clampRanges(normalizeRanges(scope), pollRange.start, pollRange.end),
        deps.getRows(),
      );
      if (widened.length === 0) return false;
      const choice = initialChoice({
        overrides: config.formatOverrides,
        scope: widened,
        pollRange,
      });
      generation += 1;
      set({
        open: true,
        scope: widened,
        origin,
        originAddress,
        format: choice.format,
        order: choice.order,
        mixed: choice.mixed,
        pending: false,
        error: null,
      });
      return true;
    },

    setFormat(format) {
      if (get().pending) return;
      set({ format, error: null });
    },

    setOrder(order) {
      if (get().pending) return;
      set({ order, error: null });
    },

    async apply() {
      const state = get();
      const config = deps.getConfig();
      if (!state.open || state.pending || !config) return "blocked";
      const derived = selectPlan(state, config);
      const plan = derived.plan;
      if (!derived.applyEnabled || plan.kind !== "ok") return "blocked";
      // U: nothing to change, nothing to send.
      if (plan.unchanged) {
        set({ open: false, error: null });
        return "closed";
      }
      // R: a color rule would become invalid under the new formats. Rust repeats this check.
      const conflict = firstRuleConflict(config.colorRules, plan.overrides);
      if (conflict) {
        set({
          error: { kind: "rule", text: ruleConflictMessage(conflict.name, conflict.message) },
        });
        return "blocked";
      }
      const mine = generation;
      const { format, order } = state;
      set({ pending: true, error: null });
      const ok = await deps.applyFormatOverrides(plan.overrides);
      if (mine !== generation || !get().open) return ok ? "closed" : "failed";
      if (!ok) {
        set({
          pending: false,
          error: { kind: "ipc", text: applyFailedMessage(deps.getCommandError()) },
        });
        return "failed";
      }
      set({ open: false, pending: false, error: null });
      const base = config.display.addressBase;
      deps.announce(
        plan.groups.length > 0
          ? appliedAnnouncement(format, order, normalizeRanges(plan.groups), base)
          : `No complete value fits this poll. ${formatRanges(plan.tails, base)} ${countAddresses(plan.tails) === 1 ? "stays" : "stay"} Unsigned 16-bit.`,
      );
      return "closed";
    },

    close() {
      const { pending, open } = get();
      if (!open || pending) return;
      generation += 1;
      set({ open: false, pending: false, error: null });
    },

    closeForRemoval() {
      if (!get().open) return;
      generation += 1;
      set({ open: false, pending: false, error: null });
    },
  }));
}

export interface DerivedPlan {
  plan: Plan;
  status: FormatDialogStatus;
  applyEnabled: boolean;
}

/** What the current choice would do, and whether Apply is enabled (DES-010 9, DES-009 4.6). */
export function selectPlan(
  state: Pick<FormatDialogState, "scope" | "format" | "order">,
  config: Pick<PollConfig, "formatOverrides" | "definition">,
): DerivedPlan {
  const plan = planFormatChange({
    overrides: config.formatOverrides,
    scope: state.scope,
    choice: { format: state.format, order: state.order },
    pollRange: {
      start: config.definition.startAddress,
      end: config.definition.startAddress + config.definition.quantity - 1,
    },
  });
  switch (plan.kind) {
    // A closed dialog has no scope; there is nothing to apply.
    case "empty":
      return { plan, status: "V", applyEnabled: false };
    case "tooMany":
      return { plan, status: "T", applyEnabled: false };
    case "ok": {
      const status: FormatDialogStatus = plan.unchanged ? "U" : plan.cuts.length > 0 ? "C" : "V";
      return { plan, status, applyEnabled: true };
    }
  }
}

// ---- typed selectors ----
export const selectFormatDialogOpen = (s: FormatDialogStore) => s.open;
export const selectFormatDialogPending = (s: FormatDialogStore) => s.pending;
export const selectFormatDialogError = (s: FormatDialogStore) => s.error;
export const selectFormatDialogFormat = (s: FormatDialogStore) => s.format;
export const selectFormatDialogOrder = (s: FormatDialogStore) => s.order;
export const selectFormatDialogScope = (s: FormatDialogStore) => s.scope;
/** Whether a width (1, 2 or 4 registers per value) fits the selection of the open dialog (D-010-01). */
export const selectWidthAvailability =
  (width: 1 | 2 | 4, base: 0 | 1 = 0) =>
  (s: Pick<FormatDialogState, "scope">) =>
    widthAvailability({ scope: s.scope, width, base });
