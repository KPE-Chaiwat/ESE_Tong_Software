//! Error returned from Tauri commands. Serialised to the frontend as
//! `{ code: AppErrorCode, message: string }` (`shared_types::AppError`), so the UI can
//! switch on a stable `code`.

use modbus_master::SessionError;
use platform::ProfileError;
use serde::{Serialize, Serializer};
use shared_types::AppErrorCode;
use transport::ListPortsError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppError(pub shared_types::AppError);

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self(shared_types::AppError::new(code, message))
    }

    #[must_use]
    pub fn with_field(self, field: impl Into<String>) -> Self {
        Self(self.0.with_field(field))
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl From<SessionError> for AppError {
    fn from(e: SessionError) -> Self {
        let code = match &e {
            SessionError::Validation(_) => AppErrorCode::Validation,
            SessionError::NotConnected => AppErrorCode::NotConnected,
            SessionError::InvalidState(_) => AppErrorCode::InvalidState,
            SessionError::Closed => AppErrorCode::NoSession,
        };
        let err = Self::new(code, e.to_string());
        match &e {
            // REV-001 N8: tell the UI which input to focus.
            SessionError::Validation(v) => err.with_field(v.field),
            _ => err,
        }
    }
}

impl From<ProfileError> for AppError {
    fn from(e: ProfileError) -> Self {
        let code = match &e {
            ProfileError::InvalidName(_) => AppErrorCode::InvalidProfileName,
            ProfileError::InvalidToolId(_) => AppErrorCode::UnknownTool,
            ProfileError::Exists(_) => AppErrorCode::ProfileExists,
            ProfileError::NotFound(_) => AppErrorCode::ProfileNotFound,
            ProfileError::UnsupportedSchema { .. } => AppErrorCode::UnsupportedSchema,
            ProfileError::Invalid { .. } => AppErrorCode::InvalidProfile,
            ProfileError::Io(_) => AppErrorCode::Io,
        };
        Self::new(code, e.to_string())
    }
}

impl From<ListPortsError> for AppError {
    fn from(e: ListPortsError) -> Self {
        let code = match &e {
            ListPortsError::NotSupported => AppErrorCode::NotSupported,
            ListPortsError::Io(_) => AppErrorCode::Io,
        };
        Self::new(code, e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        Self::new(AppErrorCode::Internal, e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_as_code_and_message() {
        let json = serde_json::to_string(&AppError::new(AppErrorCode::Internal, "boom")).unwrap();
        assert_eq!(json, r#"{"code":"internal","message":"boom","field":null}"#);
    }

    #[test]
    fn library_errors_map_to_stable_codes() {
        let cases: Vec<(AppError, &str)> = vec![
            (SessionError::NotConnected.into(), "notConnected"),
            (SessionError::Closed.into(), "noSession"),
            (
                SessionError::InvalidState("x".into()).into(),
                "invalidState",
            ),
            (ProfileError::Exists("A".into()).into(), "profileExists"),
            (ProfileError::NotFound("A".into()).into(), "profileNotFound"),
            (
                ProfileError::InvalidName("x".into()).into(),
                "invalidProfileName",
            ),
            (
                ProfileError::UnsupportedSchema {
                    name: "A".into(),
                    found: 2,
                    supported: 1,
                }
                .into(),
                "unsupportedSchema",
            ),
            (ProfileError::Io("disk".into()).into(), "io"),
            (ListPortsError::NotSupported.into(), "notSupported"),
        ];
        for (err, code) in cases {
            let v = serde_json::to_value(&err).unwrap();
            assert_eq!(v["code"], code, "{err:?}");
            assert!(!v["message"].as_str().unwrap().is_empty());
        }
    }

    #[test]
    fn validation_errors_carry_the_field() {
        let e = modbus_master::validate::validate_poll(
            &shared_types::PollDefinition {
                slave_id: 1,
                function: 3,
                start_address: 0,
                quantity: 126,
                scan_rate_ms: 1000,
            },
            false,
        )
        .unwrap_err();
        let v = serde_json::to_value(AppError::from(SessionError::Validation(e))).unwrap();
        assert_eq!(v["code"], "validation");
        assert_eq!(v["field"], "quantity");
        assert_eq!(v["message"], "Quantity for FC03 must be from 1 to 125.");
    }
}
