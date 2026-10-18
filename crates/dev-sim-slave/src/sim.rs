//! Simulator state, fault injection, request handling and the control command language.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use modbus_core::{decode_tcp, encode_tcp};
use tokio::sync::{watch, Notify};

use crate::log::{emit, hex, LogFn};
use crate::registers::{parse_u16, parse_u64, Registers, Table};

/// A fault applied to replies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FaultKind {
    /// Execute, then reply after this delay.
    Delay(Duration),
    /// Execute, never reply (the master times out).
    Drop,
    /// Do not execute; reply with this exception code.
    Exception(u8),
    /// Execute; reply with this unit id instead of the request's.
    WrongUnit(u8),
    /// Execute; reply with transaction id + 1.
    WrongTxn,
    /// Execute; reply with another function code (03 <-> 04, else 03).
    WrongFunction,
    /// Execute; send only the first N bytes of the reply.
    Truncate(usize),
    /// Execute; send these bytes instead of the reply.
    Garbage(Vec<u8>),
    /// Execute; send the first half of the reply, then close the socket.
    Close,
}

/// The active fault and how many more requests it applies to (`None` = until cleared).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fault {
    pub kind: FaultKind,
    pub remaining: Option<u32>,
    /// Only requests to this unit id are faulted (`unit=<id>`); `None` = every unit. Other
    /// units are answered normally and do not use up `times=N`.
    pub unit: Option<u8>,
}

/// What the connection task does with one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Send nothing (log `reason`).
    Ignore(String),
    /// Send `bytes` after `delay`; close the socket afterwards when `close`.
    Reply {
        bytes: Vec<u8>,
        delay: Duration,
        close: bool,
        note: Option<String>,
    },
}

pub(crate) struct State {
    pub regs: Registers,
    pub fault: Option<Fault>,
    /// `None` = every unit id (0-255) is answered.
    pub units: Option<Vec<u8>>,
    /// Exclusive end of the valid address range (exception 02 beyond it).
    pub limit: u32,
    pub requests: u64,
}

/// Shared simulator core used by the server, the control channels and tests.
pub struct Core {
    state: Mutex<State>,
    pub(crate) log: LogFn,
    /// `true` while the Modbus port accepts connections.
    pub(crate) listen_tx: watch::Sender<bool>,
    /// Incremented by `stop` to close every open connection.
    pub(crate) kill_tx: watch::Sender<u64>,
    pub(crate) quit: Notify,
    pub(crate) next_conn: AtomicU64,
    /// The master's response timeout in ms as told by `master-timeout` (default
    /// [`DEFAULT_MASTER_TIMEOUT_MS`]). See [`Core::classify_early_request`].
    master_timeout_ms: AtomicU64,
}

/// Default for `master-timeout`: the smallest response timeout Modbus Master accepts.
pub const DEFAULT_MASTER_TIMEOUT_MS: u64 = 50;

/// What a request that arrived before the previous reply was sent means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EarlyRequest {
    /// The master sent it before its timeout could have expired: two requests in flight
    /// (logged as `OVERLAP`, a master bug).
    Overlap,
    /// It arrived during an injected `fault delay` after at least the master's timeout: the
    /// master gave up on the late reply and moved on, as it should (logged as `ABANDONED`).
    Abandoned,
}

