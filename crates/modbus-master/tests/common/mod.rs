//! Shared test helpers: event recorders for both channels, an in-memory connector with a
//! fake slave, and poll builders.

#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use modbus_master::{Connector, EventSink, Session, SessionDeps, TimerResolution, TokioClock};
use shared_types::{
    ConnectionConfig, ConnectionCounters, ConnectionState, ConnectionStatus, DisplaySettings,
    Parity, PollConfigInput, PollDefinition, PollId, PollState, PollStatus, PollSummary,
    PollUpdate, PollViewEvent, SessionEvent, TrafficFrame, ValueColumns,
};
use tokio::task::JoinHandle;
use transport::fake::FakeSlave;
use transport::{ConnectError, Framing, Link, LinkKind, Role, StreamLink};

pub struct Recorder<E> {
    pub events: Mutex<Vec<E>>,
    pub alive: Mutex<bool>,
}

impl<E> Default for Recorder<E> {
    fn default() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
            alive: Mutex::new(true),
        }
    }
}

impl<E: Send + 'static> EventSink<E> for Recorder<E> {
    fn send(&self, event: E) -> bool {
        let alive = *self.alive.lock().unwrap();
        if alive {
            self.events.lock().unwrap().push(event);
        }
        alive
    }
}

impl<E: Clone> Recorder<E> {
    pub fn events(&self) -> Vec<E> {
        self.events.lock().unwrap().clone()
    }

    pub fn clear(&self) {
        self.events.lock().unwrap().clear();
    }

    /// Simulates a window that died without detaching.
    pub fn kill(&self) {
        *self.alive.lock().unwrap() = false;
    }
}

pub type SessionRec = Recorder<SessionEvent>;
pub type ViewRec = Recorder<PollViewEvent>;

impl Recorder<SessionEvent> {
    pub fn connection(&self) -> Vec<ConnectionStatus> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SessionEvent::ConnectionStateChanged(s) => Some(s),
                _ => None,
            })
            .collect()
    }

    pub fn connection_states(&self) -> Vec<ConnectionState> {
        self.connection().into_iter().map(|s| s.state).collect()
    }

    pub fn last_connection(&self) -> Option<ConnectionState> {
        self.connection_states().pop()
    }

    pub fn poll_statuses(&self, id: PollId) -> Vec<PollStatus> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SessionEvent::PollStateChanged(s) if s.poll_id == id => Some(s),
                _ => None,
            })
            .collect()
    }

    pub fn poll_states(&self, id: PollId) -> Vec<PollState> {
        self.poll_statuses(id)
            .into_iter()
            .map(|s| s.state)
            .collect()
    }

    pub fn last_poll_state(&self, id: PollId) -> Option<PollState> {
        self.poll_states(id).pop()
    }

    pub fn frames(&self) -> Vec<TrafficFrame> {
        self.events()
            .into_iter()
            .flat_map(|e| match e {
                SessionEvent::TrafficFrames(b) => b.frames,
                _ => Vec::new(),
            })
            .collect()
    }

    pub fn last_list(&self) -> Option<Vec<PollSummary>> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SessionEvent::PollListChanged(l) => Some(l.polls),
                _ => None,
            })
            .next_back()
    }

    pub fn last_counters(&self) -> Option<ConnectionCounters> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SessionEvent::Counters(c) => Some(c),
                _ => None,
            })
            .next_back()
    }
}

impl Recorder<PollViewEvent> {
    pub fn updates(&self) -> Vec<PollUpdate> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                PollViewEvent::PollUpdate(u) => Some(u),
                _ => None,
            })
            .collect()
    }

    pub fn states(&self) -> Vec<PollState> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                PollViewEvent::PollStateChanged(s) => Some(s.state),
                _ => None,
            })
            .collect()
    }
}

/// Waits (in tokio time) until `pred` holds, panicking after `max`.
pub async fn wait_until(max: Duration, what: &str, pred: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + max;
    while !pred() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {what}"
        );
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

pub async fn wait_connection(rec: &SessionRec, state: ConnectionState) {
    wait_until(Duration::from_secs(30), &format!("{state:?}"), || {
        rec.last_connection() == Some(state)
    })
    .await;
}

pub async fn wait_poll(rec: &SessionRec, id: PollId, state: PollState) {
    wait_until(
        Duration::from_secs(30),
        &format!("{id:?} {state:?}"),
        || rec.last_poll_state(id) == Some(state),
    )
    .await;
}

/// What the in-memory connector does on connect.
#[derive(Debug, Clone)]
pub enum ConnectMode {
    Ok,
    Fail(ConnectError),
    Hang,
}

/// Connects to a fake slave through an in-memory duplex stream.
pub struct MemoryConnector {
    pub slave: FakeSlave,
    pub mode: Mutex<ConnectMode>,
    pub servers: Mutex<Vec<JoinHandle<()>>>,
}

impl MemoryConnector {
    pub fn new(slave: FakeSlave) -> Arc<Self> {
        Arc::new(Self {
            slave,
            mode: Mutex::new(ConnectMode::Ok),
            servers: Mutex::new(Vec::new()),
        })
    }
}

