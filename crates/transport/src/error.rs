//! Transport errors.

use std::io;

use thiserror::Error;

use crate::link::LinkKind;

/// Why a connection attempt failed. Mirrors the UI reason kinds of DES-001 section 3.4.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ConnectError {
    #[error("connection refused")]
    Refused,
    #[error("no answer within the timeout")]
    Timeout,
    #[error("host could not be resolved: {0}")]
    HostNotFound(String),
    #[error("serial port is in use: {0}")]
    PortBusy(String),
    #[error("serial port not found: {0}")]
    PortNotFound(String),
    #[error("{0}")]
    Io(String),
}

/// A failure of an established link.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum LinkError {
    /// The peer closed the connection (TCP FIN / end of stream).
    #[error("connection closed by the peer")]
    Closed,
    /// The serial device disappeared (USB adapter unplugged).
    #[error("serial port removed: {0}")]
    PortRemoved(String),
    #[error("{0}")]
    Io(String),
}

impl LinkError {
    pub(crate) fn from_io(kind: LinkKind, err: &io::Error) -> Self {
        use io::ErrorKind as K;
        match err.kind() {
            K::ConnectionReset | K::ConnectionAborted | K::BrokenPipe | K::UnexpectedEof
                if kind != LinkKind::Serial =>
            {
                return Self::Closed;
            }
            _ => {}
        }
        if kind == LinkKind::Serial && is_device_gone(err) {
            return Self::PortRemoved(err.to_string());
        }
        Self::Io(err.to_string())
    }
}

/// Windows error codes seen when a USB serial adapter is unplugged mid-session.
fn is_device_gone(err: &io::Error) -> bool {
    // ERROR_FILE_NOT_FOUND 2, ERROR_ACCESS_DENIED 5, ERROR_INVALID_HANDLE 6,
    // ERROR_BAD_COMMAND 22, ERROR_GEN_FAILURE 31, ERROR_OPERATION_ABORTED 995,
    // ERROR_DEVICE_NOT_CONNECTED 1167.
    cfg!(windows) && matches!(err.raw_os_error(), Some(2 | 5 | 6 | 22 | 31 | 995 | 1167))
}

/// Outcome of [`crate::Link::receive_frame`] other than a frame.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ReceiveError {
    /// The deadline passed. `partial` holds bytes of an incomplete frame, if any arrived.
    #[error("timeout ({} bytes received)", partial.len())]
    Timeout { partial: Vec<u8> },
    /// The link failed while waiting. `partial` holds bytes received before the failure.
    #[error("{error}")]
    Link { error: LinkError, partial: Vec<u8> },
}

/// Listing serial ports failed.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ListPortsError {
    #[error("listing serial ports is not supported on this operating system")]
    NotSupported,
    #[error("{0}")]
    Io(String),
}
