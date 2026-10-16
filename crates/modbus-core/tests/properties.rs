//! Property tests: encode/decode round trips and "arbitrary bytes never panic".

use modbus_core::{
    decode_reply_pdu, decode_rtu, decode_rtu_request, decode_tcp, encode_rtu, encode_tcp,
    parse_rtu_reply, parse_tcp_reply, rtu_request_length, rtu_response_length, tcp_frame_length,
    Reply, Request, MAX_READ_BITS, MAX_READ_REGISTERS, MAX_WRITE_COILS, MAX_WRITE_REGISTERS,
};
use proptest::prelude::*;

/// Valid requests (within quantity and address limits).
fn valid_request() -> impl Strategy<Value = Request> {
    fn read(max: u16) -> impl Strategy<Value = (u16, u16)> {
        (1..=max).prop_flat_map(|q| (0..=(0x1_0000u32 - u32::from(q)) as u16, Just(q)))
    }
    prop_oneof![
        read(MAX_READ_BITS)
            .prop_map(|(address, quantity)| Request::ReadCoils { address, quantity }),
        read(MAX_READ_BITS)
            .prop_map(|(address, quantity)| Request::ReadDiscreteInputs { address, quantity }),
        read(MAX_READ_REGISTERS)
            .prop_map(|(address, quantity)| Request::ReadHoldingRegisters { address, quantity }),
        read(MAX_READ_REGISTERS)
            .prop_map(|(address, quantity)| Request::ReadInputRegisters { address, quantity }),
        (any::<u16>(), any::<bool>())
            .prop_map(|(address, value)| Request::WriteSingleCoil { address, value }),
        (any::<u16>(), any::<u16>())
            .prop_map(|(address, value)| Request::WriteSingleRegister { address, value }),
        read(MAX_WRITE_COILS).prop_flat_map(|(address, q)| {
            proptest::collection::vec(any::<bool>(), usize::from(q))
                .prop_map(move |values| Request::WriteMultipleCoils { address, values })
        }),
        read(MAX_WRITE_REGISTERS).prop_flat_map(|(address, q)| {
            proptest::collection::vec(any::<u16>(), usize::from(q))
                .prop_map(move |values| Request::WriteMultipleRegisters { address, values })
        }),
    ]
}

/// A valid request together with a correct reply for it.
fn request_and_reply() -> impl Strategy<Value = (Request, Reply)> {
    valid_request().prop_flat_map(|request| {
        let q = usize::from(request.quantity());
        let bits = proptest::collection::vec(any::<bool>(), q);
        let regs = proptest::collection::vec(any::<u16>(), q);
        let exception = any::<u8>();
        let req = request.clone();
        (bits, regs, exception, any::<bool>()).prop_map(move |(bits, regs, code, is_exc)| {
            let reply = if is_exc {
                Reply::Exception {
                    function: req.function().as_u8(),
                    code: modbus_core::ExceptionCode(code),
                }
            } else {
                Reply::echo_for(&req, bits, regs)
            };
            (req.clone(), reply)
        })
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn request_pdu_round_trip(request in valid_request()) {
        let pdu = request.encode_pdu().unwrap();
        prop_assert!(pdu.len() <= modbus_core::MAX_PDU_SIZE);
        prop_assert_eq!(Request::decode_pdu(&pdu).unwrap(), request);
    }

    #[test]
    fn rtu_request_round_trip(request in valid_request(), slave in 0u8..=247) {
        let adu = encode_rtu(slave, &request.encode_pdu().unwrap());
        prop_assert_eq!(rtu_request_length(&adu), modbus_core::FrameLength::Total(adu.len()));
        prop_assert_eq!(decode_rtu_request(&adu).unwrap(), (slave, request));
    }

    #[test]
    fn reply_round_trip_rtu((request, reply) in request_and_reply(), slave in 1u8..=247) {
        let adu = encode_rtu(slave, &reply.encode_pdu());
        prop_assert_eq!(rtu_response_length(&adu), modbus_core::FrameLength::Total(adu.len()));
        prop_assert_eq!(parse_rtu_reply(&request, slave, &adu).unwrap(), reply);
    }

    #[test]
    fn reply_round_trip_tcp((request, reply) in request_and_reply(), txn: u16, unit in 0u8..=247) {
        let adu = encode_tcp(txn, unit, &reply.encode_pdu());
        prop_assert_eq!(tcp_frame_length(&adu), modbus_core::FrameLength::Total(adu.len()));
        prop_assert_eq!(parse_tcp_reply(&request, txn, unit, &adu).unwrap(), reply);
    }

    #[test]
    fn single_bit_flip_in_rtu_reply_is_detected(
        (request, reply) in request_and_reply(),
        slave in 1u8..=247,
        bit in any::<prop::sample::Index>(),
    ) {
        let mut adu = encode_rtu(slave, &reply.encode_pdu());
        let i = bit.index(adu.len() * 8);
        adu[i / 8] ^= 1 << (i % 8);
        // CRC-16 detects every single-bit error.
        prop_assert!(parse_rtu_reply(&request, slave, &adu).is_err());
    }

    #[test]
    fn truncated_reply_is_short_frame_in_wire_bytes(
        (request, reply) in request_and_reply(),
        slave in 1u8..=247,
        txn: u16,
        cut in any::<prop::sample::Index>(),
    ) {
        // REV-001 F4: ShortFrame only from the ADU layer, counted in on-wire bytes.
        let tcp = encode_tcp(txn, slave, &reply.encode_pdu());
        let n = cut.index(tcp.len());
        match parse_tcp_reply(&request, txn, slave, &tcp[..n]) {
            Err(modbus_core::BadResponse::ShortFrame { len, .. }) => prop_assert_eq!(len, n),
            other => prop_assert!(false, "tcp cut {}: {:?}", n, other),
        }
        let rtu = encode_rtu(slave, &reply.encode_pdu());
        let n = cut.index(rtu.len());
        match parse_rtu_reply(&request, slave, &rtu[..n]) {
            Err(modbus_core::BadResponse::ShortFrame { len, .. }) => prop_assert_eq!(len, n),
            other => prop_assert!(false, "rtu cut {}: {:?}", n, other),
        }
    }
    #[test]
    fn arbitrary_bytes_never_panic(
        bytes in proptest::collection::vec(any::<u8>(), 0..300),
        request in valid_request(),
        txn: u16,
        slave: u8,
    ) {
        let _ = Request::decode_pdu(&bytes);
        let _ = decode_reply_pdu(&request, &bytes);
        let _ = decode_rtu(&bytes);
        let _ = decode_rtu_request(&bytes);
        let _ = decode_tcp(&bytes);
        let _ = parse_rtu_reply(&request, slave, &bytes);
        let _ = parse_tcp_reply(&request, txn, slave, &bytes);
        let _ = rtu_response_length(&bytes);
        let _ = rtu_request_length(&bytes);
        let _ = tcp_frame_length(&bytes);
    }

    #[test]
    fn arbitrary_requests_never_panic(
        address: u16,
        quantity: u16,
        values in proptest::collection::vec(any::<u16>(), 0..3000),
    ) {
        for r in [
            Request::ReadCoils { address, quantity },
            Request::ReadHoldingRegisters { address, quantity },
            Request::WriteMultipleCoils { address, values: values.iter().map(|v| v & 1 == 1).collect() },
            Request::WriteMultipleRegisters { address, values: values.clone() },
        ] {
            if let Ok(pdu) = r.encode_pdu() {
                prop_assert!(pdu.len() <= modbus_core::MAX_PDU_SIZE);
            }
        }
    }
}
