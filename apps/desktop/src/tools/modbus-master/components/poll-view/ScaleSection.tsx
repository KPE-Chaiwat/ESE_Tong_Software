import { useId, useRef } from "react";
import { KEEP_FOCUS_ON_PRESS } from "@/shared/lib/keep-focus";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import {
  OVERRIDE_OUTSIDE_POLL,
  rangeLabel,
  SCALE_KEPT_NOTE,
  SCALE_PRESETS,
  SCALE_REGISTERS_ONLY,
  scaleSummary,
} from "../../lib/scale-presets";
import { SCALE_NOT_APPLIED, type ScaleFieldName } from "../../lib/scale-validation";
import { overrideOutsidePoll } from "../../store/poll-scale.logic";
import {
  selectScaleApplying,
  selectScaleDirty,
  selectScaleErrors,
  selectScaleFailed,
  selectScaleForm,
} from "../../store/scale-draft.store";
import {
  useElementWidth,
  usePoll,
  usePollScale,
  usePollViewRuntime,
  useScaleDraft,
} from "./context";
import { ScaleEditor } from "./ScaleEditor";

/** The field pairs stack at or below this container width in px (DES-003 3.1, Q-FE3-02). */
export const STACK_AT_OR_BELOW = 260;

/** "Applied: 4-20 mA (raw 0-65535)" (DES-003 3.1). */
function appliedText(summary: string): string {
  return `Applied: ${summary}`;
}

function OverridesSection({ disabled }: { disabled: boolean }) {
  const uid = useId();
  const runtime = usePollViewRuntime();
  const config = usePoll((s) => s.config);
  const overrides = usePollScale((s) => s.overrides);
  if (!config) return null;
  const { start, quantity } = {
    start: config.definition.startAddress,
    quantity: config.definition.quantity,
  };
  const base = config.display.addressBase;
  const { overrides: dialog, scale } = runtime.stores;

  return (
    <section aria-labelledby={`${uid}-heading`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${uid}-heading`} className="text-base font-semibold">
          Overrides ({overrides.length})
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => dialog.getState().openNew(runtime.stores.ui.getState().focusAddress)}
        >
          <Icon name="plus" />
          Add override
        </Button>
      </div>
      {overrides.length === 0 ? null : (
        <ul className="flex flex-col gap-1" data-testid="override-list">
          {overrides.map((o, i) => {
            const outside = overrideOutsidePoll(o, start, quantity);
            const label = rangeLabel(o.start, o.end, base);
            return (
              <li
                key={`${o.start}-${o.end}`}
                id={`${uid}-row-${i}`}
                data-testid="override-row"
                data-outside={outside || undefined}
                className="flex items-center gap-2 rounded-md border px-2 py-1 text-[13px]"
              >
                <span className="shrink-0 font-mono">{label}</span>
                <span className="min-w-0 flex-1 truncate" title={scaleSummary(o.scale, true)}>
                  {scaleSummary(o.scale, true)}
                  {outside ? (
                    <span className="block text-xs text-dark/75">{OVERRIDE_OUTSIDE_POLL}</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  disabled={disabled}
                  aria-describedby={`${uid}-row-${i}`}
                  title={`Edit the scale override for ${label}`}
                  onClick={() => dialog.getState().openEdit(i)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  disabled={disabled}
                  aria-describedby={`${uid}-row-${i}`}
                  title={`Remove the scale override for ${label}`}
                  onClick={() =>
                    void scale.getState().removeOverrides([{ start: o.start, end: o.end }])
                  }
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The SCALE and OVERRIDES sections of the setup (DES-003 3.1, FE-003 task 04): the editor is a
 * draft and nothing is applied until [Apply scale] or Enter. The draft lives in the poll view's
 * stores, so closing the dock or popover, switching presentation or moving the poll to another host
 * keeps the typed text and its messages.
 */
export function ScaleSection() {
  const uid = useId();
  const runtime = usePollViewRuntime();
  const { stores } = runtime;
  const config = usePoll((s) => s.config);
  const form = useScaleDraft(selectScaleForm);
  const errors = useScaleDraft(selectScaleErrors);
  const failed = useScaleDraft(selectScaleFailed);
  const dirty = useScaleDraft(selectScaleDirty);
  const applying = useScaleDraft(selectScaleApplying);
  const applied = usePollScale((s) => s.scale);
  const active = usePollScale((s) => s.scaleActive);
  // A whole-pixel layout limit ("at or below 260"), not a strict fractional threshold: the rounded width.
  const [ref, width] = useElementWidth<HTMLDivElement>(Math.round);
  const fields = useRef<Partial<Record<ScaleFieldName | "preset", HTMLElement | null>>>({});
  const overrideCount = usePollScale((s) => s.overrides.length);
  if (!config) return null;

  const draft = stores.scaleDraft.getState();
  const hasScale = applied !== null && applied.preset !== "none";
  const submit = async () => {
    const result = await draft.apply();
    if (!result.ok && result.firstInvalid) fields.current[result.firstInvalid]?.focus();
  };

  return (
    <div ref={ref} data-slot="scale-section" className="flex flex-col gap-4">
      <section aria-labelledby={`${uid}-heading`} className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h3 id={`${uid}-heading`} className="text-base font-semibold">
            Scale
          </h3>
          {failed ? (
            <p
              role="alert"
              data-testid="scale-not-applied"
              className="flex items-start gap-1 text-xs text-foreground"
            >
              <Icon name="circle-x" tone="error" className="mt-px size-3.5" />
              <span>{SCALE_NOT_APPLIED}</span>
            </p>
          ) : null}
        </div>
        {active ? null : (
          <div className="flex flex-col gap-1 text-xs text-text-muted" data-testid="scale-inactive">
            <p>{SCALE_REGISTERS_ONLY}</p>
            {hasScale || overrideCount > 0 ? <p>{SCALE_KEPT_NOTE}</p> : null}
          </div>
        )}
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={!active} className="flex min-w-0 flex-col gap-2 border-0 p-0">
            <ScaleEditor
              idPrefix={`${uid}-scale`}
              form={form}
              errors={errors}
              presets={SCALE_PRESETS}
              stacked={width <= STACK_AT_OR_BELOW}
              onPreset={draft.setPreset}
              onField={draft.setField}
              onBlur={draft.blur}
              onRawSigned={draft.setRawSigned}
              onDivisorMode={draft.setDivisorMode}
              onOutOfRange={draft.setOutOfRange}
              onQuickPick={draft.quickPick}
              register={(field, el) => {
                fields.current[field] = el;
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={applying}
                {...KEEP_FOCUS_ON_PRESS}
              >
                {applying ? <Icon name="loader" /> : null}
                Apply scale
              </Button>
              <p className="text-xs text-text-muted" data-testid="applied-scale">
                {appliedText(scaleSummary(applied, false))}
              </p>
            </div>
            {dirty && !failed ? (
              <p className="text-xs text-text-muted" data-testid="scale-unapplied">
                Unapplied changes
              </p>
            ) : null}
          </fieldset>
        </form>
      </section>
      <OverridesSection disabled={!active} />
    </div>
  );
}
