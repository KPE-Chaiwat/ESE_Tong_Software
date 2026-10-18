//! DEV/QA ONLY (Q-002-14, CHK2-F16): one armed failure of the next pop out or dock, so QA
//! can test the failure path of `mm_pop_out_poll` / `mm_dock_poll` in the real app.
//!
//! Compiled into the app only with the cargo feature `dev-hooks` (off by default; `pnpm
//! build`, `pnpm tauri build` and release builds never enable it). Build for QA:
//! `pnpm --filter @esefact/desktop tauri build --debug --no-bundle --features dev-hooks`.
//! Then, from any window's devtools / CDP:
//! `__TAURI_INTERNALS__.invoke("dev_fail_next_window_op", { kind: "popOut", message: "boom" })`.
//! The next `mm_pop_out_poll` (or `mm_dock_poll` for `kind: "dock"`) of any connection
//! returns `AppError { code: "internal", message }` before anything happens (no window is
//! created or destroyed, no host, routing or session change), and the hook disarms. Arming
//! again replaces an unused arm. The product frontend never calls it.

use std::sync::{Mutex, PoisonError};

use serde::Deserialize;
use shared_types::AppErrorCode;

use crate::error::{AppError, AppResult};

/// The operation a dev failure is armed for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DevWindowOp {
    PopOut,
    Dock,
}

/// At most one armed failure.
#[derive(Debug, Default)]
pub struct DevFailHook(Mutex<Option<(DevWindowOp, String)>>);

impl DevFailHook {
    pub fn arm(&self, op: DevWindowOp, message: String) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Some((op, message));
    }

    /// Fails once if a failure is armed for `op` (and disarms); otherwise `Ok`.
    ///
    /// # Errors
    /// `internal` with the armed message.
    pub fn check(&self, op: DevWindowOp) -> AppResult<()> {
        let mut armed = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        match armed.take() {
            Some((o, message)) if o == op => Err(AppError::new(AppErrorCode::Internal, message)),
            other => {
                *armed = other;
                Ok(())
            }
        }
    }
}

/// `dev_fail_next_window_op(kind, message)`: arms one failure (see the module docs).
#[cfg(feature = "dev-hooks")]
#[tauri::command]
pub fn dev_fail_next_window_op(
    state: tauri::State<'_, crate::state::AppState>,
    kind: DevWindowOp,
    message: String,
) {
    state.dev_fail.arm(kind, message);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_and_message(r: AppResult<()>) -> (String, String) {
        let v = serde_json::to_value(r.unwrap_err()).unwrap();
        (
            v["code"].as_str().unwrap().to_owned(),
            v["message"].as_str().unwrap().to_owned(),
        )
    }

    #[test]
    fn off_by_default_fails_once_and_only_its_kind() {
        let hook = DevFailHook::default();
        assert!(hook.check(DevWindowOp::PopOut).is_ok(), "nothing armed");
        assert!(hook.check(DevWindowOp::Dock).is_ok());
        hook.arm(DevWindowOp::PopOut, "boom".into());
        assert!(
            hook.check(DevWindowOp::Dock).is_ok(),
            "a dock is not affected"
        );
        assert_eq!(
            code_and_message(hook.check(DevWindowOp::PopOut)),
            ("internal".into(), "boom".into())
        );
        assert!(hook.check(DevWindowOp::PopOut).is_ok(), "only once");
        hook.arm(DevWindowOp::PopOut, "a".into());
        hook.arm(DevWindowOp::Dock, "b".into());
        assert!(
            hook.check(DevWindowOp::PopOut).is_ok(),
            "re-arming replaces"
        );
        assert_eq!(code_and_message(hook.check(DevWindowOp::Dock)).1, "b");
    }

    #[test]
    fn kinds_use_the_invoke_spelling() {
        let k: DevWindowOp = serde_json::from_str("\"popOut\"").unwrap();
        assert_eq!(k, DevWindowOp::PopOut);
        let k: DevWindowOp = serde_json::from_str("\"dock\"").unwrap();
        assert_eq!(k, DevWindowOp::Dock);
        assert!(serde_json::from_str::<DevWindowOp>("\"PopOut\"").is_err());
    }
}
