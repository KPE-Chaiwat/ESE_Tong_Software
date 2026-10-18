//! BE-001 behaviour, ported to the BE-002 session (one poll), against an in-process fake
//! slave over in-memory streams with the Tokio clock paused (deterministic timing).

mod common;

use std::time::Duration;

use common::*;
use modbus_core::Request;
use modbus_master::SessionError;
use shared_types::{
    BadResponseKind, ConnectionState as C, ExceptionCode, PollHostKind, PollState as P, ReasonKind,
    ReasonPhase, TrafficDirection, WriteRequest, WriteResult,
};
use transport::fake::Behavior;
use transport::ConnectError;

fn write(slave_id: u8, function: u8, address: u16, values: Vec<u16>) -> WriteRequest {
    WriteRequest {
        slave_id,
        function,
        address,
        values,
    }
}

#[tokio::test(start_paused = true)]
async fn connect_poll_125_registers() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    let id = f.running("Poll 1", poll03(125, 100)).await;
    let view = f.view(id).await;
    wait_until(Duration::from_secs(5), "3 updates", || {
        view.updates().len() >= 3
    })
    .await;

    assert_eq!(
        f.rec.connection_states(),
        [C::Connecting, C::Connected],
        "polls never change the connection"
    );
    assert_eq!(f.rec.poll_states(id), [P::Polling]);
    let u = &view.updates()[0];
    assert_eq!(u.poll_id, id);
    assert_eq!(u.values, (0..125).collect::<Vec<u16>>());
    assert_eq!((u.slave_id, u.function, u.start_address), (1, 3, 0));
    let seqs: Vec<u64> = view.updates().iter().map(|u| u.seq).collect();
    assert!(seqs.windows(2).all(|w| w[0] < w[1]));

    // Traffic: exact TX bytes, then RX of 7 + 2 + 250 bytes, tagged with the poll.
    let frames = f.rec.frames();
    assert_eq!(frames[0].direction, TrafficDirection::Tx);
    assert_eq!(
        frames[0].bytes,
        [0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x01, 0x03, 0x00, 0x00, 0x00, 0x7D]
    );
    assert_eq!(
        frames[0].origin,
        Some(shared_types::TrafficOrigin::Poll { poll_id: id })
    );
    assert_eq!(frames[1].direction, TrafficDirection::Rx);
    assert_eq!(frames[1].bytes.len(), 259);
    assert!(frames.windows(2).all(|w| w[0].seq < w[1].seq));
    let snap = f.session.snapshot().await.unwrap();
    let c = snap.counters.polls[0].counters;
    assert!(c.requests - c.responses <= 1);
    assert_eq!((c.errors, c.timeouts), (0, 0));
    assert_eq!(snap.counters.total, c, "total = the only poll");
}

#[tokio::test(start_paused = true)]
async fn poll_scan_rate_is_respected() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    let id = f
        .session
        .add_poll(input("Poll 1", poll03(10, 250)), PollHostKind::Workspace)
        .await
        .unwrap();
    let view = f.view(id).await;
    let t0 = tokio::time::Instant::now();
    f.session.set_poll_active(id, true).await.unwrap();
    wait_until(Duration::from_secs(5), "5 updates", || {
        view.updates().len() >= 5
    })
    .await;
    // Cycles start at 0, 250, 500, 750, 1000 ms.
    let elapsed = t0.elapsed();
    assert!(
        elapsed >= Duration::from_millis(1000) && elapsed < Duration::from_millis(1100),
        "{elapsed:?}"
    );
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.counters.polls[0].effective_scan_ms, Some(250));
}

