//! Serial port enumeration, behind a trait with per-OS implementations (CLAUDE.md rule 4).

use crate::error::ListPortsError;

/// One serial port as shown in the port selector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortEntry {
    /// Name used to open the port, for example `COM3`.
    pub name: String,
    /// Human readable description, for example `USB Serial Device`.
    pub description: Option<String>,
}

/// Lists the serial ports of the machine.
pub trait SerialPortLister: Send + Sync {
    /// # Errors
    /// [`ListPortsError::NotSupported`] on operating systems without an implementation.
    fn list_ports(&self) -> Result<Vec<PortEntry>, ListPortsError>;
}

/// The lister for the current operating system.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemPortLister;

#[cfg(windows)]
impl SerialPortLister for SystemPortLister {
    fn list_ports(&self) -> Result<Vec<PortEntry>, ListPortsError> {
        let ports =
            tokio_serial::available_ports().map_err(|e| ListPortsError::Io(e.to_string()))?;
        let mut entries: Vec<PortEntry> = ports
            .into_iter()
            .map(|p| PortEntry {
                description: describe(&p.port_type),
                name: p.port_name,
            })
            .collect();
        sort_ports(&mut entries);
        entries.dedup_by(|a, b| a.name == b.name);
        Ok(entries)
    }
}

#[cfg(not(windows))]
impl SerialPortLister for SystemPortLister {
    fn list_ports(&self) -> Result<Vec<PortEntry>, ListPortsError> {
        Err(ListPortsError::NotSupported)
    }
}

#[cfg(windows)]
fn describe(port_type: &tokio_serial::SerialPortType) -> Option<String> {
    match port_type {
        tokio_serial::SerialPortType::UsbPort(info) => info
            .product
            .clone()
            .or_else(|| info.manufacturer.clone())
            .or_else(|| Some("USB serial port".to_owned())),
        tokio_serial::SerialPortType::BluetoothPort => Some("Bluetooth serial port".to_owned()),
        tokio_serial::SerialPortType::PciPort => Some("PCI serial port".to_owned()),
        tokio_serial::SerialPortType::Unknown => None,
    }
}

/// Whether `name` has the platform form of a serial port name (REV-001 F8).
/// Windows: `COM1`-`COM999`, case-insensitive, nothing else (no paths, no `\\.\` prefix).
/// Other systems: `/dev/` followed by one path segment of `[A-Za-z0-9._-]` (not `.`/`..`).
#[must_use]
pub fn is_valid_serial_port_name(name: &str) -> bool {
    if cfg!(windows) {
        let Some(prefix) = name.get(..3) else {
            return false;
        };
        let digits = &name[3..];
        prefix.eq_ignore_ascii_case("COM")
            && (1..=3).contains(&digits.len())
            && digits.bytes().all(|b| b.is_ascii_digit())
            && !digits.starts_with('0')
    } else {
        name.strip_prefix("/dev/").is_some_and(|rest| {
            !rest.is_empty()
                && rest != "."
                && rest != ".."
                && rest
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        })
    }
}

/// Natural order: `COM2` before `COM10`; names without a number sort by text.
pub fn sort_ports(entries: &mut [PortEntry]) {
    fn key(name: &str) -> (String, u32) {
        let digits = name.trim_start_matches(|c: char| !c.is_ascii_digit());
        let prefix = &name[..name.len() - digits.len()];
        (
            prefix.to_ascii_uppercase(),
            digits.parse().unwrap_or(u32::MAX),
        )
    }
    entries.sort_by(|a, b| key(&a.name).cmp(&key(&b.name)).then(a.name.cmp(&b.name)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_sort() {
        let mut v: Vec<PortEntry> = ["COM10", "COM2", "COM1", "/dev/ttyUSB0"]
            .into_iter()
            .map(|n| PortEntry {
                name: n.into(),
                description: None,
            })
            .collect();
        sort_ports(&mut v);
        let names: Vec<_> = v.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["/dev/ttyUSB0", "COM1", "COM2", "COM10"]);
    }

    #[test]
    fn serial_port_name_pattern() {
        if cfg!(windows) {
            for ok in ["COM1", "com3", "COM10", "COM256", "Com999"] {
                assert!(is_valid_serial_port_name(ok), "{ok}");
            }
            for bad in [
                "",
                "COM",
                "COM0",
                "COM01",
                "COM1000",
                "COM1 ",
                r"\\.\COM3",
                r"C:\Users\x\file.txt",
                r"..\..",
                "COM3:",
                "LPT1",
                "NUL",
            ] {
                assert!(!is_valid_serial_port_name(bad), "{bad}");
            }
        } else {
            assert!(is_valid_serial_port_name("/dev/ttyUSB0"));
            assert!(!is_valid_serial_port_name("/dev/../etc/passwd"));
            assert!(!is_valid_serial_port_name("/dev/.."));
            assert!(!is_valid_serial_port_name("COM3"));
        }
    }

    #[test]
    fn system_lister_does_not_panic() {
        // Real hardware is not assumed; on Windows this returns a (possibly empty) list.
        let result = SystemPortLister.list_ports();
        if cfg!(windows) {
            assert!(result.is_ok());
        } else {
            assert_eq!(result, Err(ListPortsError::NotSupported));
        }
    }
}
