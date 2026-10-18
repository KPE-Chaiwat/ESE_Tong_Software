//! Modbus master: sessions with many polls, scheduling and traffic capture. Depends on
//! `transport`.
//!
//! - [`Session`]: one per connection window; an actor task owning the link (`session.rs`).
//! - [`connection_state`] (C1-C7) and [`poll_state`] (PT0-PT8): the two state machines of
//!   DES-002 section 1.
//! - [`scheduler`]: DES-002 section 7 (earliest deadline, round robin, no starvation).
//! - [`validate`]: input validation with user-facing messages.
//! - [`EventSink`]: where events go; [`emitter`] documents the batching/drop policy of the
//!   session channel and of every poll view channel.
//! - [`Clock`]: injectable wall clock; scheduling uses `tokio::time` (pausable in tests).
//! - [`TimerResolution`]: the OS timer precision held while polls run (REPORT-006 D1); the
//!   OS implementation is injected by the app, the default is [`NoTimerResolution`].

mod clock;
pub mod connection_state;
mod connector;
pub mod emitter;
mod poll;
pub mod poll_state;
pub mod scheduler;
mod session;
mod timer;
mod traffic;
pub mod validate;

pub use clock::{Clock, SystemClock, TokioClock};
pub use connector::{Connector, SystemConnector};
pub use emitter::{EventSink, SessionSink, ViewSink};
pub use poll::HANDOFF_MAX_AGE;
pub use session::{
    BulkLease, NativeOpenUndo, PollHostInfo, Session, SessionDeps, SessionError, SessionStats,
    ShowOutcome, HANDOFF_REQUEST_TIMEOUT, LINK_LOAD_WINDOW, RTU_BROADCAST_TURNAROUND, RTU_MIN_GAP,
};
pub use timer::{NoTimerResolution, TimerResolution};
pub use traffic::TRAFFIC_LOG_CAPACITY;
pub use validate::ValidationError;

/// Default scan rate in milliseconds (REQ-001 default).
pub const DEFAULT_SCAN_RATE_MS: u32 = 1000;

/// Default response timeout in milliseconds (REQ-001 default).
pub const DEFAULT_TIMEOUT_MS: u32 = 1000;

/// Largest Modbus TCP frame this master will ever need to buffer.
pub const MAX_FRAME_SIZE: usize = transport::MAX_TCP_ADU_SIZE;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_requirement() {
        assert_eq!(DEFAULT_SCAN_RATE_MS, 1000);
        assert_eq!(DEFAULT_TIMEOUT_MS, 1000);
        assert_eq!(MAX_FRAME_SIZE, 260);
    }
}
