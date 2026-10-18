//! Per-poll view settings: display, value scaling (DES-003) and aliases (DES-002 2.3.4).
//!
//! Rust stores and relays these values and writes them to profiles. It never interprets a
//! scale: it only checks shape and size limits (BE-002 PM decision "Scale").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Raw value format of the data table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ValueFormat {
    Unsigned,
    Signed,
    Hex,
    Binary,
    Signed32,
    Unsigned32,
    Float32,
    Signed64,
    Unsigned64,
    Float64,
}

/// Display options of one poll.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplaySettings {
    pub format: ValueFormat,
    pub swap_bytes: bool,
    pub reverse_words: bool,
    #[ts(type = "0 | 1")]
    pub address_base: u8,
    /// Alias column shown (default true).
    pub show_alias: bool,
    /// "Include alias in copy" (default false).
    pub copy_alias: bool,
}

impl Default for DisplaySettings {
    fn default() -> Self {
        Self {
            format: ValueFormat::Unsigned,
            swap_bytes: false,
            reverse_words: false,
            address_base: 0,
            show_alias: true,
            copy_alias: false,
        }
    }
}

/// Scale preset (DES-003 section 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ScalePreset {
    None,
    Current4to20,
    Voltage0to10,
    Divide,
    Linear,
}

/// Out-of-range handling of linear presets (DES-003 1.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ScaleOutOfRange {
    Flag,
    Clamp,
}

/// A scale (DES-003 1.1). Interpreted by the frontend only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScaleSettings {
    pub preset: ScalePreset,
    /// X is read as signed 16-bit.
    pub raw_signed: bool,
    /// Raw range (linear presets), -32768..65535.
    pub x_min: i32,
    pub x_max: i32,
    /// Engineering range (linear presets).
    pub y_min: f64,
    pub y_max: f64,
    /// Divide preset.
    pub divisor: f64,
    /// 0-6.
    pub decimals: u8,
    /// At most 16 characters (the UI allows 12).
    pub unit: String,
    pub out_of_range: ScaleOutOfRange,
}

/// A scale for an inclusive range of protocol addresses (DES-003 3.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScaleOverride {
    pub start: u16,
    pub end: u16,
    pub scale: ScaleSettings,
}

/// Which value columns the data table shows (DES-003 1.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ValueColumns {
    #[default]
    Raw,
    Scaled,
    Both,
}

/// An alias for one protocol address (DES-002 2.3.5). Lists are sorted by address with
/// unique addresses, at most 2000 per poll.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AliasEntry {
    pub address: u16,
    /// 1-32 characters, no leading/trailing space, no control characters.
    pub alias: String,
}

/// Limits checked by the backend.
pub const MAX_ALIASES: usize = 2000;
pub const MAX_ALIAS_CHARS: usize = 32;
pub const MAX_SCALE_OVERRIDES: usize = 64;
pub const MAX_SCALE_UNIT_CHARS: usize = 16;
pub const MAX_SCALE_DECIMALS: u8 = 6;

/// Checks an alias text (DES-002 section 4). Empty text is not an alias (the UI removes
/// it instead of storing it).
///
/// # Errors
/// The DES-002 message of the first failing rule.
pub fn check_alias_text(alias: &str) -> Result<(), String> {
    if alias.trim().is_empty() {
        return Err("Alias cannot be empty.".into());
    }
    if alias.chars().count() > MAX_ALIAS_CHARS {
        return Err("Alias must be at most 32 characters.".into());
    }
    if alias.trim() != alias {
        return Err("Alias cannot start or end with a space.".into());
    }
    if alias.chars().any(char::is_control) {
        return Err("Alias cannot contain control characters.".into());
    }
    Ok(())
}

/// Checks an alias list: at most 2000 entries, unique addresses, valid texts.
///
/// # Errors
/// A user-facing message.
pub fn check_aliases(aliases: &[AliasEntry]) -> Result<(), String> {
    if aliases.len() > MAX_ALIASES {
        return Err("A poll can have at most 2000 aliases.".into());
    }
    let mut seen = std::collections::HashSet::with_capacity(aliases.len());
    for a in aliases {
        if !seen.insert(a.address) {
            return Err(format!("Address {} has more than one alias.", a.address));
        }
        check_alias_text(&a.alias).map_err(|m| format!("Alias for address {}: {m}", a.address))?;
    }
    Ok(())
}

/// Shape and size checks of a scale (no interpretation).
///
/// # Errors
/// A message naming the offending field.
pub fn check_scale(scale: &ScaleSettings) -> Result<(), String> {
    if !(-32_768..=65_535).contains(&scale.x_min) || !(-32_768..=65_535).contains(&scale.x_max) {
        return Err("Raw min and max must be from -32768 to 65535.".into());
    }
    if ![scale.y_min, scale.y_max, scale.divisor]
        .iter()
        .all(|v| v.is_finite())
    {
        return Err("Scale numbers must be finite.".into());
    }
    if scale.decimals > MAX_SCALE_DECIMALS {
        return Err("Decimals must be a whole number from 0 to 6.".into());
    }
    if scale.unit.chars().count() > MAX_SCALE_UNIT_CHARS {
        return Err("Unit must be at most 16 characters.".into());
    }
    if scale.unit.chars().any(char::is_control) {
        return Err("Unit cannot contain control characters.".into());
    }
    Ok(())
}

/// Checks the overrides of one poll: at most 64, `start <= end`, valid scales.
///
/// # Errors
/// A user-facing message.
pub fn check_scale_overrides(overrides: &[ScaleOverride]) -> Result<(), String> {
    if overrides.len() > MAX_SCALE_OVERRIDES {
        return Err("A poll can have at most 64 scale overrides.".into());
    }
    for o in overrides {
        if o.start > o.end {
            return Err(format!(
                "Scale override {}-{}: the end address must not be before the start address.",
                o.start, o.end
            ));
        }
        check_scale(&o.scale).map_err(|m| format!("Scale override {}-{}: {m}", o.start, o.end))?;
    }
    Ok(())
}

/// Checks `addressBase` (0 or 1).
///
/// # Errors
/// A message naming the field.
pub fn check_display(display: &DisplaySettings) -> Result<(), String> {
    if display.address_base > 1 {
        return Err(format!(
            "display.addressBase must be 0 or 1 (found {}).",
            display.address_base
        ));
    }
    Ok(())
}
