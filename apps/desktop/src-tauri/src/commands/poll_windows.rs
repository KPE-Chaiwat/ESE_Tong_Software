//! Native poll windows (W2): the window glue of the Modbus Master commands (create, show,
//! pop out, dock, close, profile load). Every function takes the window system as a
//! [`Desktop`], so it is tested with the fake desktop and a real `Session`; placement math
//! lives in `crate::desktop` / `platform::arrange`.
//!
//! Order rule (REV-004 m6): the session marks a poll native **before** its window is
//! created, so the new window's first `mm_attach_poll_view(native)` always succeeds. When
//! the window cannot be created, the session change is undone.

use modbus_master::{PollHostInfo, Session, ShowOutcome};
use shared_types::{
    AppErrorCode, PollId, PopOutAnchor, Profile, SessionSnapshot, ShowPollPlacement, WorkspaceRect,
};
use tauri::{AppHandle, Wry};

use crate::desktop::{native_min_inner, placement_of, spot_for_pop_out, spot_for_show};
use crate::desktop::{Desktop, NativeSpot};
use crate::error::{AppError, AppResult};
use crate::tauri_desktop::TauriDesktop;
use crate::windows::{poll_window_label, poll_window_route, POLL_WINDOW};

pub fn desktop(app: &AppHandle) -> TauriDesktop<'_, Wry> {
    TauriDesktop { app }
}

fn internal(message: String) -> AppError {
    AppError::new(AppErrorCode::Internal, message)
}

fn validation(e: modbus_master::ValidationError) -> AppError {
    modbus_master::SessionError::from(e).into()
}

pub fn host_of(hosts: &[PollHostInfo], id: PollId) -> AppResult<PollHostInfo> {
    hosts
        .iter()
        .find(|h| h.poll_id == id)
        .cloned()
        .ok_or_else(|| AppError::new(AppErrorCode::PollNotFound, "This poll no longer exists."))
}

/// Creates the (hidden) native window of a poll at `spot`. The caller shows it. An existing
/// window is reused.
///
/// REV-004 M1 (PM decision): 480 x 320 is the **outer** minimum. The window is built with
/// the conservative fallback client minimum, then its frame is measured and the client
/// minimum becomes `(480 x 320) - frame`, so a window at its minimum is exactly 480 x 320
/// outside and fits every arranged cell.
///
/// # Errors
/// `internal` when the window cannot be created or placed (it is destroyed again).
pub fn create(
    d: &dyn Desktop,
    connection: &str,
    id: PollId,
    title: &str,
    spot: Option<NativeSpot>,
) -> AppResult<String> {
    let label = poll_window_label(connection, id);
    if d.exists(&label) {
        return Ok(label);
    }
    d.create_poll_window(
        &label,
        &poll_window_route(id),
        title,
        native_min_inner(None),
    )
    .map_err(internal)?;
    // Not fatal: the fallback minimum stays when the refinement fails.
    refresh_min_size(d, &label);
    if let Some(spot) = spot {
        if let Err(e) = d.place(&label, spot.outer, spot.maximized) {
            d.destroy(&label);
            return Err(internal(e));
        }
    }
    Ok(label)
}

/// Sets a native poll window's minimum client size from its measured frame at its current
/// scale (D-002-21): after creation and after every scale change (a move to a monitor with
/// another DPI), so the outer minimum is ceil(480 s) x ceil(320 s) at every scale. After a
/// scale change it must run only once the window has been resized for the new scale, else
/// the frame is the old monitor's (REV-008 M-1; `desktop::ScaleChangeTracker`).
pub fn refresh_min_size(d: &dyn Desktop, label: &str) {
    if let Some(w) = d.window(label) {
        let _ = d.set_min_inner_size(label, native_min_inner(Some(&w)));
    }
}

/// Stores the current placement of a poll's native window in the session.
pub async fn remember_placement(d: &dyn Desktop, session: &Session, connection: &str, id: PollId) {
    let label = poll_window_label(connection, id);
    if let Some(p) = placement_of(d, &label) {
        let _ = session.set_native_placement(id, p).await;
    }
}