/// REPORT-006 D1: the 1 ms OS timer period is held exactly while a poll runs on the link
/// (not while idle, paused or disconnected) and given back on shutdown.
#[tokio::test(start_paused = true)]
async fn timer_precision_is_held_only_while_polling() {
    let timer = std::sync::Arc::new(CountingTimer::default());
    let f = fixture_with_timer(timer.clone());
    f.connected(tcp_config(502, 1000)).await;
    let id = f
        .session
        .add_poll(input("Poll 1", poll03(10, 100)), PollHostKind::Workspace)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(timer.counts(), (0, 0), "connected, no poll running");
    f.session.set_poll_active(id, true).await.unwrap();
    tokio::time::sleep(Duration::from_millis(350)).await;
    assert_eq!(timer.counts(), (1, 0), "held once while polling");
    f.session.set_poll_active(id, false).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(timer.counts(), (1, 1), "released when paused");
    f.session.set_poll_active(id, true).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(timer.counts(), (2, 1));
    f.session.disconnect().await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(timer.counts(), (2, 2), "released when the link goes");
    f.connected(tcp_config(502, 1000)).await;
    f.session.set_poll_active(id, true).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(timer.counts(), (3, 2));
    f.session.shutdown().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(timer.counts(), (3, 3), "released at session end");
}

#[tokio::test(start_paused = true)]
async fn timeout_exception_and_recovery_with_failure_counts() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    f.slave.script([
        Behavior::Silent,
        Behavior::Silent,
        Behavior::Silent,
        Behavior::Exception(2),
        Behavior::Exception(2),
        Behavior::Respond,
    ]);
    let id = f.running("Poll 1", poll03(2, 100)).await;
    wait_until(Duration::from_secs(10), "recovery", || {
        f.rec
            .poll_states(id)
            .iter()
            .filter(|s| **s == P::Polling)
            .count()
            >= 2
    })
    .await;
    let seq: Vec<(P, u32, Option<ExceptionCode>)> = f
        .rec
        .poll_statuses(id)
        .into_iter()
        .map(|s| (s.state, s.consecutive_failures, s.exception_code))
        .collect();
    assert_eq!(
        seq,
        [
            (P::Polling, 0, None),
            (P::Timeout, 1, None),
            (P::Timeout, 2, None),
            (P::Timeout, 3, None),
            (P::Exception, 1, Some(ExceptionCode(2))),
            (P::Exception, 2, Some(ExceptionCode(2))),
            (P::Polling, 0, None),
        ]
    );
    assert_eq!(f.rec.connection_states(), [C::Connecting, C::Connected]);
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.counters.polls[0].counters.timeouts, 3);
    assert!(snap.counters.polls[0].counters.errors >= 2);
}

#[tokio::test(start_paused = true)]
async fn timeout_keeps_retrying_at_scan_rate_and_never_disconnects() {
    let f = fixture();
    f.connected(tcp_config(502, 50)).await;
    f.slave.set_default(Behavior::Silent);
    let id = f.running("Poll 1", poll03(1, 1000)).await;
    tokio::time::sleep(Duration::from_millis(10_500)).await;
    let last = f.rec.poll_statuses(id).pop().unwrap();
    assert_eq!(last.state, P::Timeout);
    assert_eq!(last.consecutive_failures, 11); // cycles at 0, 1 s, ..., 10 s
    assert_eq!(f.rec.last_connection(), Some(C::Connected));
}

#[tokio::test(start_paused = true)]
async fn rtu_bad_crc_wrong_slave_and_short_frame() {
    let f = fixture();
    f.connected(rtu_config(500)).await;
    f.slave.script([
        Behavior::BadCrc,
        Behavior::WrongSlave(9),
        Behavior::Truncate(5),
        Behavior::Respond,
    ]);
    let id = f.running("Poll 1", poll03(4, 100)).await;
    wait_until(Duration::from_secs(5), "recovery", || {
        f.rec
            .poll_states(id)
            .iter()
            .filter(|s| **s == P::Polling)
            .count()
            >= 2
    })
    .await;
    let bad: Vec<_> = f
        .rec
        .poll_statuses(id)
        .into_iter()
        .filter(|s| s.state == P::BadResponse)
        .map(|s| {
            (
                s.bad_response_kind.unwrap(),
                s.consecutive_failures,
                s.bad_response_detail.unwrap(),
            )
        })
        .collect();
    assert_eq!(bad.len(), 3);
    assert_eq!(bad[0].0, BadResponseKind::Crc);
    assert_eq!(bad[1].0, BadResponseKind::WrongSlave);
    assert_eq!((bad[1].2.expected, bad[1].2.got), (Some(1), Some(9)));
    assert_eq!(bad[1].1, 1, "different kind restarts the count");
    assert_eq!(bad[2].0, BadResponseKind::ShortFrame);
    let notes: Vec<_> = f
        .rec
        .frames()
        .into_iter()
        .filter_map(|fr| fr.note)
        .collect();
    assert!(
        notes.iter().any(|n| n.contains("CRC mismatch")),
        "{notes:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn rtu_read_from_slave_zero_is_rejected() {
    let f = fixture();
    f.connected(rtu_config(500)).await;
    let mut p = poll03(1, 100);
    p.slave_id = 0;
    let err = f
        .session
        .add_poll(input("Poll 1", p), PollHostKind::Workspace)
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247."
    );
    assert!(f.slave.requests().is_empty(), "nothing must be sent");
}

