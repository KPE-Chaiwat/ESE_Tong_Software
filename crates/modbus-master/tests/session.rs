//! Session behaviour against an in-process fake slave over in-memory streams, with the
//! Tokio clock paused (deterministic timing).

mod common;

use std::sync::Arc;
use std::time::Duration;

use common::*;
use modbus_core::Request;
use modbus_master::{Session, SessionDeps, SessionError, TokioClock};
use shared_types::{
    BadResponseKind, ExceptionCode, ReasonKind, ReasonPhase, SessionState as S, TrafficDirection,
    WriteRequest, WriteResult,
};
use transport::fake::{Behavior, FakeSlave};
use transport::ConnectError;

struct Fixture {
    session: Session,
    rec: Arc<Recorder>,
    connector: Arc<MemoryConnector>,
    slave: FakeSlave,
}

fn fixture() -> Fixture {
    let slave = FakeSlave::new(1);
    let connector = MemoryConnector::new(slave.clone());
    let rec = Arc::new(Recorder::default());
    let session = Session::spawn(
        rec.clone(),
        SessionDeps {
            clock: Arc::new(TokioClock::new(1_700_000_000_000)),
            connector: connector.clone(),
        },
    );
    Fixture {
        session,
        rec,
        connector,
        slave,
    }
}

async fn connected(f: &Fixture, config: shared_types::ConnectionConfig) {
    f.session.connect(config).await.unwrap();
    wait_state(&f.rec, S::Connected).await;
}

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
    connected(&f, tcp_config(502, 1000)).await;
    f.session.start_poll(poll03(125, 100)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(5), "3 updates", |r| {
        r.updates().len() >= 3
    })
    .await;

    assert_eq!(f.rec.states(), [S::Connecting, S::Connected, S::Polling]);
    let u = &f.rec.updates()[0];
    assert_eq!(u.values, (0..125).collect::<Vec<u16>>());
    assert_eq!((u.slave_id, u.function, u.start_address), (1, 3, 0));
    let seqs: Vec<u64> = f.rec.updates().iter().map(|u| u.seq).collect();
    assert!(seqs.windows(2).all(|w| w[0] < w[1]));

    // Traffic: exact TX bytes, then RX of 7 + 2 + 250 bytes.
    let frames = f.rec.frames();
    assert_eq!(frames[0].direction, TrafficDirection::Tx);
    assert_eq!(
        frames[0].bytes,
        [0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x01, 0x03, 0x00, 0x00, 0x00, 0x7D]
    );
    assert_eq!(frames[1].direction, TrafficDirection::Rx);
    assert_eq!(frames[1].bytes.len(), 259);
    assert!(frames.windows(2).all(|w| w[0].seq < w[1].seq));
    let snap = f.session.snapshot().await.unwrap();
    // A poll may be in flight: at most one request without its response yet.
    assert!(snap.counters.requests - snap.counters.responses <= 1);
    assert_eq!((snap.counters.errors, snap.counters.timeouts), (0, 0));
}

#[tokio::test(start_paused = true)]
async fn poll_scan_rate_is_respected() {
    let f = fixture();
    connected(&f, tcp_config(502, 1000)).await;
    let t0 = tokio::time::Instant::now();
    f.session.start_poll(poll03(10, 250)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(5), "5 updates", |r| {
        r.updates().len() >= 5
    })
    .await;
    // Cycles start at 0, 250, 500, 750, 1000 ms.
    let elapsed = t0.elapsed();
    assert!(
        elapsed >= Duration::from_millis(1000) && elapsed < Duration::from_millis(1100),
        "{elapsed:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn timeout_exception_and_recovery_with_failure_counts() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    f.slave.script([
        Behavior::Silent,
        Behavior::Silent,
        Behavior::Silent,
        Behavior::Exception(2),
        Behavior::Exception(2),
        Behavior::Respond,
    ]);
    f.session.start_poll(poll03(2, 100)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(10), "recovery", |r| {
        r.state_changes()
            .iter()
            .filter(|s| s.state == S::Polling)
            .count()
            >= 2
    })
    .await;
    let seq: Vec<(S, u32, Option<ExceptionCode>)> = f
        .rec
        .state_changes()
        .into_iter()
        .map(|s| (s.state, s.consecutive_failures, s.exception_code))
        .collect();
    assert_eq!(
        seq,
        [
            (S::Connecting, 0, None),
            (S::Connected, 0, None),
            (S::Polling, 0, None),
            (S::Timeout, 1, None),
            (S::Timeout, 2, None),
            (S::Timeout, 3, None),
            (S::Exception, 1, Some(ExceptionCode(2))),
            (S::Exception, 2, Some(ExceptionCode(2))),
            (S::Polling, 0, None),
        ]
    );
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.counters.timeouts, 3);
    assert!(snap.counters.errors >= 2);
}

