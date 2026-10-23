//! One-shot Modbus Master commands for terminals and scripts.

use std::env;
use std::process::ExitCode;
use std::time::Duration;

use modbus_core::{
    encode_rtu, encode_tcp, parse_rtu_reply, parse_tcp_reply, Reply, Request, Response,
};
use serde_json::json;
use transport::{connect_serial, connect_tcp, Link, Parity, SerialParams, TcpParams};

const HELP: &str = "ESEfact Modbus Master CLI

Usage:
  esefact-modbus-master read  (--tcp HOST | --rtu PORT) --unit ID --function FC --address ADDR --count N [OPTIONS]
  esefact-modbus-master write (--tcp HOST | --rtu PORT) --unit ID --function FC --address ADDR --values V[,V...] [OPTIONS]
  esefact-modbus-master --version

Read functions: 1 coils, 2 discrete inputs, 3 holding registers, 4 input registers.
Write functions: 5 single coil, 6 single register, 15 multiple coils, 16 multiple registers.
Addresses are zero-based protocol addresses. Values and addresses accept decimal or 0x hex.

Connection options:
  --tcp HOST          Modbus TCP host (default port 502; use --port to change it)
  --port N            TCP port, 1-65535
  --rtu PORT          Modbus RTU serial port, e.g. COM3
  --baud N            RTU baud rate (default 9600)
  --data-bits 7|8     RTU data bits (default 8)
  --parity none|even|odd  RTU parity (default even)
  --stop-bits 1|2     RTU stop bits (default 1)
  --timeout-ms N      Connect/response timeout in milliseconds (default 1000)

Output options:
  --json              Print one JSON result to stdout
  --trace             Print TX/RX frames in hex to stderr
  --help              Show this help

Examples:
  esefact-modbus-master read --tcp 127.0.0.1 --unit 1 --function 3 --address 0 --count 10
  esefact-modbus-master write --tcp 127.0.0.1 --unit 1 --function 6 --address 0 --values 42
  esefact-modbus-master read --rtu COM3 --baud 19200 --unit 1 --function 4 --address 0 --count 2
";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Operation {
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Connection {
    Tcp(TcpParams),
    Rtu(SerialParams),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Command {
    connection: Connection,
    unit: u8,
    request: Request,
    timeout: Duration,
    json: bool,
    trace: bool,
}

enum Action {
    Help,
    Version,
    Execute(Command),
}

#[derive(Debug)]
struct CliError {
    code: u8,
    message: String,
}

impl CliError {
    fn input(message: impl Into<String>) -> Self {
        Self {
            code: 2,
            message: message.into(),
        }
    }

    fn connect(message: impl Into<String>) -> Self {
        Self {
            code: 3,
            message: message.into(),
        }
    }

    fn io(message: impl Into<String>) -> Self {
        Self {
            code: 4,
            message: message.into(),
        }
    }

    fn timeout(message: impl Into<String>) -> Self {
        Self {
            code: 5,
            message: message.into(),
        }
    }

    fn exception(message: impl Into<String>) -> Self {
        Self {
            code: 6,
            message: message.into(),
        }
    }

    fn response(message: impl Into<String>) -> Self {
        Self {
            code: 7,
            message: message.into(),
        }
    }
}

fn number(value: &str, name: &str) -> Result<u32, CliError> {
    let parsed = if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        u32::from_str_radix(hex, 16)
    } else {
        value.parse::<u32>()
    };
    parsed.map_err(|_| CliError::input(format!("Invalid {name}: {value}")))
}

fn bounded(value: &str, name: &str, min: u32, max: u32) -> Result<u32, CliError> {
    let value = number(value, name)?;
    if (min..=max).contains(&value) {
        Ok(value)
    } else {
        Err(CliError::input(format!("{name} must be {min}-{max}")))
    }
}

fn required<'a>(value: Option<&'a str>, name: &str) -> Result<&'a str, CliError> {
    value.ok_or_else(|| CliError::input(format!("Missing --{name}")))
}