#[tokio::test(start_paused = true)]
async fn tcp_transaction_mismatch() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    f.slave.script([Behavior::WrongTransaction]);
    let id = f.running("Poll 1", poll03(1, 100)).await;
    wait_poll(&f.rec, id, P::BadResponse).await;
    assert_eq!(
        f.rec.poll_statuses(id).pop().unwrap().bad_response_kind,
        Some(BadResponseKind::TransactionMismatch)
    );
    wait_poll(&f.rec, id, P::Polling).await;
}

#[tokio::test(start_paused = true)]
async fn link_drop_goes_to_disconnected_and_keeps_last_values() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    let id = f.running("Poll 1", poll03(3, 100)).await;
    let view = f.view(id).await;
    wait_until(Duration::from_secs(5), "update", || {
        !view.updates().is_empty()
    })
    .await;
    f.slave.script([Behavior::Close]);
    wait_connection(&f.rec, C::Disconnected).await;
    let s = f.rec.connection().pop().unwrap();
    let reason = s.reason.unwrap();
    assert_eq!(reason.kind, ReasonKind::ClosedByPeer);
    assert_eq!(reason.phase, ReasonPhase::LinkLost);
    assert_eq!(f.rec.last_poll_state(id), Some(P::Offline), "PT7");
    assert_eq!(view.states().last(), Some(&P::Offline));
    // Stale values stay available to a newly attached view.
    let view2 = std::sync::Arc::new(ViewRec::default());
    let snap = f
        .session
        .attach_view(id, PollHostKind::Workspace, view2)
        .await
        .unwrap();
    assert!(snap.last_update.is_some(), "stale values stay available");
    // No auto-reconnect.
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(f.rec.last_connection(), Some(C::Disconnected));
    assert_eq!(
        f.session
            .write(write(1, 6, 0, vec![1]), None)
            .await
            .unwrap(),
        WriteResult::NotConnected
    );
    // Dismiss (C7) clears the stale values.
    f.session.disconnect().await.unwrap();
    assert_eq!(f.rec.last_connection(), Some(C::Idle));
    let view3 = std::sync::Arc::new(ViewRec::default());
    let snap = f
        .session
        .attach_view(id, PollHostKind::Workspace, view3)
        .await
        .unwrap();
    assert!(snap.last_update.is_none());
}

#[tokio::test(start_paused = true)]
async fn connect_failure_and_cancel() {
    let f = fixture();
    *f.connector.mode.lock().unwrap() = ConnectMode::Fail(ConnectError::Refused);
    f.session.connect(tcp_config(502, 1000)).await.unwrap();
    wait_connection(&f.rec, C::Disconnected).await;
    let reason = f.rec.connection().pop().unwrap().reason.unwrap();
    assert_eq!(
        (reason.kind, reason.phase),
        (ReasonKind::Refused, ReasonPhase::ConnectFailed)
    );

    *f.connector.mode.lock().unwrap() = ConnectMode::Hang;
    f.session.connect(tcp_config(502, 1000)).await.unwrap();
    assert_eq!(f.rec.last_connection(), Some(C::Connecting));
    let err = f.session.connect(tcp_config(502, 1000)).await.unwrap_err();
    assert!(matches!(err, SessionError::InvalidState(_)));
    f.session.cancel_connect().await.unwrap();
    assert_eq!(
        f.rec.connection_states(),
        [C::Connecting, C::Disconnected, C::Connecting, C::Idle]
    );
}

