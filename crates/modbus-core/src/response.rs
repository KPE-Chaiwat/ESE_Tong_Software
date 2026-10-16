//! Response PDUs, exception responses, and validation of a reply against its request.

use crate::error::BadResponse;
use crate::exception::ExceptionCode;
use crate::request::{decode_coil, pack_bits, push_u16, read_u16, unpack_bits, Request};

/// A normal (non-exception) response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Response {
    ReadCoils(Vec<bool>),
    ReadDiscreteInputs(Vec<bool>),
    ReadHoldingRegisters(Vec<u16>),
    ReadInputRegisters(Vec<u16>),
    WriteSingleCoil { address: u16, value: bool },
    WriteSingleRegister { address: u16, value: u16 },
    WriteMultipleCoils { address: u16, quantity: u16 },
    WriteMultipleRegisters { address: u16, quantity: u16 },
}

/// What a slave can answer: a normal response or an exception.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    Response(Response),
    /// `function` is the request function code (without the 0x80 bit).
    Exception {
        function: u8,
        code: ExceptionCode,
    },
}

impl Response {
    #[must_use]
    pub fn function_code(&self) -> u8 {
        match self {
            Self::ReadCoils(_) => 0x01,
            Self::ReadDiscreteInputs(_) => 0x02,
            Self::ReadHoldingRegisters(_) => 0x03,
            Self::ReadInputRegisters(_) => 0x04,
            Self::WriteSingleCoil { .. } => 0x05,
            Self::WriteSingleRegister { .. } => 0x06,
            Self::WriteMultipleCoils { .. } => 0x0F,
            Self::WriteMultipleRegisters { .. } => 0x10,
        }
    }

    /// Encodes the response PDU (used by the fake slave and tests). Lists longer than a
    /// PDU can carry are truncated to 255 data bytes; callers keep within the limits.
    #[must_use]
    pub fn encode_pdu(&self) -> Vec<u8> {
        let mut pdu = vec![self.function_code()];
        match self {
            Self::ReadCoils(bits) | Self::ReadDiscreteInputs(bits) => {
                let mut packed = pack_bits(bits);
                packed.truncate(255);
                pdu.push(u8::try_from(packed.len()).unwrap_or(u8::MAX));
                pdu.extend_from_slice(&packed);
            }
            Self::ReadHoldingRegisters(regs) | Self::ReadInputRegisters(regs) => {
                let regs = &regs[..regs.len().min(127)];
                pdu.push(u8::try_from(regs.len() * 2).unwrap_or(u8::MAX));
                for r in regs {
                    push_u16(&mut pdu, *r);
                }
            }
            Self::WriteSingleCoil { address, value } => {
                push_u16(&mut pdu, *address);
                push_u16(&mut pdu, if *value { 0xFF00 } else { 0x0000 });
            }
            Self::WriteSingleRegister { address, value } => {
                push_u16(&mut pdu, *address);
                push_u16(&mut pdu, *value);
            }
            Self::WriteMultipleCoils { address, quantity }
            | Self::WriteMultipleRegisters { address, quantity } => {
                push_u16(&mut pdu, *address);
                push_u16(&mut pdu, *quantity);
            }
        }
        pdu
    }
}

impl Reply {
    /// Encodes the reply PDU. Exceptions are `function | 0x80, code`.
    #[must_use]
    pub fn encode_pdu(&self) -> Vec<u8> {
        match self {
            Self::Response(r) => r.encode_pdu(),
            Self::Exception { function, code } => vec![function | 0x80, code.0],
        }
    }

    /// The normal response a correct slave sends for `request`, given the data it read
    /// (`bits` for FC01/02, `registers` for FC03/04; ignored for writes).
    #[must_use]
    pub fn echo_for(request: &Request, bits: Vec<bool>, registers: Vec<u16>) -> Self {
        Self::Response(match request {
            Request::ReadCoils { .. } => Response::ReadCoils(bits),
            Request::ReadDiscreteInputs { .. } => Response::ReadDiscreteInputs(bits),
            Request::ReadHoldingRegisters { .. } => Response::ReadHoldingRegisters(registers),
            Request::ReadInputRegisters { .. } => Response::ReadInputRegisters(registers),
            Request::WriteSingleCoil { address, value } => Response::WriteSingleCoil {
                address: *address,
                value: *value,
            },
            Request::WriteSingleRegister { address, value } => Response::WriteSingleRegister {
                address: *address,
                value: *value,
            },
            Request::WriteMultipleCoils { address, .. } => Response::WriteMultipleCoils {
                address: *address,
                quantity: request.quantity(),
            },
            Request::WriteMultipleRegisters { address, .. } => Response::WriteMultipleRegisters {
                address: *address,
                quantity: request.quantity(),
            },
        })
    }
}

