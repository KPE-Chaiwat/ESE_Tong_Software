//! Modbus Master protocol-level DTOs (DES-001 section 9, BE-001; extended by BE-002).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::session::PollId;

/// Connection settings. `mode` is the discriminant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum ConnectionConfig {
    /// Modbus TCP. `host` is an IPv4 address or host name (no IPv6, BE-001 Q-14).
    #[serde(rename_all = "camelCase")]
    Tcp {
        host: String,
        /// 1-65535.
        port: u16,
        /// Connect and response timeout, 50-10000 ms (BE-001 Q-03, Q-05).
        timeout_ms: u32,
    },
    /// Modbus RTU over a serial port.
    #[serde(rename_all = "camelCase")]
    Rtu {
        /// Port name from `mm_list_serial_ports`, for example `COM3`.
        port: String,
        /// One of 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200.
        baud: u32,
        #[ts(type = "7 | 8")]
        data_bits: u8,
        parity: Parity,
        #[ts(type = "1 | 2")]
        stop_bits: u8,
        /// Response timeout, 50-10000 ms.
        timeout_ms: u32,
    },
}

impl ConnectionConfig {
    #[must_use]
    pub fn timeout_ms(&self) -> u32 {
        match self {
            Self::Tcp { timeout_ms, .. } | Self::Rtu { timeout_ms, .. } => *timeout_ms,
        }
    }

    #[must_use]
    pub fn is_rtu(&self) -> bool {
        matches!(self, Self::Rtu { .. })
    }

    /// Short text for lists, for example `TCP 192.168.1.10:502` or `RTU COM3 9600 8E1`.
    #[must_use]
    pub fn summary(&self) -> String {
        match self {
            Self::Tcp { host, port, .. } => format!("TCP {host}:{port}"),
            Self::Rtu {
                port,
                baud,
                data_bits,
                parity,
                stop_bits,
                ..
            } => {
                let p = match parity {
                    Parity::None => 'N',
                    Parity::Even => 'E',
                    Parity::Odd => 'O',
                };
                format!("RTU {port} {baud} {data_bits}{p}{stop_bits}")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum Parity {
    None,
    Even,
    Odd,
}

/// What to poll. Addresses are protocol (0-based) addresses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollDefinition {
    /// 0-247. 0 is rejected for RTU reads (BE-001 Q-04).
    pub slave_id: u8,
    /// Read function code.
    #[ts(type = "1 | 2 | 3 | 4")]
    pub function: u8,
    /// Protocol address 0-65535.
    pub start_address: u16,
    /// FC01/02: 1-2000. FC03/04: 1-125. `startAddress + quantity <= 65536`.
    pub quantity: u16,
    /// 20-60000 ms between cycle starts (BE-001 Q-05).
    pub scan_rate_ms: u32,
}

/// Why the session is `disconnected` (DES-001 section 3.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ReasonKind {
    /// TCP connection refused.
    Refused,
    /// TCP connect did not finish within the timeout.
    ConnectTimeout,
    HostNotFound,
    /// Serial port is used by another application or window.
    PortBusy,
    PortNotFound,
    /// The TCP peer closed the connection.
    ClosedByPeer,
    /// The serial device was removed while connected.
    PortRemoved,
    /// Any other I/O error; see `message`.
    IoError,
}

/// Whether the reason ended a connect attempt (T3) or an established link (T13).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ReasonPhase {
    ConnectFailed,
    LinkLost,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SessionReason {
    pub kind: ReasonKind,
    pub phase: ReasonPhase,
    /// Technical detail in English (OS error text). The UI builds its own banner text.
    pub message: String,
}

/// A Modbus exception code byte (1 = illegal function, 2 = illegal data address, ...).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExceptionCode(pub u8);

/// Category of an invalid reply (BE-001 Q-06).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum BadResponseKind {
    /// RTU CRC mismatch.
    Crc,
    /// Reply from another slave / unit id.
    WrongSlave,
    /// Reply for another function code.
    WrongFunction,
    /// Complete frame with inconsistent contents (byte count, echo, MBAP length, trailing bytes).
    Malformed,
    /// MBAP transaction id differs from the request.
    TransactionMismatch,
    /// Fewer bytes than the frame needs arrived.
    ShortFrame,
}

/// Details of a bad response, for precise banner and traffic texts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BadResponseDetail {
    /// crc: computed CRC; wrongSlave: requested slave; wrongFunction: requested FC;
    /// transactionMismatch: sent id; shortFrame: needed length. Null for malformed.
    pub expected: Option<u32>,
    /// The value found in the reply (CRC, slave, FC, transaction id, or received length).
    pub got: Option<u32>,
    /// English description, for example `reply from slave 5, expected 1`.
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum TrafficDirection {
    Tx,
    Rx,
}

/// One frame exactly as it was written to or read from the wire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TrafficFrame {
    /// Per-session sequence number, strictly increasing; gaps mean frames were dropped.
    #[ts(type = "number")]
    pub seq: u64,
    #[ts(type = "number")]
    pub at: u64,
    pub direction: TrafficDirection,
    /// Raw ADU bytes (MBAP header or slave id + CRC included).
    pub bytes: Vec<u8>,
    pub slave_id: Option<u8>,
    /// Function code without the exception bit.
    pub function: Option<u8>,
    /// Set on RX exception replies.
    pub exception_code: Option<ExceptionCode>,
    /// Set on frames that need explanation: bad responses, discarded bytes, incomplete frames.
    pub note: Option<String>,
    /// The request this frame belongs to. Null for bytes that belong to no current request
    /// (late replies, bytes discarded before a request or received while idle).
    pub origin: Option<TrafficOrigin>,
}

