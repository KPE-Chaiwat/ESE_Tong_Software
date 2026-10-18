//! REPORT-006 D1 / DES-002 R10-1: real-time scan rate accuracy against the simulator over
//! loopback (system TCP connector, real clock, the app's OS timer precision
//! `esefact_desktop_lib::os_timer::SystemTimerResolution`). One poll alone per scan rate;
//! the request intervals are taken from the moment the simulator receives each request.
//!
//! **Wall clock, so ignored by default (REV-008 m-2):** its bounds depend on how busy the
//! machine is, and it takes about 20 s. The default gate is the deterministic virtual-time
//! model `modbus_master::scheduler` `timer_lateness_does_not_add_up` (plus the paused-clock
//! session tests). Run it on an otherwise idle machine (QA, before a release):
//! `cargo test --workspace --test scan_rate -- --ignored --nocapture` (or with
//! `-p dev-sim-slave`, which may build a second copy of the app crate).
//!
//! Before the fix, Windows quantized every sleep to its 15.6 ms timer tick: scan 20 / 50 /
//! 100 / 250 / 500 ms gave mean intervals of 31.2 / 62.4 / 109.1 / 260.4 / 508.6 ms. The
//! bounds are those of D-002-20 / CHK2-D10 (mean <= S + 4 ms, shortest >= S - 2 ms) plus
//! 90 % of intervals <= S + 8 ms; each rate gets up to three attempts so that a burst of
//! load on a shared machine does not fail the test, while the quantization fails every
//! attempt. The measured numbers are printed (`--nocapture`); about 20 s.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dev_sim_slave::{start, SimConfig};
use esefact_desktop_lib::os_timer::SystemTimerResolution;
use modbus_master::{EventSink, Session, SessionDeps};
use shared_types::{
    ConnectionConfig, ConnectionState, DisplaySettings, PollConfigInput, PollDefinition,
    PollHostKind, SessionEvent, ValueColumns,
};

struct Rec(Mutex<Vec<SessionEvent>>);

impl EventSink<SessionEvent> for Rec {
    fn send(&self, event: SessionEvent) -> bool {
        self.0.lock().unwrap().push(event);
        true
    }
}

impl Rec {
    fn connected(&self) -> bool {
        self.0.lock().unwrap().iter().any(|e| {
            matches!(e, SessionEvent::ConnectionStateChanged(s) if s.state == ConnectionState::Connected)
        })
    }
}

fn input(scan: u32) -> PollConfigInput {
    PollConfigInput {
        name: format!("Scan {scan}"),
        definition: PollDefinition {
            slave_id: 1,
            function: 3,
            start_address: 0,
            quantity: 10,
            scan_rate_ms: scan,
        },
        display: DisplaySettings::default(),
        color_rules: Vec::new(),
        scale: None,
        scale_overrides: vec![],
        value_columns: ValueColumns::Raw,
        aliases: vec![],
    }
}

#[derive(Debug)]
struct Stats {
    mean: f64,
    min: f64,
    p90: f64,
    max: f64,
    n: usize,
}

fn stats(arrivals: &[Instant]) -> Stats {
    let mut gaps: Vec<f64> = arrivals
        .windows(2)
        .map(|w| (w[1] - w[0]).as_secs_f64() * 1000.0)
        .collect();
    let n = gaps.len();
    #[allow(clippy::cast_precision_loss)]
    let mean = (arrivals[arrivals.len() - 1] - arrivals[0]).as_secs_f64() * 1000.0 / n as f64;
    gaps.sort_by(f64::total_cmp);
    Stats {
        mean,
        min: gaps[0],
        p90: gaps[n * 9 / 10],
        max: gaps[n - 1],
        n,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "wall clock: run with --ignored on an idle machine (see the module docs)"]
async fn one_poll_keeps_its_scan_rate_in_real_time() {
    let arrivals: Arc<Mutex<Vec<Instant>>> = Arc::default();
    let sink = arrivals.clone();
    let sim = start(
        SimConfig {
            listen: SocketAddr::from(([127, 0, 0, 1], 0)),
            control: None,
            ..SimConfig::default()
        },
        Arc::new(move |line: &str| {
            if line.contains(" RX ") {
                sink.lock().unwrap().push(Instant::now());
            }
        }),
    )
    .await
    .unwrap();
    let rec = Arc::new(Rec(Mutex::new(Vec::new())));
    let session = Session::spawn(
        rec.clone(),
        SessionDeps {
            timer: Arc::new(SystemTimerResolution),
            ..SessionDeps::default()
        },
    );
    session
        .connect(ConnectionConfig::Tcp {
            host: "127.0.0.1".into(),
            port: sim.modbus_addr.port(),
            timeout_ms: 500,
        })
        .await
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !rec.connected() {
        assert!(Instant::now() < deadline, "not connected");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }

    // (scan, measuring time): at least 10 intervals each. Each rate gets up to three
    // attempts so that a burst of load on a shared machine does not fail the test; the 15.6
    // ms quantization of D1 fails every attempt.
    for (scan, run) in [
        (20u32, 2_000u64),
        (50, 2_500),
        (100, 3_000),
        (250, 4_000),
        (500, 6_000),
    ] {
        let mut attempts = Vec::new();
        let passed = loop {
            let id = session
                .add_poll(input(scan), PollHostKind::Workspace)
                .await
                .unwrap();
            session.set_poll_active(id, true).await.unwrap();
            // Skip the first cycles (warm-up), then measure.
            tokio::time::sleep(Duration::from_millis(u64::from(scan) * 2 + 20)).await;
            arrivals.lock().unwrap().clear();
            tokio::time::sleep(Duration::from_millis(run)).await;
            let seen = arrivals.lock().unwrap().clone();
            // `effectiveScanMs` (mean of the last 10 intervals, measured by the session).
            let effective = session
                .snapshot()
                .await
                .unwrap()
                .counters
                .polls
                .iter()
                .find(|p| p.poll_id == id)
                .and_then(|p| p.effective_scan_ms);
            session.remove_poll(id).await.unwrap();
            tokio::time::sleep(Duration::from_millis(50)).await;

            let s = stats(&seen);
            eprintln!(
                "scan {scan} ms: {} intervals, mean {:.2}, min {:.2}, p90 {:.2}, max {:.2} ms, effectiveScanMs {effective:?}",
                s.n, s.mean, s.min, s.p90, s.max
            );
            let f = f64::from(scan);
            // D-002-20 / CHK2-D10: mean <= S + 4, shortest >= S - 2; and the reported
            // effective rate agrees with the wire (whole ms).
            let ok = s.n >= 10
                && s.mean >= f - 1.0
                && s.mean <= f + 4.0
                && s.min >= f - 2.0
                && s.p90 <= f + 8.0
                && effective.is_some_and(|e| e + 1 >= scan && e <= scan + 4);
            attempts.push((s, effective));
            if ok || attempts.len() == 3 {
                break ok;
            }
        };
        assert!(
            passed,
            "scan {scan} ms (the 15.6 ms tick gives 31.2 / 62.4 / 109.1 / 260.4 / 508.6): {attempts:?}"
        );
    }
}
