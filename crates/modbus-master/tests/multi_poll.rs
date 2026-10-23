//! BE-002: many polls per connection, poll management, view routing and hosting, against an
//! in-process fake slave (slave id 1; other ids get no reply) on a paused Tokio clock.

mod common;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use common::*;
use modbus_master::SessionError;
use shared_types::{
    AliasEntry, ConnectionState as C, DetachReason, PollHostKind as H, PollId, PollState as P,
    PollViewEvent, PollViewSettings, SessionEvent, SubWindowState, TrafficDirection, TrafficFrame,
    TrafficOrigin, WorkspaceLayout, WorkspaceRect, WriteRequest, WriteResult,
};
use transport::fake::Behavior;

fn field(err: SessionError) -> String {
    match err {
        SessionError::Validation(v) => v.field,
        other => panic!("expected a validation error, got {other:?}"),
    }
}

fn origin_poll(frame: &TrafficFrame) -> Option<PollId> {
    match frame.origin {
        Some(TrafficOrigin::Poll { poll_id }) => Some(poll_id),
        _ => None,
    }
}

/// Requests never overlap: when a request is sent, the previous one either got its reply
/// (an RX frame of the same origin between them) or timed out (at least `timeout_ms` later).
fn assert_no_overlap(frames: &[TrafficFrame], timeout_ms: u64) {
    let mut previous_tx: Option<&TrafficFrame> = None;
    let mut answered = true;
    for fr in frames {
        match fr.direction {
            TrafficDirection::Tx => {
                if let Some(prev) = previous_tx {
                    assert!(
                        answered || fr.at - prev.at >= timeout_ms,
                        "request {} sent {} ms after unanswered request {}",
                        fr.seq,
                        fr.at - prev.at,
                        prev.seq
                    );
                }
                previous_tx = Some(fr);
                answered = false;
            }
            TrafficDirection::Rx => {
                if let (Some(prev), Some(_)) = (previous_tx, fr.origin) {
                    assert_eq!(
                        fr.origin, prev.origin,
                        "reply {} belongs to request {}",
                        fr.seq, prev.seq
                    );
                    answered = true;
                }
            }
        }
    }
}

#[tokio::test(start_paused = true)]
async fn sixteen_polls_mixed_rates_no_overlap_no_starvation_one_failing() {
    let f = fixture();
    f.connected(tcp_config(502, 100)).await;
    f.slave
        .set_default(Behavior::Delay(Duration::from_millis(3)));
    let scans = [
        20u32, 50, 100, 100, 100, 200, 250, 500, 500, 1000, 1000, 2000, 30, 70, 150, 5000,
    ];
    let mut ids = Vec::new();
    for (i, scan) in scans.iter().enumerate() {
        // Poll 4 addresses slave 9, which never answers: it times out every cycle.
        let slave = if i == 3 { 9 } else { 1 };
        let start = u16::try_from(i).unwrap() * 10;
        ids.push(
            f.running(&format!("Poll {i}"), def(slave, start, 10, *scan))
                .await,
        );
    }
    tokio::time::sleep(Duration::from_secs(30)).await;
    tokio::time::sleep(Duration::from_millis(100)).await; // last traffic batch

    let frames = f.rec.frames();
    assert_no_overlap(&frames, 100);
    // Every poll was served; the failing one only failed itself.
    let mut served: HashMap<PollId, usize> = HashMap::new();
    for fr in frames
        .iter()
        .filter(|f| f.direction == TrafficDirection::Tx)
    {
        *served.entry(origin_poll(fr).unwrap()).or_default() += 1;
    }
    for (i, id) in ids.iter().enumerate() {
        assert!(
            served.get(id).copied().unwrap_or(0) >= 5,
            "poll {i} starved: {served:?}"
        );
        let expected = if i == 3 { P::Timeout } else { P::Polling };
        assert_eq!(f.rec.last_poll_state(*id), Some(expected), "poll {i}");
    }
    assert_eq!(f.rec.connection_states(), [C::Connecting, C::Connected]);
    // Slow polls keep their rate exactly (the link has room for them).
    let snap = f.session.snapshot().await.unwrap();
    let eff: HashMap<PollId, Option<u32>> = snap
        .counters
        .polls
        .iter()
        .map(|c| (c.poll_id, c.effective_scan_ms))
        .collect();
    let e2000 = eff[&ids[11]].unwrap();
    assert!((2000..2300).contains(&e2000), "{e2000}");
    // The overloaded fast polls are slowed down (shown as "effective").
    let e20 = eff[&ids[0]].unwrap();
    assert!(e20 > 30, "{e20}");
    // Link load is reported.
    assert!(
        snap.counters.link_load_pct >= 90,
        "{}",
        snap.counters.link_load_pct
    );
    // Per-poll counters add up to the total (no writes here).
    let sum: u64 = snap
        .counters
        .polls
        .iter()
        .map(|c| c.counters.requests)
        .sum();
    assert_eq!(sum, snap.counters.total.requests);
}

#[tokio::test(start_paused = true)]
async fn one_poll_failing_others_stay_live() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    let a = f.running("A", def(1, 0, 4, 100)).await;
    let b = f.running("B", def(9, 0, 4, 100)).await; // never answered
    let c = f.running("C", def(1, 100, 4, 100)).await;
    let (va, vb, vc) = (f.view(a).await, f.view(b).await, f.view(c).await);
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(f.rec.last_poll_state(a), Some(P::Polling));
    assert_eq!(f.rec.last_poll_state(b), Some(P::Timeout));
    assert_eq!(f.rec.last_poll_state(c), Some(P::Polling));
    assert!(va.updates().len() > 5 && vc.updates().len() > 5);
    assert!(vb.updates().is_empty());
    // Each view only gets its own poll.
    assert!(va.updates().iter().all(|u| u.poll_id == a));
    assert!(vc
        .updates()
        .iter()
        .all(|u| u.poll_id == c && u.start_address == 100));
    assert!(vb.events().iter().all(|e| match e {
        PollViewEvent::PollStateChanged(s) => s.poll_id == b,
        _ => true,
    }));
    assert_eq!(f.rec.connection_states(), [C::Connecting, C::Connected]);
}

