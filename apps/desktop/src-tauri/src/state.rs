//! Application-wide managed state. Session state lives here (Rust side); the UI is a view.

use std::collections::HashMap;
use std::sync::atomic::AtomicU32;
use std::sync::{Arc, Mutex, PoisonError};

use modbus_master::Session;
use platform::ProfileStore;
use shared_types::{AppErrorCode, PROFILE_SCHEMA_VERSION};
use transport::{SerialPortLister, SystemPortLister};

use crate::error::{AppError, AppResult};

pub struct AppState {
    /// One Modbus Master session per window, keyed by window label. Created by
    /// `mm_open_session`, removed (and shut down) when the window is destroyed.
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    profiles: Result<ProfileStore, String>,
    pub port_lister: Arc<dyn SerialPortLister>,
    /// Suffix for new tool window labels (`modbus-master-<n>`).
    pub window_counter: AtomicU32,
    /// Port names from the last `mm_list_serial_ports` (accepted by `mm_connect`).
    known_ports: Mutex<Vec<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            profiles: platform::profiles_dir()
                .map(|dir| ProfileStore::new(dir, PROFILE_SCHEMA_VERSION))
                .map_err(|e| e.to_string()),
            port_lister: Arc::new(SystemPortLister),
            window_counter: AtomicU32::new(0),
            known_ports: Mutex::new(Vec::new()),
        }
    }
}

impl AppState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Session>>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The session of a window, or `noSession`.
    pub fn session(&self, label: &str) -> AppResult<Arc<Session>> {
        self.lock().get(label).cloned().ok_or_else(|| {
            AppError::new(
                AppErrorCode::NoSession,
                "No session for this window. Call mm_open_session first.",
            )
        })
    }

    /// Returns the existing session of `label` (`false`) or creates one (`true`).
    pub fn session_or_create(
        &self,
        label: &str,
        create: impl FnOnce() -> Session,
    ) -> (Arc<Session>, bool) {
        let mut map = self.lock();
        if let Some(s) = map.get(label) {
            return (s.clone(), false);
        }
        let s = Arc::new(create());
        map.insert(label.to_owned(), s.clone());
        (s, true)
    }

    /// Removes and stops the session of a window (window destroyed). Closes its link.
    pub fn remove_session(&self, label: &str) {
        if let Some(s) = self.lock().remove(label) {
            s.close();
        }
    }

    pub fn remember_ports(&self, names: Vec<String>) {
        *self
            .known_ports
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = names;
    }

    #[must_use]
    pub fn known_ports(&self) -> Vec<String> {
        self.known_ports
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn profiles(&self) -> AppResult<ProfileStore> {
        self.profiles
            .clone()
            .map_err(|e| AppError::new(AppErrorCode::Io, e))
    }
}
