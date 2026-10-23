//! Persisted value rules; numeric evaluation remains in the frontend.
use crate::{FormatOverride, ValueFormat};
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ValueColorSource {
    Displayed,
    Raw,
    Scaled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ValueColorComparison {
    Always,
    Equals,
    NotEquals,
    LessThan,
    LessThanOrEqual,
    GreaterThan,
    GreaterThanOrEqual,
    Between,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ValueColorHighlight {
    Lime,
    Neutral,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValueRuleColors {
    pub background: String,
    pub foreground: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValueColorRange {
    pub start: u16,
    pub end: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValueColorRule {
    pub name: String,
    pub enabled: bool,
    #[serde(deserialize_with = "required_nullable")]
    pub range: Option<ValueColorRange>,
    pub source: ValueColorSource,
    pub comparison: ValueColorComparison,
    pub threshold: String,
    #[serde(deserialize_with = "required_nullable")]
    pub upper_threshold: Option<String>,
    pub highlight: ValueColorHighlight,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colors: Option<ValueRuleColors>,
}

fn rgb(hex: &str) -> Option<[u8; 3]> {
    let bytes = hex.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' {
        return None;
    }
    let parse = |at| u8::from_str_radix(std::str::from_utf8(&bytes[at..at + 2]).ok()?, 16).ok();
    Some([parse(1)?, parse(3)?, parse(5)?])
}

fn required_nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}

pub const MAX_COLOR_RULES: usize = 256;
pub const INTEGER_THRESHOLD_SYNTAX: &str =
    "Enter a whole decimal number for a 64-bit integer comparison.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColorRuleProblem {
    pub field: String,
    pub message: String,
}

fn problem(field: impl Into<String>, message: impl Into<String>) -> ColorRuleProblem {
    ColorRuleProblem {
        field: field.into(),
        message: message.into(),
    }
}

#[derive(Debug, PartialEq, PartialOrd)]
enum Threshold {
    Integer(i128),
    Decimal(f64),
}

fn threshold(text: &str, integer: bool) -> Result<Threshold, &'static str> {
    if text.len() > 256 {
        return Err("Enter a threshold with at most 256 characters.");
    }
    if text.contains(',') {
        return Err("Use a dot as the decimal separator.");
    }
    let text = text.trim();
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    if integer {
        if unsigned.is_empty() || !unsigned.bytes().all(|b| b.is_ascii_digit()) {
            return Err(INTEGER_THRESHOLD_SYNTAX);
        }
        let value = text
            .parse::<i128>()
            .ok()
            .filter(|v| (-i128::from(u64::MAX)..=i128::from(u64::MAX)).contains(v));
        return value
            .map(Threshold::Integer)
            .ok_or("Threshold must be between -18446744073709551615 and 18446744073709551615.");
    }
    let bad = "Enter a finite decimal number, for example -12.5 or 1e3.";
    let (mantissa, exponent) = unsigned
        .split_once(['e', 'E'])
        .map_or((unsigned, None), |(m, e)| (m, Some(e)));
    if let Some(exponent) = exponent {
        let digits = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return Err(bad);
        }
    }
    let mut dots = 0;
    let mut digits = 0;
    let mut nonzero = false;
    for b in mantissa.bytes() {
        if b == b'.' {
            dots += 1;
        } else if b.is_ascii_digit() {
            digits += 1;
            nonzero |= b != b'0';
        } else {
            return Err(bad);
        }
    }
    if dots > 1 || digits == 0 {
        return Err(bad);
    }
    let value = text.parse::<f64>().map_err(|_| bad)?;
    if !value.is_finite() {
        return Err(bad);
    }
    if value == 0.0 && nonzero {
        return Err("Threshold is too small to represent.");
    }
    Ok(Threshold::Decimal(value))
}

/// The formats a rule range (all addresses when `None`) can meet: the default `Unsigned`
/// when an address of the range has no override, then the format of each intersecting
/// override in `start` order.
fn formats_met(range: Option<&ValueColorRange>, overrides: &[FormatOverride]) -> Vec<ValueFormat> {
    let (lo, hi) = range.map_or((0, u16::MAX), |r| (r.start, r.end));
    let mut hits: Vec<&FormatOverride> = overrides
        .iter()
        .filter(|o| o.start <= hi && o.end >= lo)
        .collect();
    hits.sort_by_key(|o| (o.start, o.end));
    // Walk the range; any gap means the default format is met.
    let mut next = u32::from(lo);
    let mut uncovered = false;
    for o in &hits {
        if u32::from(o.start) > next {
            uncovered = true;
        }
        next = next.max(u32::from(o.end) + 1);
    }
    if next <= u32::from(hi) {
        uncovered = true;
    }
    let mut formats = Vec::new();
    if uncovered {
        formats.push(ValueFormat::Unsigned);
    }
    for o in hits {
        if !formats.contains(&o.format) {
            formats.push(o.format);
        }
    }
    formats
}

