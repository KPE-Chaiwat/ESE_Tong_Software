import { useRef } from "react";
import { cn } from "@/shared/lib/utils";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  /** Tooltip (title). */
  title?: string;
}

interface SegmentedControlProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  "aria-label": string;
  disabled?: boolean;
  /** Tooltip for the whole control, for example why it is disabled. */
  title?: string;
  className?: string;
}

/** Pill-shaped radio group. The selected option has the accent fill, dark text and a border. */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
  title,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      aria-disabled={disabled || undefined}
      title={title}
      data-slot="segmented"
      className={cn(
        "inline-flex rounded-pill border border-input bg-card p-0.5",
        disabled && "opacity-50",
        className,
      )}
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            disabled={disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "h-6 min-w-12 rounded-pill px-3 text-xs font-semibold outline-none focus-ring",
              selected
                ? "border border-dark bg-primary text-primary-foreground"
                : "hover:bg-neutral-tint",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
