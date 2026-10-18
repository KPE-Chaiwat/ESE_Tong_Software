//! End to end: the real `modbus-master` session (system TCP connector, real clock) polls the
//! simulator over loopback and reaches the expected poll and connection state for every
//! fault (BE-001 scenario on the BE-002 session: one poll).

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dev_sim_slave::{start, SimConfig, SimHandle};
use modbus_master::{EventSink, Session, SessionDeps};
use shared_types::{
    BadResponseKind as K, ConnectionConfig, ConnectionState as C, ConnectionStatus,
    DisplaySettings, ExceptionCode, PollConfigInput, PollDefinition, PollHostKind, PollState as S,
    PollStatus, ReasonKind, SessionEvent, ValueColumns, WriteRequest, WriteResult,
};

#[derive(Default)]
struct Recorder {
    polls: Mutex<Vec<PollStatus>>,
    connection: Mutex<Vec<ConnectionStatus>>,
}

impl EventSink<SessionEvent> for Recorder {
    fn send(&self, event: SessionEvent) -> bool {
        match event {
            SessionEvent::PollStateChanged(s) => self.polls.lock().unwrap().push(s),
            SessionEvent::ConnectionStateChanged(s) => self.connection.lock().unwrap().push(s),
            _ => {}
        }
        true
    }
}

impl Recorder {
    fn polls(&self) -> Vec<PollStatus> {
        self.polls.lock().unwrap().clone()
    }
    fn connection(&self) -> Vec<ConnectionStatus> {
        self.connection.lock().unwrap().clone()
    }
    fn count(&self, state: S) -> usize {
        self.polls().iter().filter(|s| s.state == state).count()
    }
    fn count_conn(&self, state: C) -> usize {
        self.connection()
            .iter()
            .filter(|s| s.state == state)
            .count()
    }
}

async fn wait(rec: &Recorder, what: &str, pred: impl Fn(&Recorder) -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    while !pred(rec) {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {what}: {:?} / {:?}",
            rec.polls().iter().map(|s| s.state).collect::<Vec<_>>(),
            rec.connection().iter().map(|s| s.state).collect::<Vec<_>>()
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
    wait(&rec, "connected", |r| r.count_conn(C::Connected) == 1).await;
    let id = session
        .add_poll(
            PollConfigInput {
                name: "Poll 1".into(),
                definition: PollDefinition {
                    slave_id: 1,
                    function: 3,
                    start_address: 0,
                    quantity: 125,
                    scan_rate_ms: 50,
                },
                display: DisplaySettings::default(),
                color_rules: Vec::new(),
                scale: None,
                scale_overrides: vec![],
                value_columns: ValueColumns::Raw,
                aliases: vec![],
            },
            PollHostKind::Workspace,
        )
        .await
        .unwrap();
    session.set_poll_active(id, true).await.unwrap();
    wait(&rec, "polling", |r| r.count(S::Polling) == 1).await;

    // A write to unit 0 on TCP is unicast and confirmed (REV-001 F1).
    let w = session
        .write(
            WriteRequest {
                slave_id: 0,
                function: 6,
                address: 7,
                values: vec![77],
            },
            Some(id),
        )
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
    assert_eq!(
        rec.count_conn(C::Disconnected),
        0,
        "poll failures never touch the link"
    );

    // Socket closed mid-reply: link lost, the poll goes offline.
    assert!(sim.command("fault close times=1").starts_with("ok"));
    wait(&rec, "disconnected", |r| r.count_conn(C::Disconnected) == 1).await;
    wait(&rec, "offline", |r| r.count(S::Offline) == 1).await;

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
    wait(&rec, "refused", |r| r.count_conn(C::Disconnected) == 2).await;
    assert!(sim.command("resume").starts_with("ok"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    session.connect(config(&sim)).await.unwrap();
    wait(&rec, "reconnected", |r| r.count_conn(C::Connected) == 2).await;
    // autoStartPoll is off: the poll comes back paused (PT1), `active` unchanged.
    wait(&rec, "paused", |r| r.count(S::Paused) == 1).await;

    let conn: Vec<C> = rec.connection().iter().map(|s| s.state).collect();
    assert_eq!(
        conn,
        [
            C::Connecting,
            C::Connected,
            C::Disconnected,
            C::Connecting,
            C::Disconnected,
            C::Connecting,
            C::Connected,
        ]
    );
    let changes = rec.polls();
    let states: Vec<S> = changes.iter().map(|s| s.state).collect();
    assert_eq!(
        states,
        [
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
            S::Offline,
            S::Paused,
        ]
    );
    assert_eq!(changes[3].exception_code, Some(ExceptionCode(2)));
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
    let short = changes[11].bad_response_detail.clone().unwrap();
    assert_eq!((short.got, short.expected), (Some(9), Some(259)));
    let reasons = rec.connection();
    assert_eq!(
        reasons[2].reason.as_ref().unwrap().kind,
        ReasonKind::ClosedByPeer
    );
    assert_eq!(
        reasons[4].reason.as_ref().unwrap().kind,
        ReasonKind::Refused
    );
    session.shutdown().await;
}
