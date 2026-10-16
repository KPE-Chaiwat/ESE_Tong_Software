//! Request PDUs for function codes 01-06, 15 and 16 (Modbus Application Protocol v1.1b3).

use crate::error::{PduError, RequestError};

/// Function codes supported by this crate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum FunctionCode {
    ReadCoils = 0x01,
    ReadDiscreteInputs = 0x02,
    ReadHoldingRegisters = 0x03,
    ReadInputRegisters = 0x04,
    WriteSingleCoil = 0x05,
    WriteSingleRegister = 0x06,
    WriteMultipleCoils = 0x0F,
    WriteMultipleRegisters = 0x10,
}

impl FunctionCode {
    /// Parses a function code byte. Returns `None` for unsupported codes.
    #[must_use]
    pub fn from_u8(value: u8) -> Option<Self> {
        Some(match value {
            0x01 => Self::ReadCoils,
            0x02 => Self::ReadDiscreteInputs,
            0x03 => Self::ReadHoldingRegisters,
            0x04 => Self::ReadInputRegisters,
            0x05 => Self::WriteSingleCoil,
            0x06 => Self::WriteSingleRegister,
            0x0F => Self::WriteMultipleCoils,
            0x10 => Self::WriteMultipleRegisters,
            _ => return None,
        })
    }

    #[must_use]
    pub fn as_u8(self) -> u8 {
        self as u8
    }

    /// Largest quantity allowed in one request for this function (1 for single writes).
    #[must_use]
    pub fn max_quantity(self) -> u16 {
        match self {
            Self::ReadCoils | Self::ReadDiscreteInputs => MAX_READ_BITS,
            Self::ReadHoldingRegisters | Self::ReadInputRegisters => MAX_READ_REGISTERS,
            Self::WriteSingleCoil | Self::WriteSingleRegister => 1,
            Self::WriteMultipleCoils => MAX_WRITE_COILS,
            Self::WriteMultipleRegisters => MAX_WRITE_REGISTERS,
        }
    }
}

/// Read coils / discrete inputs: quantity 1-2000.
pub const MAX_READ_BITS: u16 = 2000;
/// Read holding / input registers: quantity 1-125.
pub const MAX_READ_REGISTERS: u16 = 125;
/// Write multiple coils: quantity 1-1968.
pub const MAX_WRITE_COILS: u16 = 1968;
/// Write multiple registers: quantity 1-123.
pub const MAX_WRITE_REGISTERS: u16 = 123;

const COIL_ON: u16 = 0xFF00;
const COIL_OFF: u16 = 0x0000;

/// A Modbus request. Addresses are protocol (0-based) addresses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Request {
    ReadCoils { address: u16, quantity: u16 },
    ReadDiscreteInputs { address: u16, quantity: u16 },
    ReadHoldingRegisters { address: u16, quantity: u16 },
    ReadInputRegisters { address: u16, quantity: u16 },
    WriteSingleCoil { address: u16, value: bool },
    WriteSingleRegister { address: u16, value: u16 },
    WriteMultipleCoils { address: u16, values: Vec<bool> },
    WriteMultipleRegisters { address: u16, values: Vec<u16> },
}

impl Request {
    #[must_use]
    pub fn function(&self) -> FunctionCode {
        match self {
            Self::ReadCoils { .. } => FunctionCode::ReadCoils,
            Self::ReadDiscreteInputs { .. } => FunctionCode::ReadDiscreteInputs,
            Self::ReadHoldingRegisters { .. } => FunctionCode::ReadHoldingRegisters,
            Self::ReadInputRegisters { .. } => FunctionCode::ReadInputRegisters,
            Self::WriteSingleCoil { .. } => FunctionCode::WriteSingleCoil,
            Self::WriteSingleRegister { .. } => FunctionCode::WriteSingleRegister,
            Self::WriteMultipleCoils { .. } => FunctionCode::WriteMultipleCoils,
            Self::WriteMultipleRegisters { .. } => FunctionCode::WriteMultipleRegisters,
        }
    }

    #[must_use]
    pub fn address(&self) -> u16 {
        match self {
            Self::ReadCoils { address, .. }
            | Self::ReadDiscreteInputs { address, .. }
            | Self::ReadHoldingRegisters { address, .. }
            | Self::ReadInputRegisters { address, .. }
            | Self::WriteSingleCoil { address, .. }
            | Self::WriteSingleRegister { address, .. }
            | Self::WriteMultipleCoils { address, .. }
            | Self::WriteMultipleRegisters { address, .. } => *address,
        }
    }

