//! Transport tests against the in-process fake slave (in-memory duplex and real TCP loopback).

use std::time::Duration;

use modbus_core::{
    encode_rtu, encode_tcp, parse_rtu_reply, parse_tcp_reply, BadResponseKind, Reply, Request,
    Response,
};
use tokio::io::{duplex, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::fake::{Behavior, FakeSlave};
use crate::*;

fn rtu() -> Framing {
    Framing::rtu_for_baud(19200)
}

fn read2() -> Request {
    Request::ReadHoldingRegisters {
        address: 10,
        quantity: 2,
    }
}

/// A master link connected to a fake slave over an in-memory stream.
fn memory_pair(framing: Framing, slave: &FakeSlave) -> StreamLink<tokio::io::DuplexStream> {
    let (a, b) = duplex(4096);
    let fake = slave.clone();
    tokio::spawn(async move { fake.serve(b, framing).await });
    StreamLink::new(a, framing, Role::Master, LinkKind::Memory)
}

#[tokio::test(start_paused = true)]
async fn rtu_round_trip_over_memory() {
    let slave = FakeSlave::new(1);
    let mut link = memory_pair(rtu(), &slave);
    link.send(&encode_rtu(1, &read2().encode_pdu().unwrap()))
        .await
        .unwrap();
    let frame = link.receive_frame(Duration::from_secs(1)).await.unwrap();
    assert_eq!(frame.len(), 9);
    assert_eq!(
        parse_rtu_reply(&read2(), 1, &frame).unwrap(),
        Reply::Response(Response::ReadHoldingRegisters(vec![10, 11]))
    );
}

#[tokio::test(start_paused = true)]
async fn timeout_returns_no_bytes() {
    let slave = FakeSlave::new(1);
    slave.script([Behavior::Silent]);
    let mut link = memory_pair(rtu(), &slave);
    link.send(&encode_rtu(1, &read2().encode_pdu().unwrap()))
        .await
        .unwrap();
    let started = tokio::time::Instant::now();
    let err = link
        .receive_frame(Duration::from_millis(300))
        .await
        .unwrap_err();
    assert_eq!(err, ReceiveError::Timeout { partial: vec![] });
    assert_eq!(started.elapsed(), Duration::from_millis(300));
}

#[tokio::test(start_paused = true)]
async fn rtu_silence_ends_a_truncated_frame_early() {
    let slave = FakeSlave::new(1);
    slave.script([Behavior::Truncate(4)]);
    let mut link = memory_pair(rtu(), &slave);
    link.send(&encode_rtu(1, &read2().encode_pdu().unwrap()))
        .await
        .unwrap();
    let started = tokio::time::Instant::now();
    let frame = link.receive_frame(Duration::from_secs(1)).await.unwrap();
    assert_eq!(frame.len(), 4);
    assert!(started.elapsed() < Duration::from_millis(100));
    assert_eq!(
        parse_rtu_reply(&read2(), 1, &frame).unwrap_err().kind(),
        BadResponseKind::ShortFrame
    );
}

#[tokio::test(start_paused = true)]
async fn rtu_unknown_function_uses_silence() {
    let slave = FakeSlave::new(1);
    slave.script([Behavior::Raw(vec![0x01, 0x2B, 0x00, 0x00, 0x00])]);
    let mut link = memory_pair(rtu(), &slave);
    link.send(&encode_rtu(1, &read2().encode_pdu().unwrap()))
        .await
        .unwrap();
    let frame = link.receive_frame(Duration::from_secs(1)).await.unwrap();
    assert_eq!(frame, vec![0x01, 0x2B, 0x00, 0x00, 0x00]);
}

#[tokio::test(start_paused = true)]
async fn tcp_partial_frame_times_out_with_partial_bytes() {
    let slave = FakeSlave::new(1);
    slave.script([Behavior::Truncate(9)]);
    let mut link = memory_pair(Framing::Tcp, &slave);
    link.send(&encode_tcp(5, 1, &read2().encode_pdu().unwrap()))
        .await
        .unwrap();
    match link.receive_frame(Duration::from_millis(200)).await {
        Err(ReceiveError::Timeout { partial }) => assert_eq!(partial.len(), 9),
        other => panic!("unexpected {other:?}"),
    }
}

#[tokio::test(start_paused = true)]
async fn peer_close_is_reported() {
    let slave = FakeSlave::new(1);
    slave.script([Behavior::Close]);
    let mut link = memory_pair(Framing::Tcp, &slave);
    link.send(&encode_tcp(1, 1, &read2().encode_pdu().unwrap()))
        .await
        .unwrap();
    match link.receive_frame(Duration::from_secs(1)).await {
        Err(ReceiveError::Link { error, .. }) => assert_eq!(error, LinkError::Closed),
        other => panic!("unexpected {other:?}"),
    }
}

#[tokio::test(start_paused = true)]
async fn drain_and_watch() {
    let (a, mut b) = duplex(256);
    let mut link = StreamLink::new(a, Framing::Tcp, Role::Master, LinkKind::Memory);
    assert_eq!(link.drain().await.unwrap(), Vec::<u8>::new());
    b.write_all(&[1, 2, 3]).await.unwrap();
    tokio::task::yield_now().await;
    assert_eq!(link.drain().await.unwrap(), vec![1, 2, 3]);

    // watch() is cancel-safe: a timed-out watch loses nothing.
    assert!(
        tokio::time::timeout(Duration::from_millis(10), link.watch())
            .await
            .is_err()
    );
    b.write_all(&[9]).await.unwrap();
    assert_eq!(link.watch().await.unwrap(), vec![9]);
    drop(b);
    assert_eq!(link.watch().await.unwrap_err(), LinkError::Closed);
}

#[tokio::test(start_paused = true)]
async fn two_frames_in_one_read_are_split() {
    let (a, mut b) = duplex(512);
    let mut link = StreamLink::new(a, Framing::Tcp, Role::Master, LinkKind::Memory);
    let f1 = encode_tcp(1, 1, &[0x03, 0x02, 0x00, 0x07]);
    let f2 = encode_tcp(2, 1, &[0x03, 0x02, 0x00, 0x08]);
    b.write_all(&[f1.clone(), f2.clone()].concat())
        .await
        .unwrap();
    assert_eq!(
        link.receive_frame(Duration::from_secs(1)).await.unwrap(),
        f1
    );
    assert_eq!(
        link.receive_frame(Duration::from_secs(1)).await.unwrap(),
        f2
    );
}

async fn tcp_fake() -> (FakeSlave, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let slave = FakeSlave::new(1);
    tokio::spawn(slave.clone().serve_tcp(listener));
    (slave, port)
}

fn tcp_params(port: u16) -> TcpParams {
    TcpParams {
        host: "127.0.0.1".into(),
        port,
        timeout: Duration::from_secs(5),
    }
}

#[tokio::test]
async fn tcp_loopback_round_trip_and_socket_drop() {
    let (slave, port) = tcp_fake().await;
    let mut link = connect_tcp(&tcp_params(port)).await.unwrap();
    let request = Request::ReadHoldingRegisters {
        address: 0,
        quantity: 125,
    };
    link.send(&encode_tcp(7, 1, &request.encode_pdu().unwrap()))
        .await
        .unwrap();
    let frame = link.receive_frame(Duration::from_secs(2)).await.unwrap();
    assert_eq!(frame.len(), 7 + 2 + 250);
    assert!(parse_tcp_reply(&request, 7, 1, &frame).is_ok());

    slave.script([Behavior::Close]);
    link.send(&encode_tcp(8, 1, &request.encode_pdu().unwrap()))
        .await
        .unwrap();
    match link.receive_frame(Duration::from_secs(2)).await {
        Err(ReceiveError::Link { error, .. }) => assert_eq!(error, LinkError::Closed),
        other => panic!("unexpected {other:?}"),
    }
}

#[tokio::test]
async fn tcp_refused() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let err = connect_tcp(&tcp_params(port)).await.err().unwrap();
    assert_eq!(err, ConnectError::Refused);
}

