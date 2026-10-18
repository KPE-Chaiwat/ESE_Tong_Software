//! Atomic definition transactions and view readiness leases for bulk actions.
use super::*;
use shared_types::{
    BulkOperationPrepare, BulkOperationRelease, PollBulkAction, PollBulkCreated, PollBulkPlan,
    PollBulkResult, PollBulkWindowIssue, PollConfig,
};

#[derive(Clone, PartialEq)]
pub(super) struct Guard {
    config: PollConfig,
    host: PollHostKind,
    open: bool,
    dirty: bool,
    view: Option<ViewToken>,
    native_generation: u64,
}
fn guard(p: &PollEntry) -> Guard {
    Guard {
        config: p.config(),
        host: p.host,
        open: p.open,
        dirty: p.has_unapplied_edits,
        view: p.view.as_ref().map(|v| v.token),
        native_generation: p.native_generation,
    }
}
#[derive(Default)]
pub(super) struct BulkState {
    serial: u64,
    revisions: HashMap<PollId, u64>,
    order_revision: u64,
    plan: Option<Plan>,
    pub(super) reservation: Option<Reservation>,
    pub(super) list_pending: bool,
    records: VecDeque<PollBulkResult>,
}
struct Plan {
    dto: PollBulkPlan,
    guards: Vec<(PollId, u64, Guard)>,
    order_revision: u64,
}
pub(super) struct Reservation {
    plan: Plan,
    ready: HashMap<PollId, bool>,
    failed: bool,
    committed: Option<PollBulkResult>,
}

/// Releases readiness on cancellation, including a dropped IPC future.
pub struct BulkLease {
    tx: mpsc::UnboundedSender<Command>,
    token: String,
}
impl Drop for BulkLease {
    fn drop(&mut self) {
        let token = self.token.clone();
        let _ = self
            .tx
            .send(Command::Call(Box::new(move |a| a.release_bulk(&token))));
    }
}

enum BulkBegin {
    Recorded(PollBulkResult),
    Pending,
    Reserved(BulkLease),
}

