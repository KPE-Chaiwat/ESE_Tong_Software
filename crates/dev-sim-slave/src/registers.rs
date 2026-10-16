//! The simulated data model and its request execution.

use modbus_core::{ExceptionCode, PduError, Reply, Request, RequestError};
use serde_json::Value;

/// One of the four Modbus tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Table {
    Coils,
    Discrete,
    Holding,
    Input,
}

impl Table {
    /// Accepts `coil(s)`, `discrete`/`di`, `holding`/`hr`, `input`/`ir`.
    #[must_use]
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.to_ascii_lowercase().as_str() {
            "coil" | "coils" => Self::Coils,
            "discrete" | "discretes" | "di" => Self::Discrete,
            "holding" | "hr" => Self::Holding,
            "input" | "inputs" | "ir" => Self::Input,
            _ => return None,
        })
    }

    #[must_use]
    pub fn is_bits(self) -> bool {
        matches!(self, Self::Coils | Self::Discrete)
    }
}

/// Coils, discrete inputs, holding and input registers for addresses 0-65535.
///
/// Deterministic defaults: `holding[n] = n`, `input[n] = 65535 - n`,
/// `coils[n] = n is odd`, `discrete[n] = n is a multiple of 3`.
#[derive(Debug, Clone)]
pub struct Registers {
    pub coils: Vec<bool>,
    pub discrete: Vec<bool>,
    pub holding: Vec<u16>,
    pub input: Vec<u16>,
}

impl Default for Registers {
    fn default() -> Self {
        Self {
            coils: (0..0x1_0000u32).map(|n| n % 2 == 1).collect(),
            discrete: (0..0x1_0000u32).map(|n| n % 3 == 0).collect(),
            holding: (0..=u16::MAX).collect(),
            input: (0..=u16::MAX).map(|n| u16::MAX - n).collect(),
        }
    }
}

impl Registers {
    /// Writes `values` starting at `address`. Bits accept 0/1.
    ///
    /// # Errors
    /// A message when the range passes 65535 or a bit value is not 0/1.
    pub fn set(&mut self, table: Table, address: u16, values: &[u16]) -> Result<(), String> {
        let start = usize::from(address);
        if values.is_empty() {
            return Err("no values given".into());
        }
        if start + values.len() > 0x1_0000 {
            return Err("range ends after address 65535".into());
        }
        if table.is_bits() && values.iter().any(|v| *v > 1) {
            return Err("coils and discrete inputs take 0 or 1".into());
        }
        for (i, v) in values.iter().enumerate() {
            match table {
                Table::Coils => self.coils[start + i] = *v == 1,
                Table::Discrete => self.discrete[start + i] = *v == 1,
                Table::Holding => self.holding[start + i] = *v,
                Table::Input => self.input[start + i] = *v,
            }
        }
        Ok(())
    }

    /// Reads `count` values from `address` (bits as 0/1).
    ///
    /// # Errors
    /// A message when the range passes 65535.
    pub fn get(&self, table: Table, address: u16, count: usize) -> Result<Vec<u16>, String> {
        let start = usize::from(address);
        if count == 0 || start + count > 0x1_0000 {
            return Err("range must be 1 value or more and end at 65535 at most".into());
        }
        let range = start..start + count;
        Ok(match table {
            Table::Coils => self.coils[range].iter().map(|b| u16::from(*b)).collect(),
            Table::Discrete => self.discrete[range].iter().map(|b| u16::from(*b)).collect(),
            Table::Holding => self.holding[range].to_vec(),
            Table::Input => self.input[range].to_vec(),
        })
    }

