//! Modbus Master commands (BE-002 / DES-002 section 8.2). They validate, delegate to
//! `modbus_master::Session` and the window helpers, and map errors to `AppError`.
//!
//! One session per connection window (W1), keyed by its label. Native poll windows (W2,
//! label `<W1 label>-poll-<pollId>`) use the session of their connection window, so every
//! command below may be invoked from either window kind unless noted.

use std::sync::Arc;

use modbus_master::{EventSink, Session, SessionDeps};
use serde::Serialize;
use shared_types::{
    AppErrorCode, ArrangeLayout, ArrangeResult, ArrangeTarget, ConnectionConfig, PollDefinition,
    PollHostKind, PollId, PollViewEvent, PollViewSnapshot, PopOutAnchor, Profile, SerialPortInfo,
    SessionEvent, SessionSnapshot, ShowPollPlacement, ViewToken, WorkspaceLayout, WorkspaceRect,
    WriteRequest, WriteResult,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, Window};

use super::poll_windows::{self, desktop, host_of};
use crate::desktop::{arrange_windows, placement_of, Desktop};
use crate::error::{AppError, AppResult};
use crate::os_timer::SystemTimerResolution;
use crate::state::AppState;
use crate::windows::{connection_label, parse_poll_window_label, poll_window_label};

/// Delivers events to a window's channel.
///
/// Drop policy (see `modbus_master::emitter`): state and list events are never dropped or
/// coalesced; `PollUpdate` is coalesced per view (latest wins, at most one per 50 ms);
/// `TrafficFrames` are batched (at most one batch per 50 ms) and counters coalesced (at most
/// one per 100 ms). `seq` values are strictly increasing so the UI can detect gaps.
/// `Channel::send` never blocks; when the webview is gone the send fails and the session
/// drops that view (no sender leak).
struct ChannelSink<E: Serialize + Clone + Send + Sync + 'static>(Channel<E>);

impl<E: Serialize + Clone + Send + Sync + 'static> EventSink<E> for ChannelSink<E> {
    fn send(&self, event: E) -> bool {
        self.0.send(event).is_ok()
    }
}

/// The session of the calling window and its connection window label.
fn session_of(window: &Window, state: &AppState) -> AppResult<(Arc<Session>, String)> {
    let session = state.session(window.label())?;
    Ok((session, connection_label(window.label()).to_owned()))
}

fn focus_connection(app: &AppHandle, connection: &str) {
    desktop(app).reveal(connection);
}

/// Attaches the connection window's event channel and returns the snapshot. Creates the
/// session on first call; on a reload it re-attaches and replays the traffic log.
/// Connection windows only.
#[tauri::command]
pub async fn mm_open_session(
    window: Window,
    state: State<'_, AppState>,
    channel: Channel<SessionEvent>,
) -> AppResult<SessionSnapshot> {
    if parse_poll_window_label(window.label()).is_some() {
        return Err(AppError::new(
            AppErrorCode::InvalidState,
            "Poll windows attach with mm_attach_poll_view.",
        ));
    }
    let sink: Arc<dyn EventSink<SessionEvent>> = Arc::new(ChannelSink(channel));
    let (session, created) = state.session_or_create(window.label(), || {
        Session::spawn(
            sink.clone(),
            SessionDeps {
                // REPORT-006 D1: the OS timer precision while polls run (`os_timer.rs`).
                timer: Arc::new(SystemTimerResolution),
                ..SessionDeps::default()
            },
        )
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
        session.open(sink).await?
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
/// port-name form (`COM<n>` on Windows), may reach the OS open call.
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

#[tauri::command]
pub async fn mm_cancel_connect(window: Window, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.session(window.label())?.cancel_connect().await?)
}

/// Disconnect (C5). Also cancels while connecting (C4) and dismisses `disconnected` (C7).
#[tauri::command]
pub async fn mm_disconnect(window: Window, state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.session(window.label())?.disconnect().await?)
}

#[tauri::command]
pub async fn mm_set_auto_start_poll(
    window: Window,
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .set_auto_start_poll(enabled)
        .await?)
}