/// Validates a reply PDU against the request it answers.
///
/// The PDU comes from an ADU that is complete per its own header, so every length
/// inconsistency inside it is [`BadResponse::Malformed`]. [`BadResponse::ShortFrame`] is
/// reported only by the ADU layer, in on-wire bytes (REV-001 F4).
///
/// # Errors
/// [`BadResponse::WrongFunction`] or [`BadResponse::Malformed`].
pub fn decode_reply_pdu(request: &Request, pdu: &[u8]) -> Result<Reply, BadResponse> {
    let expected_fc = request.function().as_u8();
    let Some(&fc) = pdu.first() else {
        return Err(BadResponse::malformed("empty PDU"));
    };
    if fc & 0x7F != expected_fc {
        return Err(BadResponse::WrongFunction {
            expected: expected_fc,
            got: fc & 0x7F,
        });
    }
    if fc & 0x80 != 0 {
        return match pdu.len() {
            0 | 1 => Err(BadResponse::malformed("exception response without a code")),
            2 => Ok(Reply::Exception {
                function: expected_fc,
                code: ExceptionCode(pdu[1]),
            }),
            n => Err(BadResponse::malformed(format!(
                "exception response has {n} bytes, expected 2"
            ))),
        };
    }

    let response = match request {
        Request::ReadCoils { quantity, .. }
        | Request::ReadDiscreteInputs { quantity, .. }
        | Request::ReadHoldingRegisters { quantity, .. }
        | Request::ReadInputRegisters { quantity, .. } => {
            let is_bits = matches!(
                request,
                Request::ReadCoils { .. } | Request::ReadDiscreteInputs { .. }
            );
            let expected_count = if is_bits {
                usize::from(*quantity).div_ceil(8)
            } else {
                usize::from(*quantity) * 2
            };
            if pdu.len() < 2 {
                return Err(BadResponse::malformed("read response without a byte count"));
            }
            let byte_count = usize::from(pdu[1]);
            if byte_count != expected_count {
                return Err(BadResponse::malformed(format!(
                    "byte count {byte_count}, expected {expected_count}"
                )));
            }
            check_len(pdu, 2 + byte_count)?;
            let data = &pdu[2..];
            match request {
                Request::ReadCoils { .. } => {
                    Response::ReadCoils(unpack_bits(data, usize::from(*quantity)))
                }
                Request::ReadDiscreteInputs { .. } => {
                    Response::ReadDiscreteInputs(unpack_bits(data, usize::from(*quantity)))
                }
                _ => {
                    let regs = data
                        .chunks_exact(2)
                        .map(|c| u16::from_be_bytes([c[0], c[1]]))
                        .collect();
                    if matches!(request, Request::ReadHoldingRegisters { .. }) {
                        Response::ReadHoldingRegisters(regs)
                    } else {
                        Response::ReadInputRegisters(regs)
                    }
                }
            }
        }
        Request::WriteSingleCoil { address, value } => {
            check_len(pdu, 5)?;
            let got_value =
                decode_coil(read_u16(pdu, 3)).map_err(|e| BadResponse::malformed(e.to_string()))?;
            check_echo(*address, read_u16(pdu, 1), "address")?;
            if got_value != *value {
                return Err(BadResponse::malformed("echoed coil value differs"));
            }
            Response::WriteSingleCoil {
                address: *address,
                value: *value,
            }
        }
        Request::WriteSingleRegister { address, value } => {
            check_len(pdu, 5)?;
            check_echo(*address, read_u16(pdu, 1), "address")?;
            check_echo(*value, read_u16(pdu, 3), "value")?;
            Response::WriteSingleRegister {
                address: *address,
                value: *value,
            }
        }
        Request::WriteMultipleCoils { address, .. }
        | Request::WriteMultipleRegisters { address, .. } => {
            check_len(pdu, 5)?;
            check_echo(*address, read_u16(pdu, 1), "address")?;
            check_echo(request.quantity(), read_u16(pdu, 3), "quantity")?;
            if matches!(request, Request::WriteMultipleCoils { .. }) {
                Response::WriteMultipleCoils {
                    address: *address,
                    quantity: request.quantity(),
                }
            } else {
                Response::WriteMultipleRegisters {
                    address: *address,
                    quantity: request.quantity(),
                }
            }
        }
    };
    Ok(Reply::Response(response))
}

fn check_len(pdu: &[u8], expected: usize) -> Result<(), BadResponse> {
    match pdu.len() {
        n if n < expected => Err(BadResponse::malformed(format!(
            "PDU has {n} bytes, expected {expected}"
        ))),
        n if n > expected => Err(BadResponse::malformed(format!(
            "{} unexpected trailing bytes",
            n - expected
        ))),
        _ => Ok(()),
    }
}

