//! DEV/TEST TOOL ONLY: a scriptable Modbus TCP slave simulator for QA and integration tests.
//!
//! This is **not** the future Modbus Slave product and is not bundled with the app. No
//! product crate depends on it. It reuses `modbus-core` (PDU/ADU) and `transport`
//! (frame boundaries).
//!
//! - Modbus TCP server (default `127.0.0.1:5020`), every unit id answered by default,
//!   including 0 (TCP has no broadcast). One shared register map for all unit ids.
//! - Functions 01-06, 15, 16. Exceptions: 01 unsupported function, 02 address beyond the
//!   `limit`, 03 bad quantity / byte count / coil value. Others on demand via faults.
//! - Faults for the next N requests or until cleared: delay, drop, exception, wrong unit,
//!   wrong transaction id, wrong function, truncate, garbage, close mid-reply.
//! - `refuse on|off`, `stop` / `resume` emulate a device that goes away.
//! - Control: line commands on stdin and on a loopback-only TCP port (default 5021).
//! - Every RX/TX frame is logged as hex with an ISO timestamp and epoch milliseconds.

mod cli;
mod log;
mod registers;
mod server;
mod sim;

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpListener;
use tokio::task::JoinHandle;

pub use cli::{parse_args, CliError, USAGE};
pub use log::{hex, iso_utc, now_ms, stdout_logger, LogFn};
pub use registers::{Registers, Table};
pub use sim::{parse_fault, parse_units, Action, Core, Fault, FaultKind, HELP};

/// Simulator settings.
#[derive(Debug, Clone)]
pub struct SimConfig {
    /// Modbus TCP address. Port 0 picks a free port.
    pub listen: SocketAddr,
    /// Control port (loopback only), or `None` to disable it.
    pub control: Option<SocketAddr>,
    /// Read control commands from stdin (binary only).
    pub stdin: bool,
    /// `None` = answer every unit id.
    pub units: Option<Vec<u8>>,
    /// Exclusive end of the valid address range (exception 02 beyond it). Max 65536.
    pub limit: u32,
    pub registers: Registers,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            listen: SocketAddr::from(([127, 0, 0, 1], 5020)),
            control: Some(SocketAddr::from(([127, 0, 0, 1], 5021))),
            stdin: false,
            units: None,
            limit: 0x1_0000,
            registers: Registers::default(),
        }
    }
}

/// A running simulator. Dropping it (or [`SimHandle::shutdown`]) stops every task and
/// closes all sockets.
pub struct SimHandle {
    pub modbus_addr: SocketAddr,
    pub control_addr: Option<SocketAddr>,
    core: Arc<Core>,
    tasks: Vec<JoinHandle<()>>,
}

impl SimHandle {
    /// Runs a control command (same language as stdin / the control port).
    #[must_use]
    pub fn command(&self, line: &str) -> String {
        self.core.command(line)
    }

    /// Resolves after a `quit` command.
    pub async fn wait_quit(&self) {
        self.core.quit.notified().await;
    }

    /// Stops listening, closes all connections and ends every task.
    pub fn shutdown(&mut self) {
        self.core.listen_tx.send_replace(false);
        self.core.kill_tx.send_modify(|g| *g += 1);
        for t in self.tasks.drain(..) {
            t.abort();
        }
    }
}

impl Drop for SimHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Errors starting the simulator.
#[derive(Debug)]
pub enum StartError {
    ControlNotLoopback(SocketAddr),
    Bind(SocketAddr, std::io::Error),
}

impl std::fmt::Display for StartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ControlNotLoopback(a) => write!(
                f,
                "the control port must be on a loopback address (127.0.0.1 / ::1), got {a}"
            ),
            Self::Bind(a, e) => write!(f, "cannot listen on {a}: {e}"),
        }
    }
}

impl std::error::Error for StartError {}

/// Binds the sockets and starts serving. Must be called inside a Tokio runtime.
///
/// # Errors
/// [`StartError`] when the control address is not loopback or a socket cannot be bound.
pub async fn start(config: SimConfig, log: LogFn) -> Result<SimHandle, StartError> {
    if let Some(control) = config.control {
        if !control.ip().is_loopback() {
            return Err(StartError::ControlNotLoopback(control));
        }
    }
    let listener = TcpListener::bind(config.listen)
        .await
        .map_err(|e| StartError::Bind(config.listen, e))?;
    let modbus_addr = listener
        .local_addr()
        .map_err(|e| StartError::Bind(config.listen, e))?;
    let core = Core::new(config.registers, config.units, config.limit, log);
    let mut tasks = vec![server::spawn_accept_loop(
        core.clone(),
        listener,
        modbus_addr,
    )];
    let mut control_addr = None;
    if let Some(control) = config.control {
        let l = TcpListener::bind(control)
            .await
            .map_err(|e| StartError::Bind(control, e))?;
        control_addr = Some(l.local_addr().map_err(|e| StartError::Bind(control, e))?);
        tasks.push(server::spawn_control(core.clone(), l));
    }
    if config.stdin {
        tasks.push(server::spawn_stdin(core.clone()));
    }
    core.log(&format!(
        "READY modbus={modbus_addr} control={}",
        control_addr.map_or("off".into(), |a| a.to_string())
    ));
    Ok(SimHandle {
        modbus_addr,
        control_addr,
        core,
        tasks,
    })
}