impl Session {
    /// Freezes the ordered selected definitions for a later atomic operation.
    /// # Errors
    /// Invalid input, stale ids, capacity or a conflicting transaction.
    pub async fn prepare_poll_bulk(
        &self,
        action: PollBulkAction,
        ids: Vec<PollId>,
    ) -> Result<PollBulkPlan, SessionError> {
        self.try_call(move |a| a.prepare_bulk(action, ids)).await
    }
    /// Obtains readiness and commits all definitions in one actor turn. The lease must
    /// survive native reconciliation; dropping it always releases views.
    /// # Errors
    /// Stale plan, refused/missing readiness or session teardown, before any commit.
    pub async fn execute_poll_bulk(
        &self,
        token: String,
        action: PollBulkAction,
    ) -> Result<(PollBulkResult, Option<BulkLease>), SessionError> {
        let lease = loop {
            let key = token.clone();
            let tx = self.tx.clone();
            let begin = self
                .call(move |a| {
                    if let Some(r) = a.bulk.records.iter().find(|r| r.operation_token == key) {
                        if r.action != action {
                            return Err(bulk_conflict());
                        }
                        return Ok(BulkBegin::Recorded(r.clone()));
                    }
                    if let Some(r) = &a.bulk.reservation {
                        if r.plan.dto.plan_token == key && r.plan.dto.action == action {
                            return Ok(BulkBegin::Pending);
                        }
                    }
                    a.reserve_bulk(&key, action)?;
                    Ok(BulkBegin::Reserved(BulkLease { tx, token: key }))
                })
                .await??;
            match begin {
                BulkBegin::Recorded(r) => return Ok((r, None)),
                BulkBegin::Reserved(lease) => break lease,
                BulkBegin::Pending => tokio::time::sleep(Duration::from_millis(10)).await,
            }
        };
        let until = Instant::now() + Duration::from_secs(1);
        loop {
            let key = token.clone();
            match self.call(move |a| a.bulk_ready(&key)).await? {
                Ok(true) => break,
                Ok(false) if Instant::now() < until => {
                    tokio::time::sleep(Duration::from_millis(10)).await
                }
                Ok(false) => return Err(lifecycle_error()),
                Err(e) => return Err(e),
            }
        }
        let key = token;
        let result = self.call(move |a| a.commit_bulk(&key)).await??;
        Ok((result, Some(lease)))
    }
    /// Acknowledge only the current attachment, from its own host.
    /// # Errors
    /// A stale operation or attachment cannot acknowledge readiness.
    pub async fn ack_poll_bulk_ready(
        &self,
        token: String,
        id: PollId,
        view: ViewToken,
        host: PollHostKind,
        ready: bool,
    ) -> Result<(), SessionError> {
        self.call(move |a| {
            let p = a.poll(id).ok_or(SessionError::PollNotFound(id))?;
            if !p
                .view
                .as_ref()
                .is_some_and(|v| v.token == view && v.host == host)
            {
                return Err(bulk_conflict());
            }
            let r = a
                .bulk
                .reservation
                .as_mut()
                .filter(|r| r.plan.dto.plan_token == token)
                .ok_or_else(bulk_conflict)?;
            if !r.ready.contains_key(&id) {
                return Err(bulk_conflict());
            }
            if !ready {
                r.failed = true;
            }
            r.ready.insert(id, ready);
            Ok(())
        })
        .await?
    }
    /// Publish exactly one final list after native reconciliation.
    /// # Errors
    /// Session teardown or unknown token.
    pub async fn finish_poll_bulk(
        &self,
        token: String,
        issues: Vec<PollBulkWindowIssue>,
    ) -> Result<PollBulkResult, SessionError> {
        self.finish_poll_bulk_with_placements(token, issues, Vec::new())
            .await
    }
    /// Finish native reconciliation and save retry placements in the same actor turn.
    /// # Errors
    /// Session teardown or unknown token.
    pub async fn finish_poll_bulk_with_placements(
        &self,
        token: String,
        issues: Vec<PollBulkWindowIssue>,
        placements: Vec<(PollId, WindowPlacement)>,
    ) -> Result<PollBulkResult, SessionError> {
        self.call(move |a| {
            let r = a
                .bulk
                .reservation
                .as_mut()
                .filter(|r| r.plan.dto.plan_token == token)
                .ok_or_else(bulk_conflict)?;
            let result = r.committed.as_mut().ok_or_else(bulk_conflict)?;
            result.issues = issues;
            let created: Vec<_> = result.created.iter().map(|c| c.poll_id).collect();
            for (id, placement) in placements {
                if created.contains(&id) && placement.is_valid() {
                    if let Some(p) = a.poll_mut(id) {
                        p.native = Some(placement);
                    }
                }
            }
            a.release_bulk(&token);
            a.bulk
                .records
                .iter()
                .find(|r| r.operation_token == token)
                .cloned()
                .ok_or_else(bulk_conflict)
        })
        .await?
    }
    /// Retrieve a committed operation for cleanup without replaying it.
    /// # Errors
    /// Unknown/expired operation token.
    pub async fn poll_bulk_record(&self, token: String) -> Result<PollBulkResult, SessionError> {
        self.call(move |a| {
            let mut r = a
                .bulk
                .records
                .iter()
                .find(|r| r.operation_token == token)
                .cloned()
                .ok_or_else(bulk_conflict)?;
            r.polls = a.polls.iter().map(PollEntry::summary).collect();
            Ok(r)
        })
        .await?
    }
    /// Record the remaining cleanup issues, without modifying definitions.
    /// # Errors
    /// Unknown operation token.
    pub async fn update_poll_bulk_record(
        &self,
        token: String,
        issues: Vec<PollBulkWindowIssue>,
    ) -> Result<PollBulkResult, SessionError> {
        self.call(move |a| {
            let polls = a.polls.iter().map(PollEntry::summary).collect();
            let r = a
                .bulk
                .records
                .iter_mut()
                .find(|r| r.operation_token == token)
                .ok_or_else(bulk_conflict)?;
            r.issues = issues;
            r.polls = polls;
            Ok(r.clone())
        })
        .await?
    }
}
fn bulk_conflict() -> SessionError {
    SessionError::InvalidState(
        "The bulk operation is no longer available or another operation is in progress.".into(),
    )
}
fn stale() -> SessionError {
    invalid(
        "pollIds",
        "The selected polls changed. Review your selection and try again.",
    )
}
fn lifecycle_error() -> SessionError {
    invalid(
        "lifecycle",
        "Close dialogs in the selected poll windows and try again.",
    )
}

