//! Decode untrusted view/profile JSON inside the command, preserving AppError envelopes.
use crate::error::{AppError, AppResult};
use serde::de::DeserializeOwned;
use serde_json::Value;
use shared_types::{
    AppErrorCode, DisplaySettings, PollConfigInput, PollViewSettings, Profile, ValueColorRule,
    PROFILE_SCHEMA_VERSION,
};

fn invalid(code: AppErrorCode, field: impl Into<String>, message: impl Into<String>) -> AppError {
    AppError::new(code, message).with_field(field)
}

fn view_shape(value: &Value, code: AppErrorCode, complete: bool) -> AppResult<()> {
    if complete || value.get("display").is_some() {
        serde_json::from_value::<DisplaySettings>(
            value.get("display").cloned().unwrap_or(Value::Null),
        )
        .map_err(|_| {
            invalid(
                code,
                "display",
                "Choose a supported interpretation and byte/word order.",
            )
        })?;
    }
    let Some(rules) = value.get("colorRules") else {
        return if complete {
            Err(invalid(
                code,
                "colorRules",
                "Enter a supported value color rule.",
            ))
        } else {
            Ok(())
        };
    };
    let rules = rules
        .as_array()
        .ok_or_else(|| invalid(code, "colorRules", "Enter a supported value color rule."))?;
    if rules.len() > shared_types::MAX_COLOR_RULES {
        return Err(invalid(
            code,
            "colorRules",
            "A poll can have at most 256 value color rules.",
        ));
    }
    for (i, rule) in rules.iter().enumerate() {
        let at = |key: &str, message| invalid(code, format!("colorRules[{i}].{key}"), message);
        let object = rule
            .as_object()
            .ok_or_else(|| at("name", "Enter a supported value color rule."))?;
        let keys = [
            "name",
            "enabled",
            "range",
            "source",
            "comparison",
            "threshold",
            "upperThreshold",
            "highlight",
        ];
        if !(object.len() == keys.len()
            || (object.len() == keys.len() + 1 && object.contains_key("colors")))
            || keys.iter().any(|key| !object.contains_key(*key))
        {
            return Err(at("name", "Enter a supported value color rule."));
        }
        if let Some(colors) = object.get("colors") {
            if !colors.is_null() {
                let pair = colors
                    .as_object()
                    .filter(|pair| {
                        pair.len() == 2
                            && pair.contains_key("background")
                            && pair.contains_key("foreground")
                    })
                    .ok_or_else(|| {
                        at("colors.background", "Choose a six-digit background color.")
                    })?;
                for (key, message) in [
                    ("background", "Choose a six-digit background color."),
                    ("foreground", "Choose a six-digit text color."),
                ] {
                    if !pair[key].is_string() {
                        return Err(at(&format!("colors.{key}"), message));
                    }
                }
            }
        }
        if !rule["name"].is_string() || !rule["enabled"].is_boolean() {
            return Err(at("name", "Enter a supported value color rule."));
        }
        if !rule["range"].is_null() {
            let range = rule["range"]
                .as_object()
                .filter(|r| r.len() == 2 && r.contains_key("start") && r.contains_key("end"))
                .ok_or_else(|| at("range.start", "Enter a supported value color rule."))?;
            for (key, message) in [
                (
                    "start",
                    "Start address must be a whole number from 0 to 65535.",
                ),
                ("end", "End address must be a whole number from 0 to 65535."),
            ] {
                if range[key].as_u64().is_none_or(|n| n > u64::from(u16::MAX)) {
                    return Err(at(&format!("range.{key}"), message));
                }
            }
        }
        for (key, allowed, message) in [
            (
                "source",
                &["displayed", "raw", "scaled"][..],
                "Choose a supported source.",
            ),
            (
                "comparison",
                &[
                    "always",
                    "equals",
                    "notEquals",
                    "lessThan",
                    "lessThanOrEqual",
                    "greaterThan",
                    "greaterThanOrEqual",
                    "between",
                ][..],
                "Choose a supported comparison.",
            ),
            (
                "highlight",
                &["lime", "neutral", "warning"][..],
                "Choose a supported highlight.",
            ),
        ] {
            if !rule[key].as_str().is_some_and(|s| allowed.contains(&s)) {
                return Err(at(key, message));
            }
        }
        serde_json::from_value::<ValueColorRule>(rule.clone())
            .map_err(|_| at("threshold", "Enter a supported value color rule."))?;
    }
    Ok(())
}

