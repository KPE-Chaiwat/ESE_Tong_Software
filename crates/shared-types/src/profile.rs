//! Profile DTOs: schema 2 (DES-002 6.1) plus the schema 1 shape (BE-001) for migration.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::layout::{PollViewPlacement, WindowPlacement, WorkspaceProfile};
use crate::modbus::{ConnectionConfig, PollDefinition};
use crate::view::{
    AliasEntry, DisplaySettings, ScaleOverride, ScaleSettings, ValueColumns, ValueFormat,
};

/// Profile schema version written by this build. Schema 1 files are migrated on read;
/// schema 3 or higher is rejected with `unsupportedSchema`.
pub const PROFILE_SCHEMA_VERSION: u32 = 2;

/// One poll of a profile, in list order (DES-002 6.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollProfile {
    pub name: String,
    pub definition: PollDefinition,
    pub active: bool,
    pub display: DisplaySettings,
    pub scale: Option<ScaleSettings>,
    pub scale_overrides: Vec<ScaleOverride>,
    pub value_columns: ValueColumns,
    /// Sorted by address, unique addresses, at most 2000.
    pub aliases: Vec<AliasEntry>,
    pub view: PollViewPlacement,
}

/// A saved Modbus Master setup, schema 2.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// 2. Set by the backend on save.
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
    /// Set by `profiles_get` when the file had an older schema (1); the file stays as it
    /// is until saved. Ignored by `profiles_save` and never written.
    pub migrated_from: Option<u32>,
}

/// Schema 1 display settings (BE-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySettingsV1 {
    pub format: ValueFormat,
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
