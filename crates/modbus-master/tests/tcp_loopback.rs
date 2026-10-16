//! BE-001 acceptance: a real TCP loopback fake slave exercising connect, poll 03 with 125
//! registers, write 06/16, timeout, exception, a bad reply and a socket drop, asserting the
//! emitted state sequence. Real time (no paused clock), short timeouts.
//!
//! Modbus TCP has no CRC, so the CRC-bad case runs RTU framing over the same kind of real
//! loopback socket (an "RTU over TCP" link) with a custom connector.

mod common;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use common::*;
use modbus_master::{Connector, Session, SessionDeps, SystemClock, SystemConnector};
use shared_types::{
    BadResponseKind, ConnectionConfig, ExceptionCode, ReasonKind, SessionState as S, WriteRequest,
    WriteResult,
};
use tokio::net::{TcpListener, TcpStream};
use transport::fake::{Behavior, FakeSlave};
use transport::{ConnectError, Framing, Link, LinkKind, Role, StreamLink};

async fn start_fake() -> (FakeSlave, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let slave = FakeSlave::new(1);
    tokio::spawn(slave.clone().serve_tcp(listener));
    (slave, port)
}

async fn wait(rec: &Recorder, what: &str, pred: impl Fn(&Recorder) -> bool) {
    wait_for(rec, Duration::from_secs(10), what, pred).await;
}

async fn wait_last(rec: &Recorder, state: S) {
    wait(rec, &format!("{state:?}"), |r| {
        r.last_state().is_some_and(|s| s.state == state)
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn tcp_full_scenario() {
    let (slave, port) = start_fake().await;
    let rec = Arc::new(Recorder::default());
    let session = Session::spawn(
        rec.clone(),
        SessionDeps {
            clock: Arc::new(SystemClock),
            connector: Arc::new(SystemConnector),
        },
    );

    session.connect(tcp_config(port, 150)).await.unwrap();
    wait_last(&rec, S::Connected).await;

    session.start_poll(poll03(125, 50)).await.unwrap();
    wait(&rec, "2 updates", |r| r.updates().len() >= 2).await;
    let u = rec.updates()[0].clone();
    assert_eq!(u.values.len(), 125);
    assert_eq!(u.values[124], 124);

    let w06 = session
        .write(WriteRequest {
            slave_id: 1,
            function: 6,
            address: 10,
            values: vec![4321],
        })
        .await
        .unwrap();
    assert_eq!(w06, WriteResult::Ok);
    let w16 = session
        .write(WriteRequest {
            slave_id: 1,
            function: 16,
            address: 20,
            values: vec![1, 2, 3],
        })
        .await
        .unwrap();
    assert_eq!(w16, WriteResult::Ok);
    assert_eq!(slave.holding_register(10), 4321);
    assert_eq!(slave.holding_register(22), 3);
    wait(&rec, "written value polled", |r| {
        r.updates().last().is_some_and(|u| u.values[10] == 4321)
    })
    .await;

    slave.script([
        Behavior::Silent,
        Behavior::Respond,
        Behavior::Exception(2),
        Behavior::Respond,
        Behavior::WrongSlave(9),
        Behavior::Respond,
        Behavior::Close,
    ]);
    wait_last(&rec, S::Disconnected).await;

    assert_eq!(
        rec.states(),
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
            S::Disconnected,
        ]
    );
    let changes = rec.state_changes();
    assert_eq!(changes[5].exception_code, Some(ExceptionCode(2)));
    assert_eq!(
        changes[7].bad_response_kind,
        Some(BadResponseKind::WrongSlave)
    );
    assert_eq!(
        changes[9].reason.as_ref().unwrap().kind,
        ReasonKind::ClosedByPeer
    );

    // Raw TX bytes of the first poll are exactly the MBAP request.
    let tx = rec.frames()[0].bytes.clone();
    assert_eq!(tx, [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 125]);
    let snap = session.snapshot().await.unwrap();
    assert_eq!(snap.counters.timeouts, 1);
    assert!(snap.counters.errors >= 2);
    session.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn tcp_connect_refused() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let rec = Arc::new(Recorder::default());
    let session = Session::spawn(rec.clone(), SessionDeps::default());
    session.connect(tcp_config(port, 5000)).await.unwrap();
    wait_last(&rec, S::Disconnected).await;
    assert_eq!(
        rec.last_state().unwrap().reason.unwrap().kind,
        ReasonKind::Refused
    );
}

/// RTU framing over a real TCP socket, so the CRC path runs over a real link.
struct RtuOverTcp(u16);

#[async_trait]
impl Connector for RtuOverTcp {
    async fn connect(&self, config: &ConnectionConfig) -> Result<Box<dyn Link>, ConnectError> {
        let ConnectionConfig::Rtu { baud, .. } = config else {
            unreachable!()
        };
        let stream = TcpStream::connect(("127.0.0.1", self.0))
            .await
            .map_err(|e| ConnectError::Io(e.to_string()))?;
        Ok(Box::new(StreamLink::new(
            stream,
            Framing::rtu_for_baud(*baud),
            Role::Master,
            LinkKind::Tcp,
        )))
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rtu_over_tcp_crc_bad_reply() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let slave = FakeSlave::new(1);
    let fake = slave.clone();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        fake.serve(stream, Framing::rtu_for_baud(19200)).await;
    });

    let rec = Arc::new(Recorder::default());
    let session = Session::spawn(
        rec.clone(),
        SessionDeps {
            clock: Arc::new(SystemClock),
            connector: Arc::new(RtuOverTcp(port)),
        },
    );
    session.connect(rtu_config(200)).await.unwrap();
    wait_last(&rec, S::Connected).await;
    slave.script([Behavior::BadCrc, Behavior::Respond]);
    session.start_poll(poll03(125, 50)).await.unwrap();
    wait(&rec, "recovery", |r| {
        r.states().iter().filter(|s| **s == S::Polling).count() >= 2
    })
    .await;
    let changes = rec.state_changes();
    assert_eq!(
        rec.states(),
        [
            S::Connecting,
            S::Connected,
            S::Polling,
            S::BadResponse,
            S::Polling
        ]
    );
    assert_eq!(changes[3].bad_response_kind, Some(BadResponseKind::Crc));
    let first_tx = rec.frames()[0].bytes.clone();
    assert_eq!(first_tx, [0x01, 0x03, 0x00, 0x00, 0x00, 0x7D, 0x85, 0xEB]);
    session.disconnect().await.unwrap();
    assert_eq!(rec.last_state().unwrap().state, S::Idle);
}