#[tokio::test(start_paused = true)]
async fn per_view_coalescing_and_state_events_are_never_dropped() {
    let f = fixture();
    f.connected(tcp_config(502, 100)).await;
    let a = f.running("A", def(1, 0, 4, 20)).await;
    let va = f.view(a).await;
    va.clear();
    tokio::time::sleep(Duration::from_secs(2)).await;
    let updates = va.updates();
    // 20 ms scan for 2 s = ~100 cycles; at most one update per 50 ms reaches the view.
    assert!(
        updates.len() <= 41 && updates.len() >= 30,
        "{}",
        updates.len()
    );
    assert!(updates.windows(2).all(|w| w[1].seq > w[0].seq));
    assert!(
        updates.windows(2).any(|w| w[1].seq > w[0].seq + 1),
        "coalesced"
    );
    // Failures are all delivered, and the pending update goes first.
    f.slave
        .script([Behavior::Silent, Behavior::Silent, Behavior::Respond]);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let failures: Vec<u32> = va
        .events()
        .into_iter()
        .filter_map(|e| match e {
            PollViewEvent::PollStateChanged(s) => Some(s.consecutive_failures),
            _ => None,
        })
        .collect();
    assert_eq!(failures, [1, 2, 0]);
    let counters = va
        .events()
        .iter()
        .filter(|e| matches!(e, PollViewEvent::PollCounters(_)))
        .count();
    assert!(counters <= 27, "{counters}");
}

#[tokio::test(start_paused = true)]
async fn poll_limit_names_and_duplicate() {
    let f = fixture();
    for i in 0..16 {
        f.session
            .add_poll(input(&format!("Poll {i}"), poll03(1, 1000)), H::Workspace)
            .await
            .unwrap();
    }
    let err = f
        .session
        .add_poll(input("Poll 99", poll03(1, 1000)), H::Workspace)
        .await
        .unwrap_err();
    assert_eq!(field(err.clone()), "polls");
    assert_eq!(err.to_string(), "A connection can have at most 16 polls.");
    let list = f.session.snapshot().await.unwrap().polls;
    assert!(matches!(
        f.session.duplicate_poll(list[0].config.poll_id).await,
        Err(SessionError::Validation(_))
    ));

    let f = fixture();
    let a = f
        .session
        .add_poll(input("Pump", poll03(1, 1000)), H::Workspace)
        .await
        .unwrap();
    let b = f
        .session
        .add_poll(input("Tank", poll03(1, 1000)), H::Native)
        .await
        .unwrap();
    let err = f
        .session
        .add_poll(input("PUMP", poll03(1, 1000)), H::Workspace)
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "A poll named \"PUMP\" already exists on this connection."
    );
    assert_eq!(
        field(f.session.rename_poll(b, "pump".into()).await.unwrap_err()),
        "name"
    );
    f.session.rename_poll(a, "PUMP".into()).await.unwrap(); // own name, other case
    assert_eq!(
        field(f.session.rename_poll(a, " x".into()).await.unwrap_err()),
        "name"
    );
    // Duplicate goes right after the source, keeps the host kind, gets a copy name.
    let d = f.session.duplicate_poll(a).await.unwrap();
    let d2 = f.session.duplicate_poll(a).await.unwrap();
    let dn = f.session.duplicate_poll(b).await.unwrap();
    let list = f.session.snapshot().await.unwrap().polls;
    let names: Vec<(&str, H)> = list
        .iter()
        .map(|p| (p.config.name.as_str(), p.host))
        .collect();
    assert_eq!(
        names,
        [
            ("PUMP", H::Workspace),
            ("PUMP copy 2", H::Workspace),
            ("PUMP copy", H::Workspace),
            ("Tank", H::Native),
            ("Tank copy", H::Native)
        ]
    );
    assert!(d < d2 && d2 < dn, "ids are never reused and increase");
    assert!(f.session.duplicate_poll(PollId(999)).await.is_err());
}

#[tokio::test(start_paused = true)]
async fn reorder_requires_a_permutation_and_never_changes_scheduling() {
    let f = fixture();
    f.connected(tcp_config(502, 100)).await;
    let a = f.running("A", def(1, 0, 2, 100)).await;
    let b = f.running("B", def(1, 10, 2, 100)).await;
    let c = f.running("C", def(1, 20, 2, 100)).await;
    for bad in [vec![a, b], vec![a, b, b], vec![a, b, PollId(77)], vec![]] {
        assert_eq!(
            field(f.session.reorder_polls(bad).await.unwrap_err()),
            "order"
        );
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    let before = f.slave.requests().len();
    f.session.reorder_polls(vec![c, a, b]).await.unwrap();
    let order: Vec<PollId> = f
        .rec
        .last_list()
        .unwrap()
        .iter()
        .map(|p| p.config.poll_id)
        .collect();
    assert_eq!(order, [c, a, b]);
    let counters_order: Vec<PollId> = f
        .session
        .snapshot()
        .await
        .unwrap()
        .counters
        .polls
        .iter()
        .map(|p| p.poll_id)
        .collect();
    assert_eq!(counters_order, [c, a, b]);
    tokio::time::sleep(Duration::from_secs(1)).await;
    // Same rate as before: 3 polls x 10 cycles per second.
    let after = f.slave.requests().len() - before;
    assert!((29..=31).contains(&after), "{after}");
}

#[tokio::test(start_paused = true)]
async fn remove_while_in_flight_discards_the_reply() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    f.slave
        .set_default(Behavior::Delay(Duration::from_millis(300)));
    let a = f.running("A", def(1, 0, 2, 100)).await;
    let view = f.view(a).await;
    tokio::time::sleep(Duration::from_millis(100)).await; // A is in flight
    let b = f.running("B", def(1, 10, 2, 100)).await;
    f.session.remove_poll(a).await.unwrap();
    let events = view.events();
    assert!(matches!(events.last(), Some(PollViewEvent::PollRemoved(r)) if r.poll_id == a));
    let n = view.events().len();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(view.events().len(), n, "no event after PollRemoved");
    assert_eq!(
        f.rec.poll_states(a),
        [P::Polling],
        "the late reply changed nothing"
    );
    assert_eq!(f.rec.last_poll_state(b), Some(P::Polling));
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.polls.len(), 1);
    // The removed poll's request and reply stay in the connection totals.
    let b_requests = snap.counters.polls[0].counters.requests;
    assert_eq!(snap.counters.total.requests, b_requests + 1);
    assert!(matches!(
        f.session.remove_poll(a).await,
        Err(SessionError::PollNotFound(_))
    ));
    assert_eq!(f.session.stats().await.unwrap().attached_views, 0);
}

