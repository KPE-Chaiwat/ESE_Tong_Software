//! End to end: the real `modbus-master` session (system TCP connector, real clock) polls the
//! simulator over loopback and reaches the expected state for every fault.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dev_sim_slave::{start, SimConfig, SimHandle};
use modbus_master::{EventSink, Session, SessionDeps};
use shared_types::{
    BadResponseKind as K, ConnectionConfig, ExceptionCode, PollDefinition, ReasonKind,
    SessionEvent, SessionState as S, StateChanged, WriteRequest, WriteResult,
};

#[derive(Default)]
struct Recorder(Mutex<Vec<StateChanged>>);

impl EventSink for Recorder {
    fn send(&self, event: SessionEvent) -> bool {
        if let SessionEvent::StateChanged(s) = event {
            self.0.lock().unwrap().push(s);
        }
        true
    }
}

impl Recorder {
    fn all(&self) -> Vec<StateChanged> {
        self.0.lock().unwrap().clone()
    }
    fn count(&self, state: S) -> usize {
        self.all().iter().filter(|s| s.state == state).count()
    }
}

async fn wait(rec: &Recorder, what: &str, pred: impl Fn(&Recorder) -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    while !pred(rec) {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {what}: {:?}",
            rec.all().iter().map(|s| s.state).collect::<Vec<_>>()
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

fn config(sim: &SimHandle) -> ConnectionConfig {
    ConnectionConfig::Tcp {
        host: "127.0.0.1".into(),
        port: sim.modbus_addr.port(),
        timeout_ms: 150,
    }
}

/// Applies `fault` to one request and waits for the bad state and the recovery.
async fn fault_then_recover(sim: &SimHandle, rec: &Recorder, fault: &str, bad: S) {
    let polling_before = rec.count(S::Polling);
    let bad_before = rec.count(bad);
    assert!(sim
        .command(&format!("fault {fault} times=1"))
        .starts_with("ok"));
    wait(rec, fault, |r| {
        r.count(bad) > bad_before && r.count(S::Polling) > polling_before
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn session_reaches_every_state_against_the_simulator() {
    let sim = start(
        SimConfig {
            listen: SocketAddr::from(([127, 0, 0, 1], 0)),
            control: None,
            ..SimConfig::default()
        },
        Arc::new(|_: &str| {}),
    )
    .await
    .unwrap();
    let rec = Arc::new(Recorder::default());
    let session = Session::spawn(rec.clone(), SessionDeps::default());

    session.connect(config(&sim)).await.unwrap();
    wait(&rec, "connected", |r| r.count(S::Connected) == 1).await;
    session
        .start_poll(PollDefinition {
            slave_id: 1,
            function: 3,
            start_address: 0,
            quantity: 125,
            scan_rate_ms: 50,
        })
        .await
        .unwrap();
    wait(&rec, "polling", |r| r.count(S::Polling) == 1).await;

    // A write to unit 0 on TCP is unicast and confirmed (REV-001 F1).
    let w = session
        .write(WriteRequest {
            slave_id: 0,
            function: 6,
            address: 7,
            values: vec![77],
        })
        .await
        .unwrap();
    assert_eq!(w, WriteResult::Ok);
    assert_eq!(sim.command("get holding 7"), "ok 77");

    fault_then_recover(&sim, &rec, "drop", S::Timeout).await;
    fault_then_recover(&sim, &rec, "exception 2", S::Exception).await;
    fault_then_recover(&sim, &rec, "wrong-unit 9", S::BadResponse).await;
    fault_then_recover(&sim, &rec, "wrong-txn", S::BadResponse).await;
    fault_then_recover(&sim, &rec, "wrong-function", S::BadResponse).await;
    // 9 bytes: the MBAP header is complete, so the full length (259) is known.
    fault_then_recover(&sim, &rec, "truncate 9", S::BadResponse).await;
    // Protocol id 5 in an otherwise complete frame; txn FFFF was never sent.
    fault_then_recover(
        &sim,
        &rec,
        "garbage FF FF 00 05 00 03 01 03 00",
        S::BadResponse,
    )
    .await;
    // Longer than the 150 ms timeout: one timeout, then the late reply is discarded while
    // the next request is in flight (REV-001 F2) and polling recovers.
    fault_then_recover(&sim, &rec, "delay 200", S::Timeout).await;

    // Socket closed mid-reply: link lost.
    assert!(sim.command("fault close times=1").starts_with("ok"));
    wait(&rec, "disconnected", |r| r.count(S::Disconnected) == 1).await;

    // Device gone: reconnect is refused; after resume it works again.
    assert!(sim.command("stop").starts_with("ok"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    session
        .connect(ConnectionConfig::Tcp {
            host: "127.0.0.1".into(),
            port: sim.modbus_addr.port(),
            timeout_ms: 5000,
        })
        .await
        .unwrap();
    wait(&rec, "refused", |r| r.count(S::Disconnected) == 2).await;
    assert!(sim.command("resume").starts_with("ok"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    session.connect(config(&sim)).await.unwrap();
    wait(&rec, "reconnected", |r| r.count(S::Connected) == 2).await;

    // Assert the whole sequence, with the details of each bad state.
    let changes = rec.all();
    let states: Vec<S> = changes.iter().map(|s| s.state).collect();
    assert_eq!(
        states,
        [
            S::Connecting,
            S::Connected,
            S::Polling,
            S::Timeout,
            S::Polling,
            S::Exception,
            S::Polling,
            S::BadResponse,
            S::Polling,
            S::BadResponse,
            S::Polling,
            S::BadResponse,
            S::Polling,
            S::BadResponse,
            S::Polling,
            S::BadResponse,
            S::Polling,
            S::Timeout,
            S::Polling,
            S::Disconnected,
            S::Connecting,
            S::Disconnected,
            S::Connecting,
            S::Connected,
        ]
    );
    assert_eq!(changes[5].exception_code, Some(ExceptionCode(2)));
    let kinds: Vec<K> = changes.iter().filter_map(|s| s.bad_response_kind).collect();
    assert_eq!(
        kinds,
        [
            K::WrongSlave,
            K::TransactionMismatch,
            K::WrongFunction,
            K::ShortFrame,
            K::Malformed
        ]
    );
    let short = changes[13].bad_response_detail.clone().unwrap();
    assert_eq!((short.got, short.expected), (Some(9), Some(259)));
    assert_eq!(
        changes[19].reason.as_ref().unwrap().kind,
        ReasonKind::ClosedByPeer
    );
    assert_eq!(
        changes[21].reason.as_ref().unwrap().kind,
        ReasonKind::Refused
    );
    session.shutdown().await;
}
