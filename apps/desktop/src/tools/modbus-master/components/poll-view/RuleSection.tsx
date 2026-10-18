import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { FieldMessage } from "@/shared/ui/field-message";
import { Input, Select } from "@/shared/ui/input";
import { COMPARISONS, colorContrast, MAX_COLOR_RULES, validateRules } from "../../lib/color-rules";
import { scaleAvailable } from "../../lib/scaled";
import { newRule, ruleDraft } from "../../store/rule-draft";
import { usePoll, usePollUi, usePollViewRuntime } from "./context";
import { RuleMarker, ruleClass, ruleStyle } from "./RuleMarker";

export function RuleSection() {
  const runtime = usePollViewRuntime();
  const config = usePoll((s) => s.config);
  const draft = usePollUi((s) => s.ruleDraft);
  const [pending, setPending] = useState(false);
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusInvalid = useRef(false);
  const focusRemoved = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (focusRemoved.current !== null) {
      const target = focusRemoved.current;
      focusRemoved.current = null;
      if (target) root.current?.querySelector<HTMLElement>(`[data-rule-edit="${target}"]`)?.focus();
      else addRef.current?.focus();
    }
    if (draft && focusInvalid.current) {
      focusInvalid.current = false;
      root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [draft]);
  const open = draft !== null;
  useEffect(() => (open ? runtime.lockModal() : undefined), [runtime, open]);
  if (!config) return null;
  const applied = config.colorRules ?? [];
  const rules = draft?.entries.map((entry) => entry.rule) ?? [];
  const selectedIndex = draft?.entries.findIndex((entry) => entry.id === draft.selected) ?? -1;
  const selectedEntry = draft?.entries[selectedIndex];
  const selected = rules[selectedIndex];
  const base = config.display.addressBase;
  const set = (change: Partial<NonNullable<typeof draft>>) => {
    if (draft) runtime.stores.ui.getState().setRuleDraft({ ...draft, ...change });
  };
  const update = (patch: Partial<ValueColorRule>) => {
    if (!draft) return;
    set({
      entries: draft.entries.map((entry) =>
        entry.id === draft.selected
          ? {
              ...entry,
              ...(patch.range !== undefined ? { rangeTexts: undefined } : {}),
              rule: { ...entry.rule, ...patch },
            }
          : entry,
      ),
      dirty: true,
    });
  };
  const close = () => {
    if (!pending) runtime.stores.ui.getState().setRuleDraft(null);
  };
  const validate = () => {
    const errors = validateRules(rules, config.display.format);
    set({ errors });
    return errors;
  };
  const apply = async () => {
    if (!draft || pending) return;
    const errors = validate();
    const first = Object.keys(errors)[0];
    if (first) {
      const index = Number(first.match(/\[(\d+)\]/)?.[1] ?? 0);
      focusInvalid.current = true;
      set({
        errors,
        error: "Rules not applied. Fix the highlighted fields.",
        selected: draft.entries[index]?.id ?? draft.selected,
      });
      return;
    }
    setPending(true);
    const ok = await runtime.stores.poll.getState().setView({
      colorRules: rules.map((rule) => ({
        ...rule,
        name: rule.name.trim(),
        threshold: rule.threshold.trim(),
        upperThreshold: rule.upperThreshold?.trim() ?? null,
      })),
    });
    setPending(false);
    if (ok) runtime.stores.ui.getState().setRuleDraft(null);
    else
      set({
        error: `Could not apply value color rules. ${runtime.stores.poll.getState().commandError ?? "Try again."}`,
      });
  };
  const field = (
    key: string,
    label: string,
    control: (id: string, error: string | undefined) => React.ReactNode,
  ) => {
    const id = `${uid}-${key}`;
    let error = draft?.errors[`colorRules[${selectedIndex}].${key}`];
    if (base === 1 && error?.includes("whole number from 0 to 65535"))
      error = error.replace("0 to 65535", "1 to 65536");
    return (
      <div key={id} className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs">
          {label}
        </label>
        {control(id, error)}
        {error ? (
          <FieldMessage kind="error" id={`${id}-error`}>
            {error}
          </FieldMessage>
        ) : null}
      </div>
    );
  };
  const attributes = (id: string, error: string | undefined) => ({
    id,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
    onBlur: validate,
  });
  const preview = selected
    ? { rule: selected, description: "Highlight preview; not a live match." }
    : null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`${uid}-heading`}>
      <h3 id={`${uid}-heading`} className="text-base font-semibold">
        Value color rules
      </h3>
      <p className="text-xs">
        {applied.length
          ? `${applied.length} rules · ${applied.filter((rule) => rule.enabled).length} enabled`
          : "No value color rules."}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => runtime.stores.ui.getState().setRuleDraft(ruleDraft(applied))}
      >
        Edit rules…
      </Button>
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        title={`Value color rules · ${config.name}`}
        widthClass="w-[640px]"
      >
        <div
          ref={root}
          className="flex max-h-[calc(100vh-9rem)] flex-col gap-3"
          aria-busy={pending}
        >
          <p className="text-xs">First matching enabled rule wins for each value cell.</p>
          {draft?.error ? (
            <FieldMessage kind="error" id={`${uid}-error`}>
              {draft.error}
            </FieldMessage>
          ) : null}
          <div className="min-h-0 overflow-auto">
            <fieldset disabled={pending} className="flex flex-col gap-3">
              {draft?.entries.map((entry, index) => (
                <div key={entry.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span>{index + 1}</span>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Enable rule ${index + 1}`}
                      checked={entry.rule.enabled}
                      onChange={(event) =>
                        set({
                          entries: draft.entries.map((item) =>
                            item.id === entry.id
                              ? { ...item, rule: { ...item.rule, enabled: event.target.checked } }
                              : item,
                          ),
                          dirty: true,
                        })
                      }
                    />{" "}
                    {entry.rule.name}
                  </label>
                  <span>
                    {entry.rule.source} {COMPARISONS[entry.rule.comparison]} {entry.rule.threshold}
                    {entry.rule.range
                      ? entry.rule.range.start === entry.rule.range.end
                        ? ` · Register ${entry.rule.range.start + base}`
                        : ` · Registers ${entry.rule.range.start + base}–${entry.rule.range.end + base}`
                      : " · Whole poll"}
                    {entry.rule.colors
                      ? " · Custom colors"
                      : entry.rule.highlight === "warning"
                        ? " · Warning"
                        : ""}
                  </span>
                  <Button
                    data-rule-edit={entry.id}
                    size="sm"
                    variant="outline"
                    onClick={() => set({ selected: entry.id })}
                  >
                    Edit
                  </Button>
                  {([-1, 1] as const).map((direction) => (
                    <Button
                      key={direction}
                      size="sm"
                      variant="outline"
                      disabled={index + direction < 0 || index + direction >= rules.length}
                      onClick={() => {
                        const entries = [...draft.entries];
                        const other = entries[index + direction];
                        if (other) {
                          entries[index + direction] = entry;
                          entries[index] = other;
                          set({ entries, dirty: true });
                        }
                      }}
                    >
                      {direction < 0 ? "Up" : "Down"}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const entries = draft.entries.filter((item) => item.id !== entry.id);
                      focusRemoved.current = entries[Math.min(index, entries.length - 1)]?.id ?? "";
                      set({
                        entries,
                        selected: entries[Math.min(index, entries.length - 1)]?.id ?? null,
                        dirty: true,
                      });
                    }}
                  >
                    Remove
                  </Button>
                  {entry.rule.range &&
                  (entry.rule.range.end < config.definition.startAddress ||
                    entry.rule.range.start >=
                      config.definition.startAddress + config.definition.quantity) ? (
                    <p>Not in the current poll range</p>
                  ) : null}
                  {entry.rule.source === "scaled" && !scaleAvailable(config) ? (
                    <p>Scaled values are unavailable in this mode.</p>
                  ) : null}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button
                  ref={addRef}
                  size="sm"
                  variant="outline"
                  disabled={rules.length >= MAX_COLOR_RULES}
                  title={
                    rules.length >= MAX_COLOR_RULES
                      ? `A poll can have at most ${MAX_COLOR_RULES} value color rules.`
                      : undefined
                  }
                  onClick={() => {
                    if (!draft) return;
                    const id = crypto.randomUUID();
                    set({
                      entries: [...draft.entries, { id, rule: newRule(rules) }],
                      selected: id,
                      dirty: true,
                    });
                  }}
                >
                  Add rule
                </Button>
                <span className="text-xs">
                  {rules.length} / {MAX_COLOR_RULES} rules
                </span>
              </div>
              {selected ? (
                <>
                  {field("name", "Name", (id, error) => (
                    <Input
                      {...attributes(id, error)}
                      value={selected.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  ))}
                  {selected.comparison !== "always"
                    ? field("source", "Source", (id, error) => (
                        <Select
                          {...attributes(id, error)}
                          value={selected.source}
                          onChange={(e) =>
                            update({ source: e.target.value as ValueColorRule["source"] })
                          }
                        >
                          {["displayed", "raw", "scaled"].map((source) => (
                            <option key={source} value={source}>
                              {source === "displayed"
                                ? "Displayed"
                                : source === "raw"
                                  ? "Raw"
                                  : "Scaled"}
                            </option>
                          ))}
                        </Select>
                      ))
                    : null}
                  {field("comparison", "Comparison", (id, error) => (
                    <Select
                      {...attributes(id, error)}
                      value={selected.comparison}
                      onChange={(e) =>
                        update({
                          comparison: e.target.value as ValueColorRule["comparison"],
                          source: e.target.value === "always" ? "displayed" : selected.source,
                          threshold: e.target.value === "always" ? "" : selected.threshold,
                          upperThreshold: e.target.value === "between" ? "" : null,
                        })
                      }
                    >
                      {Object.entries(COMPARISONS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  ))}
                  {selected.comparison !== "always"
                    ? field(
                        "threshold",
                        selected.comparison === "between" ? "Lower" : "Threshold",
                        (id, error) => (
                          <Input
                            {...attributes(id, error)}
                            mono
                            value={selected.threshold}
                            onChange={(e) => update({ threshold: e.target.value })}
                          />
                        ),
                      )
                    : null}
                  {selected.comparison === "between"
                    ? field("upperThreshold", "Upper", (id, error) => (
                        <Input
                          {...attributes(id, error)}
                          mono
                          value={selected.upperThreshold ?? ""}
                          onChange={(e) => update({ upperThreshold: e.target.value })}
                        />
                      ))
                    : null}
                  {selected.comparison !== "always" ? (
                    <p className="text-xs">Use a decimal number, for example -12.5 or 1e3.</p>
                  ) : null}
                  <label className="text-xs" htmlFor={`${uid}-addresses`}>
                    Addresses
                    <Select
                      id={`${uid}-addresses`}
                      value={
                        !selected.range
                          ? "whole"
                          : selected.range.start === selected.range.end
                            ? "single"
                            : "range"
                      }
                      onChange={(e) =>
                        update({
                          range:
                            e.target.value === "whole"
                              ? null
                              : e.target.value === "single"
                                ? {
                                    start: config.definition.startAddress,
                                    end: config.definition.startAddress,
                                  }
                                : {
                                    start: config.definition.startAddress,
                                    end:
                                      config.definition.startAddress +
                                      config.definition.quantity -
                                      1,
                                  },
                        })
                      }
                    >
                      <option value="whole">Whole poll</option>
                      <option value="single">Single register</option>
                      <option value="range">Range</option>
                    </Select>
                  </label>
                  {selected.range
                    ? (selected.range.start === selected.range.end
                        ? (["start"] as const)
                        : (["start", "end"] as const)
                      ).map((key) => (
                        <div key={key}>
                          {field(
                            `range.${key}`,
                            selected.range?.start === selected.range?.end
                              ? "Register address"
                              : key === "start"
                                ? "Start address"
                                : "End address",
                            (id, error) => (
                              <Input
                                {...attributes(id, error)}
                                mono
                                value={
                                  selectedEntry?.rangeTexts?.[key] ??
                                  (selected.range && selected.range[key] >= 0
                                    ? String(selected.range[key] + base)
                                    : "")
                                }
                                onChange={(e) => {
                                  if (!draft || !selectedEntry || !selected.range) return;
                                  const text = e.target.value;
                                  const address = /^[0-9]+$/.test(text) ? Number(text) - base : -1;
                                  const protocol =
                                    Number.isInteger(address) && address >= 0 && address <= 65535
                                      ? address
                                      : -1;
                                  const rangeTexts = selectedEntry.rangeTexts ?? {
                                    start: String(selected.range.start + base),
                                    end: String(selected.range.end + base),
                                  };
                                  set({
                                    entries: draft.entries.map((entry) =>
                                      entry.id === selectedEntry.id
                                        ? {
                                            ...entry,
                                            rangeTexts: {
                                              ...rangeTexts,
                                              [key]: text,
                                              ...(selected.range?.start === selected.range?.end
                                                ? { end: text }
                                                : {}),
                                            },
                                            rule: {
                                              ...entry.rule,
                                              range: {
                                                start: selected.range?.start ?? 0,
                                                end: selected.range?.end ?? 0,
                                                [key]: protocol,
                                                ...(selected.range?.start === selected.range?.end
                                                  ? { end: protocol }
                                                  : {}),
                                              },
                                            },
                                          }
                                        : entry,
                                    ),
                                    dirty: true,
                                  });
                                }}
                              />
                            ),
                          )}
                        </div>
                      ))
                    : null}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs" htmlFor={`${uid}-highlight`}>
                      Highlight
                    </label>
                    <Select
                      id={`${uid}-highlight`}
                      value={selected.colors ? "custom" : selected.highlight}
                      onChange={(e) => {
                        if (e.target.value === "custom")
                          update({
                            highlight: "lime",
                            colors: { background: "#EDEFF2", foreground: "#312F2E" },
                          });
                        else
                          update({
                            highlight: e.target.value as ValueColorRule["highlight"],
                            colors: null,
                          });
                      }}
                    >
                      <option value="lime">Lime</option>
                      <option value="neutral">Neutral</option>
                      <option value="warning">Warning (orange)</option>
                      <option value="custom">Custom colors</option>
                    </Select>
                  </div>
                  {selected.colors ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        {(["background", "foreground"] as const).map((key) =>
                          field(
                            `colors.${key}`,
                            key === "background" ? "Background color" : "Text color",
                            (id, error) => (
                              <Input
                                {...attributes(id, error)}
                                type="color"
                                value={selected.colors?.[key] ?? "#EDEFF2"}
                                onChange={(e) =>
                                  update({
                                    colors: {
                                      background: selected.colors?.background ?? "#EDEFF2",
                                      foreground: selected.colors?.foreground ?? "#312F2E",
                                      [key]: e.target.value,
                                    },
                                  })
                                }
                                className="h-10 cursor-pointer p-1"
                              />
                            ),
                          ),
                        )}
                      </div>
                      {(colorContrast(selected.colors.background, selected.colors.foreground) ??
                        0) < 4.5 ? (
                        <FieldMessage kind="warning" id={`${uid}-color-contrast-warning`}>
                          Low contrast may make values hard to read. You can still apply this rule.
                        </FieldMessage>
                      ) : null}
                    </>
                  ) : null}
                  <p className="text-xs">
                    Preview:{" "}
                    <span className={ruleClass(preview)} style={ruleStyle(preview)}>
                      <RuleMarker match={preview} />
                      25.3
                    </span>
                  </p>
                </>
              ) : null}
            </fieldset>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => void apply()}>
              {pending ? "Applying…" : "Apply rules"}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
