//! Opening links from a [`ConnectionConfig`]. Injectable so tests can use in-memory links.

use std::time::Duration;

use async_trait::async_trait;
use shared_types::{ConnectionConfig, Parity, ReasonKind, ReasonPhase, SessionReason};
use transport::{ConnectError, Link, LinkError, SerialParams, TcpParams};

/// Opens a link for a validated configuration.
#[async_trait]
pub trait Connector: Send + Sync + 'static {
    /// Must be cancel-safe: the session aborts the connect task on Cancel.
    async fn connect(&self, config: &ConnectionConfig) -> Result<Box<dyn Link>, ConnectError>;
}

/// Real TCP sockets and serial ports.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemConnector;

#[async_trait]
impl Connector for SystemConnector {
    async fn connect(&self, config: &ConnectionConfig) -> Result<Box<dyn Link>, ConnectError> {
        match config {
            ConnectionConfig::Tcp {
                host,
                port,
                timeout_ms,
            } => {
                let link = transport::connect_tcp(&TcpParams {
                    host: host.clone(),
                    port: *port,
                    timeout: Duration::from_millis(u64::from(*timeout_ms)),
                })
                .await?;
                Ok(Box::new(link))
            }
            ConnectionConfig::Rtu {
                port,
                baud,
                data_bits,
                parity,
                stop_bits,
                timeout_ms,
            } => {
                // Opened on the blocking pool and bounded by timeoutMs (REV-001 F7).
                let params = SerialParams {
                    port: port.clone(),
                    baud: *baud,
                    data_bits: *data_bits,
                    parity: match parity {
                        Parity::None => transport::Parity::None,
                        Parity::Even => transport::Parity::Even,
                        Parity::Odd => transport::Parity::Odd,
                    },
                    stop_bits: *stop_bits,
                };
                let timeout = Duration::from_millis(u64::from(*timeout_ms));
                let link = transport::connect_serial(&params, timeout).await?;
                Ok(Box::new(link))
            }
        }
    }
}

pub(crate) fn connect_reason(e: &ConnectError) -> SessionReason {
    let kind = match e {
        ConnectError::Refused => ReasonKind::Refused,
        ConnectError::Timeout => ReasonKind::ConnectTimeout,
        ConnectError::HostNotFound(_) => ReasonKind::HostNotFound,
        ConnectError::PortBusy(_) => ReasonKind::PortBusy,
        ConnectError::PortNotFound(_) => ReasonKind::PortNotFound,
        ConnectError::Io(_) => ReasonKind::IoError,
    };
    SessionReason {
        kind,
        phase: ReasonPhase::ConnectFailed,
        message: e.to_string(),
    }
}

pub(crate) fn link_reason(e: &LinkError) -> SessionReason {
    let kind = match e {
        LinkError::Closed => ReasonKind::ClosedByPeer,
        LinkError::PortRemoved(_) => ReasonKind::PortRemoved,
        LinkError::Io(_) => ReasonKind::IoError,
    };
    SessionReason {
        kind,
        phase: ReasonPhase::LinkLost,
        message: e.to_string(),
    }
}
