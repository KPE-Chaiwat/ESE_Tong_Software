//! DTOs exchanged between Rust and the frontend.
//!
//! TypeScript bindings are generated from these types by ts-rs into
//! `apps/desktop/src/shared/bindings/`. Never edit the generated files by hand;
//! run `pnpm bindings` instead.
//!
//! Names follow the BE-001 and BE-002 contracts. Every field is camelCase on the wire.
//! Timestamps (`at`, `modifiedAt`, `lastOkAt`) are milliseconds since the Unix epoch.

mod layout;
mod modbus;
mod profile;
mod session;
mod view;

pub use layout::*;
pub use modbus::*;
pub use profile::*;
pub use session::*;
pub use view::*;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Basic information about the running application.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

impl AppInfo {
    pub fn new(name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            version: version.into(),
        }
    }
}

/// Stable error codes returned by every command. The frontend switches on these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum AppErrorCode {
    /// Input rejected before anything was done. `message` is user-facing and `field`
    /// names the offending input (for example `name`, `aliases`, `polls`, `host`, `order`).
    Validation,
    /// The command needs a link (connection `connected`) and there is none.
    NotConnected,
    /// The command is not allowed in the current connection state (for example connect
    /// while connected, or applying a profile while connected).
    InvalidState,
    /// `mm_open_session` was not called for this window, or its connection window is gone.
    NoSession,
    /// No poll with this id on the connection (deleted meanwhile).
    PollNotFound,
    /// `profiles_save` without overwrite, or rename onto an existing name (case-insensitive).
    ProfileExists,
    ProfileNotFound,
    InvalidProfileName,
    /// The profile file has a newer `schemaVersion` than this build understands.
    UnsupportedSchema,
    /// The profile file is not valid JSON or does not match the profile shape and rules.
    InvalidProfile,
    /// Unknown tool id passed to `window_open_tool` / `profiles_*`.
    UnknownTool,
    /// Not available on this operating system (serial port listing outside Windows).
    NotSupported,
    /// File system or operating system error.
    Io,
    /// Bug or unexpected runtime failure (also a window that could not be created).
    Internal,
}

/// Error returned by every command: `invoke` rejects with this object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    /// Human readable English message.
    pub message: String,
    /// For `validation`: the offending input field as named in the DTO (for example
    /// `timeoutMs`, `slaveId`, `values`, `name`), so the UI can focus it. Otherwise null.
    pub field: Option<String>,
}

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            field: None,
        }
    }

    #[must_use]
    pub fn with_field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
mod tests;
