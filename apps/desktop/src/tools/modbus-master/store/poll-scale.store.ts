// The applied scale of one poll view (DES-003 1.1, FE-003 task 03): a mirror of the poll's scale,
// overrides and value columns, and the commands that change them. Rust owns the settings; every
// change is one `mm_set_poll_view` patch (omitted keys stay as they are, `scale: null` removes the
// scale) and the store follows `PollConfigChanged`. The unapplied edits live in the scale draft
// store, not here.
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  DisplaySettings,
  PollConfig,
  PollViewSettings,
  ScaleOverride,
  ScaleSettings,
  ValueColumns,
} from "@/shared/ipc/modbus-master.types";
import type { AddressRange } from "../lib/address-ranges";
import { isCombinedFormat } from "../lib/combined";
import { overrideRangesMessage } from "../lib/scale-validation";
import { effectiveValueColumns, scaleActive, scaleAvailable } from "../lib/scaled";
import {
  nextValueColumns,
  overridesForRanges,
  patchForOverrides,
  patchForScale,
  sameScale,
  withoutOverridesIn,
} from "./poll-scale.logic";

export interface PollScaleState {
  display: DisplaySettings | null;
  /** The applied poll scale; null is None. */
  scale: ScaleSettings | null;
  overrides: ScaleOverride[];
  valueColumns: ValueColumns;
  /** False for FC01/02: a saved scale is kept and ignored (DES-003 1.5). */
  scaleActive: boolean;
  /** A change is on its way to Rust. */
  pending: boolean;
}

export interface PollScaleActions {
  /** The poll's config arrived (snapshot, `PollConfigChanged` or the optimistic copy). */
  applyFromConfig(config: PollConfig): void;
  /** Applies a validated scale; the first scale of a poll switches the table to Both. null removes it. */
  applyScale(scale: ScaleSettings | null): Promise<boolean>;
  clearScale(): Promise<boolean>;
  /** One override per range; false (no command) when they overlap or exceed 64. */
  addOverrides(ranges: readonly AddressRange[], scale: ScaleSettings): Promise<boolean>;
  updateOverride(index: number, override: ScaleOverride): Promise<boolean>;
  /** Removes every override that touches any of these addresses. */
  removeOverrides(ranges: readonly AddressRange[]): Promise<boolean>;
  setValueColumns(columns: ValueColumns): Promise<boolean>;
  /** Raw, Scaled, Both. */
  cycleValueColumns(): Promise<boolean>;
}

export type PollScaleStore = PollScaleState & PollScaleActions;
export type PollScaleStoreApi = StoreApi<PollScaleStore>;

export interface PollScaleDeps {
  getConfig(): PollConfig | null;
  /** `pollStore.setView`. */
  setView(partial: Partial<PollViewSettings>): Promise<boolean>;
}

const initialState: PollScaleState = {
  display: null,
  scale: null,
  overrides: [],
  valueColumns: "raw",
  scaleActive: true,
  pending: false,
};

export function createPollScaleStore(deps: PollScaleDeps): PollScaleStoreApi {
  return createStore<PollScaleStore>()((set, get) => {
    /** One `setView` call with a pending flag. */
    async function send(patch: Partial<PollViewSettings>): Promise<boolean> {
      set({ pending: true });
      try {
        return await deps.setView(patch);
      } finally {
        set({ pending: false });
      }
    }

    return {
      ...initialState,

      applyFromConfig(config) {
        set({
          display: config.display,
          scale: config.scale,
          overrides: config.scaleOverrides,
          valueColumns: config.valueColumns,
          scaleActive: scaleActive(config),
        });
      },

      async applyScale(scale) {
        const config = deps.getConfig();
        if (!config) return false;
        // Nothing to send when the poll already has exactly this scale.
        if (sameScale(config.scale, scale)) return true;
        return send(patchForScale(config, scale));
      },

      clearScale() {
        return get().applyScale(null);
      },

      async addOverrides(ranges, scale) {
        const config = deps.getConfig();
        if (!config || ranges.length === 0) return false;
        if (
          overrideRangesMessage(ranges, config.scaleOverrides, config.display.addressBase) !== null
        ) {
          return false;
        }
        return send(
          patchForOverrides(config, [
            ...config.scaleOverrides,
            ...overridesForRanges(ranges, scale),
          ]),
        );
      },

      async updateOverride(index, override) {
        const config = deps.getConfig();
        if (!config || config.scaleOverrides[index] === undefined) return false;
        if (
          overrideRangesMessage(
            [override],
            config.scaleOverrides,
            config.display.addressBase,
            index,
          )
        ) {
          return false;
        }
        const next = config.scaleOverrides.map((o, i) => (i === index ? override : o));
        return send(patchForOverrides(config, next));
      },

      async removeOverrides(ranges) {
        const config = deps.getConfig();
        if (!config) return false;
        const next = withoutOverridesIn(config.scaleOverrides, ranges);
        if (next.length === config.scaleOverrides.length) return false;
        return send(patchForOverrides(config, next));
      },

      async setValueColumns(columns) {
        const config = deps.getConfig();
        if (!config || config.valueColumns === columns) return true;
        if (isCombinedFormat(config.display.format)) return true;
        return send({ valueColumns: columns });
      },

      async cycleValueColumns() {
        const config = deps.getConfig();
        if (!config) return false;
        // While the Show control is disabled (no scale, or a coil or discrete poll) the key does
        // nothing, and a stored "scaled" is not rewritten (the table shows Raw meanwhile).
        if (!scaleAvailable(config)) return true;
        return get().setValueColumns(nextValueColumns(effectiveValueColumns(config), true));
      },
    };
  });
}

// ---- typed selectors ----
export const selectScale = (s: PollScaleStore) => s.scale;
export const selectOverrides = (s: PollScaleStore) => s.overrides;
export const selectValueColumns = (s: PollScaleStore) => s.valueColumns;
export const selectScaleActive = (s: PollScaleStore) => s.scaleActive;
export const selectScalePending = (s: PollScaleStore) => s.pending;
/** The poll has a scale or any override. */
export const selectAnyScale = (s: PollScaleStore) =>
  (s.scale !== null && s.scale.preset !== "none") || s.overrides.length > 0;