#[tokio::test(start_paused = true)]
async fn link_drop_takes_every_poll_offline_and_reconnect_restores_by_active() {
    let f = fixture();
    f.session.set_auto_start_poll(true).await.unwrap();
    // Added while idle: offline, active = autoStartPoll = true.
    let a = f
        .session
        .add_poll(input("A", def(1, 0, 2, 100)), H::Workspace)
        .await
        .unwrap();
    let b = f
        .session
        .add_poll(input("B", def(1, 10, 2, 100)), H::Workspace)
        .await
        .unwrap();
    f.session.set_poll_active(b, false).await.unwrap(); // pause intent while offline
    let snap = f.session.snapshot().await.unwrap();
    assert!(snap.polls.iter().all(|p| p.status.state == P::Offline));
    f.connected(tcp_config(502, 200)).await;
    assert_eq!(f.rec.last_poll_state(a), Some(P::Polling), "PT2");
    assert_eq!(f.rec.last_poll_state(b), Some(P::Paused), "PT1");
    tokio::time::sleep(Duration::from_millis(500)).await;
    f.slave.script([Behavior::Close]);
    wait_connection(&f.rec, C::Disconnected).await;
    assert_eq!(f.rec.last_poll_state(a), Some(P::Offline));
    assert_eq!(f.rec.last_poll_state(b), Some(P::Offline));
    // Reconnect: A resumes (active), B stays paused.
    f.session.connect(tcp_config(502, 200)).await.unwrap();
    wait_connection(&f.rec, C::Connected).await;
    assert_eq!(f.rec.last_poll_state(a), Some(P::Polling));
    assert_eq!(f.rec.last_poll_state(b), Some(P::Paused));
    // autoStartPoll off: everything comes up paused, `active` unchanged.
    f.session.disconnect().await.unwrap();
    f.session.set_auto_start_poll(false).await.unwrap();
    f.connected(tcp_config(502, 200)).await;
    assert_eq!(f.rec.last_poll_state(a), Some(P::Paused));
    let snap = f.session.snapshot().await.unwrap();
    assert!(snap.polls[0].config.active, "active unchanged");
    // New polls start paused unless autoStartPoll is on.
    let c = f
        .session
        .add_poll(input("C", def(1, 20, 2, 100)), H::Workspace)
        .await
        .unwrap();
    let snap = f.session.snapshot().await.unwrap();
    let c_summary = snap.polls.iter().find(|p| p.config.poll_id == c).unwrap();
    assert_eq!(
        (c_summary.status.state, c_summary.config.active),
        (P::Paused, false)
    );
    // Resume all / Pause all.
    f.session.set_all_polls_active(true).await.unwrap();
    for id in [a, b, c] {
        assert_eq!(f.rec.last_poll_state(id), Some(P::Polling));
    }
    f.session.set_all_polls_active(false).await.unwrap();
    for id in [a, b, c] {
        assert_eq!(f.rec.last_poll_state(id), Some(P::Paused));
    }
}

#[tokio::test(start_paused = true)]
async fn writes_go_between_poll_requests() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    f.slave
        .set_default(Behavior::Delay(Duration::from_millis(20)));
    let a = f.running("A", def(1, 0, 2, 20)).await;
    let b = f.running("B", def(1, 10, 2, 20)).await;
    tokio::time::sleep(Duration::from_millis(105)).await;
    let w = |v| WriteRequest {
        slave_id: 1,
        function: 6,
        address: 500,
        values: vec![v],
    };
    let (r1, r2) = tokio::join!(
        f.session.write(w(1), Some(a)),
        f.session.write(w(2), Some(b))
    );
    assert_eq!(
        (r1.unwrap(), r2.unwrap()),
        (WriteResult::Ok, WriteResult::Ok)
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    // FIFO, back to back, right after the request that was in flight.
    let frames: Vec<TrafficFrame> = f
        .rec
        .frames()
        .into_iter()
        .filter(|fr| fr.direction == TrafficDirection::Tx)
        .collect();
    let first_write = frames.iter().position(|fr| fr.function == Some(6)).unwrap();
    assert_eq!(frames[first_write + 1].function, Some(6));
    assert_eq!(
        frames[first_write].origin,
        Some(TrafficOrigin::Write { poll_id: Some(a) })
    );
    assert_eq!(
        frames[first_write + 1].origin,
        Some(TrafficOrigin::Write { poll_id: Some(b) })
    );
    assert_eq!(f.slave.holding_register(500), 2);
    assert_no_overlap(&f.rec.frames(), 1000);
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.counters.writes.requests, 2);
    let poll_sum: u64 = snap
        .counters
        .polls
        .iter()
        .map(|c| c.counters.requests)
        .sum();
    assert_eq!(snap.counters.total.requests, poll_sum + 2);
}

#[tokio::test(start_paused = true)]
async fn view_attach_replace_late_detach_and_host_rules() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    // Wrong host.
    let v = Arc::new(ViewRec::default());
    assert_eq!(
        field(
            f.session
                .attach_view(a, H::Native, v.clone())
                .await
                .unwrap_err()
        ),
        "host"
    );
    assert!(matches!(
        f.session
            .attach_view(PollId(42), H::Workspace, v.clone())
            .await,
        Err(SessionError::PollNotFound(_))
    ));
    let first = Arc::new(ViewRec::default());
    let snap1 = f
        .session
        .attach_view(a, H::Workspace, first.clone())
        .await
        .unwrap();
    let second = Arc::new(ViewRec::default());
    let snap2 = f
        .session
        .attach_view(a, H::Workspace, second.clone())
        .await
        .unwrap();
    assert_ne!(snap1.view_token, snap2.view_token);
    assert!(matches!(
        first.events().last(),
        Some(PollViewEvent::ViewDetached(d)) if d.reason == DetachReason::Replaced
    ));
    // A late detach with the old token cannot remove the new view.
    f.session.detach_view(a, snap1.view_token).await.unwrap();
    assert_eq!(f.session.stats().await.unwrap().attached_views, 1);
    f.session.set_compact(true).await.unwrap();
    assert!(matches!(
        second.events().last(),
        Some(PollViewEvent::PrefsChanged(p)) if p.compact
    ));
    assert_eq!(first.events().len(), 1, "nothing after ViewDetached");
    f.session.detach_view(a, snap2.view_token).await.unwrap();
    assert_eq!(f.session.stats().await.unwrap().attached_views, 0);
    // A closed poll cannot be attached.
    f.session.close_view(a, true).await.unwrap();
    assert_eq!(
        field(f.session.attach_view(a, H::Workspace, v).await.unwrap_err()),
        "host"
    );
}

#[tokio::test(start_paused = true)]
async fn dead_view_sinks_are_dropped() {
    let f = fixture();
    f.connected(tcp_config(502, 100)).await;
    let a = f.running("A", poll03(2, 50)).await;
    let view = f.view(a).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    view.kill();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        f.session.stats().await.unwrap().attached_views,
        0,
        "no sender leak"
    );
    assert_eq!(
        f.rec.last_poll_state(a),
        Some(P::Polling),
        "the poll keeps running"
    );
}

