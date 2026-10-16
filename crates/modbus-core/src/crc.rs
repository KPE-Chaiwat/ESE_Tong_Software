//! CRC-16/MODBUS (polynomial 0xA001 reflected, initial value 0xFFFF), as defined in the
//! Modbus over Serial Line specification. Transmitted low byte first.

/// Computes the Modbus RTU CRC of `data`.
#[must_use]
pub fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= u16::from(byte);
        for _ in 0..8 {
            if crc & 0x0001 != 0 {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_vector_read_holding_registers() {
        // 01 03 00 00 00 02 -> CRC bytes C4 0B (low byte first).
        assert_eq!(
            crc16(&[0x01, 0x03, 0x00, 0x00, 0x00, 0x02]).to_le_bytes(),
            [0xC4, 0x0B]
        );
    }

    #[test]
    fn spec_vector_serial_line_example() {
        // Modbus serial line example: slave 0x11 reads 3 holding registers at 0x006B.
        assert_eq!(
            crc16(&[0x11, 0x03, 0x00, 0x6B, 0x00, 0x03]).to_le_bytes(),
            [0x76, 0x87]
        );
    }

    #[test]
    fn empty_input_is_initial_value() {
        assert_eq!(crc16(&[]), 0xFFFF);
    }
}
