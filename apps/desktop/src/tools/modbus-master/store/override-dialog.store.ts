// The S8 scale override dialog (DES-003 3.2, FE-003 task 06): one editor for the scale of one or
// more address ranges. Opened from the selected rows (the ranges are fixed: "Applies to 0-1, 5,
// 9-12"), from [+ Add override] (Start and End fields in the display base) or from [Edit]. Saving
// applies the overrides; there is no separate Apply.
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  AddressBase,
  PollConfig,
  ScaleOverride,
  ScalePreset,
} from "@/shared/ipc/modbus-master.types";
import { toDisplayAddress } from "../lib/address";
import type { AddressRange } from "../lib/address-ranges";
import { RAW_QUICK_PICKS } from "../lib/scale-presets";
import {
  type DivisorMode,
  fieldsOf,
  formFromSettings,
  overrideRangesMessage,
  overrideSchema,
  type ScaleErrors,
  type ScaleFieldName,
  type ScaleForm,
  validateScaleForm,
} from "../lib/scale-validation";
import { validate } from "../validation/schemas";
import type { PollScaleStoreApi } from "./poll-scale.store";
import {
  activeErrors,
  errorsForFields,
  relatedFields,
  withDivisorMode,
  withField,
  withOutOfRange,
  withPreset,
  withQuickPick,
} from "./scale-form.logic";

export type OverrideDialogMode = "selection" | "new" | "edit";

export interface OverrideDialogState {
  open: boolean;
  mode: OverrideDialogMode;
  /** Protocol addresses the override applies to (selection mode); the parsed Start and End otherwise. */
  ranges: AddressRange[];
  /** Start and End as typed, in the display base (new and edit). */
  startText: string;
  endText: string;
  editingIndex: number | null;
  form: ScaleForm;
  errors: ScaleErrors;
  startError: string | null;
  endError: string | null;
  /** Overlap and the 64-override limit. */
  rangeError: string | null;
  pending: boolean;
}

export interface OverrideDialogActions {
  /** The ranges are the selected rows' contiguous runs. A selection of nothing opens nothing. */
  openForSelection(ranges: readonly AddressRange[]): boolean;
  openNew(prefill?: number | null): void;
  openEdit(index: number): void;
  setPreset(preset: ScalePreset): void;
  setField(field: ScaleFieldName, value: string): void;
  setRawSigned(signed: boolean): void;
  setDivisorMode(mode: DivisorMode): void;
  setOutOfRange(mode: "flag" | "clamp"): void;
  quickPick(label: string): void;
  setStart(text: string): void;
  setEnd(text: string): void;
  /** A scale field was left. */
  blur(field: ScaleFieldName): void;
  /** Start or End was left. */
  blurRange(): void;
  /** Validates everything, then applies. True when the dialog saved and closed. */
  save(): Promise<boolean>;
  close(): void;
}

export type OverrideDialogStore = OverrideDialogState & OverrideDialogActions;
export type OverrideDialogStoreApi = StoreApi<OverrideDialogStore>;

export interface OverrideDialogDeps {
  getConfig(): PollConfig | null;
  scale: Pick<PollScaleStoreApi, "getState">;
}

function emptyState(): OverrideDialogState {
  return {
    open: false,
    mode: "selection",
    ranges: [],
    startText: "",
    endText: "",
    editingIndex: null,
    form: formFromSettings(null, false),
    errors: {},
    startError: null,
    endError: null,
    rangeError: null,
    pending: false,
  };
}

/** The form a new override starts from: the poll's scale when it has one, else Divide by 10. */
export function initialOverrideForm(config: PollConfig | null): ScaleForm {
  const signed = config?.display.format === "signed";
  if (config?.scale && config.scale.preset !== "none")
    return formFromSettings(config.scale, signed);
  return withPreset(formFromSettings(null, signed), "divide");
}