/// Validate all rules, including disabled rules, against every format each rule can meet
/// (BE-009): the default `Unsigned` where its range has no override, plus every override
/// intersecting its range (all overrides when the rule has no range).
/// # Errors
/// The first invalid field and its editor message.
pub fn check_color_rules(
    rules: &[ValueColorRule],
    overrides: &[FormatOverride],
) -> Result<(), ColorRuleProblem> {
    if rules.len() > MAX_COLOR_RULES {
        return Err(problem(
            "colorRules",
            "A poll can have at most 256 value color rules.",
        ));
    }
    for (i, rule) in rules.iter().enumerate() {
        let at = |key: &str, message| problem(format!("colorRules[{i}].{key}"), message);
        if rule.name.chars().any(char::is_control) {
            return Err(at("name", "Rule name cannot contain control characters."));
        }
        if rule.name.trim().is_empty() {
            return Err(at("name", "Enter a rule name."));
        }
        if rule.name.trim().chars().count() > 64 {
            return Err(at("name", "Rule name must be at most 64 characters."));
        }
        if rule.range.as_ref().is_some_and(|r| r.start > r.end) {
            return Err(at(
                "range.end",
                "End address must not be before the start address.",
            ));
        }
        if let Some(colors) = &rule.colors {
            if rgb(&colors.background).is_none() {
                return Err(at(
                    "colors.background",
                    "Choose a six-digit background color.",
                ));
            }
            if rgb(&colors.foreground).is_none() {
                return Err(at("colors.foreground", "Choose a six-digit text color."));
            }
        }
        if rule.comparison == ValueColorComparison::Always {
            if !rule.threshold.is_empty() || rule.upper_threshold.is_some() {
                return Err(at("threshold", "Always does not use a threshold."));
            }
            continue;
        }
        // The per-format logic only distinguishes integer and decimal thresholds; check
        // each mode once, in the order the formats are met.
        let mut modes: Vec<bool> = Vec::with_capacity(2);
        for format in formats_met(rule.range.as_ref(), overrides) {
            let integer = matches!(format, ValueFormat::Signed64 | ValueFormat::Unsigned64)
                && rule.source != ValueColorSource::Scaled;
            if !modes.contains(&integer) {
                modes.push(integer);
            }
        }
        for integer in modes {
            check_thresholds(rule, integer, &at)?;
        }
    }
    Ok(())
}

