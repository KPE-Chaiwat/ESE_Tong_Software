//! BE-002-6: many polls on one connection against the simulator over real loopback sockets
//! (system TCP connector, real clock). "No request overlap" is asserted from the simulator
//! log, which records `OVERLAP` when a request arrives before the previous reply was sent.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dev_sim_slave::{start, SimConfig, SimHandle};
use modbus_master::{EventSink, Session, SessionDeps};
use shared_types::{
    ConnectionConfig, ConnectionState as C, DisplaySettings, PollConfigInput, PollDefinition,
    PollHostKind, PollId, PollState as S, PollViewEvent, SessionEvent, ValueColumns, WriteRequest,
    WriteResult,
};

struct Rec<E>(Mutex<Vec<E>>);

impl<E> Default for Rec<E> {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

impl<E: Send + 'static> EventSink<E> for Rec<E> {
    fn send(&self, event: E) -> bool {
        self.0.lock().unwrap().push(event);
        true
    }
}

impl Rec<SessionEvent> {
    fn last_poll_state(&self, id: PollId) -> Option<S> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                SessionEvent::PollStateChanged(s) if s.poll_id == id => Some(s.state),
                _ => None,
            })
            .next_back()
    }
    fn last_connection(&self) -> Option<C> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                SessionEvent::ConnectionStateChanged(s) => Some(s.state),
                _ => None,
            })
            .next_back()
    }
    fn connection_count(&self, state: C) -> usize {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|e| matches!(e, SessionEvent::ConnectionStateChanged(s) if s.state == state))
            .count()
    }
}

impl Rec<PollViewEvent> {
    fn updates(&self) -> usize {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|e| matches!(e, PollViewEvent::PollUpdate(_)))
            .count()
    }
}

