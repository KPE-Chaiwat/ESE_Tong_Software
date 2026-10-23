// The scale editor of the setup (DES-003 3.1, FE-003 task 04): a draft of texts that nothing sends
// until [Apply scale] (or Enter). An invalid draft is refused with its messages and the poll keeps
// its last valid scale. Every change is mirrored into `pollViewUiStore.scaleDraft` (through
// `persist`), so closing the dock or popover, switching presentation and the pop out / dock handoff
// keep the typed text and its messages. `hydrate` reads that mirror back when a handoff arrives.
import { z } from "zod";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { PollConfig, ScalePreset, ScaleSettings } from "@/shared/ipc/modbus-master.types";
import { allSixteenBitRowsSigned, rowsOfConfig } from "../lib/format-overrides";
import { RAW_QUICK_PICKS } from "../lib/scale-presets";
import {
  type DivisorMode,
  fieldsOf,
  formFromSettings,
  SCALE_FIELDS,
  type ScaleErrors,
  type ScaleFieldName,
  type ScaleForm,
  scaleFormSchema,
  validateScaleForm,
} from "../lib/scale-validation";
import type { ScaleDraft } from "./poll-view-ui.store";
import {
  activeErrors,
  errorsForFields,
  relatedFields,
  sameForm,
  withDivisorMode,
  withField,
  withOutOfRange,
  withPreset,
  withQuickPick,
} from "./scale-form.logic";

export interface ScaleDraftState {
  /** The texts of the applied scale, the editor's content while there are no unapplied edits. */
  applied: ScaleForm;
  /** The typed texts; null while they equal the applied ones. */
  form: ScaleForm | null;
  /** Messages by field, as shown under the fields. */
  errors: ScaleErrors;
  /** Apply was refused: the section header says "Scale not applied. Fix the highlighted fields." */
  failed: boolean;
  /** The apply command is on its way. */
  pending: boolean;
}

export interface ApplyScaleResult {
  ok: boolean;
  /** A command was sent. */
  applied: boolean;
  /** The first field with a message (the editor moves the focus there). */
  firstInvalid: ScaleFieldName | null;
}

export interface ScaleDraftActions {
  /** The applied scale changed (snapshot, event, optimistic copy): the editor follows it. */
  syncApplied(config: PollConfig): void;
  setPreset(preset: ScalePreset): void;
  setField(field: ScaleFieldName, value: string): void;
  setRawSigned(signed: boolean): void;
  setDivisorMode(mode: DivisorMode): void;
  setOutOfRange(mode: "flag" | "clamp"): void;
  quickPick(label: string): void;
  /** A field was left: shows its message (and the one of its partner field). */
  blur(field: ScaleFieldName): void;
  /** The settings the draft stands for, or the messages. Does not change the state. */
  validate(): ReturnType<typeof validateScaleForm>;
  /** [Apply scale] and Enter. */
  apply(): Promise<ApplyScaleResult>;
  /** Discards the unapplied edits. */
  reset(): void;
  /** Takes the draft of a handoff (or nothing). */
  hydrate(draft: ScaleDraft | null): void;
}

export type ScaleDraftStore = ScaleDraftState & ScaleDraftActions;
export type ScaleDraftStoreApi = StoreApi<ScaleDraftStore>;

export interface ScaleDraftDeps {
  getConfig(): PollConfig | null;
  /** `pollScaleStore.applyScale`: true when the scale is applied (or already was). */
  applyScale(scale: ScaleSettings | null): Promise<boolean>;
  /** Mirrors the draft into the poll view UI store (for the handoff and the unapplied count). */
  persist(draft: ScaleDraft | null): void;
}

/** What the handoff carries in `ScaleDraft.fields`. */
const draftFieldsSchema = z.object({
  form: scaleFormSchema,
  errors: z.record(z.string(), z.string()),
  failed: z.boolean(),
});

const isField = (name: string): name is ScaleFieldName =>
  (SCALE_FIELDS as readonly string[]).includes(name);

/**
 * The texts of the scale a poll starts from: None, raw signed when every 16-bit row of the poll is
 * Signed (DES-009 8.1).
 */
export function appliedFormOf(config: PollConfig | null): ScaleForm {
  return formFromSettings(config?.scale ?? null, allSixteenBitRowsSigned(rowsOfConfig(config)));
}