#[tokio::test(start_paused = true)]
async fn timeout_keeps_retrying_at_scan_rate_and_never_disconnects() {
    let f = fixture();
    connected(&f, tcp_config(502, 50)).await;
    f.slave.set_default(Behavior::Silent);
    f.session.start_poll(poll03(1, 1000)).await.unwrap();
    tokio::time::sleep(Duration::from_millis(10_500)).await;
    let last = f.rec.last_state().unwrap();
    assert_eq!(last.state, S::Timeout);
    assert_eq!(last.consecutive_failures, 11); // cycles at 0, 1 s, ..., 10 s
    assert!(!f.rec.states().contains(&S::Disconnected));
}

#[tokio::test(start_paused = true)]
async fn rtu_bad_crc_wrong_slave_and_short_frame() {
    let f = fixture();
    connected(&f, rtu_config(500)).await;
    f.slave.script([
        Behavior::BadCrc,
        Behavior::WrongSlave(9),
        Behavior::Truncate(5),
        Behavior::Respond,
    ]);
    f.session.start_poll(poll03(4, 100)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(5), "recovery", |r| {
        r.state_changes()
            .iter()
            .filter(|s| s.state == S::Polling)
            .count()
            >= 2
    })
    .await;
    let bad: Vec<_> = f
        .rec
        .state_changes()
        .into_iter()
        .filter(|s| s.state == S::BadResponse)
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
    // The bad RX frames carry a note and their exact bytes.
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
    connected(&f, rtu_config(500)).await;
    let mut p = poll03(1, 100);
    p.slave_id = 0;
    let err = f.session.start_poll(p.clone()).await.unwrap_err();
    assert_eq!(
        err.to_string(),
        "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247."
    );
    assert!(f.slave.requests().is_empty(), "nothing must be sent");
    assert_eq!(f.rec.last_state().unwrap().state, S::Connected);
}

#[tokio::test(start_paused = true)]
async fn tcp_transaction_mismatch() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    f.slave.script([Behavior::WrongTransaction]);
    f.session.start_poll(poll03(1, 100)).await.unwrap();
    wait_state(&f.rec, S::BadResponse).await;
    assert_eq!(
        f.rec.last_state().unwrap().bad_response_kind,
        Some(BadResponseKind::TransactionMismatch)
    );
    wait_state(&f.rec, S::Polling).await;
}

#[tokio::test(start_paused = true)]
async fn link_drop_goes_to_disconnected_and_keeps_last_values() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    f.session.start_poll(poll03(3, 100)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(5), "update", |r| {
        !r.updates().is_empty()
    })
    .await;
    f.slave.script([Behavior::Close]);
    wait_state(&f.rec, S::Disconnected).await;
    let s = f.rec.last_state().unwrap();
    let reason = s.reason.unwrap();
    assert_eq!(reason.kind, ReasonKind::ClosedByPeer);
    assert_eq!(reason.phase, ReasonPhase::LinkLost);
    let snap = f.session.snapshot().await.unwrap();
    assert!(snap.last_update.is_some(), "stale values stay available");
    // No auto-reconnect (Q-01).
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(f.rec.last_state().unwrap().state, S::Disconnected);
    assert_eq!(
        f.session.write(write(1, 6, 0, vec![1])).await.unwrap(),
        WriteResult::NotConnected
    );

    // Reconnect (T14), then dismiss path on a second drop (T15).
    f.session.connect(tcp_config(502, 200)).await.unwrap();
    wait_state(&f.rec, S::Connected).await;
    f.slave.script([Behavior::Close]);
    f.session.start_poll(poll03(3, 100)).await.unwrap();
    wait_state(&f.rec, S::Disconnected).await;
    f.session.disconnect().await.unwrap();
    assert_eq!(f.rec.last_state().unwrap().state, S::Idle);
    assert!(f.session.snapshot().await.unwrap().last_update.is_none());
}