/// PT0, H1/H2. `host: "native"` (from a poll window) opens the new poll in its own window,
/// cascaded from the invoking window.
#[tauri::command]
pub async fn mm_add_poll(
    window: Window,
    state: State<'_, AppState>,
    input: serde_json::Value,
    host: PollHostKind,
) -> AppResult<PollId> {
    let (session, connection) = session_of(&window, &state)?;
    let input = super::value_inputs::poll_input(input)?;
    let id = session.add_poll(input, host).await?;
    if host == PollHostKind::Native {
        // 24 px from the invoking window (H2).
        let d = desktop(window.app_handle());
        poll_windows::open_new_native(&d, &session, &connection, id, window.label()).await?;
    }
    Ok(id)
}

/// H3: the copy is inserted after the source, with the source's host kind.
#[tauri::command]
pub async fn mm_duplicate_poll(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
) -> AppResult<PollId> {
    let (session, connection) = session_of(&window, &state)?;
    let id = session.duplicate_poll(poll_id).await?;
    let info = host_of(&session.hosts().await?, id)?;
    if info.host == PollHostKind::Native {
        // 24 px from the source poll window (H3).
        let reference = poll_window_label(&connection, poll_id);
        let d = desktop(window.app_handle());
        poll_windows::open_new_native(&d, &session, &connection, id, &reference).await?;
    }
    Ok(id)
}

/// PT8. A native window of the poll is destroyed.
#[tauri::command]
pub async fn mm_remove_poll(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
) -> AppResult<()> {
    let (session, connection) = session_of(&window, &state)?;
    session.remove_poll(poll_id).await?;
    desktop(window.app_handle()).destroy(&poll_window_label(&connection, poll_id));
    Ok(())
}

/// Apply (PT6 / PT6b).
#[tauri::command]
pub async fn mm_update_poll(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    definition: PollDefinition,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .update_poll(poll_id, definition)
        .await?)
}

#[tauri::command]
pub async fn mm_rename_poll(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    name: String,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .rename_poll(poll_id, name)
        .await?)
}

/// Resume (PT3) / Pause (PT4).
#[tauri::command]
pub async fn mm_set_poll_active(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    active: bool,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .set_poll_active(poll_id, active)
        .await?)
}

#[tauri::command]
pub async fn mm_set_all_polls_active(
    window: Window,
    state: State<'_, AppState>,
    active: bool,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .set_all_polls_active(active)
        .await?)
}

#[tauri::command]
pub async fn mm_set_poll_view(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    view: serde_json::Value,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .set_poll_view(poll_id, super::value_inputs::poll_view(view)?)
        .await?)
}

#[tauri::command]
pub async fn mm_reorder_polls(
    window: Window,
    state: State<'_, AppState>,
    order: Vec<PollId>,
) -> AppResult<()> {
    Ok(state.session(window.label())?.reorder_polls(order).await?)
}

#[tauri::command]
pub async fn mm_write(
    window: Window,
    state: State<'_, AppState>,
    request: WriteRequest,
    poll_id: Option<PollId>,
) -> AppResult<WriteResult> {
    Ok(state
        .session(window.label())?
        .write(request, poll_id)
        .await?)
}

/// One poll's counters, or (no `pollId`) every counter of the connection.
#[tauri::command]
pub async fn mm_reset_counters(
    window: Window,
    state: State<'_, AppState>,
    poll_id: Option<PollId>,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .reset_counters(poll_id)
        .await?)
}

/// Attaches a poll view channel. A connection window attaches `host: "workspace"` views;
/// a poll window attaches its own poll with `host: "native"`.
#[tauri::command]
pub async fn mm_attach_poll_view(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    host: PollHostKind,
    channel: Channel<PollViewEvent>,
) -> AppResult<PollViewSnapshot> {
    let host_allowed = match parse_poll_window_label(window.label()) {
        Some((_, own)) => {
            if own != poll_id {
                return Err(AppError::new(
                    AppErrorCode::Validation,
                    "A poll window can only show its own poll.",
                )
                .with_field("pollId"));
            }
            host == PollHostKind::Native
        }
        None => host == PollHostKind::Workspace,
    };
    if !host_allowed {
        return Err(AppError::new(
            AppErrorCode::Validation,
            "This window cannot host the poll that way.",
        )
        .with_field("host"));
    }
    let sink: Arc<dyn EventSink<PollViewEvent>> = Arc::new(ChannelSink(channel));
    Ok(state
        .session(window.label())?
        .attach_view(poll_id, host, sink)
        .await?)
}