export function createScaleDraftStore(deps: ScaleDraftDeps): ScaleDraftStoreApi {
  return createStore<ScaleDraftStore>()((set, get) => {
    const persistState = () => {
      const { form, errors, failed } = get();
      deps.persist(form === null ? null : { dirty: true, fields: { form, errors, failed } });
    };

    /** Sets the typed texts; texts equal to the applied ones are no draft at all. */
    function edit(form: ScaleForm, errors: ScaleErrors, failed: boolean): void {
      if (sameForm(form, get().applied)) {
        set({ form: null, errors: {}, failed: false });
      } else {
        set({ form, errors, failed: failed && Object.keys(errors).length > 0 });
      }
      persistState();
    }

    const current = () => get().form ?? get().applied;

    return {
      applied: appliedFormOf(deps.getConfig()),
      form: null,
      errors: {},
      failed: false,
      pending: false,

      syncApplied(config) {
        const applied = appliedFormOf(config);
        const { form } = get();
        if (form !== null && sameForm(form, applied)) {
          set({ applied, form: null, errors: {}, failed: false });
          persistState();
        } else {
          set({ applied });
        }
      },

      setPreset(preset) {
        edit(withPreset(current(), preset), {}, false);
      },

      setField(field, value) {
        const next = withField(current(), field, value);
        // The message of a field stays until the field is left; typing does not add one.
        edit(next, get().errors, get().failed);
      },

      setRawSigned(signed) {
        const next = { ...current(), rawSigned: signed };
        const raw: readonly ScaleFieldName[] = ["xMin", "xMax"];
        // The raw fields are checked against the new range at once (DES-003 4).
        const kept = { ...get().errors };
        for (const f of raw) delete kept[f];
        const fresh = fieldsOf(next.preset).includes("xMin") ? errorsForFields(next, raw) : {};
        edit(next, { ...kept, ...fresh }, get().failed);
      },

      setDivisorMode(mode) {
        const next = withDivisorMode(current(), mode);
        const kept = { ...get().errors };
        delete kept.divisor;
        delete kept.decimals;
        edit(next, kept, get().failed);
      },

      setOutOfRange(mode) {
        edit(withOutOfRange(current(), mode), get().errors, get().failed);
      },

      quickPick(label) {
        const pick = RAW_QUICK_PICKS.find((p) => p.label === label);
        if (!pick) return;
        const next = withQuickPick(current(), pick);
        const kept = { ...get().errors };
        delete kept.xMin;
        delete kept.xMax;
        edit(next, { ...kept, ...errorsForFields(next, ["xMin", "xMax"]) }, get().failed);
      },

      blur(field) {
        const { form } = get();
        if (form === null) return;
        const related = relatedFields(field);
        const kept = { ...get().errors };
        for (const f of related) delete kept[f];
        edit(form, { ...kept, ...errorsForFields(form, related) }, get().failed);
      },

      validate() {
        return validateScaleForm(current());
      },

      async apply() {
        const form = current();
        const result = validateScaleForm(form);
        if (!result.ok) {
          const errors = activeErrors(form, result.errors);
          // An invalid draft is kept as typed, with every message and the header.
          set({ form, errors, failed: true });
          persistState();
          return {
            ok: false,
            applied: false,
            firstInvalid: SCALE_FIELDS.find((f) => errors[f] !== undefined) ?? null,
          };
        }
        set({ pending: true });
        try {
          const ok = await deps.applyScale(result.settings);
          if (!ok) return { ok: false, applied: false, firstInvalid: null };
          set({ form: null, errors: {}, failed: false });
          persistState();
          return { ok: true, applied: true, firstInvalid: null };
        } finally {
          set({ pending: false });
        }
      },

      reset() {
        set({ form: null, errors: {}, failed: false });
        persistState();
      },

      hydrate(draft) {
        const parsed = draft ? draftFieldsSchema.safeParse(draft.fields) : null;
        if (!parsed?.success) {
          // Nothing, or something this version cannot read: no draft (and the mirror agrees).
          set({ form: null, errors: {}, failed: false });
          if (draft !== null) persistState();
          return;
        }
        const errors: ScaleErrors = {};
        for (const [name, message] of Object.entries(parsed.data.errors)) {
          if (isField(name)) errors[name] = message;
        }
        // The draft keeps what was typed even if the applied scale is the same: it is the user's.
        set({ form: parsed.data.form, errors, failed: parsed.data.failed });
      },
    };
  });
}

// ---- typed selectors ----
export const selectScaleForm = (s: ScaleDraftStore) => s.form ?? s.applied;
export const selectScaleErrors = (s: ScaleDraftStore) => s.errors;
export const selectScaleFailed = (s: ScaleDraftStore) => s.failed;
export const selectScaleDirty = (s: ScaleDraftStore) => s.form !== null;
export const selectScaleApplying = (s: ScaleDraftStore) => s.pending;