/// Labels of the existing native windows of the connection's polls, in list order.
#[must_use]
pub fn native_labels(d: &dyn Desktop, connection: &str, hosts: &[PollHostInfo]) -> Vec<String> {
    hosts
        .iter()
        .filter(|h| h.is_native_open())
        .map(|h| poll_window_label(connection, h.poll_id))
        .filter(|l| d.exists(l))
        .collect()
}

/// Opens the native window of a poll: marks it native first, then creates, places, shows
/// and focuses the window at the saved placement (restore rule) or cascaded `k` steps of
/// 24 px from `reference` (DES-002 2.13). On failure the session change is undone.
///
/// # Errors
/// From the session, or `internal` when the window cannot be created.
pub async fn open_native(
    d: &dyn Desktop,
    session: &Session,
    connection: &str,
    info: &PollHostInfo,
    reference: &str,
    k: i64,
) -> AppResult<()> {
    // A failed bulk create can leave a terminal orphan if native destruction failed.
    // Remove that exact closed-host window before retrying the same surviving definition.
    let label = poll_window_label(connection, info.poll_id);
    if info.open && d.exists(&label) {
        return d.reveal_checked(&label).map_err(internal);
    }
    if !info.open && d.exists(&label) {
        d.destroy_checked(&label).map_err(internal)?;
    }
    let undo = session.begin_native_open(info.poll_id, None).await?;
    let spot = spot_for_show(d, info.native.as_ref(), reference, k);
    match create(d, connection, info.poll_id, &info.name, spot) {
        Ok(label) => {
            if let Err(message) = d.reveal_checked(&label) {
                let _ = d.destroy_checked(&label);
                let _ = session.undo_native_open(info.poll_id, undo).await;
                return Err(internal(message));
            }
            Ok(())
        }
        Err(e) => {
            let _ = session.undo_native_open(info.poll_id, undo).await;
            Err(e)
        }
    }
}

/// The number of other polls open in their own window (cascade steps from W1).
fn others_native(hosts: &[PollHostInfo], id: PollId) -> i64 {
    i64::try_from(
        hosts
            .iter()
            .filter(|h| h.is_native_open() && h.poll_id != id)
            .count(),
    )
    .unwrap_or(0)
}

/// H2 / H3: the new poll `id` (already native in the session) opens in its own window
/// 24 px from `reference`, the invoking poll window (H2) or the source poll window (H3)
/// (REV-004 m2: the reference itself is not counted, so the step is exactly 24 px). On
/// failure the poll is removed again.
///
/// # Errors
/// From the session, or `internal` when the window cannot be created.
pub async fn open_new_native(
    d: &dyn Desktop,
    session: &Session,
    connection: &str,
    id: PollId,
    reference: &str,
) -> AppResult<()> {
    let info = host_of(&session.hosts().await?, id)?;
    if let Err(e) = open_native(d, session, connection, &info, reference, 0).await {
        let _ = session.remove_poll(id).await; // on failure nothing changes
        return Err(e);
    }
    Ok(())
}

/// Show (H12-H14). With `placement` (list drag) the poll is shown in the workspace; a
/// poll that is open in its own window is docked there (with a handoff request).
///
/// # Errors
/// From the session, validation, or `internal` when a window cannot be created.
pub async fn show(
    d: &dyn Desktop,
    session: &Session,
    connection: &str,
    poll_id: PollId,
    placement: Option<ShowPollPlacement>,
) -> AppResult<()> {
    let hosts = session.hosts().await?;
    let info = host_of(&hosts, poll_id)?;
    if let Some(p) = &placement {
        if info.is_native_open() {
            return dock(
                d,
                session,
                connection,
                poll_id,
                None,
                true,
                Some(p.workspace_rect),
            )
            .await;
        }
    }
    let label = poll_window_label(connection, poll_id);
    let k = others_native(&hosts, poll_id);
    match session
        .show_poll(poll_id, placement.map(|p| p.workspace_rect))
        .await?
    {
        ShowOutcome::Workspace => {
            d.reveal(connection);
        }
        ShowOutcome::FocusNative => {
            if !d.reveal(&label) {
                // Its window is gone: the poll is closed, then opened again.
                if let Some(generation) = session.native_generation(poll_id) {
                    session
                        .native_incarnation_destroyed(poll_id, generation)
                        .await?;
                }
                open_native(d, session, connection, &info, connection, k).await?;
            }
        }
        ShowOutcome::OpenNative(_) => {
            open_native(d, session, connection, &info, connection, k).await?;
        }
    }
    Ok(())
}