    /// Applies a preload document:
    /// `{ "holding": { "100": 7, "0x10": [1, 2, 3] }, "input": {...}, "coils": {...}, "discrete": {...} }`.
    /// Keys are start addresses (decimal or `0x` hex); a value is one number or an array of
    /// consecutive values.
    ///
    /// # Errors
    /// A message naming the offending entry.
    pub fn preload(&mut self, doc: &Value) -> Result<usize, String> {
        let obj = doc.as_object().ok_or("preload must be a JSON object")?;
        let mut written = 0;
        for (table_name, entries) in obj {
            let table = Table::parse(table_name)
                .ok_or_else(|| format!("unknown table \"{table_name}\""))?;
            let entries = entries
                .as_object()
                .ok_or_else(|| format!("\"{table_name}\" must be an object of address: value"))?;
            for (key, value) in entries {
                let address =
                    parse_u16(key).ok_or_else(|| format!("{table_name}: bad address \"{key}\""))?;
                let values: Vec<u16> = match value {
                    Value::Array(items) => items
                        .iter()
                        .map(|v| json_u16(v).ok_or_else(|| format!("{table_name}.{key}: {v}")))
                        .collect::<Result<_, _>>()?,
                    v => vec![json_u16(v).ok_or_else(|| format!("{table_name}.{key}: {v}"))?],
                };
                self.set(table, address, &values)
                    .map_err(|e| format!("{table_name}.{key}: {e}"))?;
                written += values.len();
            }
        }
        Ok(written)
    }

    /// Executes a request PDU and returns the reply PDU (normal or exception).
    ///
    /// Exception codes follow the specification: 01 unsupported function, 03 bad quantity /
    /// byte count / coil value / malformed PDU, 02 address range beyond `limit` (exclusive
    /// end, at most 65536).
    pub fn execute(&mut self, pdu: &[u8], limit: u32) -> Vec<u8> {
        let fc = pdu.first().copied().unwrap_or(0);
        let exception = |code: ExceptionCode| {
            Reply::Exception {
                function: fc & 0x7F,
                code,
            }
            .encode_pdu()
        };
        let request = match Request::decode_pdu(pdu) {
            Ok(r) => r,
            Err(PduError::UnsupportedFunction(_) | PduError::Empty) => {
                return exception(ExceptionCode::ILLEGAL_FUNCTION)
            }
            Err(PduError::Invalid(RequestError::AddressOverflow { .. })) => {
                return exception(ExceptionCode::ILLEGAL_DATA_ADDRESS)
            }
            Err(_) => return exception(ExceptionCode::ILLEGAL_DATA_VALUE),
        };
        let a = usize::from(request.address());
        let q = usize::from(request.quantity());
        if (a + q) as u64 > u64::from(limit.min(0x1_0000)) {
            return exception(ExceptionCode::ILLEGAL_DATA_ADDRESS);
        }
        let reply = match &request {
            Request::ReadCoils { .. } => {
                Reply::echo_for(&request, self.coils[a..a + q].to_vec(), vec![])
            }
            Request::ReadDiscreteInputs { .. } => {
                Reply::echo_for(&request, self.discrete[a..a + q].to_vec(), vec![])
            }
            Request::ReadHoldingRegisters { .. } => {
                Reply::echo_for(&request, vec![], self.holding[a..a + q].to_vec())
            }
            Request::ReadInputRegisters { .. } => {
                Reply::echo_for(&request, vec![], self.input[a..a + q].to_vec())
            }
            Request::WriteSingleCoil { value, .. } => {
                self.coils[a] = *value;
                Reply::echo_for(&request, vec![], vec![])
            }
            Request::WriteSingleRegister { value, .. } => {
                self.holding[a] = *value;
                Reply::echo_for(&request, vec![], vec![])
            }
            Request::WriteMultipleCoils { values, .. } => {
                self.coils[a..a + q].copy_from_slice(values);
                Reply::echo_for(&request, vec![], vec![])
            }
            Request::WriteMultipleRegisters { values, .. } => {
                self.holding[a..a + q].copy_from_slice(values);
                Reply::echo_for(&request, vec![], vec![])
            }
        };
        reply.encode_pdu()
    }
}

/// Decimal or `0x` hex.
#[must_use]
pub fn parse_u64(s: &str) -> Option<u64> {
    let s = s.trim();
    match s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        Some(hex) => u64::from_str_radix(hex, 16).ok(),
        None => s.parse().ok(),
    }
}

#[must_use]
pub fn parse_u16(s: &str) -> Option<u16> {
    parse_u64(s).and_then(|v| u16::try_from(v).ok())
}

fn json_u16(v: &Value) -> Option<u16> {
    match v {
        Value::Number(n) => n.as_u64().and_then(|v| u16::try_from(v).ok()),
        Value::Bool(b) => Some(u16::from(*b)),
        Value::String(s) => parse_u16(s),
        _ => None,
    }
}
