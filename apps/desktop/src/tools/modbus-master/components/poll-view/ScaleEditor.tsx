import type { ReactNode } from "react";
import type { ScaleOutOfRange, ScalePreset } from "@/shared/ipc/modbus-master.types";
import { cn } from "@/shared/lib/utils";
import { FieldMessage } from "@/shared/ui/field-message";
import { Checkbox, Input, Select } from "@/shared/ui/input";
import { SegmentedControl } from "@/shared/ui/segmented";
import {
  FIXED_ENGINEERING_HINT,
  hasFixedEngineeringRange,
  OUT_OF_RANGE_LABELS,
  RAW_QUICK_PICKS,
  SCALE_PRESET_LABELS,
} from "../../lib/scale-presets";
import {
  type DivisorMode,
  fieldsOf,
  type ScaleErrors,
  type ScaleFieldName,
  type ScaleForm,
} from "../../lib/scale-validation";
import { describedBy, Field } from "../form/field";

export interface ScaleEditorProps {
  /** A unique prefix for the control ids (the setup and the dialog can both be on screen). */
  idPrefix: string;
  form: ScaleForm;
  errors: ScaleErrors;
  /** The presets the select offers (the override dialog has no None). */
  presets: readonly ScalePreset[];
  /** Field pairs stack: the container is narrower than the pairs need (DES-003 3.1). */
  stacked: boolean;
  onPreset(preset: ScalePreset): void;
  onField(field: ScaleFieldName, value: string): void;
  onBlur(field: ScaleFieldName): void;
  onRawSigned(signed: boolean): void;
  onDivisorMode(mode: DivisorMode): void;
  onOutOfRange(mode: ScaleOutOfRange): void;
  onQuickPick(label: string): void;
  /** Receives the control of a field so the host can move the focus to the first invalid one. */
  register?(field: ScaleFieldName | "preset", el: HTMLElement | null): void;
  /** Marks the control that gets the initial focus of a dialog. */
  autoFocusPreset?: boolean;
  /** Extra content after the preset select (none). */
  children?: ReactNode;
}

const PRESET_ORDER: readonly ScalePreset[] = [
  "none",
  "current4to20",
  "voltage0to10",
  "divide",
  "linear",
];

function Pair({ stacked, children }: { stacked: boolean; children: ReactNode }) {
  return (
    <div
      data-pair=""
      data-stacked={stacked || undefined}
      className={cn("gap-2", stacked ? "flex flex-col" : "grid grid-cols-2")}
    >
      {children}
    </div>
  );
}

/**
 * The scale editor (DES-003 3.1): preset, raw signedness, raw range with quick picks, engineering
 * range (read-only for the two fixed presets), divisor, unit, decimals and the out-of-range choice.
 * It only shows texts and reports edits: the SCALE section and the S8 dialog each own the state.
 */
