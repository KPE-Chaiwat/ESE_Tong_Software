//! BE-004 transaction, stale-confirmation and readiness regression tests.
mod common;
use common::*;
use shared_types::{
    PollBulkAction as A, PollHostKind as H, PollId, PollViewEvent, SessionEvent, ViewToken,
};
use std::{sync::Arc, time::Duration};

async fn add(f: &Fixture, name: &str) -> PollId {
    f.session
        .add_poll(input(name, def(1, 0, 2, 100)), H::Workspace)
        .await
        .unwrap()
}
fn lists(f: &Fixture) -> usize {
    f.rec
        .events()
        .iter()
        .filter(|e| matches!(e, SessionEvent::PollListChanged(_)))
        .count()
}

#[tokio::test(start_paused = true)]
async fn bulk_duplicate_order_atomic_list_and_idempotent_token() {
    let f = fixture();
    let a = add(&f, "A").await;
    add(&f, "B").await;
    let c = add(&f, "C").await;
    add(&f, "D").await;
    let plan = f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![c, a])
        .await
        .unwrap();
    assert_eq!(
        plan.targets
            .iter()
            .map(|p| p.config.poll_id)
            .collect::<Vec<_>>(),
        [a, c]
    );
    f.rec.clear();
    let (r, lease) = f
        .session
        .execute_poll_bulk(plan.plan_token.clone(), A::Duplicate)
        .await
        .unwrap();
    assert_eq!(lists(&f), 0);
    assert_eq!(
        r.polls
            .iter()
            .map(|p| p.config.name.as_str())
            .collect::<Vec<_>>(),
        ["A", "B", "C", "A copy", "C copy", "D"]
    );
    assert_eq!(
        r.created.iter().map(|p| p.source_id).collect::<Vec<_>>(),
        [a, c]
    );
    let final_result = f
        .session
        .finish_poll_bulk(plan.plan_token.clone(), vec![])
        .await
        .unwrap();
    drop(lease);
    assert_eq!(lists(&f), 1);
    let (again, lease) = f
        .session
        .execute_poll_bulk(plan.plan_token, A::Duplicate)
        .await
        .unwrap();
    assert!(lease.is_none());
    assert_eq!(again, final_result);
    assert_eq!(lists(&f), 1);
    assert_eq!(f.session.snapshot().await.unwrap().polls.len(), 6);
}
#[tokio::test(start_paused = true)]
async fn bulk_input_capacity_and_last_poll_delete() {
    let f = fixture();
    let a = add(&f, "A").await;
    for ids in [vec![], vec![a, a], vec![a, PollId(999)]] {
        assert!(f
            .session
            .prepare_poll_bulk(A::Duplicate, ids)
            .await
            .is_err());
    }
    for n in 1..15 {
        add(&f, &format!("P{n}")).await;
    }
    let snapshot = f.session.snapshot().await.unwrap();
    assert!(f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![a, snapshot.polls[1].config.poll_id])
        .await
        .is_err());
    let p = f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![a])
        .await
        .unwrap();
    let (_, lease) = f
        .session
        .execute_poll_bulk(p.plan_token.clone(), A::Duplicate)
        .await
        .unwrap();
    let result = f
        .session
        .finish_poll_bulk(p.plan_token, vec![])
        .await
        .unwrap();
    drop(lease);
    assert_eq!(result.polls.len(), 16);
    let p = f
        .session
        .prepare_poll_bulk(
            A::Delete,
            result.polls.iter().map(|p| p.config.poll_id).collect(),
        )
        .await
        .unwrap();
    f.rec.clear();
    let (_, lease) = f
        .session
        .execute_poll_bulk(p.plan_token.clone(), A::Delete)
        .await
        .unwrap();
    let result = f
        .session
        .finish_poll_bulk(p.plan_token, vec![])
        .await
        .unwrap();
    drop(lease);
    assert!(result.polls.is_empty());
    assert_eq!(lists(&f), 1);
    assert!(f.session.snapshot().await.is_ok());
}
#[tokio::test(start_paused = true)]
async fn bulk_confirmation_detects_aba_but_not_counters() {
    let f = fixture();
    let a = add(&f, "A").await;
    let p = f
        .session
        .prepare_poll_bulk(A::Delete, vec![a])
        .await
        .unwrap();
    f.session.rename_poll(a, "B".into()).await.unwrap();
    f.session.rename_poll(a, "A".into()).await.unwrap();
    let e = f
        .session
        .execute_poll_bulk(p.plan_token, A::Delete)
        .await
        .err()
        .unwrap();
    assert_eq!(
        e.to_string(),
        "The selected polls changed. Review your selection and try again."
    );
    let p = f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![a])
        .await
        .unwrap();
    f.session.reset_counters(None).await.unwrap();
    let (_, lease) = f
        .session
        .execute_poll_bulk(p.plan_token.clone(), A::Duplicate)
        .await
        .unwrap();
    f.session
        .finish_poll_bulk(p.plan_token, vec![])
        .await
        .unwrap();
    drop(lease);
}
#[tokio::test(start_paused = true)]
async fn bulk_readiness_timeout_releases_all_and_does_not_mutate() {
    let f = fixture();
    let a = add(&f, "A").await;
    let view = f.view(a).await;
    let p = f
        .session
        .prepare_poll_bulk(A::Delete, vec![a])
        .await
        .unwrap();
    assert!(f
        .session
        .execute_poll_bulk(p.plan_token, A::Delete)
        .await
        .is_err());
    assert_eq!(f.session.snapshot().await.unwrap().polls.len(), 1);
    assert!(view
        .events()
        .iter()
        .any(|e| matches!(e, PollViewEvent::BulkOperationRelease(_))));
    f.session.rename_poll(a, "Recovered".into()).await.unwrap();
}
#[tokio::test(start_paused = true)]
async fn bulk_readiness_ack_identity_and_conflicting_mutation() {
    let f = fixture();
    let a = add(&f, "A").await;
    let view = Arc::new(ViewRec::default());
    let attached = f
        .session
        .attach_view(a, H::Workspace, view.clone())
        .await
        .unwrap();
    let p = f
        .session
        .prepare_poll_bulk(A::Delete, vec![a])
        .await
        .unwrap();
    let execution = f.session.execute_poll_bulk(p.plan_token.clone(), A::Delete);
    let acknowledger = async {
        wait_until(Duration::from_millis(100), "prepare", || {
            view.events()
                .iter()
                .any(|e| matches!(e, PollViewEvent::BulkOperationPrepare(_)))
        })
        .await;
        assert!(f.session.rename_poll(a, "Changed".into()).await.is_err());
        assert!(f
            .session
            .ack_poll_bulk_ready(p.plan_token.clone(), a, ViewToken(999), H::Workspace, true)
            .await
            .is_err());
        f.session
            .ack_poll_bulk_ready(
                p.plan_token.clone(),
                a,
                attached.view_token,
                H::Workspace,
                true,
            )
            .await
            .unwrap();
    };
    let (result, ()) = tokio::join!(execution, acknowledger);
    let (_, lease) = result.unwrap();
    let r = f
        .session
        .finish_poll_bulk(p.plan_token, vec![])
        .await
        .unwrap();
    drop(lease);
    assert_eq!(r.removed_ids, [a]);
    assert!(matches!(
        view.events().last(),
        Some(PollViewEvent::PollRemoved(_))
    ));
}
#[tokio::test(start_paused = true)]
async fn bulk_cancelled_future_unlocks_views() {
    let f = fixture();
    let a = add(&f, "A").await;
    let view = f.view(a).await;
    let p = f
        .session
        .prepare_poll_bulk(A::Delete, vec![a])
        .await
        .unwrap();
    let execution = f.session.execute_poll_bulk(p.plan_token, A::Delete);
    tokio::select! { _ = execution => panic!("must wait for readiness"), () = tokio::time::sleep(Duration::from_millis(20)) => {} }
    f.session.rename_poll(a, "Unlocked".into()).await.unwrap();
    assert!(view
        .events()
        .iter()
        .any(|e| matches!(e, PollViewEvent::BulkOperationRelease(_))));
}
#[tokio::test(start_paused = true)]
async fn bulk_unattached_native_rejected_before_commit() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", def(1, 0, 1, 100)), H::Native)
        .await
        .unwrap();
    let p = f
        .session
        .prepare_poll_bulk(A::Delete, vec![a])
        .await
        .unwrap();
    assert!(f
        .session
        .execute_poll_bulk(p.plan_token, A::Delete)
        .await
        .is_err());
    assert_eq!(f.session.snapshot().await.unwrap().polls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn bulk_copy_preserves_applied_settings_not_runtime_or_drafts() {
    use shared_types::{
        AliasEntry, FormatOverride, PollState, PollViewSettings, ValueColorComparison,
        ValueColorHighlight, ValueColorRule, ValueColorSource, ValueFormat,
    };
    let f = fixture();
    f.connected(tcp_config(502, 100)).await;
    f.session.set_auto_start_poll(true).await.unwrap();
    let mut cfg = input("A", def(1, 0, 4, 100));
    cfg.format_overrides = vec![FormatOverride {
        start: 0,
        end: 3,
        format: ValueFormat::Unsigned64,
        swap_bytes: true,
        reverse_words: true,
    }];
    cfg.aliases = vec![AliasEntry {
        address: 0,
        alias: "Applied alias".into(),
    }];
    cfg.color_rules = vec![ValueColorRule {
        name: "Exact".into(),
        enabled: true,
        source: ValueColorSource::Raw,
        comparison: ValueColorComparison::GreaterThan,
        threshold: "18446744073709551614".into(),
        upper_threshold: None,
        range: None,
        highlight: ValueColorHighlight::Lime,
        colors: None,
    }];
    let a = f.session.add_poll(cfg.clone(), H::Workspace).await.unwrap();
    f.session
        .set_poll_view(
            a,
            PollViewSettings {
                has_unapplied_edits: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    let p = f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![a])
        .await
        .unwrap();
    let (r, lease) = f
        .session
        .execute_poll_bulk(p.plan_token.clone(), A::Duplicate)
        .await
        .unwrap();
    let copy = &r.polls[1];
    assert_eq!(copy.config.display, cfg.display);
    assert_eq!(copy.config.format_overrides, cfg.format_overrides);
    assert_eq!(copy.config.aliases, cfg.aliases);
    assert_eq!(copy.config.color_rules, cfg.color_rules);
    assert!(!copy.has_unapplied_edits);
    assert_eq!(copy.counters.counters.requests, 0);
    assert_eq!(copy.status.state, PollState::Polling);
    f.session
        .finish_poll_bulk(p.plan_token, vec![])
        .await
        .unwrap();
    drop(lease);
}

#[tokio::test(start_paused = true)]
async fn bulk_parallel_same_token_waits_for_original_result() {
    let f = fixture();
    let a = add(&f, "A").await;
    let p = f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![a])
        .await
        .unwrap();
    let (first, lease) = f
        .session
        .execute_poll_bulk(p.plan_token.clone(), A::Duplicate)
        .await
        .unwrap();
    let retry = f
        .session
        .execute_poll_bulk(p.plan_token.clone(), A::Duplicate);
    let finish = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        f.session
            .finish_poll_bulk(p.plan_token.clone(), vec![])
            .await
            .unwrap()
    };
    let (retry, finished) = tokio::join!(retry, finish);
    drop(lease);
    let (retry, retry_lease) = retry.unwrap();
    assert!(retry_lease.is_none());
    assert_eq!(retry, finished);
    assert_eq!(retry.created, first.created);
}