fn decode<T: DeserializeOwned>(value: Value, code: AppErrorCode) -> AppResult<T> {
    serde_json::from_value(value).map_err(|e| invalid(code, "view", e.to_string()))
}

pub fn poll_input(value: Value) -> AppResult<PollConfigInput> {
    view_shape(&value, AppErrorCode::Validation, true)?;
    decode(value, AppErrorCode::Validation)
}

pub fn poll_view(value: Value) -> AppResult<PollViewSettings> {
    view_shape(&value, AppErrorCode::Validation, false)?;
    decode(value, AppErrorCode::Validation)
}

pub fn profile(value: Value) -> AppResult<Profile> {
    let version = value.get("schemaVersion").and_then(Value::as_u64);
    if version.is_some_and(|v| v > u64::from(PROFILE_SCHEMA_VERSION)) {
        return Err(invalid(
            AppErrorCode::UnsupportedSchema,
            "schemaVersion",
            "This profile uses a newer schema.",
        ));
    }
    if version != Some(u64::from(PROFILE_SCHEMA_VERSION)) {
        return Err(invalid(
            AppErrorCode::InvalidProfile,
            "schemaVersion",
            "Expected profile schema 3.",
        ));
    }
    if let Some(polls) = value.get("polls").and_then(Value::as_array) {
        for poll in polls {
            view_shape(poll, AppErrorCode::InvalidProfile, true)?;
        }
    }
    let mut profile: Profile = decode(value, AppErrorCode::InvalidProfile)?;
    platform::mm_profile::check_profile(&profile)
        .map_err(|p| invalid(AppErrorCode::InvalidProfile, p.field, p.message))?;
    for poll in &mut profile.polls {
        shared_types::normalize_color_rules(&mut poll.color_rules);
    }
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rule() -> Value {
        json!({"name":"High", "enabled":false, "range":null, "source":"raw", "comparison":"greaterThan", "threshold":"1", "upperThreshold":null, "highlight":"lime"})
    }

    #[test]
    fn malformed_wire_values_return_public_validation_envelopes() {
        for display in [
            json!(null),
            json!({"format":"float64"}),
            json!({"format":"other", "addressBase":0,"showAlias":true,"copyAlias":false,"swapBytes":false,"reverseWords":false}),
        ] {
            let error = poll_view(json!({"display":display})).unwrap_err().0;
            assert_eq!(error.code, AppErrorCode::Validation);
            assert_eq!(error.field.as_deref(), Some("display"));
            assert_eq!(
                error.message,
                "Choose a supported interpretation and byte/word order."
            );
        }
        for (key, value, field) in [
            ("source", json!("unknown"), "source"),
            ("comparison", json!(42), "comparison"),
            ("highlight", json!("red"), "highlight"),
            ("range", json!({"start":-1,"end":5}), "range.start"),
            ("threshold", json!(12), "threshold"),
        ] {
            let mut r = rule();
            r[key] = value;
            let error = poll_view(json!({"colorRules":[r]})).unwrap_err().0;
            assert_eq!(error.code, AppErrorCode::Validation);
            assert_eq!(error.field, Some(format!("colorRules[0].{field}")));
        }
        assert!(poll_view(json!({"colorRules":null})).is_err());
        assert!(poll_view(json!({"colorRules":[]})).is_ok());
        assert!(poll_view(json!({})).is_ok());
        assert_eq!(
            profile(json!({"schemaVersion":6})).unwrap_err().0.code,
            AppErrorCode::UnsupportedSchema
        );
        assert_eq!(
            profile(json!({"schemaVersion":2})).unwrap_err().0.code,
            AppErrorCode::InvalidProfile
        );
    }
}
