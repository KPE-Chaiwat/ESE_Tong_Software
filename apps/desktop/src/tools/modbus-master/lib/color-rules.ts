import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
export type Numeric = number | bigint | null;
export const MAX_COLOR_RULES = 256;
export const COMPARISONS = {
  always: "always (no condition)",
  equals: "equals (=)",
  notEquals: "not equal to (!=)",
  lessThan: "less than (<)",
  lessThanOrEqual: "less than or equal to (<=)",
  greaterThan: "greater than (>)",
  greaterThanOrEqual: "greater than or equal to (>=)",
  between: "between (inclusive)",
} as const;
export const integer64 = (format: string, source: string) =>
  (format === "signed64" || format === "unsigned64") && source !== "scaled";
export function colorContrast(background: string, foreground: string): number | null {
  const parse = (hex: string) =>
    /^#[\da-fA-F]{6}$/.test(hex)
      ? [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
      : null;
  const bg = parse(background);
  const fg = parse(foreground);
  if (!bg || !fg) return null;
  const luminance = (rgb: number[]) => {
    const [red = 0, green = 0, blue = 0] = rgb.map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const a = luminance(bg);
  const b = luminance(fg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function parseThreshold(
  text: string,
  exact: boolean,
): { value: number | bigint } | { error: string } {
  const t = text.trim();
  if (t.length > 256) return { error: "Enter a threshold with at most 256 characters." };
  if (t.includes(",")) return { error: "Use a dot as the decimal separator." };
  if (exact) {
    if (!/^[+-]?[0-9]+$/.test(t))
      return { error: "Enter a whole decimal number for a 64-bit integer comparison." };
    const value = BigInt(t);
    if (value > 18446744073709551615n || value < -18446744073709551615n)
      return { error: "Threshold must be between -18446744073709551615 and 18446744073709551615." };
    return { value };
  }
  if (
    !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(t) ||
    !Number.isFinite(Number(t))
  )
    return { error: "Enter a finite decimal number, for example -12.5 or 1e3." };
  const value = Number(t);
  if (value === 0 && /[1-9]/.test(t.split(/[eE]/)[0] ?? ""))
    return { error: "Threshold is too small to represent." };
  return { value };
}
export function validateRules(
  rules: readonly ValueColorRule[],
  format: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (rules.length > MAX_COLOR_RULES)
    errors.colorRules = `A poll can have at most ${MAX_COLOR_RULES} value color rules.`;
  rules.forEach((rule, i) => {
    const error = (field: string, message: string) => {
      errors[`colorRules[${i}].${field}`] = message;
    };
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rule names must reject Unicode control characters.
    if (/[\u0000-\u001f\u007f-\u009f]/.test(rule.name))
      error("name", "Rule name cannot contain control characters.");
    else if (!rule.name.trim()) error("name", "Enter a rule name.");
    else if ([...rule.name.trim()].length > 64)
      error("name", "Rule name must be at most 64 characters.");
    if (rule.range) {
      for (const key of ["start", "end"] as const)
        if (!Number.isInteger(rule.range[key]) || rule.range[key] < 0 || rule.range[key] > 65535)
          error(
            `range.${key}`,
            `${key === "start" ? "Start" : "End"} address must be a whole number from 0 to 65535.`,
          );
      if (rule.range.end < rule.range.start)
        error("range.end", "End address must not be before the start address.");
    }
    if (!["displayed", "raw", "scaled"].includes(rule.source))
      error("source", "Choose a supported source.");
    if (!(rule.comparison in COMPARISONS)) error("comparison", "Choose a supported comparison.");
    if (!["lime", "neutral", "warning"].includes(rule.highlight))
      error("highlight", "Choose a supported highlight.");
    if (rule.colors) {
      if (!/^#[\da-fA-F]{6}$/.test(rule.colors.background))
        error("colors.background", "Choose a six-digit background color.");
      if (!/^#[\da-fA-F]{6}$/.test(rule.colors.foreground))
        error("colors.foreground", "Choose a six-digit text color.");
    }
    if (rule.comparison === "always") {
      if (rule.threshold !== "" || rule.upperThreshold !== null)
        error("threshold", "Always does not use a threshold.");
    } else {
      const low = parseThreshold(rule.threshold, integer64(format, rule.source));
      if ("error" in low) error("threshold", low.error);
      if (rule.comparison === "between") {
        const high = parseThreshold(rule.upperThreshold ?? "", integer64(format, rule.source));
        if ("error" in high) error("upperThreshold", high.error);
        else if ("value" in low && high.value < low.value)
          error(
            "upperThreshold",
            "Upper threshold must be greater than or equal to lower threshold.",
          );
      } else if (rule.upperThreshold !== null)
        error("upperThreshold", "Only Between accepts an upper threshold.");
    }
  });
  return errors;
}
export interface RuleMatch {
  rule: ValueColorRule;
  description: string;
}
export function matchRule(
  rules: readonly ValueColorRule[],
  input: {
    address: number;
    raw: Numeric;
    scaled: Numeric;
    displayed: Numeric;
    column: "Raw" | "Scaled" | "Interpreted";
    current: boolean;
    format: string;
  },
): RuleMatch | null {
  const finite = (v: Numeric): v is number | bigint =>
    v !== null && (typeof v === "bigint" || Number.isFinite(v));
  if (!input.current || !finite(input.displayed)) return null;
  for (const [index, rule] of rules.entries()) {
    if (
      !rule.enabled ||
      (rule.range && (input.address < rule.range.start || input.address > rule.range.end))
    )
      continue;
    if (rule.comparison === "always")
      return {
        rule,
        description: `Rule: ${rule.name}. Always. Rule ${index + 1}.${rule.highlight === "warning" ? " Warning rule." : ""}`,
      };
    const value =
      rule.source === "displayed"
        ? input.displayed
        : rule.source === "raw"
          ? input.raw
          : input.scaled;
    if (!finite(value)) continue;
    const exact = integer64(input.format, rule.source);
    const low = parseThreshold(rule.threshold, exact);
    const high =
      rule.comparison === "between" ? parseThreshold(rule.upperThreshold ?? "", exact) : low;
    if (!("value" in low) || !("value" in high)) continue;
    // Combined 32-bit integers fit binary64 exactly; 64-bit integers never cross this conversion.
    const n =
      exact && typeof value === "number"
        ? BigInt(value)
        : typeof value === "bigint" && !exact
          ? Number(value)
          : value;
    const a = low.value;
    const b = high.value;
    const matches =
      rule.comparison === "equals"
        ? n === a
        : rule.comparison === "notEquals"
          ? n !== a
          : rule.comparison === "lessThan"
            ? n < a
            : rule.comparison === "lessThanOrEqual"
              ? n <= a
              : rule.comparison === "greaterThan"
                ? n > a
                : rule.comparison === "greaterThanOrEqual"
                  ? n >= a
                  : n >= a && n <= b;
    if (matches)
      return {
        rule,
        description: `Rule: ${rule.name}. ${rule.source === "displayed" ? `Displayed → ${input.column}` : rule.source === "raw" ? "Raw" : "Scaled"} ${COMPARISONS[rule.comparison]} ${rule.threshold}${rule.comparison === "between" ? ` and ${rule.upperThreshold}` : ""}. Rule ${index + 1}.${rule.highlight === "warning" ? " Warning rule." : ""}`,
      };
  }
  return null;
}
