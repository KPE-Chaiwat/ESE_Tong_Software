//! Thin Tauri layer. Business logic lives in the `crates/` workspace members.

mod commands;
mod desktop;
#[cfg(any(test, feature = "dev-hooks"))]
mod dev_hooks;
mod error;
mod key_menu;
pub mod os_timer;
mod state;
mod tauri_desktop;
mod windows;

use tauri::{AppHandle, Manager};

/// Teardown when a window is destroyed (no task, port or sender may leak):
/// - a connection window: its session stops (link closed) and every native poll window of
///   that connection is destroyed (DES-002 2.11, H17);
/// - a poll window: its view route is dropped; if the poll was still shown there, it is now
///   closed (kept). A window recreated meanwhile under the same label is left alone.
fn on_destroyed(app: &AppHandle, label: &str) {
    let Some(state) = app.try_state::<state::AppState>() else {
        return;
    };
    if let Some((connection, poll_id)) = windows::parse_poll_window_label(label) {
        if app.get_webview_window(label).is_some() {
            return;
        }
        if let Ok(session) = state.session(connection) {
            tauri::async_runtime::spawn(async move {
                let _ = session.native_window_destroyed(poll_id).await;
            });
        }
        return;
    }
    if state.remove_session(label) {
        for (other, window) in app.webview_windows() {
            if windows::is_poll_window_of(&other, label) {
                let _ = window.destroy();
            }
        }
    }
}

/// D-002-21 after a DPI change (REV-008 M-1): a native poll window that moved to a monitor
/// with another scale gets its minimum recomputed on its first `Resized`/`Moved` after the
/// `ScaleFactorChanged`, i.e. once tao has resized it for the new scale and the measured
/// frame is the new one (see `desktop::ScaleChangeTracker`). The recompute is posted from a
/// worker thread: `run_on_main_thread` called on the main thread (where this runs) would
/// run it at once, inside the window procedure; from another thread it is queued behind
/// the message being handled.
fn on_geometry_event(app: &AppHandle, label: &str, event: desktop::GeometryEvent) {
    if windows::parse_poll_window_label(label).is_none() {
        return;
    }
    let Some(state) = app.try_state::<state::AppState>() else {
        return;
    };
    if !state.scale_changes.on_event(label, event) {
        return;
    }
    let (handle, label) = (app.clone(), label.to_owned());
    tauri::async_runtime::spawn(async move {
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            commands::poll_windows::refresh_min_size(
                &tauri_desktop::TauriDesktop { app: &app },
                &label,
            );
        });
    });
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(state::AppState::default())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Destroyed => {
                on_geometry_event(
                    window.app_handle(),
                    window.label(),
                    desktop::GeometryEvent::Destroyed,
                );
                on_destroyed(window.app_handle(), window.label());
            }
            tauri::WindowEvent::ScaleFactorChanged { .. } => on_geometry_event(
                window.app_handle(),
                window.label(),
                desktop::GeometryEvent::ScaleChanged,
            ),
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => on_geometry_event(
                window.app_handle(),
                window.label(),
                desktop::GeometryEvent::Changed,
            ),
            // D-002-25 (REPORT-006 D2): every ESEfact window (launcher, W1, W2, also those
            // created later) gets the lone-Alt guard before it can receive a key: a window
            // is focused before it gets keyboard input. Installing is idempotent.
            tauri::WindowEvent::Focused(true) => key_menu::guard_window(window),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::modbus_master::mm_open_session,
            commands::modbus_master::mm_list_serial_ports,
            commands::modbus_master::mm_connect,
            commands::modbus_master::mm_cancel_connect,
            commands::modbus_master::mm_disconnect,
            commands::modbus_master::mm_set_auto_start_poll,
            commands::modbus_master::mm_add_poll,
            commands::modbus_master::mm_duplicate_poll,
            commands::modbus_master::mm_remove_poll,
            commands::modbus_master::mm_update_poll,
            commands::modbus_master::mm_rename_poll,
            commands::modbus_master::mm_set_poll_active,
            commands::modbus_master::mm_set_all_polls_active,
            commands::modbus_master::mm_set_poll_view,
            commands::modbus_master::mm_reorder_polls,
            commands::modbus_master::mm_write,
            commands::modbus_master::mm_reset_counters,
            commands::modbus_master::mm_attach_poll_view,
            commands::modbus_master::mm_detach_poll_view,
            commands::modbus_master::mm_show_poll,
            commands::modbus_master::mm_pop_out_poll,
            commands::modbus_master::mm_dock_poll,
            commands::modbus_master::mm_provide_handoff,
            commands::modbus_master::mm_close_poll_view,
            commands::modbus_master::mm_show_poll_windows,
            commands::modbus_master::mm_focus_connection_window,
            commands::modbus_master::mm_set_workspace_layout,
            commands::modbus_master::mm_set_compact_mode,
            commands::modbus_master::mm_set_ask_on_poll_close,
            commands::modbus_master::mm_arrange_poll_windows,
            commands::modbus_master::mm_set_profile_name,
            commands::modbus_master::mm_request_save,
            commands::modbus_master::mm_show_traffic,
            commands::modbus_master::mm_apply_profile,
            commands::modbus_master::mm_export_profile,
            commands::profiles::profiles_list,
            commands::profiles::profiles_get,
            commands::profiles::profiles_save,
            commands::profiles::profiles_rename,
            commands::profiles::profiles_delete,
            commands::window::window_open_tool,
            commands::window::app_list_monitors,
            #[cfg(feature = "dev-hooks")]
            dev_hooks::dev_fail_next_window_op,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ESEfact");
}