#[tokio::test(start_paused = true)]
async fn invalid_input_is_rejected_before_sending() {
    let f = fixture();
    let err = f.session.connect(tcp_config(0, 1000)).await.unwrap_err();
    assert!(matches!(err, SessionError::Validation(_)));
    assert!(f.rec.connection_states().is_empty());
    f.connected(tcp_config(502, 1000)).await;
    let err = f
        .session
        .add_poll(input("Poll 1", poll03(126, 100)), PollHostKind::Workspace)
        .await
        .unwrap_err();
    match err {
        SessionError::Validation(v) => assert_eq!(v.field, "quantity"),
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        f.session
            .write(write(1, 16, 0, vec![0; 124]), None)
            .await
            .unwrap_err(),
        SessionError::Validation(_)
    ));
    assert!(f.slave.requests().is_empty());
}

#[tokio::test(start_paused = true)]
async fn writes_06_16_05_15_and_errors() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    let w = |r| f.session.write(r, None);
    assert_eq!(
        w(write(1, 6, 100, vec![0xBEEF])).await.unwrap(),
        WriteResult::Ok
    );
    assert_eq!(f.slave.holding_register(100), 0xBEEF);
    assert_eq!(
        w(write(1, 16, 200, vec![1, 2, 3])).await.unwrap(),
        WriteResult::Ok
    );
    assert_eq!(
        (f.slave.holding_register(200), f.slave.holding_register(202)),
        (1, 3)
    );
    assert_eq!(w(write(1, 5, 7, vec![1])).await.unwrap(), WriteResult::Ok);
    assert!(f.slave.coil(7));
    assert_eq!(
        w(write(1, 15, 10, vec![1, 0, 1])).await.unwrap(),
        WriteResult::Ok
    );
    assert!(f.slave.coil(12));
    // REV-001 F1: on Modbus TCP unit id 0 is not a broadcast; the reply is awaited.
    assert_eq!(w(write(0, 6, 5, vec![9])).await.unwrap(), WriteResult::Ok);
    assert_eq!(f.slave.holding_register(5), 9);

    f.slave.script([Behavior::Exception(3)]);
    assert_eq!(
        w(write(1, 6, 1, vec![1])).await.unwrap(),
        WriteResult::Exception {
            code: ExceptionCode(3)
        }
    );
    f.slave.script([Behavior::Silent]);
    assert_eq!(
        w(write(1, 6, 1, vec![1])).await.unwrap(),
        WriteResult::Timeout
    );
    f.slave.script([Behavior::WrongSlave(4)]);
    match w(write(1, 6, 1, vec![1])).await.unwrap() {
        WriteResult::BadResponse { kind, .. } => assert_eq!(kind, BadResponseKind::WrongSlave),
        other => panic!("{other:?}"),
    }
    assert_eq!(f.rec.connection_states(), [C::Connecting, C::Connected]);
    // Writes count in total and writes only.
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.counters.writes.requests, 8);
    assert_eq!(snap.counters.total, snap.counters.writes);
}

#[tokio::test(start_paused = true)]
async fn write_runs_after_in_flight_poll_and_before_next_cycle() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    f.slave
        .script([Behavior::Delay(Duration::from_millis(300))]);
    let id = f.running("Poll 1", poll03(2, 1000)).await;
    tokio::time::sleep(Duration::from_millis(100)).await; // poll is in flight now
    let result = f
        .session
        .write(write(1, 6, 50, vec![7]), Some(id))
        .await
        .unwrap();
    assert_eq!(result, WriteResult::Ok);
    let requests: Vec<Request> = f.slave.requests().into_iter().map(|(_, r)| r).collect();
    assert_eq!(
        requests.len(),
        2,
        "no overlap and no extra poll yet: {requests:?}"
    );
    assert!(matches!(requests[0], Request::ReadHoldingRegisters { .. }));
    assert!(matches!(
        requests[1],
        Request::WriteSingleRegister {
            address: 50,
            value: 7
        }
    ));
    tokio::time::sleep(Duration::from_millis(60)).await;
    let write_tx = f
        .rec
        .frames()
        .into_iter()
        .find(|fr| fr.direction == TrafficDirection::Tx && fr.function == Some(6))
        .unwrap();
    assert_eq!(
        write_tx.origin,
        Some(shared_types::TrafficOrigin::Write { poll_id: Some(id) })
    );
    // The write is not counted in the poll's counters.
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.counters.polls[0].counters.requests, 1);
    assert_eq!(snap.counters.writes.requests, 1);
    assert_eq!(snap.counters.total.requests, 2);
}