async fn wait(what: &str, pred: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    while !pred() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {what}"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

fn input(name: &str, unit: u8, start: u16, scan: u32) -> PollConfigInput {
    PollConfigInput {
        name: name.into(),
        definition: PollDefinition {
            slave_id: unit,
            function: 3,
            start_address: start,
            quantity: 10,
            scan_rate_ms: scan,
        },
        display: DisplaySettings::default(),
        scale: None,
        scale_overrides: vec![],
        value_columns: ValueColumns::Raw,
        aliases: vec![],
    }
}

/// Request start addresses (FC03, from the RX hex) in log order since `from`.
fn requested_addresses(lines: &[String], from: usize) -> Vec<u16> {
    lines[from..]
        .iter()
        .filter(|l| l.contains(" RX "))
        .filter_map(|l| {
            let hex = l.split(" | ").nth(1)?;
            let bytes: Vec<u8> = hex
                .split_whitespace()
                .filter_map(|b| u8::from_str_radix(b, 16).ok())
                .collect();
            (bytes.len() >= 10 && bytes[7] == 3).then(|| u16::from_be_bytes([bytes[8], bytes[9]]))
        })
        .collect()
}

async fn states(session: &Session) -> HashMap<PollId, S> {
    session
        .snapshot()
        .await
        .unwrap()
        .polls
        .iter()
        .map(|p| (p.config.poll_id, p.status.state))
        .collect()
}

fn overlaps(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .filter(|l| l.contains("OVERLAP"))
        .cloned()
        .collect()
}

#[allow(clippy::too_many_lines)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn many_polls_against_the_simulator() {
    let lines: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = lines.clone();
    let sim: SimHandle = start(
        SimConfig {
            listen: SocketAddr::from(([127, 0, 0, 1], 0)),
            control: None,
            ..SimConfig::default()
        },
        Arc::new(move |l: &str| sink.lock().unwrap().push(l.to_owned())),
    )
    .await
    .unwrap();
    let log = || lines.lock().unwrap().clone();
    let rec = Arc::new(Rec::<SessionEvent>::default());
    let session = Session::spawn(rec.clone(), SessionDeps::default());
    session.set_auto_start_poll(true).await.unwrap();
    let config = ConnectionConfig::Tcp {
        host: "127.0.0.1".into(),
        port: sim.modbus_addr.port(),
        timeout_ms: 300,
    };
    session.connect(config.clone()).await.unwrap();
    wait("connected", || rec.last_connection() == Some(C::Connected)).await;

    // Phase A: 8 polls at mixed rates; every reply delayed 3 ms so that a pipelined request
    // would be caught by the simulator.
    assert!(sim.command("fault delay 3").starts_with("ok"));
    let scans = [20u32, 50, 100, 100, 200, 250, 500, 1000];
    let mut ids = Vec::new();
    for (i, scan) in scans.iter().enumerate() {
        let start = u16::try_from(i).unwrap() * 100;
        let id = session
            .add_poll(
                input(&format!("P{i}"), 1, start, *scan),
                PollHostKind::Workspace,
            )
            .await
            .unwrap();
        ids.push(id);
    }
    let view = Arc::new(Rec::<PollViewEvent>::default());
    session
        .attach_view(ids[2], PollHostKind::Workspace, view.clone())
        .await
        .unwrap();
    let from = log().len();
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let seen = requested_addresses(&log(), from);
    let mut per_poll: HashMap<u16, usize> = HashMap::new();
    for a in &seen {
        *per_poll.entry(*a).or_default() += 1;
    }
    for i in 0..8u16 {
        assert!(
            per_poll.get(&(i * 100)).copied().unwrap_or(0) >= 2,
            "poll {i} starved: {per_poll:?}"
        );
    }
    assert!(overlaps(&log()).is_empty(), "{:?}", overlaps(&log()));
    let now = states(&session).await;
    for id in &ids {
        assert_eq!(now[id], S::Polling);
    }

    // Phase B: 16 polls, one on unit 3 that the simulator fails; pop out / dock the viewed
    // poll while everything runs.
    for i in 8..15u16 {
        let id = session
            .add_poll(
                input(&format!("P{i}"), 1, i * 100, 100 + u32::from(i) * 10),
                PollHostKind::Workspace,
            )
            .await
            .unwrap();
        ids.push(id);
    }
    let failing = session
        .add_poll(input("Unit 3", 3, 0, 100), PollHostKind::Workspace)
        .await
        .unwrap();
    assert!(sim.command("fault exception 4 unit=3").starts_with("ok"));
    let mut seq_before = view.updates();
    for _ in 0..3 {
        tokio::time::sleep(Duration::from_millis(300)).await;
        session
            .set_native_open(ids[2], Some("h".into()))
            .await
            .unwrap();
        let native = Arc::new(Rec::<PollViewEvent>::default());
        let snap = session
            .attach_view(ids[2], PollHostKind::Native, native.clone())
            .await
            .unwrap();
        assert!(snap.last_update.is_some());
        assert_eq!(snap.handoff.as_deref(), Some("h"));
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(native.updates() > 0, "the native view gets values");
        session.dock(ids[2], None, None, None).await.unwrap();
        session
            .attach_view(ids[2], PollHostKind::Workspace, view.clone())
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(view.updates() > seq_before);
        seq_before = view.updates();
    }
    wait("unit 3 failing", || {
        rec.last_poll_state(failing) == Some(S::Exception)
    })
    .await;
    let now = states(&session).await;
    for id in &ids {
        assert_eq!(now[id], S::Polling, "{id:?}");
    }
    assert_eq!(rec.connection_count(C::Disconnected), 0);
    assert!(overlaps(&log()).is_empty(), "{:?}", overlaps(&log()));

    // Phase C: remove, duplicate and reorder while running.
    let removed = ids.remove(5);
    session.remove_poll(removed).await.unwrap();
    let copy = session.duplicate_poll(ids[0]).await.unwrap();
    let mut order: Vec<PollId> = session
        .snapshot()
        .await
        .unwrap()
        .polls
        .iter()
        .map(|p| p.config.poll_id)
        .collect();
    order.reverse();
    session.reorder_polls(order).await.unwrap();
    let from = log().len();
    tokio::time::sleep(Duration::from_millis(1000)).await;
    let seen = requested_addresses(&log(), from);
    assert!(!seen.contains(&500), "a removed poll is not sent any more");
    assert_eq!(states(&session).await[&copy], S::Polling);

    // Phase D: writes interleave with the polls.
    for v in 1..=5u16 {
        let r = session
            .write(
                WriteRequest {
                    slave_id: 1,
                    function: 6,
                    address: 9000,
                    values: vec![v],
                },
                Some(ids[1]),
            )
            .await
            .unwrap();
        assert_eq!(r, WriteResult::Ok);
    }
    assert_eq!(sim.command("get holding 9000"), "ok 5");
    assert!(overlaps(&log()).is_empty(), "{:?}", overlaps(&log()));

    // Phase E: link drop takes every poll offline; reconnect restores them per `active`.
    session.set_poll_active(ids[0], false).await.unwrap();
    assert!(sim.command("fault close times=1").starts_with("ok"));
    wait("disconnected", || {
        rec.last_connection() == Some(C::Disconnected)
    })
    .await;
    let snap = session.snapshot().await.unwrap();
    assert!(snap.polls.iter().all(|p| p.status.state == S::Offline));
    session.connect(config).await.unwrap();
    wait("reconnected", || {
        rec.last_connection() == Some(C::Connected)
    })
    .await;
    assert!(sim.command("clear").starts_with("ok"));
    let snap = session.snapshot().await.unwrap();
    for p in &snap.polls {
        let expected = if p.config.poll_id == ids[0] {
            S::Paused
        } else {
            S::Polling
        };
        assert_eq!(p.status.state, expected, "{}", p.config.name);
    }
    let stats = session.stats().await.unwrap();
    assert_eq!(stats.polls, 16);
    session.shutdown().await;
}