fn parse(args: &[String]) -> Result<Action, CliError> {
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h") {
        return Ok(Action::Help);
    }
    if args.len() == 1 && (args[0] == "--version" || args[0] == "-V") {
        return Ok(Action::Version);
    }
    let operation = match args[0].as_str() {
        "read" => Operation::Read,
        "write" => Operation::Write,
        _ => {
            return Err(CliError::input(
                "Expected read or write. Use --help for usage.",
            ))
        }
    };

    let mut tcp = None;
    let mut rtu = None;
    let mut port = None;
    let mut baud = None;
    let mut data_bits = None;
    let mut parity = None;
    let mut stop_bits = None;
    let mut timeout = None;
    let mut unit = None;
    let mut function = None;
    let mut address = None;
    let mut count = None;
    let mut values = None;
    let mut json = false;
    let mut trace = false;
    let mut index = 1;
    while index < args.len() {
        let flag = args[index].as_str();
        if flag == "--json" || flag == "--trace" {
            let target = if flag == "--json" {
                &mut json
            } else {
                &mut trace
            };
            if *target {
                return Err(CliError::input(format!("Duplicate {flag}")));
            }
            *target = true;
            index += 1;
            continue;
        }
        let target = match flag {
            "--tcp" => &mut tcp,
            "--rtu" => &mut rtu,
            "--port" => &mut port,
            "--baud" => &mut baud,
            "--data-bits" => &mut data_bits,
            "--parity" => &mut parity,
            "--stop-bits" => &mut stop_bits,
            "--timeout-ms" => &mut timeout,
            "--unit" => &mut unit,
            "--function" => &mut function,
            "--address" => &mut address,
            "--count" => &mut count,
            "--values" => &mut values,
            _ => return Err(CliError::input(format!("Unknown option: {flag}"))),
        };
        if target.is_some() {
            return Err(CliError::input(format!("Duplicate {flag}")));
        }
        let next = args
            .get(index + 1)
            .ok_or_else(|| CliError::input(format!("Missing value for {flag}")))?;
        *target = Some(next.as_str());
        index += 2;
    }

    let timeout_ms = bounded(timeout.unwrap_or("1000"), "timeout-ms", 1, 60_000)?;
    let timeout = Duration::from_millis(u64::from(timeout_ms));
    let connection = match (tcp, rtu) {
        (Some(host), None) => {
            if host.is_empty() {
                return Err(CliError::input("TCP host cannot be empty"));
            }
            if baud.is_some() || data_bits.is_some() || parity.is_some() || stop_bits.is_some() {
                return Err(CliError::input("RTU options cannot be used with --tcp"));
            }
            let port = bounded(port.unwrap_or("502"), "port", 1, 65_535)? as u16;
            Connection::Tcp(TcpParams {
                host: host.to_owned(),
                port,
                timeout,
            })
        }
        (None, Some(serial_port)) => {
            if serial_port.is_empty() {
                return Err(CliError::input("RTU port cannot be empty"));
            }
            if port.is_some() {
                return Err(CliError::input("--port is only valid with --tcp"));
            }
            let baud = bounded(baud.unwrap_or("9600"), "baud", 1, 4_000_000)?;
            let data_bits = bounded(data_bits.unwrap_or("8"), "data-bits", 7, 8)? as u8;
            let stop_bits = bounded(stop_bits.unwrap_or("1"), "stop-bits", 1, 2)? as u8;
            let parity = match parity.unwrap_or("even") {
                "none" => Parity::None,
                "even" => Parity::Even,
                "odd" => Parity::Odd,
                _ => return Err(CliError::input("parity must be none, even, or odd")),
            };
            Connection::Rtu(SerialParams {
                port: serial_port.to_owned(),
                baud,
                data_bits,
                parity,
                stop_bits,
            })
        }
        _ => return Err(CliError::input("Specify exactly one of --tcp or --rtu")),
    };

    let unit = bounded(required(unit, "unit")?, "unit", 1, 247)? as u8;
    let function = bounded(required(function, "function")?, "function", 1, 255)? as u8;
    let address = bounded(required(address, "address")?, "address", 0, 65_535)? as u16;
    let request = match operation {
        Operation::Read => {
            if values.is_some() {
                return Err(CliError::input("--values is only valid with write"));
            }
            let quantity = bounded(required(count, "count")?, "count", 1, 2000)? as u16;
            match function {
                1 => Request::ReadCoils { address, quantity },
                2 => Request::ReadDiscreteInputs { address, quantity },
                3 => Request::ReadHoldingRegisters { address, quantity },
                4 => Request::ReadInputRegisters { address, quantity },
                _ => return Err(CliError::input("Read function must be 1, 2, 3, or 4")),
            }
        }
        Operation::Write => {
            if count.is_some() {
                return Err(CliError::input("--count is only valid with read"));
            }
            let raw = required(values, "values")?;
            if raw.is_empty() {
                return Err(CliError::input("--values cannot be empty"));
            }
            let parsed: Vec<u16> = raw
                .split(',')
                .map(|v| bounded(v, "value", 0, 65_535).map(|n| n as u16))
                .collect::<Result<_, _>>()?;
            match function {
                5 if parsed.len() == 1 && parsed[0] <= 1 => Request::WriteSingleCoil {
                    address,
                    value: parsed[0] == 1,
                },
                6 if parsed.len() == 1 => Request::WriteSingleRegister {
                    address,
                    value: parsed[0],
                },
                15 if parsed.iter().all(|v| *v <= 1) => Request::WriteMultipleCoils {
                    address,
                    values: parsed.into_iter().map(|v| v == 1).collect(),
                },
                16 => Request::WriteMultipleRegisters {
                    address,
                    values: parsed,
                },
                5 | 15 => {
                    return Err(CliError::input(
                        "Coil values must be 0 or 1; function 5 needs exactly one value",
                    ))
                }
                6 => return Err(CliError::input("Function 6 needs exactly one value")),
                _ => return Err(CliError::input("Write function must be 5, 6, 15, or 16")),
            }
        }
    };
    request
        .validate()
        .map_err(|e| CliError::input(e.to_string()))?;
    Ok(Action::Execute(Command {
        connection,
        unit,
        request,
        timeout,
        json,
        trace,
    }))
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn print_result(command: &Command, response: &Response) {
    let address = command.request.address();
    let function = command.request.function().as_u8();
    match response {
        Response::ReadCoils(values) | Response::ReadDiscreteInputs(values) => {
            if command.json {
                println!(
                    "{}",
                    json!({"unit": command.unit, "function": function, "address_base": 0, "address": address, "values": values})
                );
            } else {
                println!("Address (0-based)  Value");
                for (offset, value) in values.iter().enumerate() {
                    println!(
                        "{}  {}",
                        u32::from(address) + offset as u32,
                        u8::from(*value)
                    );
                }
            }
        }
        Response::ReadHoldingRegisters(values) | Response::ReadInputRegisters(values) => {
            if command.json {
                println!(
                    "{}",
                    json!({"unit": command.unit, "function": function, "address_base": 0, "address": address, "values": values})
                );
            } else {
                println!("Address (0-based)  Value  Hex");
                for (offset, value) in values.iter().enumerate() {
                    println!(
                        "{}  {}  0x{value:04X}",
                        u32::from(address) + offset as u32,
                        value
                    );
                }
            }
        }
        _ => {
            if command.json {
                println!(
                    "{}",
                    json!({"unit": command.unit, "function": function, "address_base": 0, "address": address, "quantity": command.request.quantity(), "written": true})
                );
            } else {
                println!(
                    "Wrote {} value(s) at address {} (0-based), unit {}, FC{:02}",
                    command.request.quantity(),
                    address,
                    command.unit,
                    function
                );
            }
        }
    }
}