export function ScaleEditor({
  idPrefix,
  form,
  errors,
  presets,
  stacked,
  onPreset,
  onField,
  onBlur,
  onRawSigned,
  onDivisorMode,
  onOutOfRange,
  onQuickPick,
  register,
  autoFocusPreset,
}: ScaleEditorProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const fields = fieldsOf(form.preset);
  const linear = fields.includes("xMin") && form.preset !== "divide";
  const uses = (field: ScaleFieldName) => fields.includes(field);
  const fixedEng = hasFixedEngineeringRange(form.preset);

  const text = (name: ScaleFieldName, extra: { readOnly?: boolean } = {}) => ({
    id: id(name),
    value: form[name],
    mono: true,
    "aria-invalid": errors[name] ? (true as const) : undefined,
    "aria-describedby": describedBy(id(name), {
      error: errors[name],
      helper: name === "yMin" && fixedEng ? true : null,
    }),
    onChange: (e: { target: { value: string } }) => onField(name, e.target.value),
    onBlur: () => onBlur(name),
    ref: (el: HTMLInputElement | null) => register?.(name, el),
    ...extra,
  });

  return (
    <div className="flex flex-col gap-2" data-testid="scale-editor">
      <Field id={id("preset")} label="Preset">
        <Select
          id={id("preset")}
          value={form.preset}
          data-autofocus={autoFocusPreset ? "" : undefined}
          ref={(el) => register?.("preset", el)}
          onChange={(e) => onPreset(e.target.value as ScalePreset)}
        >
          {PRESET_ORDER.filter((p) => presets.includes(p)).map((p) => (
            <option key={p} value={p}>
              {SCALE_PRESET_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>

      {form.preset === "none" ? null : (
        <>
          <label className="flex items-center gap-2 text-xs font-semibold" htmlFor={id("signed")}>
            <Checkbox
              id={id("signed")}
              checked={form.rawSigned}
              onChange={(e) => onRawSigned(e.target.checked)}
            />
            Raw is signed
          </label>

          {linear ? (
            <>
              <Pair stacked={stacked}>
                <Field id={id("xMin")} label="Raw min" error={errors.xMin}>
                  <Input inputMode="numeric" {...text("xMin")} />
                </Field>
                <Field id={id("xMax")} label="Raw max" error={errors.xMax}>
                  <Input inputMode="numeric" {...text("xMax")} />
                </Field>
              </Pair>
              <fieldset
                aria-label="Raw range quick picks"
                className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0"
              >
                {RAW_QUICK_PICKS.map((pick) => (
                  <button
                    key={pick.label}
                    type="button"
                    onClick={() => onQuickPick(pick.label)}
                    className="h-6 rounded-pill border border-input bg-card px-2.5 font-mono text-xs outline-none hover:bg-neutral-tint focus-ring"
                  >
                    {pick.label}
                  </button>
                ))}
              </fieldset>
              <Pair stacked={stacked}>
                <Field id={id("yMin")} label="Eng. min" error={errors.yMin}>
                  <Input
                    {...text("yMin", { readOnly: fixedEng })}
                    inputMode="decimal"
                    {...(fixedEng ? { tabIndex: -1 } : {})}
                  />
                </Field>
                <Field id={id("yMax")} label="Eng. max" error={errors.yMax}>
                  <Input
                    {...text("yMax", { readOnly: fixedEng })}
                    inputMode="decimal"
                    {...(fixedEng ? { tabIndex: -1 } : {})}
                  />
                </Field>
              </Pair>
              {fixedEng ? (
                <p id={id("yMin-helper")} className="text-xs text-text-muted">
                  {FIXED_ENGINEERING_HINT}
                </p>
              ) : null}
            </>
          ) : null}

          {uses("divisor") ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold">Divisor</span>
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  aria-label="Divisor"
                  value={form.divisorMode}
                  onChange={(mode) => onDivisorMode(mode)}
                  options={[
                    { value: "10", label: "10" },
                    { value: "100", label: "100" },
                    { value: "1000", label: "1000" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
                {form.divisorMode === "custom" ? (
                  <Input
                    {...text("divisor")}
                    aria-label="Custom divisor"
                    inputMode="decimal"
                    className="w-24"
                  />
                ) : null}
              </div>
              {errors.divisor ? (
                <FieldMessage kind="error" id={id("divisor-error")}>
                  {errors.divisor}
                </FieldMessage>
              ) : null}
            </div>
          ) : null}

          {uses("unit") ? (
            <Pair stacked={stacked}>
              <Field id={id("unit")} label="Unit" error={errors.unit}>
                <Input {...text("unit")} mono={false} />
              </Field>
              <Field id={id("decimals")} label="Decimals" error={errors.decimals}>
                <Input inputMode="numeric" {...text("decimals")} />
              </Field>
            </Pair>
          ) : null}

          {linear ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold">Out of range</span>
              <SegmentedControl
                aria-label="Out of range"
                value={form.outOfRange}
                onChange={onOutOfRange}
                options={(["flag", "clamp"] as const).map((v) => ({
                  value: v,
                  label: OUT_OF_RANGE_LABELS[v],
                }))}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
