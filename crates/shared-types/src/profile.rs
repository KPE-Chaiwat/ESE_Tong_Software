//! Profile DTOs (BE-001 Q-10).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::modbus::{ConnectionConfig, PollDefinition};

/// Profile schema version written by this build.
pub const PROFILE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ValueFormat {
    Unsigned,
    Signed,
    Hex,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySettings {
    pub format: ValueFormat,
    #[ts(type = "0 | 1")]
    pub address_base: u8,
}

/// A saved Modbus Master setup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Always 1 for now. Files with a newer version are rejected with `unsupportedSchema`.
    pub schema_version: u32,
    /// Max 64 characters, none of `\ / : * ? " < > |`. Unique per tool, case-insensitive.
    pub name: String,
    pub connection: ConnectionConfig,
    pub poll: PollDefinition,
    pub display: DisplaySettings,
    pub auto_start_poll: bool,
}

impl Profile {
    /// Checks what the types cannot express but the UI relies on: `display.addressBase`
    /// is 0 or 1 and `poll.function` is 1-4. Everything else stays permissive so a
    /// half-edited setup can still be saved; connect and poll validate when used.
    ///
    /// # Errors
    /// An English message naming the offending field.
    pub fn check_shape(&self) -> Result<(), String> {
        if self.display.address_base > 1 {
            return Err(format!(
                "display.addressBase must be 0 or 1 (found {}).",
                self.display.address_base
            ));
        }
        if !(1..=4).contains(&self.poll.function) {
            return Err(format!(
                "poll.function must be 1, 2, 3 or 4 (found {}).",
                self.poll.function
            ));
        }
        Ok(())
    }
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
    /// False when the file cannot be opened (newer schema or corrupt); `profiles_get` fails.
    pub readable: bool,
}