#[tokio::test(start_paused = true)]
async fn bulk_copy_name_unicode_limit_and_case_collisions() {
    let f = fixture();
    let a = add(&f, "A").await;
    add(&f, "A copy").await;
    add(&f, "a COPY 2").await;
    let long = add(&f, &"ก".repeat(48)).await;
    let p = f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![long, a])
        .await
        .unwrap();
    let (r, lease) = f
        .session
        .execute_poll_bulk(p.plan_token.clone(), A::Duplicate)
        .await
        .unwrap();
    assert_eq!(r.polls[4].config.name, "A copy 3");
    assert!(r.polls[5].config.name.chars().count() <= 48);
    f.session
        .finish_poll_bulk(p.plan_token, vec![])
        .await
        .unwrap();
    drop(lease);
}

#[tokio::test(start_paused = true)]
async fn bulk_refusal_and_detach_after_ack_abort_all_definitions() {
    for ready in [false, true] {
        let f = fixture();
        let a = add(&f, "A").await;
        let b = add(&f, "B").await;
        let view = Arc::new(ViewRec::default());
        let attached = f
            .session
            .attach_view(a, H::Workspace, view.clone())
            .await
            .unwrap();
        let p = f
            .session
            .prepare_poll_bulk(A::Delete, vec![a, b])
            .await
            .unwrap();
        f.rec.clear();
        let execution = f.session.execute_poll_bulk(p.plan_token.clone(), A::Delete);
        let responder = async {
            wait_until(Duration::from_millis(100), "prepare", || {
                view.events()
                    .iter()
                    .any(|e| matches!(e, PollViewEvent::BulkOperationPrepare(_)))
            })
            .await;
            f.session
                .ack_poll_bulk_ready(
                    p.plan_token.clone(),
                    a,
                    attached.view_token,
                    H::Workspace,
                    ready,
                )
                .await
                .unwrap();
            if ready {
                f.session.detach_view(a, attached.view_token).await.unwrap();
            }
        };
        let (result, ()) = tokio::join!(execution, responder);
        assert!(result.is_err());
        assert_eq!(f.session.snapshot().await.unwrap().polls.len(), 2);
        assert_eq!(lists(&f), 0);
        f.session.rename_poll(b, "Unlocked".into()).await.unwrap();
    }
}