#[async_trait]
impl Connector for MemoryConnector {
    async fn connect(&self, config: &ConnectionConfig) -> Result<Box<dyn Link>, ConnectError> {
        let mode = self.mode.lock().unwrap().clone();
        match mode {
            ConnectMode::Fail(e) => return Err(e),
            ConnectMode::Hang => std::future::pending::<()>().await,
            ConnectMode::Ok => {}
        }
        let framing = match config {
            ConnectionConfig::Tcp { .. } => Framing::Tcp,
            ConnectionConfig::Rtu { baud, .. } => Framing::rtu_for_baud(*baud),
        };
        let (a, b) = tokio::io::duplex(8192);
        let slave = self.slave.clone();
        self.servers
            .lock()
            .unwrap()
            .push(tokio::spawn(async move { slave.serve(b, framing).await }));
        Ok(Box::new(StreamLink::new(
            a,
            framing,
            Role::Master,
            LinkKind::Memory,
        )))
    }
}

pub struct Fixture {
    pub session: Session,
    pub rec: Arc<SessionRec>,
    pub connector: Arc<MemoryConnector>,
    pub slave: FakeSlave,
}

/// A session on a paused clock with an in-memory fake slave answering slave id 1.
pub fn fixture() -> Fixture {
    fixture_with_timer(Arc::new(CountingTimer::default()))
}

/// Counts `TimerResolution` calls (acquired, released).
#[derive(Default)]
pub struct CountingTimer {
    pub acquired: AtomicUsize,
    pub released: AtomicUsize,
}

impl CountingTimer {
    /// (acquired, released) so far.
    pub fn counts(&self) -> (usize, usize) {
        (
            self.acquired.load(Ordering::SeqCst),
            self.released.load(Ordering::SeqCst),
        )
    }
}

impl TimerResolution for CountingTimer {
    fn acquire(&self) {
        self.acquired.fetch_add(1, Ordering::SeqCst);
    }
    fn release(&self) {
        self.released.fetch_add(1, Ordering::SeqCst);
    }
}

/// [`fixture`] with a given timer precision implementation.
pub fn fixture_with_timer(timer: Arc<dyn TimerResolution>) -> Fixture {
    let slave = FakeSlave::new(1);
    let connector = MemoryConnector::new(slave.clone());
    let rec = Arc::new(SessionRec::default());
    let session = Session::spawn(
        rec.clone(),
        SessionDeps {
            clock: Arc::new(TokioClock::new(1_700_000_000_000)),
            connector: connector.clone(),
            timer,
        },
    );
    Fixture {
        session,
        rec,
        connector,
        slave,
    }
}

impl Fixture {
    pub async fn connected(&self, config: ConnectionConfig) {
        self.session.connect(config).await.unwrap();
        wait_connection(&self.rec, ConnectionState::Connected).await;
    }

    /// Adds a poll and starts it (Resume).
    pub async fn running(&self, name: &str, def: PollDefinition) -> PollId {
        let id = self
            .session
            .add_poll(input(name, def), shared_types::PollHostKind::Workspace)
            .await
            .unwrap();
        self.session.set_poll_active(id, true).await.unwrap();
        id
    }

    /// Attaches a recording view in the poll's current host.
    pub async fn view(&self, id: PollId) -> Arc<ViewRec> {
        let rec = Arc::new(ViewRec::default());
        let host = self
            .session
            .hosts()
            .await
            .unwrap()
            .into_iter()
            .find(|h| h.poll_id == id)
            .unwrap()
            .host;
        self.session
            .attach_view(id, host, rec.clone())
            .await
            .unwrap();
        rec
    }
}

pub fn tcp_config(port: u16, timeout_ms: u32) -> ConnectionConfig {
    ConnectionConfig::Tcp {
        host: "127.0.0.1".into(),
        port,
        timeout_ms,
    }
}

pub fn rtu_config(timeout_ms: u32) -> ConnectionConfig {
    ConnectionConfig::Rtu {
        port: "COM9".into(),
        baud: 19200,
        data_bits: 8,
        parity: Parity::Even,
        stop_bits: 1,
        timeout_ms,
    }
}

pub fn poll03(quantity: u16, scan_rate_ms: u32) -> PollDefinition {
    PollDefinition {
        slave_id: 1,
        function: 3,
        start_address: 0,
        quantity,
        scan_rate_ms,
    }
}

pub fn def(slave_id: u8, start_address: u16, quantity: u16, scan_rate_ms: u32) -> PollDefinition {
    PollDefinition {
        slave_id,
        function: 3,
        start_address,
        quantity,
        scan_rate_ms,
    }
}

pub fn input(name: &str, definition: PollDefinition) -> PollConfigInput {
    PollConfigInput {
        name: name.into(),
        definition,
        display: DisplaySettings::default(),
        format_overrides: vec![],
        color_rules: Vec::new(),
        scale: None,
        scale_overrides: vec![],
        value_columns: ValueColumns::Raw,
        aliases: vec![],
    }
}
