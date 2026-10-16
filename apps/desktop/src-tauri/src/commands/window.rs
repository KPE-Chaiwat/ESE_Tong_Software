//! Opening tool windows.

use std::sync::atomic::Ordering;

use shared_types::AppErrorCode;
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
    Ok(label)
}