#[tokio::test(start_paused = true)]
async fn bulk_dropped_postcommit_lease_records_result_without_repeating_mutation() {
    let f = fixture();
    let a = add(&f, "A").await;
    let p = f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![a])
        .await
        .unwrap();
    f.rec.clear();
    let (r, lease) = f
        .session
        .execute_poll_bulk(p.plan_token.clone(), A::Duplicate)
        .await
        .unwrap();
    drop(lease);
    let (again, lease) = f
        .session
        .execute_poll_bulk(p.plan_token, A::Duplicate)
        .await
        .unwrap();
    assert!(lease.is_none());
    assert_eq!(again.created, r.created);
    assert_eq!(again.polls.len(), 2);
    assert_eq!(lists(&f), 1);
}

#[tokio::test(start_paused = true)]
async fn bulk_delayed_old_native_destroy_cannot_close_recovered_route() {
    let f = fixture();
    let id = f
        .session
        .add_poll(input("Native", def(1, 0, 2, 100)), H::Native)
        .await
        .unwrap();
    let old_generation = f.session.native_generation(id).unwrap();
    f.session
        .native_incarnation_destroyed(id, old_generation)
        .await
        .unwrap();
    assert!(!f.session.hosts().await.unwrap()[0].open);
    f.session.begin_native_open(id, None).await.unwrap();
    let new_generation = f.session.native_generation(id).unwrap();
    assert_ne!(old_generation, new_generation);
    let view = Arc::new(ViewRec::default());
    let attached = f
        .session
        .attach_view(id, H::Native, view.clone())
        .await
        .unwrap();
    let plan = f
        .session
        .prepare_poll_bulk(A::Duplicate, vec![id])
        .await
        .unwrap();
    f.rec.clear();
    // The old callback was scheduled before Show but delivered only after its new attach.
    f.session
        .native_incarnation_destroyed(id, old_generation)
        .await
        .unwrap();
    assert!(f.session.hosts().await.unwrap()[0].open);
    assert_eq!(f.session.stats().await.unwrap().attached_views, 1);
    assert_eq!(lists(&f), 0);
    let execute = f
        .session
        .execute_poll_bulk(plan.plan_token.clone(), A::Duplicate);
    let acknowledge = async {
        wait_until(Duration::from_millis(100), "new view readiness", || {
            view.events()
                .iter()
                .any(|e| matches!(e, PollViewEvent::BulkOperationPrepare(_)))
        })
        .await;
        f.session
            .ack_poll_bulk_ready(
                plan.plan_token.clone(),
                id,
                attached.view_token,
                H::Native,
                true,
            )
            .await
            .unwrap();
    };
    let (result, ()) = tokio::join!(execute, acknowledge);
    let (_, lease) = result.unwrap();
    f.session
        .finish_poll_bulk(plan.plan_token, vec![])
        .await
        .unwrap();
    drop(lease);
    // Genuine destruction of the replacement still closes it and drops its route.
    f.session
        .native_incarnation_destroyed(id, new_generation)
        .await
        .unwrap();
    assert!(!f.session.hosts().await.unwrap()[0].open);
    assert_eq!(f.session.stats().await.unwrap().attached_views, 0);
}