    /// Number of coils/registers addressed by this request. Saturates at `u16::MAX` for
    /// oversized value lists (which `validate` rejects).
    #[must_use]
    pub fn quantity(&self) -> u16 {
        match self {
            Self::ReadCoils { quantity, .. }
            | Self::ReadDiscreteInputs { quantity, .. }
            | Self::ReadHoldingRegisters { quantity, .. }
            | Self::ReadInputRegisters { quantity, .. } => *quantity,
            Self::WriteSingleCoil { .. } | Self::WriteSingleRegister { .. } => 1,
            Self::WriteMultipleCoils { values, .. } => saturating_len(values.len()),
            Self::WriteMultipleRegisters { values, .. } => saturating_len(values.len()),
        }
    }

    /// Checks quantity limits and that `address + quantity <= 65536`.
    ///
    /// # Errors
    /// [`RequestError::QuantityOutOfRange`] or [`RequestError::AddressOverflow`].
    pub fn validate(&self) -> Result<(), RequestError> {
        let function = self.function();
        let max = function.max_quantity();
        let len = match self {
            Self::WriteMultipleCoils { values, .. } => values.len(),
            Self::WriteMultipleRegisters { values, .. } => values.len(),
            _ => usize::from(self.quantity()),
        };
        if len == 0 || len > usize::from(max) {
            return Err(RequestError::QuantityOutOfRange {
                function: function.as_u8(),
                quantity: len,
                max,
            });
        }
        let end = u32::from(self.address()) + len as u32;
        if end > 0x1_0000 {
            return Err(RequestError::AddressOverflow {
                address: self.address(),
                quantity: len,
            });
        }
        Ok(())
    }

    /// Encodes the request PDU (function code + data) after validating it.
    ///
    /// # Errors
    /// Any error from [`Request::validate`].
    pub fn encode_pdu(&self) -> Result<Vec<u8>, RequestError> {
        self.validate()?;
        let mut pdu = Vec::with_capacity(8);
        pdu.push(self.function().as_u8());
        push_u16(&mut pdu, self.address());
        match self {
            Self::ReadCoils { quantity, .. }
            | Self::ReadDiscreteInputs { quantity, .. }
            | Self::ReadHoldingRegisters { quantity, .. }
            | Self::ReadInputRegisters { quantity, .. } => push_u16(&mut pdu, *quantity),
            Self::WriteSingleCoil { value, .. } => {
                push_u16(&mut pdu, if *value { COIL_ON } else { COIL_OFF });
            }
            Self::WriteSingleRegister { value, .. } => push_u16(&mut pdu, *value),
            Self::WriteMultipleCoils { values, .. } => {
                let packed = pack_bits(values);
                push_u16(&mut pdu, self.quantity());
                pdu.push(byte_len(packed.len()));
                pdu.extend_from_slice(&packed);
            }
            Self::WriteMultipleRegisters { values, .. } => {
                push_u16(&mut pdu, self.quantity());
                pdu.push(byte_len(values.len() * 2));
                for v in values {
                    push_u16(&mut pdu, *v);
                }
            }
        }
        Ok(pdu)
    }

