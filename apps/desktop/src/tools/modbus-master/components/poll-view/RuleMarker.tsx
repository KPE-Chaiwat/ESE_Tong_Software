import type { CSSProperties } from "react";
import type { RuleMatch } from "../../lib/color-rules";
export const ruleClass = (match: RuleMatch | null | undefined) =>
  !match
    ? ""
    : `value-rule ${match.rule.colors ? "value-rule-custom" : `value-rule-${match.rule.highlight}`}`;
export const ruleStyle = (match: RuleMatch | null | undefined): CSSProperties | undefined =>
  match?.rule.colors
    ? ({
        "--rule-bg": match.rule.colors.background,
        "--rule-fg": match.rule.colors.foreground,
      } as CSSProperties)
    : undefined;
export function RuleMarker({ match }: { match: RuleMatch | null | undefined }) {
  if (!match) return null;
  return (
    <span
      role="img"
      aria-label={match.description}
      title={match.description}
      className={`inline-block shrink-0 px-0.5 ${ruleClass(match)}`}
      style={ruleStyle(match)}
    >
      {match.rule.highlight === "warning" ? "⚠" : "◆"}
    </span>
  );
}