#[tokio::test(start_paused = true)]
async fn connect_failure_and_cancel() {
    let f = fixture();
    *f.connector.mode.lock().unwrap() = ConnectMode::Fail(ConnectError::Refused);
    f.session.connect(tcp_config(502, 1000)).await.unwrap();
    wait_state(&f.rec, S::Disconnected).await;
    let reason = f.rec.last_state().unwrap().reason.unwrap();
    assert_eq!(
        (reason.kind, reason.phase),
        (ReasonKind::Refused, ReasonPhase::ConnectFailed)
    );

    *f.connector.mode.lock().unwrap() = ConnectMode::Hang;
    f.session.connect(tcp_config(502, 1000)).await.unwrap();
    assert_eq!(f.rec.last_state().unwrap().state, S::Connecting);
    let err = f.session.connect(tcp_config(502, 1000)).await.unwrap_err();
    assert!(matches!(err, SessionError::InvalidState(_)));
    f.session.cancel_connect().await.unwrap();
    assert_eq!(f.rec.last_state().unwrap().state, S::Idle);
    assert_eq!(
        f.rec.states(),
        [S::Connecting, S::Disconnected, S::Connecting, S::Idle]
    );
}

#[tokio::test(start_paused = true)]
async fn invalid_input_is_rejected_before_sending() {
    let f = fixture();
    let err = f.session.connect(tcp_config(0, 1000)).await.unwrap_err();
    assert!(matches!(err, SessionError::Validation(_)));
    assert!(f.rec.states().is_empty());
    assert_eq!(
        f.session.start_poll(poll03(10, 100)).await.unwrap_err(),
        SessionError::NotConnected
    );
    connected(&f, tcp_config(502, 1000)).await;
    assert!(matches!(
        f.session.start_poll(poll03(126, 100)).await.unwrap_err(),
        SessionError::Validation(_)
    ));
    assert!(matches!(
        f.session
            .write(write(1, 16, 0, vec![0; 124]))
            .await
            .unwrap_err(),
        SessionError::Validation(_)
    ));
    assert!(f.slave.requests().is_empty());
}

#[tokio::test(start_paused = true)]
async fn writes_06_16_05_15_broadcast_and_errors() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    assert_eq!(
        f.session
            .write(write(1, 6, 100, vec![0xBEEF]))
            .await
            .unwrap(),
        WriteResult::Ok
    );
    assert_eq!(f.slave.holding_register(100), 0xBEEF);
    assert_eq!(
        f.session
            .write(write(1, 16, 200, vec![1, 2, 3]))
            .await
            .unwrap(),
        WriteResult::Ok
    );
    assert_eq!(
        (f.slave.holding_register(200), f.slave.holding_register(202)),
        (1, 3)
    );
    assert_eq!(
        f.session.write(write(1, 5, 7, vec![1])).await.unwrap(),
        WriteResult::Ok
    );
    assert!(f.slave.coil(7));
    assert_eq!(
        f.session
            .write(write(1, 15, 10, vec![1, 0, 1]))
            .await
            .unwrap(),
        WriteResult::Ok
    );
    assert!(f.slave.coil(12));

    // REV-001 F1: on Modbus TCP unit id 0 is not a broadcast; the reply is awaited.
    assert_eq!(
        f.session.write(write(0, 6, 5, vec![9])).await.unwrap(),
        WriteResult::Ok
    );
    assert_eq!(f.slave.holding_register(5), 9);

    f.slave.script([Behavior::Exception(3)]);
    assert_eq!(
        f.session.write(write(1, 6, 1, vec![1])).await.unwrap(),
        WriteResult::Exception {
            code: ExceptionCode(3)
        }
    );
    f.slave.script([Behavior::Silent]);
    assert_eq!(
        f.session.write(write(1, 6, 1, vec![1])).await.unwrap(),
        WriteResult::Timeout
    );
    f.slave.script([Behavior::WrongSlave(4)]);
    match f.session.write(write(1, 6, 1, vec![1])).await.unwrap() {
        WriteResult::BadResponse { kind, .. } => assert_eq!(kind, BadResponseKind::WrongSlave),
        other => panic!("{other:?}"),
    }
    // Writes never change the session state.
    assert_eq!(f.rec.last_state().unwrap().state, S::Connected);
}