#[tokio::test(start_paused = true)]
async fn pause_resume_apply_and_disconnect() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    let id = f.running("Poll 1", poll03(2, 100)).await;
    let view = f.view(id).await;
    wait_until(Duration::from_secs(5), "update", || {
        !view.updates().is_empty()
    })
    .await;
    f.session.set_poll_active(id, false).await.unwrap(); // PT4
    let n = f.slave.requests().len();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(f.slave.requests().len(), n, "paused: nothing is sent");
    f.session.set_poll_active(id, true).await.unwrap(); // PT3
    f.session.update_poll(id, poll03(5, 100)).await.unwrap(); // PT6
    wait_until(Duration::from_secs(5), "5 values", || {
        view.updates().last().is_some_and(|u| u.values.len() == 5)
    })
    .await;
    // Unchanged definition: no-op.
    f.session.update_poll(id, poll03(5, 100)).await.unwrap();
    f.session.disconnect().await.unwrap();
    assert_eq!(
        f.rec.poll_states(id),
        [P::Polling, P::Paused, P::Polling, P::Polling, P::Offline]
    );
    assert_eq!(
        f.rec.connection_states(),
        [C::Connecting, C::Connected, C::Idle]
    );
    // Idempotent outside their states.
    f.session.set_poll_active(id, false).await.unwrap();
    f.session.cancel_connect().await.unwrap();
    f.session.disconnect().await.unwrap();
    assert_eq!(f.rec.poll_states(id).len(), 5);
    assert_eq!(f.rec.connection_states().len(), 3);
}

#[tokio::test(start_paused = true)]
async fn counters_reset_and_batching() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    let id = f.running("Poll 1", poll03(2, 20)).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    f.session.set_poll_active(id, false).await.unwrap();
    let snap = f.session.snapshot().await.unwrap();
    let c = snap.counters.polls[0].counters;
    assert!(c.requests >= 49, "{c:?}");
    assert_eq!(c.requests, c.responses);

    let mut traffic_events = 0;
    let mut counter_events = 0;
    for e in f.rec.events() {
        match e {
            shared_types::SessionEvent::TrafficFrames(_) => traffic_events += 1,
            shared_types::SessionEvent::Counters(_) => counter_events += 1,
            _ => {}
        }
    }
    assert!(traffic_events <= 22, "{traffic_events}");
    assert!(counter_events <= 12, "{counter_events}");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        f.rec.frames().len() as u64,
        c.requests * 2,
        "no frame dropped"
    );

    f.session.reset_counters(Some(id)).await.unwrap();
    let after = f.rec.last_counters().unwrap();
    assert_eq!(after.polls[0].counters.requests, 0, "one poll reset");
    assert_eq!(after.total.requests, c.requests, "totals keep counting");
    f.session.reset_counters(None).await.unwrap();
    assert_eq!(f.rec.last_counters().unwrap().total.requests, 0);
}

#[tokio::test(start_paused = true)]
async fn open_replays_traffic_to_new_sink() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    f.session
        .write(write(1, 6, 1, vec![1]), None)
        .await
        .unwrap();
    let rec2 = std::sync::Arc::new(SessionRec::default());
    let snap = f.session.open(rec2.clone()).await.unwrap();
    assert_eq!(snap.connection.state, C::Connected);
    assert_eq!(snap.connection.config, Some(tcp_config(502, 200)));
    assert_eq!(rec2.frames().len(), 2);
    assert!(rec2.last_counters().is_some());
}

#[tokio::test(start_paused = true)]
async fn shutdown_closes_the_link() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    f.running("Poll 1", poll03(2, 100)).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    f.session.shutdown().await;
    let server = f.connector.servers.lock().unwrap().pop().unwrap();
    tokio::time::timeout(Duration::from_secs(1), server)
        .await
        .expect("fake slave saw the link close")
        .unwrap();
    assert!(f.session.snapshot().await.is_err());
}