impl Core {
    pub(crate) fn new(
        regs: Registers,
        units: Option<Vec<u8>>,
        limit: u32,
        log: LogFn,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                regs,
                fault: None,
                units,
                limit,
                requests: 0,
            }),
            log,
            listen_tx: watch::Sender::new(true),
            kill_tx: watch::Sender::new(0),
            quit: Notify::new(),
            next_conn: AtomicU64::new(1),
            master_timeout_ms: AtomicU64::new(DEFAULT_MASTER_TIMEOUT_MS),
        })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn log(&self, message: &str) {
        emit(&self.log, message);
    }

    pub(crate) fn conn_id(&self) -> u64 {
        self.next_conn.fetch_add(1, Ordering::Relaxed)
    }

    /// The overlap rule (REV-004 m7). `after` is the time from receiving a request to the
    /// moment the next request was seen waiting, while the reply had not been sent yet:
    /// - no injected delay, or the next request came earlier than the master's timeout
    ///   (`master-timeout`, default 50 ms = the smallest timeout the master accepts):
    ///   [`EarlyRequest::Overlap`];
    /// - during an injected delay, at or after the master's timeout:
    ///   [`EarlyRequest::Abandoned`] (the master timed out; the late reply it then gets is
    ///   expected and must be discarded by the master).
    #[must_use]
    pub fn classify_early_request(&self, delayed: bool, after: Duration) -> EarlyRequest {
        let timeout = Duration::from_millis(self.master_timeout_ms.load(Ordering::Relaxed));
        if delayed && after >= timeout {
            EarlyRequest::Abandoned
        } else {
            EarlyRequest::Overlap
        }
    }

    /// Handles one complete request frame.
    pub fn handle(&self, frame: &[u8]) -> Action {
        let (header, pdu) = match decode_tcp(frame) {
            Ok(x) => x,
            Err(e) => return Action::Ignore(format!("not a Modbus TCP request ({e})")),
        };
        let mut st = self.lock();
        if let Some(units) = &st.units {
            if !units.contains(&header.unit_id) {
                return Action::Ignore(format!("unit {} is not served", header.unit_id));
            }
        }
        st.requests += 1;
        let unit_id = header.unit_id;
        let fault = match &mut st.fault {
            Some(f) if f.unit.is_none_or(|u| u == unit_id) => {
                let kind = f.kind.clone();
                if let Some(n) = &mut f.remaining {
                    *n -= 1;
                    if *n == 0 {
                        st.fault = None;
                    }
                }
                Some(kind)
            }
            _ => None,
        };
        let fc = pdu[0];
        let limit = st.limit;
        let mut reply_pdu = match &fault {
            Some(FaultKind::Exception(code)) => vec![fc | 0x80, *code],
            _ => st.regs.execute(pdu, limit),
        };
        drop(st);

        let mut txn = header.transaction_id;
        let mut unit = header.unit_id;
        let mut delay = Duration::ZERO;
        let mut close = false;
        let note = fault.as_ref().map(|f| format!("fault {f:?}"));
        match &fault {
            None | Some(FaultKind::Exception(_)) => {}
            Some(FaultKind::Delay(d)) => delay = *d,
            Some(FaultKind::Drop) => return Action::Ignore("fault drop: no reply".into()),
            Some(FaultKind::WrongUnit(u)) => unit = *u,
            Some(FaultKind::WrongTxn) => txn = txn.wrapping_add(1),
            Some(FaultKind::WrongFunction) => {
                reply_pdu[0] = if reply_pdu[0] & 0x7F == 0x03 {
                    (reply_pdu[0] & 0x80) | 0x04
                } else {
                    (reply_pdu[0] & 0x80) | 0x03
                };
            }
            Some(_) => {}
        }
        let mut bytes = encode_tcp(txn, unit, &reply_pdu);
        match fault {
            Some(FaultKind::Truncate(n)) => bytes.truncate(n),
            Some(FaultKind::Garbage(g)) => bytes = g,
            Some(FaultKind::Close) => {
                bytes.truncate((bytes.len() / 2).max(1));
                close = true;
            }
            _ => {}
        }
        Action::Reply {
            bytes,
            delay,
            close,
            note,
        }
    }

    /// Executes one control command and returns `ok ...` or `error ...`.
    pub fn command(&self, line: &str) -> String {
        // Windows shells (PowerShell pipes) may prefix stdin with a UTF-8 byte order mark.
        let line = line.trim().trim_start_matches('\u{feff}').trim();
        if line.is_empty() {
            return "ok".into();
        }
        let response = match self.run(line) {
            Ok(text) if text.is_empty() => "ok".to_owned(),
            Ok(text) => format!("ok {text}"),
            Err(e) => format!("error {e}"),
        };
        self.log(&format!("CTRL {line} -> {response}"));
        response
    }

    fn run(&self, line: &str) -> Result<String, String> {
        let words: Vec<&str> = line.split_whitespace().collect();
        let arg = |i: usize, what: &str| words.get(i).copied().ok_or(format!("missing {what}"));
        match words[0].to_ascii_lowercase().as_str() {
            "help" => Ok(HELP.replace('\n', " | ")),
            "status" => {
                let st = self.lock();
                Ok(format!(
                    "listening={} fault={} units={} limit={} requests={}",
                    *self.listen_tx.borrow(),
                    st.fault.as_ref().map_or("none".into(), |f| format!(
                        "{:?}x{}{}",
                        f.kind,
                        f.remaining.map_or("inf".into(), |n| n.to_string()),
                        f.unit.map_or(String::new(), |u| format!("@unit{u}"))
                    )),
                    st.units.as_ref().map_or("all".into(), |u| format!("{u:?}")),
                    st.limit,
                    st.requests
                ))
            }
            "set" => {
                let table = parse_table(arg(1, "table")?)?;
                let address = parse_u16(arg(2, "address")?).ok_or("bad address")?;
                let values = words[3..]
                    .iter()
                    .flat_map(|w| w.split(','))
                    .filter(|w| !w.is_empty())
                    .map(|w| parse_u16(w).ok_or(format!("bad value \"{w}\"")))
                    .collect::<Result<Vec<_>, _>>()?;
                self.lock().regs.set(table, address, &values)?;
                Ok(format!("{} value(s) written", values.len()))
            }
            "get" => {
                let table = parse_table(arg(1, "table")?)?;
                let address = parse_u16(arg(2, "address")?).ok_or("bad address")?;
                let count = match words.get(3) {
                    Some(w) => usize::try_from(parse_u64(w).ok_or("bad count")?).unwrap_or(0),
                    None => 1,
                };
                let values = self.lock().regs.get(table, address, count)?;
                Ok(values
                    .iter()
                    .map(u16::to_string)
                    .collect::<Vec<_>>()
                    .join(" "))
            }
            "fault" => {
                let fault = parse_fault(&words[1..])?;
                let text = format!(
                    "{:?} for {}{}",
                    fault.kind,
                    fault
                        .remaining
                        .map_or("all requests until cleared".into(), |n| format!(
                            "{n} request(s)"
                        )),
                    fault
                        .unit
                        .map_or(String::new(), |u| format!(" to unit {u}"))
                );
                self.lock().fault = Some(fault);
                Ok(text)
            }
            "master-timeout" => {
                let ms = parse_u64(arg(1, "milliseconds")?)
                    .filter(|n| (1..=600_000).contains(n))
                    .ok_or("master-timeout must be 1-600000 ms")?;
                self.master_timeout_ms.store(ms, Ordering::Relaxed);
                Ok(format!(
                    "master timeout {ms} ms: an early request seen at least that long into an injected delay counts as abandoned"
                ))
            }
            "clear" => {
                self.lock().fault = None;
                Ok("faults cleared".into())
            }
            "units" => {
                let spec = arg(1, "unit ids or \"all\"")?;
                let units = parse_units(&words[1..].join(","))
                    .ok_or(format!("bad unit list \"{spec}\""))?;
                let text = units.as_ref().map_or("all".into(), |u| format!("{u:?}"));
                self.lock().units = units;
                Ok(format!("units {text}"))
            }
            "limit" => {
                let n = parse_u64(arg(1, "limit")?)
                    .filter(|n| *n <= 0x1_0000)
                    .ok_or("limit must be 0-65536")?;
                self.lock().limit = u32::try_from(n).unwrap_or(0x1_0000);
                Ok(format!("addresses >= {n} answer exception 02"))
            }
            "refuse" => match arg(1, "on|off")? {
                "on" => {
                    self.listen_tx.send_replace(false);
                    Ok("not accepting new connections".into())
                }
                "off" => {
                    self.listen_tx.send_replace(true);
                    Ok("accepting new connections".into())
                }
                other => Err(format!("expected on|off, got \"{other}\"")),
            },
            "stop" => {
                self.listen_tx.send_replace(false);
                self.kill_tx.send_modify(|g| *g += 1);
                Ok("stopped: open connections closed, new ones refused".into())
            }
            "resume" => {
                self.listen_tx.send_replace(true);
                Ok("resumed: accepting connections".into())
            }
            "quit" | "exit" => {
                self.quit.notify_waiters();
                self.quit.notify_one();
                Ok("bye".into())
            }
            other => Err(format!("unknown command \"{other}\" (try help)")),
        }
    }

    pub(crate) fn log_frame(&self, conn: u64, dir: &str, bytes: &[u8], note: Option<&str>) {
        let suffix = note.map_or(String::new(), |n| format!(" # {n}"));
        self.log(&format!(
            "conn={conn} {dir} {} | {}{suffix}",
            bytes.len(),
            hex(bytes)
        ));
    }
}

