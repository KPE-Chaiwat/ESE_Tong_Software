import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
import { MAX_COLOR_RULES } from "../lib/color-rules";
export interface RuleDraft {
  entries: {
    id: string;
    rule: ValueColorRule;
    rangeTexts?: { start: string; end: string } | undefined;
  }[];
  selected: string | null;
  dirty: boolean;
  errors: Record<string, string>;
  error: string | null;
}
export function ruleDraft(rules: readonly ValueColorRule[]): RuleDraft {
  return {
    entries: rules.map((rule, i) => ({ id: `saved-${i}`, rule: structuredClone(rule) })),
    selected: rules.length ? "saved-0" : null,
    dirty: false,
    errors: {},
    error: null,
  };
}
export function newRule(rules: readonly ValueColorRule[]): ValueColorRule {
  let n = 1;
  while (rules.some((rule) => rule.name === `Rule ${n}`)) n++;
  return {
    name: `Rule ${n}`,
    enabled: true,
    range: null,
    source: "displayed",
    comparison: "greaterThan",
    threshold: "",
    upperThreshold: null,
    highlight: "lime",
  };
}

export function registerRuleDraft(
  rules: readonly ValueColorRule[],
  address: number,
  displayAddress: number,
): RuleDraft {
  const draft = ruleDraft(rules);
  const existing = draft.entries.find(
    ({ rule }) =>
      rule.comparison !== "always" && rule.range?.start === address && rule.range.end === address,
  );
  if (existing) return { ...draft, selected: existing.id };
  const onlyRule = draft.entries.length === 1 ? draft.entries[0] : undefined;
  if (onlyRule?.rule.range === null) {
    return {
      ...draft,
      entries: [
        { ...onlyRule, rule: { ...onlyRule.rule, range: { start: address, end: address } } },
      ],
      dirty: true,
    };
  }
  if (rules.length >= MAX_COLOR_RULES)
    return { ...draft, error: `A poll can have at most ${MAX_COLOR_RULES} value color rules.` };
  const id = crypto.randomUUID();
  return {
    ...draft,
    entries: [
      {
        id,
        rule: {
          ...newRule(rules),
          name: `Register ${displayAddress}`,
          range: { start: address, end: address },
        },
      },
      ...draft.entries,
    ],
    selected: id,
    dirty: true,
  };
}

export function registerColorDraft(
  rules: readonly ValueColorRule[],
  address: number,
  displayAddress: number,
): RuleDraft {
  const draft = ruleDraft(rules);
  const existing = draft.entries.find(
    ({ rule }) =>
      rule.comparison === "always" && rule.range?.start === address && rule.range.end === address,
  );
  if (existing)
    return {
      ...draft,
      entries: [existing, ...draft.entries.filter((entry) => entry.id !== existing.id)],
      selected: existing.id,
      dirty: draft.entries[0]?.id !== existing.id,
    };
  const previousWholePoll =
    draft.entries.length === 1 &&
    draft.entries[0]?.rule.range === null &&
    draft.entries[0].rule.colors
      ? draft.entries[0]
      : null;
  if (rules.length >= MAX_COLOR_RULES)
    return { ...draft, error: `A poll can have at most ${MAX_COLOR_RULES} value color rules.` };
  const id = crypto.randomUUID();
  return {
    ...draft,
    entries: [
      {
        id,
        rule: {
          ...newRule(rules),
          name: `Register ${displayAddress}`,
          range: { start: address, end: address },
          comparison: "always",
          colors: previousWholePoll?.rule.colors ?? {
            background: "#EDEFF2",
            foreground: "#312F2E",
          },
        },
      },
      ...draft.entries.map((entry) =>
        entry.id === previousWholePoll?.id
          ? { ...entry, rule: { ...entry.rule, enabled: false } }
          : entry,
      ),
    ],
    selected: id,
    dirty: true,
  };
}