#[tokio::test(start_paused = true)]
async fn dropping_the_handle_stops_the_session() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    f.running("Poll 1", poll03(2, 100)).await;
    let server = f.connector.servers.lock().unwrap().pop().unwrap();
    drop(f.session);
    tokio::time::timeout(Duration::from_secs(1), server)
        .await
        .expect("link closed after the handle was dropped")
        .unwrap();
}

/// BE-001 acceptance (performance): 125 registers every 100 ms for 60 s shows no backlog.
#[tokio::test(start_paused = true)]
async fn sixty_seconds_at_100ms_without_backlog() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    let id = f.running("Poll 1", poll03(125, 100)).await;
    let view = f.view(id).await;
    tokio::time::sleep(Duration::from_secs(60)).await;
    f.session.set_poll_active(id, false).await.unwrap();
    let stats = f.session.stats().await.unwrap();
    let updates = view.updates();
    assert!((599..=601).contains(&updates.len()), "{}", updates.len());
    assert!(stats.max_pending_frames <= 4, "{stats:?}");
    assert_eq!(stats.queued_writes, 0);
    assert_eq!(
        stats.traffic_log_len,
        1200.min(modbus_master::TRAFFIC_LOG_CAPACITY)
    );
    let last = updates.last().unwrap();
    assert!(last.at >= 1_700_000_000_000 + 59_800, "{}", last.at);
}

/// REV-001 F1: a TCP server that answers unit 0 must not disturb polling.
#[tokio::test(start_paused = true)]
async fn tcp_unit_zero_write_while_polling_is_unicast() {
    let f = fixture();
    f.connected(tcp_config(502, 200)).await;
    let id = f.running("Poll 1", poll03(2, 20)).await;
    let view = f.view(id).await;
    wait_until(Duration::from_secs(5), "update", || {
        !view.updates().is_empty()
    })
    .await;
    for i in 0..5 {
        let result = f
            .session
            .write(write(0, 6, 40, vec![i]), None)
            .await
            .unwrap();
        assert_eq!(result, WriteResult::Ok, "write {i}");
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        f.rec.poll_states(id),
        [P::Polling],
        "no spurious badResponse"
    );
    assert!(f.rec.frames().iter().all(|fr| fr.note.is_none()));
    assert_eq!(f.session.snapshot().await.unwrap().counters.total.errors, 0);
}

/// REV-001 F1 / Q-08: RTU slave 0 is a broadcast: no reply awaited, then a turnaround.
#[tokio::test(start_paused = true)]
async fn rtu_broadcast_returns_at_once_then_waits_turnaround() {
    let f = fixture();
    f.connected(rtu_config(500)).await;
    let started = tokio::time::Instant::now();
    assert_eq!(
        f.session
            .write(write(0, 6, 5, vec![9]), None)
            .await
            .unwrap(),
        WriteResult::BroadcastSent
    );
    assert!(
        started.elapsed() < Duration::from_millis(10),
        "returns at once"
    );
    assert_eq!(f.slave.holding_register(5), 9, "applied by the slave");
    assert_eq!(
        f.session
            .write(write(1, 6, 6, vec![1]), None)
            .await
            .unwrap(),
        WriteResult::Ok
    );
    let times = f.slave.request_times();
    assert_eq!(times.len(), 2);
    assert!(times[1] - times[0] >= modbus_master::RTU_BROADCAST_TURNAROUND);
}

/// REV-001 F2: a late reply to an earlier transaction is skipped.
#[tokio::test(start_paused = true)]
async fn tcp_late_reply_is_discarded_and_wait_continues() {
    let f = fixture();
    f.connected(tcp_config(502, 100)).await;
    f.slave
        .script([Behavior::Delay(Duration::from_millis(130))]);
    let id = f.running("Poll 1", poll03(2, 100)).await;
    wait_until(Duration::from_secs(5), "recovery", || {
        f.rec
            .poll_states(id)
            .iter()
            .filter(|s| **s == P::Polling)
            .count()
            >= 2
    })
    .await;
    assert_eq!(f.rec.poll_states(id), [P::Polling, P::Timeout, P::Polling]);
    tokio::time::sleep(Duration::from_millis(60)).await;
    let notes: Vec<String> = f
        .rec
        .frames()
        .into_iter()
        .filter_map(|fr| fr.note)
        .collect();
    assert_eq!(notes, ["Late reply to transaction 1 (discarded)"]);
    let total = f.session.snapshot().await.unwrap().counters.total;
    assert_eq!((total.timeouts, total.errors), (1, 0));
}

