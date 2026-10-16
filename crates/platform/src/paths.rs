//! Data directory resolution.

use std::path::PathBuf;

use crate::APP_NAME;

/// Environment variable that overrides the data directory (tests, E2E runs, portable use).
pub const DATA_DIR_ENV: &str = "ESEFACT_DATA_DIR";

/// Errors resolving platform paths.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PathError {
    #[error("the user data directory could not be determined")]
    NoDataDir,
}

/// The application data directory: `$ESEFACT_DATA_DIR` if set, otherwise the OS user data
/// directory plus `ESEfact` (on Windows `%APPDATA%\ESEfact`).
///
/// # Errors
/// [`PathError::NoDataDir`] when the OS reports no user data directory.
pub fn data_dir() -> Result<PathBuf, PathError> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    dirs::data_dir()
        .map(|d| d.join(APP_NAME))
        .ok_or(PathError::NoDataDir)
}

/// `<data dir>/profiles`.
///
/// # Errors
/// See [`data_dir`].
pub fn profiles_dir() -> Result<PathBuf, PathError> {
    Ok(data_dir()?.join("profiles"))
}
