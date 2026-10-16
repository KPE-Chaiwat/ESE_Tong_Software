//! Shared test helpers: event recorder, in-memory connector with a fake slave.

#![allow(dead_code)]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use modbus_master::{Connector, EventSink};
use shared_types::{
    ConnectionConfig, Parity, PollDefinition, PollUpdate, SessionEvent, SessionState, StateChanged,
    TrafficFrame,
};
use tokio::task::JoinHandle;
use transport::fake::FakeSlave;
use transport::{ConnectError, Framing, Link, LinkKind, Role, StreamLink};

#[derive(Default)]
pub struct Recorder(pub Mutex<Vec<SessionEvent>>);

impl EventSink for Recorder {
    fn send(&self, event: SessionEvent) -> bool {
        self.0.lock().unwrap().push(event);
        true
    }
}

impl Recorder {
    pub fn events(&self) -> Vec<SessionEvent> {
        self.0.lock().unwrap().clone()
    }

    pub fn state_changes(&self) -> Vec<StateChanged> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SessionEvent::StateChanged(s) => Some(s),
                _ => None,
            })
            .collect()
    }

    pub fn states(&self) -> Vec<SessionState> {
        self.state_changes().into_iter().map(|s| s.state).collect()
    }

    pub fn last_state(&self) -> Option<StateChanged> {
        self.state_changes().pop()
    }

    pub fn updates(&self) -> Vec<PollUpdate> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SessionEvent::PollUpdate(u) => Some(u),
                _ => None,
            })
            .collect()
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

    pub fn clear(&self) {
        self.0.lock().unwrap().clear();
    }
}

/// Waits (in tokio time) until `pred` holds, panicking after `max`.
pub async fn wait_for(rec: &Recorder, max: Duration, what: &str, pred: impl Fn(&Recorder) -> bool) {
    let deadline = tokio::time::Instant::now() + max;
    while !pred(rec) {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {what}; states: {:?}",
            rec.states()
        );
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

pub async fn wait_state(rec: &Recorder, state: SessionState) {
    wait_for(rec, Duration::from_secs(30), &format!("{state:?}"), |r| {
        r.last_state().is_some_and(|s| s.state == state)
    })
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
