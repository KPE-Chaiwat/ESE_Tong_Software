//! The Modbus TCP listener, connection tasks and the TCP control port.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use transport::{Framing, Link, LinkKind, ReceiveError, Role, StreamLink};

use crate::sim::{Action, Core};

/// Accepts Modbus connections while `listen_tx` is `true`. While it is `false` the listening
/// socket is closed, so connection attempts are refused by the OS (like a device that is
/// switched off or unplugged).
pub(crate) fn spawn_accept_loop(
    core: Arc<Core>,
    first: TcpListener,
    addr: SocketAddr,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut listener = Some(first);
        let mut listen_rx = core.listen_tx.subscribe();
        loop {
            let want = *listen_rx.borrow_and_update();
            if want && listener.is_none() {
                match TcpListener::bind(addr).await {
                    Ok(l) => {
                        core.log(&format!("LISTEN {addr}"));
                        listener = Some(l);
                    }
                    Err(e) => {
                        core.log(&format!("ERROR rebinding {addr}: {e}; retrying"));
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        continue;
                    }
                }
            }
            if !want && listener.take().is_some() {
                core.log(&format!("UNLISTEN {addr} (new connections are refused)"));
            }
            match &listener {
                Some(l) => {
                    tokio::select! {
                        r = l.accept() => match r {
                            Ok((stream, peer)) => {
                                let _ = stream.set_nodelay(true);
                                let id = core.conn_id();
                                tokio::spawn(serve_connection(core.clone(), stream, peer, id));
                            }
                            Err(e) => core.log(&format!("ERROR accept: {e}")),
                        },
                        changed = listen_rx.changed() => if changed.is_err() { return },
                    }
                }
                None => {
                    if listen_rx.changed().await.is_err() {
                        return;
                    }
                }
            }
        }
    })
}

async fn serve_connection(core: Arc<Core>, stream: TcpStream, peer: SocketAddr, id: u64) {
    core.log(&format!("conn={id} OPEN {peer}"));
    let mut kill_rx = core.kill_tx.subscribe();
    kill_rx.borrow_and_update();
    let mut link = StreamLink::new(stream, Framing::Tcp, Role::Slave, LinkKind::Tcp);
    loop {
        let received = tokio::select! {
            r = link.receive_frame(Duration::from_secs(24 * 3600)) => r,
            _ = kill_rx.changed() => {
                core.log(&format!("conn={id} CLOSE (stop command)"));
                return;
            }
        };
        let frame = match received {
            Ok(frame) => frame,
            Err(ReceiveError::Timeout { .. }) => continue,
            Err(ReceiveError::Link { error, .. }) => {
                core.log(&format!("conn={id} CLOSE ({error})"));
                return;
            }
        };
        core.log_frame(id, "RX", &frame, None);
        match core.handle(&frame) {
            Action::Ignore(reason) => core.log(&format!("conn={id} NO-REPLY # {reason}")),
            Action::Reply {
                bytes,
                delay,
                close,
                note,
            } => {
                if !delay.is_zero() {
                    tokio::select! {
                        () = tokio::time::sleep(delay) => {}
                        _ = kill_rx.changed() => {
                            core.log(&format!("conn={id} CLOSE (stop command)"));
                            return;
                        }
                    }
                }
                if let Err(e) = link.send(&bytes).await {
                    core.log(&format!("conn={id} CLOSE (send failed: {e})"));
                    return;
                }
                core.log_frame(id, "TX", &bytes, note.as_deref());
                if close {
                    link.close().await;
                    core.log(&format!("conn={id} CLOSE (fault close mid-reply)"));
                    return;
                }
            }
        }
    }
}

/// Line-based control port. Bound to loopback only (checked by the caller).
pub(crate) fn spawn_control(core: Arc<Core>, listener: TcpListener) -> JoinHandle<()> {
    tokio::spawn(async move {
        while let Ok((stream, peer)) = listener.accept().await {
            if !peer.ip().is_loopback() {
                continue; // defence in depth: the port is bound to loopback anyway
            }
            let core = core.clone();
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let response = core.command(&line);
                    if write
                        .write_all(format!("{response}\n").as_bytes())
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            });
        }
    })
}

/// Reads commands from stdin until it closes; responses go to the log (stdout).
pub(crate) fn spawn_stdin(core: Arc<Core>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            core.command(&line);
        }
    })
}