    /// Decodes a request PDU strictly (used by the fake slave and round-trip tests).
    ///
    /// # Errors
    /// [`PduError`] when the PDU is truncated, has trailing bytes, an unsupported function,
    /// inconsistent byte counts, an invalid coil value, or violates the request limits.
    pub fn decode_pdu(pdu: &[u8]) -> Result<Self, PduError> {
        let (&fc, _) = pdu.split_first().ok_or(PduError::Empty)?;
        let function = FunctionCode::from_u8(fc).ok_or(PduError::UnsupportedFunction(fc))?;
        let need = |n: usize| {
            if pdu.len() < n {
                Err(PduError::Truncated {
                    len: pdu.len(),
                    expected: n,
                })
            } else {
                Ok(())
            }
        };
        need(5)?;
        let address = read_u16(pdu, 1);
        let word = read_u16(pdu, 3);
        let request = match function {
            FunctionCode::ReadCoils => Self::ReadCoils {
                address,
                quantity: word,
            },
            FunctionCode::ReadDiscreteInputs => Self::ReadDiscreteInputs {
                address,
                quantity: word,
            },
            FunctionCode::ReadHoldingRegisters => Self::ReadHoldingRegisters {
                address,
                quantity: word,
            },
            FunctionCode::ReadInputRegisters => Self::ReadInputRegisters {
                address,
                quantity: word,
            },
            FunctionCode::WriteSingleCoil => Self::WriteSingleCoil {
                address,
                value: decode_coil(word)?,
            },
            FunctionCode::WriteSingleRegister => Self::WriteSingleRegister {
                address,
                value: word,
            },
            FunctionCode::WriteMultipleCoils | FunctionCode::WriteMultipleRegisters => {
                need(6)?;
                let quantity = word;
                let byte_count = usize::from(pdu[5]);
                let expected_count = if function == FunctionCode::WriteMultipleCoils {
                    usize::from(quantity).div_ceil(8)
                } else {
                    usize::from(quantity) * 2
                };
                if byte_count != expected_count {
                    return Err(PduError::ByteCountMismatch {
                        byte_count,
                        expected: expected_count,
                    });
                }
                need(6 + byte_count)?;
                let data = &pdu[6..6 + byte_count];
                if function == FunctionCode::WriteMultipleCoils {
                    Self::WriteMultipleCoils {
                        address,
                        values: unpack_bits(data, usize::from(quantity)),
                    }
                } else {
                    Self::WriteMultipleRegisters {
                        address,
                        values: data
                            .chunks_exact(2)
                            .map(|c| u16::from_be_bytes([c[0], c[1]]))
                            .collect(),
                    }
                }
            }
        };
        let consumed = match &request {
            Self::WriteMultipleCoils { .. } | Self::WriteMultipleRegisters { .. } => {
                6 + usize::from(pdu[5])
            }
            _ => 5,
        };
        if pdu.len() != consumed {
            return Err(PduError::TrailingBytes {
                len: pdu.len(),
                expected: consumed,
            });
        }
        request.validate().map_err(PduError::Invalid)?;
        Ok(request)
    }
}

pub(crate) fn decode_coil(word: u16) -> Result<bool, PduError> {
    match word {
        COIL_ON => Ok(true),
        COIL_OFF => Ok(false),
        other => Err(PduError::InvalidCoilValue(other)),
    }
}

pub(crate) fn push_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_be_bytes());
}

pub(crate) fn read_u16(buf: &[u8], at: usize) -> u16 {
    u16::from_be_bytes([buf[at], buf[at + 1]])
}

/// Packs bits LSB first, as the specification requires; unused high bits are zero.
#[must_use]
pub fn pack_bits(bits: &[bool]) -> Vec<u8> {
    let mut out = vec![0u8; bits.len().div_ceil(8)];
    for (i, &b) in bits.iter().enumerate() {
        if b {
            out[i / 8] |= 1 << (i % 8);
        }
    }
    out
}

/// Unpacks `count` bits LSB first. Missing bytes read as zero (callers check lengths first).
#[must_use]
pub fn unpack_bits(bytes: &[u8], count: usize) -> Vec<bool> {
    (0..count)
        .map(|i| bytes.get(i / 8).is_some_and(|b| b & (1 << (i % 8)) != 0))
        .collect()
}

fn saturating_len(len: usize) -> u16 {
    u16::try_from(len).unwrap_or(u16::MAX)
}

