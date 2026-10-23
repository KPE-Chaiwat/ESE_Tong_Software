//! Profile DTOs: schema 6 plus explicit schema 1, 2 and 3-5 shapes for migration.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::layout::{PollViewPlacement, WindowPlacement, WorkspaceProfile};
use crate::modbus::{ConnectionConfig, PollDefinition};
use crate::view::{
    AliasEntry, DisplaySettings, FormatOverride, ScaleOverride, ScaleSettings, ValueColumns,
    ValueFormat,
};
use crate::ValueColorRule;

/// Profile schema version written by this build. Schemas 1-5 migrate on read;
/// newer schemas are rejected with `unsupportedSchema`.
pub const PROFILE_SCHEMA_VERSION: u32 = 6;

/// One poll of a profile, in list order (DES-002 6.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollProfile {
    pub name: String,
    pub definition: PollDefinition,
    pub active: bool,
    pub display: DisplaySettings,
    /// Sorted by `start`, non-overlapping, at most 256 (schema 6).
    pub format_overrides: Vec<FormatOverride>,
    pub color_rules: Vec<ValueColorRule>,
    pub scale: Option<ScaleSettings>,
    pub scale_overrides: Vec<ScaleOverride>,
    pub value_columns: ValueColumns,
    /// Sorted by address, unique addresses, at most 2000.
    pub aliases: Vec<AliasEntry>,
    pub view: PollViewPlacement,
}

/// A saved Modbus Master setup, schema 6.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// 6. Checked by the backend on save.
    pub schema_version: u32,
    /// Max 64 characters, none of `\ / : * ? " < > |`. Unique per tool, case-insensitive.
    pub name: String,
    pub connection: ConnectionConfig,
    pub auto_start_poll: bool,
    /// The connection window placement, if known.
    pub connection_window: Option<WindowPlacement>,
    pub workspace: WorkspaceProfile,
    /// 0-16 polls in list order (also the tile order).
    pub polls: Vec<PollProfile>,
    /// Set by `profiles_get` when the file had an older schema (1-5); the file stays as it
    /// is until saved. Ignored by `profiles_save` and never written.
    pub migrated_from: Option<u32>,
}

/// Schema 1 display settings (BE-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySettingsV1 {
    pub format: LegacyValueFormat,
    pub address_base: u8,
}

/// A schema 1 profile (BE-001): one poll. Read only, for migration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileV1 {
    pub schema_version: u32,
    pub name: String,
    pub connection: ConnectionConfig,
    pub poll: PollDefinition,
    pub display: DisplaySettingsV1,
    pub auto_start_poll: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub name: String,
    /// File modification time, ms since the Unix epoch.
    #[ts(type = "number")]
    pub modified_at: u64,
    /// For example `TCP 192.168.1.10:502` or `RTU COM3 9600 8E1`. For an unreadable
    /// file it is the problem text.
    pub connection_summary: String,
    /// False when the file cannot be opened (newer schema or damaged); `profiles_get` fails.
    pub readable: bool,
}

/// The closed format domain of schema 1 and 2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LegacyValueFormat {
    Unsigned,
    Signed,
    Hex,
    Binary,
}

impl From<LegacyValueFormat> for ValueFormat {
    fn from(value: LegacyValueFormat) -> Self {
        match value {
            LegacyValueFormat::Unsigned => Self::Unsigned,
            LegacyValueFormat::Signed => Self::Signed,
            LegacyValueFormat::Hex => Self::Hex,
            LegacyValueFormat::Binary => Self::Binary,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySettingsV2 {
    pub format: LegacyValueFormat,
    pub address_base: u8,
    pub show_alias: bool,
    pub copy_alias: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollProfileV2 {
    pub name: String,
    pub definition: PollDefinition,
    pub active: bool,
    pub display: DisplaySettingsV2,
    pub scale: Option<ScaleSettings>,
    pub scale_overrides: Vec<ScaleOverride>,
    pub value_columns: ValueColumns,
    pub aliases: Vec<AliasEntry>,
    pub view: PollViewPlacement,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileV2 {
    pub name: String,
    pub connection: ConnectionConfig,
    pub auto_start_poll: bool,
    pub connection_window: Option<WindowPlacement>,
    pub workspace: WorkspaceProfile,
    pub polls: Vec<PollProfileV2>,
}

/// Schema 3-5 display settings: one poll-wide format and byte/word order. Read only, for
/// migration to schema 6 format overrides.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplaySettingsV5 {
    pub format: ValueFormat,
    pub swap_bytes: bool,
    pub reverse_words: bool,
    pub address_base: u8,
    pub show_alias: bool,
    pub copy_alias: bool,
}

/// One poll of a schema 3-5 profile. Read only, for migration.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollProfileV5 {
    pub name: String,
    pub definition: PollDefinition,
    pub active: bool,
    pub display: DisplaySettingsV5,
    pub color_rules: Vec<ValueColorRule>,
    pub scale: Option<ScaleSettings>,
    pub scale_overrides: Vec<ScaleOverride>,
    pub value_columns: ValueColumns,
    pub aliases: Vec<AliasEntry>,
    pub view: PollViewPlacement,
}

/// A schema 3-5 profile. Read only, for migration.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileV5 {
    pub name: String,
    pub connection: ConnectionConfig,
    pub auto_start_poll: bool,
    pub connection_window: Option<WindowPlacement>,
    pub workspace: WorkspaceProfile,
    pub polls: Vec<PollProfileV5>,
}