impl Actor {
    pub(super) fn observe_bulk_change(&mut self, before: Vec<(PollId, Guard)>) {
        let order: Vec<_> = before.iter().map(|(id, _)| *id).collect();
        if order != self.polls.iter().map(|p| p.id).collect::<Vec<_>>() {
            self.bulk.order_revision += 1;
        }
        for p in &self.polls {
            if before
                .iter()
                .find(|(id, _)| *id == p.id)
                .is_none_or(|(_, old)| *old != guard(p))
            {
                *self.bulk.revisions.entry(p.id).or_default() += 1;
            }
        }
        self.bulk
            .revisions
            .retain(|id, _| self.polls.iter().any(|p| p.id == *id));
    }
    pub(super) fn bulk_guards(&self) -> Vec<(PollId, Guard)> {
        self.polls.iter().map(|p| (p.id, guard(p))).collect()
    }
    pub(super) fn bulk_can_attach(&self, id: PollId) -> bool {
        self.bulk.reservation.as_ref().is_none_or(|r| {
            r.committed
                .as_ref()
                .is_some_and(|result| result.created.iter().any(|c| c.poll_id == id))
        })
    }
    pub(super) fn check_bulk_idle(&self) -> Result<(), SessionError> {
        if self.bulk.reservation.is_some() {
            Err(bulk_conflict())
        } else {
            Ok(())
        }
    }
    fn capacity(&self, n: usize) -> Result<(), SessionError> {
        let available = MAX_POLLS.saturating_sub(self.polls.len());
        if n > available {
            return Err(invalid("polls", format!("Cannot duplicate {n} polls. This connection has room for {available} more (maximum 16).")));
        }
        Ok(())
    }
    fn prepare_bulk(
        &mut self,
        action: PollBulkAction,
        ids: Vec<PollId>,
    ) -> Result<PollBulkPlan, SessionError> {
        self.check_bulk_idle()?;
        let unique: std::collections::HashSet<_> = ids.iter().copied().collect();
        if ids.is_empty() || unique.len() != ids.len() {
            return Err(invalid("pollIds", "Select distinct polls."));
        }
        for id in &ids {
            if self.poll(*id).is_none() {
                return Err(SessionError::PollNotFound(*id));
            }
        }
        if action == PollBulkAction::Duplicate {
            self.capacity(ids.len())?;
        }
        self.bulk.serial += 1;
        let targets: Vec<_> = self
            .polls
            .iter()
            .filter(|p| unique.contains(&p.id))
            .collect();
        let dto = PollBulkPlan {
            plan_token: format!("bulk-{}", self.bulk.serial),
            action,
            targets: targets.iter().map(|p| p.summary()).collect(),
            available: MAX_POLLS - self.polls.len(),
        };
        let guards = targets
            .iter()
            .map(|p| {
                (
                    p.id,
                    *self.bulk.revisions.get(&p.id).unwrap_or(&0),
                    guard(p),
                )
            })
            .collect();
        self.bulk.plan = Some(Plan {
            dto: dto.clone(),
            guards,
            order_revision: self.bulk.order_revision,
        });
        Ok(dto)
    }
    fn validate_plan(&self, plan: &Plan) -> Result<(), SessionError> {
        if plan.order_revision != self.bulk.order_revision {
            return Err(stale());
        }
        for (id, revision, expected) in &plan.guards {
            let p = self.poll(*id).ok_or_else(stale)?;
            if *revision != *self.bulk.revisions.get(id).unwrap_or(&0) || guard(p) != *expected {
                return Err(stale());
            }
        }
        if plan.dto.action == PollBulkAction::Duplicate {
            self.capacity(plan.guards.len())?;
        }
        Ok(())
    }
    fn reserve_bulk(&mut self, token: &str, action: PollBulkAction) -> Result<(), SessionError> {
        self.check_bulk_idle()?;
        let plan = self.bulk.plan.take().ok_or_else(bulk_conflict)?;
        if plan.dto.plan_token != token || plan.dto.action != action {
            return Err(bulk_conflict());
        }
        self.validate_plan(&plan)?;
        let mut ready = HashMap::new();
        for (id, _, _) in &plan.guards {
            let p = self.poll(*id).ok_or_else(stale)?;
            if self.pending_handoff.contains_key(id)
                || (p.open && p.host == PollHostKind::Native && p.view.is_none())
            {
                return Err(lifecycle_error());
            }
            if p.view.is_some() {
                ready.insert(*id, false);
            }
        }
        let ids: Vec<_> = ready.keys().copied().collect();
        self.bulk.reservation = Some(Reservation {
            plan,
            ready,
            failed: false,
            committed: None,
        });
        for id in ids {
            self.view_send(
                id,
                PollViewEvent::BulkOperationPrepare(BulkOperationPrepare {
                    operation_token: token.into(),
                    action,
                }),
            );
        }
        Ok(())
    }
    fn bulk_ready(&self, token: &str) -> Result<bool, SessionError> {
        let r = self
            .bulk
            .reservation
            .as_ref()
            .filter(|r| r.plan.dto.plan_token == token)
            .ok_or_else(bulk_conflict)?;
        self.validate_plan(&r.plan)?;
        if r.failed {
            return Err(lifecycle_error());
        }
        Ok(r.ready.values().all(|v| *v))
    }
    fn commit_bulk(&mut self, token: &str) -> Result<PollBulkResult, SessionError> {
        if !self.bulk_ready(token)? {
            return Err(lifecycle_error());
        }
        let reservation = self.bulk.reservation.as_ref().ok_or_else(bulk_conflict)?;
        let action = reservation.plan.dto.action;
        let ids: Vec<_> = reservation
            .plan
            .guards
            .iter()
            .map(|(id, _, _)| *id)
            .collect();
        let mut result = PollBulkResult {
            operation_token: token.into(),
            action,
            definitions_committed: true,
            created: Vec::new(),
            removed_ids: Vec::new(),
            polls: Vec::new(),
            issues: Vec::new(),
        };
        if action == PollBulkAction::Duplicate {
            let index = self
                .polls
                .iter()
                .rposition(|p| ids.contains(&p.id))
                .ok_or_else(stale)?
                + 1;
            let mut names: Vec<String> = self.polls.iter().map(|p| p.name.clone()).collect();
            let mut entries = Vec::new();
            for source_id in ids {
                let src = self.poll(source_id).ok_or_else(stale)?;
                let name = copy_name(
                    &src.name,
                    &names.iter().map(String::as_str).collect::<Vec<_>>(),
                );
                names.push(name.clone());
                let input = PollConfigInput {
                    name,
                    definition: src.definition.clone(),
                    display: src.display.clone(),
                    color_rules: src.color_rules.clone(),
                    scale: src.scale.clone(),
                    scale_overrides: src.scale_overrides.clone(),
                    value_columns: src.value_columns,
                    aliases: src.aliases.clone(),
                };
                let host = if src.open {
                    src.host
                } else {
                    PollHostKind::Workspace
                };
                let native = src.native.clone();
                let request = validate_poll(&input.definition, self.is_rtu()).ok();
                let id = self.new_poll_id();
                let mut entry = self.entry(
                    id,
                    input,
                    self.auto_start_poll,
                    self.conn.is_connected(),
                    request,
                    host,
                );
                entry.native = native;
                entries.push(entry);
                result.created.push(PollBulkCreated {
                    source_id,
                    poll_id: id,
                });
            }
            for entry in &entries {
                self.scheduler
                    .insert(entry.id, entry.scan(), Instant::now());
                if entry.request.is_some() {
                    self.scheduler.set_running(entry.id, true, Instant::now());
                }
            }
            self.polls.splice(index..index, entries);
        } else {
            // Membership is already validated; removal and terminal events share this turn.
            for id in ids {
                self.remove_poll(id)?;
                result.removed_ids.push(id);
            }
        }
        result.polls = self.polls.iter().map(PollEntry::summary).collect();
        let mut pending = result.clone();
        for created in &result.created {
            if self
                .poll(created.poll_id)
                .is_some_and(|p| p.host == PollHostKind::Native)
            {
                pending
                    .issues
                    .push(interrupted_issue(created.poll_id, false));
            }
        }
        for id in &result.removed_ids {
            pending.issues.push(interrupted_issue(*id, true));
        }
        self.bulk
            .reservation
            .as_mut()
            .ok_or_else(bulk_conflict)?
            .committed = Some(pending);
        Ok(result)
    }
    fn release_bulk(&mut self, token: &str) {
        if self
            .bulk
            .reservation
            .as_ref()
            .is_none_or(|r| r.plan.dto.plan_token != token)
        {
            return;
        }
        let Some(r) = self.bulk.reservation.take() else {
            return;
        };
        let list_pending = std::mem::take(&mut self.bulk.list_pending);
        for (id, _, _) in r.plan.guards {
            self.view_send(
                id,
                PollViewEvent::BulkOperationRelease(BulkOperationRelease {
                    operation_token: token.into(),
                }),
            );
        }
        if let Some(mut result) = r.committed {
            for issue in &result.issues {
                if issue.recovery == shared_types::PollBulkRecovery::ShowPoll {
                    if let Some(p) = self.poll_mut(issue.poll_id) {
                        p.open = false;
                        if let Some(mut v) = p.view.take() {
                            v.emitter
                                .close_with(PollViewEvent::ViewDetached(ViewDetached {
                                    poll_id: issue.poll_id,
                                    reason: DetachReason::Closed,
                                }));
                        }
                    }
                }
            }
            result.polls = self.polls.iter().map(PollEntry::summary).collect();
            self.emit_list();
            self.bulk.records.push_back(result);
            if self.bulk.records.len() > 16 {
                self.bulk.records.pop_front();
            }
        } else if list_pending {
            // An external window may have disappeared while readiness was pending.
            self.emit_list();
        }
    }
}

fn interrupted_issue(id: PollId, deleted: bool) -> PollBulkWindowIssue {
    PollBulkWindowIssue {
        poll_id: id,
        stage: if deleted {
            shared_types::PollBulkWindowStage::Destroy
        } else {
            shared_types::PollBulkWindowStage::Create
        },
        code: shared_types::PollBulkIssueCode::Internal,
        message: "Window reconciliation was interrupted. Recover the poll window.".into(),
        recovery: if deleted {
            shared_types::PollBulkRecovery::RetryWindowCleanup
        } else {
            shared_types::PollBulkRecovery::ShowPoll
        },
    }
}