/// Pop out (H4, DES-002 2.5.2): the poll is marked native (the workspace view gets
/// `ViewDetached { poppedOut }`), then its window is created at the saved placement or the
/// anchor. If the window cannot be created, the poll returns to the workspace (W1 mounts
/// the sub-window again and it gets its handoff back) and the error is returned.
///
/// # Errors
/// `validation` (`handoff`, `anchor`), `pollNotFound`, `internal`.
pub async fn pop_out(
    d: &dyn Desktop,
    session: &Session,
    connection: &str,
    poll_id: PollId,
    anchor: &PopOutAnchor,
    handoff: Option<String>,
) -> AppResult<()> {
    modbus_master::validate::validate_handoff(handoff.as_deref()).map_err(validation)?;
    modbus_master::validate::validate_anchor(anchor).map_err(validation)?;
    let info = host_of(&session.hosts().await?, poll_id)?;
    let label = poll_window_label(connection, poll_id);
    if info.is_native_open() && d.reveal(&label) {
        return Ok(());
    }
    let size = info
        .workspace
        .map_or((POLL_WINDOW.width, POLL_WINDOW.height), |r| {
            (r.width, r.height)
        });
    let spot = spot_for_pop_out(d, info.native.as_ref(), connection, anchor, size);
    let undo = session.begin_native_open(poll_id, handoff).await?;
    match create(d, connection, poll_id, &info.name, spot) {
        Ok(label) => {
            d.reveal(&label);
            Ok(())
        }
        Err(e) => {
            let _ = session.undo_native_open(poll_id, undo).await;
            Err(e)
        }
    }
}

/// Dock (H5, H15, DES-002 2.5.3).
///
/// # Errors
/// `validation` (`handoff`, `workspaceRect`, checked before a handoff is requested),
/// `invalidState` (a dock of this poll is already waiting for its handoff),
/// `pollNotFound`.
pub async fn dock(
    d: &dyn Desktop,
    session: &Session,
    connection: &str,
    poll_id: PollId,
    handoff: Option<String>,
    request_handoff: bool,
    workspace_rect: Option<WorkspaceRect>,
) -> AppResult<()> {
    modbus_master::validate::validate_handoff(handoff.as_deref()).map_err(validation)?;
    if let Some(r) = &workspace_rect {
        // REV-004 n3: before waiting up to 1 s for the handoff.
        modbus_master::validate::validate_workspace_rect(r, "workspaceRect").map_err(validation)?;
    }
    let handoff = if request_handoff {
        session.request_handoff(poll_id).await?
    } else {
        handoff
    };
    let label = poll_window_label(connection, poll_id);
    let placement = placement_of(d, &label);
    session
        .dock(poll_id, handoff, workspace_rect, placement)
        .await?;
    d.destroy(&label);
    d.reveal(connection);
    Ok(())
}

/// After S6 in either host: Keep (H10) or Delete (H11). A native window's placement is
/// saved and the window destroyed.
///
/// # Errors
/// `pollNotFound`.
pub async fn close_view(
    d: &dyn Desktop,
    session: &Session,
    connection: &str,
    poll_id: PollId,
    keep: bool,
) -> AppResult<()> {
    remember_placement(d, session, connection, poll_id).await;
    session.close_view(poll_id, keep).await?;
    d.destroy(&poll_window_label(connection, poll_id));
    Ok(())
}