#[tokio::test(start_paused = true)]
async fn pop_out_and_dock_cycles_change_only_routing() {
    let f = fixture();
    f.connected(tcp_config(502, 100)).await;
    let a = f.running("A", def(1, 0, 4, 100)).await;
    let b = f.running("B", def(1, 10, 4, 100)).await;
    tokio::time::sleep(Duration::from_millis(1000)).await;
    let start = f.slave.requests().len();
    let t0 = tokio::time::Instant::now();
    for cycle in 0..5 {
        let ws = Arc::new(ViewRec::default());
        let snap = f
            .session
            .attach_view(a, H::Workspace, ws.clone())
            .await
            .unwrap();
        assert!(
            snap.last_update.is_some(),
            "values at once (no loading flash)"
        );
        if cycle > 0 {
            assert_eq!(snap.handoff.as_deref(), Some("from-native"), "dock handoff");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        // Pop out: the window layer created the native window, then:
        f.session
            .set_native_open(a, Some(format!("from-workspace-{cycle}")))
            .await
            .unwrap();
        assert!(matches!(
            ws.events().last(),
            Some(PollViewEvent::ViewDetached(d)) if d.reason == DetachReason::PoppedOut
        ));
        let native = Arc::new(ViewRec::default());
        let snap = f
            .session
            .attach_view(a, H::Native, native.clone())
            .await
            .unwrap();
        assert_eq!(snap.handoff, Some(format!("from-workspace-{cycle}")));
        assert!(snap.last_update.is_some());
        // Delivered once.
        let again = f
            .session
            .attach_view(a, H::Native, native.clone())
            .await
            .unwrap();
        assert_eq!(again.handoff, None);
        tokio::time::sleep(Duration::from_millis(100)).await;
        f.session
            .dock(a, Some("from-native".into()), None, None)
            .await
            .unwrap();
        assert!(matches!(
            native.events().last(),
            Some(PollViewEvent::ViewDetached(d)) if d.reason == DetachReason::Docked
        ));
        assert!(f.rec.events().iter().any(|e| matches!(
            e,
            SessionEvent::RevealPoll(r) if r.poll_id == a
        )));
    }
    // 1 s of two polls at 100 ms: about 20 requests, the moves added none.
    let elapsed = t0.elapsed().as_millis();
    let requests = f.slave.requests().len() - start;
    let expected = usize::try_from(elapsed / 100 * 2).unwrap();
    assert!(requests.abs_diff(expected) <= 2, "{requests} vs {expected}");
    assert_eq!(
        f.rec.poll_states(a),
        [P::Polling],
        "hosting never changes poll state"
    );
    assert_eq!(f.rec.last_poll_state(b), Some(P::Polling));
}

#[tokio::test(start_paused = true)]
async fn handoff_expires_after_ten_seconds() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    f.session
        .set_native_open(a, Some("h".into()))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(11)).await;
    let snap = f
        .session
        .attach_view(a, H::Native, Arc::new(ViewRec::default()))
        .await
        .unwrap();
    assert_eq!(snap.handoff, None);
    assert_eq!(
        field(
            f.session
                .set_native_open(a, Some("x".repeat(256 * 1024 + 1)))
                .await
                .unwrap_err()
        ),
        "handoff"
    );
}

#[tokio::test(start_paused = true)]
async fn handoff_request_answered_refused_and_timed_out() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(2, 100)), H::Native)
        .await
        .unwrap();
    // No native view attached: nothing to hand over.
    assert_eq!(f.session.request_handoff(a).await.unwrap(), None);
    let native = Arc::new(ViewRec::default());
    f.session
        .attach_view(a, H::Native, native.clone())
        .await
        .unwrap();

    // Answered.
    let answer = async {
        wait_until(Duration::from_secs(1), "HandoffRequested", || {
            native
                .events()
                .iter()
                .any(|e| matches!(e, PollViewEvent::HandoffRequested(h) if h.poll_id == a))
        })
        .await;
        f.session
            .provide_handoff(a, Some("state".into()))
            .await
            .unwrap();
    };
    let (got, ()) = tokio::join!(f.session.request_handoff(a), answer);
    assert_eq!(got.unwrap(), Some("state".into()));

    // Refused (a modal is open there).
    native.clear();
    let refuse = async {
        wait_until(Duration::from_secs(1), "HandoffRequested", || {
            !native.events().is_empty()
        })
        .await;
        f.session.provide_handoff(a, None).await.unwrap();
    };
    let (got, ()) = tokio::join!(f.session.request_handoff(a), refuse);
    assert_eq!(field(got.unwrap_err()), "handoff");

    // No answer within 1 s.
    let t0 = tokio::time::Instant::now();
    assert_eq!(
        field(f.session.request_handoff(a).await.unwrap_err()),
        "handoff"
    );
    assert!(t0.elapsed() >= modbus_master::HANDOFF_REQUEST_TIMEOUT);
    // A late answer is ignored.
    f.session
        .provide_handoff(a, Some("late".into()))
        .await
        .unwrap();
}

