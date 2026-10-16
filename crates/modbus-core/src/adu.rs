//! Application data units: Modbus TCP (MBAP header) and Modbus RTU (slave + PDU + CRC).

use crate::crc::crc16;
use crate::error::{BadResponse, PduError};
use crate::request::Request;
use crate::response::{decode_reply_pdu, Reply};
use crate::MAX_PDU_SIZE;

/// Length of the MBAP header (transaction id, protocol id, length, unit id).
pub const MBAP_HEADER_SIZE: usize = 7;
/// Largest Modbus TCP ADU.
pub const MAX_TCP_ADU_SIZE: usize = MBAP_HEADER_SIZE + MAX_PDU_SIZE;
/// Largest Modbus RTU ADU (slave + PDU + CRC).
pub const MAX_RTU_ADU_SIZE: usize = 1 + MAX_PDU_SIZE + 2;

/// Result of inspecting the first bytes of a frame that is still arriving.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameLength {
    /// More bytes are needed before the total length is known.
    NeedMore,
    /// The complete frame has this many bytes.
    Total(usize),
    /// The length cannot be derived from the header (unknown function, nonsense length).
    /// Transports fall back to inter-frame silence.
    Unknown,
}

/// The MBAP header of a Modbus TCP frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MbapHeader {
    pub transaction_id: u16,
    pub protocol_id: u16,
    /// Number of following bytes (unit id + PDU).
    pub length: u16,
    pub unit_id: u8,
}

/// Builds a Modbus TCP ADU around `pdu`.
#[must_use]
pub fn encode_tcp(transaction_id: u16, unit_id: u8, pdu: &[u8]) -> Vec<u8> {
    let mut adu = Vec::with_capacity(MBAP_HEADER_SIZE + pdu.len());
    adu.extend_from_slice(&transaction_id.to_be_bytes());
    adu.extend_from_slice(&0u16.to_be_bytes());
    let length = u16::try_from(pdu.len() + 1).unwrap_or(u16::MAX);
    adu.extend_from_slice(&length.to_be_bytes());
    adu.push(unit_id);
    adu.extend_from_slice(pdu);
    adu
}

/// Total length of a TCP frame from its first bytes.
#[must_use]
pub fn tcp_frame_length(prefix: &[u8]) -> FrameLength {
    if prefix.len() < 6 {
        return FrameLength::NeedMore;
    }
    let length = usize::from(u16::from_be_bytes([prefix[4], prefix[5]]));
    if !(2..=MAX_PDU_SIZE + 1).contains(&length) {
        FrameLength::Unknown
    } else {
        FrameLength::Total(6 + length)
    }
}

/// Splits a complete TCP frame into header and PDU.
///
/// # Errors
/// [`BadResponse::ShortFrame`] when the frame is shorter than the header or its length
/// field; [`BadResponse::Malformed`] for a non-zero protocol id or trailing bytes.
pub fn decode_tcp(frame: &[u8]) -> Result<(MbapHeader, &[u8]), BadResponse> {
    if frame.len() < MBAP_HEADER_SIZE + 1 {
        return Err(BadResponse::ShortFrame {
            len: frame.len(),
            expected: MBAP_HEADER_SIZE + 1,
        });
    }
    let header = MbapHeader {
        transaction_id: u16::from_be_bytes([frame[0], frame[1]]),
        protocol_id: u16::from_be_bytes([frame[2], frame[3]]),
        length: u16::from_be_bytes([frame[4], frame[5]]),
        unit_id: frame[6],
    };
    if header.protocol_id != 0 {
        return Err(BadResponse::Malformed(format!(
            "protocol id {}, expected 0",
            header.protocol_id
        )));
    }
    let expected = 6 + usize::from(header.length);
    if header.length < 2 {
        return Err(BadResponse::Malformed(format!(
            "MBAP length {}",
            header.length
        )));
    }
    if frame.len() < expected {
        return Err(BadResponse::ShortFrame {
            len: frame.len(),
            expected,
        });
    }
    if frame.len() > expected {
        return Err(BadResponse::Malformed(format!(
            "{} bytes after the MBAP length",
            frame.len() - expected
        )));
    }
    Ok((header, &frame[MBAP_HEADER_SIZE..]))
}

/// Validates a complete TCP reply for `request` sent with `transaction_id` to `unit_id`.
///
/// Check order: frame/header shape, transaction id, unit id, then the PDU.
///
/// # Errors
/// Any [`BadResponse`].
pub fn parse_tcp_reply(
    request: &Request,
    transaction_id: u16,
    unit_id: u8,
    frame: &[u8],
) -> Result<Reply, BadResponse> {
    let (header, pdu) = decode_tcp(frame)?;
    if header.transaction_id != transaction_id {
        return Err(BadResponse::TransactionMismatch {
            expected: transaction_id,
            got: header.transaction_id,
        });
    }
    if header.unit_id != unit_id {
        return Err(BadResponse::WrongSlave {
            expected: unit_id,
            got: header.unit_id,
        });
    }
    decode_reply_pdu(request, pdu)
}

