//! W1 bulk coordinator; OS reconciliation never rolls back a committed definition.
use super::poll_windows;
use crate::{
    desktop::{spot_for_show, Desktop},
    error::{AppError, AppResult},
    state::AppState,
    windows::{parse_poll_window_label, poll_window_label},
};
use shared_types::{
    AppErrorCode, PollBulkAction, PollBulkIssueCode, PollBulkPlan, PollBulkRecovery,
    PollBulkResult, PollBulkWindowIssue, PollBulkWindowStage, PollHostKind, PollId, ViewToken,
};
use tauri::{Manager, State, Window};

fn w1(window: &Window) -> AppResult<()> {
    if parse_poll_window_label(window.label()).is_some() {
        return Err(AppError::new(
            AppErrorCode::InvalidState,
            "Bulk operations belong to the connection window.",
        )
        .with_field("planToken"));
    }
    Ok(())
}
#[tauri::command]
pub async fn mm_prepare_poll_bulk(
    window: Window,
    state: State<'_, AppState>,
    action: serde_json::Value,
    poll_ids: serde_json::Value,
) -> AppResult<PollBulkPlan> {
    w1(&window)?;
    let action = serde_json::from_value(action).map_err(|_| {
        AppError::new(AppErrorCode::Validation, "Choose duplicate or delete.").with_field("action")
    })?;
    let poll_ids: Vec<PollId> = serde_json::from_value(poll_ids).map_err(|_| {
        AppError::new(AppErrorCode::Validation, "Select valid poll ids.").with_field("pollIds")
    })?;
    state
        .session(window.label())?
        .prepare_poll_bulk(action, poll_ids)
        .await
        .map_err(bulk_error)
}
fn bulk_error(e: modbus_master::SessionError) -> AppError {
    let err: AppError = e.into();
    match err.0.code {
        AppErrorCode::InvalidState => err.with_field("planToken"),
        AppErrorCode::PollNotFound => err.with_field("pollIds"),
        _ => err,
    }
}
#[tauri::command]
pub async fn mm_duplicate_polls(
    window: Window,
    state: State<'_, AppState>,
    plan_token: String,
) -> AppResult<PollBulkResult> {
    execute(&window, &state, plan_token, PollBulkAction::Duplicate).await
}
#[tauri::command]
pub async fn mm_remove_polls(
    window: Window,
    state: State<'_, AppState>,
    plan_token: String,
) -> AppResult<PollBulkResult> {
    execute(&window, &state, plan_token, PollBulkAction::Delete).await
}
fn issue(id: PollId, stage: PollBulkWindowStage, message: String) -> PollBulkWindowIssue {
    PollBulkWindowIssue {
        poll_id: id,
        stage,
        code: PollBulkIssueCode::Internal,
        message,
        recovery: if stage == PollBulkWindowStage::Destroy {
            PollBulkRecovery::RetryWindowCleanup
        } else {
            PollBulkRecovery::ShowPoll
        },
    }
}
async fn execute(
    window: &Window,
    state: &AppState,
    token: String,
    action: PollBulkAction,
) -> AppResult<PollBulkResult> {
    w1(window)?;
    let session = state.session(window.label())?;
    let d = poll_windows::desktop(window.app_handle());
    #[cfg(all(feature = "dev-hooks", debug_assertions))]
    let d = crate::dev_hooks::BulkDesktop {
        desktop: &d,
        hook: &state.dev_fail,
    };
    execute_with(&d, &session, window.label(), token, action).await
}
async fn execute_with(
    d: &dyn Desktop,
    session: &modbus_master::Session,
    connection: &str,
    token: String,
    action: PollBulkAction,
) -> AppResult<PollBulkResult> {
    let (mut result, lease) = session
        .execute_poll_bulk(token.clone(), action)
        .await
        .map_err(bulk_error)?;
    if lease.is_none() {
        return Ok(result);
    }
    // The complete definition set has committed. Every subsequent OS failure is data.
    let mut placements = Vec::new();
    for created in &result.created {
        let Some(poll) = result
            .polls
            .iter()
            .find(|p| p.config.poll_id == created.poll_id)
        else {
            continue;
        };
        if poll.host != PollHostKind::Native {
            continue;
        }
        if !d.exists(connection) {
            result.issues.push(issue(
                created.poll_id,
                PollBulkWindowStage::Create,
                "The connection window was closed.".into(),
            ));
            continue;
        }
        let reference = poll_window_label(connection, created.source_id);
        let spot = spot_for_show(d, None, &reference, 0);
        if let Some(placement) = spot.and_then(|s| crate::desktop::placement_for_spot(d, s)) {
            placements.push((created.poll_id, placement));
        }
        let label = poll_window_label(connection, created.poll_id);
        let outcome = poll_windows::create(d, connection, created.poll_id, &poll.config.name, spot)
            .map_err(|e| (PollBulkWindowStage::Create, e.to_string()))
            .and_then(|_| {
                d.reveal_checked(&label)
                    .map_err(|e| (PollBulkWindowStage::Show, e))
            });
        if let Err((stage, message)) = outcome {
            let cleanup = d.destroy_checked(&label);
            result.issues.push(issue(created.poll_id, stage, message));
            if let Err(message) = cleanup {
                result.issues.push(issue(
                    created.poll_id,
                    PollBulkWindowStage::Destroy,
                    message,
                ));
            }
        }
    }
    for id in &result.removed_ids {
        let label = poll_window_label(connection, *id);
        if let Err(message) = d.destroy_checked(&label) {
            result
                .issues
                .push(issue(*id, PollBulkWindowStage::Destroy, message));
        }
    }
    // The lease's Drop is also the cancellation fallback. Normal completion records the
    // outcome and publishes its list before this command resolves.
    d.reveal(connection);
    let finished = session
        .finish_poll_bulk_with_placements(token, result.issues.clone(), placements)
        .await;
    drop(lease);
    match finished {
        Ok(r) => Ok(r),
        Err(_) => Ok(result), // W1/session teardown after commit cannot become mutation failure.
    }
}
#[tauri::command]
pub async fn mm_ack_poll_bulk_ready(
    window: Window,
    state: State<'_, AppState>,
    operation_token: String,
    poll_id: PollId,
    view_token: ViewToken,
    ready: bool,
) -> AppResult<()> {
    let host = if let Some((_, own_id)) = parse_poll_window_label(window.label()) {
        if own_id != poll_id {
            return Err(AppError::new(
                AppErrorCode::InvalidState,
                "A poll window may acknowledge only its own view.",
            ));
        }
        PollHostKind::Native
    } else {
        PollHostKind::Workspace
    };
    state
        .session(window.label())?
        .ack_poll_bulk_ready(operation_token, poll_id, view_token, host, ready)
        .await
        .map_err(bulk_error)
}
#[tauri::command]
pub async fn mm_recover_poll_bulk_windows(
    window: Window,
    state: State<'_, AppState>,
    operation_token: String,
) -> AppResult<PollBulkResult> {
    w1(&window)?;
    let session = state.session(window.label())?;
    let d = poll_windows::desktop(window.app_handle());
    recover_with(&d, &session, window.label(), operation_token).await
}
async fn recover_with(
    d: &dyn Desktop,
    session: &modbus_master::Session,
    connection: &str,
    operation_token: String,
) -> AppResult<PollBulkResult> {
    let result = session
        .poll_bulk_record(operation_token.clone())
        .await
        .map_err(bulk_error)?;
    let mut remaining = Vec::new();
    for mut problem in result.issues {
        if problem.recovery == PollBulkRecovery::RetryWindowCleanup {
            // Runtime ids never repeat within this session; only this recorded label is touched.
            if result
                .polls
                .iter()
                .any(|p| p.config.poll_id == problem.poll_id && p.open)
            {
                continue;
            }
            let label = poll_window_label(connection, problem.poll_id);
            if let Err(message) = d.destroy_checked(&label) {
                problem.message = message;
                remaining.push(problem);
            }
        } else if !result
            .polls
            .iter()
            .any(|p| p.config.poll_id == problem.poll_id && p.open)
        {
            remaining.push(problem);
        }
    }
    session
        .update_poll_bulk_record(operation_token, remaining)
        .await
        .map_err(bulk_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::fake::FakeDesktop;
    use crate::dev_hooks::{BulkDesktop, DevFailHook, DevWindowOp};
    use modbus_master::{EventSink, Session, SessionDeps};
    use platform::arrange::Rect;
    use shared_types::{PollConfigInput, PollDefinition, PollViewEvent, SessionEvent};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Events(Mutex<Vec<SessionEvent>>);
    impl EventSink<SessionEvent> for Events {
        fn send(&self, e: SessionEvent) -> bool {
            self.0.lock().unwrap().push(e);
            true
        }
    }
    struct Ready {
        session: Arc<Session>,
        id: PollId,
        token: Mutex<Option<ViewToken>>,
    }
    impl EventSink<PollViewEvent> for Ready {
        fn send(&self, e: PollViewEvent) -> bool {
            if let PollViewEvent::BulkOperationPrepare(p) = e {
                let session = self.session.clone();
                let id = self.id;
                let token = self.token.lock().unwrap().unwrap();
                tokio::spawn(async move {
                    session
                        .ack_poll_bulk_ready(
                            p.operation_token,
                            id,
                            token,
                            PollHostKind::Native,
                            true,
                        )
                        .await
                        .unwrap();
                });
            }
            true
        }
    }
    async fn native(s: &Arc<Session>, name: &str) -> PollId {
        let id = s
            .add_poll(
                PollConfigInput {
                    name: name.into(),
                    definition: PollDefinition {
                        slave_id: 1,
                        function: 3,
                        start_address: 0,
                        quantity: 1,
                        scan_rate_ms: 100,
                    },
                    display: Default::default(),
                    color_rules: vec![],
                    scale: None,
                    scale_overrides: vec![],
                    value_columns: Default::default(),
                    aliases: vec![],
                },
                PollHostKind::Native,
            )
            .await
            .unwrap();
        let sink = Arc::new(Ready {
            session: s.clone(),
            id,
            token: Mutex::new(None),
        });
        let snap = s
            .attach_view(id, PollHostKind::Native, sink.clone())
            .await
            .unwrap();
        *sink.token.lock().unwrap() = Some(snap.view_token);
        id
    }
    #[tokio::test(start_paused = true)]
    async fn bulk_second_native_create_failure_keeps_both_copies_and_show_retries_same_id() {
        let events = Arc::new(Events::default());
        let session = Arc::new(Session::spawn(events.clone(), SessionDeps::default()));
        let a = native(&session, "A").await;
        let b = native(&session, "B").await;
        let d = FakeDesktop::default();
        d.insert("w1", Rect::new(0, 0, 1000, 800));
        for id in [a, b] {
            d.insert(&poll_window_label("w1", id), Rect::new(0, 0, 900, 640));
        }
        let hook = DevFailHook::default();
        hook.arm_after(DevWindowOp::BulkCreate, "second create".into(), 1);
        let injected = BulkDesktop {
            desktop: &d,
            hook: &hook,
        };
        let p = session
            .prepare_poll_bulk(PollBulkAction::Duplicate, vec![b, a])
            .await
            .unwrap();
        events.0.lock().unwrap().clear();
        let result = execute_with(
            &injected,
            &session,
            "w1",
            p.plan_token.clone(),
            PollBulkAction::Duplicate,
        )
        .await
        .unwrap();
        assert_eq!(result.created.len(), 2);
        assert_eq!(result.polls.len(), 4);
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].poll_id, PollId(4));
        assert_eq!(result.issues[0].stage, PollBulkWindowStage::Create);
        assert_eq!(result.issues[0].recovery, PollBulkRecovery::ShowPoll);
        assert!(result.polls[2].open);
        assert!(!result.polls[3].open);
        assert_eq!(
            events
                .0
                .lock()
                .unwrap()
                .iter()
                .filter(|e| matches!(e, SessionEvent::PollListChanged(_)))
                .count(),
            1
        );
        let again = execute_with(
            &injected,
            &session,
            "w1",
            p.plan_token.clone(),
            PollBulkAction::Duplicate,
        )
        .await
        .unwrap();
        assert_eq!(again.created, result.created);

        poll_windows::show(&d, &session, "w1", PollId(4), None)
            .await
            .unwrap();
        let recovered = recover_with(&d, &session, "w1", p.plan_token)
            .await
            .unwrap();
        assert!(recovered.issues.is_empty());
        assert_eq!(recovered.polls.len(), 4);
        session.close();
    }
    #[tokio::test(start_paused = true)]
    async fn bulk_failed_destroy_keeps_deletion_and_cleanup_only_retries() {
        let events = Arc::new(Events::default());
        let state = AppState::default();
        let (session, _) =
            state.session_or_create("w1", || Session::spawn(events, SessionDeps::default()));
        let a = native(&session, "A").await;
        let d = FakeDesktop::default();
        let label = poll_window_label("w1", a);
        d.insert(&label, Rect::new(0, 0, 900, 640));
        let hook = DevFailHook::default();
        hook.arm(DevWindowOp::BulkDestroy, "destroy failed".into());
        let injected = BulkDesktop {
            desktop: &d,
            hook: &hook,
        };
        let p = session
            .prepare_poll_bulk(PollBulkAction::Delete, vec![a])
            .await
            .unwrap();
        let result = execute_with(
            &injected,
            &session,
            "w1",
            p.plan_token.clone(),
            PollBulkAction::Delete,
        )
        .await
        .unwrap();
        assert!(result.polls.is_empty());
        assert_eq!(result.issues.len(), 1);
        assert!(d.exists(&label));
        assert_eq!(result.issues[0].stage, PollBulkWindowStage::Destroy);
        assert_eq!(
            result.issues[0].recovery,
            PollBulkRecovery::RetryWindowCleanup
        );
        assert!(session.rename_poll(a, "Gone".into()).await.is_err());
        assert_eq!(
            state.session(&label).err().unwrap().0.code,
            AppErrorCode::PollNotFound
        );

        let r = recover_with(&d, &session, "w1", p.plan_token.clone())
            .await
            .unwrap();
        assert!(r.issues.is_empty());
        assert!(!d.exists(&label));
        assert_eq!(r.removed_ids, [a]);
        assert!(recover_with(&d, &session, "w1", p.plan_token)
            .await
            .unwrap()
            .polls
            .is_empty());
        session.close();
    }
    #[tokio::test(start_paused = true)]
    async fn bulk_partial_place_or_show_failure_keeps_definition_and_retry_placement() {
        for fail_place in [true, false] {
            let events = Arc::new(Events::default());
            let session = Arc::new(Session::spawn(events, SessionDeps::default()));
            let a = native(&session, "A").await;
            let d = FakeDesktop {
                monitors: vec![crate::desktop::MonitorGeom {
                    name: "Display".into(),
                    primary: true,
                    work_area: Rect::new(0, 0, 1920, 1080),
                    scale: 1.0,
                }],
                ..Default::default()
            };
            d.insert("w1", Rect::new(0, 0, 1000, 800));
            d.insert(&poll_window_label("w1", a), Rect::new(100, 100, 900, 640));
            let hook = DevFailHook::default();
            hook.arm(
                if fail_place {
                    DevWindowOp::BulkPlace
                } else {
                    DevWindowOp::BulkShow
                },
                "native failure".into(),
            );
            let injected = BulkDesktop {
                desktop: &d,
                hook: &hook,
            };
            let p = session
                .prepare_poll_bulk(PollBulkAction::Duplicate, vec![a])
                .await
                .unwrap();
            let r = execute_with(
                &injected,
                &session,
                "w1",
                p.plan_token.clone(),
                PollBulkAction::Duplicate,
            )
            .await
            .unwrap();
            let copy = r.created[0].poll_id;
            assert_eq!(r.polls.len(), 2);
            assert!(!r.polls[1].open);
            assert_eq!(r.issues.len(), 1);
            assert_eq!(
                r.issues[0].stage,
                if fail_place {
                    PollBulkWindowStage::Create
                } else {
                    PollBulkWindowStage::Show
                }
            );
            assert_eq!(r.issues[0].recovery, PollBulkRecovery::ShowPoll);
            assert!(!d.exists(&poll_window_label("w1", copy)));
            assert!(session.hosts().await.unwrap()[1].native.is_some());

            poll_windows::show(&d, &session, "w1", copy, None)
                .await
                .unwrap();
            assert!(recover_with(&d, &session, "w1", p.plan_token)
                .await
                .unwrap()
                .issues
                .is_empty());
            session.close();
        }
    }
}