#[tokio::test(start_paused = true)]
async fn show_close_and_native_window_destroyed() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    let n = f
        .session
        .add_poll(input("N", poll03(2, 100)), H::Native)
        .await
        .unwrap();
    let view = f.view(a).await;
    // Close -> Keep.
    assert_eq!(f.session.close_view(a, true).await.unwrap(), H::Workspace);
    assert!(matches!(
        view.events().last(),
        Some(PollViewEvent::ViewDetached(d)) if d.reason == DetachReason::Closed
    ));
    let list = f.rec.last_list().unwrap();
    assert!(!list[0].open);
    // Show reopens it in the workspace, restored from minimized.
    let rect = WorkspaceRect {
        x: 8.0,
        y: 8.0,
        width: 640.0,
        height: 368.0,
        z: 3,
        state: SubWindowState::Minimized,
        restore: None,
        grid: None,
    };
    f.session
        .set_workspace_layout(WorkspaceLayout {
            items: vec![shared_types::WorkspaceItem { poll_id: a, rect }],
            minimized_order: vec![a, PollId(99)],
            ..WorkspaceLayout::default()
        })
        .await
        .unwrap();
    assert_eq!(
        f.session
            .snapshot()
            .await
            .unwrap()
            .workspace_layout
            .minimized_order,
        [a]
    );
    assert_eq!(
        f.session.show_poll(a, None).await.unwrap(),
        modbus_master::ShowOutcome::Workspace
    );
    let s = f.session.snapshot().await.unwrap();
    assert!(s.polls[0].open);
    assert_eq!(s.polls[0].workspace.unwrap().state, SubWindowState::Normal);
    assert!(s.workspace_layout.minimized_order.is_empty());
    assert!(matches!(
        f.rec.events().last(),
        Some(SessionEvent::RevealPoll(r)) if r.poll_id == a && r.workspace_rect.is_none()
    ));
    // Native, open: focus; destroyed by the OS: closed; show: open a window.
    assert_eq!(
        f.session.show_poll(n, None).await.unwrap(),
        modbus_master::ShowOutcome::FocusNative
    );
    f.session.native_window_destroyed(n).await.unwrap();
    assert!(!f.session.snapshot().await.unwrap().polls[1].open);
    assert_eq!(
        f.session.show_poll(n, None).await.unwrap(),
        modbus_master::ShowOutcome::OpenNative(None)
    );
    // List drag with a rectangle: always the workspace.
    let drop_rect = WorkspaceRect {
        state: SubWindowState::Normal,
        ..rect
    };
    assert_eq!(
        f.session.show_poll(n, Some(drop_rect)).await.unwrap(),
        modbus_master::ShowOutcome::Workspace
    );
    let s = f.session.snapshot().await.unwrap();
    assert_eq!((s.polls[1].host, s.polls[1].open), (H::Workspace, true));
    // Close -> Delete removes it.
    f.session.close_view(n, false).await.unwrap();
    assert_eq!(f.session.snapshot().await.unwrap().polls.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn view_settings_aliases_and_unapplied_edits() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(10, 100)), H::Workspace)
        .await
        .unwrap();
    let view = f.view(a).await;
    let alias = |address, alias: &str| AliasEntry {
        address,
        alias: alias.into(),
    };
    f.session
        .set_poll_view(
            a,
            PollViewSettings {
                aliases: Some(vec![alias(9, "Z"), alias(0, "Tank top")]),
                ..PollViewSettings::default()
            },
        )
        .await
        .unwrap();
    match view.events().last() {
        Some(PollViewEvent::PollConfigChanged(c)) => {
            assert_eq!(
                c.aliases,
                vec![alias(0, "Tank top"), alias(9, "Z")],
                "sorted"
            );
        }
        other => panic!("{other:?}"),
    }
    let bad = PollViewSettings {
        aliases: Some(vec![alias(1, "a"), alias(1, "b")]),
        ..PollViewSettings::default()
    };
    assert_eq!(
        field(f.session.set_poll_view(a, bad).await.unwrap_err()),
        "aliases"
    );
    // Only hasUnappliedEdits: W1 hears it, the view does not get a config change.
    let n = view.events().len();
    f.session
        .set_poll_view(
            a,
            PollViewSettings {
                has_unapplied_edits: Some(true),
                ..PollViewSettings::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(view.events().len(), n);
    assert!(f.rec.last_list().unwrap()[0].has_unapplied_edits);
    // Aliases follow the address when the range changes.
    f.session.update_poll(a, def(1, 5, 2, 100)).await.unwrap();
    assert_eq!(f.rec.last_list().unwrap()[0].config.aliases.len(), 2);
    // Close -> Keep clears hasUnappliedEdits.
    f.session.close_view(a, true).await.unwrap();
    assert!(!f.rec.last_list().unwrap()[0].has_unapplied_edits);
}

#[tokio::test(start_paused = true)]
async fn prefs_and_profile_name_reach_every_window() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    let view = f.view(a).await;
    f.session.set_ask_on_poll_close(false).await.unwrap();
    f.session
        .set_profile_name(Some("Boiler".into()))
        .await
        .unwrap();
    f.session.request_save(true).await.unwrap();
    f.session.show_traffic(Some(a)).await.unwrap();
    assert!(view.events().iter().any(|e| matches!(
        e,
        PollViewEvent::PrefsChanged(p) if !p.ask_on_poll_close
    )));
    assert!(view.events().iter().any(|e| matches!(
        e,
        PollViewEvent::ProfileNameChanged(n) if n.name.as_deref() == Some("Boiler")
    )));
    let w1 = f.rec.events();
    assert!(w1
        .iter()
        .any(|e| matches!(e, SessionEvent::PrefsChanged(p) if !p.ask_on_poll_close)));
    assert!(w1
        .iter()
        .any(|e| matches!(e, SessionEvent::SaveRequested(s) if s.save_as)));
    assert!(w1
        .iter()
        .any(|e| matches!(e, SessionEvent::ShowTraffic(s) if s.poll_id == Some(a))));
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(
        (snap.ask_on_poll_close, snap.profile_name.as_deref()),
        (false, Some("Boiler"))
    );
}

