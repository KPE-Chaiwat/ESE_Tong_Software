//! Modbus Master commands. They only validate, delegate to `modbus_master::Session` and map
//! errors to `AppError`. One session per window, keyed by the window label.

use std::sync::Arc;

use modbus_master::{EventSink, Session, SessionDeps};
use shared_types::{
    AppErrorCode, ConnectionConfig, PollDefinition, SerialPortInfo, SessionEvent, SessionSnapshot,
    WriteRequest, WriteResult,
};
use tauri::ipc::Channel;
use tauri::{Manager, State, Window};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Delivers session events to the window's channel.
///
/// Drop policy (see `modbus_master::emitter`): `StateChanged` is never dropped or coalesced;
/// `PollUpdate` is coalesced (latest wins, at most one per 50 ms); `TrafficFrames` are
/// batched (at most one batch per 50 ms) and `Counters` coalesced (at most one per 100 ms).
/// `PollUpdate.seq` and `TrafficFrame.seq` are strictly increasing so the UI can detect gaps.
/// `Channel::send` never blocks; if the webview is gone the event is discarded.
struct ChannelSink(Channel<SessionEvent>);

impl EventSink for ChannelSink {
    fn send(&self, event: SessionEvent) -> bool {
        self.0.send(event).is_ok()
    }
}

/// Attaches this window's event channel and returns the session snapshot. Creates the
/// session on first call; on a reload it re-attaches and replays the traffic log.
#[tauri::command]
pub async fn mm_open_session(
    window: Window,
    state: State<'_, AppState>,
    channel: Channel<SessionEvent>,
) -> AppResult<SessionSnapshot> {
    let sink: Arc<dyn EventSink> = Arc::new(ChannelSink(channel));
    let (session, created) = state.session_or_create(window.label(), || {
        Session::spawn(sink.clone(), SessionDeps::default())
    });
    if created
        && window
            .app_handle()
            .get_webview_window(window.label())
            .is_none()
    {
        // The window was destroyed while this call was in flight (REV-001 N7): do not
        // leave an orphan session behind.
        state.remove_session(window.label());
        return Err(AppError::new(
            AppErrorCode::NoSession,
            "The window was closed.",
        ));
    }
    let snapshot = if created {
        session.snapshot().await?
    } else {
        session.attach(sink).await?
    };
    Ok(snapshot)
}

#[tauri::command]
pub async fn mm_list_serial_ports(state: State<'_, AppState>) -> AppResult<Vec<SerialPortInfo>> {
    // SetupAPI enumeration can take tens of milliseconds: keep it off the async workers.
    let lister = state.port_lister.clone();
    let entries = tauri::async_runtime::spawn_blocking(move || lister.list_ports())
        .await
        .map_err(|e| AppError::new(AppErrorCode::Internal, e.to_string()))??;
    state.remember_ports(entries.iter().map(|p| p.name.clone()).collect());
    Ok(entries
        .into_iter()
        .map(|p| SerialPortInfo {
            name: p.name,
            description: p.description,
        })
        .collect())
}

#[tauri::command]
pub async fn mm_connect(
    window: Window,
    state: State<'_, AppState>,
    config: ConnectionConfig,
) -> AppResult<()> {
    if let ConnectionConfig::Rtu { port, .. } = &config {
        check_serial_port(port, &state.known_ports())?;
    }
    Ok(state.session(window.label())?.connect(config).await?)
}

/// REV-001 F8: only a port from the last `mm_list_serial_ports` result, or the platform
/// port-name form (`COM<n>` on Windows), may reach the OS open call. Paths, device
/// namespaces and anything else are refused before they are passed to `CreateFileW`.
fn check_serial_port(port: &str, listed: &[String]) -> AppResult<()> {
    if transport::is_valid_serial_port_name(port) || listed.iter().any(|p| p == port) {
        Ok(())
    } else {
        Err(AppError::new(
            AppErrorCode::Validation,
            "Select a serial port from the list.",
        )
        .with_field("port"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serial_port_names_are_checked_at_the_boundary() {
        let listed = vec!["COM3".to_owned(), "/dev/ttyACM0".to_owned()];
        assert!(check_serial_port("COM3", &listed).is_ok());
        assert!(check_serial_port("/dev/ttyACM0", &listed).is_ok());
        if cfg!(windows) {
            assert!(check_serial_port("COM12", &[]).is_ok());
        }
        for bad in [
            r"C:\Users\x\file.txt",
            r"..\..",
            r"\\.\PhysicalDrive0",
            "",
            "COM3 ",
        ] {
            let err = check_serial_port(bad, &listed).unwrap_err();
            let v = serde_json::to_value(&err).unwrap();
            assert_eq!(v["code"], "validation", "{bad}");
            assert_eq!(v["field"], "port");
        }
    }
}

#[tauri::command]
pub async fn mm_cancel_connect(window: Window, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.session(window.label())?.cancel_connect().await?)
}

/// Disconnect (T12). Also cancels while connecting (T4) and dismisses `disconnected` (T15).
#[tauri::command]
pub async fn mm_disconnect(window: Window, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.session(window.label())?.disconnect().await?)
}

/// Start, resume and apply (T5, T11).
#[tauri::command]
pub async fn mm_start_poll(
    window: Window,
    state: State<'_, AppState>,
    poll: PollDefinition,
) -> AppResult<()> {
    Ok(state.session(window.label())?.start_poll(poll).await?)
}

#[tauri::command]
pub async fn mm_stop_poll(window: Window, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.session(window.label())?.stop_poll().await?)
}

#[tauri::command]
pub async fn mm_write(
    window: Window,
    state: State<'_, AppState>,
    request: WriteRequest,
) -> AppResult<WriteResult> {
    Ok(state.session(window.label())?.write(request).await?)
}

#[tauri::command]
pub async fn mm_reset_counters(window: Window, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.session(window.label())?.reset_counters().await?)
}
