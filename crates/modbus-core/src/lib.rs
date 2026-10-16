//! Pure Modbus protocol logic. No I/O, no async runtime, no Tauri.
//!
//! Implemented from the public Modbus Application Protocol specification v1.1b3 and the
//! Modbus over Serial Line specification v1.02. Function codes 01-06, 15 and 16; Modbus TCP
//! (MBAP) and RTU (CRC-16) framing. ASCII is out of scope.
//!
//! Every decoder returns a typed error for malformed input and never panics.

mod adu;
mod crc;
mod error;
mod exception;
mod request;
mod response;

pub use adu::{
    decode_rtu, decode_rtu_request, decode_tcp, encode_rtu, encode_tcp, parse_rtu_reply,
    parse_tcp_reply, rtu_request_length, rtu_response_length, tcp_frame_length, FrameLength,
    MbapHeader, MAX_RTU_ADU_SIZE, MAX_TCP_ADU_SIZE, MBAP_HEADER_SIZE,
};
pub use crc::crc16;
pub use error::{BadResponse, BadResponseKind, PduError, RequestError};
pub use exception::ExceptionCode;
pub use request::{
    pack_bits, unpack_bits, FunctionCode, Request, MAX_READ_BITS, MAX_READ_REGISTERS,
    MAX_WRITE_COILS, MAX_WRITE_REGISTERS,
};
pub use response::{decode_reply_pdu, Reply, Response};

/// Maximum size in bytes of a Modbus PDU (function code + data), per the Modbus
/// Application Protocol specification.
pub const MAX_PDU_SIZE: usize = 253;

/// Highest slave / unit id a master may address (0 is broadcast).
pub const MAX_SLAVE_ID: u8 = 247;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_pdu_size_matches_spec() {
        assert_eq!(MAX_PDU_SIZE, 253);
        assert_eq!(MAX_TCP_ADU_SIZE, 260);
        assert_eq!(MAX_RTU_ADU_SIZE, 256);
    }

    #[test]
    fn largest_requests_fit_in_a_pdu() {
        let coils = Request::WriteMultipleCoils {
            address: 0,
            values: vec![true; usize::from(MAX_WRITE_COILS)],
        };
        let regs = Request::WriteMultipleRegisters {
            address: 0,
            values: vec![0; usize::from(MAX_WRITE_REGISTERS)],
        };
        assert!(coils.encode_pdu().unwrap().len() <= MAX_PDU_SIZE);
        assert!(regs.encode_pdu().unwrap().len() <= MAX_PDU_SIZE);
        let read = Response::ReadHoldingRegisters(vec![0; usize::from(MAX_READ_REGISTERS)]);
        assert!(read.encode_pdu().len() <= MAX_PDU_SIZE);
    }
}