fn check_echo(expected: u16, got: u16, what: &str) -> Result<(), BadResponse> {
    if expected == got {
        Ok(())
    } else {
        Err(BadResponse::malformed(format!(
            "echoed {what} {got}, expected {expected}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::BadResponseKind;

    fn hex(s: &str) -> Vec<u8> {
        s.split_whitespace()
            .map(|b| u8::from_str_radix(b, 16).unwrap())
            .collect()
    }

    // Response examples from the Modbus Application Protocol specification v1.1b3, section 6.
    #[test]
    fn spec_response_vectors() {
        let cases: Vec<(Request, &str, Response)> = vec![
            (
                Request::ReadCoils {
                    address: 0x13,
                    quantity: 0x13,
                },
                "01 03 CD 6B 05",
                Response::ReadCoils(unpack_bits(&[0xCD, 0x6B, 0x05], 19)),
            ),
            (
                Request::ReadDiscreteInputs {
                    address: 0xC4,
                    quantity: 0x16,
                },
                "02 03 AC DB 35",
                Response::ReadDiscreteInputs(unpack_bits(&[0xAC, 0xDB, 0x35], 22)),
            ),
            (
                Request::ReadHoldingRegisters {
                    address: 0x6B,
                    quantity: 3,
                },
                "03 06 02 2B 00 00 00 64",
                Response::ReadHoldingRegisters(vec![0x022B, 0x0000, 0x0064]),
            ),
            (
                Request::ReadInputRegisters {
                    address: 0x08,
                    quantity: 1,
                },
                "04 02 00 0A",
                Response::ReadInputRegisters(vec![0x000A]),
            ),
            (
                Request::WriteSingleCoil {
                    address: 0xAC,
                    value: true,
                },
                "05 00 AC FF 00",
                Response::WriteSingleCoil {
                    address: 0xAC,
                    value: true,
                },
            ),
            (
                Request::WriteSingleRegister {
                    address: 1,
                    value: 3,
                },
                "06 00 01 00 03",
                Response::WriteSingleRegister {
                    address: 1,
                    value: 3,
                },
            ),
            (
                Request::WriteMultipleCoils {
                    address: 0x13,
                    values: vec![true; 10],
                },
                "0F 00 13 00 0A",
                Response::WriteMultipleCoils {
                    address: 0x13,
                    quantity: 10,
                },
            ),
            (
                Request::WriteMultipleRegisters {
                    address: 1,
                    values: vec![0x000A, 0x0102],
                },
                "10 00 01 00 02",
                Response::WriteMultipleRegisters {
                    address: 1,
                    quantity: 2,
                },
            ),
        ];
        for (request, bytes, response) in cases {
            let pdu = hex(bytes);
            assert_eq!(
                decode_reply_pdu(&request, &pdu).unwrap(),
                Reply::Response(response.clone()),
                "{request:?}"
            );
            assert_eq!(response.encode_pdu(), pdu);
        }
    }

    #[test]
    fn exception_vectors() {
        let read = Request::ReadCoils {
            address: 0,
            quantity: 1,
        };
        // Spec example: FC01 answered with 81 02 (illegal data address).
        assert_eq!(
            decode_reply_pdu(&read, &hex("81 02")).unwrap(),
            Reply::Exception {
                function: 1,
                code: ExceptionCode::ILLEGAL_DATA_ADDRESS
            }
        );
        let write = Request::WriteMultipleRegisters {
            address: 0,
            values: vec![1],
        };
        let exc = Reply::Exception {
            function: 0x10,
            code: ExceptionCode(0x04),
        };
        assert_eq!(exc.encode_pdu(), hex("90 04"));
        assert_eq!(decode_reply_pdu(&write, &hex("90 04")).unwrap(), exc);
        assert_eq!(
            decode_reply_pdu(&write, &hex("90")).unwrap_err().kind(),
            BadResponseKind::Malformed
        );
        assert_eq!(
            decode_reply_pdu(&write, &hex("90 04 00"))
                .unwrap_err()
                .kind(),
            BadResponseKind::Malformed
        );
    }

    #[test]
    fn bad_reply_classification() {
        let read = Request::ReadHoldingRegisters {
            address: 0,
            quantity: 2,
        };
        let kind = |pdu: &str| decode_reply_pdu(&read, &hex(pdu)).unwrap_err().kind();
        assert_eq!(
            decode_reply_pdu(&read, &hex("04 04 00 01 00 02")).unwrap_err(),
            BadResponse::WrongFunction {
                expected: 3,
                got: 4
            }
        );
        // Inside a complete ADU every PDU length problem is malformed (REV-001 F4).
        assert_eq!(kind("83"), BadResponseKind::Malformed);
        assert_eq!(kind("84 02"), BadResponseKind::WrongFunction);
        assert_eq!(kind("03 02 00 01"), BadResponseKind::Malformed); // byte count
        assert_eq!(kind("03 04 00 01 00"), BadResponseKind::Malformed);
        assert_eq!(kind("03 04 00 01 00 02 FF"), BadResponseKind::Malformed);
        assert_eq!(kind(""), BadResponseKind::Malformed);

        let write = Request::WriteSingleRegister {
            address: 5,
            value: 7,
        };
        assert_eq!(
            decode_reply_pdu(&write, &hex("06 00 05 00 08"))
                .unwrap_err()
                .kind(),
            BadResponseKind::Malformed
        );
        let coil = Request::WriteSingleCoil {
            address: 5,
            value: true,
        };
        assert_eq!(
            decode_reply_pdu(&coil, &hex("05 00 05 12 34"))
                .unwrap_err()
                .kind(),
            BadResponseKind::Malformed
        );
    }
}
