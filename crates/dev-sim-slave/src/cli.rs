//! Command-line parsing (no external dependency).

use std::net::SocketAddr;

use crate::registers::{parse_u16, Registers, Table};
use crate::sim::parse_units;
use crate::SimConfig;

pub const USAGE: &str = "\
esefact-sim-slave - DEV/TEST TOOL: scriptable Modbus TCP slave simulator (not the product)

USAGE:
  esefact-sim-slave [OPTIONS]

OPTIONS:
  --listen <ip:port>      Modbus TCP address (default 127.0.0.1:5020; port 0 = any free port)
  --control <ip:port>     Control port, loopback only (default 127.0.0.1:5021)
  --no-control            Disable the control port
  --no-stdin              Do not read control commands from stdin
  --units <all|id,id..>   Unit ids that are answered (default all, including 0)
  --limit <n>             Addresses >= n answer exception 02 (default 65536 = none)
  --preload <file.json>   Initial values: {\"holding\": {\"100\": [1, 2, 3]}, \"coils\": {\"0\": 1}}
  --set <table>:<addr>=<v>[,<v>...]
                          Initial values, repeatable, e.g. --set holding:0=1234,5678
                          (tables: coils, discrete, holding, input)
  -h, --help              Show this help

Defaults: holding[n] = n, input[n] = 65535 - n, coils[n] = n odd, discrete[n] = n % 3 == 0.
Control commands (stdin or the control port, one per line; answers are 'ok ...' / 'error ...'):
";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliError {
    Help,
    Invalid(String),
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Help => f.write_str("help requested"),
            Self::Invalid(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for CliError {}

/// Parses command-line arguments (without the program name).
///
/// # Errors
/// [`CliError::Help`] for `--help`, [`CliError::Invalid`] otherwise.
pub fn parse_args<I: IntoIterator<Item = String>>(args: I) -> Result<SimConfig, CliError> {
    let mut config = SimConfig {
        stdin: true,
        ..SimConfig::default()
    };
    let mut args = args.into_iter();
    let bad = |m: String| CliError::Invalid(m);
    while let Some(arg) = args.next() {
        let mut value = |name: &str| {
            args.next()
                .ok_or_else(|| bad(format!("{name} needs a value")))
        };
        match arg.as_str() {
            "-h" | "--help" => return Err(CliError::Help),
            "--listen" => {
                let v = value("--listen")?;
                config.listen = v
                    .parse::<SocketAddr>()
                    .map_err(|_| bad(format!("--listen: \"{v}\" is not ip:port")))?;
            }
            "--control" => {
                let v = value("--control")?;
                config.control = Some(
                    v.parse::<SocketAddr>()
                        .map_err(|_| bad(format!("--control: \"{v}\" is not ip:port")))?,
                );
            }
            "--no-control" => config.control = None,
            "--no-stdin" => config.stdin = false,
            "--units" => {
                let v = value("--units")?;
                config.units =
                    parse_units(&v).ok_or_else(|| bad(format!("--units: bad list \"{v}\"")))?;
            }
            "--limit" => {
                let v = value("--limit")?;
                config.limit = v
                    .parse::<u32>()
                    .ok()
                    .filter(|n| *n <= 0x1_0000)
                    .ok_or_else(|| bad(format!("--limit: \"{v}\" is not 0-65536")))?;
            }
            "--preload" => {
                let path = value("--preload")?;
                let text = std::fs::read_to_string(&path)
                    .map_err(|e| bad(format!("--preload {path}: {e}")))?;
                let doc: serde_json::Value = serde_json::from_str(&text)
                    .map_err(|e| bad(format!("--preload {path}: {e}")))?;
                config
                    .registers
                    .preload(&doc)
                    .map_err(|e| bad(format!("--preload {path}: {e}")))?;
            }
            "--set" => {
                let v = value("--set")?;
                apply_set(&mut config.registers, &v).map_err(|e| bad(format!("--set {v}: {e}")))?;
            }
            other => return Err(bad(format!("unknown option \"{other}\" (see --help)"))),
        }
    }
    Ok(config)
}

/// `<table>:<addr>=<v>[,<v>...]`
fn apply_set(regs: &mut Registers, spec: &str) -> Result<(), String> {
    let (table, rest) = spec
        .split_once(':')
        .ok_or("expected <table>:<addr>=<values>")?;
    let (addr, values) = rest.split_once('=').ok_or("expected <addr>=<values>")?;
    let table = Table::parse(table).ok_or(format!("unknown table \"{table}\""))?;
    let address = parse_u16(addr).ok_or(format!("bad address \"{addr}\""))?;
    let values = values
        .split(',')
        .map(|v| parse_u16(v).ok_or(format!("bad value \"{v}\"")))
        .collect::<Result<Vec<_>, _>>()?;
    regs.set(table, address, &values)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_owned).collect()
    }

    #[test]
    fn defaults_and_options() {
        let c = parse_args(Vec::new()).unwrap();
        assert_eq!(c.listen.to_string(), "127.0.0.1:5020");
        assert_eq!(c.control.unwrap().to_string(), "127.0.0.1:5021");
        assert!(c.stdin);
        assert_eq!(c.units, None);
        let c = parse_args(args(
            "--listen 0.0.0.0:1502 --no-control --no-stdin --units 1,2,0 --limit 100 --set holding:10=7,8 --set coils:3=0",
        ))
        .unwrap();
        assert_eq!(c.listen.port(), 1502);
        assert!(c.control.is_none() && !c.stdin);
        assert_eq!(c.units, Some(vec![1, 2, 0]));
        assert_eq!(c.limit, 100);
        assert_eq!(c.registers.holding[10..12], [7, 8]);
        assert!(!c.registers.coils[3]);
        assert_eq!(parse_args(args("--help")).unwrap_err(), CliError::Help);
        assert!(parse_args(args("--bogus")).is_err());
        assert!(parse_args(args("--set holding:65535=1,2")).is_err());
        assert!(parse_args(args("--limit 70000")).is_err());
    }

    #[test]
    fn preload_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        std::fs::write(
            &path,
            r#"{"holding": {"100": [1, 2, 3], "0x10": 4660}, "coils": {"0": [0, 1]}, "input": {"5": 9}, "discrete": {"1": true}}"#,
        )
        .unwrap();
        let c = parse_args(vec!["--preload".into(), path.display().to_string()]).unwrap();
        assert_eq!(c.registers.holding[100..103], [1, 2, 3]);
        assert_eq!(c.registers.holding[16], 0x1234);
        assert_eq!(c.registers.coils[0..2], [false, true]);
        assert_eq!(c.registers.input[5], 9);
        assert!(c.registers.discrete[1]);
        std::fs::write(&path, r#"{"bogus": {}}"#).unwrap();
        assert!(parse_args(vec!["--preload".into(), path.display().to_string()]).is_err());
    }
}