#[tokio::test(start_paused = true)]
async fn write_runs_after_in_flight_poll_and_before_next_cycle() {
    let f = fixture();
    connected(&f, tcp_config(502, 1000)).await;
    f.slave
        .script([Behavior::Delay(Duration::from_millis(300))]);
    f.session.start_poll(poll03(2, 1000)).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await; // poll is in flight now
    let result = f.session.write(write(1, 6, 50, vec![7])).await.unwrap();
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
}

#[tokio::test(start_paused = true)]
async fn pause_resume_apply_and_disconnect() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    f.session.start_poll(poll03(2, 100)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(5), "update", |r| {
        !r.updates().is_empty()
    })
    .await;
    f.session.stop_poll().await.unwrap();
    let n = f.slave.requests().len();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(f.slave.requests().len(), n, "paused: nothing is sent");
    f.session.start_poll(poll03(2, 100)).await.unwrap(); // resume (T5)
    f.session.start_poll(poll03(5, 100)).await.unwrap(); // apply (T11)
    wait_for(&f.rec, Duration::from_secs(5), "5 values", |r| {
        r.updates().last().is_some_and(|u| u.values.len() == 5)
    })
    .await;
    f.session.disconnect().await.unwrap();
    assert_eq!(
        f.rec.states(),
        [
            S::Connecting,
            S::Connected,
            S::Polling,
            S::Paused,
            S::Polling,
            S::Polling,
            S::Idle
        ]
    );
    // Stop/cancel/disconnect are idempotent outside their states.
    f.session.stop_poll().await.unwrap();
    f.session.cancel_connect().await.unwrap();
    f.session.disconnect().await.unwrap();
    assert_eq!(f.rec.states().len(), 7);
}

#[tokio::test(start_paused = true)]
async fn counters_reset_and_batching() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    f.session.start_poll(poll03(2, 20)).await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;
    f.session.stop_poll().await.unwrap();
    let snap = f.session.snapshot().await.unwrap();
    assert!(snap.counters.requests >= 49, "{:?}", snap.counters);
    assert_eq!(snap.counters.requests, snap.counters.responses);

    // At most one TrafficFrames per 50 ms and one Counters per 100 ms.
    let mut traffic_events = 0;
    let mut counter_events = 0;
    for e in f.rec.events() {
        match e {
            shared_types::SessionEvent::TrafficFrames(_) => traffic_events += 1,
            shared_types::SessionEvent::Counters(_) => counter_events += 1,
            _ => {}
        }
    }
    assert!(traffic_events <= 21, "{traffic_events}");
    assert!(counter_events <= 11, "{counter_events}");
    // All frames arrive, none dropped.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(f.rec.frames().len() as u64, snap.counters.requests * 2);

    f.session.reset_counters().await.unwrap();
    match f.rec.events().last().unwrap() {
        shared_types::SessionEvent::Counters(c) => assert_eq!(c.requests, 0),
        other => panic!("{other:?}"),
    }
}