#[tokio::test(start_paused = true)]
async fn export_then_apply_round_trips() {
    let f = fixture();
    f.session.set_auto_start_poll(true).await.unwrap();
    let a = f
        .session
        .add_poll(input("A", def(1, 0, 4, 100)), H::Workspace)
        .await
        .unwrap();
    let b = f
        .session
        .add_poll(input("B", def(1, 10, 4, 200)), H::Native)
        .await
        .unwrap();
    let c = f
        .session
        .add_poll(input("C", def(1, 20, 4, 300)), H::Workspace)
        .await
        .unwrap();
    f.session.close_view(c, true).await.unwrap();
    f.session.set_poll_active(b, false).await.unwrap();
    f.session.reorder_polls(vec![c, a, b]).await.unwrap();
    let rect = WorkspaceRect {
        x: 8.0,
        y: 8.0,
        width: 640.0,
        height: 368.0,
        z: 2,
        state: SubWindowState::Minimized,
        restore: None,
        grid: None,
    };
    f.session
        .set_workspace_layout(WorkspaceLayout {
            items: vec![shared_types::WorkspaceItem { poll_id: a, rect }],
            minimized_order: vec![a],
            tile_mode: true,
            sidebar_width: 300.0,
            traffic_expanded: true,
            traffic_height: Some(240.0),
            ..WorkspaceLayout::default()
        })
        .await
        .unwrap();
    f.session.set_compact(true).await.unwrap();
    let placement = shared_types::WindowPlacement {
        x: 100.0,
        y: 50.0,
        width: 900.0,
        height: 640.0,
        maximized: false,
        monitor: "\\\\.\\DISPLAY2".into(),
    };
    f.session
        .set_native_placement(b, placement.clone())
        .await
        .unwrap();
    let exported = f
        .session
        .export_profile(Some("Boiler".into()), Some(tcp_config(502, 1000)), None)
        .await
        .unwrap();
    assert_eq!(exported.schema_version, 6);
    let names: Vec<&str> = exported.polls.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["C", "A", "B"]);
    assert_eq!(exported.workspace.minimized_order, [1]);
    assert!(exported.workspace.tile_mode && exported.workspace.compact);
    assert!(!exported.polls[0].view.open);
    assert_eq!(exported.polls[2].view.native, Some(placement));
    assert!(!exported.polls[2].active);

    // Apply into a fresh session: same export (ids differ, never saved).
    let g = fixture();
    let v = g
        .session
        .add_poll(input("Old", poll03(1, 100)), H::Workspace)
        .await
        .unwrap();
    let old_view = g.view(v).await;
    let snap = g.session.apply_profile(exported.clone()).await.unwrap();
    assert!(matches!(
        old_view.events().last(),
        Some(PollViewEvent::ViewDetached(d)) if d.reason == DetachReason::Closed
    ));
    assert_eq!(snap.polls.len(), 3);
    assert!(snap.compact);
    let again = g
        .session
        .export_profile(Some("Boiler".into()), Some(tcp_config(502, 1000)), None)
        .await
        .unwrap();
    assert_eq!(again, exported);
    // Connecting applies autoStartPoll and `active` from the profile.
    g.connected(tcp_config(502, 1000)).await;
    let snap = g.session.snapshot().await.unwrap();
    let states: Vec<P> = snap.polls.iter().map(|p| p.status.state).collect();
    assert_eq!(states, [P::Polling, P::Polling, P::Paused]);
    // Not while connected.
    assert!(matches!(
        g.session.apply_profile(exported.clone()).await,
        Err(SessionError::InvalidState(_))
    ));
    // Invalid polls are refused before anything changes.
    let mut bad = exported;
    bad.polls[1].name = "c".into();
    g.session.disconnect().await.unwrap();
    assert_eq!(
        field(g.session.apply_profile(bad).await.unwrap_err()),
        "polls"
    );
    assert_eq!(g.session.snapshot().await.unwrap().polls.len(), 3);
}

/// REQ-002 performance in simulated time: 16 polls at 100 ms for 60 s, every one with a
/// view, no event backlog and bounded traffic memory.
#[tokio::test(start_paused = true)]
async fn sixteen_polls_at_100ms_for_60s_without_backlog() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    let mut views = Vec::new();
    for i in 0..16u16 {
        let id = f.running(&format!("P{i}"), def(1, i * 125, 125, 100)).await;
        views.push(f.view(id).await);
    }
    tokio::time::sleep(Duration::from_secs(60)).await;
    let stats = f.session.stats().await.unwrap();
    assert!(stats.max_pending_frames <= 64, "{stats:?}");
    assert_eq!(stats.traffic_log_len, modbus_master::TRAFFIC_LOG_CAPACITY);
    for v in &views {
        let n = v.updates().len();
        // At most one update per 50 ms per view.
        assert!((500..=1201).contains(&n), "{n}");
    }
    let snap = f.session.snapshot().await.unwrap();
    for p in &snap.counters.polls {
        // 16 x 125 registers at 100 ms fit on an instant in-memory link.
        assert!(p.counters.requests >= 590, "{:?}", p.counters);
        assert_eq!(p.effective_scan_ms, Some(100));
    }
}

#[tokio::test(start_paused = true)]
async fn export_defaults_to_the_profile_name_and_last_connection() {
    let f = fixture();
    assert_eq!(
        field(
            f.session
                .export_profile(None, None, None)
                .await
                .unwrap_err()
        ),
        "connection"
    );
    f.session
        .set_profile_name(Some("Boiler".into()))
        .await
        .unwrap();
    f.connected(tcp_config(1502, 700)).await;
    let p = f.session.export_profile(None, None, None).await.unwrap();
    assert_eq!(p.name, "Boiler");
    assert_eq!(p.connection, tcp_config(1502, 700));
    assert!(p.polls.is_empty());
    assert_eq!(p.workspace, shared_types::WorkspaceProfile::default());
}

/// REV-004: on RTU the inter-frame gap is kept between requests of **different polls and
/// units**, not only between writes: after an answered request at least
/// `max(t3.5, RTU_MIN_GAP)`, after a timeout (unit 9 never answers) the timeout plus the
/// frame silence (`max(t3.5, 50 ms)`).
#[tokio::test(start_paused = true)]
async fn rtu_gap_between_requests_of_different_polls_and_units() {
    let f = fixture();
    f.connected(rtu_config(100)).await;
    f.running("A", def(1, 0, 4, 20)).await;
    f.running("B", def(1, 100, 4, 20)).await;
    f.running("C", def(9, 0, 4, 50)).await; // never answered
    tokio::time::sleep(Duration::from_secs(3)).await;
    let log = f.slave.request_log();
    assert!(log.len() > 20, "{}", log.len());
    let (mut unit_changes, mut same_unit) = (0, 0);
    for w in log.windows(2) {
        let ((u0, t0), (u1, t1)) = (w[0], w[1]);
        let gap = t1 - t0;
        if u0 == 9 {
            assert!(
                gap >= Duration::from_millis(150),
                "after a timeout: {gap:?}"
            );
        } else {
            assert!(gap >= modbus_master::RTU_MIN_GAP, "after a reply: {gap:?}");
        }
        if u0 == u1 {
            same_unit += 1;
        } else {
            unit_changes += 1;
        }
    }
    // Both kinds of neighbours occurred: unit 1 -> unit 9 (and back), and poll A -> poll B
    // on the same unit.
    assert!(
        unit_changes >= 5 && same_unit >= 5,
        "{unit_changes} {same_unit}"
    );
    let requests = f.slave.requests();
    let addresses: Vec<u16> = requests
        .iter()
        .filter_map(|(_, r)| match r {
            modbus_core::Request::ReadHoldingRegisters { address, .. } => Some(*address),
            _ => None,
        })
        .collect();
    assert!(
        addresses.windows(2).any(|w| w[0] != w[1]),
        "two polls on unit 1"
    );
}

