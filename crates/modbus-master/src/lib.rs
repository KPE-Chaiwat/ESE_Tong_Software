//! Modbus master: sessions, polling and traffic capture. Depends on `transport`.
//!
//! - [`Session`]: one per tool window; an actor task owning the link (see `session.rs`).
//! - [`state_machine`]: the 9 states and transitions T1-T15 of DES-001 section 2.
//! - [`validate`]: input validation with user-facing messages.
//! - [`EventSink`]: where `SessionEvent`s go; [`emitter`] documents the batching/drop policy.
//! - [`Clock`]: injectable wall clock; scheduling uses `tokio::time` (pausable in tests).

mod clock;
mod connector;
pub mod emitter;
mod session;
pub mod state_machine;
mod traffic;
pub mod validate;

pub use clock::{Clock, SystemClock, TokioClock};
pub use connector::{Connector, SystemConnector};
pub use emitter::EventSink;
pub use session::{
    Session, SessionDeps, SessionError, SessionStats, RTU_BROADCAST_TURNAROUND, RTU_MIN_GAP,
};
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
