//! Input validation of connection, poll and write requests (REQ-001, DES-001 section 3,
//! BE-001 Q-04, Q-05, Q-14). Messages match the DES texts where DES defines one; addresses
//! in messages are protocol (0-based) addresses.

use modbus_core::{
    Request, MAX_READ_BITS, MAX_READ_REGISTERS, MAX_SLAVE_ID, MAX_WRITE_COILS, MAX_WRITE_REGISTERS,
};
use shared_types::{ConnectionConfig, PollDefinition, WriteRequest};

/// Allowed baud rates (DES-001 section 1, RTU setup fields).
pub const BAUD_RATES: [u32; 8] = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
pub const TIMEOUT_MS_RANGE: (u32, u32) = (50, 10_000);
pub const SCAN_RATE_MS_RANGE: (u32, u32) = (20, 60_000);

/// A rejected input. `message` is shown to the user as is.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct ValidationError {
    /// Name of the offending field (camelCase, as in the DTO).
    pub field: &'static str,
    pub message: String,
}

fn invalid(field: &'static str, message: impl Into<String>) -> ValidationError {
    ValidationError {
        field,
        message: message.into(),
    }
}

/// # Errors
/// The first invalid field.
pub fn validate_connection(config: &ConnectionConfig) -> Result<(), ValidationError> {
    match config {
        ConnectionConfig::Tcp { host, port, .. } => {
            if host.is_empty() {
                return Err(invalid("host", "Enter a host name or IPv4 address."));
            }
            if !is_valid_host(host) {
                return Err(invalid(
                    "host",
                    "Enter a valid host name or IPv4 address, for example 192.168.1.10.",
                ));
            }
            if *port == 0 {
                return Err(invalid(
                    "port",
                    "Port must be a whole number from 1 to 65535.",
                ));
            }
        }
        ConnectionConfig::Rtu {
            port,
            baud,
            data_bits,
            stop_bits,
            ..
        } => {
            if port.trim().is_empty() {
                return Err(invalid("port", "Select a serial port."));
            }
            if !BAUD_RATES.contains(baud) {
                return Err(invalid(
                    "baud",
                    "Baud rate must be one of 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200.",
                ));
            }
            if !matches!(data_bits, 7 | 8) {
                return Err(invalid("dataBits", "Data bits must be 7 or 8."));
            }
            if !matches!(stop_bits, 1 | 2) {
                return Err(invalid("stopBits", "Stop bits must be 1 or 2."));
            }
        }
    }
    let t = config.timeout_ms();
    if t < TIMEOUT_MS_RANGE.0 || t > TIMEOUT_MS_RANGE.1 {
        return Err(invalid(
            "timeoutMs",
            "Timeout must be a whole number from 50 to 10000 ms.",
        ));
    }
    Ok(())
}