#[tokio::test]
async fn tcp_unknown_host() {
    let err = connect_tcp(&TcpParams {
        host: "esefact-test.invalid".into(),
        port: 502,
        timeout: Duration::from_secs(5),
    })
    .await
    .err()
    .unwrap();
    assert!(
        matches!(err, ConnectError::HostNotFound(_) | ConnectError::Timeout),
        "{err:?}"
    );
}

#[tokio::test]
async fn connect_can_be_cancelled() {
    // TEST-NET-1 is not routable: the connect either hangs or fails fast; aborting must
    // return promptly either way.
    let task = tokio::spawn(async {
        connect_tcp(&TcpParams {
            host: "192.0.2.1".into(),
            port: 502,
            timeout: Duration::from_secs(30),
        })
        .await
        .map(|_| ())
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    task.abort();
    let started = std::time::Instant::now();
    let _ = task.await;
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[tokio::test]
async fn connect_timeout() {
    let err = connect_tcp(&TcpParams {
        host: "192.0.2.1".into(),
        port: 502,
        timeout: Duration::from_millis(200),
    })
    .await
    .err()
    .unwrap();
    // Offline machines fail with "network unreachable" (Io) before the timeout.
    assert!(
        matches!(err, ConnectError::Timeout | ConnectError::Io(_)),
        "{err:?}"
    );
}

#[test]
fn rtu_timing_follows_baud_and_format() {
    let Framing::Rtu(t) = Framing::rtu_for_baud(9600) else {
        unreachable!()
    };
    // 11 bits at 9600 baud = 1.1458 ms per character; t3.5 = 4.01 ms.
    assert_eq!(t.char_time, Duration::from_nanos(1_145_833));
    assert_eq!(t.t35, Duration::from_nanos(1_145_833) * 7 / 2);
    assert_eq!(t.silence, MIN_RTU_SILENCE);
    // Above 19200 baud t3.5 is fixed at 1.75 ms.
    let Framing::Rtu(fast) = Framing::rtu_for_baud(115_200) else {
        unreachable!()
    };
    assert_eq!(fast.t35, Duration::from_micros(1750));
    let Framing::Rtu(slow) = Framing::rtu_for_baud(300) else {
        unreachable!()
    };
    assert!(slow.silence > MIN_RTU_SILENCE);
    // 8N1 = 10 bits, 8E1 = 11 bits, 7N2 = 10 bits.
    let params = |data_bits, parity, stop_bits| SerialParams {
        port: "COM1".into(),
        baud: 10_000,
        data_bits,
        parity,
        stop_bits,
    };
    let char_time = |p: &SerialParams| match framing_for(p) {
        Framing::Rtu(t) => t.char_time,
        Framing::Tcp => unreachable!(),
    };
    assert_eq!(
        char_time(&params(8, Parity::None, 1)),
        Duration::from_millis(1)
    );
    assert_eq!(
        char_time(&params(8, Parity::Even, 1)),
        Duration::from_micros(1100)
    );
    assert_eq!(
        char_time(&params(7, Parity::None, 2)),
        Duration::from_millis(1)
    );
}

/// REV-001 F5: 125 registers (255 bytes) at 2400 baud 8E1 take ~1.17 s on the wire. With
/// a 1000 ms timeout the frame must still be received whole.
#[tokio::test(start_paused = true)]
async fn rtu_large_reply_at_low_baud_is_not_cut_off() {
    let framing = Framing::rtu(2400, 11);
    let Framing::Rtu(timing) = framing else {
        unreachable!()
    };
    let slave = FakeSlave::new(1);
    slave.script([Behavior::Trickle(timing.char_time)]);
    let mut link = memory_pair(framing, &slave);
    let request = Request::ReadHoldingRegisters {
        address: 0,
        quantity: 125,
    };
    link.send(&encode_rtu(1, &request.encode_pdu().unwrap()))
        .await
        .unwrap();
    let started = tokio::time::Instant::now();
    let frame = link
        .receive_frame(Duration::from_millis(1000))
        .await
        .unwrap();
    assert_eq!(frame.len(), 255);
    assert!(started.elapsed() > Duration::from_millis(1100));
    assert!(parse_rtu_reply(&request, 1, &frame).is_ok());
}

/// The extension only applies once a reply has started: silence still times out.
#[tokio::test(start_paused = true)]
async fn rtu_timeout_without_first_byte_is_unchanged() {
    let slave = FakeSlave::new(1);
    slave.script([Behavior::Silent]);
    let mut link = memory_pair(Framing::rtu(2400, 11), &slave);
    link.send(&encode_rtu(1, &read2().encode_pdu().unwrap()))
        .await
        .unwrap();
    let started = tokio::time::Instant::now();
    assert_eq!(
        link.receive_frame(Duration::from_millis(1000))
            .await
            .unwrap_err(),
        ReceiveError::Timeout { partial: vec![] }
    );
    assert_eq!(started.elapsed(), Duration::from_millis(1000));
}

#[tokio::test]
async fn connect_missing_serial_port_off_the_runtime() {
    // REV-001 F7: opened on the blocking pool and bounded by the timeout.
    let started = std::time::Instant::now();
    let err = connect_serial(
        &SerialParams {
            port: "COM250".into(),
            baud: 9600,
            data_bits: 8,
            parity: Parity::Even,
            stop_bits: 1,
        },
        Duration::from_secs(5),
    )
    .await
    .err()
    .unwrap();
    assert!(
        matches!(
            err,
            ConnectError::PortNotFound(_) | ConnectError::Io(_) | ConnectError::Timeout
        ),
        "{err:?}"
    );
    assert!(started.elapsed() < Duration::from_secs(6));
}
#[tokio::test]
async fn open_missing_serial_port_fails_cleanly() {
    let err = open_serial(&SerialParams {
        port: "COM250".into(),
        baud: 9600,
        data_bits: 8,
        parity: Parity::Even,
        stop_bits: 1,
    })
    .err()
    .unwrap();
    assert!(
        matches!(err, ConnectError::PortNotFound(_) | ConnectError::Io(_)),
        "{err:?}"
    );
}