/// What caused a traffic frame. `kind` is the discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TrafficOrigin {
    /// A poll request or its reply.
    #[serde(rename_all = "camelCase")]
    Poll { poll_id: PollId },
    /// A write or its reply; `pollId` is the poll window it was sent from, if any.
    #[serde(rename_all = "camelCase")]
    Write { poll_id: Option<PollId> },
}

/// A write. `values` holds one entry for FC05/06; coils are 0 or 1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    /// 0-247; 0 is broadcast (no reply, result `broadcastSent`).
    pub slave_id: u8,
    #[ts(type = "5 | 6 | 15 | 16")]
    pub function: u8,
    /// Protocol address 0-65535.
    pub address: u16,
    /// FC05: [0|1]. FC06: [0-65535]. FC15: 1-1968 values of 0/1. FC16: 1-123 values.
    pub values: Vec<u16>,
}

/// Outcome of `mm_write`. `status` is the discriminant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WriteResult {
    /// The slave confirmed the write.
    Ok,
    /// Sent to slave 0; nobody replies (BE-001 Q-08).
    BroadcastSent,
    Exception {
        code: ExceptionCode,
    },
    /// No reply within the timeout. The write may or may not have been applied.
    Timeout,
    BadResponse {
        kind: BadResponseKind,
        detail: BadResponseDetail,
    },
    /// No link (state not connected / paused / polling). Nothing was sent.
    NotConnected,
    /// The link was lost or closed while this write was in flight. It was (probably)
    /// transmitted, so it may or may not have been applied (REV-001 F9).
    LinkLost,
}

/// Traffic counters, owned by the backend (BE-001 Q-07).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Counters {
    /// Requests written to the link (polls and writes, including broadcasts).
    #[ts(type = "number")]
    pub requests: u64,
    /// Valid replies, including exception replies.
    #[ts(type = "number")]
    pub responses: u64,
    /// Exception replies plus bad responses.
    #[ts(type = "number")]
    pub errors: u64,
    /// Requests without a reply within the timeout.
    #[ts(type = "number")]
    pub timeouts: u64,
}

/// Values of one successful poll cycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollUpdate {
    pub poll_id: PollId,
    /// Cycle sequence number, strictly increasing per poll. Gaps mean coalesced updates.
    #[ts(type = "number")]
    pub seq: u64,
    #[ts(type = "number")]
    pub at: u64,
    pub slave_id: u8,
    #[ts(type = "1 | 2 | 3 | 4")]
    pub function: u8,
    pub start_address: u16,
    /// Raw u16 register values, or 0/1 for coils and discrete inputs. Length = quantity.
    pub values: Vec<u16>,
    pub round_trip_ms: u32,
}

/// A batch of traffic frames (at most one batch every 50 ms).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TrafficFrames {
    pub frames: Vec<TrafficFrame>,
}

/// One serial port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    /// Name to pass in `ConnectionConfig.port`, for example `COM3`.
    pub name: String,
    pub description: Option<String>,
}
