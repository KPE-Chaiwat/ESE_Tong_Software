//! Timestamped log lines: `<ISO-8601 UTC> <epoch ms> <message>`.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Where log lines go (stdout in the binary, a buffer in tests).
pub type LogFn = Arc<dyn Fn(&str) + Send + Sync>;

/// A logger that prints to stdout (line buffered, one line per event).
#[must_use]
pub fn stdout_logger() -> LogFn {
    Arc::new(|line| println!("{line}"))
}

/// Milliseconds since the Unix epoch.
#[must_use]
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// `2026-10-16T12:34:56.789Z` for `ms` since the epoch (UTC).
#[must_use]
pub fn iso_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        ms % 1000
    )
}

/// Uppercase hex bytes separated by single spaces (same format as the Traffic panel).
#[must_use]
pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn emit(log: &LogFn, message: &str) {
    let ms = now_ms();
    log(&format!("{} {ms} {message}", iso_utc(ms)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_format() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(1_760_617_696_789), "2025-10-16T12:28:16.789Z");
        assert_eq!(iso_utc(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(hex(&[0, 0x0A, 0xFF]), "00 0A FF");
    }
}