#[tokio::test(start_paused = true)]
async fn attach_replays_traffic_to_new_sink() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    f.session.write(write(1, 6, 1, vec![1])).await.unwrap();
    let rec2 = Arc::new(Recorder::default());
    let snap = f.session.attach(rec2.clone()).await.unwrap();
    assert_eq!(snap.current.state, S::Connected);
    assert_eq!(snap.config, Some(tcp_config(502, 200)));
    assert_eq!(rec2.frames().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn shutdown_closes_the_link() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    f.session.start_poll(poll03(2, 100)).await.unwrap();
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
    connected(&f, tcp_config(502, 200)).await;
    f.session.start_poll(poll03(2, 100)).await.unwrap();
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
    connected(&f, tcp_config(502, 1000)).await;
    f.session.start_poll(poll03(125, 100)).await.unwrap();
    tokio::time::sleep(Duration::from_secs(60)).await;
    f.session.stop_poll().await.unwrap();
    let stats = f.session.stats().await.unwrap();
    let updates = f.rec.updates();
    assert!((599..=601).contains(&updates.len()), "{}", updates.len());
    assert!(stats.max_pending_frames <= 4, "{stats:?}");
    assert_eq!(stats.queued_writes, 0);
    assert_eq!(
        stats.traffic_log_len,
        1200.min(modbus_master::TRAFFIC_LOG_CAPACITY)
    );
    // The last update is fresh: the engine kept up with the scan rate.
    let last = updates.last().unwrap();
    assert!(last.at >= 1_700_000_000_000 + 59_800, "{}", last.at);
}

/// REV-001 F1: a TCP server that answers unit 0 must not disturb polling.
#[tokio::test(start_paused = true)]
async fn tcp_unit_zero_write_while_polling_is_unicast() {
    let f = fixture();
    connected(&f, tcp_config(502, 200)).await;
    f.session.start_poll(poll03(2, 20)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(5), "update", |r| {
        !r.updates().is_empty()
    })
    .await;
    for i in 0..5 {
        let result = f.session.write(write(0, 6, 40, vec![i])).await.unwrap();
        assert_eq!(result, WriteResult::Ok, "write {i}");
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        f.rec.states(),
        [S::Connecting, S::Connected, S::Polling],
        "no spurious badResponse"
    );
    assert!(f.rec.frames().iter().all(|fr| fr.note.is_none()));
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!(snap.counters.errors, 0);
}

/// REV-001 F1 / Q-08: RTU slave 0 is a broadcast: no reply awaited, then a turnaround.
#[tokio::test(start_paused = true)]
async fn rtu_broadcast_returns_at_once_then_waits_turnaround() {
    let f = fixture();
    connected(&f, rtu_config(500)).await;
    let started = tokio::time::Instant::now();
    assert_eq!(
        f.session.write(write(0, 6, 5, vec![9])).await.unwrap(),
        WriteResult::BroadcastSent
    );
    assert!(
        started.elapsed() < Duration::from_millis(10),
        "returns at once"
    );
    assert_eq!(f.slave.holding_register(5), 9, "applied by the slave");
    assert_eq!(
        f.session.write(write(1, 6, 6, vec![1])).await.unwrap(),
        WriteResult::Ok
    );
    let times = f.slave.request_times();
    assert_eq!(times.len(), 2);
    assert!(
        times[1] - times[0] >= modbus_master::RTU_BROADCAST_TURNAROUND,
        "{:?}",
        times[1] - times[0]
    );
}

/// REV-001 F2: a late reply to an earlier transaction is skipped, not taken for the
/// current one, so a slow cycle costs one timeout and nothing more.
#[tokio::test(start_paused = true)]
async fn tcp_late_reply_is_discarded_and_wait_continues() {
    let f = fixture();
    connected(&f, tcp_config(502, 100)).await;
    // Cycle 1 is answered after 130 ms: the master has timed out and sent cycle 2 at
    // 100 ms, so the late reply arrives while cycle 2 is in flight.
    f.slave
        .script([Behavior::Delay(Duration::from_millis(130))]);
    f.session.start_poll(poll03(2, 100)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(5), "recovery", |r| {
        r.states().iter().filter(|s| **s == S::Polling).count() >= 2
    })
    .await;
    assert_eq!(
        f.rec.states(),
        [
            S::Connecting,
            S::Connected,
            S::Polling,
            S::Timeout,
            S::Polling
        ]
    );
    tokio::time::sleep(Duration::from_millis(60)).await; // traffic is batched per 50 ms
    let notes: Vec<String> = f
        .rec
        .frames()
        .into_iter()
        .filter_map(|fr| fr.note)
        .collect();
    assert_eq!(notes, ["Late reply to transaction 1 (discarded)"]);
    let snap = f.session.snapshot().await.unwrap();
    assert_eq!((snap.counters.timeouts, snap.counters.errors), (1, 0));
}