export function createOverrideDialogStore(deps: OverrideDialogDeps): OverrideDialogStoreApi {
  return createStore<OverrideDialogStore>()((set, get) => {
    const base = (): AddressBase => deps.getConfig()?.display.addressBase ?? 0;
    const existing = () => deps.getConfig()?.scaleOverrides ?? [];

    function editForm(form: ScaleForm, errors: ScaleErrors): void {
      set({ form, errors });
    }

    /** Start and End as protocol ranges, or the messages. */
    function checkRange(): { ok: true; range: AddressRange } | { ok: false } {
      const s = get();
      const parsed = validate(overrideSchema(base(), existing(), s.editingIndex), {
        start: s.startText,
        end: s.endText,
      });
      if (parsed.ok) {
        set({ startError: null, endError: null, rangeError: null, ranges: [parsed.value] });
        return { ok: true, range: parsed.value };
      }
      set({
        startError: parsed.errors.start ?? null,
        endError: parsed.errors.end ?? null,
        rangeError: parsed.errors.range ?? null,
      });
      return { ok: false };
    }

    return {
      ...emptyState(),

      openForSelection(ranges) {
        if (ranges.length === 0) return false;
        set({
          ...emptyState(),
          open: true,
          mode: "selection",
          ranges: ranges.map((r) => ({ start: r.start, end: r.end })),
          form: initialOverrideForm(deps.getConfig()),
        });
        return true;
      },

      openNew(prefill) {
        const config = deps.getConfig();
        const address = prefill ?? config?.definition.startAddress ?? 0;
        const shown = String(toDisplayAddress(address, base()));
        set({
          ...emptyState(),
          open: true,
          mode: "new",
          ranges: [{ start: address, end: address }],
          startText: shown,
          endText: shown,
          form: initialOverrideForm(config),
        });
      },

      openEdit(index) {
        const config = deps.getConfig();
        const override: ScaleOverride | undefined = config?.scaleOverrides[index];
        if (!config || !override) return;
        set({
          ...emptyState(),
          open: true,
          mode: "edit",
          editingIndex: index,
          ranges: [{ start: override.start, end: override.end }],
          startText: String(toDisplayAddress(override.start, base())),
          endText: String(toDisplayAddress(override.end, base())),
          form: formFromSettings(override.scale, config.display.format === "signed"),
        });
      },

      setPreset(preset) {
        editForm(withPreset(get().form, preset), {});
      },

      setField(field, value) {
        editForm(withField(get().form, field, value), get().errors);
      },

      setRawSigned(signed) {
        const next = { ...get().form, rawSigned: signed };
        const kept = { ...get().errors };
        delete kept.xMin;
        delete kept.xMax;
        const fresh = fieldsOf(next.preset).includes("xMin")
          ? errorsForFields(next, ["xMin", "xMax"])
          : {};
        editForm(next, { ...kept, ...fresh });
      },

      setDivisorMode(mode) {
        const kept = { ...get().errors };
        delete kept.divisor;
        delete kept.decimals;
        editForm(withDivisorMode(get().form, mode), kept);
      },

      setOutOfRange(mode) {
        editForm(withOutOfRange(get().form, mode), get().errors);
      },

      quickPick(label) {
        const pick = RAW_QUICK_PICKS.find((p) => p.label === label);
        if (!pick) return;
        const next = withQuickPick(get().form, pick);
        const kept = { ...get().errors };
        delete kept.xMin;
        delete kept.xMax;
        editForm(next, { ...kept, ...errorsForFields(next, ["xMin", "xMax"]) });
      },

      setStart(text) {
        set({ startText: text });
      },

      setEnd(text) {
        set({ endText: text });
      },

      blur(field) {
        const { form } = get();
        const related = relatedFields(field);
        const kept = { ...get().errors };
        for (const f of related) delete kept[f];
        editForm(form, { ...kept, ...errorsForFields(form, related) });
      },

      blurRange() {
        const s = get();
        if (s.mode === "selection") return;
        checkRange();
      },

      async save() {
        const s = get();
        if (!s.open || s.pending) return false;
        const validation = validateScaleForm(s.form);
        const formErrors = validation.ok ? {} : activeErrors(s.form, validation.errors);
        let ranges: AddressRange[] = s.ranges;
        let rangesOk = true;
        if (s.mode === "selection") {
          const message = overrideRangesMessage(ranges, existing(), base(), null);
          set({ rangeError: message });
          rangesOk = message === null;
        } else {
          const checked = checkRange();
          rangesOk = checked.ok;
          if (checked.ok) ranges = [checked.range];
        }
        set({ errors: formErrors });
        // Override scales are never None (the select has no such entry).
        if (!validation.ok || validation.settings === null || !rangesOk) return false;

        set({ pending: true });
        try {
          const scale = validation.settings;
          const done =
            s.mode === "edit" && s.editingIndex !== null && ranges[0]
              ? await deps.scale.getState().updateOverride(s.editingIndex, {
                  start: ranges[0].start,
                  end: ranges[0].end,
                  scale,
                })
              : await deps.scale.getState().addOverrides(ranges, scale);
          if (done) set({ ...emptyState() });
          return done;
        } finally {
          if (get().open) set({ pending: false });
        }
      },

      close() {
        set({ ...emptyState() });
      },
    };
  });
}

// ---- typed selectors ----
export const selectOverrideOpen = (s: OverrideDialogStore) => s.open;
export const selectOverrideMode = (s: OverrideDialogStore) => s.mode;
export const selectOverrideForm = (s: OverrideDialogStore) => s.form;
export const selectOverrideErrors = (s: OverrideDialogStore) => s.errors;
