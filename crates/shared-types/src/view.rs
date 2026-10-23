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

/// Display options of one poll (schema 6: the value format is per register range, see
/// [`FormatOverride`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplaySettings {
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
            address_base: 0,
            show_alias: true,
            copy_alias: false,
        }
    }
}

/// The value format of an inclusive range of protocol addresses (REQ-009, BE-009).
/// `end - start + 1` is a multiple of [`format_width`]; groups are formed from `start`.
/// Addresses without an override use the default: Unsigned, big-endian, 16-bit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormatOverride {
    /// First register of the first group.
    pub start: u16,
    /// Inclusive.
    pub end: u16,
    pub format: ValueFormat,
    /// Only for 32-bit and 64-bit formats.
    pub swap_bytes: bool,
    /// Only for 32-bit and 64-bit formats.
    pub reverse_words: bool,
}

/// Most format overrides one poll can have.
pub const MAX_FORMAT_OVERRIDES: usize = 256;

/// Registers per value of a format: 1, 2 or 4.
#[must_use]
pub fn format_width(format: ValueFormat) -> u16 {
    match format {
        ValueFormat::Unsigned | ValueFormat::Signed | ValueFormat::Hex | ValueFormat::Binary => 1,
        ValueFormat::Signed32 | ValueFormat::Unsigned32 | ValueFormat::Float32 => 2,
        ValueFormat::Signed64 | ValueFormat::Unsigned64 | ValueFormat::Float64 => 4,
    }
}

fn format_label(format: ValueFormat) -> &'static str {
    match format {
        ValueFormat::Unsigned => "Unsigned",
        ValueFormat::Signed => "Signed",
        ValueFormat::Hex => "Hex",
        ValueFormat::Binary => "Binary",
        ValueFormat::Signed32 => "Signed 32-bit",
        ValueFormat::Unsigned32 => "Unsigned 32-bit",
        ValueFormat::Float32 => "Float 32-bit",
        ValueFormat::Signed64 => "Signed 64-bit",
        ValueFormat::Unsigned64 => "Unsigned 64-bit",
        ValueFormat::Float64 => "Float 64-bit",
    }
}

/// Sorts overrides by `start` (the stored order).
pub fn sort_format_overrides(overrides: &mut [FormatOverride]) {
    overrides.sort_by_key(|o| (o.start, o.end));
}

/// Checks the format overrides of one poll: at most 256, `start <= end`, a length that is
/// a multiple of the format width, no byte/word flags on 16-bit formats, no overlaps. The
/// input may be unsorted (it is checked in `start` order; callers store it sorted).
///
/// # Errors
/// The BE-009 message of the first failing rule.
pub fn check_format_overrides(overrides: &[FormatOverride]) -> Result<(), String> {
    if overrides.len() > MAX_FORMAT_OVERRIDES {
        return Err("A poll can have at most 256 format overrides.".into());
    }
    let mut sorted = overrides.to_vec();
    sort_format_overrides(&mut sorted);
    for o in &sorted {
        let (start, end) = (o.start, o.end);
        if start > end {
            return Err(format!(
                "Format override {start}-{end}: the end address must not be before the start address."
            ));
        }
        let width = format_width(o.format);
        let len = u32::from(end) - u32::from(start) + 1;
        if len % u32::from(width) != 0 {
            return Err(format!(
                "Format override {start}-{end}: {} needs a multiple of {width} registers.",
                format_label(o.format)
            ));
        }
        if width == 1 && (o.swap_bytes || o.reverse_words) {
            return Err(format!(
                "Format override {start}-{end}: byte and word order apply to 32-bit and 64-bit formats only."
            ));
        }
    }
    for pair in sorted.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        if b.start <= a.end {
            return Err(format!(
                "Format overrides {}-{} and {}-{} overlap.",
                a.start, a.end, b.start, b.end
            ));
        }
    }
    Ok(())
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