async fn execute(command: &Command) -> Result<(), CliError> {
    let mut link: Box<dyn Link> = match &command.connection {
        Connection::Tcp(params) => Box::new(
            connect_tcp(params)
                .await
                .map_err(|e| CliError::connect(e.to_string()))?,
        ),
        Connection::Rtu(params) => Box::new(
            connect_serial(params, command.timeout)
                .await
                .map_err(|e| CliError::connect(e.to_string()))?,
        ),
    };
    let pdu = command
        .request
        .encode_pdu()
        .map_err(|e| CliError::input(e.to_string()))?;
    let frame = match &command.connection {
        Connection::Tcp(_) => encode_tcp(1, command.unit, &pdu),
        Connection::Rtu(_) => encode_rtu(command.unit, &pdu),
    };
    if command.trace {
        eprintln!("TX {}", hex(&frame));
    }
    link.send(&frame)
        .await
        .map_err(|e| CliError::io(e.to_string()))?;
    let reply_frame = link.receive_frame(command.timeout).await.map_err(|e| {
        if matches!(e, transport::ReceiveError::Timeout { .. }) {
            CliError::timeout(e.to_string())
        } else {
            CliError::io(e.to_string())
        }
    })?;
    if command.trace {
        eprintln!("RX {}", hex(&reply_frame));
    }
    let reply = match &command.connection {
        Connection::Tcp(_) => parse_tcp_reply(&command.request, 1, command.unit, &reply_frame),
        Connection::Rtu(_) => parse_rtu_reply(&command.request, command.unit, &reply_frame),
    }
    .map_err(|e| CliError::response(e.to_string()))?;
    link.close().await;
    match reply {
        Reply::Response(response) => {
            print_result(command, &response);
            Ok(())
        }
        Reply::Exception { function, code } => Err(CliError::exception(format!(
            "Modbus exception for FC{function:02}: {code}",
        ))),
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let result = match parse(&args) {
        Ok(Action::Help) => {
            print!("{HELP}");
            Ok(())
        }
        Ok(Action::Version) => {
            println!("esefact-modbus-master {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Ok(Action::Execute(command)) => execute(&command).await,
        Err(error) => Err(error),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Error: {}", error.message);
            ExitCode::from(error.code)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| (*v).to_owned()).collect()
    }

    #[test]
    fn version_needs_no_connection() {
        assert!(matches!(parse(&args(&["--version"])), Ok(Action::Version)));
    }

    #[test]
    fn read_tcp_builds_protocol_request() {
        let Action::Execute(command) = parse(&args(&[
            "read",
            "--tcp",
            "localhost",
            "--unit",
            "1",
            "--function",
            "3",
            "--address",
            "0x10",
            "--count",
            "2",
        ]))
        .unwrap() else {
            panic!("expected command")
        };
        assert_eq!(
            command.request,
            Request::ReadHoldingRegisters {
                address: 16,
                quantity: 2
            }
        );
        assert_eq!(
            command.connection,
            Connection::Tcp(TcpParams {
                host: "localhost".into(),
                port: 502,
                timeout: Duration::from_millis(1000)
            })
        );
    }

    #[test]
    fn write_rtu_builds_multi_register_request() {
        let Action::Execute(command) = parse(&args(&[
            "write",
            "--rtu",
            "COM3",
            "--unit",
            "7",
            "--function",
            "16",
            "--address",
            "20",
            "--values",
            "1,0xFF",
        ]))
        .unwrap() else {
            panic!("expected command")
        };
        assert_eq!(
            command.request,
            Request::WriteMultipleRegisters {
                address: 20,
                values: vec![1, 255]
            }
        );
    }

    #[test]
    fn invalid_input_is_rejected_before_connect() {
        for extra in [
            vec!["--function", "6", "--values", "1,2"],
            vec!["--function", "5", "--values", "2"],
            vec!["--function", "16", "--values", ""],
        ] {
            let mut input = args(&[
                "write",
                "--tcp",
                "localhost",
                "--unit",
                "1",
                "--address",
                "0",
            ]);
            input.extend(args(&extra));
            assert!(parse(&input).is_err());
        }
        assert!(parse(&args(&[
            "read",
            "--tcp",
            "localhost",
            "--rtu",
            "COM3",
            "--unit",
            "1",
            "--function",
            "3",
            "--address",
            "0",
            "--count",
            "1"
        ]))
        .is_err());
        assert!(parse(&args(&[
            "read",
            "--tcp",
            "localhost",
            "--unit",
            "1",
            "--function",
            "3",
            "--address",
            "65535",
            "--count",
            "2"
        ]))
        .is_err());
    }
}