/// REV-004 m5: handoff requests for different polls are independent; a second request for
/// the same poll is a precise `invalidState`, a removed poll is `pollNotFound` and a view
/// that goes away lets the dock proceed without a handoff (never the "dialog" refusal).
#[tokio::test(start_paused = true)]
async fn handoff_requests_for_several_polls_do_not_cancel_each_other() {
    let f = fixture();
    let mut ids = Vec::new();
    let mut views = Vec::new();
    for name in ["A", "B", "C", "D"] {
        let id = f
            .session
            .add_poll(input(name, poll03(2, 100)), H::Native)
            .await
            .unwrap();
        let v = Arc::new(ViewRec::default());
        f.session
            .attach_view(id, H::Native, v.clone())
            .await
            .unwrap();
        ids.push(id);
        views.push(v);
    }
    let requested = |v: &ViewRec| {
        v.events()
            .iter()
            .any(|e| matches!(e, PollViewEvent::HandoffRequested(_)))
    };
    let (a, b, c, d) = (ids[0], ids[1], ids[2], ids[3]);
    let answers = async {
        wait_until(Duration::from_millis(500), "both requests", || {
            requested(&views[0]) && requested(&views[1])
        })
        .await;
        // A second request for A while A's is waiting.
        match f.session.request_handoff(a).await.unwrap_err() {
            SessionError::InvalidState(m) => assert_eq!(m, "This poll is already being docked."),
            other => panic!("{other:?}"),
        }
        // B answers first, then A.
        f.session
            .provide_handoff(b, Some("state-b".into()))
            .await
            .unwrap();
        f.session
            .provide_handoff(a, Some("state-a".into()))
            .await
            .unwrap();
    };
    let (ra, rb, ()) = tokio::join!(
        f.session.request_handoff(a),
        f.session.request_handoff(b),
        answers
    );
    assert_eq!(ra.unwrap().as_deref(), Some("state-a"));
    assert_eq!(rb.unwrap().as_deref(), Some("state-b"));

    // The poll is removed while its request waits: pollNotFound, at once.
    let t0 = tokio::time::Instant::now();
    let remove = async {
        wait_until(Duration::from_millis(500), "request C", || {
            requested(&views[2])
        })
        .await;
        f.session.remove_poll(c).await.unwrap();
    };
    let (rc, ()) = tokio::join!(f.session.request_handoff(c), remove);
    assert!(matches!(rc, Err(SessionError::PollNotFound(id)) if id == c));
    assert!(t0.elapsed() < modbus_master::HANDOFF_REQUEST_TIMEOUT);

    // The native window is destroyed while the request waits: proceed without a handoff.
    let destroyed = async {
        wait_until(Duration::from_millis(500), "request D", || {
            requested(&views[3])
        })
        .await;
        f.session.native_window_destroyed(d).await.unwrap();
    };
    let (rd, ()) = tokio::join!(f.session.request_handoff(d), destroyed);
    assert_eq!(rd.unwrap(), None);

    // After a timeout the poll can be asked again (the stale request does not block it).
    assert_eq!(
        field(f.session.request_handoff(a).await.unwrap_err()),
        "handoff"
    );
    let again = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        f.session
            .provide_handoff(a, Some("x".into()))
            .await
            .unwrap();
    };
    let (ra, ()) = tokio::join!(f.session.request_handoff(a), again);
    assert_eq!(ra.unwrap().as_deref(), Some("x"));
}

/// REV-004 m3: duplicate (and unknown) ids in `minimizedOrder` are dropped when stored, so
/// the exported profile always passes the profile checks used by `profiles_save`.
#[tokio::test(start_paused = true)]
async fn duplicate_minimized_ids_are_dropped_and_export_stays_saveable() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    let b = f
        .session
        .add_poll(input("B", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    f.session
        .set_workspace_layout(WorkspaceLayout {
            minimized_order: vec![b, b, PollId(77), a, b, a],
            ..WorkspaceLayout::default()
        })
        .await
        .unwrap();
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.workspace_layout.minimized_order, [b, a]);
    let profile = f
        .session
        .export_profile(Some("P".into()), Some(tcp_config(502, 1000)), None)
        .await
        .unwrap();
    assert_eq!(profile.workspace.minimized_order, [1, 0]);
    // The exported indexes are unique and in range (the `check_profile` rule).
    let order = &profile.workspace.minimized_order;
    for (i, index) in order.iter().enumerate() {
        assert!((*index as usize) < profile.polls.len());
        assert!(!order[..i].contains(index), "duplicate index {index}");
    }
}

