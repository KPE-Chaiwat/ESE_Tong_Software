//! Injectable wall clock for event timestamps.
//!
//! Scheduling (scan rate, timeouts, round trips, batching) uses `tokio::time`, which tests
//! pause and advance deterministically (`#[tokio::test(start_paused = true)]`). Wall-clock
//! timestamps (`at` fields) come from a [`Clock`] so tests can make them deterministic too.

use std::time::{SystemTime, UNIX_EPOCH};

/// Source of wall-clock timestamps in milliseconds since the Unix epoch.
pub trait Clock: Send + Sync + 'static {
    fn now_ms(&self) -> u64;
}

/// The real system clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
    }
}

/// A clock that follows `tokio::time` from a fixed epoch, so timestamps are deterministic
/// under a paused Tokio clock.
#[derive(Debug, Clone, Copy)]
pub struct TokioClock {
    base_ms: u64,
    start: tokio::time::Instant,
}

impl TokioClock {
    /// Must be created inside a Tokio runtime.
    #[must_use]
    pub fn new(base_ms: u64) -> Self {
        Self {
            base_ms,
            start: tokio::time::Instant::now(),
        }
    }
}

impl Clock for TokioClock {
    fn now_ms(&self) -> u64 {
        let elapsed = u64::try_from(self.start.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.base_ms.saturating_add(elapsed)
    }
}
