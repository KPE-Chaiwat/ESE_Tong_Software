//! Error types. Every decoder returns one of these instead of panicking.

use thiserror::Error;

/// A request that cannot be sent because it violates the specification limits.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RequestError {
    #[error("quantity {quantity} is out of range for function {function:02}: allowed 1-{max}")]
    QuantityOutOfRange {
        function: u8,
        quantity: usize,
        max: u16,
    },
    #[error("address {address} + quantity {quantity} goes past the last address 65535")]
    AddressOverflow { address: u16, quantity: usize },
}

/// A request PDU that could not be decoded (used when acting as a slave).
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PduError {
    #[error("empty PDU")]
    Empty,
    #[error("unsupported function code {0:#04X}")]
    UnsupportedFunction(u8),
    #[error("PDU has {len} bytes, expected at least {expected}")]
    Truncated { len: usize, expected: usize },
    #[error("PDU has {len} bytes, expected {expected}")]
    TrailingBytes { len: usize, expected: usize },
    #[error("byte count {byte_count} does not match the quantity (expected {expected})")]
    ByteCountMismatch { byte_count: usize, expected: usize },
    #[error("invalid coil value {0:#06X} (expected 0xFF00 or 0x0000)")]
    InvalidCoilValue(u16),
    #[error(transparent)]
    Invalid(RequestError),
}

/// Category of an invalid reply. Stable set shared with the UI (BE-001 Q-06).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BadResponseKind {
    /// RTU CRC does not match the frame contents.
    Crc,
    /// The reply came from another slave / unit id.
    WrongSlave,
    /// The reply is for another function code.
    WrongFunction,
    /// The frame is complete but its contents are inconsistent (byte count, echo, length).
    Malformed,
    /// The MBAP transaction id differs from the request.
    TransactionMismatch,
    /// Fewer bytes arrived than the frame needs.
    ShortFrame,
}

/// An invalid reply, with enough detail for a precise message.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BadResponse {
    #[error("CRC mismatch (frame has {got:#06X}, computed {computed:#06X})")]
    Crc { computed: u16, got: u16 },
    #[error("reply from slave {got}, expected {expected}")]
    WrongSlave { expected: u8, got: u8 },
    #[error("reply for FC{got:02}, expected FC{expected:02}")]
    WrongFunction { expected: u8, got: u8 },
    #[error("transaction ID mismatch (got {got}, expected {expected})")]
    TransactionMismatch { expected: u16, got: u16 },
    /// The ADU is shorter than its header (MBAP length or RTU PDU header) announces.
    /// Both numbers are on-wire ADU bytes, as shown in the traffic log.
    #[error("short frame ({len} of {expected} bytes)")]
    ShortFrame { len: usize, expected: usize },
    #[error("malformed frame ({0})")]
    Malformed(String),
}

impl BadResponse {
    #[must_use]
    pub fn kind(&self) -> BadResponseKind {
        match self {
            Self::Crc { .. } => BadResponseKind::Crc,
            Self::WrongSlave { .. } => BadResponseKind::WrongSlave,
            Self::WrongFunction { .. } => BadResponseKind::WrongFunction,
            Self::TransactionMismatch { .. } => BadResponseKind::TransactionMismatch,
            Self::ShortFrame { .. } => BadResponseKind::ShortFrame,
            Self::Malformed(_) => BadResponseKind::Malformed,
        }
    }

    /// `(expected, got)` for the kinds that compare two numbers.
    #[must_use]
    pub fn expected_got(&self) -> Option<(u32, u32)> {
        match *self {
            Self::Crc { computed, got } => Some((computed.into(), got.into())),
            Self::WrongSlave { expected, got } | Self::WrongFunction { expected, got } => {
                Some((expected.into(), got.into()))
            }
            Self::TransactionMismatch { expected, got } => Some((expected.into(), got.into())),
            Self::ShortFrame { len, expected } => Some((
                u32::try_from(expected).unwrap_or(u32::MAX),
                u32::try_from(len).unwrap_or(u32::MAX),
            )),
            Self::Malformed(_) => None,
        }
    }

    pub(crate) fn malformed(detail: impl Into<String>) -> Self {
        Self::Malformed(detail.into())
    }
}