/// Builds a Modbus RTU ADU: slave, PDU, CRC (low byte first).
#[must_use]
pub fn encode_rtu(slave: u8, pdu: &[u8]) -> Vec<u8> {
    let mut adu = Vec::with_capacity(pdu.len() + 3);
    adu.push(slave);
    adu.extend_from_slice(pdu);
    let crc = crc16(&adu);
    adu.extend_from_slice(&crc.to_le_bytes());
    adu
}

/// Total length of an RTU *response* frame from its first bytes.
#[must_use]
pub fn rtu_response_length(prefix: &[u8]) -> FrameLength {
    let Some(&fc) = prefix.get(1) else {
        return FrameLength::NeedMore;
    };
    if fc & 0x80 != 0 {
        return FrameLength::Total(5);
    }
    match fc {
        0x01..=0x04 => match prefix.get(2) {
            None => FrameLength::NeedMore,
            Some(&count) => FrameLength::Total(3 + usize::from(count) + 2),
        },
        0x05 | 0x06 | 0x0F | 0x10 => FrameLength::Total(8),
        _ => FrameLength::Unknown,
    }
}

/// Total length of an RTU *request* frame from its first bytes (for the fake slave).
#[must_use]
pub fn rtu_request_length(prefix: &[u8]) -> FrameLength {
    let Some(&fc) = prefix.get(1) else {
        return FrameLength::NeedMore;
    };
    match fc {
        0x01..=0x06 => FrameLength::Total(8),
        0x0F | 0x10 => match prefix.get(6) {
            None => FrameLength::NeedMore,
            Some(&count) => FrameLength::Total(7 + usize::from(count) + 2),
        },
        _ => FrameLength::Unknown,
    }
}

/// Splits a complete RTU frame into slave and PDU after checking the CRC.
///
/// # Errors
/// [`BadResponse::ShortFrame`] under 4 bytes, [`BadResponse::Crc`] on CRC mismatch.
pub fn decode_rtu(frame: &[u8]) -> Result<(u8, &[u8]), BadResponse> {
    if frame.len() < 4 {
        return Err(BadResponse::ShortFrame {
            len: frame.len(),
            expected: 4,
        });
    }
    let (body, crc_bytes) = frame.split_at(frame.len() - 2);
    let got = u16::from_le_bytes([crc_bytes[0], crc_bytes[1]]);
    let computed = crc16(body);
    if got != computed {
        return Err(BadResponse::Crc { computed, got });
    }
    Ok((body[0], &body[1..]))
}

/// Validates a complete RTU reply for `request` sent to `slave`.
///
/// Check order: length, CRC, slave id, then the PDU. A frame shorter than the length its
/// header announces is reported as [`BadResponse::ShortFrame`] before the CRC check.
///
/// # Errors
/// Any [`BadResponse`] except `TransactionMismatch`.
pub fn parse_rtu_reply(request: &Request, slave: u8, frame: &[u8]) -> Result<Reply, BadResponse> {
    if let FrameLength::Total(expected) = rtu_response_length(frame) {
        if frame.len() < expected {
            return Err(BadResponse::ShortFrame {
                len: frame.len(),
                expected,
            });
        }
    }
    let (got_slave, pdu) = decode_rtu(frame)?;
    if got_slave != slave {
        return Err(BadResponse::WrongSlave {
            expected: slave,
            got: got_slave,
        });
    }
    decode_reply_pdu(request, pdu)
}

