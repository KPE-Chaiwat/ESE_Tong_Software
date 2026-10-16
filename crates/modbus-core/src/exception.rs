//! Modbus exception codes (Modbus Application Protocol specification, section 7).

use std::fmt;

/// A Modbus exception code as received in an exception response (`function | 0x80`, code).
///
/// Any byte value is representable: devices may send codes this crate does not know.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ExceptionCode(pub u8);

impl ExceptionCode {
    pub const ILLEGAL_FUNCTION: Self = Self(0x01);
    pub const ILLEGAL_DATA_ADDRESS: Self = Self(0x02);
    pub const ILLEGAL_DATA_VALUE: Self = Self(0x03);
    pub const SERVER_DEVICE_FAILURE: Self = Self(0x04);
    pub const ACKNOWLEDGE: Self = Self(0x05);
    pub const SERVER_DEVICE_BUSY: Self = Self(0x06);
    pub const MEMORY_PARITY_ERROR: Self = Self(0x08);
    pub const GATEWAY_PATH_UNAVAILABLE: Self = Self(0x0A);
    pub const GATEWAY_TARGET_FAILED: Self = Self(0x0B);

    /// Human readable name from the public specification, `None` for unknown codes.
    #[must_use]
    pub fn name(self) -> Option<&'static str> {
        Some(match self.0 {
            0x01 => "Illegal function",
            0x02 => "Illegal data address",
            0x03 => "Illegal data value",
            0x04 => "Server device failure",
            0x05 => "Acknowledge",
            0x06 => "Server device busy",
            0x08 => "Memory parity error",
            0x0A => "Gateway path unavailable",
            0x0B => "Gateway target device failed to respond",
            _ => return None,
        })
    }
}

impl fmt::Display for ExceptionCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:02X} ({})",
            self.0,
            self.name().unwrap_or("Unknown exception")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_and_unknown_names() {
        assert_eq!(
            ExceptionCode::ILLEGAL_DATA_ADDRESS.name(),
            Some("Illegal data address")
        );
        assert_eq!(ExceptionCode(0x0C).name(), None);
        assert_eq!(ExceptionCode(0x0C).to_string(), "0C (Unknown exception)");
        assert_eq!(ExceptionCode(0x02).to_string(), "02 (Illegal data address)");
    }
}