fn check_thresholds(
    rule: &ValueColorRule,
    integer: bool,
    at: &dyn Fn(&str, &'static str) -> ColorRuleProblem,
) -> Result<(), ColorRuleProblem> {
    let lower = threshold(&rule.threshold, integer).map_err(|m| at("threshold", m))?;
    match (&rule.upper_threshold, rule.comparison) {
        (None, ValueColorComparison::Between) => {
            Err(at("upperThreshold", "Between requires an upper threshold."))
        }
        (Some(upper), ValueColorComparison::Between) => {
            let upper = threshold(upper, integer).map_err(|m| at("upperThreshold", m))?;
            if upper < lower {
                return Err(at(
                    "upperThreshold",
                    "Upper threshold must be greater than or equal to lower threshold.",
                ));
            }
            Ok(())
        }
        (Some(_), _) => Err(at(
            "upperThreshold",
            "Only Between accepts an upper threshold.",
        )),
        (None, _) => Ok(()),
    }
}

/// Call only after validation, so trimming cannot hide invalid control characters.
pub fn normalize_color_rules(rules: &mut [ValueColorRule]) {
    for rule in rules {
        rule.name = rule.name.trim().into();
        rule.threshold = rule.threshold.trim().into();
        if let Some(upper) = &mut rule.upper_threshold {
            *upper = upper.trim().into();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ov(start: u16, end: u16, format: ValueFormat) -> FormatOverride {
        FormatOverride {
            start,
            end,
            format,
            swap_bytes: false,
            reverse_words: false,
        }
    }

    /// Every address uses `format` (the old poll-wide setting).
    fn all(format: ValueFormat) -> Vec<FormatOverride> {
        if format == ValueFormat::Unsigned {
            Vec::new()
        } else {
            vec![ov(0, u16::MAX, format)]
        }
    }

    #[test]
    fn rules_are_checked_against_every_format_their_range_meets() {
        let ranged = |text: &str, start, end| {
            let mut r = rule(text);
            r.range = Some(ValueColorRange { start, end });
            r
        };
        let u64s = [ov(0, 3, ValueFormat::Unsigned64)];
        let max = "18446744073709551615";
        assert!(check_color_rules(&[ranged(max, 0, 3)], &u64s).is_ok());
        // 0-4 also meets the default Unsigned at 4: still valid under both.
        assert!(check_color_rules(&[ranged(max, 0, 4)], &u64s).is_ok());
        let e = check_color_rules(&[ranged("1.5", 0, 3)], &u64s).unwrap_err();
        assert_eq!(e.field, "colorRules[0].threshold");
        assert_eq!(e.message, INTEGER_THRESHOLD_SYNTAX);
        // 1.5 under 0-4 fails too (Unsigned64 part), but a range outside the override
        // only meets the default.
        assert!(check_color_rules(&[ranged("1.5", 0, 4)], &u64s).is_err());
        assert!(check_color_rules(&[ranged("1.5", 4, 9)], &u64s).is_ok());
        // No range: the default plus all overrides.
        assert!(check_color_rules(&[rule("1.5")], &[]).is_ok());
        assert!(check_color_rules(&[rule("1.5")], &u64s).is_err());
        assert!(check_color_rules(&[rule("1.5")], &[ov(10, 11, ValueFormat::Float32)]).is_ok());
        // Gaps between overrides meet the default; full coverage does not.
        let pair = [
            ov(0, 1, ValueFormat::Float32),
            ov(4, 7, ValueFormat::Signed64),
        ];
        assert_eq!(
            formats_met(Some(&ValueColorRange { start: 0, end: 1 }), &pair),
            [ValueFormat::Float32]
        );
        assert_eq!(
            formats_met(Some(&ValueColorRange { start: 0, end: 7 }), &pair),
            [
                ValueFormat::Unsigned,
                ValueFormat::Float32,
                ValueFormat::Signed64
            ]
        );
        assert_eq!(
            formats_met(Some(&ValueColorRange { start: 4, end: 7 }), &pair),
            [ValueFormat::Signed64]
        );
        assert_eq!(
            formats_met(None, &all(ValueFormat::Hex)),
            [ValueFormat::Hex]
        );
        assert_eq!(formats_met(None, &[]), [ValueFormat::Unsigned]);
    }

    fn rule(text: &str) -> ValueColorRule {
        ValueColorRule {
            name: "High".into(),
            enabled: false,
            range: None,
            source: ValueColorSource::Raw,
            comparison: ValueColorComparison::GreaterThan,
            threshold: text.into(),
            upper_threshold: None,
            highlight: ValueColorHighlight::Lime,
            colors: None,
        }
    }

    #[test]
    fn custom_colors_require_valid_hex() {
        let mut r = rule("1");
        r.colors = Some(ValueRuleColors {
            background: "#17324D".into(),
            foreground: "#FFFFFF".into(),
        });
        assert!(check_color_rules(&[r.clone()], &all(ValueFormat::Unsigned)).is_ok());
        let stored = serde_json::to_value(&r).unwrap();
        assert_eq!(stored["colors"]["background"], "#17324D");
        assert_eq!(serde_json::from_value::<ValueColorRule>(stored).unwrap(), r);
        r.colors.as_mut().unwrap().foreground = "#123456".into();
        assert!(check_color_rules(&[r.clone()], &all(ValueFormat::Unsigned)).is_ok());
        r.colors.as_mut().unwrap().background = "red".into();
        assert_eq!(
            check_color_rules(&[r], &all(ValueFormat::Unsigned))
                .unwrap_err()
                .field,
            "colorRules[0].colors.background"
        );
    }

    #[test]
    fn always_rule_needs_no_threshold_and_preserves_single_address() {
        let mut r = rule("");
        r.comparison = ValueColorComparison::Always;
        r.range = Some(ValueColorRange { start: 11, end: 11 });
        assert!(check_color_rules(&[r.clone()], &all(ValueFormat::Unsigned)).is_ok());
        assert_eq!(serde_json::to_value(&r).unwrap()["comparison"], "always");
        r.threshold = "50".into();
        assert_eq!(
            check_color_rules(&[r], &all(ValueFormat::Unsigned))
                .unwrap_err()
                .field,
            "colorRules[0].threshold"
        );
    }

    #[test]
    fn decimal_threshold_grammar_underflow_and_precision() {
        for text in [
            "-12.5",
            ".5",
            "1.",
            "+1e3",
            "0e-999",
            "-0e999",
            "9007199254740993",
        ] {
            assert!(
                check_color_rules(&[rule(text)], &all(ValueFormat::Float64)).is_ok(),
                "{text}"
            );
        }
        for text in [
            "1e999", "1e-999", "NaN", "1,5", "0x10", "", "1 2", "1e", ".", "1.2.3", "??",
        ] {
            assert!(
                check_color_rules(&[rule(text)], &all(ValueFormat::Float64)).is_err(),
                "{text}"
            );
        }
        assert!(
            check_color_rules(&[rule(&"1".repeat(257))], &all(ValueFormat::Unsigned))
                .unwrap_err()
                .message
                .contains("256")
        );
        let mut rules = vec![rule(" +001.250e2 ")];
        rules[0].name = " High ".into();
        normalize_color_rules(&mut rules);
        assert_eq!(rules[0].threshold, "+001.250e2");
        assert_eq!(rules[0].name, "High");
    }

    #[test]
    fn integer_thresholds_are_exact_and_bounded_without_overflow() {
        for text in [
            "9007199254740992",
            "9007199254740993",
            "-9223372036854775808",
            "18446744073709551615",
            "-18446744073709551615",
            "-1",
        ] {
            assert!(
                check_color_rules(&[rule(text)], &all(ValueFormat::Unsigned64)).is_ok(),
                "{text}"
            );
        }
        for text in [
            "18446744073709551616",
            "-18446744073709551616",
            "-170141183460469231731687303715884105728",
            "1.0",
            "1e3",
        ] {
            assert!(
                check_color_rules(&[rule(text)], &all(ValueFormat::Signed64)).is_err(),
                "{text}"
            );
        }
        let mut r = rule("9007199254740993");
        r.comparison = ValueColorComparison::Between;
        r.upper_threshold = Some("9007199254740992".into());
        assert!(check_color_rules(&[r.clone()], &all(ValueFormat::Signed64))
            .unwrap_err()
            .field
            .ends_with("upperThreshold"));
        assert!(check_color_rules(&[r.clone()], &all(ValueFormat::Float64)).is_ok());
        r.upper_threshold = Some(r.threshold.clone());
        assert!(check_color_rules(&[r], &all(ValueFormat::Signed64)).is_ok());
        let mut scaled = rule("1.5");
        scaled.source = ValueColorSource::Scaled;
        assert!(check_color_rules(&[scaled], &all(ValueFormat::Signed64)).is_ok());
    }

    #[test]
    fn list_names_ranges_and_nullable_fields_are_strict() {
        assert!(check_color_rules(&[], &all(ValueFormat::Unsigned)).is_ok());
        assert!(check_color_rules(&vec![rule("1"); 256], &all(ValueFormat::Unsigned)).is_ok());
        assert_eq!(
            check_color_rules(&vec![rule("1"); 257], &all(ValueFormat::Unsigned))
                .unwrap_err()
                .field,
            "colorRules"
        );
        let mut r = rule("1");
        r.name = "?".repeat(64);
        r.range = Some(ValueColorRange {
            start: 0,
            end: 65535,
        });
        assert!(check_color_rules(&[r.clone()], &all(ValueFormat::Unsigned)).is_ok());
        r.name.push('?');
        assert!(check_color_rules(&[r.clone()], &all(ValueFormat::Unsigned)).is_err());
        r.name = "High\n".into();
        assert!(check_color_rules(&[r.clone()], &all(ValueFormat::Unsigned))
            .unwrap_err()
            .message
            .contains("control"));
        r.name = "High".into();
        r.range = Some(ValueColorRange { start: 2, end: 1 });
        assert!(check_color_rules(&[r], &all(ValueFormat::Unsigned))
            .unwrap_err()
            .field
            .ends_with("range.end"));
        let value = serde_json::to_value(rule("1")).unwrap();
        for key in [
            "range",
            "upperThreshold",
            "name",
            "enabled",
            "threshold",
            "source",
            "comparison",
            "highlight",
        ] {
            let mut bad = value.clone();
            bad.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<ValueColorRule>(bad).is_err(),
                "{key}"
            );
        }
        for (key, bad_value) in [
            ("extra", json!(true)),
            ("source", json!("other")),
            ("threshold", json!(1)),
            ("range", json!({"start": 0, "end": 1, "extra": 2})),
        ] {
            let mut bad = value.clone();
            bad[key] = bad_value;
            assert!(
                serde_json::from_value::<ValueColorRule>(bad).is_err(),
                "{key}"
            );
        }
        assert!(
            serde_json::from_value::<crate::PollViewSettings>(json!({"colorRules": null})).is_err()
        );
    }
}
