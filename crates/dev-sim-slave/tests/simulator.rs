//! The simulator on real loopback sockets (port 0), driven with modbus-core framing.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dev_sim_slave::{start, LogFn, SimConfig, SimHandle};
use modbus_core::{
    encode_tcp, parse_tcp_reply, BadResponse, ExceptionCode, Reply, Request, Response,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use transport::{Framing, Link, LinkError, LinkKind, ReceiveError, Role, StreamLink};

type Client = StreamLink<TcpStream>;

fn capture() -> (LogFn, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = lines.clone();
    (
        Arc::new(move |l: &str| sink.lock().unwrap().push(l.to_owned())),
        lines,
    )
}

async fn sim() -> (SimHandle, Arc<Mutex<Vec<String>>>) {
    let (log, lines) = capture();
    let config = SimConfig {
        listen: SocketAddr::from(([127, 0, 0, 1], 0)),
        control: Some(SocketAddr::from(([127, 0, 0, 1], 0))),
        ..SimConfig::default()
    };
    (start(config, log).await.unwrap(), lines)
}

async fn client(sim: &SimHandle) -> Client {
    let stream = TcpStream::connect(sim.modbus_addr).await.unwrap();
    StreamLink::new(stream, Framing::Tcp, Role::Master, LinkKind::Tcp)
}

const T: Duration = Duration::from_millis(300);

/// Sends `pdu` to `unit` with transaction id `txn` and returns the raw reply.
async fn raw(c: &mut Client, txn: u16, unit: u8, pdu: &[u8]) -> Result<Vec<u8>, ReceiveError> {
    c.send(&encode_tcp(txn, unit, pdu)).await.unwrap();
    c.receive_frame(T).await
}

async fn ask(c: &mut Client, txn: u16, unit: u8, req: &Request) -> Result<Reply, BadResponse> {
    let bytes = raw(c, txn, unit, &req.encode_pdu().unwrap())
        .await
        .expect("a reply");
    parse_tcp_reply(req, txn, unit, &bytes)
}

fn regs(address: u16, quantity: u16) -> Request {
    Request::ReadHoldingRegisters { address, quantity }
}

#[tokio::test]
async fn normal_reads_and_writes_with_default_values() {
    let (sim, _) = sim().await;
    let mut c = client(&sim).await;
    assert_eq!(
        ask(&mut c, 1, 1, &regs(100, 3)).await.unwrap(),
        Reply::Response(Response::ReadHoldingRegisters(vec![100, 101, 102]))
    );
    assert_eq!(
        ask(
            &mut c,
            2,
            1,
            &Request::ReadInputRegisters {
                address: 0,
                quantity: 2
            }
        )
        .await
        .unwrap(),
        Reply::Response(Response::ReadInputRegisters(vec![65535, 65534]))
    );
    assert_eq!(
        ask(
            &mut c,
            3,
            1,
            &Request::ReadCoils {
                address: 0,
                quantity: 4
            }
        )
        .await
        .unwrap(),
        Reply::Response(Response::ReadCoils(vec![false, true, false, true]))
    );
    assert_eq!(
        ask(
            &mut c,
            4,
            1,
            &Request::ReadDiscreteInputs {
                address: 0,
                quantity: 4
            }
        )
        .await
        .unwrap(),
        Reply::Response(Response::ReadDiscreteInputs(vec![true, false, false, true]))
    );
    for (txn, req) in [
        (
            5,
            Request::WriteSingleRegister {
                address: 10,
                value: 0xBEEF,
            },
        ),
        (
            6,
            Request::WriteMultipleRegisters {
                address: 20,
                values: vec![1, 2, 3],
            },
        ),
        (
            7,
            Request::WriteSingleCoil {
                address: 1,
                value: false,
            },
        ),
        (
            8,
            Request::WriteMultipleCoils {
                address: 30,
                values: vec![true, true],
            },
        ),
    ] {
        assert!(matches!(
            ask(&mut c, txn, 1, &req).await,
            Ok(Reply::Response(_))
        ));
    }
    assert_eq!(sim.command("get holding 10"), "ok 48879");
    assert_eq!(sim.command("get holding 20 3"), "ok 1 2 3");
    assert_eq!(sim.command("get coils 0 2"), "ok 0 0");
    assert_eq!(sim.command("get coils 30 2"), "ok 1 1");
}

#[tokio::test]
async fn unit_ids_including_zero() {
    let (sim, _) = sim().await;
    let mut c = client(&sim).await;
    // TCP unit 0 is answered like any unit, echoing unit id 0.
    assert!(ask(&mut c, 1, 0, &regs(0, 1)).await.is_ok());
    assert!(ask(&mut c, 2, 247, &regs(0, 1)).await.is_ok());
    assert!(sim.command("units 1 2").starts_with("ok"));
    assert!(ask(&mut c, 3, 2, &regs(0, 1)).await.is_ok());
    let silent = raw(&mut c, 4, 3, &regs(0, 1).encode_pdu().unwrap()).await;
    assert_eq!(silent, Err(ReceiveError::Timeout { partial: vec![] }));
    assert!(sim.command("units all").starts_with("ok"));
    assert!(ask(&mut c, 5, 3, &regs(0, 1)).await.is_ok());
}

#[tokio::test]
async fn exception_responses() {
    let (sim, _) = sim().await;
    let mut c = client(&sim).await;
    let exc = |bytes: Vec<u8>| bytes[7..].to_vec();
    // 01: unsupported function (FC07 here).
    assert_eq!(exc(raw(&mut c, 1, 1, &[0x07]).await.unwrap()), [0x87, 0x01]);
    // 02: address range past 65535.
    assert_eq!(
        exc(raw(&mut c, 2, 1, &[0x03, 0xFF, 0xFF, 0x00, 0x02])
            .await
            .unwrap()),
        [0x83, 0x02]
    );
    // 03: quantity 126, bad coil value, byte count mismatch.
    assert_eq!(
        exc(raw(&mut c, 3, 1, &[0x03, 0x00, 0x00, 0x00, 0x7E])
            .await
            .unwrap()),
        [0x83, 0x03]
    );
    assert_eq!(
        exc(raw(&mut c, 4, 1, &[0x05, 0x00, 0x00, 0x12, 0x34])
            .await
            .unwrap()),
        [0x85, 0x03]
    );
    assert_eq!(
        exc(
            raw(&mut c, 5, 1, &[0x10, 0x00, 0x00, 0x00, 0x02, 0x03, 0, 1, 0])
                .await
                .unwrap()
        ),
        [0x90, 0x03]
    );
    // 02 beyond a configured limit.
    assert!(sim.command("limit 100").starts_with("ok"));
    assert_eq!(
        ask(&mut c, 6, 1, &regs(99, 2)).await.unwrap(),
        Reply::Exception {
            function: 3,
            code: ExceptionCode::ILLEGAL_DATA_ADDRESS
        }
    );
    assert!(ask(&mut c, 7, 1, &regs(99, 1)).await.is_ok());
}

#[tokio::test]
async fn every_fault_kind() {
    let (sim, _) = sim().await;
    let mut c = client(&sim).await;
    let req = regs(0, 2);

    assert!(sim.command("fault delay 200 times=1").starts_with("ok"));
    let started = Instant::now();
    assert!(ask(&mut c, 1, 1, &req).await.is_ok());
    assert!(started.elapsed() >= Duration::from_millis(200));

    assert!(sim.command("fault drop times=1").starts_with("ok"));
    assert_eq!(
        raw(&mut c, 2, 1, &req.encode_pdu().unwrap()).await,
        Err(ReceiveError::Timeout { partial: vec![] })
    );

    assert!(sim.command("fault exception 4 times=1").starts_with("ok"));
    assert_eq!(
        ask(&mut c, 3, 1, &req).await.unwrap(),
        Reply::Exception {
            function: 3,
            code: ExceptionCode::SERVER_DEVICE_FAILURE
        }
    );
    assert!(sim
        .command("fault exception 0x0B times=1")
        .starts_with("ok"));
    assert_eq!(
        ask(&mut c, 4, 1, &req).await.unwrap(),
        Reply::Exception {
            function: 3,
            code: ExceptionCode::GATEWAY_TARGET_FAILED
        }
    );

    assert!(sim.command("fault wrong-unit 9 times=1").starts_with("ok"));
    assert_eq!(
        ask(&mut c, 5, 1, &req).await.unwrap_err(),
        BadResponse::WrongSlave {
            expected: 1,
            got: 9
        }
    );
    assert!(sim.command("fault wrong-txn times=1").starts_with("ok"));
    assert_eq!(
        ask(&mut c, 6, 1, &req).await.unwrap_err(),
        BadResponse::TransactionMismatch {
            expected: 6,
            got: 7
        }
    );
    assert!(sim
        .command("fault wrong-function times=1")
        .starts_with("ok"));
    assert_eq!(
        ask(&mut c, 7, 1, &req).await.unwrap_err(),
        BadResponse::WrongFunction {
            expected: 3,
            got: 4
        }
    );

    assert!(sim.command("fault truncate 5 times=1").starts_with("ok"));
    match raw(&mut c, 8, 1, &req.encode_pdu().unwrap()).await {
        Err(ReceiveError::Timeout { partial }) => assert_eq!(partial.len(), 5),
        other => panic!("{other:?}"),
    }
    assert!(sim
        .command("fault garbage DE AD BE EF times=1")
        .starts_with("ok"));
    match raw(&mut c, 9, 1, &req.encode_pdu().unwrap()).await {
        Err(ReceiveError::Timeout { partial }) => assert_eq!(partial, [0xDE, 0xAD, 0xBE, 0xEF]),
        other => panic!("{other:?}"),
    }

    // times=2 then back to normal; "until cleared" persists until `clear`.
    assert!(sim.command("fault exception 6 times=2").starts_with("ok"));
    for txn in 10..12 {
        assert!(matches!(
            ask(&mut c, txn, 1, &req).await,
            Ok(Reply::Exception { .. })
        ));
    }
    assert!(matches!(
        ask(&mut c, 12, 1, &req).await,
        Ok(Reply::Response(_))
    ));
    assert!(sim.command("fault exception 6").starts_with("ok"));
    for txn in 13..16 {
        assert!(matches!(
            ask(&mut c, txn, 1, &req).await,
            Ok(Reply::Exception { .. })
        ));
    }
    assert_eq!(sim.command("clear"), "ok faults cleared");
    assert!(matches!(
        ask(&mut c, 16, 1, &req).await,
        Ok(Reply::Response(_))
    ));

    // close: half a reply, then the socket closes.
    assert!(sim.command("fault close times=1").starts_with("ok"));
    match raw(&mut c, 17, 1, &req.encode_pdu().unwrap()).await {
        Err(ReceiveError::Link { error, partial }) => {
            assert_eq!(error, LinkError::Closed);
            assert_eq!(partial.len(), 6); // 13-byte reply, first half
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn refuse_stop_and_resume() {
    let (sim, _) = sim().await;
    let mut c = client(&sim).await;
    // One exchange first: a connection still waiting in the accept backlog is reset by the
    // OS when the listener closes, so only accepted connections survive `refuse on`.
    assert!(ask(&mut c, 9, 1, &regs(0, 1)).await.is_ok());
    assert!(sim.command("refuse on").starts_with("ok"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        TcpStream::connect(sim.modbus_addr).await.is_err(),
        "refused"
    );
    assert!(
        ask(&mut c, 1, 1, &regs(0, 1)).await.is_ok(),
        "open connection keeps working"
    );
    assert!(sim.command("refuse off").starts_with("ok"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut c2 = client(&sim).await;
    assert!(ask(&mut c2, 1, 1, &regs(0, 1)).await.is_ok());

    assert!(sim.command("stop").starts_with("ok"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    match c2.receive_frame(T).await {
        Err(ReceiveError::Link { error, .. }) => assert_eq!(error, LinkError::Closed),
        other => panic!("open connection must be closed: {other:?}"),
    }
    assert!(TcpStream::connect(sim.modbus_addr).await.is_err());
    assert!(sim.command("resume").starts_with("ok"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut c3 = client(&sim).await;
    assert!(ask(&mut c3, 1, 1, &regs(0, 1)).await.is_ok());
}

#[tokio::test]
async fn control_port_and_logging() {
    let (sim, lines) = sim().await;
    let control = TcpStream::connect(sim.control_addr.unwrap()).await.unwrap();
    let (read, mut write) = control.into_split();
    let mut read = BufReader::new(read).lines();
    write
        .write_all(b"set holding 5 42 43\nget holding 5 2\nbogus\n")
        .await
        .unwrap();
    assert_eq!(
        read.next_line().await.unwrap().unwrap(),
        "ok 2 value(s) written"
    );
    assert_eq!(read.next_line().await.unwrap().unwrap(), "ok 42 43");
    assert!(read
        .next_line()
        .await
        .unwrap()
        .unwrap()
        .starts_with("error unknown command"));

    let mut c = client(&sim).await;
    assert!(ask(&mut c, 0x0102, 1, &regs(5, 1)).await.is_ok());
    tokio::time::sleep(Duration::from_millis(20)).await;
    let log = lines.lock().unwrap().join("\n");
    assert!(
        log.contains("RX 12 | 01 02 00 00 00 06 01 03 00 05 00 01"),
        "{log}"
    );
    assert!(
        log.contains("TX 11 | 01 02 00 00 00 05 01 03 02 00 2A"),
        "{log}"
    );
    assert!(log.contains("READY modbus=127.0.0.1:"), "{log}");
    // Every line starts with an ISO UTC timestamp and epoch milliseconds.
    let first = log.lines().next().unwrap();
    assert!(first.len() > 26 && first.as_bytes()[10] == b'T' && first.contains("Z "));
}

#[tokio::test]
async fn control_port_must_be_loopback() {
    let (log, _) = capture();
    let config = SimConfig {
        listen: SocketAddr::from(([127, 0, 0, 1], 0)),
        control: Some(SocketAddr::from(([0, 0, 0, 0], 0))),
        ..SimConfig::default()
    };
    let err = start(config, log).await.err().unwrap();
    assert!(err.to_string().contains("loopback"));
}

#[tokio::test]
async fn command_errors_are_reported() {
    let (sim, _) = sim().await;
    for bad in [
        "set holding 65535 1 2",
        "set coils 0 2",
        "get bogus 0",
        "fault",
        "fault teleport",
        "fault delay",
        "fault exception 300",
        "fault drop times=0",
        "units 300",
        "limit 70000",
        "refuse maybe",
    ] {
        assert!(sim.command(bad).starts_with("error"), "{bad}");
    }
    assert!(sim.command("status").starts_with("ok listening=true"));
    assert!(
        sim.command("\u{feff}status")
            .starts_with("ok listening=true"),
        "BOM from PowerShell pipes"
    );
    assert!(sim.command("help").contains("fault delay"));
}

/// BE-002-6: a fault can target one unit id, so one poll fails while others succeed.
#[tokio::test]
async fn fault_filtered_by_unit() {
    let (sim, _) = sim().await;
    let mut c = client(&sim).await;
    let reply = sim.command("fault exception 4 times=2 unit=3");
    assert!(reply.starts_with("ok"), "{reply}");
    assert!(reply.contains("to unit 3"), "{reply}");
    assert!(sim.command("status").contains("@unit3"));
    // Unit 1 is answered normally and does not use up the fault.
    for txn in 1..=3 {
        assert!(matches!(
            ask(&mut c, txn, 1, &regs(0, 1)).await.unwrap(),
            Reply::Response(_)
        ));
    }
    for txn in 4..=5 {
        assert_eq!(
            ask(&mut c, txn, 3, &regs(0, 1)).await.unwrap(),
            Reply::Exception {
                function: 3,
                code: ExceptionCode(4)
            }
        );
    }
    // times=2 used up by unit 3 only.
    assert!(matches!(
        ask(&mut c, 6, 3, &regs(0, 1)).await.unwrap(),
        Reply::Response(_)
    ));
    assert!(sim.command("status").contains("fault=none"));
    // Until cleared, with other kinds too.
    assert!(sim.command("fault drop unit=7").starts_with("ok"));
    assert!(raw(&mut c, 7, 7, &regs(0, 1).encode_pdu().unwrap())
        .await
        .is_err());
    assert!(ask(&mut c, 8, 1, &regs(0, 1)).await.is_ok());
    assert!(sim.command("fault garbage DE AD unit=2").starts_with("ok"));
    assert!(sim.command("fault drop unit=256").starts_with("error"));
    assert!(sim.command("fault drop unit=x").starts_with("error"));
}

/// BE-002-6: the log shows `OVERLAP` when a client sends a request before the previous
/// reply (so integration tests can assert "never" from the log).
#[tokio::test]
async fn overlap_is_logged() {
    let (sim, lines) = sim().await;
    let mut c = client(&sim).await;
    assert!(sim.command("fault delay 50").starts_with("ok"));
    // Sequential: no overlap.
    assert!(ask(&mut c, 1, 1, &regs(0, 1)).await.is_ok());
    assert!(!lines.lock().unwrap().iter().any(|l| l.contains("OVERLAP")));
    // Pipelined: the second request is waiting while the first reply is delayed.
    let pdu = regs(0, 1).encode_pdu().unwrap();
    c.send(&encode_tcp(2, 1, &pdu)).await.unwrap();
    c.send(&encode_tcp(3, 1, &pdu)).await.unwrap();
    assert!(c.receive_frame(T).await.is_ok());
    assert!(c.receive_frame(T).await.is_ok());
    let overlaps = lines
        .lock()
        .unwrap()
        .iter()
        .filter(|l| l.contains("OVERLAP"))
        .count();
    assert_eq!(overlaps, 1);
}

/// REV-004 m7: a request that arrives during an injected delay after the master's timeout
/// (`master-timeout`, default 50 ms) is the master giving up on the late reply: logged as
/// `ABANDONED`, never as `OVERLAP`. Earlier than the timeout it is still an `OVERLAP`.
#[tokio::test]
async fn request_after_the_master_timeout_during_a_delay_is_abandoned_not_overlap() {
    let count = |lines: &Arc<Mutex<Vec<String>>>, what: &str| {
        lines
            .lock()
            .unwrap()
            .iter()
            .filter(|l| l.contains(what))
            .count()
    };
    let (sim, lines) = sim().await;
    let mut c = client(&sim).await;
    assert!(sim.command("fault delay 400").starts_with("ok"));
    assert!(sim.command("master-timeout 100").starts_with("ok"));
    let pdu = regs(0, 1).encode_pdu().unwrap();
    // The master times out after 100 ms and sends its next request at ~150 ms.
    c.send(&encode_tcp(1, 1, &pdu)).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    c.send(&encode_tcp(2, 1, &pdu)).await.unwrap();
    assert!(c.receive_frame(Duration::from_secs(2)).await.is_ok());
    assert!(c.receive_frame(Duration::from_secs(2)).await.is_ok());
    assert_eq!(count(&lines, "OVERLAP"), 0, "{:?}", lines.lock().unwrap());
    assert_eq!(count(&lines, "ABANDONED"), 1);

    // The same timing with a 1000 ms master timeout is a real overlap.
    assert!(sim.command("master-timeout 1000").starts_with("ok"));
    c.send(&encode_tcp(3, 1, &pdu)).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    c.send(&encode_tcp(4, 1, &pdu)).await.unwrap();
    assert!(c.receive_frame(Duration::from_secs(2)).await.is_ok());
    assert!(c.receive_frame(Duration::from_secs(2)).await.is_ok());
    assert_eq!(count(&lines, "OVERLAP"), 1);
    assert_eq!(count(&lines, "ABANDONED"), 1);
    assert!(sim.command("master-timeout 0").starts_with("error"));
    assert!(sim.command("help").contains("master-timeout <ms>"));
}