/// REV-001 F5: 125 registers at 2400 baud 8E1 with the default 1000 ms timeout poll fine.
#[tokio::test(start_paused = true)]
async fn rtu_125_registers_at_2400_baud_with_default_timeout() {
    let f = fixture();
    let config = shared_types::ConnectionConfig::Rtu {
        port: "COM9".into(),
        baud: 2400,
        data_bits: 8,
        parity: shared_types::Parity::Even,
        stop_bits: 1,
        timeout_ms: 1000,
    };
    f.connected(config).await;
    let char_time = Duration::from_nanos(11 * 1_000_000_000 / 2400);
    f.slave.set_default(Behavior::Trickle(char_time));
    let id = f.running("Poll 1", poll03(125, 1000)).await;
    let view = f.view(id).await;
    wait_until(Duration::from_secs(10), "2 updates", || {
        view.updates().len() >= 2
    })
    .await;
    assert_eq!(f.rec.poll_states(id), [P::Polling]);
    assert_eq!(view.updates()[0].values.len(), 125);
    assert!(view.updates()[0].round_trip_ms > 1000);
}

/// REV-001 F6: RTU requests keep the inter-frame gap, and a longer one after a timeout.
#[tokio::test(start_paused = true)]
async fn rtu_inter_frame_gap_before_each_request() {
    let f = fixture();
    f.connected(rtu_config(100)).await;
    let (a, b) = tokio::join!(
        f.session.write(write(1, 6, 1, vec![1]), None),
        f.session.write(write(1, 6, 2, vec![2]), None)
    );
    assert_eq!((a.unwrap(), b.unwrap()), (WriteResult::Ok, WriteResult::Ok));
    f.slave.script([Behavior::Silent]);
    assert_eq!(
        f.session
            .write(write(1, 6, 3, vec![3]), None)
            .await
            .unwrap(),
        WriteResult::Timeout
    );
    assert_eq!(
        f.session
            .write(write(1, 6, 4, vec![4]), None)
            .await
            .unwrap(),
        WriteResult::Ok
    );
    let t = f.slave.request_times();
    assert_eq!(t.len(), 4);
    assert!(
        t[1] - t[0] >= modbus_master::RTU_MIN_GAP,
        "{:?}",
        t[1] - t[0]
    );
    assert!(
        t[3] - t[2] >= Duration::from_millis(150),
        "{:?}",
        t[3] - t[2]
    );
}

/// REV-001 F9: the write in flight when the link drops is `linkLost`.
#[tokio::test(start_paused = true)]
async fn write_in_flight_when_link_drops_is_link_lost() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    f.slave.script([Behavior::Close]);
    let (first, second) = tokio::join!(
        f.session.write(write(1, 6, 1, vec![1]), None),
        f.session.write(write(1, 6, 2, vec![2]), None)
    );
    assert_eq!(first.unwrap(), WriteResult::LinkLost);
    assert_eq!(second.unwrap(), WriteResult::NotConnected);
    wait_connection(&f.rec, C::Disconnected).await;
}

#[tokio::test(start_paused = true)]
async fn disconnect_during_write_answers_link_lost() {
    let f = fixture();
    f.connected(tcp_config(502, 1000)).await;
    f.slave.script([Behavior::Silent]);
    let write_fut = f.session.write(write(1, 6, 1, vec![1]), None);
    let disconnect = async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        f.session.disconnect().await.unwrap();
    };
    let (result, ()) = tokio::join!(write_fut, disconnect);
    assert_eq!(result.unwrap(), WriteResult::LinkLost);
    assert_eq!(f.rec.last_connection(), Some(C::Idle));
}