/// "Show traffic for this poll" (CHK2-K5, REPORT-007 D7): `ShowTraffic` is sent to W1's
/// channel first (it is delivered whether W1 is minimized or not), then W1 is restored if
/// minimized, shown and focused through the same [`Desktop::reveal`] as dock and
/// `mm_focus_connection_window`. From a sub-window W1 is already in front; the reveal is
/// harmless there.
///
/// # Errors
/// From the session (`noSession` when it is closed), or `noSession` when the connection
/// window no longer exists (the event was sent to a session without a window).
pub async fn show_traffic(
    d: &dyn Desktop,
    session: &Session,
    connection: &str,
    poll_id: Option<PollId>,
) -> AppResult<()> {
    session.show_traffic(poll_id).await?;
    if d.reveal(connection) {
        Ok(())
    } else {
        Err(AppError::new(
            AppErrorCode::NoSession,
            "The connection window is no longer open.",
        ))
    }
}

/// Profile load (DES-002 6.3): old native windows are destroyed without S6, then a window
/// opens for each `host: native, open: true` poll at its placement (restore rule) or
/// cascaded on W1's monitor; a window that cannot be created leaves its poll closed.
///
/// # Errors
/// From the session (`invalidState`, `validation`).
pub async fn apply_profile(
    d: &dyn Desktop,
    session: &Session,
    connection: &str,
    profile: Profile,
) -> AppResult<SessionSnapshot> {
    let old = native_labels(d, connection, &session.hosts().await?);
    session.apply_profile(profile).await?;
    for label in old {
        d.destroy(&label);
    }
    let mut k = 0;
    for info in session.hosts().await? {
        if !info.is_native_open() {
            continue;
        }
        // Already native and open in the session (the profile says so): no attach race.
        let spot = spot_for_show(d, info.native.as_ref(), connection, k);
        k += 1;
        match create(d, connection, info.poll_id, &info.name, spot) {
            Ok(label) => d.show(&label),
            // The poll stays, closed; Show opens it later.
            Err(_) => session.native_window_destroyed(info.poll_id).await?,
        }
    }
    d.reveal(connection);
    Ok(session.snapshot().await?)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use modbus_master::{EventSink, SessionDeps};
    use platform::arrange::Rect;
    use shared_types::{
        DisplaySettings, LogicalRect, PollConfigInput, PollDefinition, PollHostKind as H,
        PollViewEvent, SessionEvent, SubWindowState, ValueColumns,
    };

    use super::*;
    use crate::desktop::fake::FakeDesktop;
    use crate::desktop::MonitorGeom;

    const W1: &str = "modbus-master-1";

    /// Every event of both channels, in one timeline, as short strings.
    #[derive(Default)]
    struct Timeline(Mutex<Vec<String>>);

    impl Timeline {
        fn push(&self, s: String) {
            self.0.lock().unwrap().push(s);
        }
        fn all(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }
        fn position(&self, what: &str) -> usize {
            self.all()
                .iter()
                .position(|s| s == what)
                .unwrap_or_else(|| panic!("{what} not in {:?}", self.all()))
        }
    }

    struct SessionSinkRec(Arc<Timeline>);
    impl EventSink<SessionEvent> for SessionSinkRec {
        fn send(&self, e: SessionEvent) -> bool {
            match e {
                SessionEvent::PollListChanged(l) => {
                    let hosts: Vec<String> = l
                        .polls
                        .iter()
                        .map(|p| format!("{}:{:?}:{}", p.config.poll_id, p.host, p.open))
                        .collect();
                    self.0.push(format!("list {}", hosts.join(",")));
                }
                SessionEvent::ShowTraffic(s) => {
                    self.0.push(format!("traffic {:?}", s.poll_id));
                }
                _ => {}
            }
            true
        }
    }

    struct ViewRec(Arc<Timeline>, Mutex<Vec<PollViewEvent>>);
    impl EventSink<PollViewEvent> for ViewRec {
        fn send(&self, e: PollViewEvent) -> bool {
            if let PollViewEvent::ViewDetached(d) = &e {
                self.0.push(format!("detached {:?}", d.reason));
            }
            self.1.lock().unwrap().push(e);
            true
        }
    }

    fn desktop_with(timeline: &Arc<Timeline>) -> FakeDesktop {
        let t = timeline.clone();
        let d = FakeDesktop {
            monitors: vec![MonitorGeom {
                name: "\\\\.\\DISPLAY1".into(),
                primary: true,
                work_area: Rect::new(0, 0, 1920, 1032),
                scale: 1.0,
            }],
            frame: (16, 39),
            on_create: Some(Box::new(move |l| t.push(format!("create {l}")))),
            ..FakeDesktop::default()
        };
        d.insert(W1, Rect::new(100, 100, 1296, 839));
        d
    }

    fn session(timeline: &Arc<Timeline>) -> Session {
        Session::spawn(
            Arc::new(SessionSinkRec(timeline.clone())),
            SessionDeps::default(),
        )
    }

    fn input(name: &str) -> PollConfigInput {
        PollConfigInput {
            name: name.into(),
            definition: PollDefinition {
                slave_id: 1,
                function: 3,
                start_address: 0,
                quantity: 4,
                scan_rate_ms: 1000,
            },
            display: DisplaySettings::default(),
            format_overrides: vec![],
            color_rules: Vec::new(),
            scale: None,
            scale_overrides: vec![],
            value_columns: ValueColumns::Raw,
            aliases: vec![],
        }
    }

    fn view(t: &Arc<Timeline>) -> Arc<ViewRec> {
        Arc::new(ViewRec(t.clone(), Mutex::new(Vec::new())))
    }

    fn anchor() -> PopOutAnchor {
        PopOutAnchor::Rect {
            rect: LogicalRect::new(40.0, 60.0, 640.0, 368.0),
        }
    }

    fn code(e: &AppError) -> (String, Option<String>) {
        let v = serde_json::to_value(e).unwrap();
        (
            v["code"].as_str().unwrap().to_owned(),
            v["field"].as_str().map(str::to_owned),
        )
    }

    async fn host(s: &Session, id: PollId) -> PollHostInfo {
        host_of(&s.hosts().await.unwrap(), id).unwrap()
    }

    /// Pop out marks the poll native before the window exists (m6), creates the window
    /// with the frame-aware minimum (M1) at the anchor, shows it; the new window's attach
    /// succeeds and gets the handoff.
    #[tokio::test]
    async fn pop_out_marks_native_before_creating_the_window() {
        let t = Arc::new(Timeline::default());
        let d = desktop_with(&t);
        let s = session(&t);
        let a = s.add_poll(input("A"), H::Workspace).await.unwrap();
        let ws = view(&t);
        s.attach_view(a, H::Workspace, ws.clone()).await.unwrap();
        pop_out(&d, &s, W1, a, &anchor(), Some("drafts".into()))
            .await
            .unwrap();
        let label = poll_window_label(W1, a);
        let created = t.position(&format!("create {label}"));
        assert!(t.position("detached PoppedOut") < created);
        assert!(t.position(&format!("list {a}:Native:true")) < created);
        let w = d.get(&label).unwrap();
        assert!(w.visible);
        assert_eq!(
            w.min_inner,
            (464.25, 281.25),
            "480 x 320 outer minus the frame (+0.25 px against rounding, D3)"
        );
        assert_eq!(w.route, "tools/modbus-master/poll?pollId=1");
        assert_eq!(w.title, "A");
        // W1 client origin (108, 131) + anchor (40, 60).
        assert_eq!(w.geom.outer, Rect::new(148, 191, 640, 368));
        let snap = s.attach_view(a, H::Native, view(&t)).await.unwrap();
        assert_eq!(snap.handoff.as_deref(), Some("drafts"));
        // Pop out again while open: only revealed.
        pop_out(&d, &s, W1, a, &anchor(), None).await.unwrap();
        assert_eq!(
            d.calls().iter().filter(|c| c.starts_with("create")).count(),
            1
        );
    }

    /// A window that cannot be created: the error is returned and the poll is back in the
    /// workspace (its sub-window remounts and gets the handoff back).
    #[tokio::test]
    async fn pop_out_failure_restores_the_workspace_host() {
        let t = Arc::new(Timeline::default());
        let d = desktop_with(&t);
        *d.fail_create.lock().unwrap() = true;
        let s = session(&t);
        let a = s.add_poll(input("A"), H::Workspace).await.unwrap();
        s.attach_view(a, H::Workspace, view(&t)).await.unwrap();
        let err = pop_out(&d, &s, W1, a, &anchor(), Some("drafts".into()))
            .await
            .unwrap_err();
        assert_eq!(code(&err).0, "internal");
        let h = host(&s, a).await;
        assert_eq!((h.host, h.open), (H::Workspace, true));
        assert!(t
            .all()
            .last()
            .unwrap()
            .contains(&format!("{a}:Workspace:true")));
        let snap = s.attach_view(a, H::Workspace, view(&t)).await.unwrap();
        assert_eq!(snap.handoff.as_deref(), Some("drafts"));
        // A place failure destroys the half-made window too.
        *d.fail_create.lock().unwrap() = false;
        *d.fail_place.lock().unwrap() = true;
        assert!(pop_out(&d, &s, W1, a, &anchor(), None).await.is_err());
        assert!(!d.exists(&poll_window_label(W1, a)));
        assert_eq!(host(&s, a).await.host, H::Workspace);
    }

    /// Q-002-14 (dev hook, as `mm_pop_out_poll` / `mm_dock_poll` use it with the feature
    /// `dev-hooks`): the armed failure is returned before anything happens (no window call,
    /// no host or routing change, the views stay attached), once; the next attempt works.
    #[tokio::test]
    async fn dev_hook_failure_changes_nothing_and_fires_once() {
        use crate::dev_hooks::{DevFailHook, DevWindowOp};
        let t = Arc::new(Timeline::default());
        let d = desktop_with(&t);
        let s = session(&t);
        let a = s.add_poll(input("A"), H::Workspace).await.unwrap();
        let ws = view(&t);
        s.attach_view(a, H::Workspace, ws.clone()).await.unwrap();
        let hook = DevFailHook::default();
        hook.arm(DevWindowOp::PopOut, "boom".into());
        let before = (t.all(), d.calls(), host(&s, a).await);
        let attempt = |hook: &DevFailHook| hook.check(DevWindowOp::PopOut);
        let err = attempt(&hook).unwrap_err();
        assert_eq!(code(&err).0, "internal");
        assert_eq!((t.all(), d.calls(), host(&s, a).await), before);
        assert!(ws.1.lock().unwrap().is_empty(), "no ViewDetached");
        // Disarmed: the real pop out runs.
        attempt(&hook).unwrap();
        pop_out(&d, &s, W1, a, &anchor(), None).await.unwrap();
        assert_eq!(host(&s, a).await.host, H::Native);
        // Dock: the same.
        hook.arm(DevWindowOp::Dock, "no dock".into());
        let before = (d.calls(), host(&s, a).await);
        assert!(hook.check(DevWindowOp::Dock).is_err());
        assert_eq!((d.calls(), host(&s, a).await), before);
        hook.check(DevWindowOp::Dock).unwrap();
        dock(&d, &s, W1, a, None, false, None).await.unwrap();
        assert_eq!(host(&s, a).await.host, H::Workspace);
    }

    /// REV-004 m4: extreme anchors are a validation error, never a panic.
    #[tokio::test]
    async fn pop_out_rejects_extreme_anchors() {
        let t = Arc::new(Timeline::default());
        let d = desktop_with(&t);
        let s = session(&t);
        let a = s.add_poll(input("A"), H::Workspace).await.unwrap();
        for bad in [
            PopOutAnchor::Rect {
                rect: LogicalRect::new(1e300, 0.0, 640.0, 368.0),
            },
            PopOutAnchor::Rect {
                rect: LogicalRect::new(0.0, -1e300, 640.0, 368.0),
            },
            PopOutAnchor::Cursor {
                grab_offset: shared_types::LogicalPoint { x: 1e300, y: 0.0 },
            },
        ] {
            let err = pop_out(&d, &s, W1, a, &bad, None).await.unwrap_err();
            assert_eq!(code(&err), ("validation".into(), Some("anchor".into())));
        }
        assert!(d.calls().iter().all(|c| !c.starts_with("create")));
    }

    /// Dock saves the placement, detaches the native view, destroys the window and brings
    /// W1 to the front; an invalid rectangle is rejected before any handoff request (n3).
    #[tokio::test]
    async fn dock_and_close_through_the_fake_desktop() {
        let t = Arc::new(Timeline::default());
        let d = desktop_with(&t);
        let s = session(&t);
        let a = s.add_poll(input("A"), H::Workspace).await.unwrap();
        pop_out(&d, &s, W1, a, &anchor(), None).await.unwrap();
        let native = view(&t);
        s.attach_view(a, H::Native, native.clone()).await.unwrap();
        let label = poll_window_label(W1, a);
        d.place(&label, Rect::new(300, 200, 700, 500), false)
            .unwrap();

        let bad = WorkspaceRect {
            x: f64::NAN,
            y: 0.0,
            width: 640.0,
            height: 368.0,
            z: 1,
            state: SubWindowState::Normal,
            restore: None,
            grid: None,
        };
        let err = dock(&d, &s, W1, a, None, true, Some(bad))
            .await
            .unwrap_err();
        assert_eq!(
            code(&err),
            ("validation".into(), Some("workspaceRect".into()))
        );
        assert!(
            native
                .1
                .lock()
                .unwrap()
                .iter()
                .all(|e| !matches!(e, PollViewEvent::HandoffRequested(_))),
            "no handoff was requested"
        );

        dock(&d, &s, W1, a, Some("h".into()), false, None)
            .await
            .unwrap();
        assert!(!d.exists(&label));
        assert_eq!(d.calls().last().unwrap(), &format!("reveal {W1}"));
        let h = host(&s, a).await;
        assert_eq!((h.host, h.open), (H::Workspace, true));
        let saved = h.native.unwrap();
        assert_eq!(saved.rect(), LogicalRect::new(300.0, 200.0, 700.0, 500.0));
        assert!(t.all().contains(&"detached Docked".to_owned()));

        // Pop out again: restored at the saved placement. Then Close -> Keep.
        pop_out(&d, &s, W1, a, &anchor(), None).await.unwrap();
        assert_eq!(
            d.get(&label).unwrap().geom.outer,
            Rect::new(300, 200, 700, 500)
        );
        d.place(&label, Rect::new(320, 220, 700, 500), false)
            .unwrap();
        close_view(&d, &s, W1, a, true).await.unwrap();
        assert!(!d.exists(&label));
        let h = host(&s, a).await;
        assert_eq!((h.host, h.open), (H::Native, false));
        assert_eq!(h.native.unwrap().x, 320.0);
        // Show of the closed native poll reopens it at the saved placement.
        show(&d, &s, W1, a, None).await.unwrap();
        assert_eq!(
            d.get(&label).unwrap().geom.outer,
            Rect::new(320, 220, 700, 500)
        );
        assert!(host(&s, a).await.open);
        // Close -> Delete removes the poll.
        close_view(&d, &s, W1, a, false).await.unwrap();
        assert!(s.hosts().await.unwrap().is_empty());
        assert!(!d.exists(&label));
        assert_eq!(
            t.all().iter().filter(|x| *x == "detached Docked").count(),
            1
        );
    }

    /// REPORT-007 D7 (CHK2-K5): "Show traffic for this poll" from a native window sends
    /// `ShowTraffic` to W1, then restores a minimized W1 and focuses it, and focuses a W1
    /// that is behind the native window. A missing W1 is a clean `noSession` error (the
    /// event was still sent, nothing panics).
    #[tokio::test]
    async fn show_traffic_raises_the_connection_window() {
        let t = Arc::new(Timeline::default());
        let d = desktop_with(&t);
        let s = session(&t);
        let a = s.add_poll(input("A"), H::Workspace).await.unwrap();
        pop_out(&d, &s, W1, a, &anchor(), None).await.unwrap();
        let native = poll_window_label(W1, a);
        assert_eq!(d.focused().as_deref(), Some(native.as_str()));

        // W1 minimized: the event is sent, then W1 is restored, shown and focused.
        d.minimize(W1);
        assert!(d.get(W1).unwrap().geom.minimized);
        d.focus(&native);
        let calls = d.calls().len();
        show_traffic(&d, &s, W1, Some(a)).await.unwrap();
        assert_eq!(t.all().last().unwrap(), &format!("traffic {:?}", Some(a)));
        let w1 = d.get(W1).unwrap();
        assert!(!w1.geom.minimized && w1.visible);
        assert_eq!(d.focused().as_deref(), Some(W1));
        assert_eq!(d.calls()[calls..], [format!("reveal {W1}")]);

        // W1 behind the native window (not minimized): it comes to the front.
        d.focus(&native);
        show_traffic(&d, &s, W1, Some(a)).await.unwrap();
        assert_eq!(d.focused().as_deref(), Some(W1));
        assert_eq!(
            t.all()
                .iter()
                .filter(|x| *x == &format!("traffic {:?}", Some(a)))
                .count(),
            2
        );
        // "All polls" (null) is relayed as is.
        show_traffic(&d, &s, W1, None).await.unwrap();
        assert_eq!(t.all().last().unwrap(), "traffic None");

        // W1 gone: a clean error, the native window keeps the focus.
        d.destroy(W1);
        d.focus(&native);
        let err = show_traffic(&d, &s, W1, Some(a)).await.unwrap_err();
        assert_eq!(code(&err), ("noSession".into(), None));
        assert_eq!(t.all().last().unwrap(), &format!("traffic {:?}", Some(a)));
        assert_eq!(d.focused().as_deref(), Some(native.as_str()));
        assert!(!d.exists(W1));
    }

    /// Show of a closed native poll whose window cannot be created: it stays closed.
    #[tokio::test]
    async fn show_failure_leaves_the_poll_closed() {
        let t = Arc::new(Timeline::default());
        let d = desktop_with(&t);
        let s = session(&t);
        let a = s.add_poll(input("A"), H::Native).await.unwrap();
        s.native_window_destroyed(a).await.unwrap();
        *d.fail_create.lock().unwrap() = true;
        assert!(show(&d, &s, W1, a, None).await.is_err());
        let h = host(&s, a).await;
        assert_eq!((h.host, h.open), (H::Native, false));
    }

    /// REV-004 m2: a new poll from a poll window opens 24 px from that window, however
    /// many other poll windows are open; a failure removes the new poll again.
    #[tokio::test]
    async fn new_native_poll_opens_24_px_from_the_invoking_window() {
        let t = Arc::new(Timeline::default());
        let d = desktop_with(&t);
        let s = session(&t);
        let mut last = None;
        for name in ["A", "B", "C", "D"] {
            let id = s.add_poll(input(name), H::Native).await.unwrap();
            open_new_native(&d, &s, W1, id, W1).await.unwrap();
            last = Some(id);
        }
        let reference = poll_window_label(W1, last.unwrap());
        d.place(&reference, Rect::new(500, 300, 916, 679), false)
            .unwrap();
        let e = s.add_poll(input("E"), H::Native).await.unwrap();
        open_new_native(&d, &s, W1, e, &reference).await.unwrap();
        let w = d.get(&poll_window_label(W1, e)).unwrap();
        assert_eq!((w.geom.outer.x, w.geom.outer.y), (524, 324));
        *d.fail_create.lock().unwrap() = true;
        let f = s.add_poll(input("F"), H::Native).await.unwrap();
        assert!(open_new_native(&d, &s, W1, f, &reference).await.is_err());
        assert!(
            host_of(&s.hosts().await.unwrap(), f).is_err(),
            "removed again"
        );
    }
}