/// IPv4 dotted quad (each part 0-255) or a host name: letters, digits, `-` and `.`,
/// at most 253 characters, labels 1-63 characters. IPv6 is rejected (BE-001 Q-14).
#[must_use]
pub fn is_valid_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    let labels: Vec<&str> = host.split('.').collect();
    let all_numeric = labels
        .iter()
        .all(|l| !l.is_empty() && l.bytes().all(|b| b.is_ascii_digit()));
    if all_numeric {
        // Only digits and dots: must be a valid IPv4 address.
        return labels.len() == 4
            && labels
                .iter()
                .all(|l| l.len() <= 3 && l.parse::<u16>().is_ok_and(|v| v <= 255));
    }
    labels.iter().all(|l| {
        !l.is_empty() && l.len() <= 63 && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

fn check_slave(slave_id: u8) -> Result<(), ValidationError> {
    if slave_id > MAX_SLAVE_ID {
        return Err(invalid(
            "slaveId",
            "Slave ID must be a whole number from 0 to 247.",
        ));
    }
    Ok(())
}

/// Validates a poll and converts it to a read request.
///
/// # Errors
/// The first invalid field.
pub fn validate_poll(poll: &PollDefinition, rtu: bool) -> Result<Request, ValidationError> {
    check_slave(poll.slave_id)?;
    if rtu && poll.slave_id == 0 {
        return Err(invalid(
            "slaveId",
            "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247.",
        ));
    }
    let (max, make): (u16, fn(u16, u16) -> Request) = match poll.function {
        1 => (MAX_READ_BITS, |address, quantity| Request::ReadCoils {
            address,
            quantity,
        }),
        2 => (MAX_READ_BITS, |address, quantity| {
            Request::ReadDiscreteInputs { address, quantity }
        }),
        3 => (MAX_READ_REGISTERS, |address, quantity| {
            Request::ReadHoldingRegisters { address, quantity }
        }),
        4 => (MAX_READ_REGISTERS, |address, quantity| {
            Request::ReadInputRegisters { address, quantity }
        }),
        _ => {
            return Err(invalid(
                "function",
                "Poll function must be 01, 02, 03 or 04.",
            ))
        }
    };
    if poll.quantity == 0 || poll.quantity > max {
        return Err(invalid(
            "quantity",
            format!(
                "Quantity for FC{:02} must be from 1 to {max}.",
                poll.function
            ),
        ));
    }
    let max_qty = 0x1_0000 - u32::from(poll.start_address);
    if u32::from(poll.quantity) > max_qty {
        return Err(invalid(
            "quantity",
            format!(
                "This range ends after the last address (65535). The maximum quantity from {} is {}.",
                poll.start_address, max_qty
            ),
        ));
    }
    let (lo, hi) = SCAN_RATE_MS_RANGE;
    if poll.scan_rate_ms < lo || poll.scan_rate_ms > hi {
        return Err(invalid(
            "scanRateMs",
            "Scan rate must be a whole number from 20 to 60000 ms.",
        ));
    }
    Ok(make(poll.start_address, poll.quantity))
}

/// Validates a write and converts it to a request. Slave 0 (broadcast) is allowed.
///
/// # Errors
/// The first invalid field.
pub fn validate_write(write: &WriteRequest) -> Result<Request, ValidationError> {
    check_slave(write.slave_id)?;
    let address = write.address;
    let values = &write.values;
    let n = values.len();
    let single = |what: &str| -> Result<u16, ValidationError> {
        match values.as_slice() {
            [v] => Ok(*v),
            _ => Err(invalid(
                "values",
                format!(
                    "FC{:02} writes exactly one {what} (you entered {n}).",
                    write.function
                ),
            )),
        }
    };
    let check_range = |count: usize| -> Result<(), ValidationError> {
        let fit = 0x1_0000 - usize::from(address);
        if count > fit {
            return Err(invalid(
                "values",
                format!(
                    "These values end after the last address (65535). At most {fit} values fit from {address}."
                ),
            ));
        }
        Ok(())
    };
    match write.function {
        5 => {
            let v = single("value")?;
            if v > 1 {
                return Err(invalid("values", "Value must be 0 (OFF) or 1 (ON)."));
            }
            Ok(Request::WriteSingleCoil {
                address,
                value: v == 1,
            })
        }
        6 => Ok(Request::WriteSingleRegister {
            address,
            value: single("value")?,
        }),
        15 => {
            if n == 0 || n > usize::from(MAX_WRITE_COILS) {
                return Err(invalid(
                    "values",
                    format!("Enter from 1 to 1968 values (you entered {n})."),
                ));
            }
            if let Some(i) = values.iter().position(|v| *v > 1) {
                return Err(invalid(
                    "values",
                    format!(
                        "Value {} (\"{}\") is not valid: enter 0 or 1.",
                        i + 1,
                        values[i]
                    ),
                ));
            }
            check_range(n)?;
            Ok(Request::WriteMultipleCoils {
                address,
                values: values.iter().map(|v| *v == 1).collect(),
            })
        }
        16 => {
            if n == 0 || n > usize::from(MAX_WRITE_REGISTERS) {
                return Err(invalid(
                    "values",
                    format!("Enter from 1 to 123 values (you entered {n})."),
                ));
            }
            check_range(n)?;
            Ok(Request::WriteMultipleRegisters {
                address,
                values: values.clone(),
            })
        }
        _ => Err(invalid(
            "function",
            "Write function must be 05, 06, 15 or 16.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared_types::Parity;

    fn tcp(host: &str, port: u16, timeout_ms: u32) -> ConnectionConfig {
        ConnectionConfig::Tcp {
            host: host.into(),
            port,
            timeout_ms,
        }
    }

    fn msg<T: std::fmt::Debug>(r: Result<T, ValidationError>) -> String {
        r.unwrap_err().message
    }

    #[test]
    fn connection_rules() {
        assert!(validate_connection(&tcp("192.168.1.10", 502, 1000)).is_ok());
        assert!(validate_connection(&tcp("plc-7", 1, 50)).is_ok());
        assert!(validate_connection(&tcp("plc.example.com", 65535, 10_000)).is_ok());
        assert_eq!(
            msg(validate_connection(&tcp("", 502, 1000))),
            "Enter a host name or IPv4 address."
        );
        for bad in [
            "256.1.1.1",
            "1.2.3",
            "::1",
            "fe80::1",
            "a b",
            "-.",
            "a..b",
            "1.2.3.4.5",
        ] {
            assert_eq!(
                msg(validate_connection(&tcp(bad, 502, 1000))),
                "Enter a valid host name or IPv4 address, for example 192.168.1.10.",
                "{bad}"
            );
        }
        assert_eq!(
            msg(validate_connection(&tcp("h", 0, 1000))),
            "Port must be a whole number from 1 to 65535."
        );
        for t in [49, 10_001] {
            assert_eq!(
                msg(validate_connection(&tcp("h", 502, t))),
                "Timeout must be a whole number from 50 to 10000 ms."
            );
        }
        let rtu = |port: &str, baud, data_bits, stop_bits| ConnectionConfig::Rtu {
            port: port.into(),
            baud,
            data_bits,
            parity: Parity::Even,
            stop_bits,
            timeout_ms: 1000,
        };
        assert!(validate_connection(&rtu("COM3", 9600, 8, 1)).is_ok());
        assert!(validate_connection(&rtu("COM3", 115_200, 7, 2)).is_ok());
        assert_eq!(
            msg(validate_connection(&rtu("", 9600, 8, 1))),
            "Select a serial port."
        );
        assert!(validate_connection(&rtu("COM3", 9601, 8, 1)).is_err());
        assert!(validate_connection(&rtu("COM3", 9600, 6, 1)).is_err());
        assert!(validate_connection(&rtu("COM3", 9600, 8, 3)).is_err());
    }

    fn poll(slave_id: u8, function: u8, start: u16, quantity: u16, scan: u32) -> PollDefinition {
        PollDefinition {
            slave_id,
            function,
            start_address: start,
            quantity,
            scan_rate_ms: scan,
        }
    }

    #[test]
    fn poll_rules() {
        assert!(validate_poll(&poll(0, 3, 0, 125, 20), false).is_ok());
        assert_eq!(
            msg(validate_poll(&poll(0, 3, 0, 10, 1000), true)),
            "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247."
        );
        assert!(validate_poll(&poll(247, 1, 0, 2000, 60_000), true).is_ok());
        assert_eq!(
            msg(validate_poll(&poll(248, 3, 0, 1, 1000), false)),
            "Slave ID must be a whole number from 0 to 247."
        );
        assert_eq!(
            msg(validate_poll(&poll(1, 3, 0, 126, 1000), false)),
            "Quantity for FC03 must be from 1 to 125."
        );
        assert_eq!(
            msg(validate_poll(&poll(1, 1, 0, 2001, 1000), false)),
            "Quantity for FC01 must be from 1 to 2000."
        );
        assert_eq!(
            msg(validate_poll(&poll(1, 4, 0, 0, 1000), false)),
            "Quantity for FC04 must be from 1 to 125."
        );
        assert_eq!(
            msg(validate_poll(&poll(1, 3, 65530, 10, 1000), false)),
            "This range ends after the last address (65535). The maximum quantity from 65530 is 6."
        );
        assert!(validate_poll(&poll(1, 3, 65530, 6, 1000), false).is_ok());
        assert!(validate_poll(&poll(1, 5, 0, 1, 1000), false).is_err());
        for scan in [19, 60_001] {
            assert_eq!(
                msg(validate_poll(&poll(1, 3, 0, 1, scan), false)),
                "Scan rate must be a whole number from 20 to 60000 ms."
            );
        }
        assert_eq!(
            validate_poll(&poll(1, 2, 7, 9, 1000), false).unwrap(),
            Request::ReadDiscreteInputs {
                address: 7,
                quantity: 9
            }
        );
    }

    fn write(slave_id: u8, function: u8, address: u16, values: Vec<u16>) -> WriteRequest {
        WriteRequest {
            slave_id,
            function,
            address,
            values,
        }
    }

    #[test]
    fn write_rules() {
        assert_eq!(
            validate_write(&write(0, 5, 3, vec![1])).unwrap(),
            Request::WriteSingleCoil {
                address: 3,
                value: true
            }
        );
        assert!(validate_write(&write(1, 5, 3, vec![2])).is_err());
        assert!(validate_write(&write(1, 6, 3, vec![])).is_err());
        assert!(validate_write(&write(1, 6, 65535, vec![65535])).is_ok());
        assert_eq!(
            msg(validate_write(&write(1, 16, 0, vec![1; 124]))),
            "Enter from 1 to 123 values (you entered 124)."
        );
        assert!(validate_write(&write(1, 16, 0, vec![1; 123])).is_ok());
        assert_eq!(
            msg(validate_write(&write(1, 15, 0, vec![1; 1969]))),
            "Enter from 1 to 1968 values (you entered 1969)."
        );
        assert_eq!(
            msg(validate_write(&write(1, 15, 0, vec![1, 2]))),
            "Value 2 (\"2\") is not valid: enter 0 or 1."
        );
        assert_eq!(
            msg(validate_write(&write(1, 16, 65534, vec![1, 2, 3]))),
            "These values end after the last address (65535). At most 2 values fit from 65534."
        );
        assert!(validate_write(&write(248, 6, 0, vec![1])).is_err());
        assert!(validate_write(&write(1, 3, 0, vec![1])).is_err());
    }
}