/// Decodes an RTU request frame (fake slave side).
///
/// # Errors
/// `Err(None)` on a CRC/short-frame problem, `Err(Some(_))` on a PDU problem.
pub fn decode_rtu_request(frame: &[u8]) -> Result<(u8, Request), Option<PduError>> {
    let (slave, pdu) = decode_rtu(frame).map_err(|_| None)?;
    Request::decode_pdu(pdu).map(|r| (slave, r)).map_err(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::BadResponseKind;
    use crate::exception::ExceptionCode;
    use crate::response::Response;

    fn hex(s: &str) -> Vec<u8> {
        s.split_whitespace()
            .map(|b| u8::from_str_radix(b, 16).unwrap())
            .collect()
    }

    #[test]
    fn rtu_read_holding_registers_vector() {
        let request = Request::ReadHoldingRegisters {
            address: 0,
            quantity: 2,
        };
        let adu = encode_rtu(1, &request.encode_pdu().unwrap());
        assert_eq!(adu, hex("01 03 00 00 00 02 C4 0B"));
        assert_eq!(decode_rtu_request(&adu).unwrap(), (1, request));
    }

    #[test]
    fn rtu_serial_line_spec_example() {
        let request = Request::ReadHoldingRegisters {
            address: 0x6B,
            quantity: 3,
        };
        assert_eq!(
            encode_rtu(0x11, &request.encode_pdu().unwrap()),
            hex("11 03 00 6B 00 03 76 87")
        );
    }

    #[test]
    fn rtu_function_16_request_vector() {
        let request = Request::WriteMultipleRegisters {
            address: 1,
            values: vec![0x000A, 0x0102],
        };
        let adu = encode_rtu(0x11, &request.encode_pdu().unwrap());
        assert_eq!(
            &adu[..11],
            hex("11 10 00 01 00 02 04 00 0A 01 02").as_slice()
        );
        assert_eq!(adu.len(), 13);
        assert_eq!(rtu_request_length(&adu[..7]), FrameLength::Total(13));
        assert_eq!(decode_rtu_request(&adu).unwrap(), (0x11, request));
    }

    #[test]
    fn rtu_reply_checks() {
        let request = Request::ReadHoldingRegisters {
            address: 0,
            quantity: 2,
        };
        let good = encode_rtu(1, &hex("03 04 00 01 00 02"));
        assert_eq!(
            parse_rtu_reply(&request, 1, &good).unwrap(),
            Reply::Response(Response::ReadHoldingRegisters(vec![1, 2]))
        );
        assert_eq!(rtu_response_length(&good[..3]), FrameLength::Total(9));

        let mut bad_crc = good.clone();
        *bad_crc.last_mut().unwrap() ^= 0xFF;
        assert_eq!(
            parse_rtu_reply(&request, 1, &bad_crc).unwrap_err().kind(),
            BadResponseKind::Crc
        );
        assert_eq!(
            parse_rtu_reply(&request, 2, &good).unwrap_err(),
            BadResponse::WrongSlave {
                expected: 2,
                got: 1
            }
        );
        assert_eq!(
            parse_rtu_reply(&request, 1, &good[..6]).unwrap_err(),
            BadResponse::ShortFrame {
                len: 6,
                expected: 9
            }
        );
        // Complete per its header and CRC, but the byte count disagrees with the request.
        assert_eq!(
            parse_rtu_reply(&request, 1, &encode_rtu(1, &hex("03 02 00 01")))
                .unwrap_err()
                .kind(),
            BadResponseKind::Malformed
        );
        let exc = encode_rtu(1, &hex("83 02"));
        assert_eq!(rtu_response_length(&exc[..2]), FrameLength::Total(5));
        assert_eq!(
            parse_rtu_reply(&request, 1, &exc).unwrap(),
            Reply::Exception {
                function: 3,
                code: ExceptionCode(2)
            }
        );
        assert_eq!(rtu_response_length(&hex("01 2B")), FrameLength::Unknown);
    }

    #[test]
    fn tcp_vectors() {
        let request = Request::ReadHoldingRegisters {
            address: 0,
            quantity: 10,
        };
        let adu = encode_tcp(1, 1, &request.encode_pdu().unwrap());
        assert_eq!(adu, hex("00 01 00 00 00 06 01 03 00 00 00 0A"));
        assert_eq!(tcp_frame_length(&adu[..6]), FrameLength::Total(12));

        let reply = hex("00 01 00 00 00 07 01 03 04 04 D2 FF FF");
        let short_request = Request::ReadHoldingRegisters {
            address: 0,
            quantity: 2,
        };
        assert_eq!(
            parse_tcp_reply(&short_request, 1, 1, &reply).unwrap(),
            Reply::Response(Response::ReadHoldingRegisters(vec![1234, 0xFFFF]))
        );
        assert_eq!(
            parse_tcp_reply(&short_request, 2, 1, &reply).unwrap_err(),
            BadResponse::TransactionMismatch {
                expected: 2,
                got: 1
            }
        );
        assert_eq!(
            parse_tcp_reply(&short_request, 1, 9, &reply)
                .unwrap_err()
                .kind(),
            BadResponseKind::WrongSlave
        );
        // ShortFrame counts on-wire ADU bytes (REV-001 F4).
        assert_eq!(
            parse_tcp_reply(&short_request, 1, 1, &reply[..10]).unwrap_err(),
            BadResponse::ShortFrame {
                len: 10,
                expected: 13
            }
        );
        // Complete per MBAP (3 PDU bytes) but the byte count says 4: malformed, not short.
        assert_eq!(
            parse_tcp_reply(&short_request, 1, 1, &hex("00 01 00 00 00 04 01 03 04 00"))
                .unwrap_err()
                .kind(),
            BadResponseKind::Malformed
        );
        assert_eq!(
            BadResponse::ShortFrame {
                len: 10,
                expected: 13
            }
            .to_string(),
            "short frame (10 of 13 bytes)"
        );
        let mut proto = reply.clone();
        proto[3] = 1;
        assert_eq!(
            parse_tcp_reply(&short_request, 1, 1, &proto)
                .unwrap_err()
                .kind(),
            BadResponseKind::Malformed
        );
        let exc = encode_tcp(7, 1, &hex("83 02"));
        assert_eq!(
            parse_tcp_reply(&short_request, 7, 1, &exc).unwrap(),
            Reply::Exception {
                function: 3,
                code: ExceptionCode::ILLEGAL_DATA_ADDRESS
            }
        );
        assert_eq!(
            tcp_frame_length(&hex("00 01 00 00 00 00")),
            FrameLength::Unknown
        );
        assert_eq!(tcp_frame_length(&hex("00 01 00")), FrameLength::NeedMore);
    }
}