/// Late detach (an old token) is a no-op.
#[tauri::command]
pub async fn mm_detach_poll_view(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    view_token: ViewToken,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .detach_view(poll_id, view_token)
        .await?)
}

/// Show (H12-H14). With `placement` (list drag) the poll is shown in the workspace; a
/// poll that is open in its own window is docked there (with a handoff request).
#[tauri::command]
pub async fn mm_show_poll(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    placement: Option<ShowPollPlacement>,
) -> AppResult<()> {
    let (session, connection) = session_of(&window, &state)?;
    poll_windows::show(&desktop(&app), &session, &connection, poll_id, placement).await
}

/// Pop out (H4, DES-002 2.5.2). The poll is marked native, then its window is created; if
/// that fails the poll returns to the workspace and the error is returned. Connection
/// windows only.
#[tauri::command]
pub async fn mm_pop_out_poll(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    anchor: PopOutAnchor,
    handoff: Option<String>,
) -> AppResult<()> {
    let (session, connection) = session_of(&window, &state)?;
    // DEV/QA ONLY (Q-002-14): an armed failure, before any window or host change.
    #[cfg(feature = "dev-hooks")]
    state
        .dev_fail
        .check(crate::dev_hooks::DevWindowOp::PopOut)?;
    poll_windows::pop_out(
        &desktop(&app),
        &session,
        &connection,
        poll_id,
        &anchor,
        handoff,
    )
    .await
}

/// Dock (H5, H15, DES-002 2.5.3). From the poll window with its handoff, or from the
/// connection window (list drag) with `requestHandoff: true`.
#[tauri::command]
pub async fn mm_dock_poll(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    handoff: Option<String>,
    request_handoff: bool,
    workspace_rect: Option<WorkspaceRect>,
) -> AppResult<()> {
    let (session, connection) = session_of(&window, &state)?;
    // DEV/QA ONLY (Q-002-14): an armed failure, before any handoff request, window or host
    // change.
    #[cfg(feature = "dev-hooks")]
    state.dev_fail.check(crate::dev_hooks::DevWindowOp::Dock)?;
    poll_windows::dock(
        &desktop(&app),
        &session,
        &connection,
        poll_id,
        handoff,
        request_handoff,
        workspace_rect,
    )
    .await
}

/// The poll window's answer to `HandoffRequested` (null = refuse).
#[tauri::command]
pub async fn mm_provide_handoff(
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    handoff: Option<String>,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .provide_handoff(poll_id, handoff)
        .await?)
}

/// After S6 in either host: Keep (H10) or Delete (H11). A native window is destroyed.
#[tauri::command]
pub async fn mm_close_poll_view(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    poll_id: PollId,
    keep: bool,
) -> AppResult<()> {
    let (session, connection) = session_of(&window, &state)?;
    poll_windows::close_view(&desktop(&app), &session, &connection, poll_id, keep).await
}

/// Brings every native poll window of the connection to the front (list order).
#[tauri::command]
pub async fn mm_show_poll_windows(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (session, connection) = session_of(&window, &state)?;
    let d = desktop(&app);
    for label in poll_windows::native_labels(&d, &connection, &session.hosts().await?) {
        d.reveal(&label);
    }
    Ok(())
}

#[tauri::command]
pub async fn mm_focus_connection_window(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (_, connection) = session_of(&window, &state)?;
    focus_connection(&app, &connection);
    Ok(())
}