/// Byte counts are bounded by the validated limits (max 246), so this never truncates.
fn byte_len(len: usize) -> u8 {
    u8::try_from(len).unwrap_or(u8::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        s.split_whitespace()
            .map(|b| u8::from_str_radix(b, 16).unwrap())
            .collect()
    }

    // Request examples from the Modbus Application Protocol specification v1.1b3, section 6.
    #[test]
    fn spec_request_vectors() {
        let cases = [
            (
                Request::ReadCoils {
                    address: 0x13,
                    quantity: 0x13,
                },
                "01 00 13 00 13",
            ),
            (
                Request::ReadDiscreteInputs {
                    address: 0xC4,
                    quantity: 0x16,
                },
                "02 00 C4 00 16",
            ),
            (
                Request::ReadHoldingRegisters {
                    address: 0x6B,
                    quantity: 3,
                },
                "03 00 6B 00 03",
            ),
            (
                Request::ReadInputRegisters {
                    address: 0x08,
                    quantity: 1,
                },
                "04 00 08 00 01",
            ),
            (
                Request::WriteSingleCoil {
                    address: 0xAC,
                    value: true,
                },
                "05 00 AC FF 00",
            ),
            (
                Request::WriteSingleRegister {
                    address: 0x01,
                    value: 0x03,
                },
                "06 00 01 00 03",
            ),
            (
                Request::WriteMultipleCoils {
                    address: 0x13,
                    values: unpack_bits(&[0xCD, 0x01], 10),
                },
                "0F 00 13 00 0A 02 CD 01",
            ),
            (
                Request::WriteMultipleRegisters {
                    address: 0x01,
                    values: vec![0x000A, 0x0102],
                },
                "10 00 01 00 02 04 00 0A 01 02",
            ),
        ];
        for (request, bytes) in cases {
            let encoded = request.encode_pdu().unwrap();
            assert_eq!(encoded, hex(bytes), "{request:?}");
            assert_eq!(Request::decode_pdu(&encoded).unwrap(), request);
        }
    }

    #[test]
    fn quantity_limits() {
        let ok = |r: Request| assert!(r.validate().is_ok(), "{r:?}");
        let bad = |r: Request| {
            assert!(
                matches!(r.validate(), Err(RequestError::QuantityOutOfRange { .. })),
                "{r:?}"
            );
        };
        ok(Request::ReadCoils {
            address: 0,
            quantity: 2000,
        });
        bad(Request::ReadCoils {
            address: 0,
            quantity: 2001,
        });
        bad(Request::ReadDiscreteInputs {
            address: 0,
            quantity: 0,
        });
        ok(Request::ReadHoldingRegisters {
            address: 0,
            quantity: 125,
        });
        bad(Request::ReadInputRegisters {
            address: 0,
            quantity: 126,
        });
        ok(Request::WriteMultipleCoils {
            address: 0,
            values: vec![true; 1968],
        });
        bad(Request::WriteMultipleCoils {
            address: 0,
            values: vec![true; 1969],
        });
        ok(Request::WriteMultipleRegisters {
            address: 0,
            values: vec![1; 123],
        });
        bad(Request::WriteMultipleRegisters {
            address: 0,
            values: vec![1; 124],
        });
        bad(Request::WriteMultipleRegisters {
            address: 0,
            values: vec![],
        });
    }

    #[test]
    fn address_range_limit() {
        assert!(Request::ReadHoldingRegisters {
            address: 65535,
            quantity: 1
        }
        .validate()
        .is_ok());
        assert!(Request::ReadHoldingRegisters {
            address: 65530,
            quantity: 6
        }
        .validate()
        .is_ok());
        assert_eq!(
            Request::ReadHoldingRegisters {
                address: 65530,
                quantity: 7
            }
            .validate(),
            Err(RequestError::AddressOverflow {
                address: 65530,
                quantity: 7
            })
        );
        assert!(Request::WriteSingleRegister {
            address: 65535,
            value: 1
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn decode_rejects_bad_requests() {
        assert_eq!(Request::decode_pdu(&[]), Err(PduError::Empty));
        assert_eq!(
            Request::decode_pdu(&[0x07]),
            Err(PduError::UnsupportedFunction(7))
        );
        assert!(matches!(
            Request::decode_pdu(&hex("03 00 00 00")),
            Err(PduError::Truncated { .. })
        ));
        assert!(matches!(
            Request::decode_pdu(&hex("03 00 00 00 01 00")),
            Err(PduError::TrailingBytes { .. })
        ));
        assert_eq!(
            Request::decode_pdu(&hex("05 00 00 12 34")),
            Err(PduError::InvalidCoilValue(0x1234))
        );
        assert!(matches!(
            Request::decode_pdu(&hex("10 00 00 00 02 03 00 01 00")),
            Err(PduError::ByteCountMismatch { .. })
        ));
        assert!(matches!(
            Request::decode_pdu(&hex("03 00 00 00 7E")),
            Err(PduError::Invalid(_))
        ));
    }

    #[test]
    fn bit_packing_is_lsb_first() {
        let bits = [
            true, false, true, true, false, false, true, true, true, false,
        ];
        assert_eq!(pack_bits(&bits), vec![0xCD, 0x01]);
        assert_eq!(unpack_bits(&[0xCD, 0x01], 10), bits);
    }
}