/// REV-004 m6: the window layer marks the poll native **before** creating its window, so
/// the new window's first attach succeeds; if the window cannot be created the undo
/// restores the previous host (the workspace view comes back and gets its handoff).
#[tokio::test(start_paused = true)]
async fn native_open_before_the_window_and_undo_on_failure() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    let b = f
        .session
        .add_poll(input("B", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    let rect = WorkspaceRect {
        x: 8.0,
        y: 8.0,
        width: 640.0,
        height: 368.0,
        z: 1,
        state: SubWindowState::Minimized,
        restore: None,
        grid: None,
    };
    f.session
        .set_workspace_layout(WorkspaceLayout {
            items: vec![shared_types::WorkspaceItem { poll_id: b, rect }],
            minimized_order: vec![a, b],
            ..WorkspaceLayout::default()
        })
        .await
        .unwrap();
    let ws = f.view(b).await;
    // Pop out B: marked native first; the (simulated) new window attaches at once.
    let undo = f
        .session
        .begin_native_open(b, Some("drafts".into()))
        .await
        .unwrap();
    let native = Arc::new(ViewRec::default());
    let snap = f
        .session
        .attach_view(b, H::Native, native.clone())
        .await
        .unwrap();
    assert_eq!(snap.handoff.as_deref(), Some("drafts"));
    assert!(matches!(
        ws.events().last(),
        Some(PollViewEvent::ViewDetached(x)) if x.reason == DetachReason::PoppedOut
    ));
    // Window creation failed after all: back to the workspace, minimized at its place.
    f.session
        .begin_native_open(b, Some("drafts".into()))
        .await
        .unwrap(); // (stores the handoff again, as the failed pop out did)
    f.session.undo_native_open(b, undo).await.unwrap();
    assert!(matches!(
        native.events().last(),
        Some(PollViewEvent::ViewDetached(x)) if x.reason == DetachReason::Closed
    ));
    let s = f.session.snapshot().await.unwrap();
    assert_eq!((s.polls[1].host, s.polls[1].open), (H::Workspace, true));
    assert_eq!(s.workspace_layout.minimized_order, [a, b]);
    let list = f.rec.last_list().unwrap();
    assert_eq!((list[1].host, list[1].open), (H::Workspace, true));
    // The workspace view mounts again and gets the drafts back.
    let snap = f
        .session
        .attach_view(b, H::Workspace, Arc::new(ViewRec::default()))
        .await
        .unwrap();
    assert_eq!(snap.handoff.as_deref(), Some("drafts"));
    // Show of a closed poll: undo closes it again; a removed poll is a no-op.
    f.session.close_view(a, true).await.unwrap();
    let undo = f.session.begin_native_open(a, None).await.unwrap();
    f.session.undo_native_open(a, undo.clone()).await.unwrap();
    let s = f.session.snapshot().await.unwrap();
    assert_eq!((s.polls[0].host, s.polls[0].open), (H::Workspace, false));
    f.session.remove_poll(a).await.unwrap();
    f.session.undo_native_open(a, undo).await.unwrap();
}

/// REV-004 n4: Keep discards unapplied drafts, so a stored handoff is dropped too and a
/// Show within 10 s does not bring them back.
#[tokio::test(start_paused = true)]
async fn keep_drops_a_stored_handoff() {
    let f = fixture();
    let a = f
        .session
        .add_poll(input("A", poll03(2, 100)), H::Workspace)
        .await
        .unwrap();
    f.session
        .set_native_open(a, Some("drafts".into()))
        .await
        .unwrap();
    f.session.close_view(a, true).await.unwrap();
    f.session.set_native_open(a, None).await.unwrap(); // Show of the closed native poll
    let snap = f
        .session
        .attach_view(a, H::Native, Arc::new(ViewRec::default()))
        .await
        .unwrap();
    assert_eq!(snap.handoff, None);
}

#[tokio::test(start_paused = true)]
async fn interpretation_and_color_rules_commit_atomically_and_duplicate_exactly() {
    use shared_types::{
        FormatOverride, ValueColorComparison, ValueColorHighlight, ValueColorRule,
        ValueColorSource, ValueFormat,
    };
    let f = fixture();
    let id = f
        .session
        .add_poll(input("A", poll03(4, 100)), H::Workspace)
        .await
        .unwrap();
    let view = f.view(id).await;
    let rule = ValueColorRule {
        name: " Fraction ".into(),
        enabled: false,
        range: None,
        source: ValueColorSource::Raw,
        comparison: ValueColorComparison::GreaterThan,
        threshold: " 1.5 ".into(),
        upper_threshold: None,
        highlight: ValueColorHighlight::Warning,
        colors: None,
    };
    f.session
        .set_poll_view(
            id,
            PollViewSettings {
                color_rules: Some(vec![rule]),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let before = f.session.snapshot().await.unwrap().polls[0].config.clone();
    assert_eq!(before.color_rules[0].name, "Fraction");
    assert_eq!(before.color_rules[0].threshold, "1.5");
    let ov = |start, end, format, swap_bytes, reverse_words| FormatOverride {
        start,
        end,
        format,
        swap_bytes,
        reverse_words,
    };
    let display = vec![ov(0, 3, ValueFormat::Unsigned64, true, true)];
    let count = view.events().len();
    // Invalid overrides are rejected before anything changes.
    for bad in [
        vec![ov(0, 2, ValueFormat::Float32, false, false)],
        vec![ov(0, 0, ValueFormat::Hex, true, false)],
        vec![
            ov(0, 3, ValueFormat::Float32, false, false),
            ov(2, 5, ValueFormat::Float32, false, false),
        ],
    ] {
        let error = f
            .session
            .set_poll_view(
                id,
                PollViewSettings {
                    format_overrides: Some(bad),
                    color_rules: Some(Vec::new()),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err();
        assert!(error.to_string().starts_with("Format override"), "{error}");
    }
    assert_eq!(f.session.snapshot().await.unwrap().polls[0].config, before);
    // Only formatOverrides: the stored rules (no range, so they also meet 0-3 Unsigned64)
    // must fit, else nothing is applied.
    let error = f
        .session
        .set_poll_view(
            id,
            PollViewSettings {
                format_overrides: Some(display.clone()),
                has_unapplied_edits: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    match error {
        SessionError::Validation(v) => {
            assert_eq!(v.field, "colorRules");
            assert_eq!(
                v.message,
                "Format not applied. Rule \"Fraction\" requires whole-number thresholds for 64-bit integers."
            );
        }
        other => panic!("expected a validation error, got {other:?}"),
    }
    assert_eq!(f.session.snapshot().await.unwrap().polls[0].config, before);
    assert_eq!(view.events().len(), count);
    assert!(!f.session.snapshot().await.unwrap().polls[0].has_unapplied_edits);
    let mut exact = before.color_rules.clone();
    exact[0].threshold = "9007199254740993".into();
    f.session
        .set_poll_view(
            id,
            PollViewSettings {
                format_overrides: Some(display.clone()),
                color_rules: Some(exact.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let count = view.events().len();
    f.session
        .set_poll_view(
            id,
            PollViewSettings {
                format_overrides: Some(display.clone()),
                color_rules: Some(exact.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(view.events().len(), count, "identical patch emits nothing");
    let copy = f.session.duplicate_poll(id).await.unwrap();
    let snapshot = f.session.snapshot().await.unwrap();
    let copied = &snapshot
        .polls
        .iter()
        .find(|p| p.config.poll_id == copy)
        .unwrap()
        .config;
    assert_eq!(copied.color_rules, exact);
    assert_eq!(copied.format_overrides, display);
    // Unsorted input is stored sorted; a colorRules-only patch is checked against the
    // stored overrides.
    let unsorted = vec![
        ov(4, 4, ValueFormat::Hex, false, false),
        ov(0, 3, ValueFormat::Unsigned64, true, true),
    ];
    f.session
        .set_poll_view(
            copy,
            PollViewSettings {
                format_overrides: Some(unsorted),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let mut fraction = exact.clone();
    fraction[0].threshold = "1.5".into();
    assert!(f
        .session
        .set_poll_view(
            copy,
            PollViewSettings {
                color_rules: Some(fraction),
                ..Default::default()
            },
        )
        .await
        .is_err());
    let snapshot = f.session.snapshot().await.unwrap();
    let copied = &snapshot
        .polls
        .iter()
        .find(|p| p.config.poll_id == copy)
        .unwrap()
        .config;
    assert_eq!(copied.format_overrides[0].start, 0);
    assert_eq!(copied.format_overrides[1].start, 4);
    assert_eq!(copied.color_rules, exact);
    let mut profile = f
        .session
        .export_profile(Some("Rules".into()), Some(tcp_config(502, 1000)), None)
        .await
        .unwrap();
    profile.polls[1].color_rules[0].threshold = "1.5".into();
    assert!(f.session.apply_profile(profile).await.is_err());
    assert_eq!(f.session.snapshot().await.unwrap().polls, snapshot.polls);
}
