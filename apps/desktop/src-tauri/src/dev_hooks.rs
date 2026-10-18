//! DEV/QA ONLY (Q-002-14, CHK2-F16, CHK4-B6/C5): one armed window failure, so QA
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
    BulkCreate,
    BulkPlace,
    BulkShow,
    BulkDestroy,
}

/// At most one armed failure.
#[derive(Debug, Default)]
pub struct DevFailHook(Mutex<Option<(DevWindowOp, String, u32)>>);

impl DevFailHook {
    pub fn arm(&self, op: DevWindowOp, message: String) {
        self.arm_after(op, message, 0);
    }

    pub fn arm_after(&self, op: DevWindowOp, message: String, skip: u32) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Some((op, message, skip));
    }

    /// Fails once if a failure is armed for `op` (and disarms); otherwise `Ok`.
    ///
    /// # Errors
    /// `internal` with the armed message.
    pub fn check(&self, op: DevWindowOp) -> AppResult<()> {
        let mut armed = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        match armed.take() {
            Some((o, message, 0)) if o == op => Err(AppError::new(AppErrorCode::Internal, message)),
            Some((o, message, skip)) if o == op => {
                *armed = Some((o, message, skip - 1));
                Ok(())
            }
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
    skip: Option<u32>,
) {
    if skip.unwrap_or(0) == 0 {
        state.dev_fail.arm(kind, message);
    } else {
        state.dev_fail.arm_after(kind, message, skip.unwrap_or(0));
    }
}

/// Bulk-only adapter: failures occur at the real OS boundary after definition commit.
/// Recovery commands use the original desktop, so the one-shot fault cannot replay a mutation.
#[cfg(any(test, all(feature = "dev-hooks", debug_assertions)))]
pub struct BulkDesktop<'a> {
    pub desktop: &'a dyn crate::desktop::Desktop,
    pub hook: &'a DevFailHook,
}

#[cfg(any(test, all(feature = "dev-hooks", debug_assertions)))]
impl crate::desktop::Desktop for BulkDesktop<'_> {
    fn monitors(&self) -> Vec<crate::desktop::MonitorGeom> {
        self.desktop.monitors()
    }
    fn window(&self, label: &str) -> Option<crate::desktop::WindowGeom> {
        self.desktop.window(label)
    }
    fn cursor(&self) -> Option<(i64, i64)> {
        self.desktop.cursor()
    }
    fn place(
        &self,
        label: &str,
        outer: platform::arrange::Rect,
        maximized: bool,
    ) -> Result<(), String> {
        self.hook
            .check(DevWindowOp::BulkPlace)
            .map_err(|e| e.to_string())?;
        self.desktop.place(label, outer, maximized)
    }
    fn create_poll_window(
        &self,
        label: &str,
        route: &str,
        title: &str,
        min_inner: (f64, f64),
    ) -> Result<(), String> {
        self.hook
            .check(DevWindowOp::BulkCreate)
            .map_err(|e| e.to_string())?;
        self.desktop
            .create_poll_window(label, route, title, min_inner)
    }
    fn set_min_inner_size(&self, label: &str, min_inner: (f64, f64)) -> Result<(), String> {
        self.desktop.set_min_inner_size(label, min_inner)
    }
    fn exists(&self, label: &str) -> bool {
        self.desktop.exists(label)
    }
    fn reveal(&self, label: &str) -> bool {
        self.desktop.reveal(label)
    }
    fn show(&self, label: &str) {
        self.desktop.show(label);
    }
    fn destroy(&self, label: &str) {
        self.desktop.destroy(label);
    }
    fn reveal_checked(&self, label: &str) -> Result<(), String> {
        self.hook
            .check(DevWindowOp::BulkShow)
            .map_err(|e| e.to_string())?;
        self.desktop.reveal_checked(label)
    }
    fn destroy_checked(&self, label: &str) -> Result<(), String> {
        // Workspace/closed polls have no native destroy call to fault or count.
        if self.desktop.exists(label) {
            self.hook
                .check(DevWindowOp::BulkDestroy)
                .map_err(|e| e.to_string())?;
        }
        self.desktop.destroy_checked(label)
    }
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
    fn matching_calls_only_consume_skip_and_failure_disarms() {
        let hook = DevFailHook::default();
        hook.arm_after(DevWindowOp::BulkCreate, "second".into(), 1);
        assert!(hook.check(DevWindowOp::BulkShow).is_ok());
        assert!(hook.check(DevWindowOp::BulkCreate).is_ok());
        assert!(hook.check(DevWindowOp::Dock).is_ok());
        assert_eq!(
            code_and_message(hook.check(DevWindowOp::BulkCreate)).1,
            "second"
        );
        assert!(hook.check(DevWindowOp::BulkCreate).is_ok());
        for (spelling, expected) in [
            ("bulkCreate", DevWindowOp::BulkCreate),
            ("bulkPlace", DevWindowOp::BulkPlace),
            ("bulkShow", DevWindowOp::BulkShow),
            ("bulkDestroy", DevWindowOp::BulkDestroy),
        ] {
            assert_eq!(
                serde_json::from_value::<DevWindowOp>(serde_json::json!(spelling)).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn bulk_destroy_counts_only_existing_native_windows() {
        use crate::desktop::{fake::FakeDesktop, Desktop};
        use platform::arrange::Rect;

        let desktop = FakeDesktop::default();
        desktop.insert("first", Rect::new(0, 0, 900, 640));
        desktop.insert("second", Rect::new(0, 0, 900, 640));
        let hook = DevFailHook::default();
        hook.arm_after(DevWindowOp::BulkDestroy, "second native".into(), 1);
        let injected = BulkDesktop {
            desktop: &desktop,
            hook: &hook,
        };
        assert!(injected.destroy_checked("workspace").is_ok());
        assert!(injected.destroy_checked("first").is_ok());
        assert!(injected.destroy_checked("closed").is_ok());
        assert_eq!(
            injected.destroy_checked("second").unwrap_err(),
            "second native"
        );
        assert!(desktop.exists("second"));
        assert!(injected.destroy_checked("second").is_ok());
        assert!(!desktop.exists("second"));
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