fn parse_table(s: &str) -> Result<Table, String> {
    Table::parse(s).ok_or(format!(
        "unknown table \"{s}\" (coils|discrete|holding|input)"
    ))
}

/// `all` or a comma/space separated list of unit ids 0-255.
#[must_use]
pub fn parse_units(spec: &str) -> Option<Option<Vec<u8>>> {
    let spec = spec.trim();
    if spec.eq_ignore_ascii_case("all") || spec.eq_ignore_ascii_case("any") {
        return Some(None);
    }
    let ids: Option<Vec<u8>> = spec
        .split([',', ' '])
        .filter(|s| !s.is_empty())
        .map(|s| parse_u64(s).and_then(|v| u8::try_from(v).ok()))
        .collect();
    ids.filter(|v| !v.is_empty()).map(Some)
}

/// `<kind> [args] [times=N] [unit=ID]`.
///
/// # Errors
/// A message for an unknown kind or bad argument.
pub fn parse_fault(words: &[&str]) -> Result<Fault, String> {
    let mut remaining = None;
    let mut unit = None;
    let mut args: Vec<&str> = Vec::new();
    for w in words {
        if let Some(u) = w.strip_prefix("unit=") {
            let u = parse_u64(u)
                .and_then(|u| u8::try_from(u).ok())
                .ok_or("unit must be 0-255")?;
            unit = Some(u);
        } else if let Some(n) = w.strip_prefix("times=") {
            let n = parse_u64(n)
                .and_then(|n| u32::try_from(n).ok())
                .filter(|n| *n > 0)
                .ok_or("times must be 1 or more")?;
            remaining = Some(n);
        } else {
            args.push(w);
        }
    }
    let kind_name = args
        .first()
        .ok_or("missing fault kind")?
        .to_ascii_lowercase();
    let num = |what: &str| -> Result<u64, String> {
        args.get(1)
            .and_then(|s| parse_u64(s))
            .ok_or(format!("{kind_name} needs {what}"))
    };
    let kind = match kind_name.as_str() {
        "delay" => FaultKind::Delay(Duration::from_millis(num("milliseconds")?)),
        "drop" | "timeout" => FaultKind::Drop,
        "exception" => FaultKind::Exception(
            u8::try_from(num("an exception code")?).map_err(|_| "code must be 0-255")?,
        ),
        "wrong-unit" => FaultKind::WrongUnit(
            u8::try_from(num("a unit id")?).map_err(|_| "unit id must be 0-255")?,
        ),
        "wrong-txn" => FaultKind::WrongTxn,
        "wrong-function" => FaultKind::WrongFunction,
        "truncate" => FaultKind::Truncate(usize::try_from(num("a byte count")?).unwrap_or(0)),
        "garbage" => {
            let bytes = if args.len() > 1 {
                args[1..]
                    .iter()
                    .map(|b| u8::from_str_radix(b.trim_start_matches("0x"), 16))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| "garbage bytes must be hex, for example DE AD BE EF")?
            } else {
                vec![0xDE, 0xAD, 0xBE, 0xEF]
            };
            FaultKind::Garbage(bytes)
        }
        "close" => FaultKind::Close,
        other => return Err(format!("unknown fault \"{other}\"")),
    };
    Ok(Fault {
        kind,
        remaining,
        unit,
    })
}

/// Control command reference (also printed by `help`).
pub const HELP: &str = "\
status
set <coils|discrete|holding|input> <addr> <v> [v...]
get <coils|discrete|holding|input> <addr> [count]
fault delay <ms> [times=N] [unit=ID]
fault drop [times=N] [unit=ID]
fault exception <code> [times=N] [unit=ID]
fault wrong-unit <id> [times=N] [unit=ID]
fault wrong-txn [times=N] [unit=ID]
fault wrong-function [times=N] [unit=ID]
fault truncate <bytes> [times=N] [unit=ID]
fault garbage [hex bytes...] [times=N] [unit=ID]
fault close [times=N] [unit=ID]
master-timeout <ms>
clear
units all | units <id> [id...]
limit <n>
refuse on|off
stop
resume
quit";
