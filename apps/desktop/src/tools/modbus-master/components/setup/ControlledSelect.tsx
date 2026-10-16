import { type Path, useController, useFormContext } from "react-hook-form";
import { Select } from "@/shared/ui/input";
import type { SetupFormValues } from "./use-setup-form";

export interface SelectOption {
  value: string;
  label: string;
}

interface ControlledSelectProps {
  name: Path<SetupFormValues>;
  id: string;
  options: readonly SelectOption[];
  /** Shown when the form holds a value that is not in `options` (a hand-edited profile). */
  unlistedLabel?: (value: string) => string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string | undefined;
}

/**
 * A native select that is controlled by the form: its shown value is always the form value, and
 * a value outside the list stays selectable as an extra option (for example "250000 (not
 * supported)"). Browsers fall back to the first option when the selected one disappears, which
 * would desync an uncontrolled select from what Connect sends (REV-002 M4).
 */
export function ControlledSelect({
  name,
  id,
  options,
  unlistedLabel,
  disabled,
  invalid,
  describedBy,
}: ControlledSelectProps) {
  const { control } = useFormContext<SetupFormValues>();
  const { field } = useController({ name, control });
  const current = String(field.value ?? "");
  const listed = options.some((o) => o.value === current);
  const all =
    !listed && current !== ""
      ? [{ value: current, label: unlistedLabel ? unlistedLabel(current) : current }, ...options]
      : options;

  return (
    <Select
      id={id}
      ref={field.ref}
      name={field.name}
      value={current}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={(e) => field.onChange(e.target.value)}
      onBlur={field.onBlur}
    >
      {all.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
