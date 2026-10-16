//! Byte transports (TCP, serial) used by the Modbus master. Depends on `modbus-core`.
//!
//! - [`Link`]: one async trait for every byte link, exchanging whole Modbus frames.
//! - [`StreamLink`]: the implementation over TCP sockets, serial ports and in-memory streams.
//! - [`connect_tcp`] / [`connect_serial`]: open links; both are cancel-safe (drop = cancel)
//!   and bounded by the connect timeout.
//! - [`SerialPortLister`]: OS-specific port enumeration behind a trait.

mod connect;
mod error;
#[cfg(any(test, feature = "test-support"))]
pub mod fake;
mod link;
mod ports;

pub use connect::{
    connect_serial, connect_tcp, framing_for, open_serial, Parity, SerialParams, TcpParams,
};
pub use error::{ConnectError, LinkError, ListPortsError, ReceiveError};
pub use link::{Framing, Link, LinkKind, Role, RtuTiming, StreamLink, MIN_RTU_SILENCE};
pub use ports::{
    is_valid_serial_port_name, sort_ports, PortEntry, SerialPortLister, SystemPortLister,
};

/// Length of the MBAP header of a Modbus TCP frame.
pub const MBAP_HEADER_SIZE: usize = modbus_core::MBAP_HEADER_SIZE;

/// Maximum size of a Modbus TCP ADU (MBAP header + PDU).
pub const MAX_TCP_ADU_SIZE: usize = modbus_core::MAX_TCP_ADU_SIZE;

#[cfg(test)]
mod tests;