/// Connection window only: stored at the end of each workspace action (DES-002 2.10.9).
#[tauri::command]
pub async fn mm_set_workspace_layout(
    window: Window,
    state: State<'_, AppState>,
    layout: WorkspaceLayout,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .set_workspace_layout(layout)
        .await?)
}

#[tauri::command]
pub async fn mm_set_compact_mode(
    window: Window,
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<()> {
    Ok(state.session(window.label())?.set_compact(enabled).await?)
}

#[tauri::command]
pub async fn mm_set_ask_on_poll_close(
    window: Window,
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .set_ask_on_poll_close(enabled)
        .await?)
}

/// DES-002 2.8 for the connection's native poll windows.
#[tauri::command]
pub async fn mm_arrange_poll_windows(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    layout: ArrangeLayout,
    target: ArrangeTarget,
) -> AppResult<ArrangeResult> {
    let (session, connection) = session_of(&window, &state)?;
    let d = desktop(&app);
    let labels = poll_windows::native_labels(&d, &connection, &session.hosts().await?);
    let result = arrange_windows(&d, &labels, layout, &target)?;
    // Z-order in list order; a poll window that asked keeps the focus.
    if parse_poll_window_label(window.label()).is_some() {
        for label in &labels {
            d.reveal(label);
        }
        d.reveal(window.label());
    }
    Ok(result)
}

#[tauri::command]
pub async fn mm_set_profile_name(
    window: Window,
    state: State<'_, AppState>,
    name: Option<String>,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .set_profile_name(name)
        .await?)
}

/// Save (or, with `saveAs: true`, Save as) from a poll window, relayed to the connection
/// window (`SaveRequested`). `saveAs` may be omitted (false). W1 is deliberately **not**
/// raised here: per FE-002 decision 2 W1 brings itself to the front
/// (`mm_focus_connection_window`) only when it shows something (Save as dialog, "Fix the
/// highlighted fields"); a plain Save of a named profile stays in the background.
#[tauri::command]
pub async fn mm_request_save(
    window: Window,
    state: State<'_, AppState>,
    save_as: Option<bool>,
) -> AppResult<()> {
    Ok(state
        .session(window.label())?
        .request_save(save_as.unwrap_or(false))
        .await?)
}

/// "Show traffic for this poll" from a poll window: `ShowTraffic` to the connection window,
/// which is then restored if minimized, brought to the front and focused (CHK2-K5,
/// REPORT-007 D7). `noSession` when the connection window is gone.
#[tauri::command]
pub async fn mm_show_traffic(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    poll_id: Option<PollId>,
) -> AppResult<()> {
    let (session, connection) = session_of(&window, &state)?;
    poll_windows::show_traffic(&desktop(&app), &session, &connection, poll_id).await
}

/// Loads a profile into the connection (DES-002 6.3): closes every native poll window
/// (no S6), replaces the polls and workspace settings, then opens native windows for
/// `host: native, open: true` polls at their placements (2.13 restore rule). Only while
/// idle or disconnected. Returns the new snapshot.
#[tauri::command]
pub async fn mm_apply_profile(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    profile: serde_json::Value,
) -> AppResult<SessionSnapshot> {
    let (session, connection) = session_of(&window, &state)?;
    let profile = super::value_inputs::profile(profile)?;
    poll_windows::apply_profile(&desktop(&app), &session, &connection, profile).await
}

/// Builds a schema 2 profile from the connection (native placements from the windows,
/// workspace fields from the stored layout). `name` and `connection` are optional: they
/// default to the name from `mm_set_profile_name` and the last connection settings; the
/// connection window usually passes the settings of its form.
#[tauri::command]
pub async fn mm_export_profile(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    name: Option<String>,
    connection: Option<ConnectionConfig>,
) -> AppResult<Profile> {
    let (session, w1) = session_of(&window, &state)?;
    let d = desktop(&app);
    for info in session.hosts().await? {
        if info.is_native_open() {
            poll_windows::remember_placement(&d, &session, &w1, info.poll_id).await;
        }
    }
    let connection_window = placement_of(&d, &w1);
    Ok(session
        .export_profile(name, connection, connection_window)
        .await?)
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