/// REV-001 F5: 125 registers at 2400 baud 8E1 (~1.17 s on the wire) with the default
/// 1000 ms timeout poll fine.
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
    connected(&f, config).await;
    let char_time = Duration::from_nanos(11 * 1_000_000_000 / 2400);
    f.slave.set_default(Behavior::Trickle(char_time));
    f.session.start_poll(poll03(125, 1000)).await.unwrap();
    wait_for(&f.rec, Duration::from_secs(10), "2 updates", |r| {
        r.updates().len() >= 2
    })
    .await;
    assert_eq!(f.rec.states(), [S::Connecting, S::Connected, S::Polling]);
    assert_eq!(f.rec.updates()[0].values.len(), 125);
    assert!(f.rec.updates()[0].round_trip_ms > 1000);
}

/// REV-001 F6: RTU requests keep the inter-frame gap, and a longer one after a timeout.
#[tokio::test(start_paused = true)]
async fn rtu_inter_frame_gap_before_each_request() {
    let f = fixture();
    connected(&f, rtu_config(100)).await; // 19200 baud: t3.5 = 2 ms, gap = 5 ms
    let (a, b) = tokio::join!(
        f.session.write(write(1, 6, 1, vec![1])),
        f.session.write(write(1, 6, 2, vec![2]))
    );
    assert_eq!((a.unwrap(), b.unwrap()), (WriteResult::Ok, WriteResult::Ok));
    f.slave.script([Behavior::Silent]);
    assert_eq!(
        f.session.write(write(1, 6, 3, vec![3])).await.unwrap(),
        WriteResult::Timeout
    );
    assert_eq!(
        f.session.write(write(1, 6, 4, vec![4])).await.unwrap(),
        WriteResult::Ok
    );
    let t = f.slave.request_times();
    assert_eq!(t.len(), 4);
    // The fake answers instantly, so the distance between requests is the master's gap.
    assert!(
        t[1] - t[0] >= modbus_master::RTU_MIN_GAP,
        "{:?}",
        t[1] - t[0]
    );
    // After a timeout: response timeout (+ request transmit time) + frame silence (50 ms).
    assert!(
        t[3] - t[2] >= Duration::from_millis(150),
        "{:?}",
        t[3] - t[2]
    );
}

/// REV-001 F9: the write in flight when the link drops is `linkLost`; a queued one that
/// never left is `notConnected`.
#[tokio::test(start_paused = true)]
async fn write_in_flight_when_link_drops_is_link_lost() {
    let f = fixture();
    connected(&f, tcp_config(502, 1000)).await;
    f.slave.script([Behavior::Close]);
    let (first, second) = tokio::join!(
        f.session.write(write(1, 6, 1, vec![1])),
        f.session.write(write(1, 6, 2, vec![2]))
    );
    assert_eq!(first.unwrap(), WriteResult::LinkLost);
    assert_eq!(second.unwrap(), WriteResult::NotConnected);
    wait_state(&f.rec, S::Disconnected).await;
}

/// A user disconnect while a write is in flight also answers `linkLost`.
#[tokio::test(start_paused = true)]
async fn disconnect_during_write_answers_link_lost() {
    let f = fixture();
    connected(&f, tcp_config(502, 1000)).await;
    f.slave.script([Behavior::Silent]);
    let write_fut = f.session.write(write(1, 6, 1, vec![1]));
    let disconnect = async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        f.session.disconnect().await.unwrap();
    };
    let (result, ()) = tokio::join!(write_fut, disconnect);
    assert_eq!(result.unwrap(), WriteResult::LinkLost);
    assert_eq!(f.rec.last_state().unwrap().state, S::Idle);
}
