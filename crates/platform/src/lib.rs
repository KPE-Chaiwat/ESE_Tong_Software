//! Platform services: settings, profiles (and the Modbus Master profile schema), logging,
//! filesystem paths, and pure window layout math (`arrange`).
//! OS-specific code must live behind a trait with `#[cfg(...)]` implementations.

pub mod arrange;
pub mod mm_profile;
mod paths;
mod profiles;

pub use paths::{data_dir, profiles_dir, PathError, DATA_DIR_ENV};
pub use profiles::{
    validate_profile_name, ProfileEntry, ProfileError, ProfileStore, MAX_PROFILE_NAME_CHARS,
};

/// Application name used for data directories and window titles.
pub const APP_NAME: &str = "ESEfact";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_name_is_esefact() {
        assert_eq!(APP_NAME, "ESEfact");
    }

    #[test]
    fn data_dir_ends_with_app_name_or_override() {
        let dir = data_dir().unwrap();
        if std::env::var_os(DATA_DIR_ENV).is_none() {
            assert!(dir.ends_with(APP_NAME));
        }
        assert!(profiles_dir().unwrap().ends_with("profiles"));
    }
}
