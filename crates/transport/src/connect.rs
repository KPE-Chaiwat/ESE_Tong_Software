//! Opening TCP and serial links.
//!
//! Both `connect_*` functions are cancel-safe: dropping (or aborting) the future while it
//! is pending leaves no socket or port handle open. This is how "Cancel" is implemented.

use std::io;
use std::net::SocketAddr;
use std::time::Duration;

use tokio::net::TcpStream;
use tokio::time::{timeout_at, Instant};
use tokio_serial::{SerialPortBuilderExt, SerialStream};

use crate::error::ConnectError;
use crate::link::{Framing, LinkKind, Role, StreamLink};

/// Parameters of a Modbus TCP connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TcpParams {
    /// IPv4 address or host name.
    pub host: String,
    pub port: u16,
    /// Connect timeout (the same value is used as response timeout, BE-001 Q-03).
    pub timeout: Duration,
}

/// Serial parity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Parity {
    None,
    Even,
    Odd,
}

/// Parameters of a Modbus RTU serial connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SerialParams {
    /// Port name, for example `COM3`.
    pub port: String,
    pub baud: u32,
    /// 7 or 8.
    pub data_bits: u8,
    pub parity: Parity,
    /// 1 or 2.
    pub stop_bits: u8,
}

/// Opens a TCP connection. Addresses are tried in order, IPv4 first, all within `timeout`.
///
/// # Errors
/// [`ConnectError::HostNotFound`], [`ConnectError::Refused`], [`ConnectError::Timeout`] or
/// [`ConnectError::Io`].
pub async fn connect_tcp(params: &TcpParams) -> Result<StreamLink<TcpStream>, ConnectError> {
    let deadline = Instant::now() + params.timeout;
    let mut addrs: Vec<SocketAddr> = match timeout_at(
        deadline,
        tokio::net::lookup_host((params.host.as_str(), params.port)),
    )
    .await
    {
        Err(_) => return Err(ConnectError::Timeout),
        Ok(Err(e)) => return Err(ConnectError::HostNotFound(e.to_string())),
        Ok(Ok(iter)) => iter.collect(),
    };
    addrs.sort_by_key(|a| !a.is_ipv4());
    if addrs.is_empty() {
        return Err(ConnectError::HostNotFound(params.host.clone()));
    }
    let mut last = ConnectError::Refused;
    for addr in addrs {
        match timeout_at(deadline, TcpStream::connect(addr)).await {
            Err(_) => return Err(ConnectError::Timeout),
            Ok(Ok(stream)) => {
                let _ = stream.set_nodelay(true);
                return Ok(StreamLink::new(
                    stream,
                    Framing::Tcp,
                    Role::Master,
                    LinkKind::Tcp,
                ));
            }
            Ok(Err(e)) => last = classify_connect(&e),
        }
    }
    Err(last)
}

fn classify_connect(e: &io::Error) -> ConnectError {
    match e.kind() {
        io::ErrorKind::ConnectionRefused => ConnectError::Refused,
        io::ErrorKind::TimedOut => ConnectError::Timeout,
        _ => ConnectError::Io(e.to_string()),
    }
}

/// RTU framing for the character format of `params` (start + data + parity + stop bits).
#[must_use]
pub fn framing_for(params: &SerialParams) -> Framing {
    let parity = u32::from(params.parity != Parity::None);
    let bits = 1 + u32::from(params.data_bits) + parity + u32::from(params.stop_bits);
    Framing::rtu(params.baud, bits)
}

/// Opens a serial port without blocking the async runtime (REV-001 F7).
///
/// The OS open (`CreateFileW`, `SetCommState`) runs on the blocking pool and is bounded by
/// `timeout` ([`ConnectError::Timeout`]). Dropping or aborting this future (Cancel) returns
/// at once; an open that is still stuck in the OS finishes on its blocking thread and the
/// port is closed immediately when it does.
///
/// # Errors
/// [`ConnectError::Timeout`], plus everything [`open_serial`] returns.
pub async fn connect_serial(
    params: &SerialParams,
    timeout: Duration,
) -> Result<StreamLink<SerialStream>, ConnectError> {
    let handle = tokio::runtime::Handle::current();
    let params = params.clone();
    let task = tokio::task::spawn_blocking(move || {
        // Registering the port with the reactor needs the runtime context.
        let _guard = handle.enter();
        open_serial(&params)
    });
    match tokio::time::timeout(timeout, task).await {
        Err(_) => Err(ConnectError::Timeout),
        Ok(Err(join)) => Err(ConnectError::Io(join.to_string())),
        Ok(Ok(result)) => result,
    }
}

/// Opens a serial port for Modbus RTU synchronously (blocks while the OS opens it). Must be
/// called inside a Tokio runtime context. Prefer [`connect_serial`] from async code.
///
/// # Errors
/// [`ConnectError::PortBusy`], [`ConnectError::PortNotFound`] or [`ConnectError::Io`].
pub fn open_serial(params: &SerialParams) -> Result<StreamLink<SerialStream>, ConnectError> {
    let builder = tokio_serial::new(&params.port, params.baud)
        .data_bits(match params.data_bits {
            7 => tokio_serial::DataBits::Seven,
            _ => tokio_serial::DataBits::Eight,
        })
        .parity(match params.parity {
            Parity::None => tokio_serial::Parity::None,
            Parity::Even => tokio_serial::Parity::Even,
            Parity::Odd => tokio_serial::Parity::Odd,
        })
        .stop_bits(match params.stop_bits {
            2 => tokio_serial::StopBits::Two,
            _ => tokio_serial::StopBits::One,
        })
        .flow_control(tokio_serial::FlowControl::None);
    match builder.open_native_async() {
        Ok(stream) => Ok(StreamLink::new(
            stream,
            framing_for(params),
            Role::Master,
            LinkKind::Serial,
        )),
        Err(e) => Err(classify_serial_open(&params.port, &e)),
    }
}

fn classify_serial_open(port: &str, e: &tokio_serial::Error) -> ConnectError {
    match e.kind() {
        tokio_serial::ErrorKind::NoDevice => probe_device(port),
        _ => ConnectError::Io(e.to_string()),
    }
}

/// `serialport` reports both "missing" and "in use" as `NoDevice` with a localized text.
/// Opening the device path again tells them apart by OS error code.
#[cfg(windows)]
fn probe_device(port: &str) -> ConnectError {
    let path = if port.starts_with(r"\\.\") {
        port.to_owned()
    } else {
        format!(r"\\.\{port}")
    };
    match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
    {
        // ERROR_ACCESS_DENIED: another process (or window) holds the port.
        Err(e) if e.raw_os_error() == Some(5) => ConnectError::PortBusy(port.to_owned()),
        Err(e) if matches!(e.raw_os_error(), Some(2 | 3)) => {
            ConnectError::PortNotFound(port.to_owned())
        }
        Err(e) => ConnectError::Io(e.to_string()),
        // It opened now: the first failure was transient (probably busy). Drop it at once.
        Ok(_) => ConnectError::PortBusy(port.to_owned()),
    }
}

#[cfg(not(windows))]
fn probe_device(port: &str) -> ConnectError {
    ConnectError::PortNotFound(port.to_owned())
}
