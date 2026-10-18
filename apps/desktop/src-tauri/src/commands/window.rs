//! Opening tool windows and listing monitors.

use std::sync::atomic::Ordering;

use shared_types::{AppErrorCode, MonitorInfo};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, Window};

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::windows::{find_tool, NEW_WINDOW_OFFSET};

/// Opens a new window for `tool_id` at the tool route and returns its label
/// (`<toolId>-<n>`). The window starts with its own idle session once its page calls
/// `mm_open_session`. Async on purpose: creating windows from a synchronous command can
/// deadlock on Windows.
#[tauri::command]
pub async fn window_open_tool(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    tool_id: String,
) -> AppResult<String> {
    let tool = find_tool(&tool_id).ok_or_else(|| {
        AppError::new(
            AppErrorCode::UnknownTool,
            format!("Unknown tool \"{tool_id}\"."),
        )
    })?;
    let label = loop {
        let n = state.window_counter.fetch_add(1, Ordering::Relaxed) + 1;
        let label = format!("{}-{n}", tool.id);
        if app.get_webview_window(&label).is_none() {
            break label;
        }
    };
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(tool.route.into()))
        .title(tool.title)
        .inner_size(tool.width, tool.height)
        .min_inner_size(tool.min_width, tool.min_height);
    if let (Ok(pos), Ok(scale)) = (window.outer_position(), window.scale_factor()) {
        let logical = pos.to_logical::<f64>(scale);
        builder = builder.position(logical.x + NEW_WINDOW_OFFSET, logical.y + NEW_WINDOW_OFFSET);
    }
    builder.build()?;
    // DES-002 2.13 W1 clamp (REPORT-006 D5): after the window-state plugin restored a saved
    // size and position. The plugin restores from a closure queued on the main thread while
    // the window was built; this one is queued after it, so it sees the restored rectangle.
    let (handle, clamp_label) = (app.clone(), label.clone());
    let min_inner = (tool.min_width, tool.min_height);
    let _ = app.run_on_main_thread(move || {
        let desktop = crate::tauri_desktop::TauriDesktop { app: &handle };
        let _ = crate::desktop::clamp_connection_window(&desktop, &clamp_label, min_inner);
    });
    Ok(label)
}

/// Monitors for "Arrange on:" (DES-002 2.8.5): "Display 1" is the primary one; work areas
/// in logical px of each monitor.
#[tauri::command]
pub fn app_list_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    crate::desktop::list_monitors(&crate::tauri_desktop::TauriDesktop { app: &app })
}
