//! Thin Tauri layer. Business logic lives in the `crates/` workspace members.

mod commands;
mod error;
mod state;
mod windows;

use tauri::Manager;

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
        .on_window_event(|window, event| {
            // One session per window: tear it down with the window so no task or port leaks.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<state::AppState>() {
                    state.remove_session(window.label());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::modbus_master::mm_open_session,
            commands::modbus_master::mm_list_serial_ports,
            commands::modbus_master::mm_connect,
            commands::modbus_master::mm_cancel_connect,
            commands::modbus_master::mm_disconnect,
            commands::modbus_master::mm_start_poll,
            commands::modbus_master::mm_stop_poll,
            commands::modbus_master::mm_write,
            commands::modbus_master::mm_reset_counters,
            commands::profiles::profiles_list,
            commands::profiles::profiles_get,
            commands::profiles::profiles_save,
            commands::profiles::profiles_rename,
            commands::profiles::profiles_delete,
            commands::window::window_open_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ESEfact");
}
